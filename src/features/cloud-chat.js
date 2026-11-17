import { accountStorageKey } from '../storage/browser-storage.js';
import { state } from '../core/state.js';
import { DEFAULT_AVATAR } from '../core/social.js';
import { conversations } from '../data/sample-data.js';
import { getSupabaseClient } from '../storage/supabase.js';
import { avatarLookup, rememberCloudPerson } from './cloud-people.js';

const historyPageSize = 100;
const historyColumns = 'id,sender_id,kind,body,reply_to_id,created_at,expires_at,object_path,attachment_expires_at,metadata';
const historyWithReactions = historyColumns + ',reactions:message_reactions(user_id,emoji)';

function historyQuery(client, chat) {
    return client.from('messages').select(historyWithReactions).eq('conversation_id', chat.cloudId)
        .order('created_at', { ascending: false }).order('id', { ascending: false });
}

function upsertChat(id, person) {
    let chat = conversations.find(item => item.cloudId === id);
    if (!chat) {
        chat = { handle: person.handle, user: person.name, avatar: DEFAULT_AVATAR,
            cloudId: id, peerId: person.id, messages: [] };
        try { chat.wallpaper = localStorage.getItem(accountStorageKey('insta-chat-wallpaper:' + id)); } catch {}
        conversations.unshift(chat);
    }
    if (state.activeConversationHandle !== chat.handle) chat.handle = person.handle;
    chat.user = person.name;
    chat.avatar = person.avatar;
    return chat;
}

export async function openCloudChat(person, { fromInbox = false } = {}) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc(fromInbox ? 'open_connected_chat' : 'open_mutual_chat', { other_user: person.id });
    if (error) throw error;
    return upsertChat(data, person);
}

export async function loadCloudInbox() {
    const owner = state.signedInAccountId;
    if (!owner) return;
    const client = await getSupabaseClient();
    let result = await client.rpc('connected_direct_inbox_with_counts');
    if (result.error?.code === 'PGRST202') result = await client.rpc('connected_direct_inbox');
    if (result.error?.code === 'PGRST202') result = await client.rpc('direct_inbox');
    const { data, error } = result;
    if (error) throw error;
    if (owner !== state.signedInAccountId) return;
    const avatars = await avatarLookup(client, data);
    if (owner !== state.signedInAccountId) return;
    const returned = new Set();
    for (const row of data) {
        returned.add(row.id);
        const person = rememberCloudPerson({ id: row.peer_id, username: row.username, display_name: row.display_name, avatar_path: row.avatar_path }, avatars);
        const chat = upsertChat(row.id, person);
        chat.lastActivity = Date.parse(row.sent_at);
        chat.lastMessage = row.kind === 'text' ? row.body : 'Attachment';
        chat.unread = row.unread;
        chat.unreadCount = row.unread_count ?? 0;
        chat.pinned = row.pinned;
        chat.muted = row.muted;
        chat.cloudHasMessages = true;
    }
    for (let index = conversations.length - 1; index >= 0; index--) {
        const chat = conversations[index];
        if (chat.cloudId && !returned.has(chat.cloudId) && chat.handle !== state.activeConversationHandle) {
            conversations.splice(index, 1);
        }
    }
}

const attachmentCache = new Map();

async function signAttachments(client, rows) {
    const now = Date.now();
    const paths = [...new Set(rows.filter(row => row.object_path &&
        (!row.attachment_expires_at || Date.parse(row.attachment_expires_at) > now)).map(row => row.object_path))];
    const missing = paths.filter(path => (attachmentCache.get(path)?.until || 0) <= now);
    if (missing.length) {
        const { data } = await client.storage.from('chat-attachments').createSignedUrls(missing, 300)
            .catch(() => ({ data: [] }));
        for (const row of data || []) {
            if (row.signedUrl) attachmentCache.set(row.path, { url: row.signedUrl, until: now + 240000 });
        }
    }
    for (const [path, entry] of attachmentCache) if (entry.until <= now) attachmentCache.delete(path);
    return new Map(paths.map(path => [path, attachmentCache.get(path)?.url]));
}

