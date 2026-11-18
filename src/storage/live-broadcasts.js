import { liveBroadcastMode } from '../core/live-config.js';
import { getSupabaseClient } from './supabase.js';
import { cloudAvatarUrls } from './cloud-avatars.js';
import { state } from '../core/state.js';
import { DEFAULT_AVATAR } from '../core/social.js';
let pending;
export function activeLiveBroadcasts() {
    if (liveBroadcastMode === 'preview') return [];
    return state.liveDataOwner === state.signedInAccountId ? (state.liveBroadcasts || []).filter(row => Date.parse(row.expires_at) > Date.now()) : [];
}
export function liveNotifications() {
    if (liveBroadcastMode === 'preview') return [];
    return state.liveDataOwner === state.signedInAccountId ? state.liveNotices || [] : [];
}
export async function loadLiveData() {
    const owner = state.signedInAccountId;
    if (liveBroadcastMode === 'preview') {
        state.liveBroadcasts = []; state.liveNotices = []; state.liveDataOwner = owner || null;
        return;
    }
    if (!owner) { state.liveBroadcasts = []; state.liveNotices = []; state.liveDataOwner = null; return; }
    if (pending?.owner === owner) return pending.promise;
    const promise = (async () => {
        const client = await getSupabaseClient();
        const [feed, notices] = await Promise.all([client.rpc('followed_live_broadcasts'), client.rpc('live_broadcast_notifications')]);
        if (feed.error || notices.error) throw feed.error || notices.error;
        const avatars = await cloudAvatarUrls(client, (feed.data || []).map(row => row.avatar_path));
        if (state.signedInAccountId !== owner) return;
        state.liveDataOwner = owner;
        state.liveBroadcasts = (feed.data || []).map(row => ({ ...row, avatar: avatars.get(row.avatar_path) || DEFAULT_AVATAR }));
        state.liveNotices = notices.data || [];
        window.dispatchEvent(new Event('live-broadcasts-updated'));
    })().finally(() => { if (pending?.promise === promise) pending = null; });
    pending = { owner, promise };
    return promise;
}
export async function markLiveNoticesRead() {
    const owner = state.signedInAccountId;
    const ids = liveNotifications().filter(row => !row.read_at).map(row => row.broadcast_id);
    if (!owner || !ids.length) return;
    const time = new Date().toISOString(), client = await getSupabaseClient();
    const { error } = await client.from('live_broadcast_notices').update({ read_at: time }).eq('recipient_id', owner).in('broadcast_id', ids);
    if (error) throw error;
    if (state.signedInAccountId !== owner) return;
    for (const row of state.liveNotices || []) if (ids.includes(row.broadcast_id)) row.read_at = time;
}
