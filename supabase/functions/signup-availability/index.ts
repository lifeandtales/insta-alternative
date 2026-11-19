import { createClient } from "npm:@supabase/supabase-js@2.119.0";
const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Cache-Control": "no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });
Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  const text = await request.text();
  if (text.length > 1024) return reply({ error: "Request too large" }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return reply({ error: "Invalid request" }, 400); }
  if (!body || !["email", "username"].includes(body.field) || typeof body.value !== "string" || body.value.length > 254) return reply({ status: "invalid" }, 400);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return reply({ error: "Availability checks are not configured" }, 503);
  // Never accept a caller-supplied rate-limit key or return account records.
  const ip = (request.headers.get("x-forwarded-for") || "unknown").split(",")[0].trim().slice(0, 128);
  const encoder = new TextEncoder();
  const hashKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", hashKey, encoder.encode(ip)));
  const requestKey = Array.from(hash, value => value.toString(16).padStart(2, "0")).join("");
  const client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data, error } = await client.rpc("check_signup_availability", { field_name: body.field, field_value: body.value, request_key: requestKey });
    if (error) return reply({ error: "Could not check availability" }, 503);
    return reply({ status: data }, data === "limited" ? 429 : 200);
  } catch { return reply({ error: "Could not check availability" }, 503); }
});
