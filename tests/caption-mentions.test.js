import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-harness.js';

test('valid caption mentions are clickable and preserve case, punctuation and escaping',async()=>{
    const app=await loadApp(),{renderCaption,captionMentions}=app.exportsOf('src/components/caption.js');
    const html=renderCaption('Hello @AriBloom, <script> & @noahvale.');
    assert.match(html,/data-profile-handle="@aribloom"/);assert.match(html,/>@AriBloom<\/button>,/);assert.match(html,/@noahvale<\/button>\./);assert.match(html,/&lt;script&gt; &amp;/);
    assert.equal(captionMentions('mail@aribloom @unknown @aribloom_extra').length,0);
});

test('blocked accounts stay plain text and live caption highlighting has no hidden buttons',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{renderCaption}=app.exportsOf('src/components/caption.js');
    assert.match(renderCaption('Hello @aribloom',{interactive:false}),/<span class="caption-mention">@aribloom<\/span>/);
    assert.doesNotMatch(renderCaption('@aribloom',{interactive:false}),/<button/);
    state.blockedHandles.add('@aribloom');assert.equal(renderCaption('@aribloom'),'@aribloom');
});

test('caption mentions notify without adding photo tags; explicit tags populate the tagged section',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{posts,currentUser}=app.exportsOf('src/data/sample-data.js'),{recordPostMentions,availableLocalNotifications}=app.exportsOf('src/features/notifications.js'),{getProfileMediaCollection}=app.exportsOf('src/features/profile.js');
    state.localStoryNotifications=[];state.profileHandle=currentUser.handle;state.activeProfileSection='tags';
    const captionOnly={...posts[0],id:99881,caption:`Hi ${currentUser.handle}`,taggedUsers:[]};posts.unshift(captionOnly);
    assert.equal(recordPostMentions(captionOnly),1);assert.equal(recordPostMentions(captionOnly),0);
    assert.equal(availableLocalNotifications().filter(notice=>notice.kind==='post-mention'&&notice.postId===99881).length,1);
    assert.equal(getProfileMediaCollection().some(entry=>entry.entity.id===99881),false);
    const tagged={...posts[1],id:99882,caption:`Hi ${currentUser.handle}`,taggedUsers:[currentUser.handle]};posts.unshift(tagged);
    assert.equal(recordPostMentions(tagged),1);
    assert.equal(state.localStoryNotifications.filter(notice=>notice.postId===99882).length,1);assert.equal(state.localStoryNotifications.find(notice=>notice.postId===99882).kind,'post-tag');
    assert.equal(getProfileMediaCollection().some(entry=>entry.entity.id===99882),true);
});

test('tagged posts and notification thumbnails do not grant access to private content',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{posts,currentUser}=app.exportsOf('src/data/sample-data.js'),{recordPostMentions,renderNotificationsPage}=app.exportsOf('src/features/notifications.js'),{getProfileMediaCollection}=app.exportsOf('src/features/profile.js');
    const account=state.accountDirectory.find(person=>person.handle==='@aribloom');account.isPrivate=true;state.followedAccountHandles.delete('@aribloom');posts.filter(post=>post.handle==='@aribloom').forEach(post=>post.followed=false);
    const tagged={...posts[0],id:99883,handle:'@aribloom',public:false,caption:'Private post',taggedUsers:[currentUser.handle]};posts.unshift(tagged);
    state.localStoryNotifications=[];recordPostMentions(tagged);state.profileHandle=currentUser.handle;state.activeProfileSection='tags';
    assert.equal(getProfileMediaCollection().some(entry=>entry.entity.id===99883),false);
    renderNotificationsPage();assert.match(app.element('.notifications-content').innerHTML,/Post unavailable/);
    state.followedAccountHandles.add('@aribloom');assert.equal(getProfileMediaCollection().some(entry=>entry.entity.id===99883),true);
});
