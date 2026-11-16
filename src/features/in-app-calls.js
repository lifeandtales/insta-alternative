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

function render(call, status) {
    const panel = dialog();
    if (!panel.open) {
        panel.querySelector('[data-call-play]').hidden = true;
        panel.showModal();
    }
    panel.querySelector('[data-call-title]').textContent = (call.kind === 'video' ? 'Video call' : 'Voice call') + ' · ' + call.name;
    panel.querySelector('[data-call-status]').textContent = status;
    panel.querySelector('[data-call-answer]').hidden = !call.incoming || call.accepting || Boolean(call.peer);
    panel.querySelector('[data-call-hangup]').textContent = call.incoming && !call.accepted ? 'Decline' : 'End call';
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

function acceptError(error, stage, kind) {
    const devices = kind === 'video' ? 'microphone and camera' : 'microphone';
    if (stage === 'devices') {
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
            return `Allow access to the ${devices}, then tap Accept again.`;
        }
        if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
            return `No available ${devices}. Check your device settings and try again.`;
        }
        if (error?.name === 'NotReadableError' || error?.name === 'AbortError') {
            return `The ${devices} could not start. Close other apps using them and try again.`;
        }
        return `The app could not open your ${devices}. Check permissions and try again.`;
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
    panel.querySelector('[data-call-mic]').textContent = 'Mute microphone';
    panel.querySelector('[data-call-camera]').textContent = 'Turn camera off';
    peer.addEventListener('track', event => {
        if (current !== call || call.peer !== peer) return;
        const remote = panel.querySelector(call.kind === 'video' ? '[data-call-remote]' : '[data-call-audio]');
        remote.srcObject = event.streams[0] || new MediaStream([event.track]);
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
    render(call, 'Preparing call…');
    try {
        const peer = await setupPeer(call);
        if (!peer) return;
        await peer.setLocalDescription(await peer.createOffer());
        await awaitIce(peer);
        if (current !== call) return;
        const client = await getSupabaseClient();
        const { data, error } = await client.rpc('start_direct_call', {
            target: chat.cloudId, call_kind: kind, call_offer: peer.localDescription.sdp
        });
        if (error) throw error;
        call.id = data;
        if (current !== call) { await respond(data, 'end').catch(() => {}); return; }
        render(call, 'Ringing…');
    } catch (error) {
        if (current === call) await finish(call, 'end', error?.name === 'NotAllowedError'
            ? 'Allow microphone or camera access to call.' : 'Could not start the call. Check that calling is set up.');
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
        render(call, acceptError(error, stage, call.kind));
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
      <h2 data-call-title></h2><p data-call-status role="status"></p>
      <video data-call-remote autoplay playsinline hidden></video>
      <video data-call-local autoplay playsinline muted hidden></video>
      <audio data-call-audio autoplay></audio>
      <div class="panel-actions">
        <button type="button" data-call-answer hidden>Accept</button>
        <button type="button" data-call-play hidden>Play call audio</button>
        <button type="button" data-call-mic hidden>Mute microphone</button>
        <button type="button" data-call-camera hidden>Turn camera off</button>
        <button type="button" data-call-hangup>End call</button>
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
            (mic || camera).textContent = mic ? (track.enabled ? 'Mute microphone' : 'Unmute microphone')
                : (track.enabled ? 'Turn camera off' : 'Turn camera on');
        }
    });
    document.addEventListener('account-deletion-lock', () => { if (current) void finish(current); });
    window.addEventListener('pagehide', () => { if (current) void finish(current); });
    if (typeof window.setInterval === 'function') {
        window.setInterval(() => { void refreshInAppCalls(); }, 2500);
    }
}
