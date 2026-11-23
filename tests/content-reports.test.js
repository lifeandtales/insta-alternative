import test from 'node:test';
import assert from 'node:assert/strict';
import { REPORT_REASONS, reportTarget, reportStatus } from '../src/core/reporting.js';
import { loadApp } from './helpers/app-harness.js';

test('reports use server keys for Reels, Stories, image posts, profiles and messages', () => {
    assert.deepEqual(reportTarget({ id: 9, cloudContentId: 'reel-id' }, 'reel'), { kind: 'reel', ref: 'reel-id', cloud: true });
    assert.deepEqual(reportTarget({ id: 9, cloudOwnerId: 'author', cloudClientId: 91 }, 'post'), { kind: 'image_post', ref: 'author:91', cloud: true });
    assert.deepEqual(reportTarget({ id: '@name', cloudProfileId: 'profile-id' }, 'profile'), { kind: 'profile', ref: 'profile-id', cloud: true });
    assert.equal(reportTarget({ id: 'message-id', cloud: true }, 'message').cloud, true);
    assert.equal(reportTarget({ id: 9 }, 'reel').cloud, false);
});

test('reason choices cover the requested complaints and status distinguishes pending, review and decisions', () => {
    assert.equal(new Set(REPORT_REASONS.map(([code]) => code)).size, REPORT_REASONS.length);
    for (const code of ['dislike', 'unwanted', 'self_harm', 'violence', 'hate', 'exploitation', 'sexual', 'scam', 'spam', 'misinformation', 'intellectual_property']) assert.ok(REPORT_REASONS.some(([id]) => id === code));
    assert.equal(reportStatus({ status: 'pending' }), 'Waiting for review');
    assert.equal(reportStatus({ status: 'reviewing' }), 'Under review');
    assert.equal(reportStatus({ status: 'resolved', action: 'removed' }), 'Content hidden');
    assert.equal(reportStatus({ status: 'resolved' }), 'Reviewed');
});

async function setup() {
    const app = await loadApp();
    const state = app.exportsOf('src/core/state.js').state;
    state.signedInAccountId = 'owner';
    const calls = []; let handler = async name => ({ data: name === 'my_content_reports' ? [] : 'report-id' });
    const client = { rpc: async (name,args) => { calls.push({name,args}); return handler(name,args); } };
    app.document.head = { append: script => script.onload() };
    app.context.window.supabase = { createClient: () => client };
    return { app, state, calls, api: app.exportsOf('src/storage/cloud-reports.js'), setHandler: next => { handler = next; } };
}

test('cloud reports submit a complaint without modifying the reported content or falling back to local success', async () => {
    const { api, calls, state } = await setup();
    assert.equal(await api.submitContentReport({ kind: 'reel', ref: 'server-id' }, 'spam', ' detail '), 'report-id');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].name, 'submit_content_report');
    assert.equal(calls[0].args.details, 'detail');
    assert.equal(state.localReports, undefined);
});

test('report failures propagate and changing accounts discards late report history', async () => {
    const { api, state, setHandler } = await setup();
    setHandler(async () => ({ error: new Error('Network unavailable') }));
    await assert.rejects(api.submitContentReport({ kind: 'reel', ref: 'id' }, 'spam'));
    setHandler(async () => { state.signedInAccountId = 'other'; return { data: [{ reason: 'private report' }] }; });
    assert.equal(await api.loadMyReports(), null);
});

test('signed-out visitors cannot submit reports and have no history request', async () => {
    const { api, state, calls } = await setup(); state.signedInAccountId = null;
    await assert.rejects(api.submitContentReport({ kind: 'reel', ref: 'id' }, 'spam'));
    assert.deepEqual(JSON.parse(JSON.stringify(await api.loadMyReports())), []);
    assert.equal(calls.length, 0);
});
