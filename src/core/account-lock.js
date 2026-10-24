import { state } from './state.js';
import { persistPreferences } from '../storage/preferences.js';

const gracePeriod = 15 * 86400000;
let locked = false;

export function syncDeletionLock() {
    const screen = document.getElementById('deletion-lock');
    if (!screen) return Boolean(state.deletionRequestedAt);
    if (!state.deletionRequestedAt) {
        screen.hidden = true;
        if (locked) {
            document.querySelectorAll('[data-deletion-isolated]').forEach(element => {
                element.inert = false;
                element.removeAttribute('data-deletion-isolated');
            });
            document.querySelector('.app-shell').hidden = false;
            document.querySelector('.mobile-nav').hidden = false;
        }
        locked = false;
        return false;
    }
    document.querySelectorAll('video, audio').forEach(media => media.pause());
    clearTimeout(state.storyAdvanceTimer);
    if (!locked) document.dispatchEvent(new Event('account-deletion-lock'));
    for (const name of [...document.body.classList]) {
        if (name.endsWith('-open')) document.body.classList.remove(name);
    }
    if (state.pendingVideoTap) { clearTimeout(state.pendingVideoTap.timer); state.pendingVideoTap = null; }
    document.querySelectorAll('body > *').forEach(element => {
        if (element === screen || ['SCRIPT', 'STYLE'].includes(element.tagName)) return;
        if (!element.inert) { element.inert = true; element.setAttribute('data-deletion-isolated', ''); }
    });
    document.querySelector('.app-shell').hidden = true;
    document.querySelector('.mobile-nav').hidden = true;
    document.getElementById('welcome-screen').hidden = true;
    document.querySelectorAll('[class*="backdrop"], .profile-post-viewer, .share-feedback').forEach(element => { element.hidden = true; });
    const expired = Date.now() - state.deletionRequestedAt >= gracePeriod;
    screen.querySelector('form').hidden = expired;
    screen.querySelector('[data-deletion-status]').textContent = expired
        ? 'The 15-day grace period has ended. This demo remains locked; a real account service is needed to process deletion.'
        : 'Your account is locked during the 15-day grace period. Opening the app does not cancel deletion. Content, messages and notifications are unavailable until you cancel.';
    screen.hidden = false;
    if (!locked) screen.querySelector('h1').focus();
    locked = true;
    return true;
}

export function registerDeletionLock(onCancel) {
    // Capture events before existing feature handlers, including stale open dialogs.
    for (const name of ['click', 'submit', 'keydown', 'change', 'input']) {
        document.addEventListener(name, event => {
            if (!state.deletionRequestedAt || event.target.closest?.('#deletion-lock')) return;
            event.preventDefault();
            event.stopImmediatePropagation();
        }, true);
    }
    document.getElementById('deletion-cancel-form').addEventListener('submit', event => {
        event.preventDefault();
        const form = event.currentTarget;
        const password = form.elements.password.value;
        form.reset();
        const error = form.querySelector('[role="alert"]');
        if (!state.deletionRequestedAt || Date.now() - state.deletionRequestedAt >= gracePeriod) {
            syncDeletionLock();
            return;
        }
        if (password !== 'demo-password') {
            error.textContent = 'Enter the demo password shown above. Do not use a real password.';
            return;
        }
        const requestedAt = state.deletionRequestedAt;
        state.deletionRequestedAt = null;
        if (!persistPreferences()) {
            state.deletionRequestedAt = requestedAt;
            error.textContent = 'Cancellation could not be saved. Please try again.';
            return;
        }
        error.textContent = '';
        syncDeletionLock();
        onCancel();
    });
    window.addEventListener?.('focus', syncDeletionLock);
    window.setInterval?.(() => { if (state.deletionRequestedAt) syncDeletionLock(); }, 60000);
}
