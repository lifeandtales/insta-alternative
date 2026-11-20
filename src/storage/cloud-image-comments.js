import { getSupabaseClient } from './supabase.js';
import { avatarLookup, rememberCloudPerson } from '../features/cloud-people.js';

export const imageCommentProjection = 'id,author_id,body,created_at,author:profiles!image_post_comments_author_id_fkey!inner(username,display_name,avatar_path)';

export function hydrateImageComments(rows, avatars, previousItems = []) {
    return rows.map(row => {
        const author = rememberCloudPerson({ ...row.author, id: row.author_id }, avatars);
        const previous = previousItems.find(comment => comment.id === row.id);
        return { ...previous, id: row.id, cloudAuthorId: row.author_id, user: author.name,
            handle: author.handle, avatar: author.avatar, text: row.body, createdAt: Date.parse(row.created_at) };
    });
}

export async function readImageComments(post, targetId = null) {
    const client = await getSupabaseClient();
    const query = (options) => client.from('image_post_comments')
        .select(imageCommentProjection, options)
        .eq('post_owner_id', post.cloudOwnerId).eq('post_client_id', post.cloudClientId);
    const { data, count, error } = await query({ count: 'exact' })
        .order('created_at', { ascending: false }).order('id').limit(100);
    if (error) throw error;
    const rows = [...data];
    if (targetId && !rows.some(row => row.id === targetId)) {
        const { data: target, error: targetError } = await query().eq('id', targetId).maybeSingle();
        if (targetError) throw targetError;
        if (target) rows.push(target);
    }
    const avatars = await avatarLookup(client, rows.map(row => row.author));
    return { count, items: hydrateImageComments(rows, avatars, post.commentItems) };
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
