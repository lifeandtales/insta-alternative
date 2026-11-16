import { getSupabaseClient } from './supabase.js';

const signedAvatars = new Map();

export async function cloudAvatarUrls(client, paths) {
    const unique = [...new Set(paths.filter(Boolean))];
    const now = Date.now();
    const missing = unique.filter(path => (signedAvatars.get(path)?.expires || 0) <= now);
    if (missing.length) {
        const { data } = await client.storage.from('avatars').createSignedUrls(missing, 300);
        for (const item of data || []) {
            if (item.signedUrl) signedAvatars.set(item.path, { url: item.signedUrl, expires: now + 240000 });
        }
    }
    for (const [path, item] of signedAvatars) {
        if (item.expires <= now) signedAvatars.delete(path);
    }
    return new Map(unique.map(path => [path, signedAvatars.get(path)?.url]));
}

export async function saveCloudAvatar(ownerId, image) {
    const client = await getSupabaseClient();
    const bucket = client.storage.from('avatars');
    const { data: profile, error: lookupError } = await client.from('profiles').select('avatar_path')
        .eq('id', ownerId).single();
    if (lookupError) throw lookupError;
    const path = image ? `${ownerId}/${crypto.randomUUID()}.jpg` : null;
    if (image) {
        const { error } = await bucket.upload(path, image, { contentType: 'image/jpeg' });
        if (error) throw error;
    }
    const { error } = await client.from('profiles').update({ avatar_path: path })
        .eq('id', ownerId).select('id').single();
    if (error) {
        // A network failure may occur after the update commits. Keep the object for a later retry.
        if (path && error.code && !error.code.startsWith('PGRST0')) await bucket.remove([path]).catch(() => {});
        throw error;
    }
    if (profile.avatar_path && profile.avatar_path !== path) {
        signedAvatars.delete(profile.avatar_path);
        await bucket.remove([profile.avatar_path]).catch(() => {});
    }
    return path;
}

export async function readCloudAvatar(path) {
    if (!path) return '';
    const client = await getSupabaseClient();
    return (await cloudAvatarUrls(client, [path])).get(path) || '';
}
