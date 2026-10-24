import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('module graph boots and all five screens render', async () => {
    const app = await loadApp();
    const {setView} = app.exportsOf('src/core/navigation.js');
    const {state} = app.exportsOf('src/core/state.js');
    for (const [view, selector, text] of [
        ['home', '#feed', 'Ari Bloom'],
        ['explore', '#explore-grid', 'explore-thumbnail'],
        ['reels', '#reels-feed', 'reel-card'],
        ['messages', '#messages-list', 'Laia Moreau'],
        ['profile', '#profile-view', '@mila_rose']
    ]) {
        setView(view);
        assert.equal(state.currentView, view);
        assert.equal(app.element(selector).hidden, false);
        assert.ok(app.element(selector).innerHTML.includes(text));
    }
    assert.equal(app.element('#feed').hidden, true);
});

test('Home follows accounts chronologically; hashtag follows do not inject posts', async () => {
    const app = await loadApp();
    const {getHomeFeedItems} = app.exportsOf('src/features/home.js');
    const {toggleSessionFollow} = app.exportsOf('src/features/follows.js');
    const ids = () => Array.from(getHomeFeedItems(), item => item.id);
    assert.deepEqual(ids(), [1, 2, 7, 8]);
    toggleSessionFollow('account', '@lenahart');
    assert.deepEqual(ids(), [1, 2, 3, 7, 8, 101]);
    toggleSessionFollow('account', '@lenahart');
    assert.deepEqual(ids(), [1, 2, 7, 8]);
    toggleSessionFollow('hashtag', 'travel');
    assert.ok(!ids().includes(102));
    assert.ok(!ids().includes(6));
});

test('saved IDs and joined communities round-trip through browser storage', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const storage = app.exportsOf('src/storage/browser-storage.js');
    state.savedItems.add(storage.getSavedItemKey('post', 1));
    state.joinedCommunityIds.add('travel-stories');
    assert.equal(storage.persistSavedItems(), true);
    assert.equal(storage.persistJoinedCommunities(), true);
    assert.deepEqual(Array.from(storage.loadSavedItems()), ['post:1']);
    assert.deepEqual(Array.from(storage.loadJoinedCommunities()), ['travel-stories']);
    app.storage.set('insta-saved-items', '{broken');
    assert.equal(storage.loadSavedItems().size, 0);
    assert.equal(state.savedStorageWarning, true);
});

test('message composition updates the conversation and escapes text in the rendered chat', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {conversations} = app.exportsOf('src/data/sample-data.js');
    const {appendChatMessage, getConversationPreview} = app.exportsOf('src/features/messages.js');
    const chat = conversations[0];
    const previousCount = chat.messages.length;
    state.activeConversationHandle = chat.handle;
    appendChatMessage(chat, {type: 'text', from: 'me', text: '<script>hello</script>'});
    assert.equal(chat.messages.length, previousCount + 1);
    assert.equal(getConversationPreview(chat), 'You: <script>hello</script>');
    assert.ok(app.element('#messages-list').innerHTML.includes('&lt;script&gt;hello&lt;/script&gt;'));
    assert.ok(!app.element('#messages-list').innerHTML.includes('<script>'));
});

test('post comments update the entity and likes toggle correctly', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {posts} = app.exportsOf('src/data/sample-data.js');
    const {handleCommentSubmit} = app.exportsOf('src/features/comments.js');
    const {setEntityLiked} = app.exportsOf('src/features/likes.js');
    const post = posts[0];
    state.activeCommentEntity = {type: 'post', id: post.id};
    const form = {closest: () => null, elements: {comment: {value: 'A useful comment'}}, reset() {}};
    handleCommentSubmit({target: {closest: () => form}, preventDefault() {}});
    assert.equal(post.comments, 75);
    assert.equal(post.commentItems.at(-1).text, 'A useful comment');
    setEntityLiked('post', post, false);
    assert.equal(post.likes, 1833);
    setEntityLiked('post', post, true);
    assert.equal(post.likes, 1834);
});

