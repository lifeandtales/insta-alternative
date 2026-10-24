import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('Story schedule popup rejects past dates and cancel restores the saved choice', async () => {
    const app = await loadApp();
    const options = app.exportsOf('src/features/story-options.js');
    const input = app.element('#story-schedule-time');
    input.value = '2030-01-02T10:30';
    options.openStoryOption('schedule', app.element('.story-schedule-open'));
    input.value = '2020-01-01T10:30';
    assert.equal(options.closeStoryOption(true), false);
    assert.equal(app.element('.story-option-error').hidden, false);
    assert.equal(app.element('.story-option-backdrop').hidden, false);
    assert.equal(options.closeStoryOption(), true);
    assert.equal(input.value, '2030-01-02T10:30');
    assert.equal(app.element('.story-create-dialog').inert, false);
    options.openStoryOption('schedule', app.element('.story-schedule-open'));
    input.value = '';
    assert.equal(options.closeStoryOption(true), true);
    assert.equal(app.element('.story-schedule-summary').textContent, 'Share now');
});

test('Priority Friends saves the existing Close Friends audience value; cancellation does not change it', async () => {
    const app = await loadApp();
    const options = app.exportsOf('src/features/story-options.js');
    const audience = app.element('#story-audience');
    audience.value = 'all';
    options.openStoryOption('audience', app.element('.story-audience-open'));
    app.element('[name="story-audience-choice"]:checked').value = 'close-friends';
    options.closeStoryOption();
    assert.equal(audience.value, 'all');
    options.openStoryOption('audience', app.element('.story-audience-open'));
    assert.equal(options.closeStoryOption(true), true);
    assert.equal(audience.value, 'close-friends');
    assert.equal(app.element('.story-audience-summary').textContent, 'Priority Friends');
    const state = app.exportsOf('src/core/state.js').state;
    state.verificationStatus = 'pending';
    options.openStoryOption('audience', app.element('.story-audience-open'));
    assert.equal(app.element('.story-option-backdrop').hidden, true);
});

test('closing selected media asks to save or discard, and Keep editing preserves all pending edits', async () => {
    const app = await loadApp();
    const state = app.exportsOf('src/core/state.js').state;
    const stories = app.exportsOf('src/features/stories.js');
    const options = app.exportsOf('src/features/story-options.js');
    stories.openStoryCreator();
    const selected = { type: 'image', media: 'fixture.png', edits: { layers: [{ text: 'Keep me' }] } };
    state.pendingStoryMedia = selected;
    stories.closeStoryCreator();
    assert.equal(app.element('.story-exit-backdrop').hidden, false);
    assert.equal(app.element('.story-create-dialog').inert, true);
    assert.equal(options.closeStoryExitDialog(), true);
    assert.equal(state.pendingStoryMedia, selected);
    assert.equal(app.element('.story-create-dialog').inert, false);
    options.openStoryExitDialog();
    options.setStoryDraftSaving(true);
    assert.equal(options.closeStoryExitDialog(), false);
    options.setStoryDraftSaving(false);
    app.exportsOf('src/features/stories.events.js').handleStoryClick({ target: { closest: selector => selector === '.story-discard' ? {} : null } });
    assert.equal(state.pendingStoryMedia, null);
    assert.equal(app.element('.story-exit-backdrop').hidden, true);
    assert.equal(app.element('.story-create-backdrop').hidden, true);
    assert.equal(app.element('#story-schedule-time').value, '');
    assert.equal(app.element('#story-audience').value, 'all');
});

