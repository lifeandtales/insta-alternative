import { setupAdminDeletions } from './admin-deletions.js';
import { setupAdminPassword } from './admin-password.js';
import { setupAdminUsers } from './admin-users.js?v=353';
import { getSupabaseClient } from '../storage/supabase.js';

const status = document.querySelector('#status');
const form = document.querySelector('#sign-in');
const dashboard = document.querySelector('#dashboard');
const refresh = document.querySelector('#refresh');
const signOut = document.querySelector('#sign-out');
const formatDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const formatCount = new Intl.NumberFormat();
const hiddenOverviewTotals = new Set(['Messages', 'Views', 'Stories', 'Chat attachments', 'Notifications', 'Direct chats']);

function element(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

function renderList(id, items, render, emptyText) {
  document.querySelector(id).replaceChildren(...(items.length ? items.map(render) : [element('li', emptyText)]));
}

function dateElement(date) {
  const node = element('time', formatDate.format(new Date(date)));
  node.dateTime = date;
  return node;
}

async function start() {
  const client = await getSupabaseClient();
  if (!client) throw new Error('Supabase is unavailable. Check your connection and reload.');

  const users = setupAdminUsers(client);
  setupAdminPassword(client);
  const deletions = setupAdminDeletions(client);
  const tabs = [...document.querySelectorAll('[data-section]')];
  let section = 'overview';

  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      section = tab.dataset.section;
      for (const control of tabs) {
        document.getElementById(control.dataset.section).hidden = control !== tab;
        if (control === tab) control.setAttribute('aria-current', 'page');
        else control.removeAttribute('aria-current');
      }
      if (section === 'users') void users.load();
      if (section === 'deletions') void deletions.load();
    });
  }

  let request = 0;
  async function load(successMessage = '') {
    const current = ++request;
    refresh.disabled = true;
    status.textContent = 'Loading activity…';
    try {
      const { data, error } = await client.rpc('admin_dashboard_overview');
      if (current !== request) return;
      if (error) {
        dashboard.hidden = true;
        refresh.hidden = true;
        status.textContent = error.code === '42501'
          ? 'This account does not have admin access.'
          : 'Could not load admin activity. Check that the admin migration has been applied.';
        return;
      }
      document.querySelector('#totals').replaceChildren(...Object.entries(data.totals).filter(([label]) => !hiddenOverviewTotals.has(label)).map(([label, count]) => {
        const card = element('div', '');
        card.append(element('dt', label), element('dd', formatCount.format(count)));
        return card;
      }));
      renderList('#activity', data.activity, event => {
        const row = element('li', event.category);
        row.append(dateElement(event.created_at));
        return row;
      }, 'No activity yet.');
      dashboard.hidden = false;
      refresh.hidden = false;
      status.textContent = successMessage;
    } catch {
      if (current !== request) return;
      dashboard.hidden = true;
      status.textContent = 'Could not load activity. Check your connection and try again.';
    } finally {
      if (current === request) refresh.disabled = false;
    }
  }

  function showSession(session) {
    request++;
    users.reset();
    deletions.reset();
    dashboard.hidden = true;
    refresh.hidden = !session;
    signOut.hidden = !session;
    form.hidden = Boolean(session);
    status.textContent = '';
    if (session) {
      void load().then(() => {
        if (!dashboard.hidden && section === 'users') return users.load();
        if (!dashboard.hidden && section === 'deletions') return deletions.load();
      });
    }
  }

  client.auth.onAuthStateChange((event, session) => {
    if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) {
      // Call the data API outside the Supabase Auth callback.
      setTimeout(() => showSession(session), 0);
    }
  });
  refresh.addEventListener('click', async () => {
    await load();
    if (!dashboard.hidden && section === 'users') await users.load();
    if (!dashboard.hidden && section === 'deletions') await deletions.load();
  });
  signOut.addEventListener('click', async () => {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (error) status.textContent = 'Could not sign out. Please try again.';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const { email, password } = form.elements;
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Signing in…';
    try {
      const { error } = await client.auth.signInWithPassword({ email: email.value.trim(), password: password.value });
      if (error) status.textContent = 'Sign-in failed. Check your credentials and email confirmation.';
      else form.reset();
    } catch {
      status.textContent = 'Could not sign in. Check your connection and try again.';
    } finally {
      button.disabled = false;
    }
  });
}

start().catch(() => {
  status.textContent = 'Could not connect to Supabase. Check your connection and reload.';
});
