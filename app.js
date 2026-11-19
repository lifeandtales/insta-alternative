import { registerSignupValidation, resetSignupFeedback, pauseSignupValidation } from './src/features/signup-validation.js';
import { readAuthEmail, checkSignupEmailResponse } from './src/features/auth-email.js';
import { registerLiveEvents } from './src/features/live-broadcasts.js';
import { registerInAppCallControls } from './src/features/in-app-calls.js';
import { loadCloudSavedKeys, subscribeToSavedChanges } from './src/storage/cloud-saved-items.js';
import { subscribeToSocialUpdates } from './src/features/social-updates.js';
import { readCloudAvatar } from './src/storage/cloud-avatars.js';
import { loadCloudFollowing } from './src/features/cloud-people.js';
import { loadCloudImagePosts } from './src/storage/image-posts.js';
import { registerHomePullToRefresh } from './src/features/home.js';
import { currentUser, demoContentEnabled } from './src/data/sample-data.js';
import { DEFAULT_AVATAR } from './src/core/social.js';
import { registerStoryShortcutEvents } from './src/features/story-shortcuts.js';
import { processScheduledPosts } from './src/features/create.js';
import { registerStoryExportEvents } from './src/features/story-export.js';
import { registerHomeControlEvents } from './src/features/home-controls.js';
import { registerAccountSettingsEvents, openAccountSettings } from './src/features/account-settings.js';
import { loadSession, persistSession } from './src/storage/local-session.js';
// Entry point: initialize storage, media observation, event routing, then Home.
import { state } from './src/core/state.js';
import { loadSavedItems, loadJoinedCommunities, loadStoryHighlights } from './src/storage/browser-storage.js';
import { initializeVideoObserver } from './src/media/video.js';
import { refreshConnectedView, setView } from './src/core/navigation.js';
import { showShareFeedback } from './src/components/feedback.js';
import {
    handleVideoExitClick,
    handleVideoClick,
    handleMediaSoundClick,
    registerVideoPointerEvents,
} from './src/media/video.events.js';
import { handleFollowClick } from './src/features/follows.events.js';
import { handleMessageClick, registerMessageFormEvents, refreshChatAttachmentExpiry } from './src/features/messages.events.js';
import { dismissOpenMenus, registerKeyboardEvents } from './src/core/events.js';
import {
    handleStoryMenuClick,
    handleStoryOwnerClick,
    handleStoryClick,
    registerStoryGestureEvents,
    registerStoryUploadEvents,
} from './src/features/stories.events.js';
import { handleNavigationClick, handlePlaceholderClick, registerMobileNavigationGestures } from './src/core/navigation.events.js';
import {
    handleProfileSectionClick,
    handleProfileMediaClick,
    handleAuthorClick,
    registerProfileEditorEvents,
    registerProfileGridEvents,
} from './src/features/profile.events.js';
import { handleHighlightClick, registerHighlightEvents } from './src/features/highlights.events.js';
import {
    handleOpenCreateClick,
    handleCreateUploadClick,
    registerMediaUploadEvents,
} from './src/features/create.events.js';
import { handleExploreClick, registerExploreSearchEvents } from './src/features/explore.events.js';
import { handlePostOptionsClick } from './src/features/media-options.events.js';
import { handleLikeClick, handleLikersClick, registerMediaLikeEvents } from './src/features/likes.events.js';
import { handleSaveClick, refreshSavedState } from './src/features/saved.events.js';
import {
    handleCommentClick,
    registerCommentEvents,
    registerCommentComposerEvents,
} from './src/features/comments.events.js';
import { handleSharingClick } from './src/features/sharing.events.js';
import { loadPreferences, persistPreferences } from './src/storage/preferences.js';
import { registerDeletionLock, syncDeletionLock } from './src/core/account-lock.js';
import { openMediaFromHash } from './src/core/media-links.js';
import { registerNotificationEvents, updateNotificationBadge, syncIncomingPostMentions, syncIncomingStoryMentions } from './src/features/notifications.js';
import { getSupabaseClient, setSupabaseSessionPersistence, startTemporarySupabaseSession } from './src/storage/supabase.js';
import { ensureSupabaseProfile, profileDetails, signOutAccount } from './src/features/account-auth.js';
import { registerStoryToolEvents } from './src/features/story-tools.js';
import { registerStoryOptionEvents } from './src/features/story-options.js';

