import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-harness.js';

test('square cover crops stay within wide and tall images at every position and zoom',async()=>{
    const app=await loadApp(),{squareCropBounds}=app.exportsOf('src/media/cover-canvas.js');
    for(const [width,height] of [[1920,1080],[800,1600],[720,720]])for(const x of [0,50,100])for(const y of [0,50,100])for(const zoom of [1,2,3]){
        const crop=squareCropBounds(width,height,{x,y,zoom});assert.ok(crop.x>=0&&crop.y>=0);assert.ok(crop.x+crop.size<=width+.001&&crop.y+crop.size<=height+.001);assert.equal(crop.size,Math.min(width,height)/zoom);
    }
});

test('gallery cover export uses the fixed 720px square and the selected crop',async()=>{
    const app=await loadApp(),{renderSquareCover}=app.exportsOf('src/media/cover-canvas.js');const draws=[];
    const canvas={getContext:()=>({drawImage:(...args)=>draws.push(args)}),toDataURL:()=> 'data:image/jpeg;cover'};
    app.document.createElement=()=>canvas;
    const image={naturalWidth:1600,naturalHeight:800};assert.equal(renderSquareCover(image,null,{x:100,y:0,zoom:2}),'data:image/jpeg;cover');
    assert.equal(canvas.width,720);assert.equal(canvas.height,720);assert.deepEqual(draws[0].slice(1),[1200,0,400,400,0,0,720,720]);
});

test('Reel cover appears only after Next, requires confirmation, and keeps its selection on returning',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),create=app.exportsOf('src/features/create.js'),cover=app.exportsOf('src/features/reel-cover.js');
    create.openCreateUpload('reel');const item={type:'video',url:'test.mp4',naturalRatio:9/16,layout:'reel',ratio:'9/16'};state.createMediaItems=[item];create.startCreateEditing();
    assert.equal(app.element('.create-reel-cover').hidden,true);create.setCreateDetails(true);
    assert.equal(app.element('#create-upload-title').textContent,'New reel');assert.equal(app.element('.create-reel-cover').hidden,false);
    const html=app.element('.create-reel-cover').innerHTML;assert.match(html,/From video/);assert.match(html,/Upload image/);assert.match(html,/720 × 720/);assert.match(html,/reel-cover-frames/);assert.match(html,/Use thumbnail/);
    assert.equal(app.element('.create-publish-button').disabled,true);await create.publishCreatedMedia();assert.match(app.element('#share-feedback').textContent,/confirm a reel thumbnail/);
    state.createReelThumbnail={signature:cover.reelCoverSignature(item),data:'data:image/jpeg;saved'};
    create.setCreateDetails(false);create.setCreateDetails(true);assert.equal(cover.getReelCover(item),'data:image/jpeg;saved');assert.equal(app.element('.create-publish-button').disabled,false);
    item.text='A new edit';create.setCreateDetails(false);create.setCreateDetails(true);assert.equal(cover.getReelCover(item),null);assert.equal(app.element('.create-publish-button').disabled,true);
    create.openCreateUpload('post');assert.equal(state.createReelThumbnail,null);
});


test('publishing a Reel uses the confirmed thumbnail as its cover and poster',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js'),{reels}=app.exportsOf('src/data/sample-data.js'),create=app.exportsOf('src/features/create.js'),cover=app.exportsOf('src/features/reel-cover.js');
    create.openCreateUpload('reel');const item={type:'video',url:'test.mp4',ratio:'9/16',layout:'reel',naturalRatio:9/16};state.createMediaItems=[item];state.createMediaFile={type:'video/mp4'};state.createMediaUrl=item.url;create.startCreateEditing();create.setCreateDetails(true);
    const data='data:image/jpeg;base64,confirmed';state.createReelThumbnail={signature:cover.reelCoverSignature(item),data};
    await create.publishCreatedMedia();assert.equal(reels[0].cover,data);assert.equal(reels[0].poster,data);assert.equal(reels[0].video,'test.mp4');
});


test('nearby samples show six earlier and six later moments without scanning the whole clip',async()=>{
    const app=await loadApp(),{nearbyFrameTimes}=app.exportsOf('src/features/reel-cover.js');const times=nearbyFrameTimes(30,60);
    assert.equal(times.before.length,6);assert.equal(times.after.length,6);assert.ok(times.before.every(time=>time<30&&time>=29.8));assert.ok(times.after.every(time=>time>30&&time<=30.2));
    assert.equal(nearbyFrameTimes(0,60).before.length,0);assert.equal(nearbyFrameTimes(59.975,60).after.length,0);
    const short=nearbyFrameTimes(.04,.1);assert.ok([...short.before,...short.after].every(time=>time>=0&&time<=.075000001));
});
