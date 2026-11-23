const pageSize = 25;

function node(tag, text) {
  const element = document.createElement(tag);
  element.textContent = text;
  return element;
}

function fieldList(values, className) {
  const list = node('dl', '');
  list.className = className;
  for (const [label, value] of Object.entries(values)) {
    const field = node('div', '');
    field.append(node('dt', label), node('dd', String(value ?? '—')));
    list.append(field);
  }
  return list;
}

export function setupAdminUsers(client) {
  const search = document.querySelector('#user-search');
  const query = document.querySelector('#user-query');
  const status = document.querySelector('#users-status');
  const list = document.querySelector('#user-list');
  const detail = document.querySelector('#user-detail');
  const previous = document.querySelector('#users-previous');
  const next = document.querySelector('#users-next');
  const dates = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const date = value => value ? dates.format(new Date(value)) : '—';
  const suspended = account => Date.parse(account.banned_until) > Date.now();
  const name = account => account.display_name || account.username || account.email || 'Unnamed account';
  let offset = 0;
  let term = '';
  let selected = null;
  let listRequest = 0;
  let detailRequest = 0;

  function reset() {
    listRequest++;
    detailRequest++;
    offset = 0;
    selected = null;
    term = '';
    query.value = '';
    list.replaceChildren();
    detail.textContent = 'Choose an account to see its details.';
    status.textContent = '';
    previous.disabled = next.disabled = true;
  }

  async function renderDetails(id) {
    selected = id;
    for (const button of list.querySelectorAll('button')) {
      button.setAttribute('aria-pressed', String(button.dataset.id === id));
    }
    const request = ++detailRequest;
    detail.textContent = 'Loading account…';
    try {
      const { data, error } = await client.rpc('admin_user_details', { target: id });
      if (request !== detailRequest) return;
      if (error) throw error;
      const { account, totals, activity } = data;
      const fields = fieldList({
        'Account status': suspended(account) ? 'Suspended' : 'Active',
        Role: account.is_admin ? 'Admin' : 'User',
        Email: account.email,
        Username: account.username ? '@' + account.username : null,
        'User ID': account.id,
        'Signed up': date(account.created_at),
        'Email confirmed': account.email_confirmed_at ? date(account.email_confirmed_at) : 'Pending',
        'Last sign-in': date(account.last_sign_in_at),
        Bio: account.bio || null
      }, 'account-fields');
      const actions = node('div', '');
      actions.className = 'actions';
      const contentLink = node('a', 'View profile and content');
      contentLink.href = './admin-reports.html?profile=' + encodeURIComponent(account.id);
      actions.append(contentLink);
      if (account.is_admin) {
        actions.append(node('p', 'Admin account protected.'));
      } else {
        const toggle = suspended(account) ? 'restore' : 'suspend';
        for (const [label, action] of [[toggle === 'restore' ? 'Restore account' : 'Suspend account', toggle], ['Delete account', 'delete']]) {
          const button = node('button', label);
          button.type = 'button';
          if (action === 'delete') button.className = 'danger';
          button.addEventListener('click', () => void moderate(account, action, actions));
          actions.append(button);
        }
      }
      const timeline = node('ul', '');
      for (const event of activity) timeline.append(node('li', event.category + ' · ' + date(event.created_at)));
      if (!activity.length) timeline.append(node('li', 'No synced events yet.'));
      detail.replaceChildren(node('h3', name(account)), fields, actions,
        node('h3', 'Activity totals'), fieldList(totals, ''), node('h3', 'Recent activity'), timeline);
    } catch {
      if (request === detailRequest) detail.textContent = 'Could not load this account.';
    }
  }

  async function moderate(account, action, actions) {
    const confirmation = action === 'delete' ? window.prompt('Permanently delete this account and its active uploads? Type ' + (account.username || account.email) + ' to confirm.') : '';
    if (action === 'delete' && confirmation !== (account.username || account.email)) return;
    if (action === 'suspend' && !window.confirm('Suspend sign-in for ' + name(account) + '?')) return;
    const request = detailRequest;
    for (const control of actions.children) control.disabled = true;
    try {
      const { data, error } = await client.functions.invoke('admin-users', { body: { action, target: account.id, confirmation } });
      if (error) {
        const result = await error.context?.json?.().catch(() => null);
        throw new Error(result?.message || 'Account action unavailable. Check that the admin function is deployed.');
      }
      if (request !== detailRequest) return;
      if (action === 'delete') {
        selected = null;
        detail.textContent = 'Account deleted.';
      }
      await load();
      if (request === detailRequest || selected === account.id) status.textContent = data.message;
    } catch (error) {
      if (request === detailRequest) status.textContent = error.message;
    } finally {
      for (const control of actions.children) control.disabled = false;
    }
  }

  async function load() {
    const request = ++listRequest;
    previous.disabled = next.disabled = true;
    status.textContent = 'Loading users…';
    try {
      const { data, error } = await client.rpc('admin_list_users', { search_text: term, page_offset: offset });
      if (request !== listRequest) return;
      if (error) throw error;
      if (!data.length && offset > 0) {
        offset -= pageSize;
        return load();
      }
      const accounts = data.slice(0, pageSize);
      list.replaceChildren(...accounts.map(account => {
        const row = node('li', '');
        const button = node('button', '');
        button.type = 'button';
        button.dataset.id = account.id;
        button.setAttribute('aria-pressed', String(selected === account.id));
        button.append(node('strong', name(account)), node('small', [
          account.username && '@' + account.username, account.email,
          account.is_admin ? 'Admin' : suspended(account) ? 'Suspended' : 'Active'
        ].filter(Boolean).join(' · ')));
        button.addEventListener('click', () => void renderDetails(account.id));
        row.append(button);
        return row;
      }));
      previous.disabled = offset === 0;
      next.disabled = data.length <= pageSize;
      status.textContent = accounts.length ? 'Showing ' + (offset + 1) + '–' + (offset + accounts.length) : 'No users found.';
      if (selected) await renderDetails(selected);
    } catch (error) {
      if (request !== listRequest) return;
      list.replaceChildren();
      detailRequest++;
      detail.textContent = '';
      status.textContent = error.code === 'PGRST202'
        ? 'Run the admin users migration to enable the directory.'
        : 'Could not load users. Check your access and refresh.';
    }
  }

  search.addEventListener('submit', event => {
    event.preventDefault();
    term = query.value.trim();
    offset = 0;
    selected = null;
    detailRequest++;
    detail.textContent = 'Choose an account to see its details.';
    void load();
  });
  previous.addEventListener('click', () => { offset -= pageSize; void load(); });
  next.addEventListener('click', () => { offset += pageSize; void load(); });
  return { load, reset };
}
