import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';
async function endpoint(status = 'available') {
    let handler; const calls = [];
    const context = vm.createContext({ Response, TextEncoder, Uint8Array, Array, JSON, crypto: webcrypto,
        Deno: { env: { get: key => ({ SUPABASE_URL: 'https://project.test', SUPABASE_SERVICE_ROLE_KEY: 'server-only-test-secret' })[key] }, serve: fn => { handler = fn; } } });
    const sdk = new vm.SyntheticModule(['createClient'], function () { this.setExport('createClient', () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: status }; } })); }, { context });
    const module = new vm.SourceTextModule(stripTypeScriptTypes(await readFile(new URL('../supabase/functions/signup-availability/index.ts', import.meta.url), 'utf8')), { context });
    await module.link(() => sdk); await module.evaluate();
    return { calls, invoke: (body, ip = '192.0.2.1') => handler(new Request('https://edge.test', { method: 'POST', headers: { 'x-forwarded-for': ip }, body: JSON.stringify(body) })) };
}
test('signup availability returns only status, hashes the IP and ignores a caller rate-limit key', async () => {
    const { invoke, calls } = await endpoint('taken');
    const response = await invoke({ field: 'email', value: 'person@example.com', request_key: 'forged' });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'taken' });
    assert.match(calls[0].args.request_key, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(JSON.stringify(calls), /192\.0\.2\.1|server-only-test-secret|forged/);
    await invoke({ field: 'username', value: 'realperson' }, '192.0.2.2');
    assert.notEqual(calls[0].args.request_key, calls[1].args.request_key);
});
test('signup checks reject password/invalid fields and honor backend rate limiting', async () => {
    const { invoke, calls } = await endpoint('limited');
    assert.equal((await invoke({ field: 'password', value: 'never-send-passwords' })).status, 400);
    assert.equal(calls.length, 0);
    assert.equal((await invoke({ field: 'username', value: 'realperson' })).status, 429);
});
