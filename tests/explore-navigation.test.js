import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from './helpers/app-harness.js';

test('Community entry belongs to Explore and Messages keeps its compose action', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { setView } = app.exportsOf('src/core/navigation.js');
    const entry = app.element('.explore-community-button');

    setView('explore', { refresh: false });
    assert.equal(entry.hidden, true);

    state.signedInAccountId = 'community-test-account';
    setView('explore', { refresh: false });
    assert.equal(entry.hidden, false);

    setView('messages', { refresh: false });
    assert.equal(entry.hidden, true);
    assert.equal(app.element('#explore-grid').hidden, true);
    const messages = app.element('#messages-list').innerHTML;
    assert.match(messages, /data-new-direct-message/);
    assert.doesNotMatch(messages, /data-open-communities/);
});

test('the Communities dialog Back action cannot render Explore over Messages', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { setView } = app.exportsOf('src/core/navigation.js');
    const { handleExploreClick } = app.exportsOf('src/features/explore.events.js');

    setView('messages', { refresh: false });
    const communityBack = {
        closest: selector => selector === '[data-community-back]' ? communityBack : null,
    };
    assert.equal(handleExploreClick({ target: communityBack }), false);
    assert.equal(state.currentView, 'messages');
    assert.equal(app.element('#view-heading').hidden, true);
    assert.equal(app.element('#explore-grid').hidden, true);
});