const welcomeScreen = document.getElementById('welcome-screen');
const welcomeMessage = document.getElementById('welcome-message');
const welcomeEntry = document.getElementById('welcome-entry');
const welcomeForms = [...document.querySelectorAll('[data-entry-form]')];
const welcomeStatus = document.getElementById('welcome-auth-status');
const welcomeSessionChoice = document.getElementById('welcome-session-choice');
let pendingProfileUser;
let pendingLogin;
let authBusy = false;

function showWelcomeForm(mode, status = '') {
    welcomeMessage.hidden = Boolean(mode);
    welcomeEntry.hidden = !mode;
    welcomeSessionChoice.hidden = mode !== 'remember';
    welcomeStatus.textContent = status;
    welcomeStatus.hidden = !status;
    for (const form of welcomeForms) {
        resetSignupFeedback(form);
        form.reset();
        form.hidden = form.dataset.entryForm !== mode;
        form.querySelector('.welcome-form-error').hidden = true;
        const emailError = form.querySelector('[data-email-error]');
        if (emailError) { emailError.hidden = true; emailError.textContent = ''; }
        form.elements.email?.removeAttribute?.('aria-invalid');
        for (const input of form.querySelectorAll('.welcome-password-wrap input')) input.type = 'password';
        for (const button of form.querySelectorAll('[data-toggle-password]')) {
            button.textContent = 'Show';
            button.setAttribute('aria-label', 'Show password');
            button.setAttribute('aria-pressed', 'false');
        }
    }
    const titles = { signup: 'Create account', login: 'Log in', profile: 'Complete your profile', remember: 'Keep me logged in?' };
    document.getElementById('welcome-entry-title').textContent = titles[mode] || '';
    document.getElementById('welcome-entry-eyebrow').textContent = '';
    document.getElementById('welcome-entry-description').textContent = '';
    if (mode === 'remember') document.getElementById('welcome-entry-title').focus();
    else welcomeForms.find(form => form.dataset.entryForm === mode)?.querySelector('input')?.focus();
}

function loadAccountPreferences() {
    loadPreferences();
    currentUser.avatar ||= DEFAULT_AVATAR;
    state.savedItems = loadSavedItems();
    state.joinedCommunityIds = loadJoinedCommunities();
}

function renderAccountIdentity() {
    document.querySelectorAll('.profile-nav-button img, .profile-card img, .mini-avatar-wrap img, .desktop-profile-button img')
        .forEach(image => { image.src = currentUser.avatar; });
    document.querySelectorAll('.profile-card strong, .mini-profile strong')
        .forEach(label => { label.textContent = currentUser.name; });
}

async function loadAccountContent() {
    const [sessionResult] = await Promise.allSettled([loadSession(), loadStoryHighlights()]);
    if (demoContentEnabled && sessionResult.status === 'rejected') return;
    try { await loadCloudFollowing(); await Promise.all([loadCloudImagePosts(), loadCloudSavedKeys()]); }
    catch { showShareFeedback('Could not load your saved image posts. Pull down on Home to retry.'); }
    refreshChatAttachmentExpiry();
    processScheduledPosts();
    syncIncomingStoryMentions();
    syncIncomingPostMentions();
    setView(state.currentView);
    updateNotificationBadge();
}

