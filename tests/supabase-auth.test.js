import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from './helpers/app-harness.js';

test('a verified Supabase login opens the app under its own storage scope', async () => {
    const app = await loadApp();
    const user = { id: 'account-1', user_metadata: { age_band: 'adult' } };
    const profile = { id: user.id, username: 'realaccount', display_name: 'Real Account', bio: '' };
    app.context.window.supabase = { createClient: () => ({
        auth: { signInWithPassword: async ({ email }) => {
            assert.equal(email, 'person@example.com');
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
    assert.equal(app.element('.app-shell').hidden, false);
    assert.equal(app.exportsOf('src/data/sample-data.js').currentUser.handle, '@realaccount');
    assert.equal(app.exportsOf('src/storage/browser-storage.js').accountStorageKey('insta-browser-data'), 'insta-browser-data:account-1');
});
