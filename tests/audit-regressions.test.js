import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('keyboard playback cannot bypass sensitive content approval or age access', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {reels} = app.exportsOf('src/data/sample-data.js');
    const playback = app.exportsOf('src/media/video.js');
    reels[0].sensitive = true;
    let plays = 0;
    const media = {dataset: {likeableId: String(reels[0].id), likeableType: 'reel'}};
    const video = {paused: true, isConnected: true, play: () => {plays++; return Promise.resolve();}, closest: selector => selector === '.likeable-media' ? media : selector === '.reel-card' ? {} : null, matches: selector => selector === 'video'};
    const event = {key: 'Enter', target: video, preventDefault() {}};
    const keyboard = app.listeners.filter(item => item.key === 'document' && item.type === 'keydown');
    for (const listener of keyboard) listener.callback(event);
    assert.equal(plays, 0);
    assert.equal(playback.canPlayInlineVideo(video), false);
    state.revealedMediaKeys.add(`reel:${reels[0].id}`);
    for (const listener of keyboard) listener.callback(event);
    assert.equal(plays, 1);
    state.viewerAgeBand = 'minor';
    assert.equal(playback.canPlayInlineVideo(video), false);
});

test('private direct-account photos are hidden in inbox and open conversation', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {conversations} = app.exportsOf('src/data/sample-data.js');
    const {getAccount, DEFAULT_AVATAR} = app.exportsOf('src/core/social.js');
    const messages = app.exportsOf('src/features/messages.js');
    const chat = conversations[0];
    getAccount(chat.handle).isPrivate = true;
    chat.avatar = getAccount(chat.handle).avatar = 'private-photo-sentinel';
    assert.equal(messages.conversationAvatar(chat), DEFAULT_AVATAR);
    messages.renderMessages();
    assert.ok(!app.element('#messages-list').innerHTML.includes('private-photo-sentinel'));
    state.activeConversationHandle = chat.handle;
    messages.renderMessages();
    assert.ok(!app.element('#messages-list').innerHTML.includes('private-photo-sentinel'));
    state.followedAccountHandles.add(chat.handle);
    assert.equal(messages.conversationAvatar(chat), 'private-photo-sentinel');
});

test('sensitive shared-card previews are obscured before adult opt-in and unavailable to minors', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {conversations, posts} = app.exportsOf('src/data/sample-data.js');
    const chat = conversations[0];
    posts[0].sensitive = true;
    chat.messages = [{type:'shared-post', entityType:'post', entityId:posts[0].id, from:'them'}];
    state.activeConversationHandle = chat.handle;
    const {renderMessages} = app.exportsOf('src/features/messages.js');
    renderMessages();
    assert.match(app.element('#messages-list').innerHTML, /sensitive-preview/);
    assert.match(app.element('#messages-list').innerHTML, /Sensitive content obscured/);
    state.viewerAgeBand = 'minor'; renderMessages();
    assert.match(app.element('#messages-list').innerHTML, /shared post is unavailable/);
});

test('pending accounts cannot change post menus, edit media, archive highlights or join communities', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {posts, currentUser} = app.exportsOf('src/data/sample-data.js');
    state.verificationStatus = 'pending';
    const options = app.exportsOf('src/features/media-options.js');
    for (const action of ['hide','mute-posts','mute-stories','report','edit','delete']) options.handlePostOption(action, posts[0], 'post', null);
    assert.equal(state.hiddenPostKeys.size, 0);
    assert.equal(state.mutedPostHandles.size, 0);
    assert.equal(state.reportingMedia, undefined);
    app.exportsOf('src/features/profile.js').openMediaEditor('post', posts.find(post=>post.mine));
    assert.equal(state.activeMediaEdit, null);
    const highlight = {id:'pending-highlight',handle:currentUser.handle,stories:[],archived:false};
    state.storyHighlights.push(highlight);
    await app.exportsOf('src/features/highlights.js').archiveStoryHighlight(highlight.id);
    assert.equal(highlight.archived, false);
    const button = {dataset:{communityJoin:'travel-stories'}};
    app.exportsOf('src/features/explore.events.js').handleExploreClick({target:{closest:selector=>selector === '[data-community-join]' ? button : null}});
    assert.equal(state.joinedCommunityIds.size, 0);
});

test('tagged Profile accepts legacy and canonical handles and survives username updates', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {posts, currentUser} = app.exportsOf('src/data/sample-data.js');
    posts[0].taggedUsers = ['mila_rose']; posts[0].taggedHandles = ['mila_rose'];
    state.profileHandle = currentUser.handle; state.activeProfileSection = 'tags';
    const profile = app.exportsOf('src/features/profile.js');
    profile.renderProfile();
    assert.match(app.element('#profile-view').innerHTML, /data-profile-media-id="1"/);
    const error = app.exportsOf('src/features/account-model.js').updateOwnProfile({name:currentUser.name, username:'mila_tagged', bio:'', links:[]});
    assert.equal(error, '');
    assert.equal(posts[0].taggedUsers[0], '@mila_tagged');
    assert.equal(posts[0].taggedHandles[0], '@mila_tagged');
    profile.renderProfile();
    assert.match(app.element('#profile-view').innerHTML, /data-profile-media-id="1"/);
    assert.equal(app.exportsOf('src/core/utils.js').normalizeHandle(' @MILA_TAGGED '), '@mila_tagged');
});

