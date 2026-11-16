import { state } from '../core/state.js';
import { DEFAULT_AVATAR } from '../core/social.js';
import { conversations } from '../data/sample-data.js';
import { getSupabaseClient } from '../storage/supabase.js';
import { avatarLookup, rememberCloudPerson } from './cloud-people.js';

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

export async function openCloudChat(person) {
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('open_mutual_chat', { other_user: person.id });
    if (error) throw error;
    return upsertChat(data, person);
}

export async function loadCloudInbox() {
    const owner = state.signedInAccountId;
    if (!owner) return;
    const client = await getSupabaseClient();
    const { data, error } = await client.rpc('direct_inbox');
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
    const [history, profile] = await Promise.all([
        client.from('messages').select('id,sender_id,kind,body,reply_to_id,created_at')
            .eq('conversation_id', chat.cloudId)
            .order('created_at', { ascending: false }).order('id', { ascending: false }).limit(100),
        client.rpc('social_profile', { target: chat.peerId })
    ]);
    if (history.error) throw history.error;
    if (profile.error) throw profile.error;
    if (owner !== state.signedInAccountId) return false;
    const previous = chat.messages;
    const canSend = Boolean(profile.data?.mutual) && !state.blockedHandles.has(chat.handle);
    const changed = !chat.cloudLoaded || previous.length !== history.data.length ||
        previous.some((item, index) => item.id !== history.data[history.data.length - 1 - index].id);
    let sendChanged = chat.cloudCanSend !== canSend;
    chat.cloudCanSend = canSend;
    if (profile.data) {
        const person = rememberCloudPerson(profile.data, await avatarLookup(client, [profile.data]));
        if (chat.avatar !== person.avatar || chat.user !== person.name) sendChanged = true;
        chat.avatar = person.avatar;
        chat.user = person.name;
    }
    chat.cloudLoaded = true;
    if (changed) {
        const newMessages = history.data.slice().reverse().map(row => toChatMessage(row, owner));
        const lastTime = newMessages.at(-1)?.sentAt || 0;
        const sentDuringLoad = chat.sendRevision !== sendRevision
            ? chat.messages.filter(item => item.from === 'me' && item.sentAt >= lastTime && !newMessages.some(row => row.id === item.id))
            : [];
        chat.messages = [...newMessages, ...sentDuringLoad];
    }
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

function toChatMessage(row, owner) {
    return { id: row.id, type: 'text', text: row.kind === 'text' ? row.body : 'Attachment',
        from: row.sender_id === owner ? 'me' : 'them', sentAt: Date.parse(row.created_at), replyToId: row.reply_to_id };
}

export async function sendCloudText(chat, text, replyToId) {
    const owner = state.signedInAccountId;
    const client = await getSupabaseClient();
    const { data, error } = await client.from('messages').insert({
        conversation_id: chat.cloudId, sender_id: owner, kind: 'text', body: text,
        ...(replyToId ? { reply_to_id: replyToId } : {})
    }).select('id,sender_id,kind,body,reply_to_id,created_at').single();
    if (error) throw error;
    if (owner !== state.signedInAccountId) return;
    if (!chat.messages.some(message => message.id === data.id)) chat.messages.push(toChatMessage(data, owner));
    chat.sendRevision = (chat.sendRevision || 0) + 1;
    chat.lastActivity = Date.parse(data.created_at);
    chat.lastMessage = data.body;
    chat.cloudHasMessages = true;
}
