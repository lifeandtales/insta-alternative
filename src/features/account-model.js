import { state } from '../core/state.js';
import { currentUser, posts, reels, conversations } from '../data/sample-data.js';
import { DEFAULT_AVATAR, getAccount, mayInteract } from '../core/social.js';
import { normalizeHandle } from '../core/utils.js';

export function validateProfile({ name, username, bio, links }, now = Date.now()) {
    if (!name.trim()) return 'Enter a display name.';
    const legacyCurrentUsername = username === currentUser.handle.slice(1) && /^[a-zA-Z0-9._]{1,35}$/.test(username);
    if (!/^[a-zA-Z0-9._]{8,20}$/.test(username) && !legacyCurrentUsername) return 'Use 8–20 characters: letters, numbers, dots or underscores. No spaces or required character mix.';
    if ([...bio].length > 200) return 'Bio can contain up to 200 characters.';
    if (links.length > 5) return 'Add up to five links.';
    for (const link of links) {
        try { const url = new URL(link); if (!['http:', 'https:'].includes(url.protocol) || !url.hostname.includes('.')) return 'Use a complete http:// or https:// link.'; }
        catch { return 'Use a complete http:// or https:// link.'; }
    }
    const handle = '@' + username;
    const ownerId = getAccount(currentUser.handle)?.id || 'local-owner';
    const changing = handle.toLowerCase() !== currentUser.handle.toLowerCase();
    if (changing && state.usernameChanges >= 5) return 'All five lifetime username changes have been used.';
    if (state.accountDirectory.some(person => person.handle.toLowerCase() === handle.toLowerCase() && person.id !== 'local-owner')) return 'This username is already in use.';
    if (changing && state.reservedUsernames.some(item => item.handle.toLowerCase() === handle.toLowerCase() && item.expiresAt > now && (item.ownerId || 'local-owner') !== ownerId)) return 'This former username is reserved for its owner for one day.';
    return '';
}

export function updateOwnProfile(profile, now = Date.now()) {
    if (!mayInteract()) return 'Profile editing is unavailable in the current account state.';
    const error = validateProfile(profile, now); if (error) return error;
    const previousHandle = currentUser.handle, handle = '@' + profile.username;
    const owner = getAccount(previousHandle);
    if (handle.toLowerCase() !== previousHandle.toLowerCase()) {
        state.usernameChanges += 1;
        state.reservedUsernames = state.reservedUsernames.filter(item => item.expiresAt > now && item.handle.toLowerCase() !== handle.toLowerCase() && item.handle.toLowerCase() !== previousHandle.toLowerCase());
        state.reservedUsernames.push({ handle: previousHandle, ownerId: owner?.id || 'local-owner', expiresAt: now + 86400000 });
    }
    Object.assign(currentUser, { name: profile.name.trim(), handle, bio: profile.bio, links: profile.links });
    if (owner) Object.assign(owner, { name: currentUser.name, handle, bio: currentUser.bio, links: currentUser.links });
    synchronizeOwnIdentity(previousHandle);
    return '';
}

export function synchronizeOwnIdentity(previousHandle = currentUser.handle) {
    const replace = handle => handle === previousHandle ? currentUser.handle : handle;
    for (const item of [...posts, ...reels, ...state.stories, ...state.storyHighlights]) {
        if (item.handle === previousHandle) Object.assign(item, { handle: currentUser.handle, user: currentUser.name, avatar: currentUser.avatar });
        if (item.taggedUsers) item.taggedUsers = item.taggedUsers.map(handle => normalizeHandle(handle) === normalizeHandle(previousHandle) ? currentUser.handle : normalizeHandle(handle));
        if (item.taggedHandles) item.taggedHandles = item.taggedHandles.map(handle => normalizeHandle(handle) === normalizeHandle(previousHandle) ? currentUser.handle : normalizeHandle(handle));
        for (const comment of item.commentItems || []) if (comment.handle === previousHandle) Object.assign(comment, { handle: currentUser.handle, user: currentUser.name, avatar: currentUser.avatar });
        for (const story of item.stories || []) if (story.handle === previousHandle) Object.assign(story, { handle: currentUser.handle, user: currentUser.name, avatar: currentUser.avatar });
    }
    for (const person of state.accountDirectory) {
        person.followers = (person.followers || []).map(replace); person.following = (person.following || []).map(replace);
        if (person.closeFriendHandles) person.closeFriendHandles = person.closeFriendHandles.map(replace);
    }
    for (const conversation of conversations) {
        if (!conversation.isGroup && conversation.handle === previousHandle) Object.assign(conversation, { handle: currentUser.handle, user: currentUser.name, avatar: currentUser.avatar });
        for (const field of ['members', 'pendingMembers', 'admins']) if (conversation[field]) conversation[field] = conversation[field].map(replace);
        for (const message of conversation.messages || []) if (message.senderHandle === previousHandle) message.senderHandle = currentUser.handle;
    }
    if (state.profileHandle === previousHandle) state.profileHandle = currentUser.handle;
    const owner = state.accountDirectory.find(person => person.id === 'local-owner');
    if (owner) Object.assign(owner, currentUser);
}

export function updateOwnAvatar(avatar = DEFAULT_AVATAR) {
    currentUser.avatar = avatar; synchronizeOwnIdentity();
}

export function setAccountPrivacy(isPrivate) {
    if (!mayInteract()) return false;
    currentUser.isPrivate = isPrivate;
    const owner = getAccount(currentUser.handle); if (owner) owner.isPrivate = isPrivate;
    [...posts, ...reels].filter(item => item.handle === currentUser.handle).forEach(item => { item.public = !isPrivate; });
    return true;
}

export function setAccountBlocked(handle, blocked) {
    if (!mayInteract() || handle === currentUser.handle) return false;
    if (!blocked) { state.blockedHandles.delete(handle); return true; }
    state.blockedHandles.add(handle); state.followedAccountHandles.delete(handle);
    state.followRequests = state.followRequests.filter(value => value !== handle);
    state.incomingFollowRequests = state.incomingFollowRequests.filter(value => value !== handle);
    for (const item of [...posts, ...reels]) if (item.handle === handle) item.followed = false;
    const owner = getAccount(currentUser.handle), other = getAccount(handle);
    if (owner) { owner.followers = owner.followers.filter(value => value !== handle); owner.following = owner.following.filter(value => value !== handle); }
    if (other) { other.followers = other.followers.filter(value => value !== currentUser.handle); other.following = other.following.filter(value => value !== currentUser.handle); }
    return true;
}

export function respondToFollowRequest(handle, accept) {
    if (!mayInteract() || state.blockedHandles.has(handle) || !state.incomingFollowRequests.includes(handle)) return false;
    state.incomingFollowRequests = state.incomingFollowRequests.filter(value => value !== handle);
    const owner = getAccount(currentUser.handle), other = getAccount(handle);
    if (accept && owner && other) {
        owner.followers = [...new Set([...owner.followers, handle])];
        other.following = [...new Set([...other.following, currentUser.handle])];
        // A real notification is deferred; retain an event for the local prototype.
        state.localApprovalNotices ||= [];
        state.localApprovalNotices.push({ recipient: handle, type: 'follow-approved', createdAt: Date.now() });
    }
    return true;
}

export function removeFollower(handle) {
    if (!mayInteract()) return false;
    const owner = getAccount(currentUser.handle), other = getAccount(handle);
    if (owner) owner.followers = owner.followers.filter(value => value !== handle);
    if (other) other.following = other.following.filter(value => value !== currentUser.handle);
    return true;
}