test('Close Friends Highlights use the owner audience and existing audience is preserved in picker', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {currentUser} = app.exportsOf('src/data/sample-data.js');
    const {visibleHighlightStories, getAccount} = app.exportsOf('src/core/social.js');
    const highlight = {id:'cf-highlight',handle:'@aribloom',title:'Friends',audience:'close-friends',closeFriendHandles:[currentUser.handle],stories:[{handle:'@aribloom',public:true,type:'image',media:'sample',caption:'hello'}]};
    getAccount('@aribloom').closeFriendHandles = [currentUser.handle];
    assert.equal(visibleHighlightStories(highlight).length, 1);
    getAccount('@aribloom').closeFriendHandles = ['@somebody_else'];
    assert.equal(visibleHighlightStories(highlight).length, 0);
    const own = {...highlight,id:'own-highlight',handle:currentUser.handle};
    state.storyHighlights.push(own);
    const listener = app.listeners.find(item=>item.key === '#highlight-existing' && item.type === 'change');
    app.element('#highlight-audience').value = 'all';
    listener.callback({target:{value:own.id}});
    assert.equal(app.element('#highlight-audience').value, 'close-friends');
});

test('reshared Stories recheck access to the original private post', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {posts} = app.exportsOf('src/data/sample-data.js');
    const social = app.exportsOf('src/core/social.js');
    const source = posts.find(post=>post.id === 6);
    const story = {handle:'@aribloom',public:true,audience:'all',sourcePostId:source.id};
    assert.equal(social.canViewStory(story), false);
    state.followedAccountHandles.add(source.handle);
    assert.equal(social.canViewStory(story), true);
    state.blockedHandles.add(source.handle);
    assert.equal(social.canViewStory(story), false);
});

test('Explore hashtag totals exclude content unavailable to the viewer', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {posts} = app.exportsOf('src/data/sample-data.js');
    posts[0].caption += ' #restricted_test'; posts[0].sensitive = true;
    state.viewerAgeBand = 'minor';
    const {getPublicHashtags} = app.exportsOf('src/features/explore.js');
    assert.ok(!Array.from(getPublicHashtags(), tag=>tag.name).includes('restricted_test'));
    state.viewerAgeBand = 'adult';
    assert.ok(Array.from(getPublicHashtags(), tag=>tag.name).includes('restricted_test'));
    state.blockedHandles.add(posts[0].handle);
    assert.ok(!Array.from(getPublicHashtags(), tag=>tag.name).includes('restricted_test'));
});

test('later Close Friends additions gain old Highlights and removals lose them', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {currentUser} = app.exportsOf('src/data/sample-data.js');
    const {visibleHighlightStories, getAccount} = app.exportsOf('src/core/social.js');
    const highlight = {handle:currentUser.handle,audience:'close-friends',closeFriendHandles:['@aribloom'],stories:[{handle:currentUser.handle,public:true,type:'image',media:'sample'}]};
    assert.equal(visibleHighlightStories(highlight, '@noahvale').length, 0);
    state.closeFriendHandles.add('@noahvale');
    assert.equal(visibleHighlightStories(highlight, '@noahvale').length, 1);
    state.closeFriendHandles.delete('@noahvale');
    assert.equal(visibleHighlightStories(highlight, '@noahvale').length, 0);
    const normal = {...highlight,audience:'all'};
    assert.equal(visibleHighlightStories(normal, '@noahvale').length, 1);
    state.closeFriendHandles.add('@private.creator');
    currentUser.isPrivate = true; getAccount(currentUser.handle).isPrivate = true;
    assert.equal(visibleHighlightStories(highlight, '@private.creator').length, 0);
});

test('one-day username hold permits its owner to reclaim but still enforces change limit', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {currentUser} = app.exportsOf('src/data/sample-data.js');
    const model = app.exportsOf('src/features/account-model.js');
    const original = currentUser.handle.slice(1);
    const profile = username => ({name:currentUser.name,username,bio:'',links:[]});
    assert.equal(model.updateOwnProfile(profile('mila_newname')), '');
    assert.equal(model.validateProfile(profile(original)), '');
    assert.equal(model.updateOwnProfile(profile(original)), '');
    assert.equal(state.usernameChanges, 2);
    state.reservedUsernames.push({handle:'@reserved_name',ownerId:'other-owner',expiresAt:Date.now()+86400000});
    assert.match(model.validateProfile(profile('reserved_name')), /reserved for its owner/);
    state.usernameChanges = 5;
    assert.match(model.validateProfile(profile('mila_newname')), /five lifetime/);
});
