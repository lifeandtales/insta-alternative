import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { loadApp } from './helpers/app-harness.js';

const owner = '10000000-0000-0000-0000-000000000001';
const ticket = '20000000-0000-0000-0000-000000000002';
const photoBucket = 'lifeandtales-post-photos-156275915028-ap-southeast-2-an';
const videoBucket = 'lifeandtales-post-videos-156275915028-ap-southeast-2-an';

async function endpoint({ visible = [], cleanup = [], known = [], failDelete = false, canUpload = true } = {}) {
    const calls = [];
    const registered = [];
    const env = { SUPABASE_URL: 'https://example.test', SUPABASE_ANON_KEY: 'public', SUPABASE_SERVICE_ROLE_KEY: 'service',
        REEL_S3_ACCESS_KEY_ID: 'test', REEL_S3_SECRET_ACCESS_KEY: 'test' };
    let handler;
    const query = (service, table) => {
        const q = {
            select() { return this; }, eq() { return this; }, in() { return this; },
            maybeSingle: async () => ({ data: null }),
            insert: async value => { registered.push(value); return {}; },
            delete() { return this; },
            then(resolve) { resolve({ data: service ? known : visible }); },
        };
        return q;
    };
    class S3Client {
        async send(command) {
            calls.push({ command: command.kind, ...command.input });
            if (command.kind === 'HeadObjectCommand') return { ETag: 'verified-etag', ContentLength: 100,
                ContentType: 'image/jpeg', Metadata: { path: owner + '/upload/0', namespace: 'post-images' } };
            if (command.kind === 'DeleteObjectsCommand' && failDelete) throw new Error('Unavailable');
            return {};
        }
    }
    const context = { Response, Request, console: { error() {} }, S3Client,
        crypto: { randomUUID: () => ticket },
        createClient: (url, key) => ({ auth: { getUser: async () => ({ data: { user: { id: owner } } }) },
            from: table => query(key === 'service', table), rpc: async name => ({ data: name === 'can_upload_s3_chat_attachment' ? canUpload : cleanup }) }),
        createPresignedPost: async (s3, input) => { calls.push({ command: 'presign', ...input }); return { url: 'https://s3.test', fields: {} }; },
        getSignedUrl: async (s3, command) => { calls.push({ command: 'sign', ...command.input }); return 'https://s3.test/signed'; },
        Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn; } },
    };
    for (const kind of ['CopyObjectCommand', 'DeleteObjectsCommand', 'GetObjectCommand', 'HeadObjectCommand'])
        context[kind] = class { constructor(input) { this.kind = kind; this.input = input; } };
    const source = (await readFile(new URL('../supabase/functions/media-storage/index.ts', import.meta.url), 'utf8'))
        .replace(/^import .*;\n/gm, '');
    vm.runInNewContext(stripTypeScriptTypes(source, { mode: 'transform' }), context);
    return { calls, registered, async send(body, authenticated = true) {
        const response = await handler(new Request('https://example.test', { method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(authenticated ? { Authorization: 'Bearer test-user' } : {}) },
            body: JSON.stringify(body) }));
        return { status: response.status, data: await response.json() };
    } };
}

test('media endpoint requires login and rejects foreign paths and oversized files before S3', async () => {
    const api = await endpoint();
    assert.equal((await api.send({ action: 'read', namespace: 'avatars', paths: [] }, false)).status, 401);
    assert.equal((await api.send({ action: 'prepare', namespace: 'post-images', path: 'other/upload', media: { mime: 'image/jpeg', size: 100 } })).status, 403);
    assert.equal((await api.send({ action: 'prepare', namespace: 'avatars', path: owner + '/avatar', media: { mime: 'image/jpeg', size: 10000001 } })).status, 400);
    assert.equal(api.calls.length, 0);
});

test('photo, video, story audio and avatars use their separate S3 buckets', async () => {
    const api = await endpoint();
    for (const [namespace, suffix, mime, bucket] of [
        ['post-images', 'upload/0', 'image/jpeg', photoBucket],
        ['post-images', 'upload/1', 'video/mp4', videoBucket],
        ['app-media', 'story/soundtrack', 'audio/mpeg', 'lifeandtales-stories-156275915028-ap-southeast-2-an'],
        ['avatars', 'avatar.jpg', 'image/jpeg', 'lifeandtales-profile-photos-156275915028-ap-southeast-2-an'],
    ]) {
        const result = await api.send({ action: 'prepare', namespace, path: owner + '/' + suffix, media: { mime, size: 100 } });
        assert.equal(result.status, 200);
        const signed = api.calls.at(-1);
        assert.equal(signed.Bucket, bucket);
        assert.equal(signed.Expires, 600);
        assert.deepEqual(Array.from(signed.Conditions.at(-1)), ['content-length-range', 100, 100]);
    }
});

