import { state } from '../core/state.js';
import { getSupabaseClient } from '../storage/supabase.js';
import { showShareFeedback } from '../components/feedback.js';

const stun = [{ urls: 'stun:stun.l.google.com:19302' }];
const callColumns = 'id,conversation_id,caller_id,recipient_id,kind,status,offer,answer,expires_at';
let current;
let checking = false;

function dialog() {
    return document.getElementById('direct-call-dialog');
}

const handset = '<path d="M6 4h3l2 5-2 2a14 14 0 0 0 4 4l2-2 5 2v3a2 2 0 0 1-2 2A16 16 0 0 1 4 6a2 2 0 0 1 2-2Z"/>';
const micIcon = '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0m-7 7v3m-3 0h6"/>';
const cameraIcon = '<rect x="3" y="6" width="12" height="12" rx="2"/><path d="m15 10 6-3v10l-6-3"/>';
const offSlash = '<path class="call-icon-slash" d="m3 3 18 18"/>';

function callButton(action, label, artwork, { hidden = false, toggle = false } = {}) {
    return `<button type="button" class="call-control" data-call-${action} aria-label="${label}" title="${label}"${hidden ? ' hidden' : ''}${toggle ? ' aria-pressed="false"' : ''}>
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${artwork}</svg>
      </button>`;
}

function render(call, status) {
    const panel = dialog();
    if (!panel.open) {
        panel.querySelector('[data-call-play]').hidden = true;
        panel.showModal();
    }
    panel.classList.toggle('call-video-active', call.kind === 'video' &&
        Boolean(panel.querySelector('[data-call-remote]').srcObject));
    panel.querySelector('[data-call-title]').textContent = (call.kind === 'video' ? 'Video call' : 'Voice call') + ' · ' + call.name;
    panel.querySelector('[data-call-status]').textContent = status;
    panel.querySelector('[data-call-answer]').hidden = !call.incoming || call.accepting || Boolean(call.peer);
    const hangup = panel.querySelector('[data-call-hangup]');
    const hangupLabel = call.incoming && !call.accepted ? 'Decline' : 'End call';
    hangup.setAttribute('aria-label', hangupLabel);
    hangup.title = hangupLabel;
    panel.querySelector('[data-call-mic]').hidden = !call.stream;
    panel.querySelector('[data-call-camera]').hidden = !call.stream || call.kind !== 'video';
    panel.querySelector('[data-call-local]').hidden = call.kind !== 'video' || !call.stream;
    panel.querySelector('[data-call-remote]').hidden = call.kind !== 'video';
}

function closeCall(call) {
    releasePeer(call);
    if (current !== call) return;
    current = null;
    dialog().close();
}

function releasePeer(call) {
    const peer = call.peer;
    const stream = call.stream;
    call.peer = null;
    call.stream = null;
    peer?.close();
    for (const track of stream?.getTracks() || []) track.stop();
    if (current !== call) return;
    const panel = dialog();
    for (const media of panel.querySelectorAll('video, audio')) media.srcObject = null;
    panel.querySelector('[data-call-play]').hidden = true;
}

function callError(error, stage, kind, incoming = true) {
    const devices = kind === 'video' ? 'microphone and camera' : 'microphone';
    if (stage === 'devices') {
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
            return `Allow access to the ${devices}, then ${incoming ? 'tap Accept' : 'call'} again.`;
        }
        if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
            return `No available ${devices}. Check your device settings and try again.`;
        }
        if (error?.name === 'NotReadableError' || error?.name === 'AbortError') {
            return `The ${devices} could not start. Close other apps using them and try again.`;
        }
        return `The app could not open your ${devices}. Check permissions and try again.`;
    }
    if (!incoming) {
        if (stage === 'local') return 'This device could not prepare the outgoing call. Try calling again.';
        if (error?.code === '23505') return 'Another call is still open in this chat. End it or wait for it to expire.';
        if (error?.code === 'PGRST202') return 'The server has not enabled calling yet. Run the Calls migration.';
        if (error?.code === '42501') return 'Calling is unavailable for this chat. Check your follow and block settings.';
        return 'The server could not start the call. Check your internet connection and try again.';
    }
    if (stage === 'remote') return 'This device could not read the incoming call offer. Ask the caller to call again using the latest build.';
    if (stage === 'local') return 'This device could not prepare a call answer. Try accepting again.';
    return 'The server could not save your answer. Check your connection and try again.';
}

async function respond(id, action, answer) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('respond_to_direct_call', {
        target: id, action, ...(answer ? { call_answer: answer } : {})
    });
    if (error) throw error;
    return data;
}

async function finish(call, action = 'end', feedback) {
    closeCall(call);
    if (feedback) showShareFeedback(feedback);
    if (call.id) await respond(call.id, action).catch(() => {});
}

