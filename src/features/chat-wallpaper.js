import { persistSession } from '../storage/local-session.js';
import { showShareFeedback } from '../components/feedback.js';

let editing;
const dialog = () => document.querySelector('.chat-wallpaper-dialog');

function release() {
    if (editing?.url) URL.revokeObjectURL(editing.url);
    editing = null;
}

export function openChatWallpaper(conversation) {
    const history = document.querySelector('.chat-history');
    if (!history) return;
    release();
    editing = {
        conversation, history,
        ratio: history.clientWidth / Math.max(1, history.clientHeight),
        x: .5, y: .5, zoom: 1,
    };
    const panel = dialog();
    panel.querySelector('input[type="file"]').value = '';
    panel.querySelector('input[type="range"]').value = '1';
    panel.querySelector('.chat-wallpaper-crop').hidden = true;
    panel.querySelector('[data-wallpaper-reset]').hidden = !conversation.wallpaper;
    panel.querySelector('[data-wallpaper-pick]').textContent = conversation.wallpaper ? 'Change photo' : 'Choose from gallery';
    panel.querySelector('[role="status"]').textContent = '';
    panel.showModal();
}

function cropBounds(session, image) {
    const width = Math.min(image.naturalWidth, image.naturalHeight * session.ratio) / session.zoom;
    const height = width / session.ratio;
    return {
        width, height,
        x: (image.naturalWidth - width) * session.x,
        y: (image.naturalHeight - height) * session.y,
    };
}

function paint(session, frame, image) {
    const crop = cropBounds(session, image);
    image.style.width = `${100 * image.naturalWidth / crop.width}%`;
    image.style.height = `${100 * image.naturalHeight / crop.height}%`;
    image.style.left = `${-100 * crop.x / crop.width}%`;
    image.style.top = `${-100 * crop.y / crop.height}%`;
}

function applyWallpaper(session, url) {
    if (!session.history.isConnected) return;
    if (url) session.conversation.wallpaper = url;
    else delete session.conversation.wallpaper;
    session.history.style.backgroundImage = url ? `url("${url}")` : '';
    session.history.classList.toggle('chat-history-custom', Boolean(url));
    dialog().close();
    persistSession().catch(() => showShareFeedback('The wallpaper could not be saved on this device.'));
}

export function registerChatWallpaperEvents() {
    const panel = dialog();
    const frame = panel.querySelector('.chat-wallpaper-frame');
    const image = frame.querySelector('img');
    const crop = panel.querySelector('.chat-wallpaper-crop');
    const picker = panel.querySelector('input[type="file"]');
    const zoom = panel.querySelector('input[type="range"]');
    const status = panel.querySelector('[role="status"]');
    let drag;

    panel.addEventListener('close', () => {
        if (panel.open) return;
        release();
        drag = null;
        image.removeAttribute('src');
    });
    panel.addEventListener('click', event => {
        if (event.target === panel || event.target.closest('[data-wallpaper-close]')) panel.close();
        if (!editing) return;
        if (event.target.closest('[data-wallpaper-pick]')) picker.click();
        if (event.target.closest('[data-wallpaper-reset]')) applyWallpaper(editing, '');
        if (event.target.closest('[data-wallpaper-save]') && !crop.hidden) {
            const selection = cropBounds(editing, image);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(Math.min(selection.width, 900, 1500 * editing.ratio)));
            canvas.height = Math.max(1, Math.round(canvas.width / editing.ratio));
            try {
                canvas.getContext('2d').drawImage(image, selection.x, selection.y, selection.width, selection.height, 0, 0, canvas.width, canvas.height);
                applyWallpaper(editing, canvas.toDataURL('image/jpeg', .9));
            } catch {
                status.textContent = 'Could not save this photo. Try another image.';
            }
        }
    });
    picker.addEventListener('change', async () => {
        const file = picker.files?.[0];
        const session = editing;
        if (!file || !session) return;
        picker.value = '';
        crop.hidden = true;
        status.textContent = '';
        if (session.url) URL.revokeObjectURL(session.url);
        const url = URL.createObjectURL(file);
        session.url = url;
        image.src = url;
        try {
            await image.decode();
            if (editing !== session || session.url !== url || !panel.open) return;
            session.x = session.y = .5;
            session.zoom = 1;
            zoom.value = '1';
            frame.style.setProperty('--wallpaper-ratio', String(session.ratio));
            crop.hidden = false;
            paint(session, frame, image);
        } catch {
            if (editing === session && session.url === url) status.textContent = 'This image could not be opened.';
        }
    });
    zoom.addEventListener('input', () => {
        if (!editing || crop.hidden) return;
        editing.zoom = Number(zoom.value);
        paint(editing, frame, image);
    });
    frame.addEventListener('pointerdown', event => {
        if (!editing || crop.hidden || event.button !== 0) return;
        drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
        frame.setPointerCapture(event.pointerId);
    });
    function move(dx, dy) {
        if (!editing || crop.hidden) return;
        const selection = cropBounds(editing, image);
        const moveX = (image.naturalWidth - selection.width) * frame.clientWidth / selection.width;
        const moveY = (image.naturalHeight - selection.height) * frame.clientHeight / selection.height;
        if (moveX) editing.x = Math.min(1, Math.max(0, editing.x - dx / moveX));
        if (moveY) editing.y = Math.min(1, Math.max(0, editing.y - dy / moveY));
        paint(editing, frame, image);
    }
    frame.addEventListener('pointermove', event => {
        if (drag?.id !== event.pointerId) return;
        move(event.clientX - drag.x, event.clientY - drag.y);
        drag.x = event.clientX;
        drag.y = event.clientY;
    });
    frame.addEventListener('lostpointercapture', () => { drag = null; });
    frame.addEventListener('keydown', event => {
        const direction = { ArrowLeft: [-8, 0], ArrowRight: [8, 0], ArrowUp: [0, -8], ArrowDown: [0, 8] }[event.key];
        if (!direction) return;
        event.preventDefault();
        move(...direction);
    });
}
