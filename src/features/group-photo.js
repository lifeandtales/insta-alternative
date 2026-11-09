import { mayInteract } from '../core/social.js';
import { state } from '../core/state.js';
import { bindCoverCrop } from '../media/cover-crop.js';
import { renderSquareCover } from '../media/cover-canvas.js';
import { persistSession } from '../storage/local-session.js';
import { showShareFeedback } from '../components/feedback.js';
import { captureStoryPhoto, openStoryCamera, stopStoryCamera } from './story-camera.js';
import { isJoinedGroup } from './message-access.js';
import { renderMessages } from './messages.js';

const dialog = () => document.querySelector('.group-photo-dialog');
let editor = null;

function canEdit(group) {
    return mayInteract() && isJoinedGroup(group) && state.currentView === 'messages'
        && state.activeGroupProfileHandle === group.handle;
}

function releaseEditor() {
    if (!editor) return;
    if (editor.camera) stopStoryCamera();
    editor.binding?.dispose();
    if (editor.source) URL.revokeObjectURL(editor.source);
    editor = null;
}

function showStep(step) {
    for (const panel of dialog().querySelectorAll('[data-group-photo-step]')) {
        panel.hidden = panel.dataset.groupPhotoStep !== step;
    }
    dialog().querySelector('[role="status"]').textContent = '';
}

export function openGroupPhotoPicker(group) {
    if (!canEdit(group)) return;
    const panel = dialog();
    releaseEditor();
    editor = { group };
    panel.querySelector('input[type="file"]').value = '';
    showStep('source');
    if (!panel.open) panel.showModal();
}

async function showCrop(source, session) {
    if (editor !== session) {
        URL.revokeObjectURL(source);
        return;
    }
    if (session.camera) {
        stopStoryCamera();
        session.camera = false;
    }
    session.binding?.dispose();
    if (session.source) URL.revokeObjectURL(session.source);
    session.source = source;
    const stage = dialog().querySelector('.group-photo-crop-stage');
    const image = stage.querySelector('img');
    const save = dialog().querySelector('[data-group-photo-save]');
    save.disabled = true;
    image.src = source;
    try {
        await image.decode();
        if (editor !== session || session.source !== source) return;
        const geometry = { width: image.naturalWidth, height: image.naturalHeight };
        session.crop = { x: 50, y: 50, zoom: 1.25 };
        stage.style.setProperty('--crop-ratio', String(geometry.width / geometry.height));
        showStep('crop');
        session.binding = bindCoverCrop(stage, () => geometry, () => session.crop, crop => { session.crop = crop; });
        save.disabled = false;
        stage.focus();
    } catch {
        if (editor === session && session.source === source) {
            showStep('source');
            dialog().querySelector('[role="status"]').textContent = 'This image could not be opened. Choose another photo.';
        }
    }
}

async function startCamera(session) {
    const panel = dialog();
    const video = panel.querySelector('video');
    showStep('camera');
    session.camera = true;
    try {
        await openStoryCamera(video);
    } catch {
        if (editor !== session || !session.camera) return;
        stopStoryCamera();
        session.camera = false;
        showStep('source');
        panel.querySelector('[role="status"]').textContent = 'Camera unavailable. You can choose a gallery photo.';
    }
}

export function openGroupPhotoViewer(group) {
    if (!isJoinedGroup(group) || !group.photo || state.activeGroupProfileHandle !== group.handle) return false;
    const viewer = document.querySelector('.group-photo-viewer');
    const image = viewer.querySelector('img');
    image.src = group.photo;
    image.alt = `${group.user} group photo`;
    if (!viewer.open) viewer.showModal();
    return true;
}

export function registerGroupPhotoEvents() {
    const viewer = document.querySelector('.group-photo-viewer');
    let pressedBackdrop = false;
    viewer.addEventListener('pointerdown', event => { pressedBackdrop = event.target === viewer; });
    viewer.addEventListener('click', event => {
        if (pressedBackdrop && event.target === viewer) viewer.close();
        pressedBackdrop = false;
    });
    viewer.addEventListener('close', () => {
        pressedBackdrop = false;
        viewer.querySelector('img').removeAttribute('src');
    });
    const panel = dialog();
    panel.addEventListener('close', () => { if (!panel.open) releaseEditor(); });
    panel.addEventListener('cancel', releaseEditor);
    panel.addEventListener('change', event => {
        const file = event.target.files?.[0];
        if (editor && file) void showCrop(URL.createObjectURL(file), editor);
        if (file) event.target.value = '';
    });
    panel.addEventListener('click', async event => {
        const session = editor;
        if (event.target === panel || event.target.closest('[data-group-photo-close]')) {
            releaseEditor();
            panel.close();
            return;
        }
        if (!session || !canEdit(session.group)) return;
        if (event.target.closest('[data-group-photo-gallery]')) panel.querySelector('input[type="file"]').click();
        if (event.target.closest('[data-group-photo-camera]')) void startCamera(session);
        if (event.target.closest('[data-group-photo-capture]')) {
            try {
                const photo = await captureStoryPhoto(panel.querySelector('video'));
                await showCrop(photo.media, session);
            } catch {
                if (editor === session) panel.querySelector('[role="status"]').textContent = 'Camera is still getting ready. Try again.';
            }
        }
        if (event.target.closest('[data-group-photo-reselect]')) openGroupPhotoPicker(session.group);
        if (event.target.closest('[data-group-photo-save]') && session.binding) {
            try {
                session.group.photo = renderSquareCover(panel.querySelector('.group-photo-crop-stage img'), null, { ...session.crop, size: 384 });
                releaseEditor();
                panel.close();
                renderMessages();
                await persistSession();
            } catch {
                showShareFeedback('The group photo could not be saved on this device.');
            }
        }
    });
    document.addEventListener('visibilitychange', () => {
        if (document.hidden && editor?.camera) {
            stopStoryCamera();
            editor.camera = false;
            showStep('source');
        }
    });
}
