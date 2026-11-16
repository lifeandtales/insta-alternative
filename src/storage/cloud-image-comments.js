import { getSupabaseClient } from './supabase.js';
import { avatarLookup, rememberCloudPerson } from '../features/cloud-people.js';

export async function readImageComments(post) {
    const client = await getSupabaseClient();
    const { data, count, error } = await client.from('image_post_comments')
        .select('id,author_id,body,created_at,author:profiles!image_post_comments_author_id_fkey!inner(username,display_name,avatar_path)', { count: 'exact' })
        .eq('post_owner_id', post.cloudOwnerId).eq('post_client_id', post.cloudClientId)
        .order('created_at', { ascending: false }).order('id').limit(100);
    if (error) throw error;
    const avatars = await avatarLookup(client, data.map(row => row.author));
    return {
        count,
        items: data.map(row => {
            const author = rememberCloudPerson({ ...row.author, id: row.author_id }, avatars);
            const previous = post.commentItems?.find(comment => comment.id === row.id);
            return { ...previous, id: row.id, cloudAuthorId: row.author_id, user: author.name,
                handle: author.handle, avatar: author.avatar, text: row.body, createdAt: Date.parse(row.created_at) };
        })
    };
}

export async function writeImageComment(post, text, id) {
    const client = await getSupabaseClient();
    const { error } = await client.from('image_post_comments').insert({
        id, post_owner_id: post.cloudOwnerId, post_client_id: post.cloudClientId, body: text
    });
    // A retry after a lost response can find the same comment already committed.
    if (error && error.code !== '23505') throw error;
}

export async function deleteImageComment(id) {
    const client = await getSupabaseClient();
    const { error } = await client.from('image_post_comments').delete().eq('id', id).select('id').single();
    if (error) throw error;
}
