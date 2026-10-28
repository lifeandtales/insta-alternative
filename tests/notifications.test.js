import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('opening the bell marks existing notices read, persists them, and keeps the list',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{currentUser}=app.exportsOf('src/data/sample-data.js');
    const notifications=app.exportsOf('src/features/notifications.js');
    state.localStoryNotifications=[
        {recipient:currentUser.handle,storyId:'one',actor:'@aribloom',read:false,demo:false},
        {recipient:currentUser.handle,storyId:'two',actor:'@noahvale',read:false,kind:'story-mention'},
        {recipient:'@noahvale',storyId:'other',actor:'@aribloom',read:false}
    ];
    const badge=app.element('.home-notifications .notification-badge');notifications.updateNotificationBadge();assert.equal(badge.textContent,'2');
    notifications.openNotifications(app.element('.home-notifications'));
    assert.equal(badge.hidden,true);assert.equal(badge.textContent,'');assert.equal(app.element('.home-notifications').getAttribute('aria-label'),'Notifications');
    assert.equal(state.localStoryNotifications[0].read,true);assert.equal(state.localStoryNotifications[1].read,true);assert.equal(state.localStoryNotifications[2].read,false);
    assert.match(app.element('.notifications-content').innerHTML,/data-story-notice="one"/);assert.match(app.element('.notifications-content').innerHTML,/data-story-notice="two"/);
    const saved=JSON.parse(app.storage.get('insta-preferences-v1'));assert.equal(saved.localStoryNotifications[0].read,true);
    notifications.closeNotifications();notifications.openNotifications(app.element('.home-notifications'));assert.equal(badge.hidden,true);
    notifications.recordIncomingStoryLike({id:'new',handle:currentUser.handle},{handle:'@aribloom',name:'Ari Bloom'});
    assert.equal(badge.hidden,false);assert.equal(badge.textContent,'1');
    notifications.closeNotifications();notifications.openNotifications(app.element('.home-notifications'));assert.equal(badge.hidden,true);
});

test('Notifications is a page in browser history and Back restores Home',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js');
    const notifications=app.exportsOf('src/features/notifications.js');
    notifications.openNotifications(app.element('.home-notifications'));
    assert.equal(state.currentView,'notifications');assert.equal(app.element('#notifications-page').hidden,false);assert.equal(app.element('#feed').hidden,true);
    assert.equal(app.context.window.history.state.instaApp.view,'notifications');assert.equal(app.element('body').classList.contains('notifications-open'),true);
    notifications.closeNotifications();assert.equal(state.currentView,'home');assert.equal(app.element('#notifications-page').hidden,true);assert.equal(app.element('#feed').hidden,false);
    assert.equal(app.element('body').classList.contains('notifications-open'),false);
});

test('a notification Story opens over the page and browser Back returns to the notification list',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js');
    const notifications=app.exportsOf('src/features/notifications.js');app.element('.story-reply-form').reset=()=>{};
    notifications.openNotifications(app.element('.home-notifications'));
    const click=app.listeners.find(l=>l.key==='#notifications-page'&&l.type==='click').callback;
    click({target:{closest:selector=>selector==='[data-story-notice]'?{dataset:{storyNotice:'ari-story-mention-demo'}}:null}});
    assert.equal(state.currentView,'notifications');assert.equal(app.element('.story-viewer-backdrop').hidden,false);
    app.context.window.history.back();assert.equal(app.element('.story-viewer-backdrop').hidden,true);assert.equal(state.currentView,'notifications');assert.equal(app.element('#notifications-page').hidden,false);
    notifications.closeNotifications();assert.equal(state.currentView,'home');
});

test('notification types share one newest-first list and missing times sort last',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{currentUser,conversations}=app.exportsOf('src/data/sample-data.js');
    conversations.forEach(chat=>chat.unread=false);
    state.incomingFollowRequests=['@aribloom'];state.localApprovalNotices=[{recipient:currentUser.handle,createdAt:300}];
    state.localStoryNotifications=[{recipient:currentUser.handle,actor:'@aribloom',storyId:'older',createdAt:100},{recipient:currentUser.handle,actor:'@noahvale',storyId:'latest',createdAt:500}];
    const notifications=app.exportsOf('src/features/notifications.js'),items=notifications.availableLocalNotifications();
    assert.equal(items[0].storyId,'latest');assert.equal(items[1].title,'Follow request approved');assert.equal(items[2].storyId,'older');assert.equal(items.at(-1).title,'Follow request');
});

test('notification ages switch from now to minutes, hours and days at the requested boundaries',async()=>{
    const app=await loadApp(),{formatNotificationAge}=app.exportsOf('src/features/notifications.js');
    const now=1792738800000;
    for(const [seconds,label]of [[0,'Just now'],[59,'Just now'],[60,'1 minute ago'],[120,'2 minutes ago'],[3599,'59 minutes ago'],[3600,'1 hour ago'],[7200,'2 hours ago'],[86399,'23 hours ago'],[86400,'1 day ago'],[259200,'3 days ago']])assert.equal(formatNotificationAge(now-seconds*1000,now),label);
    assert.equal(formatNotificationAge(0,now),'');assert.equal(formatNotificationAge(now+60000,now),'Just now');
});

test('Story notices show a relative time beside the title and a square media link without an extra View story line',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{currentUser}=app.exportsOf('src/data/sample-data.js');
    state.localStoryNotifications=[{recipient:currentUser.handle,storyId:'ari-story-mention-demo',actor:'@aribloom',actorName:'Ari Bloom',kind:'story-mention',createdAt:1792738800000-120000,demo:true}];
    app.exportsOf('src/features/notifications.js').openNotifications(app.element('.home-notifications'));
    const html=app.element('.notifications-content').innerHTML;
    assert.match(html,/<strong>Story mention<\/strong><time[^>]*>2 minutes ago<\/time>/);
    assert.match(html,/data-story-notice="ari-story-mention-demo"[^>]*><img/);
    assert.doesNotMatch(html,/>View story<\/button>/);
});

test('an incoming Story like notifies once and retains that exact Story thumbnail after removal',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{currentUser}=app.exportsOf('src/data/sample-data.js');
    state.localStoryNotifications=[];
    const notifications=app.exportsOf('src/features/notifications.js');
    const story={id:'liked-photo',handle:currentUser.handle,user:currentUser.name,type:'image',media:'liked-photo.jpg',expiresAt:1792738800000+3600000};
    state.stories.push(story);
    assert.equal(notifications.recordIncomingStoryLike(story,{handle:'@noahvale',name:'Noah Vale'}),true);
    assert.equal(notifications.recordIncomingStoryLike(story,{handle:'@noahvale',name:'Noah Vale'}),false);
    assert.equal(state.localStoryNotifications.length,1);assert.equal(state.localStoryNotifications[0].storyPreview.media,'liked-photo.jpg');
    notifications.openNotifications(app.element('.home-notifications'));
    let html=app.element('.notifications-content').innerHTML;
    assert.match(html,/data-story-notice="liked-photo"[^>]*><img src="liked-photo.jpg"/);
    state.stories=state.stories.filter(item=>item.id!==story.id);
    notifications.renderNotificationsPage();html=app.element('.notifications-content').innerHTML;
    assert.match(html,/data-story-notice="liked-photo"[^>]*disabled><img src="liked-photo.jpg"/);
    const saved=JSON.parse(app.storage.get('insta-preferences-v1'));assert.equal(saved.localStoryNotifications[0].storyPreview.media,'liked-photo.jpg');
});
