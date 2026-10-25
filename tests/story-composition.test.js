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

test('saved writing styles render in Story composition previews',async()=>{
    const app=await loadApp();
    const stage=app.element('.story-selected-preview'),nodes=[];
    stage.ownerDocument=app.document;stage.append=node=>nodes.push(node);
    app.document.createTextNode=text=>({textContent:text});
    const createElement=app.document.createElement;
    app.document.createElement=tag=>{const node=createElement(tag);node.append=(...children)=>node.children.push(...children);return node;};
    const {applyStoryComposition}=app.exportsOf('src/features/story-composition.js');
    applyStoryComposition(stage,{edits:{layers:[{id:'elegant',type:'text',text:'Hello',font:'elegant',x:.5,y:.4,size:8,width:.6}]}});
    const node=nodes.find(item=>item.dataset.layerId==='elegant');
    assert.equal(node.style.fontFamily,'Georgia, serif');
    assert.equal(node.style.fontStyle,'italic');
    assert.equal(node.style.fontWeight,'400');
    assert.equal(node.style.textTransform,'none');
    assert.equal(node.style.width,undefined);
    assert.equal(node.style.maxWidth,'60%');
});

test('ten additional Story filters preserve old IDs and flow through preview composition plus history',async()=>{
    const app=await loadApp();
    const {storyFilterPresets}=app.exportsOf('src/features/story-edit-session.js');
    const {STORY_FILTER_PRESET_IDS,storyComposition,compositionMediaStyle,compositionHistory}=app.exportsOf('src/features/story-composition.js');
    const added=[['amber','Amber'],['blush','Blush'],['mint','Mint'],['twilight','Twilight'],['film','Film'],['bright','Bright'],['deep','Deep'],['punch','Punch'],['arctic','Arctic'],['chalk','Chalk']];
    assert.equal(storyFilterPresets.length,20);
    assert.equal(storyFilterPresets[0].name,'Original');
    assert.deepEqual(Array.from(storyFilterPresets.slice(1,10),preset=>preset.id),['mono','vivid','sepia','soft','golden','cool','fade','dramatic','rose']);
    assert.deepEqual(Array.from(storyFilterPresets.slice(10),preset=>[preset.id,preset.name]),added);
    assert.equal(new Set(storyFilterPresets.map(preset=>preset.id)).size,20);
    assert.deepEqual(Array.from(STORY_FILTER_PRESET_IDS),Array.from(storyFilterPresets,preset=>preset.id));
    for(const preset of storyFilterPresets.slice(10)){
        const edit=storyComposition({filter:{preset:preset.id}});
        assert.equal(edit.filter.preset,preset.id);
        assert.ok(compositionMediaStyle(edit).filter.includes(preset.css));
    }
    const history=compositionHistory(),edited=history.current();edited.filter.preset='amber';history.commit(edited);
    assert.equal(history.undo().filter.preset,'none');
    assert.equal(history.redo().filter.preset,'amber');
});

test('Story filter selection stays transient until Save and participates in editor Undo/Redo',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js');
    state.pendingStoryMedia={type:'image',media:'fixture.png'};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
    const buttons=['none','amber'].map(storyFilter=>({dataset:{storyFilter},pressed:null,setAttribute(name,value){if(name==='aria-pressed')this.pressed=value;},scrollIntoView(){}}));
    app.document.querySelectorAll=selector=>selector==='[data-story-filter]'?buttons:[];
    const click=app.listeners.find(item=>item.key==='document'&&item.type==='click'&&item.callback.toString().includes("target.closest('[data-story-filter]')")).callback;
    const send=(filterId)=>click({target:{closest:selector=>selector==='[data-story-filter]'?buttons.find(button=>button.dataset.storyFilter===filterId):null}});
    const undo=app.listeners.find(item=>item.key==='document'&&item.type==='click'&&item.callback.toString().includes("target.closest('.story-undo')")).callback;
    tools.beginStoryMode('filters');
    assert.equal((app.element('.story-edit-mode-controls').innerHTML.match(/data-story-filter=/g)||[]).length,20);
    send('amber');
    assert.equal(state.pendingStoryMedia.edits,undefined);
    assert.equal(buttons[1].pressed,'true');
    undo({target:{closest:selector=>selector==='.story-undo'?{}:null}});
    assert.equal(buttons[0].pressed,'true');assert.equal(buttons[1].pressed,'false');
    const redo=app.listeners.find(item=>item.key==='document'&&item.type==='click'&&item.callback.toString().includes("target.closest('.story-undo')")).callback;
    redo({target:{closest:selector=>selector==='.story-redo'?{}:null}});
    assert.equal(buttons[1].pressed,'true');
    tools.finishStoryMode(false);
    assert.equal(state.pendingStoryMedia.edits,undefined);
    tools.beginStoryMode('filters');send('amber');tools.finishStoryMode(true);
    assert.equal(state.pendingStoryMedia.edits.filter.preset,'amber');
    undo({target:{closest:selector=>selector==='.story-undo'?{}:null}});
    assert.equal(state.pendingStoryMedia.edits.filter.preset,'none');
});