test('delegated navigation and create actions preserve click priority', async () => {
    const app = await loadApp();
    const click = app.listeners.find(item => item.key === 'document' && item.type === 'click' && item.callback.toString().includes('clickHandlers')).callback;
    const {state} = app.exportsOf('src/core/state.js');
    const targetFor = mapping => ({closest: selector => mapping[selector] ?? null});
    click({target: targetFor({'[data-view]': {dataset: {view: 'messages'}}})});
    assert.equal(state.currentView, 'messages');
    click({target: targetFor({'.create-button': {}})});
    assert.equal(app.element('.create-menu-backdrop').hidden, false);
    click({target: targetFor({'[data-create-type]': {dataset: {createType: 'reel'}}})});
    assert.equal(state.createMediaType, 'reel');
    assert.equal(app.element('.create-upload-backdrop').hidden, false);
});


test('comment preview prioritizes followed people but popup is purely newest-first', async () => {
    const app = await loadApp();
    const { prioritizedComments, renderCommentsDialog } = app.exportsOf('src/features/comments.js');
    const entity = { commentItems: [
        {handle:'@stranger',text:'latest outsider',createdAt:300,followsMe:true},
        {handle:'@aribloom',text:'older followed',createdAt:100},
        {handle:'@other',text:'middle outsider',createdAt:200}
    ] };
    assert.equal(prioritizedComments(entity)[0].handle, '@aribloom');
    renderCommentsDialog(entity);
    const html = app.element('.comments-dialog-list').innerHTML;
    assert.ok(html.indexOf('latest outsider') < html.indexOf('middle outsider'));
    assert.ok(html.indexOf('middle outsider') < html.indexOf('older followed'));
});

test('private media can only be shared to approved followers', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {canViewMedia, getAccount} = app.exportsOf('src/core/social.js');
    const privatePost = {handle:'@aribloom',public:false};
    getAccount('@aribloom').isPrivate = true;
    assert.equal(canViewMedia(privatePost), true);
    assert.equal(canViewMedia(privatePost, '@laia.m'), false);
    getAccount('@laia.m').following.push('@aribloom');
    assert.equal(canViewMedia(privatePost, '@laia.m'), true);
    state.blockedHandles.add('@aribloom');
    assert.equal(canViewMedia(privatePost), false);
});

test('draft expiry is exactly seven days from most recent save', async () => {
    const app = await loadApp();
    const {unexpiredDrafts} = app.exportsOf('src/storage/local-session.js');
    const now = 10 * 86400000;
    assert.deepEqual(Array.from(unexpiredDrafts([{id:1,savedAt:now-7*86400000},{id:2,savedAt:now-7*86400000+1},{id:3}],now), item=>item.id), [2]);
});

test('published carousel renderer keeps mixed items within a stable frame', async () => {
    const app = await loadApp();
    const {renderMedia} = app.exportsOf('src/components/post-card.js');
    const html = renderMedia({id:88,user:'Test',mediaItems:[{type:'image',url:'photo.jpg',fit:'contain',x:50,y:50},{type:'video',url:'clip.mp4',fit:'cover',x:20,y:40}]});
    assert.ok(html.includes('carousel-slides'));
    assert.ok(html.includes('1 of 2'));
    assert.ok(html.includes('2 of 2'));
    assert.ok(html.includes('object-fit:contain'));
    assert.ok(html.includes('object-position:20% 40%'));
});

test('Explore ranks public photo/video posts by views and labels hourly updates', async () => {
    const app = await loadApp();
    const {setView} = app.exportsOf('src/core/navigation.js');
    const {state} = app.exportsOf('src/core/state.js');
    setView('explore');
    assert.deepEqual(Array.from(state.activeExplorePosts, post => post.id), [3, 5, 8, 2, 1, 4, 7]);
    assert.match(app.element('#view-heading').textContent, /ranked by views.*updates hourly/);
    assert.ok(!state.activeExplorePosts.some(post => post.reel || !post.public));
    assert.ok(app.element('#explore-grid').innerHTML.includes('explore-view-count'));
});

test('Explore hashtag counts include public posts but exclude Reels', async () => {
    const app = await loadApp();
    const {getPublicHashtags} = app.exportsOf('src/features/explore.js');
    const nightwalk = getPublicHashtags().find(tag => tag.name.toLowerCase() === 'nightwalk');
    assert.equal(nightwalk?.count, 1);
    assert.ok(!getPublicHashtags().some(tag => tag.name.toLowerCase() === 'travel'));
});
