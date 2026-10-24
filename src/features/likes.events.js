import { state } from '../core/state.js';
import { findEntity } from '../data/entities.js';
import { doubleTapLike, openLikers, setEntityLiked } from './likes.js';

export function handleLikeClick(event) {
    const likeButton = event.target.closest(".like-btn");
    if (likeButton) {
        const type = likeButton.dataset.entityType;
        const entity = findEntity(type, Number(likeButton.dataset.entityId));
        if (!entity)
            return true;
        setEntityLiked(type, entity, !entity.liked);
        return true;
    }
    return false;
}

export function handleLikersClick(event) {
    const likeCountButton = event.target.closest('[data-action="show-likers"]');
    if (likeCountButton) {
        const post = findEntity(likeCountButton.dataset.entityType, Number(likeCountButton.dataset.entityId));
        if (post)
            openLikers(post, likeCountButton);
        return true;
    }
    return false;
}

export function registerMediaLikeEvents() {
    document.addEventListener("dblclick", (event) => {
        const media = event.target.closest(".likeable-media");
        if (!media)
            return;
        if (media.querySelector("video")) {
            event.preventDefault();
            return;
        }
        event.preventDefault();
        doubleTapLike(media);
    });
    document.addEventListener("touchend", (event) => {
        const media = event.target.closest(".likeable-media");
        if (!media || media.querySelector("video"))
            return;
        const now = Date.now();
        if (state.previousTap.media === media && now - state.previousTap.time < 320) {
            event.preventDefault();
            state.previousTap = { media: null, time: 0 };
            doubleTapLike(media);
            return;
        }
        state.previousTap = { media, time: now };
    });
}
