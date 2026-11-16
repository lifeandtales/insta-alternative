import { state } from '../core/state.js';
import { DEFAULT_AVATAR } from '../core/social.js';
import { conversations } from '../data/sample-data.js';
import { getSupabaseClient } from '../storage/supabase.js';
import { avatarLookup, rememberCloudPerson } from './cloud-people.js';

const historyPageSize = 100;
const historyColumns = 'id,sender_id,kind,body,reply_to_id,created_at,expires_at';
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
    let result = await client.rpc('connected_direct_inbox');
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

export async function loadCloudChat(chat) {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const sendRevision = chat.sendRevision;
    const [history, profile, permissions] = await Promise.all([
        historyQuery(client, chat).limit(historyPageSize + 1),
        client.rpc('social_profile', { target: chat.peerId }),
        client.rpc('connected_chat_can_send', { target: chat.cloudId })
    ]);
    if (history.error) throw history.error;
    if (profile.error) throw profile.error;
    if (permissions.error && permissions.error.code !== 'PGRST202') throw permissions.error;
    if (owner !== state.signedInAccountId) return false;
    const avatarUrls = profile.data ? await avatarLookup(client, [profile.data]) : null;
    if (owner !== state.signedInAccountId) return false;
    const previous = chat.messages;
    const canSend = Boolean(permissions.error ? profile.data?.mutual : permissions.data) && !state.blockedHandles.has(chat.handle);
    const page = history.data.slice(0, historyPageSize);
    const earliest = page.at(-1);
    const previouslyLoaded = previous.filter(item => !item.expiresAt || item.expiresAt > Date.now());
    const older = earliest && history.data.length > historyPageSize ? previouslyLoaded.filter(item => {
        const itemTime = Date.parse(item.createdAt);
        const limitTime = Date.parse(earliest.created_at);
        return itemTime < limitTime || (itemTime === limitTime && item.id < earliest.id);
    }) : [];
    if (!older.length) chat.cloudHasOlder = history.data.length > historyPageSize;
    const recent = page.slice().reverse().map(row => toChatMessage(row, owner));
    const sentDuringLoad = chat.sendRevision !== sendRevision
        ? previous.filter(item => item.from === 'me' && item.sentAt >= (recent.at(-1)?.sentAt || 0) && !recent.some(row => row.id === item.id))
        : [];
    const messages = [...older, ...recent, ...sentDuringLoad];
    const changed = !chat.cloudLoaded || previous.length !== messages.length ||
        previous.some((item, index) => item.id !== messages[index].id ||
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
    if (latest && state.currentView === 'messages' && state.activeConversationHandle === chat.handle &&
        (!chat.cloudLastReadAt || Date.parse(latest.created_at) > Date.parse(chat.cloudLastReadAt))) {
        const { error } = await client.rpc('mark_direct_chat_read', { target: chat.cloudId, seen_at: latest.created_at });
        if (!error) {
            chat.cloudLastReadAt = latest.created_at;
            chat.unread = false;
        }
    }
    return changed || sendChanged;
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
    const existing = new Set(chat.messages.map(message => message.id));
    const older = data.slice(0, historyPageSize).filter(row => !existing.has(row.id))
        .reverse().map(row => toChatMessage(row, owner));
    chat.messages = [...older, ...chat.messages];
    chat.cloudHasOlder = data.length > historyPageSize;
}

function reactionSignature(reactions = []) {
    return reactions.map(row => row.user_id + ':' + row.emoji).sort().join('|');
}

function toChatMessage(row, owner) {
    return { id: row.id, type: 'text', text: row.kind === 'text' ? row.body : 'Attachment',
        from: row.sender_id === owner ? 'me' : 'them', sentAt: Date.parse(row.created_at), createdAt: row.created_at, expiresAt: Date.parse(row.expires_at), replyToId: row.reply_to_id, reactions: row.reactions || [] };
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
        chat.cloudLastReadAt = null;
    }
    if (action === 'clear') {
        chat.messages = [];
        chat.unread = false;
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

export async function hideCloudMessage(chat, message) {
    const client = await getSupabaseClient();
    const { error } = await client.from('hidden_messages').upsert({
        user_id: state.signedInAccountId, message_id: message.id
    }, { ignoreDuplicates: true });
    if (error) throw error;
    chat.messages = chat.messages.filter(item => item.id !== message.id);
}
