# Admin account management

## Included

The existing admin dashboard has Users, a deletion-request queue and Change my password. It uses the existing server-side admin membership; no new account is promoted and no credentials are hardcoded.

Change my password verifies the current session with Supabase Auth and updates only the current account. The user enters the new password in the form. The dashboard keeps its session open on success or failure so Android login can be checked before signing out. If Supabase requires recent reauthentication, the dashboard displays that requirement rather than bypassing it.

Ordinary users send deletion requests from account settings. Pending requests can be withdrawn. Admins can reject requests, approve them, or start deletion from Users. Deletion requires typing the target username. Admin accounts and self-deletion through admin controls are protected.

Approved deletion suspends sign-in, blocks new content and Storage writes, removes owned active Supabase and S3 objects, then deletes the Auth account and records completion. A cleanup failure leaves a processing request for retry and does not falsely report that the Auth account was deleted. S3 historical versions and unregistered staging objects are not purged by this workflow; existing storage-retention rules still apply. No real user was deleted during development or testing.

## Deployment

The existing dashboard was observed with Life and Tales already an active, confirmed admin. Keep that browser session signed in while checking the new password. The local server serves Android's generated web assets; `admin.html` is now included so rebuilding does not remove the dashboard page.

1. Existing installations with the admin dashboard/users migrations already applied need only `supabase/migrations/20261121000800_account_deletion_requests.sql`. For a fresh admin installation, apply `20261112000500_admin_dashboard.sql` and `20261112000600_admin_users.sql` first. These preserve existing memberships and do not grant admin to new accounts.
2. Deploy `supabase/functions/admin-users/index.ts` as `admin-users`. It verifies the caller's token with Auth, then checks the existing backend admin authorization before performing any account action. Use legacy gateway JWT verification OFF because token verification is inside the function.
3. Reuse the existing server-side Supabase secrets and S3 secrets. Do not put secrets into the frontend or chat.
4. Refresh the admin page. Check password changes only by entering credentials yourself. Test deletion using an explicitly disposable test account, not an existing real user.

The admin-users endpoint was not deployed when checked. New migration application, real deletion and password changes have not been verified live. Frontend/source publication alone does not deploy Supabase functions or SQL.

## Deferred

The user explicitly paused Forgot password/OTP. Its forms and handlers are excluded from this release. Draft files are retained locally under `outputs/otp-recovery-draft/`. No SMTP sender or email template was activated, and no recovery email was sent. Existing admin password change does not depend on that deferred feature, unless project Auth settings require email reauthentication.

## Validation

Application and endpoint tests cover normal-user rejection for direct admin actions, protected admins, typed confirmation, approval cleanup ordering, cleanup failure/retry and request rejection. Isolated PostgreSQL/PGlite checks cover user-owned request visibility, idempotent submissions, withdrawal, admin review, protected accounts, write/upload blocking during processing, inventory access restrictions and completing a request after account deletion. No live account deletion is part of these checks.


## Reported-content moderation

The dedicated moderation page is `admin-reports.html`, linked from the existing admin dashboard. It requires an existing admin membership on the server. Reports from cloud posts, Reels, Stories, profiles and a selected received chat message use `submit_content_report`. The normal app exposes only reporting and the user's own Settings → Reported activities. Reports on demo content remain explicitly local.

Submitting a complaint captures server-verified evidence and does not remove or restrict the target. Admins can start review, dismiss, warn, hide content, restrict a profile, or lift a restriction. Actions require an explanation and confirmation; decisions are recorded in an audit trail. A profile restriction hides the profile from others and its content, and blocks new posts and messages. These are reversible moderation controls, not account or file deletion. Reporter identity is excluded from admin review responses. Admin media access covers saved reported attachments, not arbitrary private files or chats. Existing signed URLs and downloaded bytes may remain available until expiry/refetch.

