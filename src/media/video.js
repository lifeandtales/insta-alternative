import { showShareFeedback } from '../components/feedback.js';
import { videoFullscreenBackdrop, videoFullscreenStage } from '../core/dom.js';
import { state } from '../core/state.js';
import { doubleTapLike } from '../features/likes.js';
import { openProfileMedia } from '../features/profile.js';
import { reels as reelItems } from '../data/sample-data.js';
import { findEntity } from '../data/entities.js';
import { canViewMedia, mediaNeedsWarning } from '../core/social.js';

export function canPlayInlineVideo(video) {
    if (state.deletionRequestedAt || !video || video.closest('.reel-gated')) return false;
    const media = video.closest('.likeable-media');
    if (!media?.dataset?.likeableId) return true;
    const type = media.dataset.likeableType || 'post';
    const entity = findEntity(type, Number(media.dataset.likeableId));
    return Boolean(entity && canViewMedia(entity) && (!mediaNeedsWarning(entity) || state.revealedMediaKeys.has(`${type}:${entity.id}`)));
}

export function observePostVideos(container) {
    if (!postVideoObserver)
        return;
    container.querySelectorAll(".likeable-media video").forEach((video) => {
        const card = video.closest('.reel-card');
        if (card && !video.dataset.watchTracked) {
            video.dataset.watchTracked = 'true'; video.muted = state.reelMuted;
            let lastMediaTime = video.currentTime || 0;
            const button = card.querySelector('[data-reel-play]');
            const updatePlaybackControl = () => {
                card.dataset.paused = String(video.paused);
                if (button) { button.textContent = video.paused ? '▶' : 'Ⅱ'; button.setAttribute('aria-label', video.paused ? 'Play reel' : 'Pause reel'); }
            };
            updatePlaybackControl();
            video.addEventListener('pause', updatePlaybackControl);
            video.addEventListener('playing', () => {
                updatePlaybackControl(); lastMediaTime = video.currentTime;
                document.querySelectorAll('.reel-card video').forEach(other => { if (other !== video) other.pause(); });
                const id = Number(card.dataset.reelId), item = reelItems.find(value => value.id === id);
                if (item && !state.reelViewedIds.has(id)) { state.reelViewedIds.add(id); item.views = (item.views || 0) + 1; }
            });
            video.addEventListener('timeupdate', () => {
                const elapsed = video.currentTime - lastMediaTime; lastMediaTime = video.currentTime;
                // Seeking and loop resets are not watch time.
                if (!video.paused && !video.seeking && elapsed > 0 && elapsed <= 2) {
                    const item = reelItems.find(value => value.id === Number(card.dataset.reelId));
                    if (item) item.watchTimeSeconds = (item.watchTimeSeconds ?? (item.views || 0) * 4) + elapsed;
                }
            });
        }
        postVideoObserver.observe(video);
    });
}

export function updateSoundButton(button, muted, subject) {
    button.textContent = muted ? "🔇" : "🔊";
    button.setAttribute("aria-label", `Turn ${subject} sound ${muted ? "on" : "off"}`);
    button.setAttribute("aria-pressed", String(!muted));
}

export function openVideoFullscreen(video) {
    if (state.fullscreenVideo || !video?.isConnected || !canPlayInlineVideo(video))
        return;
    const wrapper = video.closest(".likeable-media");
    if (!wrapper)
        return;
    state.fullscreenVideo = video;
    state.fullscreenVideoWasPlaying = !video.paused && !video.ended;
    state.fullscreenVideoWrapper = wrapper;
    state.fullscreenVideoOriginalParent = wrapper.parentElement;
    state.fullscreenVideoOriginalNextSibling = wrapper.nextSibling;
    videoFullscreenStage.replaceChildren(wrapper);
    videoFullscreenBackdrop.hidden = false;
    document.body.classList.add("video-fullscreen-open");
    if (state.fullscreenVideoWasPlaying) {
        video.play().catch((error) => {
            if (error.name !== "AbortError")
                showShareFeedback("This video couldn't continue in fullscreen.");
        });
    }
    document.querySelector(".video-fullscreen-exit").focus();
}

