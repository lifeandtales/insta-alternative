import { getSupabaseClient, supabaseProjectUrl } from '../storage/supabase.js';

function supportsWebPush() {
    return Boolean(window.isSecureContext && navigator.serviceWorker && window.PushManager && window.Notification);
}

async function registration() {
    return navigator.serviceWorker.register(new URL('../../push-sw.js', import.meta.url));
}

export async function enableWebPush() {
    if (!supportsWebPush()) throw new Error('Push notifications are unavailable in this browser.');
    if (await Notification.requestPermission() !== 'granted') throw new Error('Allow notifications in your browser settings.');
    const response = await fetch(`${supabaseProjectUrl}/functions/v1/web-push`);
    if (!response.ok) throw new Error('Push delivery has not been configured yet.');
    const { publicKey } = await response.json();
    const serviceWorker = await registration();
    await navigator.serviceWorker.ready;
    let subscription = await serviceWorker.pushManager.getSubscription();
    const created = !subscription;
    if (!subscription) subscription = await serviceWorker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    const { endpoint, keys } = subscription.toJSON();
    try {
        const client = await getSupabaseClient();
        const { error } = await client.from('web_push_subscriptions').upsert({
            endpoint, p256dh: keys.p256dh, auth_secret: keys.auth,
        });
        if (error) throw error;
    } catch (error) {
        if (created) await subscription.unsubscribe().catch(() => {});
        throw error;
    }
}

export async function disableWebPush() {
    if (!supportsWebPush()) return;
    const workerUrl = new URL('../../push-sw.js', import.meta.url);
    const worker = await navigator.serviceWorker.getRegistration(workerUrl.href);
    const subscription = await worker?.pushManager.getSubscription();
    if (!subscription) return;
    const client = await getSupabaseClient();
    const { error } = await client.from('web_push_subscriptions').delete().eq('endpoint', subscription.endpoint);
    await subscription.unsubscribe();
    if (error) throw error;
}
