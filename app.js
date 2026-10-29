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
import { handleMessageClick, registerMessageFormEvents } from './src/features/messages.events.js';
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
import { opensDirectlyToHome } from './src/core/local-preview.js';
import { registerStoryToolEvents } from './src/features/story-tools.js';
import { registerStoryOptionEvents } from './src/features/story-options.js';

// Local welcome forms are transient only; this prototype has no credential service.
const welcomeScreen = document.getElementById('welcome-screen');
const welcomeMessage = document.getElementById('welcome-message');
const welcomeEntry = document.getElementById('welcome-entry');
const welcomeForms = [...document.querySelectorAll('[data-entry-form]')];
function clearWelcomeForms() {
    welcomeForms.forEach(form => {
        form.reset();
        const fileInput = form.querySelector('input[type="file"]');
        if (fileInput) fileInput.value = '';
        const fileSelection = form.querySelector('.welcome-file-selection');
        if (fileSelection) fileSelection.hidden = true;
        const fileDetails = form.querySelector('.welcome-file-selection span');
        if (fileDetails) fileDetails.textContent = '';
        form.querySelectorAll('input[type="password"]').forEach(input => { input.type = 'password'; });
        form.querySelectorAll('.welcome-password-toggle').forEach(button => {
            button.textContent = 'Show';
            button.setAttribute('aria-label', 'Show password');
            button.setAttribute('aria-pressed', 'false');
        });
        const error = form.querySelector('.welcome-form-error');
        error.textContent = '';
        error.hidden = true;
    });
}
function enterLocalDemo(ageBand = '', announce = true) {
    if (syncDeletionLock()) return;
    if (ageBand) {
        // Keep only the non-secret age-band choice so existing local access filters apply.
        state.viewerAgeBand = ageBand;
        persistPreferences();
    }
    clearWelcomeForms();
    welcomeScreen.hidden = true;
    document.querySelector('.app-shell').hidden = false;
    document.querySelector('.mobile-nav').hidden = false;
    setView(state.currentView);
    openMediaFromHash();
    if (announce) showShareFeedback('Local preview opened. No account was created or verified; your entries were cleared without being saved.');
}
document.addEventListener('click', event => {
    if (event.target.closest('[data-remove-verification-file]')) {
        const form = event.target.closest('form');
        const fileInput = form.querySelector('input[type="file"]');
        fileInput.value = '';
        form.querySelector('.welcome-file-selection').hidden = true;
        form.querySelector('.welcome-file-selection span').textContent = '';
        return;
    }
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
    if (!action) return;
    if (action === 'signup' || action === 'login') {
        const signup = action === 'signup';
        clearWelcomeForms();
        welcomeForms.forEach(form => { form.hidden = form.dataset.entryForm !== action; });
        document.getElementById('welcome-entry-eyebrow').textContent = signup ? 'Create account' : 'Welcome back';
        document.getElementById('welcome-entry-title').textContent = signup ? 'Join the conversation.' : 'Good to see you again.';
        document.getElementById('welcome-entry-description').textContent = signup
            ? 'Choose a username and password to continue into the local demo.'
            : 'Enter your details to continue into the local demo.';
        welcomeMessage.hidden = true;
        welcomeEntry.hidden = false;
        (signup ? document.getElementById('signup-username') : document.getElementById('login-username')).focus();
    } else if (action === 'back') {
        clearWelcomeForms();
        welcomeForms.forEach(form => { form.hidden = true; });
        welcomeEntry.hidden = true;
        welcomeMessage.hidden = false;
        document.getElementById('welcome-title').focus?.();
    }
});
document.addEventListener('beforeinput', event => {
    const input = event.target;
    if (!input.matches('.welcome-password-wrap input') || !input.closest('[data-entry-form]')) return;
    if (/\s/.test(event.data || '')) event.preventDefault();
});
document.addEventListener('paste', event => {
    const input = event.target;
    if (!input.matches('.welcome-password-wrap input') || !input.closest('[data-entry-form]')) return;
    if (/\s/.test(event.clipboardData?.getData('text') || '')) event.preventDefault();
});
document.addEventListener('change', event => {
    if (event.target.id !== 'signup-verification-file') return;
    const input = event.target;
    const form = input.closest('form');
    const errorElement = form.querySelector('.welcome-form-error');
    const file = input.files?.[0];
    const selection = form.querySelector('.welcome-file-selection');
    const details = form.querySelector('.welcome-file-selection span');
    if (!file) { selection.hidden = true; details.textContent = ''; return; }
    const isImageOrPdf = file.type.startsWith('image/') || file.type === 'application/pdf' || /\.(png|jpe?g|gif|webp|heic|heif|pdf)$/i.test(file.name);
    if (!isImageOrPdf || file.size > 20 * 1024 * 1024) {
        input.value = '';
        selection.hidden = true;
        details.textContent = '';
        errorElement.textContent = 'Choose an image or PDF no larger than 20 MB.';
        errorElement.hidden = false;
        input.focus();
        return;
    }
    errorElement.textContent = '';
    errorElement.hidden = true;
    const filename = (file.name.split(/[\\/]/).pop() || 'Selected file').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').slice(0, 100);
    details.textContent = `${filename || 'Selected file'} · ${(file.size / (1024 * 1024)).toFixed(1)} MB`;
    selection.hidden = false;
});
document.addEventListener('submit', event => {
    const form = event.target.closest('[data-entry-form]');
    if (!form) return;
    event.preventDefault();
    const signup = form.dataset.entryForm === 'signup';
    const ageBand = signup ? form.elements.ageBand.value : '';
    const fullName = signup ? form.querySelector('#signup-full-name').value.trim() : '';
    const verificationFile = signup ? form.querySelector('#signup-verification-file').files?.[0] : null;
    const username = form.elements.username.value;
    const password = form.elements.password.value;
    const confirmation = signup ? form.elements.confirmPassword.value : '';
    let error = '';
    let focusTarget = null;
    if (signup && !['minor', 'adult'].includes(ageBand)) {
        error = 'Choose Under 18 or 18 or older to continue.';
        focusTarget = form.querySelector('input[name="ageBand"]');
    } else if (signup && !fullName) {
        error = 'Enter your full name.';
        focusTarget = form.querySelector('#signup-full-name');
    } else if (!username) { error = 'Enter a username.'; focusTarget = form.elements.username; }
    else if (!/^[a-zA-Z0-9._]{8,20}$/.test(username)) {
        error = 'Use 8–20 characters: letters, numbers, dots or underscores. No spaces or required character mix.';
        focusTarget = form.elements.username;
    } else if (signup && verificationFile && (verificationFile.size > 20 * 1024 * 1024 || !(verificationFile.type.startsWith('image/') || verificationFile.type === 'application/pdf' || /\.(png|jpe?g|gif|webp|heic|heif|pdf)$/i.test(verificationFile.name)))) {
        error = 'Choose an image or PDF no larger than 20 MB.';
        focusTarget = form.querySelector('#signup-verification-file');
    } else if (!password) { error = 'Enter a password to continue.'; focusTarget = form.elements.password; }
    else if (/\s/.test(password) || (signup && /\s/.test(confirmation))) {
        error = 'Passwords cannot contain spaces.';
        focusTarget = /\s/.test(password) ? form.elements.password : form.elements.confirmPassword;
    }
    else if ([...password].length < 8) {
        error = 'Use at least 8 characters in your password.';
        focusTarget = form.elements.password;
    }
    else if (signup && !confirmation) { error = 'Confirm your password.'; focusTarget = form.elements.confirmPassword; }
    else if (signup && password !== confirmation) { error = 'The passwords do not match.'; focusTarget = form.elements.confirmPassword; }
    const errorElement = form.querySelector('.welcome-form-error');
    if (error) {
        clearWelcomeForms();
        errorElement.textContent = error;
        errorElement.hidden = false;
        focusTarget.focus();
        return;
    }
    enterLocalDemo(ageBand);
});

