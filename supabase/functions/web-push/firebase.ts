type FirebaseAccount = { project_id: string; client_email: string; private_key: string };
const tokenUrl = "https://oauth2.googleapis.com/token";
let cached: { accessToken: string; expiresAt: number } | undefined;
let refreshing: Promise<string> | undefined;

function base64Url(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function mintToken(account: FirebaseAccount) {
  const encoder = new TextEncoder();
  const now = Math.floor(Date.now() / 1000);
  const encode = (value: unknown) => base64Url(encoder.encode(JSON.stringify(value)));
  const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: tokenUrl,
    iat: now,
    exp: now + 3600,
  })}`;
  const pem = account.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "");
  const bytes = Uint8Array.from(atob(pem), char => char.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", bytes, {
    name: "RSASSA-PKCS1-v1_5", hash: "SHA-256",
  }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(unsigned));
  const response = await fetch(tokenUrl, {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(new Uint8Array(signature))}`,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Firebase authentication failed");
  const data = await response.json();
  if (typeof data.access_token !== "string") throw new Error("Firebase returned no access token");
  cached = { accessToken: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 };
  return cached.accessToken;
}

function accessToken(account: FirebaseAccount) {
  if (cached && cached.expiresAt > Date.now() + 60000) return Promise.resolve(cached.accessToken);
  refreshing ??= mintToken(account).finally(() => { refreshing = undefined; });
  return refreshing;
}

export async function sendAndroidPush(token: string, body: string, notificationId: string, replyTicket?: string, title = "Insta Alternative", avatarUrl?: string) {
  const secret = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (!secret) throw new Error("Firebase credentials are unavailable");
  const account: FirebaseAccount = JSON.parse(secret);
  if (!/^[a-z0-9-]+$/.test(account.project_id)) throw new Error("Invalid Firebase project ID");
  const authorization = await accessToken(account);
  const response = await fetch(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${authorization}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message: {
      token,
      ...(replyTicket
        ? { data: { body, title, tag: notificationId, replyTicket, ...(avatarUrl ? { avatarUrl } : {}) }, android: { ttl: "300s", priority: "high" } }
        : { notification: { title, body },
            android: { ttl: "300s", notification: { channel_id: "insta_messages", tag: notificationId } } }),
    } }),
    signal: AbortSignal.timeout(8000),
  });
  if (response.ok) return "sent";
  const result = await response.json().catch(() => null);
  if (result?.error?.details?.some((detail: { errorCode?: string }) => detail.errorCode === "UNREGISTERED")) return "expired";
  throw new Error("Firebase delivery failed");
}