export function closeVideoFullscreen() {
    if (!state.fullscreenVideoWrapper || !state.fullscreenVideoOriginalParent)
        return;
    const video = state.fullscreenVideo;
    const shouldResume = video && !video.paused && !video.ended;
    if (state.fullscreenVideoOriginalNextSibling?.parentElement === state.fullscreenVideoOriginalParent) {
        state.fullscreenVideoOriginalParent.insertBefore(state.fullscreenVideoWrapper, state.fullscreenVideoOriginalNextSibling);
    }
    else {
        state.fullscreenVideoOriginalParent.append(state.fullscreenVideoWrapper);
    }
    videoFullscreenBackdrop.hidden = true;
    videoFullscreenStage.replaceChildren();
    document.body.classList.remove("video-fullscreen-open");
    state.fullscreenVideo = null;
    state.fullscreenVideoWasPlaying = false;
    state.fullscreenVideoWrapper = null;
    state.fullscreenVideoOriginalParent = null;
    state.fullscreenVideoOriginalNextSibling = null;
    if (shouldResume) {
        video.play().catch((error) => {
            if (error.name !== "AbortError")
                showShareFeedback("This video couldn't resume inline.");
        });
    }
    video?.focus();
}

export function toggleFullscreenVideoPlayback() {
    if (!state.fullscreenVideo || !canPlayInlineVideo(state.fullscreenVideo))
        return;
    if (state.fullscreenVideo.paused) {
        state.fullscreenVideo.play().catch((error) => {
            if (error.name !== "AbortError")
                showShareFeedback("This video couldn't resume.");
        });
    }
    else {
        state.fullscreenVideo.pause();
    }
}

export function handleVideoTap(video) {
    if (!canPlayInlineVideo(video)) return;
    if (state.suppressNextVideoClick) {
        state.suppressNextVideoClick = false;
        return;
    }
    if (state.fullscreenVideo === video) {
        toggleFullscreenVideoPlayback();
        return;
    }
    if (state.pendingVideoTap?.video === video) {
        clearTimeout(state.pendingVideoTap.timer);
        state.pendingVideoTap = null;
        doubleTapLike(video.closest(".likeable-media"));
        return;
    }
    if (state.pendingVideoTap)
        clearTimeout(state.pendingVideoTap.timer);
    if (video.closest('.reel-card') && video.paused) {
        toggleInlinePlayback(video);
        state.pendingVideoTap = { video, timer: window.setTimeout(() => { state.pendingVideoTap = null; }, 320) };
        return;
    }
    const timer = window.setTimeout(() => {
        state.pendingVideoTap = null;
        if (video.closest('.reel-card')) {
            toggleInlinePlayback(video);
            return;
        }
        const exploreTile = video.closest(".explore-thumbnail");
        if (exploreTile)
            openProfileMedia("post", Number(exploreTile.dataset.id), exploreTile);
        else
            openVideoFullscreen(video);
    }, 320);
    state.pendingVideoTap = { video, timer };
}

export function toggleInlinePlayback(video) {
    if (!canPlayInlineVideo(video)) return;
    if (video.paused) video.play().catch(() => showShareFeedback('Tap the play button to start this Reel on your device.'));
    else video.pause();
}

export function startVideoHold(video) {
    if (!canPlayInlineVideo(video)) return;
    if (!video.closest(".likeable-media") || state.fullscreenVideo === video)
        return;
    clearTimeout(state.videoHoldTimer);
    state.heldVideo = null;
    state.heldVideoWasPlaying = false;
    state.videoHoldTimer = window.setTimeout(() => {
        state.heldVideo = video;
        state.heldVideoWasPlaying = !video.paused && !video.ended;
        video.pause();
    }, 180);
}

export function endVideoHold() {
    clearTimeout(state.videoHoldTimer);
    state.videoHoldTimer = 0;
    if (!state.heldVideo)
        return;
    const video = state.heldVideo;
    const shouldResume = state.heldVideoWasPlaying;
    state.heldVideo = null;
    state.heldVideoWasPlaying = false;
    state.suppressNextVideoClick = true;
    window.setTimeout(() => { state.suppressNextVideoClick = false; }, 500);
    if (shouldResume && canPlayInlineVideo(video)) {
        video.play().catch((error) => {
            if (error.name !== "AbortError")
                showShareFeedback("This video couldn't resume.");
        });
    }
}
let postVideoObserver = null;

export function initializeVideoObserver() {
    postVideoObserver = "IntersectionObserver" in window
        ? new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
                const video = entry.target;
                if (entry.isIntersecting && entry.intersectionRatio >= 0.6) {
                    if (!canPlayInlineVideo(video)) { video.pause(); return; }
                    if (!video.closest('.reel-card')) video.muted = true;
                    video.play().catch((error) => {
                        if (error.name !== "AbortError")
                            showShareFeedback(video.closest('.reel-card') ? "Autoplay with sound was blocked. Tap the Reel to play." : "This video couldn't autoplay. Tap play to watch it.");
                    });

                }
                else if (video !== state.fullscreenVideo) {
                    video.pause();
                }
            });
        }, { threshold: 0.6 })
        : null;
}

