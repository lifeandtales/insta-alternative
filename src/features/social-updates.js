import { refreshOpenCloudComments } from './comments.js';
import { state } from '../core/state.js';
import { refreshConnectedView } from '../core/navigation.js';
import { refreshVisibleExplorePeople } from './explore.js';
import { getSupabaseClient } from '../storage/supabase.js';

let liveOwner;
let channel;
let refreshTimer;

export async function subscribeToSocialUpdates(owner) {
    if (liveOwner === owner) return;
    const client = await getSupabaseClient();
    if (state.signedInAccountId !== owner || liveOwner === owner || typeof client.channel !== 'function') return;
    if (channel) await client.removeChannel(channel);
    liveOwner = owner;
    const next = client.channel('connected-social-' + owner);
    for (const table of ['profiles', 'account_follows', 'messages', 'image_posts', 'media_content', 'image_post_comments']) {
        for (const event of ['INSERT', 'UPDATE']) next.on('postgres_changes', { event, schema: 'public', table }, () => {
            if (owner !== state.signedInAccountId || document.hidden) return;
            const view = state.currentView;
            const relevant = table === 'profiles' || table === 'account_follows'
                || (table === 'messages' && view === 'messages')
                || (table === 'image_posts' && ['home', 'profile', 'explore'].includes(view))
                || (table === 'image_post_comments' && ['home', 'profile', 'explore'].includes(view))
                || (table === 'media_content' && view === 'reels');
            if (!relevant) return;
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                if (state.signedInAccountId !== owner || state.currentView !== view) return;
                if (view === 'explore') refreshVisibleExplorePeople();
                void refreshConnectedView(view).then(refreshOpenCloudComments).catch(() => {});
            }, 180);
        });
    }
    channel = next.subscribe();
}
