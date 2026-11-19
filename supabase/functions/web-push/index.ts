import { sendAndroidPush } from './firebase.ts';
import { createClient } from "npm:@supabase/supabase-js@2.119.0";
import webPush from "npm:web-push@3.6.7";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, OPTIONS" };
const allowedHosts = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com", "notify.windows.com"];
const env = (key: string) => Deno.env.get(key) || "";

function trustedEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.port && !url.username && !url.password
      && allowedHosts.some(host => url.hostname === host || url.hostname.endsWith("." + host));
  } catch {
    return false;
  }
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });
  if (request.method === "GET") {
    const publicKey = env("VAPID_PUBLIC_KEY");
    return Response.json({ publicKey }, { headers: cors, status: publicKey ? 200 : 503 });
  }
  if (request.method !== "POST") return new Response(null, { status: 405 });
  // Inline replies authenticate with a single-use ticket scoped to one device and chat.
  if (new URL(request.url).pathname.endsWith("/reply")) {
    try {
      const raw = await request.text();
      if (raw.length > 12000) return new Response(null, { status: 413 });
      const { ticket, text } = JSON.parse(raw);
      if (typeof ticket !== "string" || !/^[a-f0-9-]{36}$/i.test(ticket)
          || typeof text !== "string" || text.length > 1000 || !text.trim()) {
        return new Response(null, { status: 400 });
      }
      const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
      const { data, error } = await db.rpc("send_android_notification_reply", { ticket, reply_text: text });
      return new Response(null, { status: error ? 500 : data ? 204 : 403 });
    } catch { return new Response(null, { status: 400 }); }
  }
  const secret = env("PUSH_WORKER_SECRET");
  if (!secret || request.headers.get("Authorization") !== `Bearer ${secret}`) {
    return new Response(null, { status: 401 });
  }

  try {
    const webConfigured = Boolean(env("VAPID_SUBJECT") && env("VAPID_PUBLIC_KEY") && env("VAPID_PRIVATE_KEY"));
    if (webConfigured) webPush.setVapidDetails(env("VAPID_SUBJECT"), env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));
    const db = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: jobs, error } = await db.rpc("claim_web_push_batch");
    if (error) throw error;
    await Promise.all(jobs.map(async (job: {
      notification_id: string; recipient_id: string; kind: string; attempts: number;
    }) => {
      let retry = false;
      const copy: Record<string, string> = {
        chat_message: "You have a new message.",
        follow_request: "You have a new follow request.",
        follow_accepted: "Your follow request was accepted.",
        content_tag: "Someone tagged you.",
        content_mention: "Someone mentioned you.",
      };
      let body = copy[job.kind] || "You have a new notification.";
      let tag = job.notification_id;
      let title = "Insta Alternative";
      let avatarUrl: string | undefined;
      if (job.kind === "chat_message") {
        const { data: notice, error: noticeError } = await db.from("app_notifications")
          .select("payload").eq("id", job.notification_id).single();
        if (noticeError) throw noticeError;
        const payload = notice?.payload;
        if (typeof payload?.preview === "string" && payload.preview) body = payload.preview;
        if (typeof payload?.conversation_id === "string") tag = payload.conversation_id;
        if (typeof payload?.sender_id === "string") {
          const { data: sender } = await db.from("profiles")
            .select("display_name,avatar_path").eq("id", payload.sender_id).maybeSingle();
          if (sender?.display_name?.trim()) title = sender.display_name.trim().slice(0, 100);
          if (typeof sender?.avatar_path === "string" && sender.avatar_path.startsWith(payload.sender_id + "/")) {
            const { data: avatar } = await db.storage.from("avatars").createSignedUrl(sender.avatar_path, 300);
            avatarUrl = avatar?.signedUrl;
          }
        }
      }
      const { data: subscriptions, error: subscriptionError } = await db.from("web_push_subscriptions")
        .select("endpoint,p256dh,auth_secret").eq("user_id", job.recipient_id);
      if (subscriptionError) retry = true;
      for (const device of subscriptions || []) {
        if (!trustedEndpoint(device.endpoint)) continue;
        try {
          if (!webConfigured) throw new Error("Web Push credentials are unavailable");
          await webPush.sendNotification({
            endpoint: device.endpoint,
            keys: { p256dh: device.p256dh, auth: device.auth_secret },
          }, JSON.stringify({
            id: job.notification_id,
            body, tag,
          }), { TTL: 300, timeout: 8000 });
        } catch (error) {
          const status = (error as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await db.from("web_push_subscriptions").delete().eq("endpoint", device.endpoint).eq("user_id", job.recipient_id);
          } else {
            retry = true;
          }
        }
      }
      const { data: androidDevices, error: androidError } = await db.from("android_push_devices")
        .select("token,installation_id,supports_reply").eq("user_id", job.recipient_id);
      // The web-only migration can be deployed before the Android migration.
      if (androidError && androidError.code !== "PGRST205") retry = true;
      await Promise.all((androidDevices || []).map(async ({ token, installation_id, supports_reply }) => {
        try {
          let ticket: string | undefined;
          if (supports_reply && job.kind === "chat_message") {
            const issued = await db.rpc("issue_android_reply_ticket", { notice_id: job.notification_id, device_id: installation_id });
            ticket = issued.data || undefined;
          }
          if (await sendAndroidPush(token, body, tag, ticket, title, avatarUrl) === "expired") {
            await db.from("android_push_devices").delete().eq("token", token).eq("user_id", job.recipient_id);
          }
        } catch {
          retry = true;
        }
      }));
      const result = retry && job.attempts < 5
        ? await db.from("web_push_queue").update({
          available_at: new Date(Date.now() + Math.min(300, 15 * 2 ** job.attempts) * 1000).toISOString(),
        }).eq("notification_id", job.notification_id).eq("attempts", job.attempts)
        : await db.from("web_push_queue").delete().eq("notification_id", job.notification_id).eq("attempts", job.attempts);
      if (result.error) throw result.error;
    }));
    return Response.json({ claimed: jobs.length });
  } catch {
    return Response.json({ error: "Push dispatch failed." }, { status: 500 });
  }
});
