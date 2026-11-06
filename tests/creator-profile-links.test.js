import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('Home posts and Reels expose creator avatar buttons with the exact account handle',async()=>{
    const app=await loadApp();const {setView}=app.exportsOf('src/core/navigation.js');
    setView('home');assert.match(app.element('#feed').innerHTML,/<button class="profile-avatar-link"[^>]+data-profile-handle="@aribloom"/);
    setView('reels');assert.match(app.element('#reels-feed').innerHTML,/<button class="profile-avatar-link"[^>]+data-profile-handle="@[^"]+"/);
});
test('Story creator header points to its current author, closes playback, and opens the correct profile',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
    app.element('.story-reply-form').reset=()=>{};const stories=app.exportsOf('src/features/stories.js');stories.openStoryGroup('@aribloom');
    const header=app.element('.story-viewer .story-author-profile');
    assert.equal(header.dataset.profileHandle,'@aribloom');
    const clicked={dataset:{profileHandle:'@aribloom'},closest:selector=>selector==='.story-viewer'?{}:null};
    const handled=app.exportsOf('src/features/profile.events.js').handleAuthorClick({target:{closest:selector=>selector==='[data-profile-handle]'?clicked:null}});
    assert.equal(handled,true);assert.equal(state.currentView,'profile');assert.equal(state.profileHandle,'@aribloom');
    assert.equal(app.element('.story-viewer-backdrop').hidden,true);assert.equal(state.activeStorySequence.length,0);
});