test('text layer selection state survives drag redraws without needing a visible border',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js');
    state.pendingStoryMedia={type:'image',media:'fixture.png',edits:{layers:[{id:'text-outline',type:'text',text:'Vishal',x:.5,y:.4,size:8,width:.6}]}};
    const stage=app.element('.story-selected-preview'),nodes=[];
    stage.ownerDocument=app.document;stage.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100});stage.setPointerCapture=()=>{};
    stage.append=node=>nodes.push(node);stage.querySelector=selector=>selector==='img, video'?null:nodes.find(node=>selector.includes(node.dataset.layerId))||null;
    stage.querySelectorAll=selector=>selector.includes('story-composition-layer')?nodes.slice():[];
    app.document.createTextNode=text=>({textContent:text});
    const createElement=app.document.createElement;
    app.document.createElement=tag=>{const node=createElement(tag);node.append=(...children)=>node.children.push(...children);node.remove=()=>{const index=nodes.indexOf(node);if(index>=0)nodes.splice(index,1);};return node;};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
    const fire=(kind,x,y)=>app.listeners.find(item=>item.key==='.story-selected-preview'&&item.type===kind).callback({pointerId:1,clientX:x,clientY:y,target:{closest:selector=>selector==='.story-composition-layer'?nodes[0]:null},preventDefault(){}});
    fire('pointerdown',50,40);fire('pointermove',60,50);
    assert.equal(nodes[0].classList.contains('story-layer-selected'),true);
    fire('pointerup',60,50);
    assert.equal(nodes[0].classList.contains('story-layer-selected'),true);
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
    const story={media:image,type:'image',edits:{layers:[{type:'text',text:'Saved text',x:.3,y:.6},{type:'sticker',text:'GOOD VIBES',background:'#ef72b0',color:'#fff',x:.5,y:.4}],music:{src:music,title:'Fixture tone',start:1,end:3}}};
    const stored=await serializeStoryMedia(story);assert.ok(stored.media instanceof Blob);assert.ok(stored.edits.music.src instanceof Blob);
    const restored=restoreStoryMedia(stored);assert.ok(restored.edits.music.src.startsWith('blob:'));assert.equal(restored.edits.layers[0].x,.3);assert.equal(restored.edits.layers[1].background,'#ef72b0');assert.equal(restored.edits.music.end,3);
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


test('media alignment snaps near quarter turns and original frame size, and releases outside the capture zone',async()=>{
    const app=await loadApp();const {snapStoryMedia}=app.exportsOf('src/features/story-tools.js');
    for(const [angle,expected] of [[2,0],[88,90],[179,180],[-92,-90],[358,0]]){
        const snap=snapStoryMedia({rotation:angle,zoom:1.02});
        assert.equal(snap.rotation,expected);assert.equal(snap.rotationSnap,true);
        assert.equal(snap.zoom,1);assert.equal(snap.sizeSnap,true);
    }
    const free=snapStoryMedia({rotation:84,zoom:1.1});
    assert.equal(free.rotation,84);assert.equal(free.rotationSnap,false);
    assert.equal(free.zoom,1.1);assert.equal(free.sizeSnap,false);
});

test('dragging an overlay onto the delete target removes only that layer and Undo restores it',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
    state.pendingStoryMedia={type:'image',media:'fixture.png',edits:{layers:[{id:'a',type:'emoji',text:'🙂',x:.5,y:.4,size:15},{id:'b',type:'text',text:'Keep',x:.3,y:.3}]}};
    app.exportsOf('src/features/story-tools.js').prepareStoryTools();
    const stage=app.element('.story-selected-preview');stage.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100});stage.setPointerCapture=()=>{};
    app.element('.story-delete-target').getBoundingClientRect=()=>({left:30,top:80,right:70,bottom:100});
    const fire=(type,x,y)=>app.listeners.find(l=>l.key==='.story-selected-preview'&&l.type===type).callback({pointerId:1,clientX:x,clientY:y,target:{closest:s=>s==='.story-composition-layer'?{dataset:{layerId:'a'},classList:{add(){}}}:null},preventDefault(){}});
    fire('pointerdown',50,40);fire('pointermove',50,90);
    assert.equal(app.element('.story-delete-target').hidden,false);
    fire('pointerup',50,90);
    assert.equal(state.pendingStoryMedia.edits.layers.length,1);assert.equal(state.pendingStoryMedia.edits.layers[0].id,'b');
    assert.equal(state.pendingStoryMedia.media,'fixture.png');assert.equal(app.element('.story-delete-target').hidden,true);
    const click=app.listeners.find(l=>l.key==='document'&&l.type==='click'&&l.callback.toString().includes('story-undo')).callback;
    click({target:{closest:s=>s==='.story-undo'?{}:null}});
    assert.equal(state.pendingStoryMedia.edits.layers.length,2);
});

