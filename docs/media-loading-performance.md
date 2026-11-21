# Media loading improvements

The app warms the next five Reel cards after the current Reel starts playing. Each advance extends that window. Home posts warm media in the next ten cards as the visible card changes. Warming does not invoke playback, likes or view recording. Existing privacy and sensitive-content checks apply before prefetch. Explicit data-saving mode, slow/2G connections and hidden documents skip new prefetch work.

Video preload is a browser hint, not a guarantee of complete buffering. Large original uploads and connection throughput still affect playback. This release does not add a CDN, transcode videos or change S3 access permissions. Media URL signing now runs up to four batches of 50 paths concurrently, retaining legacy Supabase compatibility. Startup begins fetching posts without waiting for local Story restoration; API/CDN connections and the existing Auth SDK download can begin from the document head.

Validation: 261 application tests pass, including exact five-Reel and ten-post windows, overlap without duplicate video loads, exclusion of protected cards, no prefetch playback, data-saver behavior and a maximum of four parallel signing requests. No connected Android phone was available for a cold-start benchmark, so no numerical speedup is claimed.

Device check: install the updated APK over the existing app. Force-stop and reopen without clearing app data, open Home and scroll past ten posts, then play a Reel and swipe through six more. Check picture/video/audio and compare initial wait with later swipes on the same connection. Prefetch begins after current-Reel playback starts; it needs time and bandwidth to get ahead of swiping.