function awaitIce(peer) {
    if (peer.iceGatheringState === 'complete') return Promise.resolve();
    return new Promise(resolve => {
        const timer = window.setTimeout(done, 7000);
        function done() {
            clearTimeout(timer);
            peer.removeEventListener('icegatheringstatechange', changed);
            resolve();
        }
        function changed() { if (peer.iceGatheringState === 'complete') done(); }
        peer.addEventListener('icegatheringstatechange', changed);
    });
}

async function iceServers() {
    try {
        const client = await getSupabaseClient();
        const { data, error } = await client.functions.invoke('call-ice', { signal: AbortSignal.timeout(3000) });
        if (!error && Array.isArray(data?.iceServers)) return [...stun, ...data.iceServers];
    } catch {
        // A direct call can still connect on networks that permit peer traffic.
    }
    return stun;
}

async function setupPeer(call) {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.kind === 'video' });
    if (current !== call) {
        stream.getTracks().forEach(track => track.stop());
        return null;
    }
    call.stream = stream;
    const configuration = await iceServers();
    if (current !== call) return null;
    const peer = new RTCPeerConnection({ iceServers: configuration });
    call.peer = peer;
    stream.getTracks().forEach(track => peer.addTrack(track, stream));
    const panel = dialog();
    panel.querySelector('[data-call-local]').srcObject = call.kind === 'video' ? stream : null;
    panel.querySelector('[data-call-mic]').setAttribute('aria-pressed', 'false');
    panel.querySelector('[data-call-camera]').setAttribute('aria-pressed', 'false');
    peer.addEventListener('track', event => {
        if (current !== call || call.peer !== peer) return;
        const remote = panel.querySelector(call.kind === 'video' ? '[data-call-remote]' : '[data-call-audio]');
        remote.srcObject = event.streams[0] || new MediaStream([event.track]);
        if (call.kind === 'video') panel.classList.add('call-video-active');
        remote.play().catch(() => {
            const play = panel.querySelector('[data-call-play]');
            play.hidden = false;
            play.onclick = () => remote.play().then(() => { play.hidden = true; }).catch(() => {});
        });
    });
    peer.addEventListener('connectionstatechange', () => {
        if (current !== call || call.peer !== peer) return;
        if (peer.connectionState === 'connected') {
            call.connectBy = null;
            render(call, 'Connected');
        } else if (peer.connectionState === 'failed') {
            void finish(call, 'end', 'Call could not connect on this network.');
        } else if (peer.connectionState === 'disconnected') {
            call.connectBy = Date.now() + 20000;
            render(call, 'Reconnecting…');
        }
    });
    return peer;
}

export async function startInAppCall(chat, kind) {
    if (current || !chat?.cloudId || !chat.cloudCanSend) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection !== 'function') {
        showShareFeedback('Voice and video calls are unavailable in this browser.');
        return;
    }
    const call = { kind, name: chat.user, owner: state.signedInAccountId };
    current = call;
    render(call, 'Opening microphone…');
    let stage = 'devices';
    try {
        const peer = await setupPeer(call);
        if (!peer) return;
        stage = 'local';
        render(call, 'Preparing outgoing call…');
        await peer.setLocalDescription(await peer.createOffer());
        await awaitIce(peer);
        if (current !== call) return;
        const client = await getSupabaseClient();
        stage = 'server';
        const { data, error } = await client.rpc('start_direct_call', {
            target: chat.cloudId, call_kind: kind, call_offer: peer.localDescription.sdp
        });
        if (error) throw error;
        call.id = data;
        if (current !== call) { await respond(data, 'end').catch(() => {}); return; }
        render(call, 'Ringing…');
    } catch (error) {
        if (current === call) await finish(call, 'end', callError(error, stage, kind, false));
    }
}

async function accept(call) {
    if (call.accepting || call.accepted) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection !== 'function') {
        render(call, 'Calling is unavailable in this browser. Open the app or a supported HTTPS browser.');
        return;
    }
    if (Date.now() >= call.expiresAt) {
        await finish(call, 'decline', 'This call expired. Ask the caller to call again.');
        return;
    }
    call.accepting = true;
    render(call, 'Opening microphone…');
    let stage = 'devices';
    try {
        const peer = await setupPeer(call);
        if (!peer) return;
        stage = 'remote';
        render(call, 'Reading incoming call…');
        await peer.setRemoteDescription({ type: 'offer', sdp: call.offer });
        stage = 'local';
        render(call, 'Preparing answer…');
        await peer.setLocalDescription(await peer.createAnswer());
        await awaitIce(peer);
        if (current !== call) return;
        stage = 'server';
        render(call, 'Sending answer…');
        if (!await respond(call.id, 'accept', peer.localDescription.sdp)) {
            await finish(call, 'decline', 'The call expired, was ended, or is no longer available. Ask the caller to call again.');
            return;
        }
        if (current !== call) { await respond(call.id, 'end').catch(() => {}); return; }
        call.accepted = true;
        call.connectBy = Date.now() + 22000;
        render(call, peer.connectionState === 'connected' ? 'Connected' : 'Connecting…');
    } catch (error) {
        if (current !== call) return;
        releasePeer(call);
        call.accepting = false;
        render(call, callError(error, stage, call.kind));
    }
}

