# Life and Tales media storage

Region: `ap-southeast-2`. AWS account: `156275915028`.

| Media | Private S3 bucket |
| --- | --- |
| Reels | `reeldatatatata` |
| Post photos and video cover images | `lifeandtales-post-photos-156275915028-ap-southeast-2-an` |
| Post videos | `lifeandtales-post-videos-156275915028-ap-southeast-2-an` |
| Stories, Story audio and Highlight covers | `lifeandtales-stories-156275915028-ap-southeast-2-an` |
| Profile photos | `lifeandtales-profile-photos-156275915028-ap-southeast-2-an` |
| Directly uploaded message attachments | `lifeandtales-messages-156275915028-ap-southeast-2-an` |
| S3 server access logs | `lifeandtales-storage-logs-156275915028-ap-southeast-2-an` |

Shared post, Reel and Story messages retain references to the original content; they do not copy the original into the messages bucket. Chat text stays in Supabase.

## Applied AWS configuration

The six new account-regional buckets have Block Public Access, ACLs disabled, SSE-S3 encryption with SSE-C blocked, versioning, ABAC and HTTPS-only policies. Five media buckets permit signed POST uploads and GET/HEAD playback from the GitHub Pages origin and Android asset origin. Their server access logging targets the logs bucket. The existing Reels bucket was not reconfigured in this change.

Automatic expiration of files, versions and logs was not applied. Automatic approval review rejected destructive retention rules; no workaround was used. With versioning enabled, object deletion creates a delete marker; historical versions are retained. Log retention and permanent version cleanup require an explicit retention decision.

The backend IAM user now has the reviewed, scoped policy in `aws-media-backend-policy.json`. Its former account-wide `ReelStorageAccess` attachment was detached from this user; the managed policy itself was not modified. Backups are in `aws-policy-backups/`. Custom policy simulation allows object read/write/delete within app prefixes and denies unrelated resources and bucket deletion. Principal simulation also reported an Organizations restriction, so runtime access with the deployed backend credentials still needs a real upload test.

## Architecture

Supabase keeps users, messages, post metadata, Story relationships and RLS. No AWS credentials ship in the frontend. `media-storage` validates the logged-in user through Supabase Auth, gives a short-lived size- and MIME-bound presigned POST, verifies the completed upload, and copies it into an immutable final key before registering it. Reads are signed only after viewer-scoped database access checks.

The registry supports legacy Supabase files alongside new S3 objects. Cleanup checks that an object is no longer referenced, marks cleanup pending, deletes the S3 key and clears the registry only after success. Failed cleanup stays pending; there is no scheduled cleanup worker in this change. Shared Story deletion never removes original media.

Limits remain 50 MB for posts, Stories and chat files, and 10 MB for profile photos.

## Deployment still required

1. Run `supabase/migrations/20261121000700_s3_media_storage.sql` in the existing project. This is additional to the Reels migration already run.
2. Deploy `supabase/functions/media-storage/index.ts` as `media-storage`. The function verifies its own user JWT; use legacy gateway JWT verification OFF. Reuse the existing server-side `REEL_S3_ACCESS_KEY_ID`, `REEL_S3_SECRET_ACCESS_KEY`, and optional session-token secrets. Do not paste keys into source code.
3. Only after both succeed, release the prepared web and Android frontend changes.
4. Verify one upload and cross-account playback for a photo post, video post, Story, avatar and message attachment. Check that an outsider cannot read private media or chat files. Confirm actual runtime IAM access, not only policy simulation.

Do not remove old Supabase uploads: this change does not migrate or erase them.

## Validation

247 application and endpoint tests passed, including route selection, login and ownership checks, immutable upload verification, signed read authorization and failed cleanup. PGlite tests passed both fresh/previous-image-schema upgrade paths, migration reruns, private-account/follower access, Story/audio publishing, attachment participants and expiry, and cleanup protection. Android debug APK builds and its signature verifies. Live media-function deployment and real S3 transfer tests remain pending.
