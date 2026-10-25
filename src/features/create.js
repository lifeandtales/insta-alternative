import { escapeHtml, normalizeHandle } from '../core/utils.js';
import { mayInteract } from '../core/social.js';
import { persistSession, unexpiredDrafts } from '../storage/local-session.js';
import { showShareFeedback } from '../components/feedback.js';
import { createMenuBackdrop, createUploadBackdrop } from '../core/dom.js';
import { setView } from '../core/navigation.js';
import { state } from '../core/state.js';
import { currentUser, posts, reels } from '../data/sample-data.js';

export function openCreateMenu() {
    if (!mayInteract()) { showShareFeedback('Approval is required to create content.'); return; }
    state.createOriginView = state.currentView;
    renderDrafts();
    createMenuBackdrop.hidden = false;
    document.body.classList.add("story-overlay-open");
    document.querySelector(".create-menu-close").focus();
}

export function closeCreateMenu() {
    createMenuBackdrop.hidden = true;
    if (createUploadBackdrop.hidden && document.querySelector(".story-viewer-backdrop").hidden) {
        document.body.classList.remove("story-overlay-open");
    }
}

export function openCreateUpload(type) {
    if (!mayInteract()) return;
    state.createMediaItems = [];
    state.createCoverIndex = null;
    state.activeDraftId = null;
    state.createMediaType = type;
    state.createMediaFile = null;
    if (state.createMediaUrl)
        URL.revokeObjectURL(state.createMediaUrl);
    state.createMediaUrl = "";
    document.getElementById("post-upload").value = "";
    document.getElementById("create-caption").value = "";
    document.getElementById('create-location').value = '';
    document.getElementById('create-tags').value = '';
    document.querySelector('.create-media-controls').hidden = true;
    document.getElementById('post-upload').multiple = type !== 'reel';
    document.querySelector(".create-upload-preview").replaceChildren();
    document.querySelector(".create-upload-preview").hidden = true;
    document.querySelector(".create-publish-button").disabled = true;
    const isReel = type === "reel";
    document.getElementById("create-upload-title").textContent = isReel ? "New reel" : "New post";
    document.getElementById("post-upload").accept = isReel
        ? ".mp4,.webm,.mov,.m4v,.3gp,.ogv,video/mp4,video/webm,video/quicktime,video/x-m4v,video/3gpp,video/ogg"
        : ".jpg,.jpeg,.png,.gif,.webp,.avif,.heic,.heif,.bmp,.mp4,.webm,.mov,.m4v,.3gp,.ogv,image/jpeg,image/png,image/gif,image/webp,image/avif,image/heic,image/heif,image/bmp,video/mp4,video/webm,video/quicktime,video/x-m4v,video/3gpp,video/ogg";
    document.querySelector(".create-publish-button").textContent = isReel ? "Share reel" : "Share post";
    createUploadBackdrop.hidden = false;
    document.body.classList.add("story-overlay-open");
    document.querySelector(".create-upload-close").focus();
}

export function closeCreateUpload(discard = false) {
    if (!discard && state.createMediaItems.length) {
        document.querySelector('.create-save-draft').textContent = 'Save draft before closing · or discard';
        document.querySelector('.create-upload-hint').innerHTML = 'Keep your work for 7 days, or <button type="button" class="create-discard">Discard changes</button>.';
        document.querySelector('.create-save-draft').focus();
        return;
    }
    createUploadBackdrop.hidden = true;
    const mediaIsSaved = state.draftItems.some(draft => draft.items?.some(item => item.url === state.createMediaUrl));
    if (state.createMediaUrl && !mediaIsSaved)
        URL.revokeObjectURL(state.createMediaUrl);
    state.createMediaUrl = "";
    state.createMediaFile = null;
    state.createMediaItems = [];
    if (createMenuBackdrop.hidden && document.querySelector(".story-viewer-backdrop").hidden) {
        document.body.classList.remove("story-overlay-open");
    }
}

