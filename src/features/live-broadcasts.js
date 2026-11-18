import { liveBroadcastMode } from '../core/live-config.js';
import { getSupabaseClient } from '../storage/supabase.js';
import { activeLiveBroadcasts, loadLiveData } from '../storage/live-broadcasts.js';
import { state } from '../core/state.js';
import { escapeHtml as esc } from '../core/utils.js';
import { mayInteract } from '../core/social.js';
import { showShareFeedback } from '../components/feedback.js';
let sdkPromise, panel, current, opening = false;
async function sdk() {
    if (window.LivekitClient) return window.LivekitClient;
    if (!sdkPromise) sdkPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        const timeout = setTimeout(() => { script.remove(); reject(new Error('Could not load live video. Check your connection.')); }, 20000);
        script.src = 'https://cdn.jsdelivr.net/npm/livekit-client@2.24.1/dist/livekit-client.umd.js';
        script.onload = () => { clearTimeout(timeout); if (window.LivekitClient) resolve(window.LivekitClient); else reject(new Error('Could not load live video.')); };
        script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error('Could not load live video. Check your connection.')); };
        document.head.append(script);
    }).catch(error => { sdkPromise = null; throw error; });
    return sdkPromise;
}
async function server(action, id) {
    const client = await getSupabaseClient();
    const { data, error } = await client.functions.invoke('live-broadcast', { body: { action, ...(id ? { id } : {}) } });
    if (error) {
        let reason;
        try { reason = (await error.context?.json())?.error; } catch {}
        throw new Error(reason || 'Live streaming is not ready. Check the LiveKit setup and your connection.');
    }
    if (data?.error) throw new Error(data.error);
    return data;
}
function status(text) { const node = panel?.querySelector('[data-live-status]'); if (node) node.textContent = text; }
export function renderLiveCircles() {
    return activeLiveBroadcasts().map(row => `<button type="button" class="story-item live-story-item" data-open-live="${esc(row.id)}" aria-label="Watch ${esc(row.display_name)} live"><span class="story-ring live-story-ring"><img src="${esc(row.avatar)}" alt="" /><span class="live-story-badge">LIVE</span></span><span>${esc(row.display_name || row.username)}</span></button>`).join('');
}
function ensurePanel() {
    if (panel) return;
    panel = document.createElement('dialog'); panel.className = 'live-broadcast-dialog'; panel.setAttribute('aria-label', 'Live broadcast');
    document.body.append(panel);
    panel.addEventListener('cancel', event => { event.preventDefault(); void finish(); });
    panel.addEventListener('click', async event => {
        const button = event.target.closest('button'); if (!button) return;
        if (button.hasAttribute('data-live-exit')) { await finish(); return; }
        if (button.hasAttribute('data-live-start')) { await startHost(button); return; }
        const live = current; if (!live?.room) return;
        if (live.preview) {
            if (button.hasAttribute('data-live-mic') || button.hasAttribute('data-live-camera')) {
                const pressed = button.getAttribute('aria-pressed') !== 'true';
                button.setAttribute('aria-pressed', String(pressed));
                status('Preview only. These controls do not broadcast camera or microphone.');
            }
            return;
        }
        button.disabled = true;
        try {
            if (button.hasAttribute('data-live-mic')) {
                const enabled = !live.room.localParticipant.isMicrophoneEnabled;
                await live.room.localParticipant.setMicrophoneEnabled(enabled);
                button.setAttribute('aria-pressed', String(!enabled)); button.setAttribute('aria-label', enabled ? 'Mute microphone' : 'Unmute microphone');
            } else if (button.hasAttribute('data-live-camera')) {
                const enabled = !live.room.localParticipant.isCameraEnabled;
                await live.room.localParticipant.setCameraEnabled(enabled);
                button.setAttribute('aria-pressed', String(!enabled)); button.setAttribute('aria-label', enabled ? 'Turn camera off' : 'Turn camera on');
                const publication = live.room.localParticipant.getTrackPublication((await sdk()).Track.Source.Camera);
                if (publication?.track) publication.track.attach(panel.querySelector('video'));
            } else if (button.hasAttribute('data-live-play')) {
                await live.room.startAudio(); await panel.querySelector('video').play(); button.hidden = true;
            }
        } catch { status('Could not change this control. Check camera and microphone permissions.'); }
        finally { button.disabled = false; }
    });
}
const svg = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true">${path}</svg>`;
function draw(host, title) {
    ensurePanel();
    panel.innerHTML = `<header><strong>${esc(title)}</strong><span class="live-label">LIVE</span></header><p data-live-status role="status">${host ? 'Followers will be notified after your camera and microphone connect.' : 'Connecting to live…'}</p><div class="live-video-stage"><video playsinline autoplay ${host ? 'muted' : ''}></video><div data-live-audio></div></div><footer>${host ? `<button type="button" data-live-start>Go Live</button><button type="button" data-live-mic hidden aria-label="Mute microphone" aria-pressed="false">${svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3"/>')}</button><button type="button" data-live-camera hidden aria-label="Turn camera off" aria-pressed="false">${svg('<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-3v10l-6-3"/>')}</button>` : ''}<button type="button" data-live-play hidden>Tap to play</button><button type="button" data-live-exit>${host ? 'Cancel' : 'Leave'}</button></footer>`;
    if (liveBroadcastMode === 'preview') {
        panel.querySelector('[data-live-status]').textContent = 'Preview only. LiveKit is not connected; no video or notifications will be sent.';
        if (host) panel.querySelector('[data-live-start]').textContent = 'Start preview';
    }
    panel.querySelector('.live-label').hidden = true;
    if (!panel.open) { panel.showModal(); window.history.pushState({ ...window.history.state, liveBroadcast: true }, ''); }
}
function attachRoom(live, kit) {
    const room = live.room;
    room.on(kit.RoomEvent.TrackSubscribed, track => {
        if (current !== live) return;
        if (track.kind === 'video') track.attach(panel.querySelector('video'));
        else { const element = track.attach(); element.autoplay = true; panel.querySelector('[data-live-audio]').append(element); }
    });
    room.on(kit.RoomEvent.TrackUnsubscribed, track => { track.detach().forEach(element => { if (element.tagName !== 'VIDEO') element.remove(); }); });
    room.on(kit.RoomEvent.Reconnecting, () => { if (current === live) status('Reconnecting…'); });
    room.on(kit.RoomEvent.Reconnected, () => { if (current === live) status('Live'); });
    room.on(kit.RoomEvent.Disconnected, () => { if (current === live) void finish('Live disconnected.'); });
    room.on(kit.RoomEvent.AudioPlaybackStatusChanged, () => {
        if (current === live) panel.querySelector('[data-live-play]').hidden = room.canPlaybackAudio;
    });
}
async function startHost(button) {
    if (opening || current || !mayInteract()) return;
    if (liveBroadcastMode === 'preview') {
        current = { preview: true, host: true, owner: state.signedInAccountId, room: {} };
        status('Live screen preview. Nothing is broadcast and followers are not notified.');
        const label = panel.querySelector('.live-label'); label.textContent = 'PREVIEW'; label.hidden = false;
        button.hidden = true;
        panel.querySelectorAll('[data-live-mic], [data-live-camera]').forEach(control => { control.hidden = false; });
        panel.querySelector('[data-live-exit]').textContent = 'End preview';
        panel.querySelector('video').hidden = true;
        panel.querySelector('.live-video-stage').insertAdjacentHTML('beforeend', '<div class="live-preview-placeholder"><span aria-hidden="true">◉</span><strong>Live preview</strong><p>Your camera video will appear here once LiveKit is connected.</p></div>');
        return;
    }
    opening = true; button.disabled = true;
    const live = { host: true, owner: state.signedInAccountId }; current = live;
    try {
        const kit = await sdk();
        const prepared = await server('start'); live.id = prepared.id;
        if (current !== live) { await server('end', live.id); return; }
        live.room = new kit.Room({ adaptiveStream: true, dynacast: true }); attachRoom(live, kit);
        await live.room.connect(prepared.url, prepared.token);
        if (current !== live) { await release(live); return; }
        await live.room.localParticipant.setCameraEnabled(true);
        if (current !== live) { await release(live); return; }
        await live.room.localParticipant.setMicrophoneEnabled(true);
        if (current !== live) { await release(live); return; }
        const camera = live.room.localParticipant.getTrackPublication(kit.Track.Source.Camera);
        if (camera?.track) camera.track.attach(panel.querySelector('video'));
        const { error } = await (await getSupabaseClient()).rpc('activate_live_broadcast', { target: live.id });
        if (error) throw error;
        status('You are live. Followers can now join.');
        panel.querySelector('.live-label').hidden = false;
        button.hidden = true;
        panel.querySelectorAll('[data-live-mic], [data-live-camera]').forEach(control => { control.hidden = false; });
        panel.querySelector('[data-live-exit]').textContent = 'End live';
        startValidityChecks(live);
        void loadLiveData().catch(() => {});
    } catch (error) {
        const message = ['NotAllowedError', 'NotFoundError', 'NotReadableError'].includes(error?.name)
            ? 'Could not open your camera or microphone. Check permissions and try again.' : error.message || 'Could not start live.';
        if (current === live) current = null; await release(live);
        if (panel.open) status(message);
    } finally { opening = false; if (button.isConnected) button.disabled = false; }
}
export async function openLiveBroadcast(id) {
    if (opening || current || !state.signedInAccountId) return;
    if (liveBroadcastMode === 'preview') { draw(false, 'Viewer preview'); status('Viewer preview only. LiveKit is not connected yet.'); return; }
    opening = true;
    const live = { host: false, id, owner: state.signedInAccountId }; current = live;
    draw(false, activeLiveBroadcasts().find(row => row.id === id)?.display_name || 'Live broadcast');
    try {
        const [kit, credentials] = await Promise.all([sdk(), server('join', id)]);
        if (current !== live) return;
        if (credentials.host) { status('Your live is open on another device. Manage it from that device.'); current = null; return; }
        live.room = new kit.Room({ adaptiveStream: true }); attachRoom(live, kit);
        await live.room.connect(credentials.url, credentials.token);
        if (current !== live) return;
        status('Live'); panel.querySelector('.live-label').hidden = false;
        panel.querySelector('[data-live-play]').hidden = live.room.canPlaybackAudio;
        startValidityChecks(live);
    } catch (error) {
        if (current === live) current = null; await release(live);
        if (panel.open) status(error.message || 'Could not join live.');
    } finally { opening = false; }
}
function startValidityChecks(live) {
    let checking = false;
    live.timer = setInterval(async () => {
        if (checking || current !== live) return; checking = true;
        try {
            if (state.signedInAccountId !== live.owner) { await finish('Live closed after account change.'); return; }
            const client = await getSupabaseClient();
            if (live.host) {
                const response = await client.rpc('heartbeat_live_broadcast', { target: live.id });
                if (!response.error && response.data === false) await finish('This live has ended.');
            } else {
                const response = await client.from('live_broadcasts').select('status,expires_at').eq('id', live.id).maybeSingle();
                if (!response.error && (!response.data || response.data.status !== 'live' || Date.parse(response.data.expires_at) <= Date.now())) await finish('This live has ended or access has changed.');
            }
        } catch {} finally { checking = false; }
    }, 15000);
}
async function release(live) {
    if (live.preview) return;
    clearInterval(live.timer);
    await live.room?.disconnect().catch(() => {});
    if (live.host && live.id) await server('end', live.id).catch(() => {});
}
async function finish(message) {
    const live = current; current = null;
    if (panel?.open) panel.close();
    if (window.history.state?.liveBroadcast) window.history.back();
    if (live) await release(live);
    if (message) showShareFeedback(message);
    void loadLiveData().catch(() => {});
}
export function registerLiveEvents() {
    document.addEventListener('click', event => {
        if (event.target.closest('[data-go-live]')) {
            if (!state.signedInAccountId || !mayInteract()) { showShareFeedback('Log in to go live.'); return; }
            if (current || opening) { showShareFeedback('A live broadcast is already open.'); return; }
            const creator = document.querySelector('.story-create-backdrop'); if (creator) creator.hidden = true;
            draw(true, liveBroadcastMode === 'preview' ? 'Live preview' : 'Go Live');
        }
        const watch = event.target.closest('[data-open-live]');
        if (watch) void openLiveBroadcast(watch.dataset.openLive);
    });
    window.addEventListener('popstate', () => { if (panel?.open && !window.history.state?.liveBroadcast) void finish(); });
    window.addEventListener('pagehide', () => { if (current) void finish(); });
    window.setInterval?.(() => { if (state.signedInAccountId && !document.hidden) void loadLiveData().catch(() => {}); }, 15000);
}
