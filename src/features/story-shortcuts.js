import { state } from '../core/state.js';
import { currentUser } from '../data/sample-data.js';
import { getAccount, mayInteract } from '../core/social.js';
import { escapeHtml } from '../core/utils.js';
import { persistPreferences } from '../storage/preferences.js';
import { showHomePanel, closeHomePanel } from './home-controls.js';
import { renderStories } from './stories.js';
import { showShareFeedback } from '../components/feedback.js';

let suppressedHandle=null,suppressedUntil=0;
export function consumeStoryHoldClick(handle) {
    if(handle!==suppressedHandle)return false;
    const suppress=Date.now()<=suppressedUntil;
    suppressedHandle=null;suppressedUntil=0;return suppress;
}
export function openStoryShortcut(button) {
    const handle=button?.dataset.storyOwner;
    if(!handle||handle===currentUser.handle||!mayInteract()||state.blockedHandles.has(handle))return false;
    const name=getAccount(handle)?.name||handle,muted=state.mutedStoryHandles.has(handle);
    showHomePanel(`${name}'s stories`,`<button type="button" class="story-shortcut-action" data-story-shortcut-toggle="${escapeHtml(handle)}">${muted?'Unmute stories':'Mute stories'}</button>`);
    return true;
}
export function bindStoryLongPress(list,open,{setTimer=(callback,delay)=>window.setTimeout(callback,delay),clearTimer=timer=>clearTimeout(timer)}={}) {
    let pending=null,timer=null;
    const finish=event=>{
        if(event&&pending&&event.pointerId!==undefined&&event.pointerId!==pending.id)return;
        clearTimer(timer);timer=null;
        if(pending?.opened)suppressedUntil=Date.now()+1000;
        pending=null;
    };
    list.addEventListener('pointerdown',event=>{
        if(pending){finish();return;}
        const button=event.target.closest('[data-story-owner]');
        if(!button||button.dataset.storyOwner===currentUser.handle||event.button>0)return;
        pending={button,id:event.pointerId,x:event.clientX,y:event.clientY,opened:false};
        timer=setTimer(()=>{
            if(!pending||!pending.button.isConnected)return;
            if(open(pending.button)!==false){pending.opened=true;suppressedHandle=pending.button.dataset.storyOwner;suppressedUntil=Infinity;}
        },500);
    });
    list.addEventListener('pointermove',event=>{
        if(!pending||event.pointerId!==pending.id)return;
        if(Math.hypot(event.clientX-pending.x,event.clientY-pending.y)>10&&!pending.opened)finish(event);
    },{passive:true});
    for(const name of ['pointerup','pointercancel','pointerleave','lostpointercapture'])list.addEventListener(name,finish);
    const context=event=>{
        const button=event.target.closest('[data-story-owner]');
        if(!button||button.dataset.storyOwner===currentUser.handle)return;
        event.preventDefault();
        if(pending?.opened)return;
        if(open(button)!==false){
            suppressedHandle=button.dataset.storyOwner;suppressedUntil=pending?Infinity:Date.now()+1000;
            if(pending){clearTimer(timer);timer=null;pending.opened=true;return;}
        }
        finish();
    };
    list.addEventListener('contextmenu',context);
    list.addEventListener('keydown',event=>{if(event.key==='ContextMenu'||(event.shiftKey&&event.key==='F10'))context(event);});
    return finish;
}
export function registerStoryShortcutEvents() {
    const cancel=bindStoryLongPress(document.getElementById('stories-list'),openStoryShortcut);
    window.addEventListener('blur',()=>cancel());
    document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
    document.addEventListener('click',event=>{
        const action=event.target.closest('[data-story-shortcut-toggle]');
        if(action)toggleStoryShortcut(action.dataset.storyShortcutToggle);
    });
}
export function toggleStoryShortcut(handle) {
    if(!handle||handle===currentUser.handle||!getAccount(handle)||!mayInteract()||state.blockedHandles.has(handle))return false;
    const wasMuted=state.mutedStoryHandles.has(handle);
    if(wasMuted)state.mutedStoryHandles.delete(handle);else state.mutedStoryHandles.add(handle);
    if(!persistPreferences()){
        if(wasMuted)state.mutedStoryHandles.add(handle);else state.mutedStoryHandles.delete(handle);
        showShareFeedback('Could not save this preference. Please try again.');return false;
    }
    closeHomePanel();renderStories();
    showShareFeedback(wasMuted?'Stories unmuted.':'Stories muted. Find them at the end of the story row.');return true;
}
