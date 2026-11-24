import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import { deleteAccountAndUploads } from "../_shared/delete-account.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Cache-Control": "no-store",
};
const reply = (status: number, body: unknown) => Response.json(body, { status, headers });
const auth = { persistSession: false, autoRefreshToken: false };

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply(405, { message: "Method not allowed." });
  const body = await request.json().catch(() => null);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return reply(503, { message: "Account deletion is unavailable." });
  const server = createClient(url, serviceKey, { auth });

  if (body?.action === "process_due") {
    const secret = Deno.env.get("PUSH_WORKER_SECRET");
    if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) return reply(401, {});
    const claimed = await server.rpc("claim_due_account_deletions");
    if (claimed.error) return reply(503, { message: "Could not read the deletion queue." });
    let completed = 0;
    for (const entry of claimed.data) {
      try {
        if (entry.user_id) {
          await deleteAccountAndUploads(server, entry.user_id, entry.id);
        } else {
          const saved = await server.from("account_deletion_requests")
            .update({ status: "completed", last_error: null }).eq("id", entry.id);
          if (saved.error) throw saved.error;
        }
        completed++;
      } catch {
        await server.from("account_deletion_requests")
          .update({ last_error: "Cleanup incomplete. The scheduled worker will retry." })
          .eq("id", entry.id).eq("status", "processing");
      }
    }
    return reply(200, { claimed: claimed.data.length, completed });
  }

  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token || body?.action !== "request") return reply(401, { message: "Sign in again." });
  const caller = createClient(url, anonKey, { auth, global: { headers: { Authorization: `Bearer ${token}` } } });
  const identity = await caller.auth.getUser(token);
  if (identity.error || !identity.data.user) return reply(401, { message: "Sign in again." });
  const user = identity.data.user;
  const identifier = typeof body.identifier === "string" ? body.identifier.trim().toLowerCase().replace(/^@/, "") : "";
  const profile = await server.from("profiles").select("username").eq("id", user.id).single();
  if (profile.error || !user.email || ![user.id.toLowerCase(), user.email.toLowerCase(), profile.data.username.toLowerCase()].includes(identifier)) {
    return reply(400, { message: "Enter your own username, user ID, or email." });
  }
  if (typeof body.password !== "string" || !body.password || body.password.length > 4096 || body.confirmed !== true) {
    return reply(400, { message: "Enter your password and confirm deletion." });
  }
  const verifier = createClient(url, anonKey, { auth });
  const verified = await verifier.auth.signInWithPassword({ email: user.email, password: body.password });
  if (verified.error || verified.data.user?.id !== user.id) return reply(401, { message: "The password is incorrect." });
  await verifier.auth.signOut({ scope: "local" });
  const result = await server.rpc("start_verified_account_deletion", {
    target: user.id, request_reason: String(body.reason || "").slice(0, 1000),
  });
  if (result.error) return reply(409, { message: "Could not request deletion. Try again." });
  return reply(200, result.data);
});
