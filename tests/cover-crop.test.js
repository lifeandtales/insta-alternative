import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-harness.js';
function fixture(){
    const handlers={},buttons={},captures=new Set(),box={style:{}};let crop={x:50,y:50,zoom:1};
    const stage={querySelector:selector=>selector==='.reel-cover-selection'?box:{addEventListener:(name,handler)=>{buttons[selector]=handler;}},addEventListener:(name,handler)=>{handlers[name]=handler;},getBoundingClientRect:()=>({width:150,height:300}),setPointerCapture:id=>captures.add(id),hasPointerCapture:id=>captures.has(id),releasePointerCapture:id=>captures.delete(id)};
    return {stage,box,handlers,buttons,captures,get:()=>crop,change:value=>{crop=value;},event:(id,x,y)=>({pointerId:id,button:0,clientX:x,clientY:y,target:{closest:()=>null},preventDefault(){}})};
}
test('one-finger crop drag stays inside the full image and uses the exported crop coordinates',async()=>{
    const app=await loadApp(),{bindCoverCrop}=app.exportsOf('src/media/cover-crop.js'),{squareCropBounds}=app.exportsOf('src/media/cover-canvas.js'),f=fixture();
    bindCoverCrop(f.stage,()=>({width:300,height:600}),f.get,f.change);
    f.handlers.pointerdown(f.event(1,75,150));f.handlers.pointermove(f.event(1,75,180));
    assert.equal(f.get().y,70);const rect=squareCropBounds(300,600,f.get());assert.equal(rect.y,210);assert.equal(f.box.style.top,'35%');
    f.handlers.pointermove(f.event(1,75,999));assert.equal(f.get().y,100);f.handlers.pointerup(f.event(1,75,999));assert.equal(f.captures.size,0);
});
test('two-finger pinch zooms around the selection, then rebases cleanly to one finger',async()=>{
    const app=await loadApp(),{bindCoverCrop}=app.exportsOf('src/media/cover-crop.js'),f=fixture();
    bindCoverCrop(f.stage,()=>({width:300,height:600}),f.get,f.change);
    f.handlers.pointerdown(f.event(1,50,150));f.handlers.pointerdown(f.event(2,100,150));f.handlers.pointermove(f.event(2,150,150));assert.equal(f.get().zoom,2);
    f.handlers.pointerup(f.event(2,150,150));const before={...f.get()};f.handlers.pointermove(f.event(1,50,150));assert.equal(f.get().x,before.x);assert.equal(f.get().y,before.y);assert.equal(f.get().zoom,2);
    f.handlers.pointercancel(f.event(1,50,150));assert.equal(f.captures.size,0);
});
test('crop zoom buttons clamp to the supported zoom range and remain keyboard accessible',async()=>{
    const app=await loadApp(),{bindCoverCrop}=app.exportsOf('src/media/cover-crop.js'),f=fixture();const controller=bindCoverCrop(f.stage,()=>({width:300,height:600}),f.get,f.change);
    for(let i=0;i<20;i++)f.buttons['[data-cover-zoom="in"]']();assert.equal(f.get().zoom,3);
    for(let i=0;i<20;i++)f.buttons['[data-cover-zoom="out"]']();assert.equal(f.get().zoom,1);controller.dispose();
});
