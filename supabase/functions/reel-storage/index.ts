import { createClient } from "npm:@supabase/supabase-js@2";
import {
  CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand, S3Client,
} from "npm:@aws-sdk/client-s3@3";
import { createPresignedPost } from "npm:@aws-sdk/s3-presigned-post@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const roles = ["video", "cover"] as const;
const limits = { video: 50_000_000, cover: 10_000_000 };
const mimeTypes = {
  video: /^video\/(mp4|webm|quicktime|x-m4v|3gpp|ogg|mpeg|x-msvideo)$/,
  cover: /^image\/(jpeg|png|webp|avif)$/,
};
const options = { auth: { persistSession: false, autoRefreshToken: false } };

type MediaRole = typeof roles[number];
type MediaSpec = { size: number; mime: string };
type Media = Record<MediaRole, MediaSpec>;
type Json = Record<string, unknown>;

class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function response(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
}

function id(value: unknown) {
  if (typeof value !== "string" || !uuid.test(value)) throw new RequestError(400, "Invalid Reel identifier.");
  return value;
}

function object(value: unknown): Json {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new RequestError(400, "Invalid Reel request.");
  return value as Json;
}

function readMedia(value: unknown): Media {
  const input = object(value);
  const entries = roles.map(role => {
    const { size, mime } = object(input[role]);
    if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > limits[role] ||
        typeof mime !== "string" || !mimeTypes[role].test(mime)) {
      throw new RequestError(400, "Unsupported Reel file type or size.");
    }
    return [role, { size, mime }];
  });
  return Object.fromEntries(entries) as Media;
}

function s3Path(path: string, owner: string, reel: string) {
  const parts = path.split("/");
  return parts.length === 5 && parts[0] === owner && parts[1] === reel && parts[2] === "s3" &&
    uuid.test(parts[3]) && roles.includes(parts[4] as MediaRole);
}

function getStorage() {
  const bucket = Deno.env.get("REEL_S3_BUCKET");
  const region = Deno.env.get("REEL_S3_REGION");
  const accessKeyId = Deno.env.get("REEL_S3_ACCESS_KEY_ID");
  const secretAccessKey = Deno.env.get("REEL_S3_SECRET_ACCESS_KEY");
  if (!bucket || !region || !accessKeyId || !secretAccessKey) {
    throw new RequestError(503, "Reel storage is unavailable. Try again later.");
  }
  const sessionToken = Deno.env.get("REEL_S3_SESSION_TOKEN");
  return {
    bucket,
    s3: new S3Client({ region, credentials: { accessKeyId, secretAccessKey, sessionToken } }),
  };
}

