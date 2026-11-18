import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const encoder = new TextEncoder();
const base64url = (data: Uint8Array) => btoa(String.fromCharCode(...data)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
async function signToken(key: string, secret: string, claims: Record<string, unknown>) {
  const encode = (value: unknown) => base64url(encoder.encode(JSON.stringify(value)));
  const now = Math.floor(Date.now() / 1000);
  const body = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({ iss: key, nbf: now - 5, exp: now + 120, ...claims });
  const signingKey = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return body + "." + base64url(new Uint8Array(await crypto.subtle.sign("HMAC", signingKey, encoder.encode(body))));
}
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const bearer = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!bearer) return json({ error: "Login required" }, 401);
  const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !anon) return json({ error: "Server is not configured" }, 503);
  const client = createClient(url, anon, { global: { headers: { Authorization: "Bearer " + bearer } }, auth: { persistSession: false } });
  const auth = await client.auth.getUser(bearer);
  if (auth.error || !auth.data.user) return json({ error: "Login required" }, 401);
  let input;
  try { input = await request.json(); } catch { return json({ error: "Invalid request" }, 400); }
  if (!input || !["start", "join", "end"].includes(input.action)) return json({ error: "Invalid action" }, 400);
  const server = Deno.env.get("LIVEKIT_URL"), apiKey = Deno.env.get("LIVEKIT_API_KEY"), secret = Deno.env.get("LIVEKIT_API_SECRET");
  if (!server || !/^wss:\/\/[^\s/?#]+\/?$/.test(server) || !apiKey || !secret) return json({ error: "Live streaming is not configured yet. Complete the LiveKit setup." }, 503);
  const user = auth.data.user;
  try {
    let id = input.id;
    if (input.action === "start") {
      const created = await client.rpc("create_live_broadcast");
      if (created.error) throw created.error;
      id = created.data;
    }
    if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json({ error: "Invalid broadcast" }, 400);
    const { data: session, error } = await client.from("live_broadcasts").select("id,host_id,status,expires_at").eq("id", id).maybeSingle();
    if (error) throw error;
    if (!session) return json({ error: "This live is unavailable or you no longer have access." }, 403);
    const host = session.host_id === user.id, room = "live-" + id;
    if (input.action === "end") {
      if (!host) return json({ error: "Only the broadcaster can end this live." }, 403);
      const ended = await client.rpc("end_live_broadcast", { target: id });
      if (ended.error) throw ended.error;
      const admin = await signToken(apiKey, secret, { sub: user.id, video: { room, roomCreate: true } });
      const response = await fetch(server.replace(/^wss:/, "https:").replace(/\/$/, "") + "/twirp/livekit.RoomService/DeleteRoom", {
        method: "POST", headers: { Authorization: "Bearer " + admin, "Content-Type": "application/json" }, body: JSON.stringify({ room }), signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      // The database denies new joins immediately. Clients also check session validity while watching.
      return json({ ended: true, roomClosed: Boolean(response && (response.ok || response.status === 404)) });
    }
    if (session.status === "ended" || Date.parse(session.expires_at) <= Date.now() || (!host && session.status !== "live")) return json({ error: "This live has ended." }, 410);
    const token = await signToken(apiKey, secret, { sub: user.id + ":" + crypto.randomUUID(),
      video: { roomJoin: true, room, canPublish: host, canPublishData: false, canSubscribe: true } });
    return json({ id, host, url: server, token });
  } catch (error) {
    const code = (error as { code?: string }).code;
    return json({ error: code === "23505" ? "You already have a live open. End it before starting another." : "Could not prepare this live. Check the migration and connection." }, code === "23505" ? 409 : 500);
  }
});
