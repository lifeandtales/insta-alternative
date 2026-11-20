import { refreshOpenImageLikers } from './likes.js';
import { refreshOpenCloudComments } from './comments.js';
import { state } from '../core/state.js';
import { refreshConnectedView } from '../core/navigation.js';
import { refreshVisibleExplorePeople } from './explore.js';
import { loadCloudStories } from '../storage/cloud-stories.js';
import { renderStories } from './stories.js';
import { getSupabaseClient } from '../storage/supabase.js';
import { handleHomeNotificationEvent, refreshHomeNotifications } from './notifications.js';

let liveOwner;
let channel;
let refreshTimer;
let storyRefreshTimer;

export async function subscribeToSocialUpdates(owner) {
    if (liveOwner === owner) return;
    const client = await getSupabaseClient();
    if (state.signedInAccountId !== owner || liveOwner === owner || typeof client.channel !== 'function') return;
    if (channel) await client.removeChannel(channel);
    liveOwner = owner;
    const next = client.channel('connected-social-' + owner);
    for (const event of ['INSERT', 'UPDATE']) {
        next.on('postgres_changes', { event, schema: 'public', table: 'app_notifications', filter: 'recipient_id=eq.' + owner }, change => {
            if (owner === state.signedInAccountId && !document.hidden) handleHomeNotificationEvent(change.new, event === 'INSERT');
        });
    }
    for (const table of ['media_comments', 'comment_replies']) {
        next.on('postgres_changes', { event: 'INSERT', schema: 'public', table }, () => {
            if (state.signedInAccountId === owner && !document.hidden) void refreshOpenCloudComments().catch(() => {});
        });
    }
    for (const [table, column] of [['group_invitations', 'recipient_id'], ['group_members', 'user_id']]) {
        next.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter: column + '=eq.' + owner }, () => {
            if (owner === state.signedInAccountId && !document.hidden && state.currentView === 'messages') {
                void refreshConnectedView('messages').catch(() => {});
            }
        });
    }
    for (const table of ['profiles', 'account_follows', 'messages', 'image_posts', 'media_content', 'image_post_comments', 'conversation_preferences', 'message_reactions']) {
        for (const event of table === 'media_content' ? ['INSERT', 'UPDATE', 'DELETE'] : ['INSERT', 'UPDATE']) next.on('postgres_changes', { event, schema: 'public', table }, () => {
            if (owner !== state.signedInAccountId || document.hidden) return;
            const view = state.currentView;
            const relevant = table === 'profiles' || table === 'account_follows'
                || (['messages', 'conversation_preferences', 'message_reactions'].includes(table) && view === 'messages')
                || (table === 'image_posts' && ['home', 'profile', 'explore'].includes(view))
                || (table === 'image_post_comments' && ['home', 'profile', 'explore'].includes(view))
                || (table === 'media_content' && ['home', 'reels', 'messages'].includes(view));
            if (!relevant) return;
            clearTimeout(refreshTimer);
            refreshTimer = setTimeout(() => {
                if (state.signedInAccountId !== owner || state.currentView !== view) return;
                if (view === 'explore') refreshVisibleExplorePeople();
                void refreshConnectedView(view).then(() => Promise.all([refreshOpenCloudComments(), refreshOpenImageLikers()])).catch(() => {});
            }, 180);
        });
    }
    channel = next.subscribe(status => {
        if (status === 'SUBSCRIBED' && owner === state.signedInAccountId) {
            void refreshHomeNotifications().catch(() => {});
        }
    });
    window.clearInterval?.(storyRefreshTimer);
    storyRefreshTimer = window.setInterval?.(() => {
        if (state.signedInAccountId !== owner || state.currentView !== 'home' || document.hidden) return;
        void loadCloudStories().then(() => {
            if (state.signedInAccountId === owner && state.currentView === 'home') renderStories();
        }).catch(() => {});
    }, 60000);
}