export async function loadCloudChat(chat) {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const sendRevision = chat.sendRevision;
    const wallpaperRevision = chat.wallpaperRevision;
    const [history, profile, permissions, settings, preferences, wallpaper, receipt] = await Promise.all([
        historyQuery(client, chat).limit(historyPageSize + 1),
        client.rpc('social_profile', { target: chat.peerId }),
        client.rpc('connected_chat_can_send', { target: chat.cloudId }),
        client.from('conversations').select('retention_hours').eq('id', chat.cloudId).maybeSingle(),
        client.from('conversation_preferences').select('pinned,muted,calls_muted').eq('conversation_id', chat.cloudId).eq('user_id', owner).maybeSingle(),
        client.from('conversation_preferences').select('wallpaper_version').eq('conversation_id', chat.cloudId).eq('user_id', owner).maybeSingle(),
        client.rpc('direct_chat_read_receipt_details', { target: chat.cloudId }).then(async result => {
            if (result.error?.code !== 'PGRST202') return result;
            const legacy = await client.rpc('direct_chat_read_receipt', { target: chat.cloudId });
            return { data: { seen_at: legacy.data }, error: legacy.error };
        })
    ]);
    if (history.error) throw history.error;
    if (profile.error) throw profile.error;
    if (permissions.error && permissions.error.code !== 'PGRST202') throw permissions.error;
    if (owner !== state.signedInAccountId) return false;
    const avatarUrls = profile.data ? await avatarLookup(client, [profile.data]) : null;
    if (owner !== state.signedInAccountId) return false;
    const links = await signAttachments(client, history.data);
    if (owner !== state.signedInAccountId) return false;
    if (settings.data) chat.chatTimerEnabled = settings.data.retention_hours === 24;
    if (preferences.data) {
        chat.pinned = preferences.data.pinned;
        chat.muted = preferences.data.muted;
        chat.callsMuted = preferences.data.calls_muted;
    }
    let wallpaperChanged = false;
    const wallpaperVersion = wallpaper.data?.wallpaper_version;
    if (wallpaperVersion && wallpaperVersion !== chat.wallpaperVersion && wallpaperRevision === chat.wallpaperRevision) {
        const { data } = await client.from('conversation_preferences').select('wallpaper_jpeg,wallpaper_version')
            .eq('conversation_id', chat.cloudId).eq('user_id', owner).maybeSingle();
        if (owner !== state.signedInAccountId) return false;
        if (data?.wallpaper_version && wallpaperRevision === chat.wallpaperRevision) {
            wallpaperChanged = chat.wallpaper !== data.wallpaper_jpeg;
            chat.wallpaper = data.wallpaper_jpeg;
            chat.wallpaperVersion = data.wallpaper_version;
        }
    }
    const seenAt = receipt.data?.seen_at ?? null;
    const readAt = receipt.data?.read_at ?? null;
    const receiptChanged = !receipt.error && (chat.peerSeenAt !== seenAt || chat.peerReadAt !== readAt);
    if (!receipt.error) {
        chat.peerSeenAt = seenAt;
        chat.peerReadAt = readAt;
    }
    const previous = chat.messages;
    const canSend = Boolean(permissions.error ? profile.data?.mutual : permissions.data) && !state.blockedHandles.has(chat.handle);
    const page = history.data.slice(0, historyPageSize);
    const earliest = page.at(-1);
    const previouslyLoaded = previous.filter(item => !item.serverExpiresAt || item.serverExpiresAt > Date.now());
    const older = earliest && history.data.length > historyPageSize ? previouslyLoaded.filter(item => {
        const itemTime = Date.parse(item.createdAt);
        const limitTime = Date.parse(earliest.created_at);
        return itemTime < limitTime || (itemTime === limitTime && item.id < earliest.id);
    }) : [];
    if (!older.length) chat.cloudHasOlder = history.data.length > historyPageSize;
    const recent = page.slice().reverse().map(row => toChatMessage(row, owner, links));
    const sentDuringLoad = chat.sendRevision !== sendRevision
        ? previous.filter(item => item.from === 'me' && item.sentAt >= (recent.at(-1)?.sentAt || 0) && !recent.some(row => row.id === item.id))
        : [];
    const messages = [...older, ...recent, ...sentDuringLoad];
    const changed = !chat.cloudLoaded || previous.length !== messages.length ||
        previous.some((item, index) => item.id !== messages[index].id || item.media !== messages[index].media ||
            reactionSignature(item.reactions) !== reactionSignature(messages[index].reactions));
    let sendChanged = chat.cloudCanSend !== canSend;
    chat.cloudCanSend = canSend;
    if (profile.data) {
        const person = rememberCloudPerson(profile.data, avatarUrls);
        if (chat.avatar !== person.avatar || chat.user !== person.name) sendChanged = true;
        chat.avatar = person.avatar;
        chat.user = person.name;
    }
    chat.cloudLoaded = true;
    if (changed) chat.messages = messages;
    chat.cloudHasMessages = chat.messages.length > 0;
    const latest = history.data[0];
    if (latest && !document.hidden && state.currentView === 'messages' && state.activeConversationHandle === chat.handle &&
        (!chat.cloudLastReadAt || Date.parse(latest.created_at) > Date.parse(chat.cloudLastReadAt))) {
        const { error } = await client.rpc('mark_direct_chat_read', { target: chat.cloudId, seen_at: latest.created_at });
        if (!error) {
            chat.cloudLastReadAt = latest.created_at;
            chat.unread = false;
            chat.unreadCount = 0;
        }
    }
    return changed || sendChanged || wallpaperChanged || receiptChanged;
}

