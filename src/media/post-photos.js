import { retryImagePostPhoto } from '../storage/image-posts.js';

function showPhotoState(image, failed) {
    const status = image.parentElement?.querySelector('.post-photo-error');
    if (!status) return;
    image.hidden = failed;
    status.hidden = !failed;
    image.parentElement.classList.toggle('post-photo-loaded', !failed);
}

export function registerPostPhotoEvents() {
    document.addEventListener('load', event => {
        const image = event.target;
        if (!image.matches?.('img[data-post-photo]') || !image.naturalWidth || !image.naturalHeight) return;
        showPhotoState(image, false);
        const frame = image.parentElement;
        if (!frame.hasAttribute('data-original-photo-size')) return;
        const originalRatio = image.naturalWidth / image.naturalHeight;
        const ratio = Math.min(10, Math.max(.1, originalRatio));
        if (ratio !== originalRatio) image.style.objectFit = 'cover';
        if (Math.abs(Number(frame.style.getPropertyValue('--media-ratio')) - ratio) < .001) return;
        frame.style.aspectRatio = String(ratio);
        frame.style.setProperty('--media-ratio', String(ratio));
        frame.dispatchEvent(new Event('post-photo-resize', { bubbles: true }));
    }, true);
    document.addEventListener('error', event => {
        if (event.target.matches?.('img[data-post-photo]')) showPhotoState(event.target, true);
    }, true);
    document.addEventListener('click', async event => {
        const button = event.target.closest?.('[data-retry-post-photo]');
        const image = button?.parentElement.parentElement.querySelector('img[data-post-photo]');
        if (!image || button.disabled) return;
        button.disabled = true;
        try {
            const path = image.dataset.photoPath;
            const url = path ? await retryImagePostPhoto(path) : image.getAttribute('src');
            if (!url || !image.isConnected) return;
            image.hidden = false;
            button.parentElement.hidden = true;
            image.loading = 'eager';
            image.removeAttribute('src');
            image.src = url;
        } catch {
            showPhotoState(image, true);
        } finally {
            button.disabled = false;
        }
    });
}
