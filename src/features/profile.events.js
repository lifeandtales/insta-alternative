import { persistSession } from '../storage/local-session.js';
import { showShareFeedback } from '../components/feedback.js';
import {
    exploreSearchInput,
    exploreSearchResults,
    mediaDeleteBackdrop,
    mediaEditBackdrop,
    profilePostViewer,
} from '../core/dom.js';
import { setView } from '../core/navigation.js';
import { state } from '../core/state.js';
import { findEntity } from '../data/entities.js';
import { currentUser } from '../data/sample-data.js';
import { mayInteract } from '../core/social.js';
import { closeStoryViewer } from './stories.js';
import {
    closeMediaDeleteConfirmation,
    closeMediaEditor,
    closeProfileMedia,
    deleteProfileMedia,
    openProfileMedia,
    renderProfile,
    updateProfileMediaAfterEdit,
} from './profile.js';

export function handleProfileSectionClick(event) {
    const profileSectionButton = event.target.closest("[data-profile-section]");
    if (profileSectionButton) {
        state.activeProfileSection = profileSectionButton.dataset.profileSection;
        renderProfile();
        return true;
    }
    return false;
}

export function handleProfileMediaClick(event) {
    const profileMediaTile = event.target.closest("[data-profile-media-type][data-profile-media-id]");
    if (profileMediaTile) {
        if (!event.target.closest(".save-btn")) {
            openProfileMedia(profileMediaTile.dataset.profileMediaType, Number(profileMediaTile.dataset.profileMediaId), profileMediaTile);
            return true;
        }
    }
    if (event.target.closest(".profile-post-viewer-close") || event.target === profilePostViewer) {
        closeProfileMedia();
        return true;
    }
    return false;
}

export function handleAuthorClick(event) {
    const profileButton = event.target.closest("[data-profile-handle]");
    if (profileButton) {
        if (profileButton.closest('.story-text-mention')) closeStoryViewer();
        if (!profilePostViewer.hidden)
            closeProfileMedia();
        exploreSearchResults.hidden = true;
        exploreSearchInput.setAttribute("aria-expanded", "false");
        state.profileHandle = profileButton.dataset.profileHandle;
        state.activeProfileSection = "posts";
        setView("profile");
        return true;
    }
    return false;
}

export function registerProfileEditorEvents() {
    document.getElementById('media-edit-cover').addEventListener('change', event => {
        const file = event.target.files?.[0];
        const preview = document.querySelector('.media-edit-cover-preview');
        preview.replaceChildren();
        preview.hidden = !file;
        if (file) {
            const image = document.createElement('img');
            image.src = URL.createObjectURL(file);
            image.alt = 'New square thumbnail preview';
            image.style.objectPosition = `${document.getElementById('media-edit-cover-x').value}% ${document.getElementById('media-edit-cover-y').value}%`;
            preview.append(image);
        }
    });
    for (const axis of ['x', 'y']) {
        document.getElementById(`media-edit-cover-${axis}`).addEventListener('input', () => {
            const image = document.querySelector('.media-edit-cover-preview img');
            if (image) image.style.objectPosition = `${document.getElementById('media-edit-cover-x').value}% ${document.getElementById('media-edit-cover-y').value}%`;
        });
    }
    document.querySelector(".media-edit-form").addEventListener("submit", async (event) => {
        event.preventDefault();
        if (!mayInteract() || !state.activeMediaEdit || state.profileHandle !== currentUser.handle)
            return;
        const entity = findEntity(state.activeMediaEdit.type, state.activeMediaEdit.id);
        if (!entity || entity.handle !== currentUser.handle) {
            closeMediaEditor();
            showShareFeedback("This media is no longer available to edit.");
            return;
        }
        entity.location = document.getElementById("media-edit-location").value.trim();
        entity.caption = document.getElementById("media-edit-caption").value.trim();
        const coverFile = document.getElementById('media-edit-cover').files?.[0];
        if (coverFile) {
            try { entity.cover = await readSquareCover(coverFile, Number(document.getElementById('media-edit-cover-x').value), Number(document.getElementById('media-edit-cover-y').value)); }
            catch { showShareFeedback('This image could not be used as a thumbnail.'); return; }
        }
        const { type, id } = state.activeMediaEdit;
        closeMediaEditor();
        updateProfileMediaAfterEdit(type, id);
        try { await persistSession(); }
        catch { showShareFeedback('The post updated in this preview, but local storage could not save the thumbnail.'); return; }
        showShareFeedback(`${type === "reel" ? "Reel" : "Post"} updated.`);
    });
    document.querySelector(".media-delete-confirm").addEventListener("click", async () => {
        if (!state.activeMediaDelete)
            return;
        const { type, id, origin } = state.activeMediaDelete;
        closeMediaDeleteConfirmation();
        if (!deleteProfileMedia(type, id, {fromHome:origin==='home'})) {
            showShareFeedback("This media is no longer available to delete.");return;
        }
        try {await persistSession();}
        catch {showShareFeedback('Deleted in this preview, but saving failed. Keep this page open.');}
    });
    document.querySelector(".media-edit-close").addEventListener("click", closeMediaEditor);
    document.querySelector(".media-edit-cancel").addEventListener("click", closeMediaEditor);
    mediaEditBackdrop.addEventListener("click", (event) => {
        if (event.target === mediaEditBackdrop)
            closeMediaEditor();
    });
    document.getElementById("media-delete-cancel").addEventListener("click", closeMediaDeleteConfirmation);
    mediaDeleteBackdrop.addEventListener("click", (event) => {
        if (event.target === mediaDeleteBackdrop)
            closeMediaDeleteConfirmation();
    });
}

export function registerProfileGridEvents() {
    document.getElementById("profile-view").addEventListener("keydown", (event) => {
        const tile = event.target.closest("[data-profile-media-type][data-profile-media-id]");
        if (!tile || event.target !== tile || (event.key !== "Enter" && event.key !== " "))
            return;
        event.preventDefault();
        openProfileMedia(tile.dataset.profileMediaType, Number(tile.dataset.profileMediaId), tile);
    });
}


function readSquareCover(file, cropX = 50, cropY = 50) {
    return new Promise((resolve, reject) => {
        const image = new Image();
        const objectUrl = URL.createObjectURL(file);
        image.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error('Could not load thumbnail image.')); };
        image.onload = () => {
            try {
                const width = image.naturalWidth, height = image.naturalHeight, size = Math.min(width, height);
                const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 720;
                canvas.getContext('2d').drawImage(image, (width - size) * cropX / 100, (height - size) * cropY / 100, size, size, 0, 0, 720, 720);
                URL.revokeObjectURL(objectUrl);
                resolve(canvas.toDataURL('image/jpeg', .85));
            } catch (error) { URL.revokeObjectURL(objectUrl); reject(error); }
        };
        image.src = objectUrl;
    });
}
