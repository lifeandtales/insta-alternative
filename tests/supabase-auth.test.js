import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from './helpers/app-harness.js';

for (const remember of [true, false]) test(`login uses ${remember ? 'device' : 'tab'} storage when Keep me logged in is ${remember ? 'accepted' : 'declined'}`, async () => {
    const app = await loadApp();
    const user = { id: 'account-1', user_metadata: { age_band: 'adult' } };
    const profile = { id: user.id, username: 'realaccount', display_name: 'Real Account', bio: '' };
    let storageKey;
    app.context.window.supabase = { createClient: (url, key, { auth: options }) => ({
        rpc: async name => { assert.equal(name, 'cancel_account_deletion_after_login'); return { data: { status: 'none' } }; },
        auth: { signInWithPassword: async ({ email }) => {
            assert.equal(email, 'person@example.com');
            storageKey = options.storageKey;
            options.storage.setItem(storageKey, 'test-session');
            return { data: { user }, error: null };
        } },
        from(table) {
            assert.equal(table, 'profiles');
            return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) };
        },
    }) };
    const createElement = app.document.createElement;
    app.document.createElement = tag => Object.assign(createElement(tag), { remove() {} });
    app.document.head = { append: script => script.onload() };
    const button = {};
    const error = {};
    const form = {
        dataset: { entryForm: 'login' },
        elements: { email: { value: 'person@example.com', validity: { valid: true } }, password: { value: 'test-only' } },
        querySelector: selector => selector === '.welcome-form-error' ? error : button,
    };
    const submit = app.listeners.find(item => item.type === 'submit' && String(item.callback).includes('signInWithPassword')).callback;
    app.element('.app-shell').hidden = true;
    await submit({ target: { closest: () => form }, preventDefault() {} });
    assert.equal(error.hidden, true);
    assert.equal(app.element('#welcome-session-choice').hidden, false);
    assert.equal(app.element('.app-shell').hidden, true);
    assert.equal(app.storage.get(storageKey), undefined);
    const action = { dataset: { welcomeAction: remember ? 'remember-yes' : 'remember-no' } };
    const click = app.listeners.find(item => item.type === 'click' && String(item.callback).includes('remember-yes')).callback;
    click({ target: { closest: selector => selector === '[data-welcome-action]' ? action : null } });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(app.storage.get(storageKey), remember ? 'test-session' : undefined);
    assert.equal(app.context.window.sessionStorage.getItem(storageKey), remember ? null : 'test-session');
    assert.equal(app.element('.app-shell').hidden, false);
    assert.equal(app.exportsOf('src/data/sample-data.js').currentUser.handle, '@realaccount');
    assert.equal(app.exportsOf('src/storage/browser-storage.js').accountStorageKey('insta-browser-data'), 'insta-browser-data:account-1');
});

test('username login uses the returned session and opens Keep me logged in', async () => {
    const app = await loadApp();
    const user = { id: 'account-1' };
    const tokens = { access_token: 'test-token', refresh_token: 'test-refresh' };
    app.context.window.supabase = { createClient: () => ({
        functions: { invoke: async (name, { body }) => {
            assert.equal(name, 'username-login');
            assert.equal(body.username, 'realaccount');
            assert.equal(body.password, 'test-only');
            return { data: tokens };
        } },
        auth: { setSession: async session => {
            assert.equal(session, tokens);
            return { data: { user } };
        } },
    }) };
    const createElement = app.document.createElement;
    app.document.createElement = tag => Object.assign(createElement(tag), { remove() {} });
    app.document.head = { append: script => script.onload() };
    const error = {};
    const form = {
        dataset: { entryForm: 'login' },
        elements: { email: { value: ' RealAccount ' }, password: { value: 'test-only' } },
        querySelector: selector => selector === '.welcome-form-error' ? error : {},
    };
    const submit = app.listeners.find(item => item.type === 'submit' && String(item.callback).includes('username-login')).callback;
    await submit({ target: { closest: () => form }, preventDefault() {} });
    assert.equal(error.hidden, true);
    assert.equal(app.element('#welcome-session-choice').hidden, false);
});
