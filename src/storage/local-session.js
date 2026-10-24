// Browser persistence for local content. Real accounts and delivery belong to the server.
import { state } from '../core/state.js';
import { posts, reels, conversations, demoViewCounts } from '../data/sample-data.js';
import { openInstaDatabase, waitForTransaction, waitForRequest, storeInstaData } from './browser-storage.js';
import { repairDemoVideoSources } from '../media/demo-sources.js';

const KEY = 'local-session-v1';
const WEEK = 7 * 24 * 60 * 60 * 1000;
let writeQueue = Promise.resolve();

async function pack(value, cache = new Map()) {
    if (typeof value === 'string' && value.startsWith('blob:')) {
        if (!cache.has(value)) cache.set(value, fetch(value).then(response => {
            if (!response.ok) throw new Error('Media could not be read.');
            return response.blob();
        }));
        return cache.get(value);
    }
    if (Array.isArray(value)) return Promise.all(value.map(item => pack(item, cache)));
    if (value && typeof value === 'object') {
        const result = {};
        for (const [key, item] of Object.entries(value)) result[key] = await pack(item, cache);
        return result;
    }
    return value;
}
function unpack(value) {
    if (value instanceof Blob) return URL.createObjectURL(value);
    if (Array.isArray(value)) return value.map(unpack);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
    return value;
}
export function unexpiredDrafts(items, now = Date.now()) {
    return items.filter(item => Number.isFinite(item.savedAt) && now - item.savedAt < WEEK);
}
export function persistSession() {
    const snapshot = { posts, reels, conversations, drafts: unexpiredDrafts(state.draftItems), reports: state.localReports || [] };
    // Pack before the editor releases any object URLs; serialize database writes in order.
    const packed = pack(snapshot);
    writeQueue = writeQueue.catch(() => {}).then(async () => storeInstaData(KEY, await packed));
    return writeQueue;
}
export async function loadSession() {
    const db = await openInstaDatabase();
    let saved;
    try {
        const tx = db.transaction('app-data', 'readonly');
        const completed = waitForTransaction(tx);
        saved = await waitForRequest(tx.objectStore('app-data').get(KEY));
        await completed;
    } finally { db.close(); }
    if (!saved) return;
    const restored = unpack(saved);
    for (const [target, key] of [[posts, 'posts'], [reels, 'reels'], [conversations, 'conversations']]) {
        if (Array.isArray(restored[key])) target.splice(0, target.length, ...restored[key]);
    }
    // Older prototype builds derived these sample view counts from likes. Keep the
    // seeded analytics independent so Explore ranking never uses likes indirectly.
    for (const item of [...posts, ...reels]) {
        if (demoViewCounts.has(item.id)) item.views = demoViewCounts.get(item.id);
    }
    state.draftItems = unexpiredDrafts(restored.drafts || []);
    repairDemoVideoSources([...posts, ...reels]);
    [...posts, ...reels].forEach(item => (item.commentItems || []).forEach((comment, index) => { comment.id ??= `restored-${item.id}-${index}`; }));
    state.localReports = restored.reports || [];
}
