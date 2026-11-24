# Seven-day account deletion

Version 2 includes grace-period privacy and identity reservation in addition to account deletion in the app and admin dashboard. Use this version in place of the earlier bundle. Run these steps in the same Supabase project used by the app.

## Behavior

- Delete account asks for the signed-in account's username, UUID, or email plus password and explicit confirmation.
- The server verifies the password, records a seven-day deadline, and the app signs out with a waiting-period message.
- A successful fresh login before the deadline cancels the request. Restoring or refreshing the older session does not cancel it.
- After the deadline, a worker runs every minute, claims due requests, suspends access, removes active uploads from Supabase and S3, and removes the Auth account.
- Failed cleanup remains visible and retries after a ten-minute lease. Cleanup can therefore finish later than the exact deadline during service failures.
- The admin queue shows the deadline and days left. Delete instantly uses typed username confirmation and the existing admin authorization. Administrator accounts remain protected.
- Existing pending requests receive seven days from the migration's execution time.
- During the waiting period, the profile lookup returns an Account deleted placeholder to other users. Discovery, content visibility, messages authored by the account, and new signed-file access are restricted without deleting the stored records.
- Existing username, email, and any phone number already stored in Auth stay reserved. The account cannot change these identifiers during pending deletion, and another account cannot claim them.
- The phone reservation applies to a phone number that is already saved on the account. This change does not add a phone-number registration screen.
- Cancellation removes the temporary restrictions. Existing blocks and privacy settings still apply.
- Previously downloaded content and previously issued signed links can remain usable until their existing expiry. This flow cannot recall copies already downloaded by another user.
- This implements a grace period for the existing account and active-upload deletion flow. It does not change provider backup retention.

## Apply the source changes

The archive includes source files and a Git patch based on the footer-badge commit.

From the repository root, run:

```sh
git apply --check /path/to/seven-day-account-deletion/changes.patch
git apply /path/to/seven-day-account-deletion/changes.patch
```

If the check reports a conflict, merge the corresponding files from the archive's source folder into your current code. Do not overwrite unrelated work.

## Deploy the functions

Run from the repository root with the Supabase CLI signed in:

```sh
supabase functions deploy account-deletion --project-ref nbmxfsadqflsjlibxqor --no-verify-jwt
supabase functions deploy admin-user --project-ref nbmxfsadqflsjlibxqor --no-verify-jwt
```

Both functions authenticate inside their handlers. The scheduler uses the existing PUSH_WORKER_SECRET. User requests validate the Auth token and password. Admin deletion verifies dashboard admin access and typed confirmation.

The shared file supabase/functions/_shared/delete-account.ts must be present when deploying both functions.

Keep the existing project secrets used by web-push and admin-users configured. The SQL reads PUSH_WORKER_SECRET from Vault at execution time. No secret value needs to be pasted into the SQL or application code.

## Run the migration

Open the project's Supabase SQL Editor. Run these complete files in order, as two separate queries:

1. supabase/migrations/20261124000100_seven_day_account_deletion.sql
2. supabase/migrations/20261124000200_deletion_grace_privacy.sql

The first sets up the seven-day deadline, login cancellation, and worker. The second sets up the identity reservation, profile placeholder, and visibility policies. Both are safe to replay. If you already ran the first migration from the earlier bundle, run the second next. It requires the existing account_deletion_requests migration, pg_cron, pg_net, Vault, and the PUSH_WORKER_SECRET Vault entry already used by the push worker.

Then publish the updated web app and rebuild/install the Android app using your existing release process. This bundle does not contain a newly built APK.

## Verify

Use disposable accounts for these checks.

1. Enter a wrong password when requesting deletion. The request must fail.
2. Request deletion with correct credentials. Confirm the waiting message and the admin deadline/countdown.
3. Before cancellation, use a second account to verify the profile placeholder and unavailable media. Confirm that new registrations cannot claim the same identifiers. Verify that the originals are still present using an administrator.
4. Log in again before the deadline. The account should remain available and the request should become withdrawn.
5. With a separate disposable account, confirm that the worker processes a due request and removes both the account and active uploads. Do not shorten real users' grace periods.
6. Use Delete instantly on a disposable pending request and confirm the username.
7. Verify that an ordinary user cannot invoke the worker or administrator actions.

Inspect scheduling without revealing secrets:

```sql
select jobname, schedule, active
from cron.job
where jobname = 'insta-account-deletion-worker';

select status, count(*)
from public.account_deletion_requests
group by status;
```

The worker responds with the claimed and completed counts. If last_error is populated, inspect the function logs and storage configuration before retrying.

## Validation completed locally

- 291 JavaScript tests passed.
- Local PostgreSQL-compatible checks passed for migration replay, request permissions, deadlines, saved sessions, fresh-login cancellation, expired requests, worker leases, retries, migration replay, pending-identity reuse, privacy policies, stale-session writes, retained records, and visibility restoration.
- Live deployment, a real disposable-account deletion, and phone verification remain for the operator running these steps.
