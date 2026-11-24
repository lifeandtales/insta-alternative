import { S3Client, DeleteObjectsCommand } from "npm:@aws-sdk/client-s3@3";

export async function deleteAccountAndUploads(server: any, target: string, requestId: string) {
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
    if (saved.error) throw saved.error;
    await server.from("reel_s3_deletions").delete().eq("owner_id",target);
}
