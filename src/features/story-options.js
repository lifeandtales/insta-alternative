import { mayInteract } from '../core/social.js';
import { toDateTimeLocalValue } from '../core/utils.js';

let activeOption = null;
let previousSchedule = '';
let trigger = null;
let exitOpen = false;
let draftSaving = false;

export function openStoryExitDialog() {
    document.querySelectorAll('.story-selected-preview video, .story-selected-preview audio').forEach(media => media.pause());
    document.querySelector('.story-create-dialog').inert = true;
    document.querySelector('.story-exit-backdrop').hidden = false;
    document.querySelector('.story-exit-error').hidden = true;
    exitOpen = true;
    document.querySelector('.story-exit-backdrop .story-save-draft').focus();
}

export function closeStoryExitDialog() {
    if (draftSaving) return false;
    document.querySelector('.story-exit-backdrop').hidden = true;
    document.querySelector('.story-create-dialog').inert = false;
    if (exitOpen) document.querySelector('.story-create-close').focus();
    exitOpen = false;
    return true;
}

export function setStoryDraftSaving(saving, error = '') {
    draftSaving = saving;
    document.querySelectorAll('.story-save-draft, .story-exit-backdrop button').forEach(button => { button.disabled = saving; });
    const notice = document.querySelector('.story-exit-error');
    notice.textContent = error;
    notice.hidden = !error;
}

export function syncStoryOptionButtons() {
    const scheduled = document.getElementById('story-schedule-time').value;
    const date = scheduled ? new Date(scheduled) : null;
    const summary = date && Number.isFinite(date.getTime())
        ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : 'Share now';
    document.querySelector('.story-schedule-summary').textContent = summary;
    document.querySelector('.story-schedule-open').setAttribute('aria-label', `Schedule story: ${summary}`);
    const audience = document.getElementById('story-audience').value === 'close-friends' ? 'Priority Friends' : 'Normal audience';
    document.querySelector('.story-audience-summary').textContent = audience;
    document.querySelector('.story-audience-open').setAttribute('aria-label', `Story audience: ${audience}`);
}

export function openStoryOption(option, button) {
    if (!mayInteract() || !['schedule', 'audience'].includes(option)) return;
    activeOption = option;
    trigger = button;
    previousSchedule = document.getElementById('story-schedule-time').value;
    document.getElementById('story-option-title').textContent = option === 'schedule' ? 'Schedule story' : 'Story audience';
    document.querySelector('.story-schedule-panel').hidden = option !== 'schedule';
    document.querySelector('.story-audience-panel').hidden = option !== 'audience';
    document.querySelector('.story-option-error').hidden = true;
    const audience = document.getElementById('story-audience').value;
    document.querySelectorAll('[name="story-audience-choice"]').forEach(input => { input.checked = input.value === audience; });
    document.getElementById('story-schedule-time').min = toDateTimeLocalValue(new Date(Date.now() + 60000));
    document.querySelector('.story-schedule-timezone').textContent = `Times use your device’s local time zone (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`;
    document.querySelectorAll('.story-selected-preview video, .story-selected-preview audio').forEach(media => media.pause());
    document.querySelector('.story-create-dialog').inert = true;
    document.querySelector('.story-option-backdrop').hidden = false;
    button?.setAttribute('aria-expanded', 'true');
    document.querySelector('.story-option-close').focus();
}

export function closeStoryOption(save = false) {
    if (!activeOption) return false;
    const schedule = document.getElementById('story-schedule-time');
    if (save) {
        if (!mayInteract()) return false;
        if (activeOption === 'schedule' && schedule.value && (!Number.isFinite(new Date(schedule.value).getTime()) || new Date(schedule.value).getTime() <= Date.now())) {
            const error = document.querySelector('.story-option-error');
            error.textContent = 'Choose a future date and time, or share without scheduling.';
            error.hidden = false;
            schedule.focus();
            return false;
        }
        if (activeOption === 'audience') {
            const selected = document.querySelector('[name="story-audience-choice"]:checked');
            if (!selected || !['all', 'close-friends'].includes(selected.value)) return false;
            document.getElementById('story-audience').value = selected.value;
        }
    } else {
        schedule.value = previousSchedule;
    }
    document.querySelector('.story-option-backdrop').hidden = true;
    document.querySelector('.story-create-dialog').inert = false;
    trigger?.setAttribute('aria-expanded', 'false');
    if (trigger?.isConnected) trigger.focus();
    activeOption = null;
    trigger = null;
    syncStoryOptionButtons();
    return true;
}

export function registerStoryOptionEvents() {
    document.addEventListener('click', event => {
        if (event.target.closest('.story-exit-keep') || event.target === document.querySelector('.story-exit-backdrop')) closeStoryExitDialog();
        const schedule = event.target.closest('.story-schedule-open');
        const audience = event.target.closest('.story-audience-open');
        if (schedule || audience) openStoryOption(schedule ? 'schedule' : 'audience', schedule || audience);
        if (event.target.closest('.story-option-close, .story-option-cancel') || event.target === document.querySelector('.story-option-backdrop')) closeStoryOption();
        if (event.target.closest('.story-option-save')) closeStoryOption(true);
        if (event.target.closest('.story-schedule-clear') && activeOption === 'schedule') {
            document.getElementById('story-schedule-time').value = '';
            closeStoryOption(true);
        }
    });
    document.addEventListener('keydown', event => {
        if (!activeOption && !exitOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault(); event.stopImmediatePropagation();
            if (exitOpen) closeStoryExitDialog(); else closeStoryOption();
        } else if (event.key === 'Tab') {
            const panel = document.querySelector(exitOpen ? '.story-exit-backdrop .story-option-dialog' : '.story-option-backdrop .story-option-dialog');
            const controls = [...panel.querySelectorAll('button, input')].filter(control => !control.disabled && control.getClientRects().length);
            const first = controls[0], last = controls.at(-1);
            if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
                event.preventDefault(); last?.focus();
            } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
                event.preventDefault(); first?.focus();
            }
        }
    }, true);
    document.addEventListener('account-deletion-lock', () => { closeStoryOption(); closeStoryExitDialog(); });
}
