import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('Reels ranking uses engagement and recency and filters private, blocked and age-restricted media', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {reels} = app.exportsOf('src/data/sample-data.js');
    const {rankRecommendedReels, renderReels} = app.exportsOf('src/features/reels.js');
    const now = Date.now();
    const base = {...reels[0], createdAt: now, public: true, likes: 0, views: 0, watchTimeSeconds: 0};
    const candidates = [
        {...base, id: 701, views: 500, likes: 100, watchTimeSeconds: 5000},
        {...base, id: 702, views: 5, likes: 1, watchTimeSeconds: 5},
        {...base, id: 703, public: false, views: 900000}
    ];
    assert.deepEqual(Array.from(rankRecommendedReels(candidates, now), item => item.id), [701, 702]);
    const oldAndNew = [{...base, id: 801, createdAt: now - 30 * 86400000}, {...base, id: 802}];
    assert.equal(rankRecommendedReels(oldAndNew, now)[0].id, 802);
    reels[0].sensitive = true;
    renderReels();
    assert.match(app.element('#reels-feed').innerHTML, /reel-gated/);
    assert.match(app.element('#reels-feed').innerHTML, /data-reel-reveal/);
    state.viewerAgeBand = 'minor';
    assert.ok(!Array.from(rankRecommendedReels(), item => item.id).includes(reels[0].id));
    renderReels();
    assert.ok(!app.element('#reels-feed').innerHTML.includes('data-reel-reveal'));
    state.viewerAgeBand = 'adult'; state.blockedHandles.add(reels[1].handle);
    assert.ok(!Array.from(rankRecommendedReels(), item => item.id).includes(reels[1].id));
});

test('group membership follows each recipient preference and hides unaccepted history', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {currentUser} = app.exportsOf('src/data/sample-data.js');
    const {getAccount} = app.exportsOf('src/core/social.js');
    const access = app.exportsOf('src/features/message-access.js');
    getAccount('@noahvale').groupJoinMode = 'review';
    const group = access.createLocalGroup('Test group', ['@aribloom', '@noahvale']);
    assert.ok(group.members.includes('@aribloom'));
    assert.ok(!group.members.includes('@noahvale'));
    assert.deepEqual(Array.from(group.pendingMembers), ['@noahvale']);
    assert.deepEqual(Array.from(group.admins), [currentUser.handle]);
    state.groupJoinMode = 'review';
    const inbound = {handle: 'group:incoming', user: 'Incoming group', avatar: currentUser.avatar, members: ['@aribloom'], messages: [{type: 'text', from: 'them', text: 'PRIVATE_GROUP_HISTORY', sentAt: Date.now()}]};
    assert.equal(access.receiveLocalGroupInvitation(inbound, '@aribloom'), true);
    state.activeConversationHandle = inbound.handle;
    app.exportsOf('src/features/messages.js').renderMessages();
    assert.ok(!app.element('#messages-list').innerHTML.includes('PRIVATE_GROUP_HISTORY'));
    assert.equal(access.canSendToConversation(inbound), false);
    assert.equal(access.respondToGroupInvitation(inbound, true), true);
    assert.equal(access.canSendToConversation(inbound), true);
    app.exportsOf('src/features/messages.js').renderMessages();
    assert.match(app.element('#messages-list').innerHTML, /PRIVATE_GROUP_HISTORY/);
    state.blockedHandles.add('@aribloom');
    assert.equal(access.canSendToConversation(inbound), false);
});

test('pending accounts cannot like, save, message, create groups or follow but retain chat history', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {posts, conversations} = app.exportsOf('src/data/sample-data.js');
    state.verificationStatus = 'pending';
    const post = posts[0], before = post.liked;
    app.exportsOf('src/features/likes.js').setEntityLiked('post', post, !before);
    assert.equal(post.liked, before);
    const access = app.exportsOf('src/features/message-access.js');
    assert.equal(access.canSendToConversation(conversations[0]), false);
    assert.equal(access.createLocalGroup('No', ['@aribloom']), null);
    assert.equal(app.exportsOf('src/features/follows.js').toggleSessionFollow('hashtag', 'newtag'), false);
    const button = {dataset: {entityType: 'post', entityId: String(post.id)}};
    app.exportsOf('src/features/saved.events.js').handleSaveClick({target: {closest: () => button}});
    assert.equal(state.savedItems.size, 0);
    state.activeConversationHandle = conversations[0].handle;
    app.exportsOf('src/features/messages.js').renderMessages();
    assert.match(app.element('#messages-list').innerHTML, /That place looks amazing/);
    assert.ok(!app.element('#messages-list').innerHTML.includes('class="chat-composer"'));
});

