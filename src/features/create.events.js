import { persistSession } from '../storage/local-session.js';
import { showShareFeedback } from '../components/feedback.js';
import { createMenuBackdrop, createUploadBackdrop } from '../core/dom.js';
import { state } from '../core/state.js';
import { mayInteract } from '../core/social.js';
import {
    renderCreatePreview, saveCreateDraft, resumeCreateDraft,
    closeCreateMenu,
    closeCreateUpload,
    getSupportedStoryFileType,
    openCreateMenu,
    openCreateUpload,
    publishCreatedMedia,
} from './create.js';

export function handleOpenCreateClick(event) {
    if (event.target.closest(".create-button")) {
        openCreateMenu();
        return true;
    }
    if (event.target.closest(".profile-create-button")) {
        openCreateMenu();
        return true;
    }
    return false;
}

export function handleCreateUploadClick(event) {
    const resume = event.target.closest('[data-resume-draft]');
    if (resume) { resumeCreateDraft(resume.dataset.resumeDraft); return true; }
    const removeDraft = event.target.closest('[data-delete-draft]');
    if (removeDraft) { if (!mayInteract()) return true; state.draftItems = state.draftItems.filter(item => item.id !== removeDraft.dataset.deleteDraft); persistSession().catch(() => showShareFeedback('Draft deletion could not be saved.')); openCreateMenu(); return true; }
    const cover = event.target.closest('[data-choose-cover]');
    if (cover) {
        const index = Number(cover.dataset.chooseCover);
        const video = document.querySelectorAll('.upload-media-item')[index]?.querySelector('video');
        if (video) state.createMediaItems[index].coverTime = video.currentTime;
        state.createCoverIndex = index; renderCreatePreview(); return true;
    }
    if (event.target.closest('.create-save-draft')) { saveCreateDraft(); return true; }
    if (event.target.closest('.create-discard')) { closeCreateUpload(true); return true; }
    const createTypeButton = event.target.closest("[data-create-type]");
    if (createTypeButton) {
        createMenuBackdrop.hidden = true;
        openCreateUpload(createTypeButton.dataset.createType);
        return true;
    }
    if (event.target.closest(".create-menu-close") || event.target === createMenuBackdrop) {
        closeCreateMenu();
        return true;
    }
    if (event.target.closest(".create-upload-close") || event.target === createUploadBackdrop) {
        closeCreateUpload();
        return true;
    }
    if (event.target.closest(".create-publish-button")) {
        publishCreatedMedia();
        return true;
    }
    return false;
}

export function registerMediaUploadEvents() {
    document.addEventListener('change', event => {
        const control = event.target;
        const index = control.dataset.mediaFit ?? control.dataset.cropX ?? control.dataset.cropY;
        const item = state.createMediaItems[Number(index)];
        if (!item) return;
        if (control.dataset.mediaFit !== undefined) item.fit = control.value;
        if (control.dataset.cropX !== undefined) item.x = Number(control.value);
        if (control.dataset.cropY !== undefined) item.y = Number(control.value);
        renderCreatePreview();
    });
    document.getElementById('post-upload').addEventListener('change', event => {
        const files = [...event.target.files];
        if (!files.length) return;
        if (files.length > (state.createMediaType === 'reel' ? 1 : 20)) {
            showShareFeedback('Choose at most 20 items per post, or one video per reel.'); return;
        }
        if (files.some(file => !getSupportedStoryFileType(file) || (state.createMediaType === 'reel' && getSupportedStoryFileType(file) !== 'video'))) {
            showShareFeedback('Choose supported photos or videos.'); return;
        }
        state.createMediaItems = files.map(file => ({ type: getSupportedStoryFileType(file), url: URL.createObjectURL(file), fit: 'contain', x: 50, y: 50 }));
        state.createCoverIndex = null;
        state.createMediaFile = files[0];
        state.createMediaUrl = state.createMediaItems[0].url;
        renderCreatePreview();
    });
}
