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

## Browser push notifications

1. Run `migrations/20261112000300_web_push.sql` after the full app schema.
2. Generate a VAPID key pair once, for example with
   `npx web-push@3.6.7 generate-vapid-keys`. Configure the Edge Function secrets
   `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (a `mailto:` contact),
   and `PUSH_WORKER_SECRET` (a random shared secret). Keep the private values in
   Supabase secrets and Vault.
3. Deploy with `supabase functions deploy web-push --no-verify-jwt`. The
   function exposes only the VAPID public key on GET and checks the separate
   worker secret on POST. Configure Supabase Cron to POST to
   `/functions/v1/web-push` every minute with
   `Authorization: Bearer <PUSH_WORKER_SECRET>`, pulled from Vault.
4. On the deployed HTTPS web app, sign in and open **Profile → Settings →
   Push notifications → Enable on this browser**. Test with a second account
   by inserting a chat message via the authenticated Supabase API, then check
   that the notification appears on the subscribed browser.

The chat trigger runs on Supabase message inserts. Device-local messages do
not reach this trigger. The packaged Android WebView requires a native push
integration, such as Firebase Cloud Messaging.

## Android push notifications

1. Run `migrations/20261112000400_android_push.sql` after the browser-push migration.
2. In Firebase Console, add an Android app with package name
   `com.lifeandtales.instaalternative`. Save its `google-services.json` in
   `android/google-services.json`. The file is ignored by Git.
3. Add the Firebase service-account JSON to the Supabase Edge Function secret
   `FIREBASE_SERVICE_ACCOUNT`. The account needs permission to send FCM HTTP v1
   messages. Keep the service-account key in Supabase secrets.
4. Deploy the updated worker using the browser-push instructions. Android-only
   delivery requires the worker secret and Firebase credentials. VAPID keys
   are needed for browser delivery.
5. Open the `android/` folder as a Gradle project in Android Studio with API
   36 installed, sync, and run the app on a Google Play-enabled emulator.
   Open **Profile → Settings → Push notifications → Enable on this device**.

The direct SDK build script still produces the WebView preview without
Firebase. The Gradle build includes the Android Firebase integration.

## Admin dashboard

1. Run `20261112000500_admin_dashboard.sql`, then
   `20261112000600_admin_users.sql`. Grant the app account access in SQL Editor
   by adding its Auth user ID to `app_private.admin_members`.
2. Deploy account controls with
   `supabase functions deploy admin-users --no-verify-jwt`. The function checks
   the caller with Supabase Auth and enforces the database admin role on every
   request. It uses the project's built-in service credential on the server.
3. Serve the web app over HTTP for local testing or HTTPS for a public
   deployment. Open `admin.html`, sign in and select **Users**.

Suspending an account blocks sign-in until restored. Existing sessions can
persist under Supabase Auth. Permanent deletion removes the Auth account and
cascading database records. If Supabase rejects deletion because the user owns
Storage objects, handle those objects in Supabase Storage and retry. Activity
only includes records synced to the cloud.

## Connected Social

Apply `20261116000200_connected_social.sql` after the combined app backend and
Explore People migrations. Then use two accounts to verify mutual following,
follower lists, Home image posts, profile photos and direct text messages.
Public image posts are visible to signed-in viewers. Private image posts and
avatars are restricted to their owner and accepted followers. Direct text
sending requires mutual following. A chat appears in the recipient's inbox
after the first message. Reels reads published public video rows from
`media_content`; older device-only media and chats are not uploaded.
