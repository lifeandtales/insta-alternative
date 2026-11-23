import { REPORT_REASONS, reportTarget, reportKindLabel } from '../core/reporting.js';
import { submitContentReport } from '../storage/cloud-reports.js';
import { loadCloudStoryAudience, setCloudStoryFriend } from '../storage/cloud-stories.js';
import { getSupabaseClient } from '../storage/supabase.js';
import { state } from '../core/state.js';
import { currentUser } from '../data/sample-data.js';
import { escapeHtml } from '../core/utils.js';
import { getAccount, mayInteract } from '../core/social.js';
import { persistPreferences } from '../storage/preferences.js';
import { persistSession } from '../storage/local-session.js';
import { setView } from '../core/navigation.js';
import { resumeStory } from './stories.js';
import { showShareFeedback } from '../components/feedback.js';

export function showHomePanel(title, markup, { minimal = false, anchor = null } = {}) {
    const panel = document.querySelector('.home-panel');
    Object.assign(panel.style, { position: '', left: '', top: '' });
    panel.classList.toggle('story-repost-visit-prompt', minimal);
    if (minimal) panel.setAttribute('aria-label', title || 'Visit original story');
    else panel.removeAttribute('aria-label');
    document.getElementById('home-panel-title').textContent = title;
    document.querySelector('.home-panel-content').innerHTML = markup;
    document.querySelector('.home-controls-backdrop').hidden = false;
    if (minimal && anchor?.getBoundingClientRect) {
        const rect = anchor.getBoundingClientRect();
        const width = panel.offsetWidth, height = panel.offsetHeight;
        const left = Math.max(8, Math.min(window.innerWidth - width - 8, rect.left + rect.width / 2 - width / 2));
        const top = rect.bottom + height + 16 <= window.innerHeight ? rect.bottom + 8 : Math.max(8, rect.top - height - 8);
        Object.assign(panel.style, { position: 'fixed', left: `${left}px`, top: `${top}px` });
    }
    (minimal ? panel.querySelector('.home-panel-content button') : panel.querySelector('.home-panel-close')).focus();
}
export function openHomeSettings() {
    const owner = state.signedInAccountId;
    const localAccount = getAccount(currentUser.handle);
    const eligible = new Set([...state.followedAccountHandles, ...(localAccount?.followers || [])]);
    const localChoices = [...eligible].filter(handle => handle !== currentUser.handle).map(handle => ({
        handle, name: getAccount(handle)?.name || handle, selected: state.closeFriendHandles.has(handle),
    }));
    const choices = people => people.map(person => `<label><input type="checkbox" data-close-friend="${escapeHtml(person.handle)}"
        ${person.id ? `data-cloud-close-friend="${escapeHtml(person.id)}"` : ''}
        ${person.selected ? 'checked' : ''} /> ${escapeHtml(person.name)} <small>${escapeHtml(person.handle)}</small></label>`).join('')
        || '<p>Follow people or gain followers to build your list.</p>';
    showHomePanel('Story and feed settings', `
      <p>Close Friends can include people you follow and people who follow you.</p>
      <fieldset><legend>Close Friends</legend><div class="close-friend-choices">${owner ? 'Loading…' : choices(localChoices)}</div></fieldset>
      <h3>Muted posts</h3>${renderMuted(state.mutedPostHandles, 'posts')}
      <h3>Muted stories</h3>${renderMuted(state.mutedStoryHandles, 'stories')}
      <button type="button" data-restore-hidden>Restore hidden posts (${state.hiddenPostKeys.size})</button>
      <p>Mute and hidden-post settings are saved on this device.</p>`);
    if (owner) {
        const list = document.querySelector('.close-friend-choices');
        void loadCloudStoryAudience().then(people => {
            if (list.isConnected && state.signedInAccountId === owner) list.innerHTML = choices(people);
        }).catch(() => {
            if (list.isConnected) list.textContent = 'Could not load your Close Friends. Reopen settings to try again.';
        });
    }
}
function renderMuted(handles, type) {
    return [...handles].map(handle => `<p>${escapeHtml(handle)} <button type="button" data-unmute="${type}" data-handle="${escapeHtml(handle)}">Unmute</button></p>`).join('') || '<p>None</p>';
}
export function openReportPanel(post, type) {
    const messages = type === 'conversation' ? (post.messages || []).filter(message => message.from !== 'me' && message.id).slice(-20) : [];
    state.reportingMedia = type === 'conversation' ? { type, messages, cloud: Boolean(post.cloudId) } : { ...reportTarget(post, type), type };
    const cloud = state.reportingMedia.cloud;
    showHomePanel(`Report ${type === 'conversation' ? 'chat' : reportKindLabel(type).toLowerCase()}`, `<p>${cloud ? 'Choose a reason. An admin will review your complaint before taking action.' : 'This is demo content. Its report is saved only on this device.'}</p>${type === 'conversation' ? '<p>Choose the message you want an admin to review. Only that message and its attachment will be shared for review.</p>' : ''}<form class="local-report-form">${type === 'conversation' ? `<label>Reported message<select name="message" required><option value="">Choose a message</option>${messages.map(message => `<option value="${escapeHtml(String(message.id))}">${escapeHtml((message.text || message.fileName || message.type || 'Message').slice(0, 100))}</option>`).join('')}</select></label>${messages.length ? '' : '<p>No received messages are loaded. Open the chat history first.</p>'}` : ''}<fieldset class="report-reasons"><legend>Why are you reporting this?</legend>${REPORT_REASONS.map(([code, label]) => `<label><input type="radio" name="reason" value="${code}" required> ${escapeHtml(label)}</label>`).join('')}</fieldset><label>Details (optional)<textarea name="details" maxlength="500"></textarea></label><p data-report-error role="status"></p><button type="submit">${cloud ? 'Submit report' : 'Save local report'}</button></form>`);
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
        const input = event.target;
        if (input.dataset.cloudCloseFriend) {
            const selected = input.checked;
            input.disabled = true;
            void setCloudStoryFriend(input.dataset.cloudCloseFriend, selected).catch(() => {
                input.checked = !selected;
                showShareFeedback('Could not save your Close Friends list.');
            }).finally(() => { input.disabled = false; });
            return;
        }
        if (input.checked) state.closeFriendHandles.add(handle); else state.closeFriendHandles.delete(handle);
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
        let report = state.reportingMedia;
        if (report?.type === 'conversation') {
            const message = report.messages.find(item => String(item.id) === event.target.elements.message.value);
            if (!message) return;
            report = reportTarget({ ...message, cloud: report.cloud }, 'message');
        }
        if (report?.cloud) {
            const form = event.target;
            const button = form.querySelector('button[type="submit"]');
            if (button.disabled) return;
            button.disabled = true;
            const details = form.elements.details.value.trim();
            const errorLabel = form.querySelector('[data-report-error]');
            errorLabel.textContent = '';
            void submitContentReport(report, reason, details).then(() => {
                if (form.isConnected) closeHomePanel();
                showShareFeedback('Report submitted. Track its outcome in Settings → Reported activities.');
            }).catch(() => {
                if (form.isConnected) errorLabel.textContent = 'Could not submit your report. Please try again.';
            }).finally(() => { button.disabled = false; });
            return;
        }
        state.localReports = state.localReports || [];
        state.localReports.push({ type: report.kind || report.type, id: report.ref, reason, details: event.target.elements.details.value.trim(), createdAt: Date.now() });
        persistSession().then(() => {
            document.querySelector('.home-controls-backdrop').hidden = true;
            showShareFeedback('Local report saved.');
        }).catch(() => showShareFeedback('The report could not be saved.'));
    });
}

export function closeHomePanel() { const panel=document.querySelector('.home-panel');panel.querySelectorAll('video').forEach(video => video.pause());panel.classList.remove('story-repost-visit-prompt');panel.removeAttribute('aria-label');Object.assign(panel.style,{position:'',left:'',top:''});document.querySelector('.home-controls-backdrop').hidden = true; if (!document.querySelector('.story-viewer-backdrop').hidden) resumeStory(); }