export async function publishCreatedMedia() {
    if (!mayInteract()) return;
    if (state.createCoverIndex === null) { showShareFeedback('Choose a square cover before publishing.'); return; }
    if (!state.createMediaItems.length || state.createMediaItems.length > 20) return;
    const cover = await createSquareCover(state.createMediaItems[state.createCoverIndex]);
    if (!cover) { showShareFeedback('This media cannot be decoded here. Choose another supported file.'); return; }
    if (!state.createMediaFile || !state.createMediaUrl)
        return;
    const caption = document.getElementById("create-caption").value.trim();
    const mediaType = getSupportedStoryFileType(state.createMediaFile);
    const createdAt = Date.now();
    if (state.createMediaType === "reel") {
        const reel = {
            id: createdAt,
            user: currentUser.name,
            handle: currentUser.handle,
            avatar: currentUser.avatar,
            poster: cover,
            cover,
            video: state.createMediaUrl,
            caption,
            createdAt,
            likes: 0,
            comments: 0,
            liked: false,
            commentItems: [],
            public: !currentUser.isPrivate,
            followed: true,
            reel: true,
            mine: true
        };
        reels.unshift(reel);
    }
    else {
        const post = {
            id: createdAt,
            user: currentUser.name,
            handle: currentUser.handle,
            location: document.getElementById('create-location').value.trim(),
            taggedHandles: document.getElementById('create-tags').value.split(',').map(value => value.trim()).filter(Boolean).map(normalizeHandle),
            taggedUsers: document.getElementById('create-tags').value.split(',').map(value => value.trim()).filter(Boolean).map(normalizeHandle),
            mediaItems: state.createMediaItems.map(item => ({ ...item })),
            cover,
            avatar: currentUser.avatar,
            media: state.createMediaUrl,
            videoUrl: mediaType === "video" ? state.createMediaUrl : undefined,
            mediaType: mediaType === "video" ? "video" : "photo",
            caption,
            createdAt,
            likes: 0,
            comments: 0,
            liked: false,
            commentItems: [],
            followed: true,
            public: !currentUser.isPrivate,
            reel: false,
            mine: true
        };
        posts.unshift(post);
    }
    state.draftItems = state.draftItems.filter(item => item.id !== state.activeDraftId);
    try { await persistSession(); }
    catch { showShareFeedback('Published on this screen, but storage failed. Keep this page open.'); return; }
    const publishedType = state.createMediaType;
    state.createMediaUrl = "";
    state.createMediaFile = null;
    createUploadBackdrop.hidden = true;
    createMenuBackdrop.hidden = true;
    document.body.classList.remove("story-overlay-open");
    if (state.createOriginView === "profile") {
        state.activeProfileSection = publishedType === "reel" ? "reels" : "posts";
        setView("profile");
    }
    else {
        setView("home");
    }
    state.createOriginView = "";
    showShareFeedback(`Your ${publishedType} was shared.`);
}