async function enterAccount(user, profile) {
    state.signedInAccountId = user.id;
    const identity = { handle: '@' + profile.username, name: profile.display_name, bio: profile.bio || '', isPrivate: Boolean(profile.is_private), links: profile.links || [] };
    Object.assign(currentUser, identity);
    loadAccountPreferences();
    Object.assign(currentUser, identity);
    if (profile.avatar_path) {
        try { currentUser.avatar = await readCloudAvatar(profile.avatar_path) || DEFAULT_AVATAR; }
        catch { currentUser.avatar = DEFAULT_AVATAR; }
    }
    state.profileHandle = currentUser.handle;
    const account = state.accountDirectory.find(item => item.id === user.id || item.id === 'local-owner');
    if (account) Object.assign(account, { id: user.id, ...identity, avatar: currentUser.avatar });
    state.viewerAgeBand = user.user_metadata?.age_band === 'adult' ? 'adult' : 'minor';
    renderAccountIdentity();
    await loadAccountContent();
    void subscribeToSocialUpdates(user.id).catch(() => {});
    void subscribeToSavedChanges(user.id, refreshSavedState).catch(() => {});
    for (const form of welcomeForms) form.reset();
    pendingProfileUser = null;
    welcomeScreen.hidden = true;
    if (syncDeletionLock()) return;
    document.querySelector('.app-shell').hidden = false;
    document.querySelector('.mobile-nav').hidden = false;
    openMediaFromHash();
}

async function continueWithUser(client, user, details) {
    const profile = await ensureSupabaseProfile(client, user, details);
    if (profile) {
        await enterAccount(user, profile);
    } else {
        pendingProfileUser = user;
        welcomeScreen.hidden = false;
        showWelcomeForm('profile', 'Choose an available username to finish creating your profile.');
        const form = welcomeForms.find(item => item.dataset.entryForm === 'profile');
        if (form) form.elements.displayName.value = details?.display_name || user.user_metadata?.display_name || '';
    }
}

async function finishLogin(remember) {
    if (!pendingLogin || authBusy) return;
    authBusy = true;
    const buttons = welcomeSessionChoice.querySelectorAll('button');
    buttons.forEach(button => { button.disabled = true; });
    try {
        setSupabaseSessionPersistence(remember);
        await continueWithUser(pendingLogin.client, pendingLogin.user);
        pendingLogin = undefined;
    } catch {
        showWelcomeForm('remember', 'Could not continue. Try again or choose No to use this session only.');
    } finally {
        authBusy = false;
        buttons.forEach(button => { button.disabled = false; });
    }
}

document.addEventListener('click', event => {
    const toggle = event.target.closest('[data-toggle-password]');
    if (toggle) {
        const input = document.getElementById(toggle.dataset.togglePassword);
        const showing = input.type === 'password';
        input.type = showing ? 'text' : 'password';
        toggle.textContent = showing ? 'Hide' : 'Show';
        toggle.setAttribute('aria-label', `${showing ? 'Hide' : 'Show'} password`);
        toggle.setAttribute('aria-pressed', String(showing));
        return;
    }
    const action = event.target.closest('[data-welcome-action]')?.dataset.welcomeAction;
    if (!action || authBusy) return;
    if (action === 'signup' || action === 'login') showWelcomeForm(action);
    else if (action === 'back') showWelcomeForm();
    else if (action === 'remember-yes' || action === 'remember-no') void finishLogin(action === 'remember-yes');
    else if (action === 'signout') void signOutAccount().catch(() => showWelcomeForm('profile', 'Could not log out. Try again.'));
});

