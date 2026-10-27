import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

async function ownStoryFixture(count = 4) {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { currentUser } = app.exportsOf('src/data/sample-data.js');
    const stories = app.exportsOf('src/features/stories.js');
    state.stories = Array.from({ length: count }, (_, index) => ({
        id: `own-${index + 1}`, handle: currentUser.handle, user: currentUser.name,
        avatar: currentUser.avatar, mine: true, type: 'image', media: `image-${index + 1}.png`,
        expiresAt: Date.now() + 86400000
    }));
    app.element('.story-reply-form').reset = () => {};
    stories.openStoryGroup(currentUser.handle);
    return { app, state, stories };
}

test('removing the second Story leaves the others and continues with the third', async () => {
    const { app, state, stories } = await ownStoryFixture();
    state.scheduledStories.set('scheduled', { story: { media: 'later.png' }, timer: 99 });
    stories.showStoryAtIndex(1);
    assert.equal(stories.removeOwnStory(), true);
    assert.deepEqual(Array.from(state.stories, item => item.id), ['own-1', 'own-3', 'own-4']);
    assert.equal(state.activeStorySequence[state.activeStoryIndex].id, 'own-3');
    assert.equal(app.element('.story-viewer-backdrop').hidden, false);
    assert.equal(state.scheduledStories.has('scheduled'), true);
    assert.equal(state.storyExpiryTimers.has('own-2'), false);
    stories.showStoryAtIndex(state.activeStoryIndex - 1);
    assert.equal(state.activeStorySequence[state.activeStoryIndex].id, 'own-1');
});

test('removing the final slide selects the previous remaining Story, then closes when empty', async () => {
    const { app, state, stories } = await ownStoryFixture(2);
    stories.showStoryAtIndex(1);
    stories.removeOwnStory();
    assert.equal(state.activeStorySequence[state.activeStoryIndex].id, 'own-1');
    assert.equal(app.element('.story-viewer-backdrop').hidden, false);
    stories.removeOwnStory();
    assert.equal(state.stories.length, 0);
    assert.equal(state.activeStorySequence.length, 0);
    assert.equal(app.element('.story-viewer-backdrop').hidden, true);
});

test('Story removal cannot delete another account or an open highlight', async () => {
    const { state, stories } = await ownStoryFixture(1);
    const original = state.stories[0];
    state.activeStorySequence = [{ ...original, handle: '@aribloom' }];
    assert.equal(stories.removeOwnStory(), false);
    state.activeStorySequence = [{ ...original, fromHighlight: true }];
    assert.equal(stories.removeOwnStory(), false);
    assert.equal(state.stories.length, 1);
});

test('saved own Stories replace demo defaults without duplicating or restoring removed slides', async () => {
    const { app, state } = await ownStoryFixture(3);
    const first = state.stories[0];
    const stored = [first, first, { ...first, id: 'uploaded-story' }];
    app.context.window.indexedDB = {
        open() {
            const request = {};
            Promise.resolve().then(() => {
                request.result = {
                    close() {},
                    transaction() {
                        let pending = 0;
                        const transaction = { objectStore: () => ({ get(key) {
                            pending++;
                            const read = {};
                            Promise.resolve().then(() => {
                                read.result = key === 'active-stories' ? stored : undefined;
                                read.onsuccess();
                                if (!--pending) transaction.oncomplete();
                            });
                            return read;
                        } }) };
                        return transaction;
                    }
                };
                request.onsuccess();
            });
            return request;
        }
    };
    const { loadStoryHighlights } = app.exportsOf('src/storage/browser-storage.js');
    await loadStoryHighlights();
    await loadStoryHighlights();
    assert.deepEqual(Array.from(state.stories, item => item.id), ['own-1', 'uploaded-story']);
});