loadPreferences();
registerDeletionLock(() => { setView('home'); openMediaFromHash(); });
syncDeletionLock();
state.savedItems = loadSavedItems();
state.joinedCommunityIds = loadJoinedCommunities();
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
if (opensDirectlyToHome(window.location.href)) enterLocalDemo('', false);
loadSession().then(() => { processScheduledPosts(); syncIncomingStoryMentions(); syncIncomingPostMentions(); setView(state.currentView); openMediaFromHash(); updateNotificationBadge(); }).catch(() => {
    showShareFeedback('Local content storage is unavailable. New work may not survive closing this page.');
});
window.addEventListener?.('hashchange', () => openMediaFromHash());
let localSaveTimer;
for (const eventName of ['click', 'submit', 'change']) document.addEventListener(eventName, event => {
    // Welcome actions do not mutate local content or trigger a session write.
    if (event.target.closest('#welcome-screen')) return;
    if (event.target.closest('.notifications-backdrop, .home-notifications')) return;
    clearTimeout(localSaveTimer);
    localSaveTimer = window.setTimeout(() => persistSession().catch(() => showShareFeedback('Your latest changes could not be saved on this device.')), 300);
});
if (state.savedStorageWarning)
    showShareFeedback("The saved collection couldn't be loaded from browser storage.");
loadStoryHighlights().catch((error) => {
    console.error("Could not load saved story highlights", error);
    showShareFeedback("Saved story highlights couldn't be loaded from browser storage.");
});
