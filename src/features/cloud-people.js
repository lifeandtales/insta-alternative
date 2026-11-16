import { cloudAvatarUrls } from '../storage/cloud-avatars.js';
import { state } from '../core/state.js';
import { DEFAULT_AVATAR } from '../core/social.js';
import { getSupabaseClient } from '../storage/supabase.js';

let owner;
const people = new Map();

function directory() {
    if (owner !== state.signedInAccountId) {
        owner = state.signedInAccountId;
        people.clear();
    }
    return people;
}

export function cloudPerson(handle) {
    return directory().get(handle);
}

export function cloudFollowLabel(person) {
    if (person.followStatus === 'accepted') return 'Following';
    if (person.followStatus === 'requested') return 'Requested';
    return person.isPrivate ? 'Request to follow' : 'Follow';
}

export async function searchCloudPeople(term, signal) {
    const accountId = state.signedInAccountId;
    if (!accountId) return [];
    const client = await getSupabaseClient();
    if (signal.aborted) return [];
    let result = await client.rpc('search_social_people', { search_text: term }).abortSignal(signal);
    if (result.error?.code === 'PGRST202') result = await client.rpc('search_explore_people', { search_text: term }).abortSignal(signal);
    if (result.error) throw result.error;
    const urls = await avatarLookup(client, result.data);
    if (signal.aborted || accountId !== state.signedInAccountId) return [];
    return result.data.map(row => rememberCloudPerson(row, urls));
}

export async function toggleCloudFollow(person) {
    const client = await getSupabaseClient();
    if (person.followStatus) {
        const { error } = await client.from('account_follows').delete()
            .eq('follower_id', state.signedInAccountId).eq('followed_id', person.id);
        if (error) throw error;
        person.followStatus = null;
        return 'Follow removed.';
    }
    const { data, error } = await client.rpc('request_account_follow', { other_user: person.id });
    if (error) throw error;
    person.followStatus = data;
    return data === 'requested' ? 'Follow request sent.' : 'Now following.';
}

export async function loadCloudFollowRequests() {
    const client = await getSupabaseClient();
    const { data, error } = await client.from('account_follows')
        .select('follower_id, requester:profiles!account_follows_follower_id_fkey!inner(username,display_name)')
        .eq('followed_id', state.signedInAccountId).eq('status', 'requested')
        .order('created_at', { ascending: false }).limit(50);
    if (error) throw error;
    return data;
}

export async function reviewCloudFollowRequest(followerId, accept) {
    const client = await getSupabaseClient();
    const table = client.from('account_follows');
    const action = accept ? table.update({ status: 'accepted' }) : table.delete();
    const { data, error } = await action.eq('follower_id', followerId)
        .eq('followed_id', state.signedInAccountId).eq('status', 'requested').select('follower_id');
    if (error) throw error;
    return data.length > 0;
}

export function avatarLookup(client, rows) {
    return cloudAvatarUrls(client, rows.map(row => row.avatar_path));
}

export function rememberCloudPerson(row, urls) {
    const handle = '@' + row.username;
    const people = directory();
    const person = people.get(handle) || { id: row.id, handle, avatar: DEFAULT_AVATAR };
    person.id = row.id;
    person.name = row.display_name;
    if (urls && 'avatar_path' in row) person.avatar = urls.get(row.avatar_path) || DEFAULT_AVATAR;
    if ('bio' in row) person.bio = row.bio;
    if ('is_private' in row) person.isPrivate = row.is_private;
    if ('follow_status' in row) person.followStatus = row.follow_status;
    if ('mutual' in row) person.mutual = row.mutual;
    people.set(handle, person);
    return person;
}

export async function fetchSocialProfile(id) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('social_profile', { target: id });
    if (error) throw error;
    if (!data) return null;
    const person = rememberCloudPerson(data, await avatarLookup(client, [data]));
    person.followers = data.followers;
    person.following = data.following;
    return person;
}

export async function fetchSocialConnections(id, direction, offset) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('social_connections', { target: id, direction, page_offset: offset });
    if (error) throw error;
    const urls = await avatarLookup(client, data);
    return data.map(row => rememberCloudPerson(row, urls));
}

export async function loadCloudFollowing() {
    const owner = state.signedInAccountId;
    if (!owner) return;
    const client = await getSupabaseClient();
    const { data, error } = await client.from('account_follows').select('followed_id')
        .eq('follower_id', owner).eq('status', 'accepted');
    if (error) throw error;
    if (state.signedInAccountId === owner) state.cloudFollowingIds = new Set(data.map(row => row.followed_id));
}

export async function setCloudBlock(handle, blocked) {
    const owner = state.signedInAccountId;
    if (!owner) return;
    const key = 'insta-cloud-block:' + owner + ':' + handle;
    const peer = cloudPerson(handle)?.id || localStorage.getItem(key);
    if (!peer) return;
    const client = await getSupabaseClient();
    const table = client.from('account_blocks');
    const result = blocked
        ? await table.upsert({ blocker_id: owner, blocked_id: peer }, { ignoreDuplicates: true })
        : await table.delete().eq('blocker_id', owner).eq('blocked_id', peer);
    if (result.error) throw result.error;
    try {
        if (blocked) localStorage.setItem(key, peer);
        else localStorage.removeItem(key);
    } catch {}
}