export async function loadOlderCloudMessages(chat) {
    const first = chat.messages[0];
    if (!first?.createdAt || !chat.cloudHasOlder) return;
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const fence = `created_at.lt.${first.createdAt},and(created_at.eq.${first.createdAt},id.lt.${first.id})`;
    const { data, error } = await historyQuery(client, chat).or(fence).limit(historyPageSize + 1);
    if (error) throw error;
    if (owner !== state.signedInAccountId || !chat.messages.some(message => message.id === first.id)) return;
    const links = await signAttachments(client, data);
    if (owner !== state.signedInAccountId) return;
    const existing = new Set(chat.messages.map(message => message.id));
    const older = data.slice(0, historyPageSize).filter(row => !existing.has(row.id))
        .reverse().map(row => toChatMessage(row, owner, links));
    chat.messages = [...older, ...chat.messages];
    chat.cloudHasOlder = data.length > historyPageSize;
}

function reactionSignature(reactions = []) {
    return reactions.map(row => row.user_id + ':' + row.emoji).sort().join('|');
}

function toChatMessage(row, owner, links = new Map()) {
    const message = { id: row.id, type: 'text', text: row.kind === 'text' ? row.body : 'Attachment',
        from: row.sender_id === owner ? 'me' : 'them', sentAt: Date.parse(row.created_at), createdAt: row.created_at,
        expiresAt: Date.parse(row.attachment_expires_at), serverExpiresAt: Date.parse(row.expires_at),
        replyToId: row.reply_to_id, reactions: row.reactions || [] };
    const meta = row.metadata || {};
    const media = links.get(row.object_path);
    if (row.kind === 'voice' && media) return { ...message, media, type: 'voice',
        fileName: String(meta.fileName || 'Voice message'), durationSeconds: Number(meta.durationSeconds) || 0 };
    if (['photo', 'video', 'file', 'voice'].includes(row.kind)) return {
        ...message, type: 'attachment', mediaKind: row.kind === 'voice' ? 'file' : row.kind,
        media, fileName: String(meta.fileName || (row.kind === 'voice' ? 'Voice message' : 'Attachment')),
        fileSize: Number(meta.fileSize) || 0
    };
    if (row.kind === 'location') return { ...message, type: 'location', place: String(meta.place || '') };
    if (row.kind === 'contact') return { ...message, type: 'contact', contactName: String(meta.contactName || ''), phone: String(meta.phone || '') };
    return message;
}

export async function sendCloudText(chat, text, replyToId) {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const { data, error } = await client.from('messages').insert({
        conversation_id: chat.cloudId, sender_id: owner, kind: 'text', body: text,
        ...(replyToId ? { reply_to_id: replyToId } : {})
    }).select(historyColumns).single();
    if (error) throw error;
    if (owner !== state.signedInAccountId) return;
    if (!chat.messages.some(message => message.id === data.id)) chat.messages.push(toChatMessage(data, owner));
    chat.sendRevision = (chat.sendRevision || 0) + 1;
    chat.lastActivity = Date.parse(data.created_at);
    chat.lastMessage = data.body;
    chat.cloudHasMessages = true;
}

