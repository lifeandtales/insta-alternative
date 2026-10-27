import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('an incoming mention creates one inbox card and one bell notice across repeated syncs', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { conversations, currentUser } = app.exportsOf('src/data/sample-data.js');
    state.localStoryNotifications = [];
    const source = state.stories.find(story => story.id === 'ari-story-mention-demo');
    const notices = app.exportsOf('src/features/notifications.js');
    assert.equal(notices.recordStoryMentions(source), 2);
    assert.equal(notices.recordStoryMentions(source), 0);
    const chat = conversations.find(item => item.handle === '@aribloom');
    assert.equal(chat.messages.filter(message => message.type === 'story-mention').length, 1);
    assert.equal(chat.unread, true);
    assert.equal(state.localStoryNotifications.length, 1);
    assert.equal(state.localStoryNotifications[0].recipient, currentUser.handle);
    assert.ok(notices.availableLocalNotifications().some(item => item.title === 'Story mention' && item.text === 'Ari Bloom mentioned you in their story.'));
    state.activeConversationHandle = chat.handle;
    app.exportsOf('src/features/messages.js').renderMessages();
    assert.match(app.element('#messages-list').innerHTML, /Ari Bloom mentioned you in their story/);
    assert.match(app.element('#messages-list').innerHTML, /data-story-mention-repost="ari-story-mention-demo"/);
    source.expiresAt = 1;
    app.exportsOf('src/features/messages.js').renderMessages();
    assert.doesNotMatch(app.element('#messages-list').innerHTML, /data-story-mention-repost/);
});

test('publishing a mention targets the mentioned account and ignores copied tags, self tags and blocked accounts', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { conversations, currentUser } = app.exportsOf('src/data/sample-data.js');
    state.localStoryNotifications = [];
    const story = { id: 'mention-publish-test', handle: currentUser.handle, user: currentUser.name, media: 'fixture.png', type: 'image', edits: { layers: [{ type: 'text', text: `@noahvale @noahvale ${currentUser.handle}`, mentions: [{ handle: '@noahvale' }, { handle: '@noahvale' }, { handle: currentUser.handle }] }] } };
    const notices = app.exportsOf('src/features/notifications.js');
    await app.exportsOf('src/features/stories.js').addStory(story);
    assert.equal(notices.recordStoryMentions(story), 0, 'publishing already generated this mention');
    assert.equal(state.localStoryNotifications[0].recipient, '@noahvale');
    assert.equal(conversations.find(chat => chat.handle === '@noahvale').messages.at(-1).from, 'me');
    assert.ok(!notices.availableLocalNotifications().some(item => item.storyId === story.id));
    state.blockedHandles.add('@noahvale');
    assert.equal(notices.recordStoryMentions({ ...story, id: 'blocked-tag' }), 0);
    assert.equal(notices.recordStoryMentions({ ...story, id: 'copied-tag', edits: {}, repostSourceEdits: story.edits }), 0);
});

test('tapping a Story mention opens a dismissible Visit profile action', async () => {
    const app = await loadApp();
    const handle = '@mila_rose';
    const handled = app.exportsOf('src/features/stories.events.js').handleStoryClick({ target: { closest: selector => selector === '[data-story-mention-handle]' ? { dataset: { storyMentionHandle: handle } } : null } });
    assert.equal(handled, true);
    assert.equal(app.element('.home-controls-backdrop').hidden, false);
    assert.match(app.element('.home-panel-content').innerHTML, /Visit profile/);
    assert.match(app.element('.home-panel-content').innerHTML, /data-story-mention-profile="@mila_rose"/);
    app.exportsOf('src/features/home-controls.js').closeHomePanel();
    assert.equal(app.element('.home-controls-backdrop').hidden, true);
});

test('Visit original story switches a repost viewer to the exact source Story', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { currentUser } = app.exportsOf('src/data/sample-data.js');
    const source = state.stories.find(item => item.id === 'ari-story-mention-demo');
    const repost = { ...source, id: 'own-repost-fixture', handle: currentUser.handle, user: currentUser.name, mine: true, repostedStoryId: source.id, repostedFromUser: source.user, repostedFromHandle: source.handle, repostSourceEdits: source.edits, edits: {} };
    state.stories = [source, repost];
    app.element('.story-reply-form').reset = () => {};
    app.exportsOf('src/features/stories.js').openStoryGroup(currentUser.handle);
    app.exportsOf('src/features/stories.events.js').handleStoryClick({ target: { closest: selector => selector === '[data-reposted-open]' ? { dataset: { repostedOpen: `#story-${source.id}` } } : null } });
    assert.equal(state.activeStorySequence[state.activeStoryIndex].id, source.id);
    assert.equal(state.activeStorySequence[state.activeStoryIndex].handle, '@aribloom');
    assert.equal(app.element('.story-viewer-backdrop').hidden, false);
});