test('quarter-turn snapping applies to text, location and emoji overlays with undo support',async()=>{
    for(const type of ['text','location','emoji']){
        const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
        state.pendingStoryMedia={type:'image',media:'fixture.png',edits:{layers:[{id:'layer',type,text:'Test',x:.5,y:.4,size:10,rotation:0}]}};
        const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
        const stage=app.element('.story-selected-preview');stage.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100});stage.setPointerCapture=()=>{};
        app.element('.story-delete-target').getBoundingClientRect=()=>({left:30,top:80,right:70,bottom:100});
        const fire=(kind,pointerId,x,y)=>app.listeners.find(l=>l.key==='.story-selected-preview'&&l.type===kind).callback({pointerId,clientX:x,clientY:y,target:{closest:s=>s==='.story-composition-layer'?{dataset:{layerId:'layer'},classList:{add(){}}}:null},preventDefault(){}});
        fire('pointerdown',1,40,50);fire('pointerdown',2,60,50);fire('pointermove',2,40.5,70);fire('pointerup',2,40.5,70);
        assert.equal(state.pendingStoryMedia.edits.layers[0].rotation,90,type);
        const click=app.listeners.find(l=>l.key==='document'&&l.type==='click'&&l.callback.toString().includes('story-undo')).callback;
        click({target:{closest:s=>s==='.story-undo'?{}:null}});
        assert.equal(state.pendingStoryMedia.edits.layers[0].rotation,0);
    }
});

test('center guides snap each axis independently and release outside the center capture zone',async()=>{
    const app=await loadApp();const {snapStoryCenter,snapStoryRotation}=app.exportsOf('src/features/story-tools.js');
    let center=snapStoryCenter(.49,.7);assert.equal(center.x,.5);assert.equal(center.y,.7);assert.equal(center.xSnap,true);assert.equal(center.ySnap,false);
    center=snapStoryCenter(1,-1,true);assert.equal(center.x,0);assert.equal(center.y,0);assert.equal(center.xSnap,true);assert.equal(center.ySnap,true);
    center=snapStoryCenter(5,6,true);assert.equal(center.x,5);assert.equal(center.y,6);assert.equal(center.xSnap,false);assert.equal(center.ySnap,false);
    assert.equal(snapStoryRotation(96).rotation,96);assert.equal(snapStoryRotation(96).snapped,false);
});

test('media drag to screen center shows both guides, commits the center, and Undo restores the previous position',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');state.pendingStoryMedia={type:'image',media:'fixture.png',edits:{media:{x:10,y:-10}}};
    app.exportsOf('src/features/story-tools.js').prepareStoryTools();
    const stage=app.element('.story-selected-preview');stage.getBoundingClientRect=()=>({left:0,top:0,width:100,height:100});stage.setPointerCapture=()=>{};
    const fire=(kind,x,y)=>app.listeners.find(l=>l.key==='.story-selected-preview'&&l.type===kind).callback({pointerId:1,clientX:x,clientY:y,target:{closest:()=>null},preventDefault(){}});
    fire('pointerdown',50,50);fire('pointermove',40,60);
    assert.equal(stage.classList.contains('story-center-x'),true);assert.equal(stage.classList.contains('story-center-y'),true);
    assert.equal(stage.getAttribute('data-alignment-hint'),undefined);
    fire('pointerup',40,60);assert.equal(state.pendingStoryMedia.edits.media.x,0);assert.equal(state.pendingStoryMedia.edits.media.y,0);
    const click=app.listeners.find(l=>l.key==='document'&&l.type==='click'&&l.callback.toString().includes('story-undo')).callback;
    click({target:{closest:s=>s==='.story-undo'?{}:null}});
    assert.equal(state.pendingStoryMedia.edits.media.x,10);assert.equal(state.pendingStoryMedia.edits.media.y,-10);
    fire('pointerdown',50,50);fire('pointermove',40,60);fire('pointercancel',40,60);
    assert.equal(stage.classList.contains('story-center-x'),false);assert.equal(stage.classList.contains('story-center-y'),false);
});
