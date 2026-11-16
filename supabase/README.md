# Supabase setup for Insta Alternative

The browser client in `src/storage/supabase.js` is configured for this project's public Supabase endpoint. Login and account creation use Supabase Auth. Posts, stories, and chats still use device-local storage scoped to each authenticated account.

## Apply the migration

From the workspace root, with a Supabase CLI session that has access to the project:

```sh
supabase init
supabase login
supabase link --project-ref nbmxfsadqflsjlibxqor
supabase db push --dry-run
supabase db push
```

Run `supabase init` once to generate the local CLI configuration.

For a fresh project, the dashboard SQL Editor is also an option. Open a new query and run the entire `migrations/20261111000100_insta_alternative_setup.sql` file. Use one deployment method. The CLI keeps a migration history when it applies migrations, whereas running SQL in the editor does not automatically record those files there.

## What this sets up

- Supabase Auth users can create their own profile. The signed-in profile directory contains usernames, display names and bios.
- `open_direct_chat(other_user)` creates or returns the conversation for two profile IDs.
- Conversation members can read messages and send as themselves. `hidden_messages` supports hiding a message for one viewer.
- The private `chat-attachments` bucket uses paths of the form `<conversation-id>/<sender-id>/<unique-filename>`. Upload as the sender, then insert a message with its object path. Participants can download shared objects. The bucket limit is 50 MB for compatibility with Supabase Free.
- The Realtime publication includes messages. Row Level Security controls which message inserts a signed-in subscriber can receive.

The migration covers direct chats. Group chats, account blocking, moderation, automatic retention, posts, Reels and Stories need additional backend work. Existing browser data stays local. Keep elevated keys in server-only environments.

## First connection check

From the app's browser console on the local preview:

```js
const { getSupabaseClient } = await import('./src/storage/supabase.js');
const supabase = await getSupabaseClient();
const { data, error } = await supabase.auth.getSession();
console.log({ signedIn: Boolean(data?.session), error });
```

For a data test, sign in two test accounts with Supabase Auth and insert each account's own profile. From either account, call `supabase.rpc('open_direct_chat', { other_user: otherProfileId })`. Verify that both participants can read the conversation and that a third signed-in account sees zero rows. Also verify the third account cannot download a private attachment.

## Email confirmation

In Supabase Authentication → URL Configuration, add `https://lifeandtales.github.io/insta-alternative/` to Redirect URLs. On Android, confirm the email in a browser, then return to the app and sign in.

## Image posts

For an existing project that already has the account and chat schema, run only
`migrations/20261112000100_image_posts.sql` in the SQL Editor. For a fresh project,
run the initial setup file first. The image-post migration creates the
`image_posts` table and private `post-images` bucket. Signed-in accounts can
publish and reload their own image-only posts. Scheduled posts, videos and Reels
continue to use local storage.

## Full app schema

For the connected project, run `migrations/20261112000200_app_backend.sql` in
one SQL Editor query. It assumes the initial accounts/chat setup is already
applied and includes the image-post setup, whether or not that separate
migration was applied. It leaves existing image posts in their current table.

The new schema includes media posts, Reels and Stories, group chats,
attachments, reactions, per-viewer chat preferences, follows and blocks,
comments and saved media, highlights, drafts, communities, notifications, and
reports. Storage buckets are private and the SQL sets authenticated access
policies. The migration does not seed any demo data.

The existing Free-compatible chat and media buckets cap each file at 50 MB.
The schema records the 24-hour expiry for chat attachments above 200 MB when
the project and bucket support uploads that large. Policies stop access on
expiry. Removing expired objects from Storage requires a scheduled server
cleanup. UI integration for the new tables, notification delivery, and
moderation workflows are separate from this migration.

## Connected Social

Apply `20261116000200_connected_social.sql` after the combined app backend and
Explore People migrations. Then use two accounts to verify mutual following,
follower lists, Home image posts, profile photos and direct text messages.
Public image posts are visible to signed-in viewers. Private image posts and
avatars are restricted to their owner and accepted followers. Direct text
sending requires mutual following. A chat appears in the recipient's inbox
after the first message. Reels reads published public video rows from
`media_content`; older device-only media and chats are not uploaded.

## Activate in-app calling

1. In Supabase SQL Editor, run the `20261116000700_in_app_calls.sql` migration after the Connected Chat Controls migration.
2. Install the new Android APK or serve the new web build over HTTPS. Open Insta Alternative on both devices, sign in with different connected accounts, open the chat, and grant microphone or camera access when prompted.
3. Call from the upper-right Voice or Video button. On the other device choose **Accept**. Verify that both devices can hear each other, then repeat with video and test **Decline** and **End call**.

## TURN relay

The default STUN server supports direct media connections when both networks permit them. For networks that require relaying, configure a TURN service that supports shared-secret (TURN REST) credentials. Set these values as Supabase Edge Function secrets:

- `TURN_URLS` with the provider's comma-separated TURN URLs
- `TURN_SHARED_SECRET` with the provider's shared secret

From the linked Supabase project root, deploy the `call-ice` Edge Function.

```sh
supabase functions deploy call-ice --no-verify-jwt
```

The function validates the caller's Supabase access token before issuing short-lived credentials. Keep the shared secret in the Edge Function environment.

Calls are scoped to an open app. Android background and lock-screen ringing will need the native push setup separately. Connected chat attachments use the existing 50 MB Storage bucket limit.
