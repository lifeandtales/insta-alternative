import {
    closeVideoFullscreen,
    endVideoHold,
    handleVideoTap,
    handleReelTap,
    toggleInlinePlayback,
    startVideoHold,
    updateSoundButton,
    canPlayInlineVideo,
    refreshReelPlayback,
} from './video.js';
import { state } from '../core/state.js';
import { findEntity } from '../data/entities.js';
import { canViewMedia } from '../core/social.js';
import { renderMedia } from '../components/post-card.js';
import { observePostVideos } from './video.js';

export function handleVideoExitClick(event) {
    if (event.target.closest(".video-fullscreen-exit")) {
        closeVideoFullscreen();
        return true;
    }
    return false;
}

export function handleVideoClick(event) {
    const mediaReveal = event.target.closest('[data-media-reveal]');
    if (mediaReveal) {
        const type = mediaReveal.dataset.entityType, id = Number(mediaReveal.dataset.mediaReveal);
        const entity = findEntity(type, id), wrapper = mediaReveal.closest('.sensitive-media');
        if (!entity || !wrapper || state.viewerAgeBand === 'minor' || !canViewMedia(entity)) return true;
        state.revealedMediaKeys.add(`${type}:${id}`);
        const parent = wrapper.parentElement;
        wrapper.outerHTML = renderMedia(entity, wrapper.dataset.mediaClass || 'post-image', type);
        observePostVideos(parent);
        return true;
    }
    const reveal = event.target.closest('[data-reel-reveal]');
    if (reveal) {
        const id = Number(reveal.dataset.reelReveal);
        const entity = findEntity('reel', id);
        if (state.viewerAgeBand === 'minor' || !canViewMedia(entity)) return true;
        state.revealedMediaKeys.add(`reel:${id}`);
        const card = reveal.closest('.reel-card');
        card.classList.remove('reel-gated');
        card.querySelector('.reel-content-warning')?.remove();
        refreshReelPlayback();
        return true;
    }
    const playButton = event.target.closest('[data-reel-play]');
    if (playButton) {
        const video = playButton.closest('.reel-media')?.querySelector('video');
        if (video && event.detail === 0) toggleInlinePlayback(video);
        else if (video) handleReelTap(video);
        return true;
    }
    const reelFeed = event.target.closest('.reels-feed');
    if (reelFeed && !event.target.closest('a, button, input, .post-user, .reel-content-warning, [data-reel-header]')) {
        const bounds = reelFeed.getBoundingClientRect();
        // Keep the heading area out of the gesture target even between cards.
        if (event.clientY < bounds.top + 42) return false;
        let card = event.target.closest('.reel-card');
        if (!card) {
            const middle = bounds.top + bounds.height / 2;
            card = Array.from(reelFeed.children).find(item => {
                const rect = item.getBoundingClientRect();
                return rect.top <= middle && rect.bottom > middle;
            });
        }
        const video = card?.querySelector('video');
        if (video) {
            event.preventDefault();
            handleReelTap(video);
            return true;
        }
    }
    const tappedVideo = event.target.closest("video");
    if (tappedVideo?.closest(".likeable-media")) {
        if (tappedVideo.closest('.reel-card')) return true;
        event.preventDefault();
        handleVideoTap(tappedVideo);
        return true;
    }
    return false;
}

export function handleMediaSoundClick(event) {
    const storySoundButton = event.target.closest(".story-sound-toggle");
    if (storySoundButton) {
        const video = document.querySelector(".story-viewer-stage video");
        if (!video)
            return true;
        if (!canPlayInlineVideo(video)) return true;
        video.muted = !video.muted;
        updateSoundButton(storySoundButton, video.muted, "story");
        return true;
    }
    const postSoundButton = event.target.closest("[data-video-sound]");
    if (postSoundButton) {
        const reel = postSoundButton.closest(".reel-card");
        const video = (reel || postSoundButton.closest(".likeable-media"))?.querySelector("video");
        if (!video)
            return true;
        if (!canPlayInlineVideo(video)) return true;
        if (video.dataset.originalAudioMuted === 'true') return true;
        video.muted = !video.muted;
        if (reel) {
            state.reelMuted = video.muted;
            document.querySelectorAll('.reel-card').forEach(card => {
                const other = card.querySelector('video');
                if (!other || other.dataset.originalAudioMuted === 'true') return;
                other.muted = state.reelMuted;
                const control = card.querySelector('[data-video-sound]');
                if (control) updateSoundButton(control, other.muted, 'video');
            });
        } else {
            updateSoundButton(postSoundButton, video.muted, "video");
            if (!video.muted && video.paused) video.play().catch(() => {});
        }
        return true;
    }
    return false;
}

export function registerVideoPointerEvents() {
    document.addEventListener("pointerdown", (event) => {
        if (event.button !== 0)
            return;
        const video = event.target.closest("video");
        if (video?.closest(".likeable-media") && !video.closest('.reel-card'))
            startVideoHold(video);
    });
    document.addEventListener("pointerup", endVideoHold);
    document.addEventListener("pointercancel", endVideoHold);
}
