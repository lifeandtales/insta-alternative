import { state } from '../core/state.js';
import { findEntity } from '../data/entities.js';
import { currentUser } from '../data/sample-data.js';
import { formatCount } from '../core/utils.js';
import { recordVideoView } from '../storage/video-engagement.js';

const completed = new Set();
const pending = new Set();

export function uniquePlayedSeconds(played, duration) {
    let end = 0;
    let total = 0;
    // HTMLMediaElement.played provides ordered time ranges and excludes seek jumps.
    for (let index = 0; index < played.length; index++) {
        const stop = Math.min(played.end(index), duration);
        total += Math.max(0, stop - Math.max(end, played.start(index)));
        end = Math.max(end, stop);
    }
    return Math.min(total, duration);
}

export function observeQualifiedVideoView(video, canPlay) {
    if (video.dataset.qualifiedViewBound) return;
    const media = video.closest('.likeable-media');
    if (!media?.dataset.likeableId) return;
    video.dataset.qualifiedViewBound = 'true';
    const type = media.dataset.likeableType || 'post';
    const id = Number(media.dataset.likeableId);
    const assetIndex = Number(media.dataset.videoAssetIndex || 0);

    function recordIfQualified() {
        if (document.hidden || video.seeking || !video.isConnected || !video.played) return;
        const duration = video.duration;
        if (!Number.isFinite(duration) || duration <= 0) return;
        const watched = uniquePlayedSeconds(video.played, duration);
        if (watched < duration / 2) return;
        const entity = findEntity(type, id);
        const owner = state.signedInAccountId;
        if (!entity || entity.viewed || !canPlay(video)) return;

        const cloudId = entity.cloudContentId || entity.cloudClientId;
        const key = `qualified-view:${owner || currentUser.handle}:${type}:${entity.cloudOwnerId || entity.handle}:${cloudId || id}`;
        if (completed.has(key) || pending.has(key)) return;

        function finish(count) {
            completed.add(key);
            if (owner !== state.signedInAccountId) return;
            const current = findEntity(type, id);
            if (!current) return;
            current.viewed = true;
            current.views = Math.max(Number(current.views) || 0, count);
            document.querySelectorAll(`[data-media-view-count="${type}:${id}"]`)
                .forEach(label => { label.textContent = `${formatCount(current.views)} views`; });
            document.querySelectorAll(`#explore-grid [data-id="${id}"] .explore-view-count`)
                .forEach(label => { label.textContent = `◉ ${formatCount(current.views)}`; });
        }

        if (cloudId) {
            if (!owner) return;
            pending.add(key);
            void recordVideoView(entity, assetIndex, duration, watched)
                .then(finish, () => {}).finally(() => pending.delete(key));
        } else {
            const views = (Number(entity.views) || 0) + 1;
            try {
                const saved = window.localStorage.getItem(key);
                if (saved) { finish(Number(saved)); return; }
                window.localStorage.setItem(key, String(views));
            } catch { /* The in-memory key still deduplicates this session. */ }
            finish(views);
        }
    }

    video.addEventListener('timeupdate', recordIfQualified);
    video.addEventListener('ended', recordIfQualified);
}
