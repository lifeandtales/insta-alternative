import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from './helpers/app-harness.js';

test('Explore ignores stale cloud search results and opens the matching profile with its request state', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { renderExploreSearchResults } = app.exportsOf('src/features/explore.js');
    const { handleAuthorClick } = app.exportsOf('src/features/profile.events.js');
    const queue = [];
    const started = [];
    const replies = new Map();
    app.context.AbortController = AbortController;
    app.context.setTimeout = callback => queue.push(callback);
    app.context.window.supabase = { createClient: () => ({
        rpc(name, args) {
            assert.equal(name, 'search_social_people');
            return { abortSignal: signal => new Promise(resolve => {
                started.push({ query: args.search_text, signal });
                replies.set(args.search_text, resolve);
            }) };
        }
    }) };
    const createElement = app.document.createElement;
    app.document.createElement = tag => Object.assign(createElement(tag), { remove() {} });
    app.document.head = { append: script => script.onload() };
    state.signedInAccountId = 'signed-in-account';
    state.currentView = 'explore';
    const input = app.element('.search-wrap input');
    const results = app.element('#explore-search-results');
    input.value = 'older';
    renderExploreSearchResults();
    const older = queue.shift()();
    await new Promise(resolve => setImmediate(resolve));
    input.value = '@newer';
    renderExploreSearchResults();
    const newer = queue.shift()();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(started[0].signal.aborted, true);
    assert.equal(started[1].query, '@newer');

    replies.get('@newer')({ data: [{
        id: 'person', username: 'newer', display_name: 'New Person', bio: '',
        is_private: true, follow_status: 'requested'
    }] });
    await newer;
    assert.match(results.innerHTML, /@newer/);
    assert.match(results.innerHTML, /Requested/);
    replies.get('older')({ data: [{
        id: 'stale', username: 'older', display_name: 'Stale Person'
    }] });
    await older;
    assert.doesNotMatch(results.innerHTML, /Stale Person/);

    const button = { dataset: { profileHandle: '@newer' }, closest: () => null };
    assert.equal(handleAuthorClick({ target: { closest: () => button } }), true);
    assert.equal(state.profileHandle, '@newer');
    assert.match(app.element('#profile-view').innerHTML, /New Person/);
    assert.match(app.element('#profile-view').innerHTML, /Requested/);
});
