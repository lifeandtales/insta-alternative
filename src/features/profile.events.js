import { deleteCloudImagePost, updateCloudImagePost } from '../storage/image-posts.js';
import { openProfileScanner, registerProfileScannerEvents } from './profile-scanner.js';
import qrcode from '../vendor/qrcode.js';
import { persistPreferences } from '../storage/preferences.js';
import { showHomePanel, closeHomePanel, openReportPanel } from './home-controls.js';

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
import { canViewAccount, getAccount, visibleAvatar, isFollowing, mayInteract } from '../core/social.js';
import { escapeHtml } from '../core/utils.js';
import { openStoryGroup, closeStoryViewer } from './stories.js';
import {
    closeMediaDeleteConfirmation,
    closeMediaEditor,
    closeProfileMedia,
    deleteProfileMedia,
    openProfileMedia,
    renderProfile,
    updateProfileMediaAfterEdit,
} from './profile.js';

const profileReturnStack = [];
export function handleProfileSectionClick(event) {
    if (event.target.closest('[data-own-profile-qr]')) {
        showHomePanel('Profile QR code', '<div class="profile-options-list"><button type="button" data-show-own-qr>My QR code</button><button type="button" data-scan-profile-qr>Scan QR code</button></div>'); return true;
    }
    if (event.target.closest('[data-show-own-qr]')) {
        showHomePanel('My QR code', `<div class="profile-qr">${profileQrSvg(currentUser.handle)}<strong>${escapeHtml(currentUser.handle)}</strong><p>Scan to open my profile.</p><button type="button" data-scan-profile-qr>Scan QR code</button></div>`);return true;
    }
    if (event.target.closest('[data-scan-profile-qr]')) { closeHomePanel();openProfileScanner();return true; }
    if (event.target.closest('[data-profile-options]')) { openProfileOptions(); return true; }
    const action = event.target.closest('[data-profile-option]');
    if (action) { runProfileOption(action.dataset.profileOption, action.dataset.handle); return true; }
    if (event.target.closest('[data-profile-back]')) {
        const previous = profileReturnStack.pop();
        if (previous) {
            state.profileHandle = previous.handle;
            state.activeProfileSection = previous.section;
            state.activeConversationHandle = previous.conversation;
            setView(previous.view);
            if (previous.story) openStoryGroup(previous.story);
        } else setView('home');
        return true;
    }
    const connectionButton = event.target.closest('[data-profile-connections]');
    if (connectionButton) {
        openProfileConnections(connectionButton.dataset.profileConnections);
        return true;
    }
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
        profileReturnStack.push({ view: state.currentView, handle: state.profileHandle,
            section: state.activeProfileSection, conversation: state.activeConversationHandle,
            story: profileButton.closest('.story-viewer') ? profileButton.dataset.profileHandle : null });
        const connections = document.querySelector(".profile-connections-dialog");
        if (connections.open) connections.close();
        if (profileButton.closest('.story-viewer') || profileButton.closest('.story-text-mention')) closeStoryViewer({ fromHistory: true });
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
        const location = document.getElementById("media-edit-location").value.trim();
        const caption = document.getElementById("media-edit-caption").value.trim();
        if (entity.cloudImagePaths) {
            try { await updateCloudImagePost(entity, { location, caption }); }
            catch { showShareFeedback('Could not save your post changes. Try again.'); return; }
        }
        entity.location = location;
        entity.caption = caption;
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
        const entity = findEntity(type, id);
        if (entity?.cloudImagePaths && entity.handle === currentUser.handle) {
            try { await deleteCloudImagePost(entity); }
            catch { showShareFeedback('Could not delete the saved post. Try again.'); return; }
        }
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
    registerProfileScannerEvents();
    const connections = document.querySelector('.profile-connections-dialog');
    connections.querySelector('.profile-connections-search').addEventListener('input', renderProfileConnectionResults);
    connections.addEventListener('click', event => {
        if (event.target.closest('[data-close-connections]') || event.target === connections) connections.close();
    });
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

export function getProfileConnections(handle, kind, query = '') {
    if (!['followers', 'following'].includes(kind) || !canViewAccount(handle)) return null;
    const account = getAccount(handle);
    const handles = handle === currentUser.handle && kind === 'following'
        ? [...state.followedAccountHandles] : account?.[kind] || [];
    return [...new Set(handles)].filter(value => !state.blockedHandles.has(value))
        .map(value => getAccount(value)).filter(Boolean)
        .filter(person => `${person.name || ''} ${person.handle}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
        .sort((a, b) => Number(isFollowing(b.handle)) - Number(isFollowing(a.handle)));
}

export function openProfileConnections(kind) {
    const people = getProfileConnections(state.profileHandle, kind);
    if (!people) return false;
    const dialog = document.querySelector('.profile-connections-dialog');
    document.getElementById('profile-connections-title').textContent = kind === 'followers' ? 'Followers' : 'Following';
    dialog.dataset.handle = state.profileHandle;
    dialog.dataset.kind = kind;
    const search = dialog.querySelector('.profile-connections-search');
    search.value = '';
    search.setAttribute('aria-label', `Search ${kind}`);
    renderProfileConnectionResults();
    dialog.showModal();
    return true;
}

export function renderProfileConnectionResults() {
    const dialog = document.querySelector('.profile-connections-dialog');
    const query = dialog.querySelector('.profile-connections-search').value;
    const people = getProfileConnections(dialog.dataset.handle, dialog.dataset.kind, query) || [];
    dialog.querySelector('.profile-connections-list').innerHTML = people.length ? people.map(person => `
      <button type="button" class="profile-connection" data-profile-handle="${escapeHtml(person.handle)}">
        <img src="${escapeHtml(visibleAvatar(person.handle, person.avatar))}" alt="" />
        <span><strong>${escapeHtml(person.name || person.handle)}</strong><small>${escapeHtml(person.handle)}</small></span>
      </button>`).join('') : `<p>${query.trim() ? 'No matching accounts.' : `No ${dialog.dataset.kind} yet.`}</p>`;
}

export function profileUrl(handle) {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = `profile-${encodeURIComponent(handle)}`;
    return url.toString();
}
export function profileQrSvg(handle) {
    const code = qrcode(0, 'M');
    code.addData(profileUrl(handle)); code.make();
    return code.createSvgTag({cellSize: 6, margin: 24, scalable: true});
}
export function openProfileOptions() {
    const handle = state.profileHandle;
    const option = (action, label) => `<button type="button" data-profile-option="${action}" data-handle="${escapeHtml(handle)}">${label}</button>`;
    showHomePanel('Profile options', `<div class="profile-options-list">
      ${option('mute-posts', state.mutedPostHandles.has(handle) ? 'Unmute posts' : 'Mute posts')}
      ${option('mute-stories', state.mutedStoryHandles.has(handle) ? 'Unmute stories' : 'Mute stories')}
      ${option('copy', 'Copy profile URL')}${option('share', 'Share profile')}${option('qr', 'QR code')}
      <button type="button" data-account-block="${escapeHtml(handle)}" ${state.blockedHandles.has(handle)?'disabled':''}>${state.blockedHandles.has(handle)?'Blocked':'Block'}</button>
      ${option('report', 'Report')}</div>`);
}
export async function runProfileOption(action, handle) {
    if (!getAccount(handle)) return;
    if (action.startsWith('mute-')) {
        if (!mayInteract()) return;
        const handles = action === 'mute-posts' ? state.mutedPostHandles : state.mutedStoryHandles;
        if (handles.has(handle)) handles.delete(handle); else handles.add(handle);
        persistPreferences(); openProfileOptions(); return;
    }
    if (action === 'report') { openReportPanel({id:handle}, 'profile'); return; }
    if (action === 'qr') {
        showHomePanel('Profile QR code', `<div class="profile-qr">${profileQrSvg(handle)}<strong>${escapeHtml(handle)}</strong><p>Scan to open this profile.</p></div>`);return;
    }
    if (action === 'copy' || action === 'share') {
        const url = profileUrl(handle);
        try {
            if (action === 'share' && navigator.share) await navigator.share({title:handle,url});
            else if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(url); showShareFeedback('Profile link copied.'); }
            else { showHomePanel('Profile link', `<label>Copy this link<input readonly value="${escapeHtml(url)}" /></label>`);return; }
            closeHomePanel();
        } catch(error) { if(error.name !== 'AbortError') showShareFeedback('Could not share the profile. Try copying the link.'); }
    }
}
