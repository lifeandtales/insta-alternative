import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('opening the bell marks existing notices read, persists them, and keeps the list',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{currentUser}=app.exportsOf('src/data/sample-data.js');
    const notifications=app.exportsOf('src/features/notifications.js');
    state.localStoryNotifications=[
        {recipient:currentUser.handle,storyId:'one',actor:'@aribloom',read:false,demo:true},
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
