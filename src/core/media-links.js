import { state } from './state.js';
import { canViewMedia } from './social.js';
import { findEntity } from '../data/entities.js';
import { openProfileMedia } from '../features/profile.js';
import { showShareFeedback } from '../components/feedback.js';

export function openMediaFromHash(hash = window.location.hash) {
    if (state.deletionRequestedAt || !document.getElementById('welcome-screen').hidden) return false;
    const match = /^#(post|reel)-(\d+)$/.exec(hash);
    if (!match) return false;
    let type = match[1];
    const id = Number(match[2]);
    let entity = findEntity(type, id);
    // Older copied Reel links used the post prefix.
    if (!entity && type === 'post') { type = 'reel'; entity = findEntity(type, id); }
    if (!entity || !canViewMedia(entity)) {
        showShareFeedback('This item is unavailable or you do not have access. Local uploads are only available on the device where they were created.');
        return false;
    }
    openProfileMedia(type, id, null, { singleItem: true });
    return true;
}
