import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Cache-Control": "no-store",
};

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return new Response(null, { status: 405, headers });
  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return new Response(null, { status: 401, headers });
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !key) return new Response(null, { status: 503, headers });
  const client = createClient(url, key, { auth: { persistSession: false } });
  const { data, error } = await client.auth.getUser(token);
  if (error || !data.user) return new Response(null, { status: 401, headers });
  const urls = (Deno.env.get("TURN_URLS") || "").split(",").map(item => item.trim()).filter(Boolean);
  const secret = Deno.env.get("TURN_SHARED_SECRET");
  if (!urls.length || !secret || urls.some(item => !/^turns?:[^\s]+$/i.test(item))) {
    return Response.json({ iceServers: [] }, { headers });
  }
  const encoder = new TextEncoder();
  const username = `${Math.floor(Date.now() / 1000) + 14400}:${data.user.id}`;
  const hmac = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const signed = await crypto.subtle.sign("HMAC", hmac, encoder.encode(username));
  const credential = btoa(String.fromCharCode(...new Uint8Array(signed)));
  return Response.json({ iceServers: [{ urls, username, credential }] }, { headers });
});
