import { accountStorageKey } from './browser-storage.js';
import { state } from '../core/state.js';
import { currentUser, posts, reels, demoContentEnabled } from '../data/sample-data.js';
import { DEFAULT_AVATAR, initializeSocialState } from '../core/social.js';

const KEY = 'insta-preferences-v1';
const setFields = ['hiddenPostKeys', 'mutedPostHandles', 'mutedStoryHandles', 'blockedHandles',
    'closeFriendHandles', 'followedAccountHandles', 'seenStoryIds'];
const scalarFields = ['accountDirectory', 'followRequests', 'incomingFollowRequests', 'groupJoinMode',
    'viewerAgeBand', 'verificationStatus', 'contentAudience', 'audienceReview', 'usernameChanges',
    'reservedUsernames', 'deletionRequestedAt', 'verificationResubmittedAt', 'localStoryNotifications'];

export function loadPreferences() {
    initializeSocialState();
    try {
        const data = JSON.parse(localStorage.getItem(accountStorageKey(KEY)) || 'null');
        if (!data || data.version !== 1) return;
        for (const field of setFields) {
            if (Array.isArray(data[field])) state[field] = new Set(data[field]);
        }
        for (const field of scalarFields) {
            if (data[field] !== undefined) state[field] = data[field];
        }
        if (data.profile && typeof data.profile.handle === 'string') {
            const previousHandle = currentUser.handle;
            Object.assign(currentUser, data.profile);
            [...posts, ...reels].filter(item => item.handle === previousHandle).forEach(item => {
                Object.assign(item, {handle: currentUser.handle, user: currentUser.name, avatar: currentUser.avatar, public: !currentUser.isPrivate});
            });
            state.profileHandle = currentUser.handle;
        }
        if (!demoContentEnabled) {
            const demoHandles = new Set(state.accountDirectory.filter(account => String(account.id).startsWith('demo:')).map(account => account.handle));
            state.accountDirectory = state.accountDirectory.filter(account => !demoHandles.has(account.handle));
            state.followedAccountHandles = new Set([...state.followedAccountHandles].filter(handle => !demoHandles.has(handle)));
            for (const account of state.accountDirectory) {
                account.followers = (account.followers || []).filter(handle => !demoHandles.has(handle));
                account.following = (account.following || []).filter(handle => !demoHandles.has(handle));
            }
            state.localStoryNotifications = state.localStoryNotifications.filter(notice => !notice.demo && !demoHandles.has(notice.actor));
            if (currentUser.name === 'Mila Rose') currentUser.name = 'Your profile';
            if (currentUser.bio === 'Design storyteller ✨ Finding beauty in little things.') currentUser.bio = '';
            if (currentUser.avatar?.includes('photo-1494790108377-be9c29b29330')) currentUser.avatar = DEFAULT_AVATAR;
            const owner = state.accountDirectory.find(account => account.handle === currentUser.handle);
            if (owner) Object.assign(owner, { name: currentUser.name, avatar: currentUser.avatar || DEFAULT_AVATAR, bio: currentUser.bio });
        }
        [...posts, ...reels].forEach(item => { item.followed = state.followedAccountHandles.has(item.handle); });
    } catch (error) {
        console.error('Could not load app preferences', error);
    }
}

export function persistPreferences() {
    try {
        const data = {version: 1, profile: {...currentUser}};
        for (const field of setFields) data[field] = [...state[field]];
        for (const field of scalarFields) data[field] = state[field];
        localStorage.setItem(accountStorageKey(KEY), JSON.stringify(data));
        return true;
    } catch (error) {
        console.error('Could not save app preferences', error);
        return false;
    }
}
