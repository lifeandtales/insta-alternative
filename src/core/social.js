import { state } from './state.js';
import { currentUser, posts, reels, conversations } from '../data/sample-data.js';

export const DEFAULT_AVATAR = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" rx="50" fill="#eee9f7"/><circle cx="50" cy="37" r="18" fill="#b2a6c8"/><path d="M15 96a35 35 0 0 1 70 0" fill="#b2a6c8"/></svg>'
);

export function initializeSocialState() {
    if (state.accountDirectory.length) return;
    const accounts = new Map();
    const add = person => {
        if (!person.handle || accounts.has(person.handle)) return;
        accounts.set(person.handle, {
            id: person.handle === currentUser.handle ? 'local-owner' : `demo:${person.handle}`,
            handle: person.handle,
            name: person.name || person.user || person.handle,
            avatar: person.avatar || DEFAULT_AVATAR,
            bio: person.bio || '',
            isPrivate: false,
            followers: [],
            following: [],
            contentAudience: 'all'
        });
    };
    add(currentUser);
    [...posts, ...reels, ...conversations].forEach(person => {
        add(person);
        (person.commentItems || []).forEach(add);
    });
    for (const account of accounts.values()) {
        const media = [...posts, ...reels].filter(item => item.handle === account.handle);
        if (media.length && account.handle !== currentUser.handle) {
            account.isPrivate = media.every(item => !item.public);
        }
    }
    const owner = accounts.get(currentUser.handle);
    owner.isPrivate = currentUser.isPrivate;
    for (const item of [...posts, ...reels]) {
        if (item.followed && item.handle !== currentUser.handle) {
            state.followedAccountHandles.add(item.handle);
        }
        (item.commentItems || []).forEach(comment => {
            if (comment.followsMe && comment.handle !== currentUser.handle && !owner.followers.includes(comment.handle)) {
                owner.followers.push(comment.handle);
            }
        });
    }
    owner.following = [...state.followedAccountHandles];
    for (const handle of owner.following) {
        accounts.get(handle)?.followers.push(currentUser.handle);
    }
    for (const handle of owner.followers) {
        accounts.get(handle)?.following.push(currentUser.handle);
    }
    state.accountDirectory = [...accounts.values()];
    [...posts, ...reels].forEach((item, index) => {
        item.views ??= 0;
        item.watchTimeSeconds ??= item.views * 4;
        (item.commentItems || []).forEach((comment, commentIndex) => {
            comment.id ??= `sample-comment-${item.id}-${commentIndex}`;
            comment.createdAt ??= item.createdAt + commentIndex * 1000;
        });
    });
}

export function getAccount(handle) {
    return state.accountDirectory.find(account => account.handle === handle);
}

export function isFollowing(handle, viewerHandle = currentUser.handle) {
    if (viewerHandle === currentUser.handle) {
        if (state.blockedHandles.has(handle)) return false;
        return state.followedAccountHandles.has(handle) || [...posts, ...reels].some(item => item.handle === handle && item.followed);
    }
    return Boolean(getAccount(viewerHandle)?.following.includes(handle));
}

export function canViewAccount(handle, viewerHandle = currentUser.handle) {
    if (handle === viewerHandle) return true;
    if (viewerHandle === currentUser.handle && state.blockedHandles.has(handle)) return false;
    if (handle === currentUser.handle && state.blockedHandles.has(viewerHandle)) return false;
    const account = getAccount(handle);
    return !account?.isPrivate || isFollowing(handle, viewerHandle);
}

export function canViewMedia(item, viewerHandle = currentUser.handle) {
    if (viewerHandle === currentUser.handle && state.deletionRequestedAt) return false;
    if (!item || item.prohibited || !canViewAccount(item.handle, viewerHandle)) return false;
    const viewerIsMinor = viewerHandle === currentUser.handle ? state.viewerAgeBand === 'minor' : getAccount(viewerHandle)?.ageBand === 'minor';
    if (viewerIsMinor) {
        if (item.sensitive || item.audience === 'adult' || getAccount(item.handle)?.contentAudience === 'adult') return false;
    }
    if (item.handle === viewerHandle) return true;
    if (item.public === false && !isFollowing(item.handle, viewerHandle)) return false;
    return true;
}

export function mediaNeedsWarning(item) {
    return Boolean(item.sensitive || item.audience === 'adult' || getAccount(item.handle)?.contentAudience === 'adult');
}

export function canViewStory(story, viewerHandle = currentUser.handle, visited = new Set()) {
    if (!canViewMedia(story, viewerHandle)) return false;
    if (story.repostedFromHandle && !canViewAccount(story.repostedFromHandle, viewerHandle)) return false;
    if (story.repostedStoryId) {
        if (visited.has(story.id)) return false;
        const source = state.stories.find(item => item.id === story.repostedStoryId);
        if (source) {
            const chain = new Set(visited); chain.add(story.id);
            if (!canViewStory(source, viewerHandle, chain)) return false;
        }
    }
    if (story.sourcePostId) {
        const source = [...posts, ...reels].find(item => item.id === story.sourcePostId);
        if (!source || !canViewMedia(source, viewerHandle)) return false;
    }
    if (story.handle === viewerHandle) return true;
    if (story.audience === 'close-friends') {
        const owner = getAccount(story.handle);
        const members = story.handle === currentUser.handle ? [...state.closeFriendHandles] : owner?.closeFriendHandles || [];
        return members.includes(viewerHandle);
    }
    return true;
}

export function visibleHighlightStories(highlight, viewerHandle = currentUser.handle) {
    const members = highlight.handle === currentUser.handle ? [...state.closeFriendHandles] : getAccount(highlight.handle)?.closeFriendHandles || [];
    return (highlight.stories || []).map(story => ({ ...story, handle: highlight.handle || story.handle, audience: highlight.audience || 'all', closeFriendHandles: members }))
        .filter(story => canViewStory(story, viewerHandle));
}

export function visibleAvatar(handle, fallback = DEFAULT_AVATAR) {
    const account = getAccount(handle);
    return canViewAccount(handle) ? (account?.avatar || fallback) : DEFAULT_AVATAR;
}

export function mayInteract() {
    return state.verificationStatus === 'approved' && !state.deletionRequestedAt;
}

export function accountIsPublic(handle) {
    const account = getAccount(handle);
    if (account) return !account.isPrivate;
    return [...posts, ...reels].some(item => item.handle === handle && item.public);
}

export function changeFollow(handle) {
    if (!mayInteract() || state.blockedHandles.has(handle) || handle === currentUser.handle) return 'unavailable';
    const account = getAccount(handle);
    if (state.followRequests.includes(handle)) {
        state.followRequests = state.followRequests.filter(value => value !== handle);
        return 'cancelled';
    }
    if (isFollowing(handle)) {
        state.followedAccountHandles.delete(handle);
        [...posts, ...reels].filter(item => item.handle === handle).forEach(item => { item.followed = false; });
        if (account) account.followers = account.followers.filter(value => value !== currentUser.handle);
        return 'unfollowed';
    }
    if (account?.isPrivate) {
        state.followRequests.push(handle);
        return 'requested';
    }
    state.followedAccountHandles.add(handle);
    if (account && !account.followers.includes(currentUser.handle)) account.followers.push(currentUser.handle);
    return 'followed';
}

export function mediaKey(type, id) {
    return `${type}:${id}`;
}