The report history shows the reporter their own reason, status, affected account and admin explanation, with pagination and an automatic refresh while its first page is open. The affected account receives moderation warnings or decisions through its existing notification history. Explanations are shared with the reporter and affected account, so they must not contain internal notes or another person's private information.

The migration `20261123103921_reported_content_moderation.sql` was applied to the existing production project after explicit user approval on 23 November 2026. Do not run it again. No new Edge Function or admin account is required. It reuses the deployed private-media services and existing admin membership. If a reporter deletes their account, the report's identity link is set to null while the complaint evidence and moderation audit remain; deleting the reporter cannot undo a restriction. Media bytes are not duplicated for evidence, so deleted/expired attachments may no longer be previewable. Older reports without verified evidence cannot be used to warn, hide or restrict a target.

The reporting APK is `outputs/insta-alternative-reporting-debug.apk`. Browser flow checks used simulated accounts/data, and database permission/action checks used isolated PostgreSQL/PGlite. No real user or content was moderated during verification. A live authenticated report/admin review and user phone feedback remain to be checked. For isolated database checks, install the pinned PGlite 0.3.14 runtime and run `tests/database/report-moderation.mjs` with `PGLITE_MODULE` pointing to its module, or make `@electric-sql/pglite` available to Node. Normal application tests run with the project's existing test command.


### Reported video preview correction

The user's first live test complaint reached the admin queue after reloading an already-open web app tab. Before reload, the old reporting code had saved a local report only; that local record was not a backend complaint. No report was submitted on the user's behalf.

A real reported video then exposed a media classification bug: image-post videos store their type under `items[].settings.type`, but evidence capture had checked `items[].type`. The corrective migration `20261123124316_report_media_preview_types.sql` prefers registered storage MIME metadata, then legacy object MIME metadata, and finally the nested item settings. It repairs existing attachment type metadata while retaining report text and attachment paths. This migration is already applied to production; do not run it again. No new APK is required for this server-side correction. The test complaint remains pending; no moderation decision was taken.

The isolated PostgreSQL tests reproduce the old video-as-photo classification, verify existing evidence repair from the registered storage MIME, and verify nested-settings detection for future legacy video reports. Admin UI video playback confirmation is separate from backend evidence verification.


## Complete report context and profile review (prepared, not applied)

The new migration `20261123124740_complete_admin_report_context.sql` is prepared for the user to run manually. Do not apply it automatically. The previous moderation and video-type migrations are already applied and must not be repeated.

The admin review now presents the saved reported item directly, with typed image/video/Reel/Story/chat attachments. Comments and replies have their own Report controls. Their server-verified text is accompanied by the related post, and replies retain their parent comment. If the original is removed, saved evidence and saved parent context remain available where the underlying media file still exists. Shared Stories resolve their source Reel/post assets with the source content ID; Story text/drawing/filter layers use the existing composition renderer. Story soundtrack assets have separate audio controls.

Admins can open the reported author's full profile, including private profile metadata and paginated Posts, Reels and Stories, from the report page. The Users page adds a View profile and content link to the admin review route. Every profile/context RPC checks existing admin membership on the server. No role is promoted. Admin private-media signing is expanded to registered account content; chat attachments remain limited to reported message evidence. Ordinary account privacy and viewer checks remain in force. No report automatically triggers a moderation action.

Deployment sequence: the user runs only the new migration, then the matching frontend can be published and app tabs reloaded. The new admin frontend needs the new context RPCs, so do not replace the working published admin page before the user confirms SQL application. The APK must be installed over the existing app to expose comment/reply reporting on Android. No new Edge Function or server secret is needed.

Local PostgreSQL checks cover comment visibility, parent post/reply linkage, private profile browsing restricted to admins, source-backed Stories, removed-comment evidence, and ordinary/anonymous denial. Browser checks with generated media and simulated accounts cover real image/video decoding, all report types, profile category switching, source Reel signing, normal-account denial and mobile layout. This does not establish authenticated production verification for the new migration.
