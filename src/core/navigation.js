import { loadLiveData } from '../storage/live-broadcasts.js';
import { loadCloudReposts } from '../storage/cloud-reposts.js';
import { loadCloudSavedCollection, loadCloudSavedKeys } from '../storage/cloud-saved-items.js';
import { syncVisibleSaveButtons } from '../features/saved.events.js';
import { syncVisibleImageLikes } from '../features/likes.js';
import { cloudPerson, fetchSocialProfile, loadCloudFollowing } from '../features/cloud-people.js';
import { loadCloudInbox, loadCloudChat } from '../features/cloud-chat.js';
import { loadCloudImagePosts } from '../storage/image-posts.js';
import { loadCloudReels } from '../storage/cloud-reels.js';
import { loadCloudHighlights, loadCloudStoryArchive } from '../storage/cloud-highlights.js';
import { loadInboxStories, loadCloudStories } from '../storage/cloud-stories.js';
import { conversations, currentUser } from '../data/sample-data.js';
import { renderNotificationsPage, restoreNotificationFocus } from '../features/notifications.js';
import { renderPostCards } from '../components/post-card.js';
import { appShell, viewHeading, viewSections } from './dom.js';
import { state } from './state.js';
import { renderExplore } from '../features/explore.js';
import { getHomeFeedItems } from '../features/home.js';
import { refreshReadReceiptLabel, renderMessages } from '../features/messages.js';
import { renderProfile } from '../features/profile.js';
import { renderReels } from '../features/reels.js';
import { renderStories } from '../features/stories.js';
import { syncDeletionLock } from './account-lock.js';
import { findEntity } from '../data/entities.js';
import { canViewMedia } from './social.js';

const currentAppHistory = () => window.history.state && typeof window.history.state === 'object'
    ? window.history.state : {};

const mobileTabs = ['home', 'messages', 'reels', 'explore', 'profile'];
let pageSlide;

