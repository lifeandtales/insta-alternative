import { showShareFeedback } from '../components/feedback.js';
import { state } from '../core/state.js';
import { getSupabaseClient } from '../storage/supabase.js';

const panel = () => document.getElementById('group-call-dialog');
let current;
let checking = false;
let unavailableUntil = 0;
let callNetwork;

export function hasGroupCall() {
    return Boolean(current);
}

async function rpc(name, parameters) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc(name, parameters);
    if (error) throw error;
    return data;
}

function render(call, status) {
    const view = panel();
    if (!view.open) view.showModal();
    const type = call.kind === 'video' ? 'video' : 'voice';
    view.querySelector('[data-group-call-title]').textContent = call.name;
    view.querySelector('[data-group-call-status]').textContent = status;
    const accept = view.querySelector('[data-group-call-accept]');
    accept.textContent = 'Accept ' + type + ' call';
    accept.hidden = !call.incoming || call.joined || call.busy;
    view.querySelector('[data-group-call-leave]').textContent =
        call.incoming ? (call.joined ? 'Leave call' : 'Decline') : 'End call';
    view.querySelector('[data-group-call-mic]').hidden = !call.stream;
    view.querySelector('[data-group-call-camera]').hidden = !call.stream || call.kind !== 'video';
}

function close(call) {
    for (const { peer } of call.peers.values()) peer.close();
    call.peers.clear();
    call.stream?.getTracks().forEach(track => track.stop());
    if (current !== call) return;
    current = null;
    const view = panel();
    view.querySelector('[data-group-call-grid]').replaceChildren();
    const local = view.querySelector('[data-group-call-local]');
    local.srcObject = null;
    local.hidden = true;
    view.querySelector('[data-group-call-play]').hidden = true;
    if (view.open) view.close();
}

async function finish(call) {
    close(call);
    if (call.id) {
        const action = call.incoming && !call.joined ? 'decline' : 'leave';
        await rpc('respond_group_call', { target: call.id, action }).catch(() => {});
    }
}

function mediaAvailable() {
    return Boolean(navigator.mediaDevices?.getUserMedia) && typeof RTCPeerConnection === 'function';
}

async function openDevices(call) {
    if (!mediaAvailable()) throw new Error('Media devices unavailable');
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: call.kind === 'video' });
    if (current !== call) {
        stream.getTracks().forEach(track => track.stop());
        return false;
    }
    call.stream = stream;
    call.iceServers = callNetwork.iceServers();
    const view = panel();
    for (const button of view.querySelectorAll('[data-group-call-mic], [data-group-call-camera]')) button.setAttribute('aria-pressed', 'false');
    if (call.kind === 'video') {
        const local = view.querySelector('[data-group-call-local]');
        local.srcObject = stream;
        local.hidden = false;
    }
    return true;
}

export async function startGroupCall(chat, kind) {
    if (current || !callNetwork) return;
    const call = { kind, name: chat.user, owner: state.signedInAccountId, peers: new Map(), joined: true, busy: true };
    current = call;
    render(call, kind === 'video' ? 'Opening camera and microphone…' : 'Opening microphone…');
    try {
        if (!await openDevices(call)) return;
    } catch {
        if (current === call) {
            close(call);
            showShareFeedback('Could not use the camera or microphone. Check your permissions and try again.');
        }
        return;
    }
    try {
        call.id = await rpc('start_group_call', { target: chat.cloudId, call_kind: kind });
        if (current !== call) { await finish(call); return; }
        render(call, 'Ringing group members…');
    } catch (error) {
        if (current !== call) return;
        close(call);
        const message = error?.code === '23505' ? 'There is already a call open in this group.'
            : error?.code === '42501' ? 'No group members are available for this call.'
            : error?.code === 'PGRST202' ? 'Run the group calling migration to enable calls.'
            : 'Could not start the group call. Check your connection and try again.';
        showShareFeedback(message);
    } finally {
        call.busy = false;
    }
}

async function accept(call) {
    if (call.busy || call.joined) return;
    call.busy = true;
    render(call, call.kind === 'video' ? 'Opening camera and microphone…' : 'Opening microphone…');
    try {
        if (!await openDevices(call)) return;
        call.joined = await rpc('respond_group_call', { target: call.id, action: 'accept' });
        if (current !== call) { if (call.joined) await finish(call); return; }
        if (!call.joined) {
            close(call);
            showShareFeedback('The group call is no longer available.');
            return;
        }
        render(call, 'Connecting…');
    } catch {
        if (current !== call) return;
        call.stream?.getTracks().forEach(track => track.stop());
        call.stream = null;
        const local = panel().querySelector('[data-group-call-local]');
        local.srcObject = null;
        local.hidden = true;
        call.busy = false;
        render(call, 'Could not join. Check your connection and camera or microphone permissions.');
    } finally {
        call.busy = false;
    }
}

function addPeer(call, member, iceServers) {
    const peer = new RTCPeerConnection({ iceServers });
    for (const track of call.stream.getTracks()) peer.addTrack(track, call.stream);
    const tile = document.createElement('figure');
    const label = document.createElement('figcaption');
    const media = document.createElement(call.kind === 'video' ? 'video' : 'audio');
    label.textContent = member.name;
    media.autoplay = true;
    media.playsInline = true;
    tile.append(media, label);
    panel().querySelector('[data-group-call-grid]').append(tile);
    const connection = { peer, media, tile };
    call.peers.set(member.id, connection);
    peer.addEventListener('track', event => {
        if (current !== call || call.peers.get(member.id) !== connection) return;
        if (!media.srcObject || event.streams[0]) media.srcObject = event.streams[0] || new MediaStream([event.track]);
        else if (!media.srcObject.getTracks().includes(event.track)) media.srcObject.addTrack(event.track);
        media.play().catch(() => {
            if (current === call) panel().querySelector('[data-group-call-play]').hidden = false;
        });
    });
    return connection;
}

