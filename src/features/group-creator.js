import { createConnectedGroup, findMessageRecipients } from './cloud-chat.js';
import { closeHomePanel, showHomePanel } from './home-controls.js';
import { showShareFeedback } from '../components/feedback.js';
import { DEFAULT_AVATAR, mayInteract } from '../core/social.js';
import { currentUser } from '../data/sample-data.js';
import { state } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { createLocalGroup } from './message-access.js';

const pageSize = 30;
const maxMembers = 99;

export function openGroupCreator(onCreated) {
    if (!mayInteract()) { showShareFeedback('Approval is required to create a group.'); return; }
    showHomePanel('New group', `<form class="create-group-form">
      <section class="group-create-details">
        <label>Group name<input name="groupName" maxlength="60" autocomplete="off" /></label>
        <button class="group-choose-button" type="button" data-choose-group-people>Choose participants</button>
        <div class="group-chosen-people" aria-live="polite"></div>
        <button class="group-create-submit" type="submit" disabled>Create group</button>
      </section>
      <section class="group-people-picker" aria-label="Choose participants" hidden>
        <div class="group-picker-actions">
          <button type="button" data-cancel-group-people>Cancel</button>
          <strong>Choose participants</strong>
          <button type="button" data-done-group-people>Done</button>
        </div>
        <label class="visually-hidden" for="group-people-search">Search participants</label>
        <input id="group-people-search" type="search" placeholder="Search name or username" maxlength="100" autocomplete="off" />
        <p class="group-picker-status" role="status"></p>
        <div class="group-picker-list"></div>
      </section>
    </form>`);
    const form = document.querySelector('.create-group-form');
    const details = form.querySelector('.group-create-details');
    const picker = form.querySelector('.group-people-picker');
    const selectedLabel = form.querySelector('.group-chosen-people');
    const name = form.elements.groupName;
    const search = form.querySelector('#group-people-search');
    const list = form.querySelector('.group-picker-list');
    const status = form.querySelector('.group-picker-status');
    const submit = form.querySelector('.group-create-submit');
    const owner = state.signedInAccountId;
    let chosen = new Map();
    let draft = new Map();
    let rows = [];
    let offset = 0;
    let more = false;
    let pending = false;
    let revision = 0;
    let timer;

    function syncDetails() {
        selectedLabel.textContent = [...chosen.values()].map(person => person.name).join(', ');
        submit.disabled = !name.value.trim() || !chosen.size;
    }

    function syncRows() {
        list.innerHTML = rows.map(person => {
            const added = draft.has(person.id);
            return `<div class="group-person">
                <img src="${escapeHtml(person.avatar || DEFAULT_AVATAR)}" alt="" />
                <span><strong>${escapeHtml(person.name)}</strong><small>${escapeHtml(person.handle)}</small></span>
                <button type="button" data-group-person="${escapeHtml(person.id)}" aria-label="${added ? 'Added' : 'Add'} ${escapeHtml(person.name)}" aria-pressed="${added}">${added ? 'Added' : 'Add'}</button>
              </div>`;
        }).join('') + (more ? '<button type="button" data-more-group-people>Load more</button>' : '');
    }

    async function load(token) {
        const valid = () => revision === token && form.isConnected && !picker.hidden && state.signedInAccountId === owner;
        if (!valid() || pending) return;
        const term = search.value.trim().replace(/^@+/, '').toLowerCase();
        if (!owner) {
            rows = state.accountDirectory.filter(person => person.handle !== currentUser.handle &&
                !state.blockedHandles.has(person.handle) && [person.handle, person.name].some(value => value?.toLowerCase().includes(term)))
                .map(person => ({ ...person, id: person.handle }));
            syncRows();
            status.textContent = rows.length ? '' : 'No matching people.';
            return;
        }
        pending = true;
        status.textContent = 'Loading people…';
        try {
            const page = await findMessageRecipients(term, offset);
            if (!valid()) return;
            const current = page.slice(0, pageSize);
            offset += current.length;
            more = page.length > pageSize;
            rows.push(...current.filter(person => !state.blockedHandles.has(person.handle)));
            syncRows();
            status.textContent = rows.length ? '' : 'No matching people. An accepted follow is needed.';
        } catch {
            if (valid()) status.textContent = 'Could not load people. Edit the search to try again.';
        } finally {
            if (valid()) pending = false;
        }
    }

    function reload(delay = 0) {
        window.clearTimeout(timer);
        const token = ++revision;
        rows = [];
        offset = 0;
        more = false;
        pending = false;
        syncRows();
        timer = window.setTimeout(() => void load(token), delay);
    }

    function showDetails(save) {
        if (save) chosen = new Map(draft);
        window.clearTimeout(timer);
        revision += 1;
        picker.hidden = true;
        details.hidden = false;
        syncDetails();
        form.querySelector('[data-choose-group-people]').focus();
    }

    form.addEventListener('click', event => {
        if (event.target.closest('[data-choose-group-people]')) {
            draft = new Map(chosen);
            details.hidden = true;
            picker.hidden = false;
            search.value = '';
            reload();
            search.focus();
            return;
        }
        const toggle = event.target.closest('[data-group-person]');
        if (toggle) {
            const person = rows.find(row => row.id === toggle.dataset.groupPerson);
            if (!person) return;
            if (draft.has(person.id)) draft.delete(person.id);
            else if (draft.size < maxMembers) draft.set(person.id, person);
            else { status.textContent = 'A group can have up to 99 invitees.'; return; }
            const added = draft.has(person.id);
            toggle.textContent = added ? 'Added' : 'Add';
            toggle.setAttribute('aria-pressed', String(added));
            toggle.setAttribute('aria-label', (added ? 'Added ' : 'Add ') + person.name);
            return;
        }
        if (event.target.closest('[data-done-group-people]')) showDetails(true);
        if (event.target.closest('[data-cancel-group-people]')) showDetails(false);
        if (event.target.closest('[data-more-group-people]')) void load(revision);
    });

    search.addEventListener('input', event => { if (!event.isComposing) reload(180); });
    name.addEventListener('input', syncDetails);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!picker.hidden) { reload(); return; }
        if (submit.disabled || owner !== state.signedInAccountId) return;
        submit.disabled = true;
        try {
            const members = [...chosen.keys()];
            const group = owner ? await createConnectedGroup(name.value.trim(), members) : createLocalGroup(name.value, members);
            if (!group || !form.isConnected || owner !== state.signedInAccountId || state.currentView !== 'messages') return;
            closeHomePanel();
            onCreated(group);
        } catch (error) {
            const missing = error?.code === 'PGRST202' || error?.code === '42883';
            showShareFeedback(missing ? 'Run the connected groups migration to create groups.'
                : 'Could not create the group. Check your connection and participant eligibility.');
        } finally {
            syncDetails();
        }
    });
    name.focus();
}
