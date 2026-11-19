# Signup field checks

This update checks each signup field while typing (after a short pause) and immediately when leaving that field. It does not wait for Create account.

- Email: invalid format in red; existing email in red; format valid and available in green.
- Username: length/character rules and server availability. Green does not reserve a username; the database still enforces uniqueness at signup/profile creation.
- Display name: local length/required feedback. Display names can be shared by different users.
- Create password: at least eight characters, without whitespace.
- Confirm password: matches the current password; changing the password updates this result too.
- Login email receives format feedback only; no account availability lookup is needed for login.

Passwords and display names are **not sent to the availability endpoint**. Only the field name and email/username are sent. An availability check does not create an account or send email. Green email feedback does not prove that a mailbox exists or belongs to the person; that requires email confirmation through Supabase Auth.

## Enable server checks

1. Run `supabase/migrations/20261119000300_signup_availability.sql` in the existing project's SQL Editor.
2. In Supabase → Edge Functions, deploy the source in `supabase/functions/signup-availability/index.ts` as **signup-availability**. You can use the dashboard's code editor.
3. This endpoint is intentionally usable before login. Disable the gateway's legacy JWT verification for this function. Alternatively, use the CLI:

```sh
supabase functions deploy signup-availability --no-verify-jwt
```

The function reads the built-in `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` server secrets. Do not copy the service-role key into the app or chat. No third-party account is required.

The database lookup function is executable by the service role only, not by anonymous or signed-in clients directly. The endpoint returns only `available`, `taken`, `invalid` or `limited`; it does not expose account records. Rate limits are 60 checks per IP-derived key per minute and 1,000 checks globally per minute. The stored rate-limit key is a server-key HMAC of the IP, not the raw IP or email. Gateway/proxy forwarding headers must remain trusted; the global limit also bounds requests if IP attribution is unavailable or unreliable.

4. Install `outputs/insta-alternative-live-signup-checks.apk`. Web needs a separate publish.
5. Test an existing email by leaving the email field, then check an available username, a taken username and password matching. These checks should happen without pressing Create account.

If the function/migration is not deployed or the connection fails, the form says it could not check availability. It does not show a false green result. Signup itself still uses Supabase Auth and the profile uniqueness constraint as the final authority.

Under-18 design and restriction changes are not part of this update.
