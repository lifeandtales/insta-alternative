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
        if (event.target.matches?.('img[data-post-photo]') && event.target.naturalWidth) showPhotoState(event.target, false);
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
