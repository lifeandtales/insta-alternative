import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { loadApp } from './helpers/app-harness.js';

async function endpoint({ wrongPassword = false } = {}) {
    let handler;
    const calls = [];
    const server = {
        from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { username: 'member' } }) }) }) }),
        rpc: async name => {
            calls.push(name);
            return { data: name === 'claim_due_account_deletions' ? [] : { status: 'pending', delete_after: '2030-01-08' } };
        },
    };
    const caller = { auth: { getUser: async () => ({ data: { user: { id: 'owner', email: 'owner@example.com' } } }) } };
    const verifier = { auth: {
        signInWithPassword: async () => wrongPassword ? { error: new Error('Incorrect') } : { data: { user: { id: 'owner' } } },
        signOut: async () => { calls.push('sign-out-verifier'); },
    } };
    const context = {
        Request, Response, console,
        createClient: (url, key, options) => key === 'service' ? server : options.global ? caller : verifier,
        deleteAccountAndUploads: async () => { calls.push('delete'); },
        Deno: { env: { get: name => ({
            SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'anon',
            SUPABASE_SERVICE_ROLE_KEY: 'service', PUSH_WORKER_SECRET: 'worker',
        }[name]) }, serve: callback => { handler = callback; } },
    };
    const code = (await readFile(new URL('../supabase/functions/account-deletion/index.ts', import.meta.url), 'utf8'))
        .replace(/^import .*;\n/gm, '');
    vm.runInNewContext(stripTypeScriptTypes(code, { mode: 'transform' }), context);
    return { calls, send: body => handler(new Request('https://example.test', { method: 'POST',
        headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' }, body: JSON.stringify(body) })) };
}

test('deletion requires the signed-in account identity, password, and explicit confirmation', async () => {
    const api = await endpoint();
    const body = { action: 'request', identifier: 'member', password: 'test-password', confirmed: true };
    assert.equal((await api.send({ ...body, identifier: 'other' })).status, 400);
    assert.equal((await api.send({ ...body, confirmed: false })).status, 400);
    assert.equal(api.calls.length, 0);
    assert.equal((await api.send(body)).status, 200);
    assert.deepEqual(api.calls, ['sign-out-verifier', 'start_verified_account_deletion']);
    const wrong = await endpoint({ wrongPassword: true });
    assert.equal((await wrong.send(body)).status, 401);
    assert.equal(wrong.calls.length, 0);
});

test('a signed-in user cannot run scheduled account cleanup', async () => {
    const api = await endpoint();
    assert.equal((await api.send({ action: 'process_due' })).status, 401);
    assert.equal(api.calls.length, 0);
});

test('login deletion gate fails closed if the status check fails', async () => {
    const app = await loadApp();
    const { checkDeletionAfterLogin } = app.exportsOf('src/features/account-deletion-request.js');
    await assert.rejects(checkDeletionAfterLogin({ rpc: async () => ({ error: new Error('offline') }) }), /Could not verify/);
    assert.equal((await checkDeletionAfterLogin({ rpc: async () => ({ data: { status: 'cancelled' } }) })).status, 'cancelled');
});

test('a pending-deletion profile renders only the placeholder and hides cached media', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { rememberCloudPerson } = app.exportsOf('src/features/cloud-people.js');
    const { canViewAccount, canViewMedia } = app.exportsOf('src/core/social.js');
    state.signedInAccountId = 'viewer';
    const deleted = { id: 'deleted-owner', username: 'deletedmember', display_name: 'Account deleted',
        deletion_state: true, bio: '', avatar_path: null, is_private: true, follow_status: null };
    const person = rememberCloudPerson(deleted, new Map());
    state.profileHandle = '@deletedmember';
    app.exportsOf('src/features/profile.js').renderProfile();
    const html = app.element('#profile-view').innerHTML;
    assert.match(html, /Account deleted/);
    assert.doesNotMatch(html, /data-profile-section|Edit profile|Follow<|profile-stats/);
    assert.equal(canViewAccount('@deletedmember'), false);
    assert.equal(canViewMedia({ handle: '@deletedmember', cloudOwnerId: 'deleted-owner' }), false);
    rememberCloudPerson({ ...deleted, display_name: 'Restored Member', deletion_state: false, is_private: false });
    assert.equal(person.deletionState, false);
    assert.equal(canViewAccount('@deletedmember'), true);
});
