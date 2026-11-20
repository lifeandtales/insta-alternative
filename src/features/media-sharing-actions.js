import { showShareFeedback } from '../components/feedback.js';
import { mediaUrl } from '../core/media-links.js';
import { state } from '../core/state.js';

let exporting = false;
let nativeRequest;

function nativeMediaAction(action, url, name) {
    const bridge = window.InstaNativeMedia;
    if (!bridge?.postMessage || nativeRequest) return Promise.resolve(false);
    return new Promise(resolve => {
        const id = crypto.randomUUID();
        const finish = ok => {
            if (nativeRequest?.id !== id) return;
            clearTimeout(nativeRequest.timer);
            nativeRequest = null;
            resolve(ok);
        };
        nativeRequest = { id, timer: window.setTimeout(() => finish(false), 120000) };
        bridge.onmessage = event => {
            try {
                const result = JSON.parse(event.data);
                if (result.id === id) finish(result.ok === true);
            } catch { finish(false); }
        };
        try { bridge.postMessage(JSON.stringify({ action, id, url, name })); }
        catch { finish(false); }
    });
}

export async function shareOutsideApp(entity, type) {
    const url = mediaUrl(entity, type);
    if (window.InstaNativeMedia && url.includes('-id-')) {
        if (!await nativeMediaAction('share', url)) showShareFeedback('Could not open sharing. Try Copy link.');
        return;
    }
    if (!navigator.share) { showShareFeedback('Use Copy link to share from this browser.'); return; }
    try { await navigator.share({ title: type === 'reel' ? 'Reel' : 'Post', url }); }
    catch (error) { if (error.name !== 'AbortError') showShareFeedback('Could not open sharing. Try Copy link.'); }
}

export async function downloadSilentReel(entity) {
    if (exporting || !entity.video) return;
    exporting = true;
    showShareFeedback('Preparing a silent download…');
    const name = (entity.handle || 'reel').replace(/^@/, '') + '-reel-' + entity.id;
    const owner = state.signedInAccountId;
    try {
        if (window.InstaNativeMedia) {
            if (!await nativeMediaAction('download', entity.video, name)) {
                showShareFeedback('Could not save this Reel in the app. You can try downloading its link in Chrome.');
                return;
            }
            showShareFeedback('Silent Reel saved to Downloads.');
            return;
        }
        const { buildStoryExport } = await import('./story-export.js');
        const { blob } = await buildStoryExport(
            { type: 'video', media: entity.video, edits: { video: { muted: true } } }, null, new AbortController().signal,
        );
        if (owner !== state.signedInAccountId || state.deletionRequestedAt) return;
        const file = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = file;
        link.download = name + (blob.type.startsWith('video/mp4') ? '-silent.mp4' : '-silent.webm');
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(file), 1000);
        showShareFeedback('Silent Reel download started.');
    } catch {
        showShareFeedback('Could not download this Reel. Keep the app open and try again.');
    } finally {
        exporting = false;
    }
}