document.addEventListener('submit', async event => {
    const form = event.target.closest('[data-entry-form]');
    if (!form) return;
    event.preventDefault();
    if (authBusy) return;
    pauseSignupValidation(form);
    const mode = form.dataset.entryForm;
    const errorElement = form.querySelector('.welcome-form-error');
    const submit = form.querySelector('button[type="submit"]');
    errorElement.hidden = true;
    const emailError = form.querySelector('[data-email-error]');
    if (emailError) { emailError.hidden = true; emailError.textContent = ''; }
    form.elements.email?.removeAttribute?.('aria-invalid');
    authBusy = true;
    submit.disabled = true;
    try {
        const details = mode !== 'login' ? profileDetails(form) : undefined;
        if (mode === 'profile') {
            if (!pendingProfileUser) throw new Error('Log in again to finish setting up your profile.');
            await continueWithUser(await getSupabaseClient(), pendingProfileUser, details);
            return;
        }
        const identifier = form.elements.email.value.trim().toLowerCase();
        const useUsername = mode === 'login' && !identifier.includes('@');
        if (useUsername && !/^[a-z0-9._]{3,30}$/.test(identifier)) {
            throw Object.assign(new Error('Enter your email or username.'), { field: 'email' });
        }
        const email = useUsername ? null : readAuthEmail(form.elements.email);
        const password = form.elements.password.value;
        if (!password) throw new Error('Enter your password.');
        if (mode === 'signup') {
            if (password.length < 8 || /\s/.test(password)) throw new Error('Use at least 8 characters without spaces in your password.');
            if (password !== form.elements.confirmPassword.value) throw new Error('The passwords do not match.');
            const ageBand = form.elements.ageBand.value;
            if (!['minor', 'adult'].includes(ageBand)) throw new Error('Choose your age band.');
            const client = await getSupabaseClient();
            const { data, error } = await client.auth.signUp({
                email, password,
                options: {
                    data: { ...details, age_band: ageBand },
                    emailRedirectTo: 'https://lifeandtales.github.io/insta-alternative/',
                },
            });
            checkSignupEmailResponse({ data, error });
            if (data.session && data.user) await continueWithUser(client, data.user, details);
            else showWelcomeForm('login', 'Check your email to confirm your account, then log in.');
        } else {
            const client = await getSupabaseClient();
            startTemporarySupabaseSession();
            let result;
            if (useUsername) {
                const login = await client.functions.invoke('username-login', { body: { username: identifier, password } });
                if (login.error) {
                    const denied = login.error.context?.status === 401;
                    throw new Error(denied ? 'Invalid username or password.' : 'Username login is unavailable. Try logging in with your email.');
                }
                result = await client.auth.setSession(login.data);
            } else {
                result = await client.auth.signInWithPassword({ email, password });
            }
            const { data, error } = result;
            if (error) throw error;
            pendingLogin = { client, user: data.user };
            showWelcomeForm('remember');
        }
    } catch (error) {
        const target = error.field === 'email' && emailError ? emailError : errorElement;
        target.textContent = error.message || 'Could not continue. Try again.';
        target.hidden = false;
        target.setAttribute?.('data-state', 'invalid');
        if (error.field === 'email') {
            form.elements.email.setAttribute?.('aria-invalid', 'true');
            form.elements.email.focus?.();
        }
    } finally {
        authBusy = false;
        submit.disabled = false;
    }
});

async function restoreAccount() {
    const client = await getSupabaseClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    if (data.session) {
        const verified = await client.auth.getUser();
        if (verified.error) throw verified.error;
        await continueWithUser(client, verified.data.user);
    } else welcomeScreen.hidden = false;
    client.auth.onAuthStateChange((event) => {
        if (event === 'SIGNED_OUT' && state.signedInAccountId) window.location.reload();
    });
}

