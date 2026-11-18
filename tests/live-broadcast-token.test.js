import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { stripTypeScriptTypes } from 'node:module';
import { webcrypto } from 'node:crypto';

const host = '10000000-0000-0000-0000-000000000001';
const viewer = '20000000-0000-0000-0000-000000000002';
const broadcast = '90000000-0000-0000-0000-000000000001';
async function endpoint({ identity = viewer, configured = true, accessible = true } = {}) {
    let handler;
    const calls = [];
    const env = { SUPABASE_URL: 'https://project.test', SUPABASE_ANON_KEY: 'public-test-key',
        ...(configured ? { LIVEKIT_URL: 'wss://live.example.test', LIVEKIT_API_KEY: 'test-api-key', LIVEKIT_API_SECRET: 'test-only-secret' } : {}) };
    const client = {
        auth: { getUser: async () => ({ data: { user: { id: identity } } }) },
        rpc: async (name, args) => { calls.push({ name, args }); return { data: name === 'create_live_broadcast' ? broadcast : null }; },
        from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: async () => ({ data: accessible ? {
            id: broadcast, host_id: host, status: 'live', expires_at: new Date(Date.now() + 90000).toISOString(),
        } : null }) }),
    };
    const context = vm.createContext({ Response, Request, TextEncoder, Uint8Array, JSON, Date, crypto: webcrypto, btoa,
        AbortSignal, fetch: async (url, options) => { calls.push({ url, options }); return new Response(null, { status: 200 }); },
        Deno: { env: { get: name => env[name] }, serve: fn => { handler = fn; } } });
    const sdk = new vm.SyntheticModule(['createClient'], function () { this.setExport('createClient', () => client); }, { context });
    const source = stripTypeScriptTypes(await readFile(new URL('../supabase/functions/live-broadcast/index.ts', import.meta.url), 'utf8'));
    const module = new vm.SourceTextModule(source, { context });
    await module.link(() => sdk); await module.evaluate();
    const invoke = (body, authorized = true) => handler(new Request('https://edge.test', { method: 'POST',
        headers: authorized ? { Authorization: 'Bearer test-user-token' } : {}, body: JSON.stringify(body) }));
    return { invoke, calls };
}
const claims = token => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());

test('live viewer tokens can subscribe but cannot publish camera, audio or data', async () => {
    const { invoke } = await endpoint();
    const response = await invoke({ action: 'join', id: broadcast, host: true });
    assert.equal(response.status, 200);
    const data = await response.json(), body = claims(data.token);
    assert.equal(data.host, false);
    assert.equal(body.video.room, 'live-' + broadcast);
    assert.equal(body.video.canPublish, false);
    assert.equal(body.video.canPublishData, false);
    assert.equal(body.video.canSubscribe, true);
    assert.ok(body.exp - Math.floor(Date.now() / 1000) <= 120);
    const [header, payload, signature] = data.token.split('.');
    const key = await webcrypto.subtle.importKey('raw', new TextEncoder().encode('test-only-secret'), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    assert.equal(await webcrypto.subtle.verify('HMAC', key, Buffer.from(signature, 'base64url'), new TextEncoder().encode(header + '.' + payload)), true);
    assert.doesNotMatch(JSON.stringify(data), /test-only-secret/);
});
test('live host can start and publish; only host can end the broadcast', async () => {
    const owner = await endpoint({ identity: host });
    const response = await owner.invoke({ action: 'start' });
    const data = await response.json();
    assert.equal(claims(data.token).video.canPublish, true);
    assert.equal(owner.calls[0].name, 'create_live_broadcast');
    assert.equal((await owner.invoke({ action: 'end', id: broadcast })).status, 200);
    assert.ok(owner.calls.some(call => call.name === 'end_live_broadcast'));
    const deletion = owner.calls.find(call => call.url);
    assert.equal(deletion.url, 'https://live.example.test/twirp/livekit.RoomService/DeleteRoom');
    assert.equal(claims(deletion.options.headers.Authorization.slice(7)).video.roomCreate, true);
    const peer = await endpoint();
    assert.equal((await peer.invoke({ action: 'end', id: broadcast })).status, 403);
    assert.equal(peer.calls.length, 0);
});
test('live rejects unauthorized, inaccessible and unconfigured requests without creating a session', async () => {
    const { invoke, calls } = await endpoint({ configured: false });
    assert.equal((await invoke({ action: 'start' }, false)).status, 401);
    assert.equal((await invoke({ action: 'start' })).status, 503);
    assert.deepEqual(calls, []);
    const blocked = await endpoint({ accessible: false });
    assert.equal((await blocked.invoke({ action: 'join', id: broadcast })).status, 403);
    assert.equal((await blocked.invoke({ action: 'join', id: 'bad-id' })).status, 400);
});