function slideToView(previousView, view, fromHistory) {
    if (!document.documentElement.classList.contains('android-app') || previousView === view) return;

    pageSlide?.cancel();
    if (document.hidden || appShell.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const previousTab = mobileTabs.indexOf(previousView);
    const nextTab = mobileTabs.indexOf(view);
    const backwards = fromHistory || (previousTab >= 0 && nextTab >= 0 && nextTab < previousTab)
        || previousView === 'notifications' || previousView === 'shared-post';
    const surface = appShell.querySelector('.main-area');
    pageSlide = surface?.animate?.(
        [{ transform: `translateX(${backwards ? -28 : 28}px)` }, { transform: 'translateX(0)' }],
        { duration: 220, easing: 'cubic-bezier(.18,.84,.28,1)' }
    );
}

function writeAppHistory(view, conversation = null, replace = false, groupProfile = null, postId = null) {
    const next = { ...currentAppHistory(), instaApp: { view, conversation, ...(groupProfile ? { groupProfile } : {}), ...(postId !== null ? { postId } : {}) } };
    window.history[replace ? 'replaceState' : 'pushState'](next, '', window.location.href);
}

export function pushConversationHistory(handle) {
    writeAppHistory('messages', handle);
}

export function openSharedPostPage(postId) {
    const conversation = state.activeConversationHandle;
    const route = currentAppHistory().instaApp;
    if (route?.view !== 'messages' || route.conversation !== conversation) writeAppHistory('messages', conversation, true);
    writeAppHistory('shared-post', null, false, null, postId);
    setView('shared-post', { fromHistory: true });
}

function renderSharedPostPage() {
    const page = viewSections['shared-post'][0];
    const content = page.querySelector('.shared-post-content');
    const post = findEntity('post', currentAppHistory().instaApp?.postId);
    if (post && canViewMedia(post)) renderPostCards([post], content);
    else content.textContent = 'This post is no longer available.';
    content.scrollTop = 0;
    page.querySelector('[data-shared-post-back]').focus({ preventScroll: true });
}

export function pushGroupProfileHistory(handle) {
    writeAppHistory('messages', state.activeConversationHandle, false, handle);
}

export function returnToConversationList(handle) {
    const route = currentAppHistory().instaApp;
    if (route?.view === 'messages' && route.conversation === handle) {
        window.history.back();
        return true;
    }
    return false;
}

window.addEventListener('popstate', event => {
    const route = event.state?.instaApp;
    const view = viewSections[route?.view] ? route.view : 'home';
    const conversation = view === 'messages' ? route?.conversation || null : null;
    state.activeGroupProfileHandle = view === 'messages' ? route?.groupProfile || null : null;
    if (state.activeConversationHandle !== conversation)
        state.activeConversationHandle = conversation;
    if (state.currentView !== view) setView(view, { fromHistory: true });
    else if (view === 'messages') {
        renderMessages();
        if (state.signedInAccountId) void refreshConnectedView('messages').catch(() => {});
    }
});

export function setView(view, { fromHistory = false, refresh = true } = {}) {
    if (syncDeletionLock()) return;
    if (!viewSections[view])
        return;
    const previousView = state.currentView;
    if (!fromHistory) {
        if (previousView !== view) writeAppHistory(view, null);
        else if (!currentAppHistory().instaApp) writeAppHistory(view, state.activeConversationHandle, true);
    }
    if (previousView !== view) {
        document.querySelectorAll('video').forEach(video => video.pause());
        if (state.pendingVideoTap) { clearTimeout(state.pendingVideoTap.timer); state.pendingVideoTap = null; }
        if (view !== 'messages') {
            state.activeConversationHandle = null;
            state.activeGroupProfileHandle = null;
        }
    }
    state.currentView = view;
    document.body.classList.toggle('notifications-open',view==='notifications');
    if(previousView==='notifications'&&view!=='notifications')restoreNotificationFocus();
    const accessNotice = document.getElementById('account-access-notice');
    accessNotice.hidden = state.verificationStatus === 'approved' && !state.deletionRequestedAt;
    accessNotice.innerHTML = state.deletionRequestedAt ? 'Deletion request pending. <button type="button" data-settings-page="deletion">Review request</button>' : 'Verification pending · browsing only. <button type="button" data-settings-page="verification">Check status</button>';
    appShell.className = `app-shell view-${view}`;
    const communityButton = document.querySelector('.explore-community-button');
    if (communityButton) communityButton.hidden = view !== 'explore' || !state.signedInAccountId;
    document.querySelectorAll("[data-view]").forEach((button) => {
        const isActive = button.dataset.view === view;
        if (button.matches(".nav-item, .mobile-nav-item"))
            button.classList.toggle("active", isActive);
        if (button.matches(".nav-item, .mobile-nav-item")) {
            if (isActive)
                button.setAttribute("aria-current", "page");
            else
                button.removeAttribute("aria-current");
        }
    });
    Object.entries(viewSections).forEach(([name, sections]) => {
        sections.forEach((section) => { section.hidden = name !== view; });
    });
    const titles = { explore: "Explore public posts", reels: "Reels", messages: "Messages", profile: "Profile" };
    viewHeading.hidden = view === 'home' || view === 'messages' || view === 'profile' || view === 'notifications' || view === 'shared-post';
    viewHeading.textContent = titles[view] || "";
    if (view === "notifications") renderNotificationsPage();
    if (view === "home") {
        renderStories();
        renderPostCards(getHomeFeedItems());
    }
    if (view === "explore" && previousView !== "explore")
        state.explorePostOrder = null;
    if (view === "explore")
        renderExplore();
    if (view === "reels")
        renderReels();
    if (view === "messages")
        renderMessages();
    if (view === "shared-post")
        renderSharedPostPage();
    if (view === "profile")
        renderProfile();
    slideToView(previousView, view, fromHistory);
    if (refresh && state.signedInAccountId && (view === 'profile' || previousView !== view)) {
        void refreshConnectedView(view).catch(() => {});
    }
}

const connectedLoads = new Map();

export function refreshConnectedView(view = state.currentView) {
    const owner = state.signedInAccountId;
    if (!owner) return Promise.resolve();
    const handle = state.profileHandle;
    const activeChat = state.activeConversationHandle;
    const key = [owner, view, view === 'profile' ? handle : view === 'messages' ? activeChat : ''].join(':');
    if (connectedLoads.has(key)) return connectedLoads.get(key);
    const pending = refreshViewData(view, owner, handle, activeChat)
        .finally(() => connectedLoads.delete(key));
    connectedLoads.set(key, pending);
    return pending;
}

async function refreshViewData(view, owner, handle, activeChat) {
    const stillVisible = () => state.currentView === view && state.signedInAccountId === owner;
    if (view === 'profile') {
        const target = handle === currentUser.handle ? owner : cloudPerson(handle)?.id;
        if (!target) return;
        const person = await fetchSocialProfile(target);
        if (person) {
            if (target === owner) {
                currentUser.avatar = person.avatar;
                currentUser.name = person.name;
                currentUser.bio = person.bio;
                document.querySelectorAll('.profile-nav-button img, .profile-card img, .mini-avatar-wrap img, .desktop-profile-button img')
                    .forEach(image => { image.src = person.avatar; });
            }
            const followed = state.cloudFollowingIds ||= new Set();
            if (person.followStatus === 'accepted') followed.add(target);
            else followed.delete(target);
            const accessible = target === owner || !person.isPrivate || person.followStatus === 'accepted';
            const loads = accessible ? [
                loadCloudImagePosts(target), loadCloudReels(target).catch(() => {}),
                loadCloudImagePosts(null, person.handle).catch(() => {}),
                loadCloudHighlights(target, person.handle).catch(() => {}),
            ] : [];
            if (!accessible) {
                state.cloudTaggedPosts?.delete(person.handle);
                if (state.cloudReposts?.handle === handle) state.cloudReposts = null;
            }
            if (accessible && state.activeProfileSection === 'reposts' && state.profileHandle === handle) {
                loads.push(loadCloudReposts(target, handle));
            }
            if (target === owner) {
                loads.push(loadCloudSavedKeys(), loadCloudSavedCollection(), loadCloudStoryArchive().catch(() => {}));
            }
            await Promise.all(loads);
        }
        if (stillVisible() && state.profileHandle === handle) {
            if (!person) document.getElementById('profile-view').textContent = 'This profile is no longer available.';
            else { renderProfile(); syncVisibleImageLikes(); syncVisibleSaveButtons(); }
        }
    } else if (view === 'messages') {
        const chat = conversations.find(item => item.handle === activeChat && item.cloudId);
        const changed = chat ? await loadCloudChat(chat) : (await loadCloudInbox(), await loadInboxStories().catch(() => {}), true);
        if (stillVisible() && state.activeConversationHandle === activeChat && !state.activeGroupProfileHandle) {
            if (changed && (chat || !activeChat)) renderMessages({ preserveComposer: Boolean(chat) });
            else if (chat) refreshReadReceiptLabel(chat);
        }
    } else if (view === 'reels') {
        await Promise.all([loadCloudReels(), loadCloudSavedKeys()]);
        if (stillVisible()) renderReels();
    } else if (view === 'home' || view === 'explore') {
        await loadCloudFollowing();
        await Promise.all([loadCloudImagePosts(), loadCloudSavedKeys(),
            view === 'home' ? loadCloudReels().catch(() => {}) : undefined,
            view === 'home' ? loadCloudStories().catch(() => {}) : undefined,
            view === 'home' ? loadLiveData().catch(() => {}) : undefined]);
        if (stillVisible()) {
            if (view === 'home') {
                renderPostCards(getHomeFeedItems());
                renderStories();
            } else renderExplore();
        }
    }
}
