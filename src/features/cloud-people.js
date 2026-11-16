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
    const { data, error } = await client.rpc('search_explore_people', { search_text: term }).abortSignal(signal);
    if (error) throw error;
    if (signal.aborted || accountId !== state.signedInAccountId) return [];
    return data.map(row => {
        const handle = '@' + row.username;
        const person = { id: row.id, handle, name: row.display_name, avatar: DEFAULT_AVATAR,
            bio: row.bio, isPrivate: row.is_private, followStatus: row.follow_status };
        directory().set(handle, person);
        return person;
    });
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