async function syncPeer(call, member, iceServers) {
    const initiator = call.owner < member.id;
    let connection = call.peers.get(member.id);
    if (!connection && !initiator && !member.offer) return;
    connection ||= addPeer(call, member, iceServers);
    const { peer } = connection;
    if (!peer.localDescription && (initiator || member.offer)) {
        if (!initiator && !peer.remoteDescription) {
            await peer.setRemoteDescription({ type: 'offer', sdp: member.offer });
        }
        await peer.setLocalDescription(initiator ? await peer.createOffer() : await peer.createAnswer());
        await callNetwork.awaitIce(peer);
    }
    if (current !== call) return;
    const description = peer.localDescription;
    if (description && !connection.published) {
        connection.published = await rpc('write_group_call_signal', {
            target: call.id, other_user: member.id, description_type: description.type, description: description.sdp,
        });
    }
    if (current === call && initiator && !peer.remoteDescription && member.answer) {
        await peer.setRemoteDescription({ type: 'answer', sdp: member.answer });
    }
}

async function refreshActiveCall(call) {
    if (!call.id || call.busy) return;
    const snapshot = await rpc('group_call_snapshot', { target: call.id });
    if (current !== call) return;
    if (!snapshot) {
        close(call);
        showShareFeedback(call.connectedOnce ? 'Group call ended.' : 'The group call is no longer available.');
        return;
    }
    if (!call.joined || !call.stream) return;
    const peers = new Set(snapshot.peers.map(member => member.id));
    for (const [id, connection] of call.peers) {
        if (peers.has(id)) continue;
        connection.peer.close();
        connection.media.srcObject = null;
        connection.tile.remove();
        call.peers.delete(id);
    }
    if (!peers.size && !snapshot.ringing) {
        await finish(call);
        showShareFeedback(call.connectedOnce ? 'Everyone left the call.' : 'No one joined the group call.');
        return;
    }
    const iceServers = peers.size ? await call.iceServers : [];
    if (current !== call) return;
    const updates = await Promise.allSettled(snapshot.peers.map(member => syncPeer(call, member, iceServers)));
    if (current !== call) return;
    const connections = [...call.peers.values()];
    const connectedCount = connections.filter(({ peer }) => peer.connectionState === 'connected').length;
    const issue = updates.some(update => update.status === 'rejected')
        || connections.some(({ peer }) => peer.connectionState === 'failed' || peer.connectionState === 'disconnected');
    call.connectedOnce ||= connectedCount > 0;
    render(call, connectedCount ? `${connectedCount + 1} connected${issue ? ' · Reconnecting…' : ''}`
        : peers.size ? (issue ? 'Connection interrupted. Try calling again.' : 'Connecting…') : 'Ringing group members…');
}

export async function refreshGroupCalls(canReceive) {
    const owner = state.signedInAccountId;
    if (current && current.owner !== owner) close(current);
    if (checking || !owner || (!current && (document.hidden || !canReceive() || Date.now() < unavailableUntil))) return;
    checking = true;
    try {
        if (current) {
            await refreshActiveCall(current);
            return;
        }
        const id = await rpc('incoming_group_call');
        if (!id || current || !canReceive() || state.signedInAccountId !== owner) return;
        const call = await rpc('group_call_snapshot', { target: id });
        if (call?.status !== 'ringing' || current || !canReceive() || state.signedInAccountId !== owner) return;
        current = { id, owner, name: call.name, kind: call.kind, incoming: true, peers: new Map(), joined: false };
        render(current, call.caller + ' is calling the group');
    } catch (error) {
        if (error?.code === 'PGRST202' || error?.code === '42883') unavailableUntil = Date.now() + 60000;
        else if (current?.joined && !current.busy) render(current, 'Reconnecting to the call…');
    } finally {
        checking = false;
    }
}

export function registerGroupCallControls({ canReceive, iceServers, awaitIce }) {
    const view = panel();
    if (!view) return;
    callNetwork = { iceServers, awaitIce };
    view.addEventListener('cancel', event => {
        event.preventDefault();
        if (current) void finish(current);
    });
    view.addEventListener('click', event => {
        const call = current;
        if (!call) return;
        if (event.target.closest('[data-group-call-accept]')) void accept(call);
        if (event.target.closest('[data-group-call-leave]')) void finish(call);
        const play = event.target.closest('[data-group-call-play]');
        if (play) void Promise.all([...call.peers.values()].map(({ media }) => media.play())).then(() => { play.hidden = true; }).catch(() => {});
        const mic = event.target.closest('[data-group-call-mic]');
        const camera = event.target.closest('[data-group-call-camera]');
        const track = mic ? call.stream?.getAudioTracks()[0] : camera ? call.stream?.getVideoTracks()[0] : null;
        if (track) {
            track.enabled = !track.enabled;
            (mic || camera).setAttribute('aria-pressed', String(!track.enabled));
        }
    });
    document.addEventListener('account-deletion-lock', () => { if (current) void finish(current); });
    window.addEventListener('pagehide', () => { if (current) void finish(current); });
    window.setInterval?.(() => { void refreshGroupCalls(canReceive); }, 2500);
}