async function removeKeys(s3: S3Client, bucket: string, keys: string[]) {
  if (!keys.length) return [];
  const result = await s3.send(new DeleteObjectsCommand({
    Bucket: bucket, Delete: { Objects: keys.map(Key => ({ Key })), Quiet: true },
  }));
  const failed = new Set((result.Errors || []).map(item => item.Key));
  return keys.filter(key => !failed.has(key));
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return response({ error: "Method not allowed." }, 405);
  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) throw new RequestError(401, "Sign in to manage Reels.");
    const project = Deno.env.get("SUPABASE_URL")!;
    const viewer = createClient(project, Deno.env.get("SUPABASE_ANON_KEY")!, {
      ...options, global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: authError } = await viewer.auth.getUser();
    if (authError || !user) throw new RequestError(401, "Sign in to manage Reels.");
    const raw = await req.text();
    if (raw.length > 24000) throw new RequestError(413, "Reel request is too large.");
    let body: Json;
    try { body = object(JSON.parse(raw)); }
    catch { throw new RequestError(400, "Invalid Reel request."); }

    const { s3, bucket } = getStorage();
    if (body.action === "read") {
      if (!Array.isArray(body.ids) || body.ids.length > 50) throw new RequestError(400, "Invalid Reel list.");
      const ids = [...new Set(body.ids.map(id))];
      if (!ids.length) return response({ urls: [] });
      const { data, error } = await viewer.from("media_assets")
        .select("object_path,owner_id,content_id").in("content_id", ids).like("object_path", "%/s3/%");
      if (error) throw error;
      const allowed = data.filter(asset => s3Path(asset.object_path, asset.owner_id, asset.content_id));
      const urls = await Promise.all(allowed.map(async asset => ({
        path: asset.object_path,
        signedUrl: await getSignedUrl(s3, new GetObjectCommand({
          Bucket: bucket, Key: "reels/" + asset.object_path,
        }), { expiresIn: 900 }),
      })));
      return response({ urls });
    }

    const reel = id(body.id);
    if (body.action === "delete") {
      const { error } = await viewer.from("media_content").delete()
        .eq("id", reel).eq("owner_id", user.id).eq("kind", "reel");
      if (error) throw error;
      let filesRemoved = false;
      try {
        const backend = createClient(project, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, options);
        const { data: jobs, error: jobError } = await backend.from("reel_s3_deletions").select("object_path")
          .eq("owner_id", user.id).eq("content_id", reel);
        if (jobError) throw jobError;
        const paths = jobs.map(item => item.object_path).filter(path => s3Path(path, user.id, reel));
        const removed = await removeKeys(s3, bucket, paths.map(path => "reels/" + path));
        if (removed.length) {
          const { error: cleanupError } = await backend.from("reel_s3_deletions").delete().eq("owner_id", user.id)
            .eq("content_id", reel).in("object_path", removed.map(key => key.slice("reels/".length)));
          if (cleanupError) throw cleanupError;
        }
        filesRemoved = removed.length === jobs.length;
      } catch (error) {
        console.error("Reel storage cleanup incomplete", error instanceof Error ? error.name : "storage error");
      }
      return response({ filesRemoved });
    }

    if (!["prepare", "publish"].includes(String(body.action))) throw new RequestError(400, "Unknown Reel action.");
    const { data: existing, error: lookupError } = await viewer.from("media_content")
      .select("assets:media_assets(object_path,position)").eq("id", reel).eq("owner_id", user.id).eq("kind", "reel").maybeSingle();
    if (lookupError) throw lookupError;
    if (existing?.assets.length === 2) {
      return response({ paths: existing.assets.sort((a, b) => a.position - b.position).map(asset => asset.object_path) });
    }

    const media = readMedia(body.media);
    if (body.action === "prepare") {
      const ticket = crypto.randomUUID();
      const uploads = await Promise.all(roles.map(async role => ({
        role, ...await createPresignedPost(s3, {
          Bucket: bucket, Key: `incoming/${user.id}/${reel}/${ticket}/${role}`,
          Fields: { "Content-Type": media[role].mime },
          Conditions: [
            ["eq", "$Content-Type", media[role].mime],
            ["content-length-range", media[role].size, media[role].size],
          ],
          Expires: 600,
        }),
      })));
      return response({ ticket, uploads });
    }

    const ticket = id(body.ticket);
    const generation = crypto.randomUUID();
    const caption = body.caption;
    const audience = body.audience;
    const duration = body.duration;
    const details = object(body.details);
    if (typeof caption !== "string" || caption.length > 500 || !["followers", "public"].includes(String(audience)) ||
        (duration !== null && (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0 || duration > 86400))) {
      throw new RequestError(400, "Invalid Reel details.");
    }
    const incoming = roles.map(role => `incoming/${user.id}/${reel}/${ticket}/${role}`);
    const paths = roles.map(role => `${user.id}/${reel}/s3/${generation}/${role}`);
    const entries = await Promise.all(incoming.map(Key => s3.send(new HeadObjectCommand({ Bucket: bucket, Key }))));
    if (!entries.every((entry, i) => entry.ETag && entry.ContentLength === media[roles[i]].size &&
        entry.ContentType === media[roles[i]].mime)) {
      throw new RequestError(409, "Upload verification failed. Try again.");
    }
    const copied: string[] = [];
    try {
      for (const [index, key] of incoming.entries()) {
        const target = "reels/" + paths[index];
        await s3.send(new CopyObjectCommand({
          Bucket: bucket, Key: target, CopySource: bucket + "/" + key, CopySourceIfMatch: entries[index].ETag,
        }));
        copied.push(target);
      }
    } catch (error) {
      await removeKeys(s3, bucket, copied).catch(() => {});
      throw error;
    }

    const backend = createClient(project, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, options);
    const { data: published, error } = await backend.rpc("publish_s3_reel", {
      target: reel, reel_owner: user.id, generation, caption_text: caption, reel_audience: audience, details,
      video_mime: media.video.mime, cover_mime: media.cover.mime, duration_seconds: duration,
    });
    if (error) {
      // Preserve the copies if the database result was uncertain.
      if (error.code && !error.code.startsWith("PGRST0")) await removeKeys(s3, bucket, copied).catch(() => {});
      throw error;
    }
    const unused = paths.filter(path => !(published as string[]).includes(path));
    await removeKeys(s3, bucket, [...incoming, ...unused.map(path => "reels/" + path)]).catch(() => {});
    return response({ paths: published });
  } catch (error) {
    if (error instanceof RequestError) return response({ error: error.message }, error.status);
    console.error("Reel storage request failed", error instanceof Error ? error.name : "backend error");
    return response({ error: "Could not complete the Reel storage request. Try again." }, 502);
  }
});
