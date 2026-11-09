import { state } from '../core/state.js';
import { currentUser, conversations } from '../data/sample-data.js';
import { canViewMedia, getAccount, mayInteract, DEFAULT_AVATAR } from '../core/social.js';

export function conversationMembers(conversation) {
    return conversation.isGroup ? conversation.members || [] : [currentUser.handle, conversation.handle];
}

export function canSendToConversation(conversation) {
    if (!conversation || !mayInteract()) return false;
    if (conversation.isGroup && (!(conversation.members || []).includes(currentUser.handle) || conversation.membershipStatus === 'pending')) return false;
    return !conversationMembers(conversation).some(handle => state.blockedHandles.has(handle));
}

export function canShareToConversation(entity, conversation) {
    return canSendToConversation(conversation) && canViewMedia(entity) &&
        conversationMembers(conversation).every(handle => canViewMedia(entity, handle));
}

export function createLocalGroup(name, handles) {
    if (!mayInteract()) return null;
    const recipients = [...new Set(handles)].filter(handle => handle !== currentUser.handle && getAccount(handle) && !state.blockedHandles.has(handle));
    if (!name.trim() || !recipients.length) return null;
    const pendingMembers = recipients.filter(handle => getAccount(handle)?.groupJoinMode === 'review');
    const group = {
        id: `group-${Date.now()}`, handle: `group:${Date.now()}`, user: name.trim().slice(0, 60),
        avatar: DEFAULT_AVATAR, isGroup: true, admins: [currentUser.handle],
        members: [currentUser.handle, ...recipients.filter(handle => !pendingMembers.includes(handle))],
        pendingMembers, messages: [], lastActivity: Date.now(), pinned: false, muted: false, unread: false
    };
    conversations.push(group);
    return group;
}

// This local entry point respects the receiving account's saved preference.
// A future delivery service must perform the same check on the server.
export function receiveLocalGroupInvitation(group, inviterHandle) {
    if (!mayInteract() || state.blockedHandles.has(inviterHandle)) return false;
    group.isGroup = true;
    group.pendingMembers ||= [];
    group.members ||= [];
    if (state.groupJoinMode === 'review') {
        group.members = group.members.filter(handle => handle !== currentUser.handle);
        if (!group.pendingMembers.includes(currentUser.handle)) group.pendingMembers.push(currentUser.handle);
        group.membershipStatus = 'pending';
    } else {
        if (!group.members.includes(currentUser.handle)) group.members.push(currentUser.handle);
        group.membershipStatus = 'joined';
    }
    if (!conversations.includes(group)) conversations.push(group);
    return true;
}

export function respondToGroupInvitation(group, accept) {
    if (!mayInteract() || group.membershipStatus !== 'pending' || (group.members || []).some(handle => state.blockedHandles.has(handle))) return false;
    if (accept) {
        group.members = [...new Set([...(group.members || []), currentUser.handle])];
        group.pendingMembers = (group.pendingMembers || []).filter(handle => handle !== currentUser.handle);
        group.membershipStatus = 'joined';
    } else {
        const index = conversations.indexOf(group);
        if (index >= 0) conversations.splice(index, 1);
    }
    return true;
}


export function isJoinedGroup(group) {
    return Boolean(group?.isGroup && group.membershipStatus !== 'pending' && group.members?.includes(currentUser.handle));
}

export function leaveLocalGroup(group) {
    const index = conversations.indexOf(group);
    if (!mayInteract() || !isJoinedGroup(group) || index < 0) return false;
    group.members = group.members.filter(handle => handle !== currentUser.handle);
    group.admins = (group.admins || []).filter(handle => handle !== currentUser.handle);
    group.membershipStatus = 'left';
    conversations.splice(index, 1);
    return true;
}


export function isGroupAdmin(group) {
    return isJoinedGroup(group) && Boolean(group.admins?.includes(currentUser.handle));
}

