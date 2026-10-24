import { state } from '../core/state.js';
import { currentUser } from '../data/sample-data.js';
import { escapeHtml } from '../core/utils.js';
import { getAccount, mayInteract } from '../core/social.js';
import { persistPreferences } from '../storage/preferences.js';
import { persistSession } from '../storage/local-session.js';
import { setView } from '../core/navigation.js';
import { resumeStory } from './stories.js';
import { showShareFeedback } from '../components/feedback.js';

export function showHomePanel(title, markup) {
    document.getElementById('home-panel-title').textContent = title;
    document.querySelector('.home-panel-content').innerHTML = markup;
    document.querySelector('.home-controls-backdrop').hidden = false;
    document.querySelector('.home-panel-close').focus();
}
export function openHomeSettings() {
    const owner = getAccount(currentUser.handle);
    const eligible = new Set([...state.followedAccountHandles, ...(owner?.followers || [])]);
    showHomePanel('Story and feed settings', `
      <p>Close Friends can include people you follow and people who follow you.</p>
      <fieldset><legend>Close Friends</legend>${[...eligible].filter(handle => handle !== currentUser.handle).map(handle => `<label><input type="checkbox" data-close-friend="${escapeHtml(handle)}" ${state.closeFriendHandles.has(handle) ? 'checked' : ''} /> ${escapeHtml(getAccount(handle)?.name || handle)} <small>${escapeHtml(handle)}</small></label>`).join('') || '<p>Follow people or gain followers to build your list.</p>'}</fieldset>
      <h3>Muted posts</h3>${renderMuted(state.mutedPostHandles, 'posts')}
      <h3>Muted stories</h3>${renderMuted(state.mutedStoryHandles, 'stories')}
      <button type="button" data-restore-hidden>Restore hidden posts (${state.hiddenPostKeys.size})</button>
      <p>These preferences are saved on this device.</p>`);
}
function renderMuted(handles, type) {
    return [...handles].map(handle => `<p>${escapeHtml(handle)} <button type="button" data-unmute="${type}" data-handle="${escapeHtml(handle)}">Unmute</button></p>`).join('') || '<p>None</p>';
}
export function openReportPanel(post, type) {
    state.reportingMedia = { type, id: post.id };
    showHomePanel('Report post', `<p>Choose a reason. In this local prototype, reports are saved on this device; they are not sent to a moderation service.</p><form class="local-report-form"><label>Reason<select name="reason" required><option value="">Choose a reason</option><option>Spam</option><option>Harassment</option><option>Unsafe content</option><option>Impersonation</option><option>Other</option></select></label><label>Details (optional)<textarea name="details" maxlength="500"></textarea></label><button type="submit">Save local report</button></form>`);
}
export function registerHomeControlEvents() {
    document.querySelector('.home-panel-close').addEventListener('click', closeHomePanel);
    document.querySelector('.home-controls-backdrop').addEventListener('click', event => {
        if (event.target === event.currentTarget) closeHomePanel();
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape') closeHomePanel(); });
    document.addEventListener('change', event => {
        const handle = event.target.dataset.closeFriend;
        if (!handle || !mayInteract()) return;
        if (event.target.checked) state.closeFriendHandles.add(handle); else state.closeFriendHandles.delete(handle);
        const owner = getAccount(currentUser.handle);
        if (owner) owner.closeFriendHandles = [...state.closeFriendHandles];
        persistPreferences();
    });
    document.addEventListener('click', event => {
        const button = event.target.closest('[data-unmute]');
        if (!mayInteract()) return;
        if (button) {
            (button.dataset.unmute === 'posts' ? state.mutedPostHandles : state.mutedStoryHandles).delete(button.dataset.handle);
            persistPreferences(); openHomeSettings(); setView(state.currentView);
        }
        if (event.target.closest('[data-restore-hidden]')) { state.hiddenPostKeys.clear(); persistPreferences(); openHomeSettings(); setView(state.currentView); }
    });
    document.addEventListener('submit', event => {
        if (!event.target.matches('.local-report-form')) return;
        event.preventDefault();
        if (!mayInteract()) return;
        const reason = event.target.elements.reason.value;
        if (!reason) return;
        state.localReports = state.localReports || [];
        state.localReports.push({ ...state.reportingMedia, reason, details: event.target.elements.details.value.trim(), createdAt: Date.now() });
        persistSession().then(() => {
            document.querySelector('.home-controls-backdrop').hidden = true;
            showShareFeedback('Local report saved.');
        }).catch(() => showShareFeedback('The report could not be saved.'));
    });
}

function closeHomePanel() { document.querySelector('.home-controls-backdrop').hidden = true; if (!document.querySelector('.story-viewer-backdrop').hidden) resumeStory(); }
