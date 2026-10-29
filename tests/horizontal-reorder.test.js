import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-harness.js';

function stripFixture(count=3,width=240) {
    const handlers={},captures=new Set(),frames=new Map(),timers=new Map(),moves=[];let serial=0;
    const classes=()=>{const values=new Set();return {add:v=>values.add(v),remove:v=>values.delete(v),contains:v=>values.has(v)};};
    const strip={children:[],scrollLeft:0,isConnected:true,getBoundingClientRect:()=>({left:0,right:width,width}),querySelectorAll:()=>strip.children,
        append(tile){const i=this.children.indexOf(tile);if(i>=0)this.children.splice(i,1);this.children.push(tile);},
        insertBefore(tile,reference){const i=this.children.indexOf(tile);if(i>=0)this.children.splice(i,1);const at=reference?this.children.indexOf(reference):this.children.length;this.children.splice(at,0,tile);}};
    const panel={hidden:false,isConnected:true,addEventListener:(name,handler)=>handlers[name]=handler,setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id),
        querySelector:selector=>selector==='.create-order-strip'?strip:strip.children.find(tile=>selector===`[data-order-index="${tile.button.dataset.orderIndex}"]`)?.button,
        querySelectorAll:()=>strip.children.map(tile=>tile.button)};
    for(let i=0;i<count;i++){
        const tile={id:i,classList:classes(),getBoundingClientRect:()=>({left:strip.children.indexOf(tile)*84-strip.scrollLeft,top:0,width:76,height:76}),
            cloneNode:()=>({classList:classes(),style:{},setAttribute(){},querySelectorAll:()=>[{tabIndex:0}],remove(){this.removed=true;}})};
        tile.button={dataset:{orderIndex:String(i)},closest:selector=>selector==='.create-order-strip'?strip:selector==='.create-order-tile'?tile:tile.button,focus(){},scrollIntoView(){}};
        Object.defineProperty(tile,'nextElementSibling',{get:()=>strip.children[strip.children.indexOf(tile)+1]||null});strip.children.push(tile);
    }
    const event=(index,x,y=20)=>({pointerId:1,button:0,clientX:x,clientY:y,target:strip.children.find(tile=>tile.id===index).button,preventDefault(){},stopImmediatePropagation(){},stopPropagation(){}});
    return {panel,strip,handlers,captures,frames,timers,moves,event,hold:()=>{const callbacks=[...timers.values()];timers.clear();callbacks.forEach(callback=>callback());},options:{setTimer:callback=>{timers.set(++serial,callback);return serial;},clearTimer:id=>timers.delete(id),requestFrame:callback=>{frames.set(++serial,callback);return serial;},cancelFrame:id=>frames.delete(id)},commit:(from,to)=>{moves.push([from,to]);return true;}};
}

test('horizontal drag moves a thumbnail to the requested position and cleans up capture',async()=>{
    const app=await loadApp(),{bindHorizontalReorder}=app.exportsOf('src/media/horizontal-reorder.js'),f=stripFixture();
    bindHorizontalReorder(f.panel,f.commit,f.options);
    f.handlers.pointerdown(f.event(0,38));f.hold();f.handlers.pointermove(f.event(0,230));
    assert.deepEqual(f.strip.children.map(tile=>tile.id),[1,2,0]);
    f.handlers.pointerup(f.event(0,230));assert.deepEqual(f.moves,[[0,2]]);assert.equal(f.captures.size,0);assert.equal(f.frames.size,0);
});

test('cancelled drags restore order, and vertical movement does not reorder',async()=>{
    const app=await loadApp(),{bindHorizontalReorder}=app.exportsOf('src/media/horizontal-reorder.js'),f=stripFixture();bindHorizontalReorder(f.panel,f.commit,f.options);
    f.handlers.pointerdown(f.event(0,38));f.hold();f.handlers.pointermove(f.event(0,230));f.handlers.pointercancel();
    assert.deepEqual(f.strip.children.map(tile=>tile.id),[0,1,2]);assert.equal(f.moves.length,0);
    f.handlers.pointerdown(f.event(0,38));f.handlers.pointermove(f.event(0,40,60));f.handlers.pointerup(f.event(0,40,60));assert.equal(f.moves.length,0);
});

test('holding a dragged thumbnail near the edge scrolls the strip to reach later items',async()=>{
    const app=await loadApp(),{bindHorizontalReorder,edgeScrollSpeed}=app.exportsOf('src/media/horizontal-reorder.js'),f=stripFixture(20,168);bindHorizontalReorder(f.panel,f.commit,f.options);
    f.handlers.pointerdown(f.event(0,38));f.hold();f.handlers.pointermove(f.event(0,164));
    for(let i=0;i<12;i++){const [id,callback]=[...f.frames.entries()][0];f.frames.delete(id);callback();}
    assert.ok(f.strip.scrollLeft>100);f.handlers.pointerup(f.event(0,164));assert.ok(f.moves[0][1]>1);assert.equal(edgeScrollSpeed(84,0,168),0);
});

test('Reorder renders one thumbnail strip with no visible item labels or arrow boxes',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js');create.openCreateUpload('post');
    state.createMediaItems=[{type:'image',url:'one.jpg'},{type:'video',url:'two.mp4'}];state.createReorderOpen=true;create.startCreateEditing();
    const html=app.element('.create-reorder-panel').innerHTML;assert.match(html,/create-order-strip/);assert.match(html,/<img/);assert.match(html,/<video/);assert.doesNotMatch(html,/data-create-move-from|Post order|1\. Image/);
});