export async function sendCloudMedia(chat, message) {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const bucket = client.storage.from('chat-attachments');
    const payload = { conversation_id: chat.cloudId, sender_id: owner, kind: message.type, metadata: {} };
    if (message.media) {
        const response = await fetch(message.media);
        if (!response.ok) throw new Error('Could not read the attachment.');
        const blob = await response.blob();
        if (!blob.size || blob.size > 50000000) throw new Error('Attachments must be no larger than 50 MB.');
        payload.kind = message.type === 'voice' ? 'voice' : message.mediaKind;
        payload.object_path = `${chat.cloudId}/${owner}/${crypto.randomUUID()}`;
        payload.metadata = { fileName: String(message.fileName || 'Voice message').slice(0, 180),
            fileSize: blob.size, durationSeconds: message.durationSeconds || 0 };
        const { error } = await bucket.upload(payload.object_path, blob, { contentType: blob.type || 'application/octet-stream' });
        if (error) throw error;
    } else if (message.type === 'location') {
        payload.metadata = { place: message.place.slice(0, 100) };
    } else if (message.type === 'contact') {
        payload.metadata = { contactName: message.contactName.slice(0, 120), phone: message.phone.slice(0, 60) };
    }
    const { data, error } = await client.from('messages').insert(payload).select(historyColumns).single();
    if (error) {
        if (payload.object_path && error.code && !error.code.startsWith('PGRST0')) {
            await bucket.remove([payload.object_path]).catch(() => {});
        }
        throw error;
    }
    if (state.signedInAccountId !== owner) return;
    const links = await signAttachments(client, [data]);
    if (!chat.messages.some(item => item.id === data.id)) chat.messages.push(toChatMessage(data, owner, links));
    chat.sendRevision = (chat.sendRevision || 0) + 1;
    chat.lastActivity = Date.parse(data.created_at);
    chat.lastMessage = payload.kind === 'voice' ? 'Voice message' : payload.kind === 'location' ? 'Location' : payload.kind === 'contact' ? 'Contact' : 'Attachment';
    chat.cloudHasMessages = true;
}

export async function muteConnectedCalls(chat, muted) {
    const client = await getSupabaseClient();
    const { error } = await client.from('conversation_preferences').upsert({
        conversation_id: chat.cloudId, user_id: state.signedInAccountId, calls_muted: muted
    }, { onConflict: 'conversation_id,user_id' });
    if (error) throw error;
    chat.callsMuted = muted;
}

export async function setCloudChatWallpaper(chat, image) {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const { data, error } = await client.from('conversation_preferences').upsert({
        conversation_id: chat.cloudId, user_id: owner, wallpaper_jpeg: image
    }, { onConflict: 'conversation_id,user_id' }).select('wallpaper_version').single();
    if (error) throw error;
    if (owner !== state.signedInAccountId) return false;
    chat.wallpaperRevision = (chat.wallpaperRevision || 0) + 1;
    chat.wallpaperVersion = data.wallpaper_version;
    return true;
}

export async function updateCloudChatTimer(chat, enabled) {
    const client = await getSupabaseClient();
    const { error } = await client.rpc('set_chat_timer', { conversation: chat.cloudId, enabled });
    if (error) throw error;
    chat.chatTimerEnabled = enabled;
    // Reload the retained history and its server expiry dates.
    chat.messages = [];
    await loadCloudChat(chat);
}

export async function hideCloudMessages(chat, ids) {
    if (!ids.length) return;
    const client = await getSupabaseClient();
    const { error } = await client.from('hidden_messages').upsert(
        ids.map(message_id => ({ user_id: state.signedInAccountId, message_id })), { ignoreDuplicates: true });
    if (error) throw error;
    const hidden = new Set(ids);
    chat.messages = chat.messages.filter(item => !hidden.has(item.id));
}

export async function findMessageRecipients(query, offset) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('message_recipients', { search_text: query, page_offset: offset });
    if (error) throw error;
    const avatars = await avatarLookup(client, data);
    return data.map(row => ({ ...rememberCloudPerson(row, avatars), isFollowing: row.is_following }));
}

export async function setCloudChatPreference(chat, action, enabled = true) {
    const client = await getSupabaseClient();
    const { error } = await client.rpc('set_direct_chat_preference', { target: chat.cloudId, action, enabled });
    if (error) throw error;
    if (action === 'pin') chat.pinned = enabled;
    if (action === 'mute') chat.muted = enabled;
    if (action === 'unread') {
        chat.unread = enabled;
        if (!enabled) chat.unreadCount = 0;
        chat.cloudLastReadAt = null;
    }
    if (action === 'clear') {
        chat.messages = [];
        chat.unread = false;
        chat.unreadCount = 0;
        chat.cloudHasMessages = false;
    }
}

export async function setCloudMessageReaction(message, emoji) {
    const client = await getSupabaseClient();
    const user = state.signedInAccountId;
    const { error } = await client.rpc('set_direct_message_reaction', { target: message.id, reaction: emoji });
    if (error) throw error;
    return { user_id: user, emoji };
}

export function hideCloudMessage(chat, message) {
    return hideCloudMessages(chat, [message.id]);
}
