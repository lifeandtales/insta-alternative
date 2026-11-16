import { avatarLookup, rememberCloudPerson } from '../features/cloud-people.js';
import { getSupabaseClient } from './supabase.js';

export async function setImagePostLike(post, liked) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('set_image_post_like', {
        target_owner: post.cloudOwnerId, target_post: post.cloudClientId, desired: liked,
    });
    if (error) throw error;
    return data;
}

export async function readImagePostLikers(post) {
    const client = await getSupabaseClient();
    const { data, count, error } = await client.from('image_post_likes')
        .select('user_id,person:profiles!image_post_likes_user_id_fkey!inner(username,display_name,avatar_path)', { count: 'exact' })
        .eq('post_owner_id', post.cloudOwnerId).eq('post_client_id', post.cloudClientId)
        .order('created_at', { ascending: false }).order('user_id').limit(50);
    if (error) throw error;
    const avatars = await avatarLookup(client, data.map(row => row.person));
    return { count, people: data.map(row => rememberCloudPerson({ ...row.person, id: row.user_id }, avatars)) };
}
