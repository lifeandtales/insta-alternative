import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('Story text renders independent clickable hashtag and mention tokens', async () => {
    const app = await loadApp();
    const stage = app.element('.story-selected-preview'), nodes = [];
    stage.ownerDocument = app.document;
    stage.querySelector = () => null;
    stage.querySelectorAll = () => [];
    stage.append = node => nodes.push(node);
    let n = 0;
    app.document.createTextNode = text => ({textContent:text});
    app.document.createElement = tag => app.element(`token-${tag}-${n++}`);
    app.exportsOf('src/features/story-composition.js').applyStoryComposition(stage, { edits: { layers: [{ id:'mixed',type:'text',text:'Hello @mila_rose #idea #idéa',mentions:[{handle:'@mila_rose'}] }] } });
    const children = nodes[0].children;
    assert.deepEqual(children.filter(item => item.dataset?.storyHashtag).map(item => item.dataset.storyHashtag), ['idea', 'idéa']);
    assert.equal(children.find(item => item.dataset?.storyMentionHandle)?.textContent, '@mila_rose');
});

test('hashtag results match exact tags across posts and active Stories while enforcing privacy and expiry', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { posts, currentUser } = app.exportsOf('src/data/sample-data.js');
    const now = 1792738800000;
    state.accountDirectory.push({id:'private-tag',handle:'@private_tag',name:'Private',isPrivate:true,following:[],followers:[]});
    posts.push({id:9001,handle:'@aribloom',user:'Ari Bloom',caption:'#Idea',public:true,createdAt:now});
    posts.push({id:9002,handle:'@aribloom',caption:'#ideas',public:true,createdAt:now});
    posts.push({id:9003,handle:'@private_tag',caption:'#idea',public:false,createdAt:now});
    const edits = {layers:[{type:'text',text:'#idea'}]};
    state.stories = [
        {id:'visible',handle:'@aribloom',user:'Ari Bloom',edits,expiresAt:now+1000},
        {id:'expired',handle:'@aribloom',edits,expiresAt:now-1},
        {id:'private',handle:'@private_tag',edits,expiresAt:now+1000},
        {id:'private-repost',handle:currentUser.handle,repostedStoryId:'private',repostedFromHandle:'@private_tag',repostedFromUser:'Private',edits,expiresAt:now+1000}
    ];
    const {getHashtagResults} = app.exportsOf('src/features/explore.js');
    let results = getHashtagResults('#IDEA', now);
    assert.deepEqual(Array.from(results.posts, item => item.id), [9001]);
    assert.deepEqual(Array.from(results.stories, item => item.id), ['visible']);
    state.followedAccountHandles.add('@private_tag');
    results = getHashtagResults('idea', now);
    assert.ok(!results.posts.some(item => item.id === 9003), 'following a private account does not make its content public');
    assert.ok(!results.stories.some(item => item.id === 'private'));
    state.blockedHandles.add('@private_tag');
    assert.deepEqual(Array.from(getHashtagResults('idea', now).stories, item => item.id), ['visible']);
});

test('hashtag confirmation opens the combined page and public Story results work without following', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    state.accountDirectory.push({id:'public-tag',handle:'@public_tag',name:'Public',isPrivate:false,following:[],followers:[]});
    state.stories = [{id:'public-idea',handle:'@public_tag',user:'Public',avatar:'avatar.png',type:'image',media:'image.png',edits:{layers:[{type:'text',text:'#idea'}]},expiresAt:Date.now()+86400000}];
    app.exportsOf('src/features/stories.events.js').handleStoryClick({target:{closest:selector => selector === '[data-story-hashtag-open]' ? {dataset:{storyHashtagOpen:'idea'}} : null}});
    assert.equal(state.currentView, 'explore');
    assert.equal(state.activeExploreFilter.value, 'idea');
    assert.match(app.element('#community-view').innerHTML, /Stories with this hashtag/);
    assert.match(app.element('#community-view').innerHTML, /Posts with this hashtag/);
    assert.match(app.element('#community-view').innerHTML, /data-hashtag-stories="idea"/);
    assert.equal((app.element('#community-view').innerHTML.match(/data-hashtag-stories=/g) || []).length, 1);
    app.element('.story-reply-form').reset = () => {};
    app.exportsOf('src/features/explore.events.js').handleExploreClick({target:{closest:selector => selector === '[data-hashtag-stories]' ? {dataset:{hashtagStories:'idea'}} : null}});
    assert.equal(state.activeStorySequence[state.activeStoryIndex].id, 'public-idea');
    assert.equal(app.element('.story-viewer-backdrop').hidden, false);
});

test('the hashtag icon plays matching Stories across accounts and returns to the hashtag page', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {currentUser} = app.exportsOf('src/data/sample-data.js');
    const now = 1792738800000;
    const make = (id, handle, tag, createdAt) => ({id,handle,user:handle,avatar:'avatar.png',type:'image',media:'fixture.png',createdAt,expiresAt:now+10000,edits:{layers:[{type:'text',text:`#${tag}`}]} });
    state.stories = [make('ari-new','@aribloom','idea',now-1),make('noah','@noahvale','idea',now-2),make('ari-old','@aribloom','idea',now-3),make('unrelated','@aribloom','other',now)];
    state.activeExploreFilter = {type:'hashtag',value:'idea'};
    app.exportsOf('src/core/navigation.js').setView('explore');
    app.element('.story-reply-form').reset = () => {};
    const stories = app.exportsOf('src/features/stories.js');
    assert.equal(stories.openHashtagStories('idea', app.exportsOf('src/features/explore.js').renderExplore), true);
    assert.deepEqual(Array.from(state.activeStorySequence, item => item.id), ['ari-new','noah','ari-old']);
    stories.showStoryAtIndex(1);
    assert.equal(state.activeStorySequence[state.activeStoryIndex].handle, '@noahvale');
    stories.showStoryAtIndex(0);
    assert.equal(state.activeStorySequence[state.activeStoryIndex].id, 'ari-new');
    stories.showStoryAtIndex(2);
    stories.showStoryAtIndex(3);
    assert.equal(app.element('.story-viewer-backdrop').hidden, true);
    assert.equal(state.currentView, 'explore');
    assert.equal(state.activeExploreFilter.value, 'idea');
    assert.match(app.element('#community-view').innerHTML, /hashtag-story-ring seen/);
    assert.equal(state.seenStoryIds.has('unrelated'), false);
});

test('the public hashtag sequence skips newly expired Stories and ignores uploads older than 24 hours', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const now = 1792738800000;
    const make = (id, createdAt) => ({id,handle:'@aribloom',user:'Ari Bloom',avatar:'a.png',type:'image',media:'fixture.png',createdAt,edits:{layers:[{type:'text',text:'#idea'}]}});
    state.stories = [make('first',now-1),make('expires-next',now-2),make('third',now-3),make('too-old',now-25*3600000)];
    app.element('.story-reply-form').reset = () => {};
    const stories = app.exportsOf('src/features/stories.js');
    stories.openHashtagStories('idea');
    state.stories.find(item => item.id === 'expires-next').expiresAt = now-1;
    stories.showStoryAtIndex(1);
    assert.deepEqual(Array.from(state.activeStorySequence, item => item.id), ['first','third']);
    assert.equal(state.activeStorySequence[state.activeStoryIndex].id, 'third');
});
