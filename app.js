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
import { setView } from './src/core/navigation.js';
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
import { handleNavigationClick, handlePlaceholderClick } from './src/core/navigation.events.js';
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
import { handleSaveClick } from './src/features/saved.events.js';
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
import { getSupabaseClient } from './src/storage/supabase.js';
import { ensureSupabaseProfile, profileDetails, signOutAccount } from './src/features/account-auth.js';
import { registerStoryToolEvents } from './src/features/story-tools.js';
import { registerStoryOptionEvents } from './src/features/story-options.js';

const welcomeScreen = document.getElementById('welcome-screen');
const welcomeMessage = document.getElementById('welcome-message');
const welcomeEntry = document.getElementById('welcome-entry');
const welcomeForms = [...document.querySelectorAll('[data-entry-form]')];
const welcomeStatus = document.getElementById('welcome-auth-status');
let pendingProfileUser;
let authBusy = false;

function showWelcomeForm(mode, status = '') {
    welcomeMessage.hidden = Boolean(mode);
    welcomeEntry.hidden = !mode;
    welcomeStatus.textContent = status;
    welcomeStatus.hidden = !status;
    for (const form of welcomeForms) {
        form.reset();
        form.hidden = form.dataset.entryForm !== mode;
        form.querySelector('.welcome-form-error').hidden = true;
        for (const input of form.querySelectorAll('.welcome-password-wrap input')) input.type = 'password';
        for (const button of form.querySelectorAll('[data-toggle-password]')) {
            button.textContent = 'Show';
            button.setAttribute('aria-label', 'Show password');
            button.setAttribute('aria-pressed', 'false');
        }
    }
    const titles = { signup: 'Create account', login: 'Log in', profile: 'Complete your profile' };
    document.getElementById('welcome-entry-title').textContent = titles[mode] || '';
    document.getElementById('welcome-entry-eyebrow').textContent = '';
    document.getElementById('welcome-entry-description').textContent = '';
    welcomeForms.find(form => form.dataset.entryForm === mode)?.querySelector('input')?.focus();
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
    refreshChatAttachmentExpiry();
    processScheduledPosts();
    syncIncomingStoryMentions();
    syncIncomingPostMentions();
    setView(state.currentView);
    openMediaFromHash();
    updateNotificationBadge();
}

async function enterAccount(user, profile) {
    state.signedInAccountId = user.id;
    const identity = { handle: '@' + profile.username, name: profile.display_name, bio: profile.bio || '' };
    Object.assign(currentUser, identity);
    loadAccountPreferences();
    Object.assign(currentUser, identity);
    state.profileHandle = currentUser.handle;
    const account = state.accountDirectory.find(item => item.id === user.id || item.id === 'local-owner');
    if (account) Object.assign(account, { id: user.id, ...identity, avatar: currentUser.avatar });
    state.viewerAgeBand = user.user_metadata?.age_band === 'adult' ? 'adult' : 'minor';
    renderAccountIdentity();
    await loadAccountContent();
    for (const form of welcomeForms) form.reset();
    pendingProfileUser = null;
    welcomeScreen.hidden = true;
    if (syncDeletionLock()) return;
    document.querySelector('.app-shell').hidden = false;
    document.querySelector('.mobile-nav').hidden = false;
}

async function continueWithUser(client, user, details) {
    const profile = await ensureSupabaseProfile(client, user, details);
    if (profile) {
        await enterAccount(user, profile);
    } else {
        pendingProfileUser = user;
        showWelcomeForm('profile', 'Choose an available username to finish creating your profile.');
        const form = welcomeForms.find(item => item.dataset.entryForm === 'profile');
        if (form) form.elements.displayName.value = details?.display_name || user.user_metadata?.display_name || '';
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
    else if (action === 'signout') void signOutAccount().catch(() => showWelcomeForm('profile', 'Could not log out. Try again.'));
});

document.addEventListener('submit', async event => {
    const form = event.target.closest('[data-entry-form]');
    if (!form) return;
    event.preventDefault();
    if (authBusy) return;
    const mode = form.dataset.entryForm;
    const errorElement = form.querySelector('.welcome-form-error');
    const submit = form.querySelector('button[type="submit"]');
    errorElement.hidden = true;
    authBusy = true;
    submit.disabled = true;
    try {
        const details = mode !== 'login' ? profileDetails(form) : undefined;
        if (mode === 'profile') {
            if (!pendingProfileUser) throw new Error('Log in again to finish setting up your profile.');
            await continueWithUser(await getSupabaseClient(), pendingProfileUser, details);
            return;
        }
        const email = form.elements.email.value.trim();
        const password = form.elements.password.value;
        if (!email || !form.elements.email.validity.valid) throw new Error('Enter a valid email address.');
        if (!password) throw new Error('Enter your password.');
        if (mode === 'signup') {
            if (password.length < 8) throw new Error('Use at least 8 characters in your password.');
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
            if (error) throw error;
            if (data.session && data.user) await continueWithUser(client, data.user, details);
            else showWelcomeForm('login', 'Check your email to confirm your account, then log in.');
        } else {
            const client = await getSupabaseClient();
            const { data, error } = await client.auth.signInWithPassword({ email, password });
            if (error) throw error;
            await continueWithUser(client, data.user);
        }
    } catch (error) {
        errorElement.textContent = error.message || 'Could not continue. Try again.';
        errorElement.hidden = false;
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
    }
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
registerNotificationEvents();
registerAccountSettingsEvents();
registerProfileEditorEvents();
registerVideoPointerEvents();
registerStoryGestureEvents();
registerStoryShortcutEvents();
registerCommentEvents();
registerKeyboardEvents();
registerMessageFormEvents();
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
setView("home");
if (demoContentEnabled) void loadAccountContent();
else void restoreAccount().catch(() => showWelcomeForm('login', 'Sign in to connect to your account.'));
window.addEventListener?.('hashchange', () => openMediaFromHash());
let localSaveTimer;
for (const eventName of ['click', 'submit', 'change']) document.addEventListener(eventName, event => {
    // Welcome actions do not mutate local content or trigger a session write.
    if ((!state.signedInAccountId && !demoContentEnabled) || event.target.closest('#welcome-screen')) return;
    if (event.target.closest('.notifications-backdrop, .home-notifications')) return;
    clearTimeout(localSaveTimer);
    localSaveTimer = window.setTimeout(() => persistSession().catch(() => showShareFeedback('Your latest changes could not be saved on this device.')), 300);
});