export function updateGroupMember(group, handle, action) {
    if (!mayInteract() || !isGroupAdmin(group) || handle === currentUser.handle || !group.members.includes(handle)) return false;
    if (action === 'make-admin') {
        group.admins = [...new Set([...group.admins.filter(admin => admin !== currentUser.handle), handle])];
    } else if (action === 'remove') {
        group.members = group.members.filter(member => member !== handle);
        group.admins = group.admins.filter(admin => admin !== handle);
        group.pendingMembers = (group.pendingMembers || []).filter(member => member !== handle);
    } else {
        return false;
    }
    return true;
}

export function availableGroupInvitees(group) {
    const existing = new Set([currentUser.handle, ...group.members, ...(group.pendingMembers || [])]);
    return state.accountDirectory.filter(account => !existing.has(account.handle) && !state.blockedHandles.has(account.handle));
}

export function addLocalGroupMembers(group, handles) {
    if (!mayInteract() || !isGroupAdmin(group) || !conversations.includes(group)) return false;
    const selected = new Set(handles);
    const invitees = availableGroupInvitees(group).filter(account => selected.has(account.handle));
    if (!invitees.length) return false;
    group.members = [...group.members, ...invitees.filter(account => account.groupJoinMode !== 'review').map(account => account.handle)];
    group.pendingMembers = [...(group.pendingMembers || []), ...invitees.filter(account => account.groupJoinMode === 'review').map(account => account.handle)];
    return true;
}

const CHAT_RETENTION_MS = 24 * 60 * 60 * 1000;

export function visibleConversationMessages(conversation, viewer = currentUser.handle) {
    const cleared = conversation.isGroup ? conversation.clearedMessageCount?.[viewer] ?? 0 : 0;
    const hidden = new Set(conversation.hiddenMessageIds?.[viewer]);
    return (conversation.messages || []).slice(cleared).filter(message => !hidden.has(message.id));
}

function removeConversationMessages(chat, shouldRemove) {
    const removedIndexes = [];
    const remaining = (chat.messages || []).filter((message, index) => {
        if (!shouldRemove(message)) return true;
        removedIndexes.push(index);
        if (message.type === 'story-mention') state.deletedChatMentionIds.add(message.id);
        if (typeof message.media === 'string' && message.media.startsWith('blob:')) URL.revokeObjectURL(message.media);
        return false;
    });
    if (!removedIndexes.length) return false;
    if (chat.clearedMessageCount) {
        for (const [viewer, count] of Object.entries(chat.clearedMessageCount)) {
            chat.clearedMessageCount[viewer] = count - removedIndexes.filter(index => index < count).length;
        }
    }
    chat.messages = remaining;
    if (!remaining.length) {
        chat.lastMessage = '';
        chat.lastActivity = 0;
        chat.unread = false;
        chat.unreadCount = 0;
    }
    return true;
}

export function deleteSentMessagesForEveryone(chat, ids) {
    const selected = new Set(ids);
    const messages = visibleConversationMessages(chat).filter(message => selected.has(message.id));
    if (!messages.length || messages.length !== selected.size || messages.some(message => message.from !== 'me')) return false;
    return removeConversationMessages(chat, message => selected.has(message.id));
}

export function refreshConversationTimers(conversations, now = Date.now()) {
    let changed = false;
    let nextExpiry = Infinity;
    for (const chat of conversations) {
        if (chat.isGroup || chat.chatTimerEnabled !== true || !chat.messages?.length) continue;
        const removed = removeConversationMessages(chat, message => {
            if (!Number.isFinite(message.sentAt)) return false;
            const expiry = message.sentAt + CHAT_RETENTION_MS;
            if (expiry <= now) return true;
            nextExpiry = Math.min(nextExpiry, expiry);
            return false;
        });
        changed = changed || removed;
    }
    return { changed, nextExpiry };
}

export function hideConversationMessages(conversation, ids, viewer = currentUser.handle) {
    const visibleIds = new Set(visibleConversationMessages(conversation, viewer).map(message => message.id));
    const selected = ids.filter(id => visibleIds.has(id));
    if (!selected.length) return false;
    conversation.hiddenMessageIds = {
        ...conversation.hiddenMessageIds,
        [viewer]: [...(conversation.hiddenMessageIds?.[viewer] || []), ...new Set(selected)],
    };
    return true;
}
