import { createClient } from "npm:@supabase/supabase-js@2";
import { S3Client, CopyObjectCommand, DeleteObjectsCommand, GetObjectCommand, HeadObjectCommand } from "npm:@aws-sdk/client-s3@3";
import { createPresignedPost } from "npm:@aws-sdk/s3-presigned-post@3";
import { getSignedUrl } from "npm:@aws-sdk/s3-request-presigner@3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const names = ["post-images", "app-media", "avatars", "chat-attachments"];
const buckets: Record<string, string> = Object.fromEntries(
  ["post-photos", "post-videos", "stories", "profile-photos", "messages"].map(purpose =>
    [purpose, `lifeandtales-${purpose}-156275915028-ap-southeast-2-an`]),
);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
type Json = Record<string, unknown>;
class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
function reply(body: unknown, status = 200) {
  return Response.json(body, { status, headers: { ...cors, "Cache-Control": "no-store" } });
}
function pathName(value: unknown) {
  if (typeof value !== "string" || value.length > 240 || !/^[a-zA-Z0-9_/.-]+$/.test(value) ||
      value.split("/").some(part => !part || part === "." || part === "..")) {
    throw new RequestError(400, "Invalid media path.");
  }
  return value;
}
function pathsFrom(value: unknown) {
  if (!Array.isArray(value) || value.length > 50) throw new RequestError(400, "Invalid media list.");
  return [...new Set(value.map(pathName))];
}
function mediaSpec(body: Json, namespace: string, path: string) {
  const media = body.media as Json | undefined;
  const mime = media?.mime;
  const size = media?.size;
  const image = typeof mime === "string" && /^image\/(jpeg|png|webp|gif|avif|heic|heif)$/.test(mime);
  const video = typeof mime === "string" && /^video\/(mp4|webm|quicktime|x-m4v|3gpp|ogg|mpeg|x-msvideo)$/.test(mime);
  const audio = typeof mime === "string" && /^audio\/(mpeg|mp3|mp4|aac|wav|x-wav|webm|ogg|flac)$/.test(mime);
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 ||
      size > (namespace === "avatars" ? 10_000_000 : 50_000_000) ||
      !(namespace === "chat-attachments" ? typeof mime === "string" && /^[a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+$/.test(mime) : namespace === "avatars" ? image : namespace === "post-images" ? image || video : image || video || audio) ||
      (namespace !== "chat-attachments" && audio && path.split("/")[2] !== "soundtrack")) {
    throw new RequestError(400, "Unsupported media type or size.");
  }
  return { mime: mime as string, size, category: namespace === "chat-attachments" ? "messages" : namespace === "avatars" ? "profile-photos" :
    namespace === "app-media" ? "stories" : video ? "post-videos" : "post-photos" };
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });
  if (req.method !== "POST") return reply({ error: "Method not allowed." }, 405);
  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization?.startsWith("Bearer ")) throw new RequestError(401, "Sign in to manage media.");
    const project = Deno.env.get("SUPABASE_URL")!;
    const viewer = createClient(project, Deno.env.get("SUPABASE_ANON_KEY")!, {
      ...options, global: { headers: { Authorization: authorization } },
    });
    const { data: { user }, error: authError } = await viewer.auth.getUser();
    if (authError || !user) throw new RequestError(401, "Sign in to manage media.");
    const raw = await req.text();
    if (raw.length > 20000) throw new RequestError(413, "Media request is too large.");
    let body: Json;
    try { body = JSON.parse(raw); } catch { throw new RequestError(400, "Invalid media request."); }
    if (!body || typeof body !== "object" || Array.isArray(body) || !names.includes(String(body.namespace))) {
      throw new RequestError(400, "Invalid media namespace.");
    }
    const namespace = String(body.namespace);
    const accessKeyId = Deno.env.get("REEL_S3_ACCESS_KEY_ID");
    const secretAccessKey = Deno.env.get("REEL_S3_SECRET_ACCESS_KEY");
    if (!accessKeyId || !secretAccessKey) throw new RequestError(503, "Media storage is not configured.");
    const s3 = new S3Client({ region: "ap-southeast-2", credentials: {
      accessKeyId, secretAccessKey, sessionToken: Deno.env.get("REEL_S3_SESSION_TOKEN"),
    } });
    const backend = createClient(project, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, options);

    if (body.action === "read") {
      const paths = pathsFrom(body.paths);
      const { data, error } = await viewer.from("s3_media_objects")
        .select("path,category,object_key").eq("namespace", namespace).in("path", paths).eq("delete_requested", false);
      if (error) throw error;
      const expiresIn = typeof body.expiresIn === "number" ? Math.min(3600, Math.max(60, Math.floor(body.expiresIn))) : 300;
      const urls = await Promise.all(data.map(async row => ({ path: row.path,
        signedUrl: await getSignedUrl(s3, new GetObjectCommand({ Bucket: buckets[row.category], Key: row.object_key }), { expiresIn }),
      })));
      // Missing paths may be older Supabase uploads. Authorization there remains enforced by Storage RLS.
      return reply({ urls, legacy: paths.filter(path => !data.some(row => row.path === path)) });
    }

    if (body.action === "delete") {
      const paths = pathsFrom(body.paths);
      if (paths.some(path => path.split("/")[namespace === "chat-attachments" ? 1 : 0] !== user.id)) throw new RequestError(403, "You can only remove your own media.");
      const { data, error } = await viewer.rpc("request_s3_media_cleanup", { media_namespace: namespace, media_paths: paths });
      if (error) throw error;
      const { data: known, error: knownError } = await backend.from("s3_media_objects").select("path")
        .eq("namespace", namespace).eq("owner_id", user.id).in("path", paths);
      if (knownError) throw knownError;
      let filesRemoved = true;
      for (const category of Object.keys(buckets)) {
        const rows = data.filter(row => row.category === category);
        if (!rows.length) continue;
        try {
          const result = await s3.send(new DeleteObjectsCommand({ Bucket: buckets[category],
            Delete: { Objects: rows.map(row => ({ Key: row.object_key })), Quiet: true },
          }));
          const failed = new Set((result.Errors || []).map(item => item.Key));
          if (failed.size) filesRemoved = false;
          const removed = rows.filter(row => !failed.has(row.object_key)).map(row => row.path);
          if (removed.length) {
            const cleared = await backend.from("s3_media_objects").delete().eq("namespace", namespace)
              .eq("owner_id", user.id).eq("delete_requested", true).in("path", removed);
            if (cleared.error) filesRemoved = false;
          }
        } catch { filesRemoved = false; }
      }
      if (known.some(row => !data.some(item => item.path === row.path))) filesRemoved = false;
      return reply({ filesRemoved, legacy: paths.filter(path => !known.some(row => row.path === path)) });
    }

    if (!["prepare", "complete"].includes(String(body.action))) throw new RequestError(400, "Unknown media action.");
    const path = pathName(body.path);
    if (path.split("/")[namespace === "chat-attachments" ? 1 : 0] !== user.id) throw new RequestError(403, "You can only upload your own media.");
    if (namespace === "chat-attachments") {
      const allowed = await viewer.rpc("can_upload_s3_chat_attachment", { media_path: path });
      if (allowed.error || !allowed.data) throw new RequestError(403, "This conversation is unavailable.");
    }
    const media = mediaSpec(body, namespace, path);
    const Bucket = buckets[media.category];
    const { data: existing, error: lookupError } = await backend.from("s3_media_objects")
      .select("path").eq("namespace", namespace).eq("path", path).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) {
      if (body.action === "prepare") return reply({ exists: true });
      throw new RequestError(409, "File already uploaded.");
    }
    if (body.action === "prepare") {
      const ticket = crypto.randomUUID();
      const upload = await createPresignedPost(s3, {
        Bucket, Key: `incoming/${user.id}/${ticket}`,
        Fields: { "Content-Type": media.mime, "x-amz-meta-path": path, "x-amz-meta-namespace": namespace },
        Conditions: [["eq", "$Content-Type", media.mime], ["eq", "$x-amz-meta-path", path],
          ["eq", "$x-amz-meta-namespace", namespace], ["content-length-range", media.size, media.size]],
        Expires: 600,
      });
      return reply({ ticket, upload });
    }
    if (typeof body.ticket !== "string" || !uuid.test(body.ticket)) throw new RequestError(400, "Invalid upload ticket.");
    const source = `incoming/${user.id}/${body.ticket}`;
    const staged = await s3.send(new HeadObjectCommand({ Bucket, Key: source }));
    if (!staged.ETag || staged.ContentLength !== media.size || staged.ContentType !== media.mime ||
        staged.Metadata?.path !== path || staged.Metadata?.namespace !== namespace) {
      throw new RequestError(409, "Upload verification failed. Try again.");
    }
    const object_key = `media/${user.id}/${crypto.randomUUID()}`;
    await s3.send(new CopyObjectCommand({ Bucket, Key: object_key, CopySource: Bucket + "/" + source,
      CopySourceIfMatch: staged.ETag, MetadataDirective: "REPLACE", Metadata: {}, ContentType: media.mime,
    }));
    const registered = await backend.from("s3_media_objects").insert({ namespace, path, owner_id: user.id,
      category: media.category, object_key, mime_type: media.mime, byte_size: media.size });
    if (registered.error) {
      // Lost DB responses may follow a committed insert; preserve immutable media in that case.
      if (registered.error.code && !registered.error.code.startsWith("PGRST0")) {
        await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: [{ Key: object_key }] } })).catch(() => {});
      }
      throw registered.error;
    }
    await s3.send(new DeleteObjectsCommand({ Bucket, Delete: { Objects: [{ Key: source }] } })).catch(() => {});
    return reply({ path });
  } catch (error) {
    if (error instanceof RequestError) return reply({ error: error.message }, error.status);
    console.error("Media storage request failed", error instanceof Error ? error.name : "backend error");
    return reply({ error: "Could not complete the media storage request. Try again." }, 502);
  }
});
