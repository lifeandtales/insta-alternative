import { getAccount } from './social.js';
import { state } from './state.js';
import { currentUser } from '../data/sample-data.js';
import { cloudPerson, fetchSocialProfile } from '../features/cloud-people.js';
import { getSupabaseClient } from '../storage/supabase.js';

const webProfileBase = 'https://lifeandtales.github.io/insta-alternative/';
const androidProfileBase = 'https://appassets.androidplatform.net/';
const accountId = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;

export function profileReferenceFromHash(hash) {
    const id = /^#profile-id-(.+)$/.exec(hash || '')?.[1];
    if (id) return accountId.test(id) ? { id: id.toLowerCase() } : null;
    const match = /^#profile-(.+)$/.exec(hash || '');
    if (!match) return null;
    try {
        const handle = decodeURIComponent(match[1]).toLowerCase();
        return /^@[a-z0-9._]{1,32}$/.test(handle) ? { handle } : null;
    } catch {
        return null;
    }
}

export function profileReferenceFromQr(value, base = window.location.href) {
    let url;
    try {
        url = new URL(value);
        if (url.username || url.password) return null;
        const isAppLink = [webProfileBase, androidProfileBase, base].some(link => {
            const home = new URL(link);
            const normalize = path => path.replace(/(?:\/index\.html|\/)$|^\/$/g, '');
            return url.origin === home.origin && normalize(url.pathname) === normalize(home.pathname);
        });
        return isAppLink ? profileReferenceFromHash(url.hash) : null;
    } catch {
        return null;
    }
}

export function profileUrl(handle) {
    const owner = state.signedInAccountId;
    const id = owner && (handle === currentUser.handle ? owner : cloudPerson(handle)?.id);
    const url = new URL(owner ? webProfileBase : window.location.href);
    url.search = '';
    url.hash = id && accountId.test(id) ? `profile-id-${id}` : `profile-${encodeURIComponent(handle)}`;
    return url.toString();
}

export async function resolveProfileReference(reference) {
    const owner = state.signedInAccountId;
    if (!reference || state.deletionRequestedAt) return null;
    if (!owner) return getAccount(reference.handle)?.handle || null;
    if (reference.id === owner || reference.handle === currentUser.handle) return currentUser.handle;
    if (state.blockedHandles.has(reference.handle)) return null;
    let id = reference.id;
    if (!id) {
        const client = await getSupabaseClient();
        const { data, error } = await client.from('profiles').select('id')
            .eq('username', reference.handle.slice(1)).maybeSingle();
        if (error) throw error;
        id = data?.id;
    }
    if (!id || owner !== state.signedInAccountId) return null;
    const person = await fetchSocialProfile(id);
    if (owner !== state.signedInAccountId || !person || state.blockedHandles.has(person.handle)) return null;
    return person.handle;
}
