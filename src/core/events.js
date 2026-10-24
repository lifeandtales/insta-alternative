import {
    commentsBackdrop,
    createMenuBackdrop,
    createUploadBackdrop,
    exploreSearchInput,
    exploreSearchResults,
    likersBackdrop,
    mediaDeleteBackdrop,
    mediaEditBackdrop,
    profilePostViewer,
    shareBackdrop,
    videoFullscreenBackdrop,
} from './dom.js';
import { state } from './state.js';
import { closeComments } from '../features/comments.js';
import { closeCreateMenu, closeCreateUpload } from '../features/create.js';
import { closeHighlightDeleteConfirmation, closeHighlightPicker } from '../features/highlights.js';
import { closeLikers } from '../features/likes.js';
import {
    closeMediaDeleteConfirmation,
    closeMediaEditor,
    closeProfileMedia,
    openProfileMedia,
} from '../features/profile.js';
import { closeShareDialog } from '../features/sharing.js';
import {
    closeStoryCreator,
    closeStorySettings,
    closeStoryViewer,
    showStoryAtIndex,
} from '../features/stories.js';
import { closeVideoFullscreen, handleVideoTap } from '../media/video.js';

export function dismissOpenMenus(event) {
    if (!event.target.closest(".post-options-wrap")) {
        document.querySelectorAll(".post-options-menu").forEach((menu) => { menu.hidden = true; });
        document.querySelectorAll('[data-action="post-options"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
    }
    if (!event.target.closest(".story-viewer-header") && !event.target.closest(".story-options-menu")) {
        document.querySelector(".story-options-menu").hidden = true;
        document.querySelector(".story-viewer .story-options-toggle").setAttribute("aria-expanded", "false");
    }
    return false;
}

export function registerKeyboardEvents() {
    document.addEventListener("keydown", (event) => {
        const exploreTile = event.target.closest?.(".explore-thumbnail");
        if (exploreTile && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            openProfileMedia("post", Number(exploreTile.dataset.id), exploreTile);
            return;
        }
        if (event.key === "Escape" && !exploreSearchResults.hidden) {
            exploreSearchResults.hidden = true;
            exploreSearchInput.setAttribute("aria-expanded", "false");
            return;
        }
        if ((event.key === "Enter" || event.key === " ") && event.target.matches("video") && event.target.closest(".likeable-media")) {
            event.preventDefault();
            handleVideoTap(event.target);
            return;
        }
        if (event.key === "Escape" && !videoFullscreenBackdrop.hidden) {
            closeVideoFullscreen();
            return;
        }
        if (event.key === "Escape" && !document.querySelector(".highlight-delete-backdrop").hidden) {
            closeHighlightDeleteConfirmation();
            return;
        }
        if (event.key === "Escape" && !mediaDeleteBackdrop.hidden) {
            closeMediaDeleteConfirmation();
            return;
        }
        if (event.key === "Escape" && !mediaEditBackdrop.hidden) {
            closeMediaEditor();
            return;
        }
        if (event.key === "Escape" && !document.querySelector(".highlight-create-backdrop").hidden) {
            closeHighlightPicker();
            return;
        }
        if (event.key === "Escape" &&
            !profilePostViewer.hidden &&
            commentsBackdrop.hidden &&
            likersBackdrop.hidden &&
            shareBackdrop.hidden)
            closeProfileMedia();
        if (event.key === "Escape" && !commentsBackdrop.hidden)
            closeComments();
        if (event.key === "Escape" && !likersBackdrop.hidden)
            closeLikers();
        if (event.key === "Escape" && !shareBackdrop.hidden)
            closeShareDialog();
        if (event.key === "Escape" && !createMenuBackdrop.hidden)
            closeCreateMenu();
        if (event.key === "Escape" && !createUploadBackdrop.hidden)
            closeCreateUpload();
        if (event.key === "Escape" && !document.querySelector(".story-create-backdrop").hidden)
            closeStoryCreator();
        if (event.key === "Escape" && !document.querySelector(".story-settings-backdrop").hidden)
            closeStorySettings();
        if (event.key === "Escape" && !document.querySelector(".story-viewer-backdrop").hidden)
            closeStoryViewer();
        if (event.key === "ArrowRight" && !document.querySelector(".story-viewer-backdrop").hidden)
            showStoryAtIndex(state.activeStoryIndex + 1);
        if (event.key === "ArrowLeft" && !document.querySelector(".story-viewer-backdrop").hidden)
            showStoryAtIndex(state.activeStoryIndex - 1);
    });
}
