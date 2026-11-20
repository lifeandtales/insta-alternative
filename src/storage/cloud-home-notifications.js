import { getSupabaseClient } from './supabase.js';
import { loadCloudFollowRequests } from '../features/cloud-people.js';

export async function readHomeNotificationPage(offset) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('home_notification_history', { page_offset: offset });
    if (error?.code === 'PGRST202' || error?.code === '42883') {
        const pending = (await loadCloudFollowRequests()).map(row => ({
            follower_id: row.follower_id, created_at: row.created_at, ...row.requester,
        }));
        return { items: [], pending, unread: 0, total: 0, connected: false };
    }
    if (error) throw error;
    return { ...data, connected: true };
}

export async function markHomeNotificationsRead(upTo) {
    const client = await getSupabaseClient();
    const { error } = await client.rpc('mark_home_notifications_read', { up_to: upTo });
    if (error) throw error;
}

export async function followNotificationActor(actorId) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('request_account_follow', { other_user: actorId });
    if (error) throw error;
    return data;
}