if (demoContentEnabled) {
    loadAccountPreferences();
    renderAccountIdentity();
}
registerDeletionLock(() => { setView('home'); openMediaFromHash(); });
syncDeletionLock();
initializeVideoObserver();
// Preserve the original click priority: a handled action stops dispatch.
const clickHandlers = [
    handleVideoExitClick,
    handleFollowClick,
    handleMessageClick,
    handleVideoClick,
    dismissOpenMenus,
    handleStoryMenuClick,
    handleNavigationClick,
    handleProfileSectionClick,
    handleHighlightClick,
    handleProfileMediaClick,
    handleStoryOwnerClick,
    handleMediaSoundClick,
    handleOpenCreateClick,
    handlePlaceholderClick,
    handleCreateUploadClick,
    handleStoryClick,
    handleExploreClick,
    handleAuthorClick,
    handlePostOptionsClick,
    handleLikeClick,
    handleSaveClick,
    handleLikersClick,
    handleCommentClick,
    handleSharingClick
];
document.addEventListener('click', event => {
    for (const handleClick of clickHandlers) {
        if (handleClick(event))
            return;
    }
});
registerHomeControlEvents();
registerMobileNavigationGestures(document.querySelector('.mobile-nav'));
registerNotificationEvents();
registerLiveEvents();
registerAccountSettingsEvents();
registerProfileEditorEvents();
registerVideoPointerEvents();
registerStoryGestureEvents();
registerStoryShortcutEvents();
registerCommentEvents();
registerKeyboardEvents();
registerMessageFormEvents();
registerInAppCallControls();
registerExploreSearchEvents();
registerCommentComposerEvents();
registerHighlightEvents();
registerProfileGridEvents();
registerStoryUploadEvents();
registerStoryToolEvents();
registerStoryExportEvents();
registerStoryOptionEvents();
registerMediaUploadEvents();
registerMediaLikeEvents();
if (document.documentElement.classList.contains("mobile-splash-pending")) {
    window.setTimeout(() => {
        document.documentElement.classList.remove("mobile-splash-pending");
    }, 1000);
}
const refreshShell = document.querySelector('.app-shell');
registerHomePullToRefresh(refreshShell, document.getElementById('home-refresh-status'), async view => {
    try {
        if (view === 'home') {
            await loadSession();
            processScheduledPosts();
            syncIncomingPostMentions();
        }
        if (state.signedInAccountId) await refreshConnectedView(view);
        if (state.currentView === view && (view === 'home' || !state.signedInAccountId)) setView(view, { refresh: false });
    } catch {
        showShareFeedback('Could not refresh this screen. Try again.');
    }
}, target => {
    if (target?.closest?.('input, textarea, select, dialog')) return null;
    switch (state.currentView) {
        case 'reels': return document.getElementById('reels-feed');
        case 'messages':
            if (state.activeGroupProfileHandle) return null;
            return state.activeConversationHandle
                ? target?.closest?.('.chat-history') || null
                : document.querySelector('.conversation-list') || refreshShell;
        case 'home':
        case 'explore':
        case 'profile': return refreshShell;
        default: return null;
    }
}, target => {
    if (state.currentView === 'reels' || (state.currentView === 'messages' && state.activeConversationHandle)) return target;
    return refreshShell.querySelector('.main-area') || target;
});
document.addEventListener('visibilitychange', () => {
    if (state.signedInAccountId && !document.hidden) void refreshSavedState().catch(() => {});
});
if (typeof window.setInterval === 'function') {
    window.setInterval(() => {
        if (state.signedInAccountId && state.currentView === 'messages' && !document.hidden) {
            void refreshConnectedView('messages').catch(() => {});
        }
    }, 8000);
}
setView("home");
if (demoContentEnabled) {
    if (document.documentElement.classList.contains('auth-restoring')) welcomeScreen.hidden = false;
    document.documentElement.classList.remove('auth-restoring');
    void loadAccountContent().then(() => openMediaFromHash());
} else {
    void restoreAccount().catch(() => {
        welcomeScreen.hidden = false;
        showWelcomeForm('login', 'Sign in to connect to your account.');
    }).finally(() => document.documentElement.classList.remove('auth-restoring', 'mobile-splash-pending'));
}
window.addEventListener?.('hashchange', () => openMediaFromHash());
let localSaveTimer;
for (const eventName of ['click', 'submit', 'change']) document.addEventListener(eventName, event => {
    // Welcome actions do not mutate local content or trigger a session write.
    if ((!state.signedInAccountId && !demoContentEnabled) || event.target.closest('#welcome-screen')) return;
    if (event.target.closest('.notifications-backdrop, .home-notifications')) return;
    clearTimeout(localSaveTimer);
    localSaveTimer = window.setTimeout(() => persistSession().catch(() => showShareFeedback('Your latest changes could not be saved on this device.')), 300);
});

registerSignupValidation(welcomeScreen);