test('chat file uploads require conversation permission and preserve conversation-first paths', async () => {
    const path = ticket + '/' + owner + '/attachment';
    const api = await endpoint();
    const result = await api.send({ action: 'prepare', namespace: 'chat-attachments', path,
        media: { mime: 'application/pdf', size: 100 } });
    assert.equal(result.status, 200);
    assert.equal(api.calls[0].Bucket, 'lifeandtales-messages-156275915028-ap-southeast-2-an');
    const denied = await endpoint({ canUpload: false });
    assert.equal((await denied.send({ action: 'prepare', namespace: 'chat-attachments', path,
        media: { mime: 'video/mp4', size: 100 } })).status, 403);
    assert.equal(denied.calls.length, 0);
});

test('completed uploads copy verified staging bytes to an immutable key before database registration', async () => {
    const api = await endpoint();
    const result = await api.send({ action: 'complete', namespace: 'post-images', path: owner + '/upload/0',
        ticket, media: { mime: 'image/jpeg', size: 100 } });
    assert.equal(result.status, 200);
    assert.equal(api.calls[0].command, 'HeadObjectCommand');
    assert.equal(api.calls[1].command, 'CopyObjectCommand');
    assert.equal(api.calls[1].CopySourceIfMatch, 'verified-etag');
    assert.match(api.calls[1].Key, /^media\//);
    assert.equal(api.registered[0].object_key, api.calls[1].Key);
    assert.equal(api.calls.at(-1).command, 'DeleteObjectsCommand');
    const mismatch = await api.send({ action: 'complete', namespace: 'post-images', path: owner + '/upload/1',
        ticket, media: { mime: 'image/jpeg', size: 100 } });
    assert.equal(mismatch.status, 409);
    assert.equal(api.registered.length, 1);
});

test('only viewer-authorized database objects receive S3 playback URLs', async () => {
    const path = owner + '/upload/0';
    const api = await endpoint({ visible: [{ path, category: 'post-photos', object_key: 'media/verified' }] });
    const result = await api.send({ action: 'read', namespace: 'post-images', paths: [path, 'legacy/image'] });
    assert.equal(result.status, 200);
    assert.equal(result.data.urls.length, 1);
    assert.deepEqual(result.data.legacy, ['legacy/image']);
    assert.equal(api.calls[0].Bucket, photoBucket);
    assert.equal(api.calls[0].Key, 'media/verified');
});

test('failed S3 cleanup reports incomplete removal and never deletes unclaimed or foreign objects', async () => {
    const path = owner + '/upload/0';
    const api = await endpoint({ cleanup: [{ path, category: 'post-photos', object_key: 'media/verified' }],
        known: [{ path }], failDelete: true });
    const result = await api.send({ action: 'delete', namespace: 'post-images', paths: [path] });
    assert.equal(result.data.filesRemoved, false);
    assert.equal(result.data.legacy.length, 0);
    assert.equal((await api.send({ action: 'delete', namespace: 'post-images', paths: ['other/asset'] })).status, 403);
    assert.equal(api.calls.length, 1);
});

test('media adapter merges legacy Supabase and S3 signed URLs without sending new uploads to Supabase', async () => {
    const app = await loadApp();
    const { installS3MediaStorage, mediaBucket } = app.exportsOf('src/storage/s3-media-access.js');
    const legacyCalls = [];
    const client = { functions: { invoke: async (name, { body }) => ({ data: {
        urls: [{ path: 'new', signedUrl: 'https://s3.test/new' }], legacy: ['old'],
    } }) }, storage: { from: () => ({ createSignedUrls: async paths => {
        legacyCalls.push(...paths); return { data: paths.map(path => ({ path, signedUrl: 'https://supabase.test/' + path })) };
    } }) } };
    installS3MediaStorage(client);
    const result = await mediaBucket(client, 'post-images').createSignedUrls(['new', 'old'], 300);
    assert.equal(result.data.length, 2);
    assert.deepEqual(legacyCalls, ['old']);
});
