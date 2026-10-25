# insta

A lightweight Instagram-inspired social media app built with plain HTML, CSS, and JavaScript. On mobile-sized screens, the app opens with a centered logo on a grey splash screen for one second.

## Project structure

The application uses native JavaScript modules, with no frontend framework or build step.

- `app.js` — startup and ordered event registration.
- `src/core/` — navigation, DOM references, shared session state, and utilities.
- `src/features/` — Home, Explore, Reels, Messages, Profile, Stories, Highlights, and interaction logic. Matching `.events.js` files connect user actions to each feature.
- `src/components/` — reusable post cards and feedback messages.
- `src/media/` — video playback, fullscreen, sound, and pointer controls.
- `src/data/` — sample content and entity lookup.
- `src/storage/` — localStorage and IndexedDB access.
- `styles/` — ordered stylesheets, loaded through `styles.css`.
- `tests/` — application behavior and module integration checks.

See [the developer guide](docs/architecture.md) for feature ownership, startup flow, editing guidance, and current limitations.

## Run locally

From this folder:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

Serve the folder over HTTP; native JavaScript modules need a web server. Refresh the preview after editing. This project does not yet include automatic live reload.

## Verify changes

With Node.js 20 or newer installed, run:

```bash
npm test
```

No package installation is required. Tests use Node's built-in test runner and its experimental VM module loader. They check module startup, all five screens, feed filtering, browser storage, chat composition, comments, likes, and click dispatch. They use a small DOM substitute; inspect layout, media playback, uploads, and browser dialogs in the live preview too.

## Features

- Compact, centered Home insta branding and a Stories shelf with timed image/video viewing and swipe navigation
- Device photo/video picker for stories, story scheduling, removal, and story reply/archive preferences
- Continuous story viewing across followed accounts
- Create menu for publishing photo/video posts and video reels from selected gallery media
- Profile "+ post" flow to select media, confirm a post or reel, and publish into the matching profile section
- Newly uploaded posts and reels appear first in the Home feed; public uploads also appear in Explore or Reels
- Autoplaying post videos with per-video sound controls
- Compact like counts on Home feed posts that open a people-who-liked dialog with the precise total (liker profiles are representative sample data)
- Add image or video stories, or share your own, followed, and public posts to your story
- Home feed includes followed-account posts and reels, sorted newest by upload time
- Explore grid of public photo and video posts, excluding reels
- Explore public posts in a randomized three-column thumbnail grid; open a post to see its details and interactions
- Search Explore for people by username/display name, public-post hashtags, locations, and communities
- Browse curated sample communities, view their public posts, and join/leave; memberships persist in browser storage
- Follow accounts, hashtags, and communities from search or profile/community pages to see their posts and reels in Home, ordered newest by upload time; these update follows reset when the app is reopened
- Post comment previews with followed/follower comments prioritized in previews and blurred, likeable comment dialogs
- Double-tap-to-like support for post photos/videos and reels
- Single-tap video playback in a fullscreen viewer, tap-to-pause/resume, inline press-and-hold pause, and fullscreen exit control; video actions remain in the post options menu rather than native download controls
- Like and comment controls on public reels, with the same full comments dialog as posts
- Post author links, post download/copy-link/report menu, and a friend picker for sharing
- Reels feed limited to public reels
- Messages inbox with chat histories, text replies, shared posts/reels, demo voice/video call history, and chat options for pinning, muting, unread status, or opening a profile
- Profile page with Posts, Reels, Saved, and Tags sections, three-column media-only grids, a Home-only notifications shortcut, and profile settings shortcut
- Open profile posts, reels, and saved media in a continuous, scrollable detail view with feed interactions; Saved is shown only on the signed-in user's profile and displays media thumbnails without labels
- Edit the signed-in user's profile posts and reels from the detail viewer, including captions and locations, or delete them with confirmation
- Stories expire after 24 hours. Highlights can be saved from active stories, labeled with up to 10 characters, and opened as story sequences; the story viewer menu can add its current story directly
- Manage owned highlights from their viewer: edit the label and stories, delete with confirmation, archive/restore privately, or share with accounts the signed-in user follows
- Story highlights and their media are stored in browser IndexedDB and remain on the profile after the original story expires; public profile highlights are visible to everyone, while private profile highlights are limited to followers and the owner
- Like toggling, author profile links, post download/copy-link/report options, and friend-picker sharing
- Save posts and reels to a browser-persisted collection in the signed-in profile's Saved section
- Clean three-column profile media grids with posts displayed as thumbnails
- Responsive layout for desktop and mobile
- Phone-shaped 9:16 app viewport across screen sizes; Reels snap one complete reel into view per scroll
- Clean, modern UI inspired by social apps
- One-second mobile splash screen

The app currently uses sample data in `src/data/sample-data.js`; it is a front-end prototype and is not connected to real accounts, posts, follows, communities, or conversations. Chat history and actions are demo-only and remain in memory for the current page session; call buttons add a call entry rather than connecting a real call. Communities are curated sample groups, and joining is stored locally in this browser; memberships are not shared with other users. Search-based follows of accounts, hashtags, and communities last for the current app session only. Highlight sharing uses the existing demo share dialog and does not deliver messages to other users. Saved item IDs and joined community IDs are stored in browser local storage; active stories (until they expire) and story highlights with their media are stored in browser IndexedDB. Uploaded posts, reels, story settings, and scheduled uploads are held in memory, and browser-managed storage can be cleared by the user or browser. Visibility follows the demo account's `isPrivate` setting and sample follow relationships (public by default). The browser asks the device to select media, and the app receives only the chosen file rather than broad gallery access; this prototype does not sync data between different devices or browser profiles.