export function getSupportedStoryFileType(file) {
    const mimeType = String(file?.type || '').split(';', 1)[0].trim().toLowerCase();
    if (mimeType) {
        if (/^image\/(jpeg|png|gif|webp|avif|heic|heif|bmp|tiff?)$/.test(mimeType))
            return "image";
        if (/^video\/(mp4|webm|quicktime|x-m4v|3gpp|ogg|mpeg|x-msvideo)$/.test(mimeType))
            return "video";
        // Phone file providers sometimes label a recognized file with a generic
        // binary MIME type. Use its extension only for those generic labels.
        if (!/^(application|binary)\/(octet-stream|x-octet-stream)$/.test(mimeType))
            return null;
    }
    const extension = String(file?.name || '').toLowerCase().split(".").pop();
    if (["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "bmp", "tif", "tiff"].includes(extension))
        return "image";
    if (["mp4", "webm", "mov", "m4v", "3gp", "ogv", "mpeg", "mpg", "avi"].includes(extension))
        return "video";
    return null;
}

export function renderDrafts() {
    state.draftItems = unexpiredDrafts(state.draftItems);
    const list = document.querySelector('.local-draft-list');
    list.innerHTML = state.draftItems.map(draft => `<div><button type="button" ${draft.type === 'story' ? 'data-resume-story-draft' : 'data-resume-draft'}="${draft.id}">Resume ${escapeHtml(draft.type)} draft · ${new Date(draft.savedAt).toLocaleDateString()}</button><button type="button" data-delete-draft="${draft.id}" aria-label="Delete draft">×</button></div>`).join('');
}
export function renderCreatePreview() {
    const preview = document.querySelector('.create-upload-preview');
    const controls = document.querySelector('.create-media-controls');
    preview.hidden = !state.createMediaItems.length;
    controls.hidden = !state.createMediaItems.length;
    preview.innerHTML = state.createMediaItems.map((item, index) => `<div class="upload-media-item"><strong>${index + 1}</strong>${item.type === 'video' ? `<video controls playsinline muted src="${escapeHtml(item.url)}"></video>` : `<img src="${escapeHtml(item.url)}" alt="Media ${index + 1}" />`}</div>`).join('');
    controls.innerHTML = state.createMediaItems.map((item, index) => `<fieldset><legend>Media ${index + 1}</legend><label>Frame <select data-media-fit="${index}"><option value="contain" ${item.fit === 'contain' ? 'selected' : ''}>Fit whole media</option><option value="cover" ${item.fit === 'cover' ? 'selected' : ''}>Fill / crop</option></select></label><label>Horizontal crop <input type="range" min="0" max="100" value="${item.x}" data-crop-x="${index}" /></label><label>Vertical crop <input type="range" min="0" max="100" value="${item.y}" data-crop-y="${index}" /></label><button type="button" data-choose-cover="${index}" aria-pressed="${state.createCoverIndex === index}">${state.createCoverIndex === index ? '✓ Selected square cover' : 'Use as square cover'}</button></fieldset>`).join('');
    preview.querySelectorAll('.upload-media-item').forEach((element, index) => {
        const media = element.querySelector('img,video');
        const item = state.createMediaItems[index];
        media.style.objectFit = item.fit;
        media.style.objectPosition = `${item.x}% ${item.y}%`;
    });
    document.querySelector('.create-publish-button').disabled = state.createCoverIndex === null;
}
export async function saveCreateDraft() {
    if (!mayInteract()) return;
    if (!state.createMediaItems.length) return;
    const draft = { id: state.activeDraftId || `draft-${Date.now()}`, type: state.createMediaType, savedAt: Date.now(), items: state.createMediaItems.map(item => ({ ...item })), coverIndex: state.createCoverIndex, caption: document.getElementById('create-caption').value, location: document.getElementById('create-location').value, tags: document.getElementById('create-tags').value };
    state.draftItems = state.draftItems.filter(item => item.id !== draft.id);
    state.draftItems.push(draft);
    try { await persistSession(); }
    catch { showShareFeedback('Draft could not be saved. Your editor is still open.'); return; }
    // Retain draft object URLs while they are used by this session.
    state.createMediaUrl = '';
    closeCreateUpload(true);
    showShareFeedback('Draft saved for 7 days from this save.');
}
export function resumeCreateDraft(id) {
    if (!mayInteract()) return;
    const draft = unexpiredDrafts(state.draftItems).find(item => item.id === id);
    if (!draft) return;
    openCreateUpload(draft.type);
    state.activeDraftId = draft.id;
    state.createMediaItems = draft.items.map(item => ({ ...item }));
    state.createCoverIndex = draft.coverIndex;
    state.createMediaUrl = draft.items[0]?.url || '';
    state.createMediaFile = { type: draft.items[0]?.type === 'video' ? 'video/mp4' : 'image/jpeg' };
    document.getElementById('create-caption').value = draft.caption;
    document.getElementById('create-location').value = draft.location || '';
    document.getElementById('create-tags').value = draft.tags || '';
    closeCreateMenu();
    renderCreatePreview();
}
async function createSquareCover(item) {
    const media = document.createElement(item.type === 'video' ? 'video' : 'img');
    if (item.type === 'video') { media.muted = true; media.playsInline = true; }
    const ready = new Promise(resolve => {
        media.addEventListener(item.type === 'video' ? 'loadeddata' : 'load', () => resolve(true), { once: true });
        media.addEventListener('error', () => resolve(false), { once: true });
    });
    media.src = item.url;
    if (!await ready) return null;
    if (item.type === 'video') {
        const source = document.querySelectorAll('.create-upload-preview video')[state.createMediaItems.slice(0, state.createCoverIndex).filter(entry => entry.type === 'video').length];
        const seekTo = Math.min(item.coverTime || 0, media.duration || 0);
        if (seekTo > 0) { const seeked = new Promise(resolve => media.addEventListener('seeked', resolve, { once: true })); media.currentTime = seekTo; await seeked; }
    }
    const width = media.videoWidth || media.naturalWidth, height = media.videoHeight || media.naturalHeight;
    const size = Math.min(width, height);
    const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 720;
    canvas.getContext('2d').drawImage(media, (width - size) * item.x / 100, (height - size) * item.y / 100, size, size, 0, 0, 720, 720);
    return canvas.toDataURL('image/jpeg', .85);
}
