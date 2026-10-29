import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-harness.js';

test('story long press opens options and consumes the release click, while movement cancels it',async()=>{
    const app=await loadApp(),shortcuts=app.exportsOf('src/features/story-shortcuts.js'),handlers={},timers=new Map();let next=0,opened=0;
    const button={dataset:{storyOwner:'@aribloom'},isConnected:true};
    shortcuts.bindStoryLongPress({addEventListener:(type,fn)=>handlers[type]=fn},()=>{opened++;return true;},{setTimer:(fn,delay)=>{assert.equal(delay,500);timers.set(++next,fn);return next;},clearTimer:id=>timers.delete(id)});
    const event=(x=0,y=0)=>({target:{closest:()=>button},pointerId:1,button:0,clientX:x,clientY:y});
    handlers.pointerdown(event());handlers.pointermove(event(20,0));assert.equal(timers.size,0);assert.equal(opened,0);
    handlers.pointerdown(event());[...timers.values()][0]();handlers.pointerup(event());assert.equal(opened,1);assert.equal(shortcuts.consumeStoryHoldClick('@aribloom'),true);assert.equal(shortcuts.consumeStoryHoldClick('@aribloom'),false);
    handlers.pointerdown(event());handlers.pointercancel(event());assert.equal(timers.size,0);
});

test('shortcut offers Unmute for muted stories and never offers own-story muting',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{currentUser}=app.exportsOf('src/data/sample-data.js'),shortcuts=app.exportsOf('src/features/story-shortcuts.js');
    const button={dataset:{storyOwner:'@aribloom'}};
    assert.equal(shortcuts.openStoryShortcut(button),true);assert.match(app.element('.home-panel-content').innerHTML,/>Mute stories</);
    state.mutedStoryHandles.add('@aribloom');shortcuts.openStoryShortcut(button);assert.match(app.element('.home-panel-content').innerHTML,/>Unmute stories</);
    assert.equal(shortcuts.openStoryShortcut({dataset:{storyOwner:currentUser.handle}}),false);
});

test('Home shortcut persists mute and unmute without changing follow or post-mute preferences',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{toggleStoryShortcut}=app.exportsOf('src/features/story-shortcuts.js');
    state.mutedStoryHandles.delete('@aribloom');const followed=state.followedAccountHandles.has('@aribloom'),postsMuted=state.mutedPostHandles.has('@aribloom');
    assert.equal(toggleStoryShortcut('@aribloom'),true);assert.equal(state.mutedStoryHandles.has('@aribloom'),true);
    assert.ok(JSON.parse(app.storage.get('insta-preferences-v1')).mutedStoryHandles.includes('@aribloom'));
    assert.equal(toggleStoryShortcut('@aribloom'),true);assert.equal(state.mutedStoryHandles.has('@aribloom'),false);assert.equal(state.followedAccountHandles.has('@aribloom'),followed);assert.equal(state.mutedPostHandles.has('@aribloom'),postsMuted);
});
