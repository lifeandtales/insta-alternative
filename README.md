# Insta Alternative

Mobile-first browser prototype with Home, Explore, Reels, Messages, Profile, and Story editing.

## Preview

This is a frontend demo. Authentication, messaging, calls, verification, and scheduling are not connected to production services. Drafts and uploaded media remain in the current browser; they do not transfer between devices.

## Run locally

Run `python3 -m http.server 8000 --bind 127.0.0.1`, then open the local server.

## GitHub Pages

In repository Settings → Pages, select GitHub Actions as the build source. The included workflow tests and publishes the static app on pushes to main.

## Tests

Run `npm test` with a recent Node.js version.
