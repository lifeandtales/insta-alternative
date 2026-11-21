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


function mockReelCloud(app, rpc, publish) {
    const uploads = [];
    const stored = [];
    const createElement = app.document.createElement;
    app.document.createElement = tag => Object.assign(createElement(tag), { remove() {} });
    app.document.head = { append: script => script.onload() };
    app.context.crypto = { randomUUID: () => 'e2540ba5-4595-44a1-bd16-0ca6fe7cdf75' };
    app.context.FormData = FormData;
    app.context.fetch = async (url, options) => {
        if (!url.startsWith('https://s3.example.test/')) return fetch(url, options);
        uploads.push({ url, type: options.body.get('file').type });
        return { ok: true };
    };
    app.context.window.supabase = { createClient: () => ({
        rpc,
        functions: { invoke: async (name, { body }) => {
            assert.equal(name, 'reel-storage');
            if (body.action === 'prepare') return { data: {
                ticket: 'upload-ticket',
                uploads: ['video', 'cover'].map(role => ({ role, url: 'https://s3.example.test/' + role, fields: {} })),
            } };
            assert.equal(body.action, 'publish');
            return publish(body);
        } },
    }) };
    app.context.window.indexedDB = {
        open(name) {
            const request = { result: {
                close() {},
                transaction() {
                    const transaction = { objectStore: () => ({ put(value, key) {
                        stored.push({ name, key, value: structuredClone(value) });
                        queueMicrotask(() => transaction.oncomplete());
                    } }) };
                    return transaction;
                },
            } };
            queueMicrotask(() => request.onsuccess());
            return request;
        },
    };
    return { uploads, stored };
}

test('Reel publishing retains the editor on missing backend and shares the selected cover only after cloud confirmation', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { reels } = app.exportsOf('src/data/sample-data.js');
    const create = app.exportsOf('src/features/create.js');
    const { reelCoverSignature } = app.exportsOf('src/features/reel-cover.js');
    const video = 'data:video/mp4;base64,AAAA';
    const cover = 'data:image/jpeg;base64,AAAA';
    state.signedInAccountId = 'owner';
    let ready = false;
    let confirmPublish;
    const { uploads } = mockReelCloud(app, async (name, payload) => {
        assert.equal(name, 'video_engagement');
        return ready ? {} : { error: { code: 'PGRST202' } };
    }, async payload => {
        assert.equal(payload.ticket, 'upload-ticket');
        assert.equal(payload.media.video.mime, 'video/mp4');
        assert.equal(payload.media.cover.mime, 'image/jpeg');
        return new Promise(resolve => { confirmPublish = resolve; });
    });
    create.openCreateUpload('reel');
    const item = { type: 'video', url: video, ratio: '9/16', layout: 'reel', naturalRatio: 9 / 16 };
    state.createMediaItems = [item];
    state.createMediaFile = { type: 'video/mp4' };
    state.createMediaUrl = video;
    create.startCreateEditing();
    create.setCreateDetails(true);
    state.createReelThumbnail = { signature: reelCoverSignature(item), data: cover };
    const previousCount = reels.length;

    await create.publishCreatedMedia();
    assert.match(app.element('.create-upload-hint').textContent, /publishing is unavailable/);
    assert.equal(app.element('.create-upload-backdrop').hidden, false);
    assert.equal(reels.length, previousCount);
    assert.equal(uploads.length, 0);

    ready = true;
    const publishing = create.publishCreatedMedia();
    await new Promise(resolve => setImmediate(resolve));
    assert.match(app.element('.create-publish-button').textContent, /Uploading Reel/);
    assert.equal(reels.length, previousCount);
    assert.deepEqual(uploads.map(upload => upload.type), ['video/mp4', 'image/jpeg']);
    confirmPublish({ data: { paths: ['owner/reel/s3/version/video', 'owner/reel/s3/version/cover'] } });
    await publishing;
    assert.equal(reels[0].cloudOwnerId, 'owner');
    assert.equal(reels[0].cover, cover);
    assert.equal(reels[0].poster, cover);
    assert.equal(reels[0].video, video);
    assert.match(app.element('#share-feedback').textContent, /published online/);
});

test('stored Reels remain retryable, keep their cloud ID and publish only for their owner with current privacy', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { reels, currentUser } = app.exportsOf('src/data/sample-data.js');
    const { getStoredReels, publishStoredReels } = app.exportsOf('src/features/create.js');
    const targets = [];
    const { stored } = mockReelCloud(app, async () => ({}), async payload => {
        targets.push(payload);
        return targets.length === 1 ? { error: { message: 'Request interrupted' } }
            : { data: { paths: ['owner/reel/s3/version/video', 'owner/reel/s3/version/cover'] } };
    });
    state.signedInAccountId = 'owner';
    currentUser.isPrivate = true;
    const reel = {
        id: 201, handle: currentUser.handle, mine: true, public: true, reel: true,
        video: 'data:video/mp4;base64,AAAA', poster: 'data:image/jpeg;base64,AAAA',
    };
    reels.push(reel, { ...reel, id: 202, handle: '@anotheraccount' });
    assert.deepEqual(Array.from(getStoredReels(), item => item.id), [201]);

    const interrupted = await publishStoredReels();
    assert.equal(interrupted.failed, 1);
    assert.ok(!reel.cloudOwnerId);
    assert.equal(stored[0].name, 'insta-browser-data:owner');
    assert.equal(stored[0].value.reels.find(item => item.id === 201).pendingCloudId, targets[0].id);

    const retry = await publishStoredReels();
    assert.equal(retry.published, 1);
    assert.equal(reel.cloudOwnerId, 'owner');
    assert.equal(targets[1].id, targets[0].id);
    assert.equal(targets[1].audience, 'followers');
    assert.equal(getStoredReels().length, 0);
});

test('nearby samples show six earlier and six later moments without scanning the whole clip',async()=>{
    const app=await loadApp(),{nearbyFrameTimes}=app.exportsOf('src/features/reel-cover.js');const times=nearbyFrameTimes(30,60);
    assert.equal(times.before.length,6);assert.equal(times.after.length,6);assert.ok(times.before.every(time=>time<30&&time>=29.8));assert.ok(times.after.every(time=>time>30&&time<=30.2));
    assert.equal(nearbyFrameTimes(0,60).before.length,0);assert.equal(nearbyFrameTimes(59.975,60).after.length,0);
    const short=nearbyFrameTimes(.04,.1);assert.ok([...short.before,...short.after].every(time=>time>=0&&time<=.075000001));
});
