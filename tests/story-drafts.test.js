import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-harness.js';
test('draft selection supports multiple Story drafts, cancel preserves them, other draft types stay protected',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
    state.draftItems=[{id:'a',type:'story',savedAt:Date.now()},{id:'b',type:'story',savedAt:Date.now()},{id:'p',type:'post',savedAt:Date.now()}];
    // Use the harness clock for expiry rather than the host clock.
    state.draftItems.forEach(d=>d.savedAt=1792738800000);
    const drafts=app.exportsOf('src/features/story-drafts.js');drafts.renderStoryDrafts(true);
    const click=(selector,dataset={})=>drafts.handleStoryDraftManagement({target:{closest:s=>s===selector?{dataset}:null}});
    click('[data-story-drafts-select]');click('[data-story-draft-select]',{storyDraftSelect:'a'});click('[data-story-draft-select]',{storyDraftSelect:'b'});
    assert.match(app.element('.story-draft-list').innerHTML,/Delete selected \(2\)/);
    click('[data-story-drafts-cancel]');assert.equal(state.draftItems.length,3);
    click('[data-story-drafts-select]',{storyDraftsSelect:'a'});click('[data-story-draft-select]',{storyDraftSelect:'b'});click('[data-story-drafts-delete]');
    assert.equal(state.draftItems.length,1);assert.equal(state.draftItems[0].type,'post');
});