test('ordinary horizontal swipes scroll without reordering or selecting, and cancel the hold',async()=>{
    const app=await loadApp(),{bindHorizontalReorder}=app.exportsOf('src/media/horizontal-reorder.js'),f=stripFixture(20,168);
    bindHorizontalReorder(f.panel,f.commit,f.options);
    f.handlers.pointerdown(f.event(0,38));f.handlers.pointermove(f.event(0,10));f.hold();
    assert.equal(f.strip.scrollLeft,28);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
    f.handlers.pointerup(f.event(0,10));assert.equal(f.moves.length,0);assert.equal(f.captures.size,0);
    let prevented=false;f.handlers.click({detail:1,preventDefault(){prevented=true;},stopImmediatePropagation(){}});assert.equal(prevented,true);
});

test('a quick tap cancels its hold timer and does not reorder',async()=>{
    const app=await loadApp(),{bindHorizontalReorder}=app.exportsOf('src/media/horizontal-reorder.js'),f=stripFixture();
    bindHorizontalReorder(f.panel,f.commit,f.options);f.handlers.pointerdown(f.event(0,38));f.handlers.pointerup(f.event(0,38));f.hold();
    assert.equal(f.timers.size,0);assert.equal(f.frames.size,0);assert.equal(f.moves.length,0);
});


test('media selector shows ordered image and video thumbnails instead of text-only tabs',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js');create.openCreateUpload('post');
    state.createMediaItems=[{type:'image',url:'one.jpg'},{type:'video',url:'two.mp4'}];create.startCreateEditing();
    const html=app.element('.create-media-tabs').innerHTML;
    assert.match(html,/create-media-thumbnail/);assert.match(html,/<img/);assert.match(html,/<video/);
    assert.match(html,/aria-label="Image 1"/);assert.match(html,/aria-label="Video 2"/);
    assert.match(html,/create-media-position[^>]*>1</);assert.match(html,/create-media-position[^>]*>2</);
    assert.doesNotMatch(html,/>Image 1<|>Video 2</);
});


test('Next previews every finalized item in a feed-style carousel, starting at the first item',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js');create.openCreateUpload('post');
    state.createMediaItems=Array.from({length:9},(_,i)=>({type:i===8?'video':'image',url:`item-${i}.jpg`,text:`Edit ${i}`,naturalRatio:1}));
    state.createActiveIndex=7;create.startCreateEditing();create.setCreateDetails(true);
    const html=app.element('.create-upload-preview').innerHTML;
    assert.equal((html.match(/class="carousel-slide"/g)||[]).length,9);assert.match(html,/1\/9/);assert.match(html,/aria-label="1 of 9"/);assert.match(html,/<video/);assert.match(html,/Edit 8/);
    assert.ok(html.indexOf('item-0.jpg')<html.indexOf('item-8.jpg'));
    assert.equal(state.createFinalizedItems.length,9);assert.equal(app.element('.create-media-controls').hidden,true);
    create.setCreateDetails(false);assert.doesNotMatch(app.element('.create-upload-preview').innerHTML,/carousel-slides/);assert.equal(state.createActiveIndex,7);
});


test('phone swipes remain native: no capture, manual scrolling, or cancelled touch movement',async()=>{
    const app=await loadApp(),{bindHorizontalReorder}=app.exportsOf('src/media/horizontal-reorder.js'),f=stripFixture(20,168);
    bindHorizontalReorder(f.panel,f.commit,f.options);
    f.handlers.pointerdown({...f.event(0,120),pointerType:'touch'});
    let prevented=false;f.handlers.pointermove({...f.event(0,30),pointerType:'touch',preventDefault(){prevented=true;}});
    f.hold();assert.equal(prevented,false);assert.equal(f.strip.scrollLeft,0);assert.equal(f.captures.size,0);assert.equal(f.frames.size,0);assert.equal(f.timers.size,0);
    f.handlers.touchmove({cancelable:true,preventDefault(){prevented=true;}});assert.equal(prevented,false);
    assert.equal(f.moves.length,0);
});

test('phone hold enables reorder and prevents native scrolling only during that held drag',async()=>{
    const app=await loadApp(),{bindHorizontalReorder}=app.exportsOf('src/media/horizontal-reorder.js'),f=stripFixture();
    bindHorizontalReorder(f.panel,f.commit,f.options);
    f.handlers.pointerdown({...f.event(0,38),pointerType:'touch'});
    let prevented=false;f.handlers.touchmove({cancelable:true,preventDefault(){prevented=true;}});assert.equal(prevented,false);
    f.hold();f.handlers.touchmove({cancelable:true,preventDefault(){prevented=true;}});assert.equal(prevented,true);
    f.handlers.pointermove({...f.event(0,230),pointerType:'touch'});f.handlers.pointerup(f.event(0,230));assert.deepEqual(f.moves,[[0,2]]);
    prevented=false;f.handlers.touchmove({cancelable:true,preventDefault(){prevented=true;}});assert.equal(prevented,false);assert.equal(f.captures.size,0);
});
