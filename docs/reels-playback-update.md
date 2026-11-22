# Reels playback update

Reels now uses one playback controller for the open feed. It chooses the visible video, pauses the previous one, and rejects late playback completions after a swipe. A pause chosen by the viewer stays in effect when swiping away and returning within that feed, or when returning from a backgrounded browser tab.

The next five accessible Reels begin preparing as soon as the current card becomes active. Preparation also runs when autoplay needs a tap. Existing checks for sensitive content, private media, data saving and slow connections apply. Preparation never calls play on future cards or records views.

A loading indicator appears after 250 milliseconds of waiting. A wait lasting ten seconds offers Try again and Refresh Reels. Try again reloads the current video. Refresh Reels uses the existing feed refresh to fetch current media links. Returning to playback clears the loading or error message. Replacing the feed clears old observers, listeners and timers.

## Updating the app

1. Install `outputs/insta-alternative-smooth-reels-debug.apk` over the existing Android app.
2. Open Reels and swipe between several videos. Only the visible Reel should play.
3. Pause a Reel, swipe away, then return. It should stay paused until you press play.
4. Switch away from the app and return. Check that a manually paused video stays paused.
5. If a video fails to load, try Try again. Use Refresh Reels if a fresh video link is needed.

Is update ke liye Supabase mein SQL migration chalane ki zarurat nahi hai. Badlav client ke video player mein hain. Database ke tables, columns aur functions ke liye is release mein migration nahi hai.

The APK uses the same signing certificate as `insta-alternative-faster-media-debug.apk`. Its packaged playback files were checked against the workspace files. Physical-phone installation and network performance still need device verification.

## Comparison with the supplied Instagram APK

The supplied package identifies itself as Instagram 458.0.0.0.34. Its signature integrity check passed. Publisher identity was not independently established against a trusted reference certificate.

| Area | Evidence inspected in Instagram | Implementation in this app |
|---|---|---|
| Preparing upcoming content | `ClipsTabBackgroundPrefetchWorker.doWork` checks expiry, session availability, configuration and existing cache entries before fetching. | The existing next-five window now starts when a card becomes active and is cleared on leaving the feed or hiding the document. |
| Cache freshness | `ClipsOneCacheDataSource.BRf` includes cache TTL handling. The saved disassembly also reads delivery metadata. | Current media links come from the existing feed loader. Refresh Reels requests refreshed feed data when needed. |
| Errors | `HeroExoPlayer2EventListener` classifies loading errors and records retry and recovery diagnostics, including an expired-CDN-URL marker. These callbacks do not establish actual retry scheduling or URL renewal. | The viewer gets loading feedback, a retry action, and an explicit feed-refresh action. |
| Player transitions | Class inventories and selected lifecycle paths were inspected. Decompiling the large `X.06Po` player class exhausted the configured Java heap. | The single-player controller and late-promise guards are our own design, verified with regression tests and real browser playback. |

The Instagram findings come from static code inspection. The package was not run or logged into. Complete Reels analysis and ranking investigation remain unfinished. The user deferred ranking work to prioritize playback smoothness. Local evidence is retained under `research/instagram/` for resuming the investigation.

## Validation

All 271 workspace tests pass. Six focused playback regression tests cover late play completion, manual pause, delayed loading and timeout, muted autoplay fallback, access and visibility checks, and cleanup after replacing a feed.

A separate Chrome session used generated sample video through the app's Reels screen. It verified first-video playback, swipe handoff, manual pause after returning, error feedback and retry recovery. Browser JavaScript errors were absent. The screenshots and machine-readable results are retained in `outputs/reels-playback-validation/`.

Four old workspace test failures were corrected. The Home test expected an older layout. The recovery helper tests tried to access a module through the app bootstrap even though that module is excluded from the active UI. They now import the helper directly and keep their validation assertions.

No numerical speedup or full-video buffering guarantee was measured. Browser preload remains a hint, and large source videos or weak connections can still cause waiting.
