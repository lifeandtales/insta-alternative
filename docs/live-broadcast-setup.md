# Live broadcast setup

The app currently uses **preview mode**, as requested. Go Live opens a clearly labelled UI preview; it does not open the camera, broadcast or notify followers.

The integration code is ready for a LiveKit-backed broadcast. It is **not activated on the live service yet**. Running the SQL alone does not activate video streaming.

## 1. Database

Run the complete file `supabase/migrations/20261119000200_live_broadcasts.sql` in the existing Supabase project's SQL Editor. It adds live sessions, follower notifications, access rules and session functions. It can be run again safely.

The host and accepted followers can access an active live. Blocked users and other accounts cannot join through the app. Viewers receive subscribe-only tokens. The broadcaster's camera and microphone are published; viewers' devices are not published.

## 2. LiveKit project

Create or use a LiveKit Cloud project (or an existing reachable LiveKit server). Copy its secure WebSocket URL, API key and API secret into **Supabase Edge Function secrets**:

| Secret name | Value |
| --- | --- |
| `LIVEKIT_URL` | Your project's `wss://…` URL |
| `LIVEKIT_API_KEY` | The API key from that same project |
| `LIVEKIT_API_SECRET` | Its matching API secret |

Keep the API secret on the server. Do not put it in app source, screenshots, GitHub or chat. No subscription is purchased by this update; service usage and plan limits belong to your LiveKit account.

## 3. Deploy the token function

Using the Supabase CLI connected to the existing project:

```sh
supabase functions deploy live-broadcast --no-verify-jwt
```

The function itself validates the Supabase bearer token with `auth.getUser`, then uses the caller's database permissions before issuing a short-lived LiveKit room token. The gateway flag above does not make broadcasts public.

The function reads Supabase's built-in `SUPABASE_URL` and `SUPABASE_ANON_KEY` secrets as well as the three LiveKit secrets above. It supports starting/joining a live and ending the host's room. It does not need your service-role key.

## 4. Enable the integration after setup

After completing the server setup, change `liveBroadcastMode` in `src/core/live-config.js` from `'preview'` to `'livekit'`, then rebuild the app. Keep preview mode until the real project is ready.

## 5. App and web

For the current preview, install `outputs/insta-alternative-live-preview.apk` over the existing Android app. After enabling LiveKit mode, build and install a fresh APK containing that configuration. The web changes need a separate GitHub push/Pages deployment.

Open Add Story → Go Live. Then press Go Live and allow camera/microphone access. Followers are notified only after publishing succeeds. Live broadcasts appear before normal Stories with a LIVE badge. Tap a live circle or the in-app notification to watch.

Notifications here are **inside the app**. This update does not add OS push notifications or background broadcasting. No recording or saved replay is created.

## 6. Real-account verification

Use an accepted follower account on a second device:

1. Start from Android and watch on web; reverse the direction too.
2. Confirm the LIVE circle is first, the notification opens the live, and audio/video play.
3. Verify mic/camera toggles, Leave, End live and permission-denied retry.
4. Check a non-follower cannot join. Test block/unfollow and a lost host connection.
5. Test Wi-Fi and mobile data separately with the configured LiveKit project.

The host sends a heartbeat every 15 seconds. A missing heartbeat makes the session unavailable after 90 seconds; app viewers check validity every 15 seconds. Brief stale indicators are therefore possible after a crash/network loss. Signed tokens expire for new joins after two minutes; access checks in an already-connected app are periodic. This is not a claim of instantaneous server-side revocation for a modified third-party client.

Local validation covers database permissions, expiry, token signatures and publish grants, plus browser UI with mocked LiveKit rooms. Real media transport and actual Android devices still need the configured-project test above.

References: [LiveKit media](https://docs.livekit.io/transport/media/), [tokens and grants](https://docs.livekit.io/frontends/reference/tokens-grants/), [room service API](https://docs.livekit.io/reference/other/roomservice-api/).
