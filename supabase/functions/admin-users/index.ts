import { S3Client, DeleteObjectsCommand } from "npm:@aws-sdk/client-s3@3";
import { createClient } from "npm:@supabase/supabase-js@2.119.0";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Cache-Control": "no-store",
};

function response(status: number, message: string) {
  return Response.json({ message }, { status, headers: cors });
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method !== "POST") return response(405, "Method not allowed.");

  const token = request.headers.get("Authorization")?.match(/^Bearer (\S+)$/i)?.[1];
  if (!token) return response(401, "Sign in again to continue.");

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) return response(503, "Account controls are unavailable.");

  const auth = { persistSession: false, autoRefreshToken: false };
  const caller = createClient(url, anonKey, { auth, global: { headers: { Authorization: `Bearer ${token}` } } });
  const { data: identity, error: identityError } = await caller.auth.getUser(token);
  if (identityError || !identity.user) return response(401, "Sign in again to continue.");

  const body = await request.json().catch(() => null);
  const action = body?.action;
  const uuid = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;
  if (!["suspend", "restore", "delete", "approve_deletion", "reject_deletion"].includes(action)) {
    return response(400, "Choose a valid account action.");
  }
  let target = body?.target;
  let requestId = body?.request_id;
  if (action === "approve_deletion" || action === "reject_deletion") {
    if (typeof requestId !== "string" || !uuid.test(requestId)) return response(400, "Choose a valid deletion request.");
    const requests = await caller.rpc("admin_deletion_requests");
    if (requests.error) return response(403, "Admin access required.");
    const entry = requests.data.find(item => item.id === requestId);
    if (!entry) return response(404, "Request not found. Refresh the queue.");
    target = entry.user_id;
    if (action === "reject_deletion" || (entry.status === "processing" && !target)) {
      const result = await caller.rpc("admin_decide_account_deletion", {
        request_id: requestId, decision: action === "reject_deletion" ? "reject" : "approve", note: String(body.note || "").slice(0,1000),
      });
      if (result.error) return response(409, "Could not review this request. Refresh its status.");
      return response(200, action === "reject_deletion" ? "Deletion request rejected." : "Account deletion completed.");
    }
  }
  if (typeof target !== "string" || !uuid.test(target)) return response(400, "Choose a valid account.");
  const { data: detail, error: accessError } = await caller.rpc("admin_user_details", { target });
  if (accessError?.code === "42501") return response(403, "Admin access required.");
  if (accessError?.code === "P0002") return response(404, "Account not found.");
  if (accessError || !detail?.account) return response(503, "Could not verify account access.");
  if (detail.account.id === identity.user.id || detail.account.is_admin) return response(403, "Admin accounts are protected.");
  const server = createClient(url, serviceKey, { auth });
  if (action === "suspend" || action === "restore") {
    if (action === "restore") {
      const pending = await server.from("account_deletion_requests").select("id").eq("user_id",target).eq("status","processing");
      if (pending.error) return response(503,"Could not verify account status.");
      if (pending.data.length) return response(409,"Deletion has started. Retry deletion instead of restoring the account.");
    }
    const { error } = await server.auth.admin.updateUserById(target, { ban_duration: action === "suspend" ? "876000h" : "none" });
    return response(error ? 409 : 200, error ? "Could not update the account. Try again." : action === "suspend" ? "Account suspended." : "Account restored.");
  }
  if (body.confirmation !== (detail.account.username || detail.account.email)) {
    return response(400, "Type the account username to confirm deletion.");
  }
  const decision = action === "approve_deletion"
    ? await caller.rpc("admin_decide_account_deletion", {request_id:requestId,decision:"approve",note:String(body.note || "").slice(0,1000)})
    : await caller.rpc("admin_start_account_deletion", {target,deletion_reason:"Admin account deletion"});
  if (decision.error) return response(409,"Could not approve deletion. Refresh the account and try again.");
  if (action === "delete") requestId = decision.data;
  try {
    const suspended = await server.auth.admin.updateUserById(target,{ban_duration:"876000h"});
    if (suspended.error) throw suspended.error;
    const inventory = await server.rpc("account_deletion_storage_inventory",{target});
    if (inventory.error) throw inventory.error;
    const owned = inventory.data;
    for (const bucket of new Set(owned.supabase.map(item=>item.bucket))) {
      const paths = owned.supabase.filter(item=>item.bucket===bucket).map(item=>item.path);
      for (let start=0;start<paths.length;start+=100) {
        const removed=await server.storage.from(bucket as string).remove(paths.slice(start,start+100));
        if (removed.error) throw removed.error;
      }
    }
    if (owned.s3.length) {
      const accessKeyId=Deno.env.get("REEL_S3_ACCESS_KEY_ID"),secretAccessKey=Deno.env.get("REEL_S3_SECRET_ACCESS_KEY");
      if (!accessKeyId || !secretAccessKey) throw new Error("S3 cleanup is not configured");
      const s3=new S3Client({region:Deno.env.get("REEL_S3_REGION") || "ap-southeast-2",credentials:{accessKeyId,secretAccessKey,sessionToken:Deno.env.get("REEL_S3_SESSION_TOKEN")}});
      for (const category of new Set(owned.s3.map(item=>item.category))) {
        const Bucket=category==="reels" ? Deno.env.get("REEL_S3_BUCKET") : `lifeandtales-${category}-156275915028-ap-southeast-2-an`;
        if (!Bucket || !["reels","post-photos","post-videos","stories","profile-photos","messages"].includes(category as string)) throw new Error("Invalid storage category");
        const keys=[...new Set(owned.s3.filter(item=>item.category===category).map(item=>item.key))];
        const prefix=(category==="reels" ? "reels/" : "media/")+target+"/";
        if (keys.some(key=>!(key as string).startsWith(prefix))) throw new Error("Invalid object ownership");
        for (let start=0;start<keys.length;start+=1000) {
          const removed=await s3.send(new DeleteObjectsCommand({Bucket,Delete:{Objects:keys.slice(start,start+1000).map(Key=>({Key:Key as string})),Quiet:true}}));
          if (removed.Errors?.length) throw new Error("S3 cleanup incomplete");
        }
      }
    }
    const deleted=await server.auth.admin.deleteUser(target);
    if (deleted.error) throw deleted.error;
    const saved=await server.from("account_deletion_requests").update({status:"completed",last_error:null})
      .eq("id",requestId).eq("status","processing");
    if (saved.error) return response(200,"Account removed. Refresh the deletion queue to confirm its final status.");
    await server.from("reel_s3_deletions").delete().eq("owner_id",target);
    return response(200,"Account and active uploads deleted.");
  } catch {
    await server.from("account_deletion_requests").update({last_error:"Deletion did not finish. Retry to complete storage cleanup and account removal."}).eq("id",requestId).eq("status","processing");
    return response(409,"Deletion did not finish. The account is suspended; retry deletion to complete cleanup.");
  }
});
