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
