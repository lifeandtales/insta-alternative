import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Cache-Control": "no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
const denied = () => reply({ error: "Invalid username or password." }, 401);
const unavailable = () => reply({ error: "Username login is temporarily unavailable." }, 503);
const auth = { persistSession: false, autoRefreshToken: false };
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply({}, 405);
  const body = await request.json().catch(() => null);
  if (typeof body?.username !== "string" || typeof body.password !== "string" ||
      !/^[a-z0-9._]{3,30}$/.test(body.username) || !body.password || body.password.length > 4096) return denied();
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), anon = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key || !anon) return unavailable();
  try {
    const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 128);
    const encoder = new TextEncoder();
    const hashKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const hash = new Uint8Array(await crypto.subtle.sign("HMAC", hashKey, encoder.encode(ip)));
    const requestKey = Array.from(hash, value => value.toString(16).padStart(2, "0")).join("");
    const lookup = await createClient(url, key, { auth }).rpc("resolve_username_login", { handle: body.username, request_key: requestKey });
    if (lookup.error) return unavailable();
    if (!lookup.data) return denied();
    const result = await createClient(url, anon, { auth }).auth.signInWithPassword({ email: lookup.data, password: body.password });
    if (!result.data.session) return denied();
    return reply({ access_token: result.data.session.access_token, refresh_token: result.data.session.refresh_token });
  } catch { return unavailable(); }
});
