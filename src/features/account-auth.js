import { getSupabaseClient } from '../storage/supabase.js';

export function profileDetails(form) {
    const username = form.elements.username.value.trim().toLowerCase();
    const displayName = form.elements.displayName.value.trim();
    if (!/^[a-z0-9._]{8,20}$/.test(username)) throw new Error('Choose a username with 8–20 letters, numbers, dots or underscores.');
    if (!displayName || displayName.length > 100) throw new Error('Enter a display name up to 100 characters.');
    return { username, display_name: displayName };
}

export async function ensureSupabaseProfile(client, user, details = user.user_metadata) {
    const result = await client.from('profiles').select('id,username,display_name,bio').eq('id', user.id).maybeSingle();
    if (result.error) throw result.error;
    if (result.data) return result.data;
    if (!/^[a-z0-9._]{8,20}$/.test(details?.username || '') || !details?.display_name) return null;
    const created = await client.from('profiles').insert({
        id: user.id,
        username: details.username,
        display_name: details.display_name,
    }).select('id,username,display_name,bio').single();
    if (created.error?.code === '23505') {
        const retry = await client.from('profiles').select('id,username,display_name,bio').eq('id', user.id).maybeSingle();
        if (retry.error) throw retry.error;
        return retry.data;
    }
    if (created.error) throw created.error;
    return created.data;
}

export async function signOutAccount() {
    const client = await getSupabaseClient();
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) throw error;
    window.location.reload();
}