test('username entry forms enforce 8–20 characters with no whitespace or required mix', async () => {
    const app = await loadApp();
    const submit = app.listeners.find(item => item.key === 'document' && item.type === 'submit' && String(item.callback).includes("form.dataset.entryForm === 'signup'")).callback;
    for (const mode of ['login', 'signup']) {
        for (const [username, valid] of [['abcdefgh', true], ['1'.repeat(20), true], ['........', true], ['________', true], ['a'.repeat(7), false], ['a'.repeat(21), false], [' abcdefgh', false], ['abcdefgh ', false], ['abcd efgh', false], ['abcd\tefgh', false]]) {
            const error = {textContent: '', hidden: true};
            const field = value => ({value, focus() {}});
            const form = {
                dataset: {entryForm: mode},
                elements: {username: field(username), password: field('sample-only'), confirmPassword: field('sample-only'), ageBand: field('adult')},
                querySelector: selector => selector === '.welcome-form-error' ? error : selector === '#signup-full-name' ? field('Demo Person') : {files: []}
            };
            app.element('.app-shell').hidden = true;
            submit({target: {closest: () => form}, preventDefault() {}});
            assert.equal(app.element('.app-shell').hidden, !valid, `${mode}: ${JSON.stringify(username)}`);
            assert.equal(Boolean(error.textContent), !valid);
        }
    }
});

test('profile validation counts emoji, rejects unsafe links, and keeps identities attached after username changes', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {currentUser, posts, conversations} = app.exportsOf('src/data/sample-data.js');
    const model = app.exportsOf('src/features/account-model.js');
    const profile = {name: 'Mila Updated', username: 'mila_updated', bio: '🙂'.repeat(200), links: ['https://example.com']};
    assert.equal(model.validateProfile(profile), '');
    assert.ok(model.validateProfile({...profile, bio: '🙂'.repeat(201)}));
    assert.ok(model.validateProfile({...profile, username: 'short'}));
    for (const username of ['abcdefgh', 'a'.repeat(20), '12345678', '1'.repeat(20), '........', '________', 'a1._a1._']) {
        assert.equal(model.validateProfile({...profile, username}), '', username);
    }
    for (const username of ['a'.repeat(7), 'a'.repeat(21), 'abc defgh', ' abcdefgh', 'abcdefgh ', 'abcd\tefgh', 'abcd\nefgh']) {
        assert.ok(model.validateProfile({...profile, username}), username);
    }
    const originalHandle = currentUser.handle;
    currentUser.handle = '@' + 'l'.repeat(25);
    assert.equal(model.validateProfile({...profile, username: 'l'.repeat(25)}), '');
    assert.ok(model.validateProfile({...profile, username: 'n'.repeat(25)}));
    currentUser.handle = originalHandle;
    assert.ok(model.validateProfile({...profile, links: ['javascript:alert(1)']}));
    const oldHandle = currentUser.handle;
    conversations.push({handle: 'group:identity', isGroup: true, members: [oldHandle], admins: [oldHandle], messages: []});
    assert.equal(model.updateOwnProfile(profile), '');
    assert.equal(currentUser.handle, '@mila_updated');
    assert.equal(posts.find(post => post.mine).handle, '@mila_updated');
    assert.ok(conversations.at(-1).members.includes('@mila_updated'));
    assert.equal(posts[3].commentItems[0].handle, '@mila_updated');
    assert.equal(state.usernameChanges, 1);
    assert.equal(state.reservedUsernames[0].handle, oldHandle);
    state.usernameChanges = 5;
    assert.match(model.validateProfile({...profile, username: 'mila_another'}), /five lifetime/);
});

test('private profiles conceal media and avatar; block preserves chats and unblock does not restore follows', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {conversations} = app.exportsOf('src/data/sample-data.js');
    const social = app.exportsOf('src/core/social.js');
    const model = app.exportsOf('src/features/account-model.js');
    state.profileHandle = '@nia.makes';
    app.exportsOf('src/features/profile.js').renderProfile();
    assert.ok(!app.element('#profile-view').innerHTML.includes('data-profile-media-id="6"'));
    assert.equal(app.exportsOf('src/features/profile.js').getProfileUser('@nia.makes').avatar, social.DEFAULT_AVATAR);
    const count = conversations.length;
    assert.equal(model.setAccountBlocked('@noahvale', true), true);
    assert.equal(conversations.length, count);
    assert.equal(social.isFollowing('@noahvale'), false);
    assert.equal(model.setAccountBlocked('@noahvale', false), true);
    assert.equal(social.isFollowing('@noahvale'), false);
    const followers = [...social.getAccount('@mila_rose').followers];
    model.setAccountPrivacy(true);
    assert.deepEqual(Array.from(social.getAccount('@mila_rose').followers), followers);
});
