import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('composition edits undo/redo with branching and preserve the original media',async()=>{
    const app=await loadApp();
    const {compositionHistory,storyComposition,compositionMediaStyle}=app.exportsOf('src/features/story-composition.js');
    const history=compositionHistory();let e=history.current();e.layers.push({id:'text-1',type:'text',text:'Hi @aribloom',x:.25,y:.3,size:8,color:'#ffffff'});history.commit(e);
    e=history.current();e.media.zoom=1.4;e.media.x=12;e.filter.brightness=1.2;history.commit(e);
    assert.equal(history.undo().media.zoom,1);assert.equal(history.current().layers[0].text,'Hi @aribloom');
    assert.equal(history.redo().media.zoom,1.4);
    history.undo();e=history.current();e.layers.push({id:'emoji',type:'emoji',text:'🙂',x:.5,y:.5,size:12});history.commit(e);assert.equal(history.canRedo(),false);
    const original={media:'original-upload.png'};
    const style=compositionMediaStyle(storyComposition({media:{fit:'cover',rotation:90,straighten:2},filter:{preset:'mono'}}));
    assert.equal(style.objectFit,'cover');assert.match(style.transform,/rotate\(92deg\)/);assert.match(style.filter,/grayscale/);assert.equal(original.media,'original-upload.png');
});

test('trim ranges allow full-length playback or a bounded segment',async()=>{
    const app=await loadApp();const {storyVideoRange}=app.exportsOf('src/features/story-composition.js');
    assert.equal(storyVideoRange({},10).duration,10);
    const range=storyVideoRange({edits:{video:{start:2,end:6}}},10);
    assert.equal(range.start,2);assert.equal(range.end,6);assert.equal(range.duration,4);
    assert.equal(storyVideoRange({edits:{video:{start:2,end:40}}},10).end,10);
});

test('Story storage roundtrips nested music media and composition for playback/Highlights',async()=>{
    const app=await loadApp();app.context.fetch=fetch;
    const {serializeStoryMedia,restoreStoryMedia}=app.exportsOf('src/storage/browser-storage.js');
    const image=URL.createObjectURL(new Blob(['image'],{type:'image/png'}));const music=URL.createObjectURL(new Blob(['tone'],{type:'audio/wav'}));
    const story={media:image,type:'image',edits:{layers:[{type:'text',text:'Saved text',x:.3,y:.6}],music:{src:music,title:'Fixture tone',start:1,end:3}}};
    const stored=await serializeStoryMedia(story);assert.ok(stored.media instanceof Blob);assert.ok(stored.edits.music.src instanceof Blob);
    const restored=restoreStoryMedia(stored);assert.ok(restored.edits.music.src.startsWith('blob:'));assert.equal(restored.edits.layers[0].x,.3);assert.equal(restored.edits.music.end,3);
    assert.equal(await (await fetch(restored.edits.music.src)).text(),'tone');
    for(const url of [image,music,restored.media,restored.edits.music.src])URL.revokeObjectURL(url);
});

test('pending accounts cannot commit composition changes',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');state.pendingStoryMedia={type:'image',media:'fixture.png'};state.verificationStatus='pending';
    assert.equal(app.exportsOf('src/features/story-tools.js').commitStoryEdit({layers:[{id:'x',text:'Blocked'}]}),false);
    assert.equal(state.pendingStoryMedia.edits,undefined);
});

test('two-finger media gestures resize and rotate together and undo as one edit',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
    state.pendingStoryMedia={type:'image',media:'fixture.png'};
    const stage=app.element('.story-selected-preview');
    stage.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100});stage.setPointerCapture=()=>{};
    const fire=(type,id,x,y)=>app.listeners.find(l=>l.key==='.story-selected-preview'&&l.type===type).callback({pointerId:id,clientX:x,clientY:y,target:{closest:()=>null},preventDefault(){}});
    fire('pointerdown',1,25,50);fire('pointerdown',2,75,50);
    fire('pointermove',2,25,100);fire('pointerup',2,25,100);
    assert.ok(Math.abs(state.pendingStoryMedia.edits.media.rotation-90)<.001);
    assert.equal(state.pendingStoryMedia.edits.media.y,25);
    const click=app.listeners.find(l=>l.key==='document'&&l.type==='click'&&l.callback.toString().includes('story-undo')).callback;
    click({target:{closest:s=>s==='.story-undo'?{}:null}});
    assert.equal(state.pendingStoryMedia.edits.media.rotation,0);
    assert.equal(state.pendingStoryMedia.edits.media.y,0);
    fire('pointerdown',3,25,50);fire('pointerdown',4,75,50);fire('pointermove',4,100,50);fire('pointerup',4,100,50);
    assert.equal(state.pendingStoryMedia.edits.media.zoom,1.5);
});

test('cancelling a gesture restores the saved composition',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');state.pendingStoryMedia={type:'image',media:'fixture.png'};
    const stage=app.element('.story-selected-preview');stage.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100});stage.setPointerCapture=()=>{};
    const fire=(type,x,y)=>app.listeners.find(l=>l.key==='.story-selected-preview'&&l.type===type).callback({pointerId:1,clientX:x,clientY:y,target:{closest:()=>null},preventDefault(){}});
    fire('pointerdown',20,20);fire('pointermove',40,40);fire('pointercancel',40,40);
    assert.equal(state.pendingStoryMedia.edits,undefined);
});
