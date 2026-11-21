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
