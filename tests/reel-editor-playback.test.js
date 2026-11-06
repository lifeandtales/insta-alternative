import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-harness.js';

function player(){
    const handlers={},mediaEvents={},attributes={},classes=new Set();
    const button={textContent:'',setAttribute:(key,value)=>attributes[key]=value};
    const video={controls:true,paused:true,ended:false,playCount:0,pauseCount:0,currentTime:0,
        async play(){this.playCount++;this.paused=false;mediaEvents.play?.();},
        pause(){this.pauseCount++;this.paused=true;mediaEvents.pause?.();},
        addEventListener:(name,handler)=>mediaEvents[name]=handler};
    const stage={querySelector:selector=>selector==='video'?video:button,addEventListener:(name,handler)=>handlers[name]=handler,
        classList:{add:name=>classes.add(name),remove:name=>classes.delete(name),toggle:(name,on)=>on?classes.add(name):classes.delete(name)}};
    const event=()=>({target:{closest:()=>null},preventDefault(){},stopPropagation(){}});
    return {stage,video,button,handlers,attributes,classes,event};
}

test('native controls remain default; the Reel editor render explicitly replaces them with a center toggle',async()=>{
    const app=await loadApp(),{renderEditedMedia}=app.exportsOf('src/features/post-media.js');
    assert.match(renderEditedMedia({type:'video',url:'fixture.mp4'}),/ playsinline controls /);
    const editor=renderEditedMedia({type:'video',url:'fixture.mp4'},{preview:true,nativeControls:false});
    assert.doesNotMatch(editor,/ playsinline controls /);assert.match(editor,/reel-editor-play-toggle/);assert.match(editor,/disablepictureinpicture/);
});

test('single taps toggle play and pause, update accessible center state, and replay an ended video',async()=>{
    const app=await loadApp(),{bindReelEditorPlayback}=app.exportsOf('src/media/reel-editor-playback.js'),f=player();
    bindReelEditorPlayback(f.stage);
    assert.equal(f.video.controls,false);assert.equal(f.attributes['aria-label'],'Play reel preview');
    await f.handlers.click(f.event());assert.equal(f.video.playCount,1);assert.equal(f.attributes['aria-label'],'Pause reel preview');
    await f.handlers.click(f.event());assert.equal(f.video.pauseCount,1);assert.equal(f.attributes['aria-label'],'Play reel preview');
    f.video.ended=true;f.video.currentTime=5;await f.handlers.click(f.event());assert.equal(f.video.currentTime,0);assert.equal(f.video.playCount,2);
});

test('dragging or editing overlaid text does not toggle playback; the next real tap still works',async()=>{
    const app=await loadApp(),{bindReelEditorPlayback}=app.exportsOf('src/media/reel-editor-playback.js'),f=player();bindReelEditorPlayback(f.stage);
    f.handlers.pointerdown({pointerId:1,button:0,clientX:10,clientY:10});f.handlers.pointermove({pointerId:1,clientX:50,clientY:10});f.handlers.pointerup();
    await f.handlers.click(f.event());assert.equal(f.video.playCount,0);
    f.handlers.pointerdown({pointerId:2,button:0,clientX:10,clientY:10});f.handlers.pointerup();await f.handlers.click(f.event());assert.equal(f.video.playCount,1);
    const event=f.event();event.target.closest=selector=>selector.includes('.post-media-text')?{}:null;await f.handlers.click(event);assert.equal(f.video.pauseCount,0);
});

test('disabled editor playback does not start a hidden or unavailable preview',async()=>{
    const app=await loadApp(),{bindReelEditorPlayback}=app.exportsOf('src/media/reel-editor-playback.js'),f=player();bindReelEditorPlayback(f.stage,()=>false);
    await f.handlers.click(f.event());assert.equal(f.video.playCount,0);
});
