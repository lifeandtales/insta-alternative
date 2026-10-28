import {
    closeVideoFullscreen,
    endVideoHold,
    handleVideoTap,
    startVideoHold,
    updateSoundButton,
    canPlayInlineVideo,
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
        card.querySelector('video')?.play().catch(() => {});
        return true;
    }
    const playButton = event.target.closest('[data-reel-play]');
    if (playButton) {
        if (playButton.closest('.reel-gated')) return true;
        const video = playButton.closest('.reel-media')?.querySelector('video');
        if (video) handleVideoTap(video);
        return true;
    }
    const tappedVideo = event.target.closest("video");
    if (tappedVideo?.closest(".likeable-media")) {
        if (tappedVideo.closest('.reel-gated')) return true;
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
        const video = postSoundButton.closest(".likeable-media").querySelector("video");
        if (!video)
            return true;
        if (!canPlayInlineVideo(video)) return true;
        if (video.dataset.originalAudioMuted === 'true') return true;
        video.muted = !video.muted;
        if (video.closest('.reel-card')) state.reelMuted = video.muted;
        updateSoundButton(postSoundButton, video.muted, "video");
        if (!video.muted && video.paused) video.play().catch(() => {});
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