export async function refreshInAppCalls() {
    const owner = state.signedInAccountId;
    if (checking || !owner || (document.hidden && !current)) return;
    checking = true;
    try {
        const call = current;
        if (call?.owner !== undefined && call.owner !== owner) { closeCall(call); return; }
        if (call?.connectBy && Date.now() >= call.connectBy) { await finish(call, 'end', 'Call connection timed out.'); return; }
        const client = await getSupabaseClient();
        if (call) {
            if (!call.id) return;
            const { data, error } = await client.from('direct_calls').select(callColumns).eq('id', call.id).maybeSingle();
            if (error || current !== call) return;
            if (!data || !['ringing', 'accepted'].includes(data.status) || Date.parse(data.expires_at) <= Date.now()) {
                const feedback = data?.status === 'declined' ? 'Call declined.' : data?.status === 'ringing' ? 'No answer.' : 'Call ended.';
                if (data?.status === 'ringing' || data?.status === 'accepted') await finish(call, 'end', feedback);
                else { closeCall(call); showShareFeedback(feedback); }
                return;
            }
            if (data.status === 'accepted' && !call.incoming && !call.accepted) {
                call.accepted = true;
                call.connectBy = Date.now() + 22000;
                await call.peer.setRemoteDescription({ type: 'answer', sdp: data.answer });
                if (current === call) render(call, call.peer.connectionState === 'connected' ? 'Connected' : 'Connecting…');
            }
            return;
        }
        const { data, error } = await client.from('direct_calls').select(callColumns + ',caller:profiles!direct_calls_caller_id_fkey(display_name)')
            .eq('recipient_id', owner).eq('status', 'ringing').gt('expires_at', new Date().toISOString())
            .order('expires_at').limit(1).maybeSingle();
        if (error || !data || current || state.signedInAccountId !== owner) return;
        const mute = await client.from('conversation_preferences').select('calls_muted')
            .eq('user_id', owner).eq('conversation_id', data.conversation_id).maybeSingle();
        if (mute.data?.calls_muted || current || state.signedInAccountId !== owner) return;
        current = { id: data.id, incoming: true, expiresAt: Date.parse(data.expires_at), kind: data.kind, offer: data.offer, owner, name: data.caller?.display_name || 'Incoming caller' };
        render(current, 'Incoming call');
    } catch {
        if (current?.accepted) void finish(current, 'end', 'The call ended after a connection error.');
    } finally {
        checking = false;
    }
}

export function registerInAppCallControls() {
    const panel = dialog();
    panel.innerHTML = `
      <div class="call-heading"><h2 data-call-title></h2><p data-call-status role="status"></p></div>
      <video data-call-remote autoplay playsinline hidden></video>
      <video data-call-local autoplay playsinline muted hidden></video>
      <audio data-call-audio autoplay></audio>
      <div class="call-actions">
        ${callButton('answer', 'Accept call', handset, { hidden: true })}
        ${callButton('play', 'Play call audio', '<path d="m9 5 11 7-11 7z"/>', { hidden: true })}
        ${callButton('mic', 'Mute microphone', micIcon + offSlash, { hidden: true, toggle: true })}
        ${callButton('camera', 'Turn camera off', cameraIcon + offSlash, { hidden: true, toggle: true })}
        ${callButton('hangup', 'End call', handset)}
      </div>`;
    panel.addEventListener('cancel', event => {
        event.preventDefault();
        if (current) void finish(current, current.incoming && !current.accepted ? 'decline' : 'end');
    });
    panel.addEventListener('click', event => {
        const call = current;
        if (!call) return;
        if (event.target.closest('[data-call-answer]')) void accept(call);
        if (event.target.closest('[data-call-hangup]')) void finish(call, call.incoming && !call.accepted ? 'decline' : 'end');
        const mic = event.target.closest('[data-call-mic]');
        const camera = event.target.closest('[data-call-camera]');
        const track = mic ? call.stream?.getAudioTracks()[0] : camera ? call.stream?.getVideoTracks()[0] : null;
        if (track) {
            track.enabled = !track.enabled;
            (mic || camera).setAttribute('aria-pressed', String(!track.enabled));
        }
    });
    document.addEventListener('account-deletion-lock', () => { if (current) void finish(current); });
    window.addEventListener('pagehide', () => { if (current) void finish(current); });
    if (typeof window.setInterval === 'function') {
        window.setInterval(() => { void refreshInAppCalls(); }, 2500);
    }
}
