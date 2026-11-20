import { getSupabaseClient } from './supabase.js';
import { state } from '../core/state.js';
import { avatarLookup, rememberCloudPerson } from '../features/cloud-people.js';

const commentFields = 'id,author_id,body,created_at';
const authorFields = '(username,display_name,avatar_path)';
export const imageCommentProjection = commentFields + ',author:profiles!image_post_comments_author_id_fkey!inner' + authorFields;
export const cloudMediaCommentCounts = 'cloud_comments:media_comments(count)';

function hydrateComment(row, avatars, previous = {}) {
    const author = rememberCloudPerson({ ...row.author, id: row.author_id }, avatars);
    return {
        ...previous, id: row.id, cloudAuthorId: row.author_id, user: author.name, handle: author.handle,
        avatar: author.avatar, text: row.body, createdAt: Date.parse(row.created_at),
        replies: row.replies ? row.replies.map(reply => hydrateComment(reply, avatars)) : previous.replies,
    };
}

export function hydrateImageComments(rows, avatars, previousItems = []) {
    return rows.map(row => hydrateComment(row, avatars, previousItems.find(comment => comment.id === row.id)));
}

export function hasCloudComments(entity) {
    return Boolean(entity.cloudClientId || (entity.reel && entity.cloudContentId));
}

export async function readCloudComments(entity, targetId = null) {
    const client = await getSupabaseClient();
    const table = entity.reel ? 'media_comments' : 'image_post_comments';
    const parentColumn = entity.reel ? 'media_comment_id' : 'image_comment_id';
    const projection = commentFields + ',author:profiles!' + table + '_author_id_fkey!inner' + authorFields;
    const threadProjection = projection + ',replies:comment_replies!comment_replies_' + parentColumn +
        '_fkey(' + commentFields + ',author:profiles!comment_replies_author_id_fkey!inner' + authorFields + ')';
    let supportsReplies = true;
    const query = options => {
        let request = client.from(table).select(supportsReplies ? threadProjection : projection, options);
        request = entity.reel ? request.eq('content_id', entity.cloudContentId)
            : request.eq('post_owner_id', entity.cloudOwnerId).eq('post_client_id', entity.cloudClientId);
        return supportsReplies ? request.order('created_at', { referencedTable: 'replies' })
            .order('id', { referencedTable: 'replies' }).limit(100, { referencedTable: 'replies' }) : request;
    };
    const list = () => query({ count: 'exact' }).order('created_at', { ascending: false }).order('id').limit(100);
    let result = await list();
    if (['PGRST200', 'PGRST205', '42P01'].includes(result.error?.code)) {
        supportsReplies = false;
        result = await list();
    }
    if (result.error) throw result.error;
    const rows = [...result.data];
    if (targetId && !rows.some(row => row.id === targetId)) {
        const { data: target, error } = await query().eq('id', targetId).maybeSingle();
        if (error) throw error;
        if (target) rows.push(target);
    }
    const profiles = rows.flatMap(row => [row.author, ...(row.replies || []).map(reply => reply.author)]);
    const avatars = await avatarLookup(client, profiles);
    const items = hydrateImageComments(rows, avatars, entity.commentItems);
    if (supportsReplies) {
        const replies = items.flatMap(comment => comment.replies || []);
        const groups = [[entity.reel ? 'media' : 'image', items], ['reply', replies]];
        await Promise.all(groups.map(async ([kind, comments]) => {
            const pageSize = 500;
            for (let start = 0; start < comments.length; start += pageSize) {
                const batch = comments.slice(start, start + pageSize);
                const { data, error } = await client.rpc('comment_like_summary', {
                    comment_kind: kind, ids: batch.map(comment => comment.id),
                });
                if (error) throw error;
                const byId = new Map(data.map(entry => [entry.target_id, entry]));
                for (const comment of batch) {
                    comment.likes = Number(byId.get(comment.id)?.total) || 0;
                    comment.liked = Boolean(byId.get(comment.id)?.liked);
                }
            }
        }));
    }
    return { count: result.count, items, supportsReplies };
}

export async function setCloudCommentLike(entity, comment, reply, liked) {
    const client = await getSupabaseClient();
    const accountId = state.signedInAccountId;
    const table = client.from('comment_likes');
    const column = reply ? 'reply_id' : entity.reel ? 'media_comment_id' : 'image_comment_id';
    const { error } = await (liked ? table.insert({ [column]: comment.id })
        : table.delete().eq(column, comment.id).eq('user_id', accountId));
    if (error && error.code !== '23505') throw error;
}

export async function writeCloudComment(entity, text, id, parentId = null) {
    const client = await getSupabaseClient();
    const table = parentId ? 'comment_replies' : entity.reel ? 'media_comments' : 'image_post_comments';
    const location = parentId
        ? { [entity.reel ? 'media_comment_id' : 'image_comment_id']: parentId }
        : entity.reel ? { content_id: entity.cloudContentId }
            : { post_owner_id: entity.cloudOwnerId, post_client_id: entity.cloudClientId };
    const { error } = await client.from(table).insert({ id, ...location, body: text });
    // A retry after a lost response can find the same comment already committed.
    if (error && error.code !== '23505') throw error;
}

export async function deleteCloudComment(entity, id) {
    const client = await getSupabaseClient();
    const table = entity.reel ? 'media_comments' : 'image_post_comments';
    const { error } = await client.from(table).delete().eq('id', id).select('id').single();
    if (error) throw error;
}
