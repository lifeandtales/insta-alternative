import { state } from '../core/state.js';
import { getSupabaseClient } from '../storage/supabase.js';

let nativeQueue = Promise.resolve();

export function supportsAndroidPush() {
    return Boolean(window.InstaNativePush);
}

function nativeRequest(action) {
    const request = nativeQueue.then(() => sendNativeRequest(action));
    nativeQueue = request.catch(() => {});
    return request;
}

function sendNativeRequest(action) {
    const bridge = window.InstaNativePush;
    return new Promise((resolve, reject) => {
        const timeout = window.setTimeout(() => finish(new Error('Android notification request timed out.')), 60000);
        function finish(error, result) {
            clearTimeout(timeout);
            bridge.onmessage = null;
            if (error) reject(error);
            else resolve(result);
        }
        bridge.onmessage = event => {
            try {
                const result = JSON.parse(event.data);
                finish(result.error ? new Error(result.error) : null, result);
            } catch (error) {
                finish(error);
            }
        };
        try { bridge.postMessage(action); }
        catch (error) { finish(error); }
    });
}

function storageKey() {
    return `insta-push-installation:${state.signedInAccountId}`;
}

export async function enableAndroidPush({ sync = false } = {}) {
    if (!supportsAndroidPush() || !state.signedInAccountId) return;
    const key = storageKey();
    const existing = localStorage.getItem(key);
    if (sync && !existing) return;
    const installationId = existing || crypto.randomUUID();
    const { token, supportsReply } = await nativeRequest(sync ? 'sync' : 'enable');
    const client = await getSupabaseClient();
    const { error } = await client.from('android_push_devices').upsert({
        user_id: state.signedInAccountId, installation_id: installationId, token,
        ...(supportsReply ? { supports_reply: true } : {}),
    }, { onConflict: 'user_id,installation_id' });
    if (error) throw error;
    localStorage.setItem(key, installationId);
}

export async function disableAndroidPush() {
    if (!supportsAndroidPush() || !state.signedInAccountId) return;
    const key = storageKey();
    const installationId = localStorage.getItem(key);
    if (!installationId) return;
    const client = await getSupabaseClient();
    const { error } = await client.from('android_push_devices').delete().eq('installation_id', installationId);
    if (error) {
        await nativeRequest('disable');
    } else {
        await nativeRequest('disable').catch(() => {});
    }
    localStorage.removeItem(key);
}
