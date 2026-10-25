import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadApp } from './helpers/app-harness.js';

test('Story editor places Save Draft before Share while retaining each action binding',()=>{
    const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
    const actions=html.match(/<div class="story-editor-actions">([\s\S]*?)<\/div>/)?.[1]||'';
    const save=actions.indexOf('class="story-save-draft"'),share=actions.indexOf('class="story-publish-selected"');
    assert.ok(save>=0&&share>save);
    assert.match(actions,/<button[^>]*class="story-save-draft"[^>]*>[\s\S]*?<span class="story-editor-action-label">Draft story<\/span>[\s\S]*?<\/button>/);
    assert.match(actions,/<button[^>]*class="story-publish-selected"[^>]*>[\s\S]*?<span class="story-editor-action-label">Share story<\/span>[\s\S]*?<\/button>/);
    assert.doesNotMatch(actions,/7 days/);
    assert.equal((html.match(/class="story-editor-control-icon"/g)||[]).length,4);
    const styles=fs.readFileSync(new URL('../styles/story-and-media-viewers.css',import.meta.url),'utf8');
    assert.match(styles,/\.story-option-buttons\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*1fr 1fr;/);
    assert.match(styles,/\.story-editor-actions\s*\{\s*display:\s*grid;\s*grid-template-columns:\s*1fr 1fr;/);
    assert.match(styles,/\.story-editor-control-icon\s*\{[^}]*flex:\s*0 0 20px;[^}]*width:\s*20px;[^}]*height:\s*20px;/);
    assert.match(styles,/\.story-editor-control-icon svg\s*\{[^}]*width:\s*18px;[^}]*height:\s*18px;[^}]*stroke-width:\s*1\.8;/);
    assert.match(styles,/\.story-option-buttons\s*>\s*button,\s*\.story-editor-actions\s*>\s*button\s*\{\s*box-sizing:\s*border-box;\s*height:\s*52px;\s*min-height:\s*52px;/);
    assert.match(styles,/\.story-editor-actions\s*>\s*button\s*\{[^}]*display:\s*flex;[^}]*align-items:\s*center;[^}]*gap:\s*8px;/);
    const events=fs.readFileSync(new URL('../src/features/stories.events.js',import.meta.url),'utf8');
    assert.match(events,/event\.target\.closest\('\.story-save-draft'\)/);
    assert.match(events,/event\.target\.closest\('\.story-publish-selected'\)/);
});

test('welcome pause is reversible and applies only to local development hosts', async () => {
    const app = await loadApp();
    const preview = app.exportsOf('src/core/local-preview.js');
    assert.equal(preview.opensDirectlyToHome('http://127.0.0.1:8000/'),true);
    assert.equal(preview.opensDirectlyToHome('http://localhost:8000/'),true);
    assert.equal(preview.opensDirectlyToHome('https://example.com/'),false);
    assert.equal(preview.opensDirectlyToHome('http://127.0.0.1:8000/?welcome=1'),false);
    preview.localPreviewSettings.pauseWelcome=false;
    assert.equal(preview.opensDirectlyToHome('http://127.0.0.1:8000/'),false);
});

test('Story creation starts with media only and canceled or unsupported selection does not advance', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const stories = app.exportsOf('src/features/stories.js');
    stories.openStoryCreator();
    assert.equal(app.element('.story-media-step').hidden, false);
    assert.equal(app.element('.story-editor-step').hidden, true);
    assert.equal(state.pendingStoryMedia, null);
    const change = app.listeners.find(item => item.key === '#story-upload' && item.type === 'change').callback;
    change({target:{files:[],value:''}});
    assert.equal(app.element('.story-editor-step').hidden, true);
    const invalid = {files:[{type:'text/plain',name:'sample.txt'}],value:'sample.txt'};
    change({target:invalid});
    assert.equal(invalid.value, '');
    assert.equal(state.pendingStoryMedia, null);
    assert.equal(app.element('.story-editor-step').hidden, true);
});

test('Story picker captures a photo or a microphone-backed video into the normal Story editor',async()=>{
    const app=await loadApp();
    const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
    const choices=html.match(/<div class="story-media-choices">([\s\S]*?)<\/div>/)?.[1]||'';
    const camera=choices.indexOf('class="story-open-camera"'),files=choices.indexOf('class="story-upload-label"'),input=choices.indexOf('id="story-upload"');
    assert.ok(camera>=0&&files>camera&&input>files);
    assert.match(choices,/story-open-camera" type="button">Open camera/);
    assert.match(choices,/story-upload-label" for="story-upload">Choose from files/);
    assert.match(html,/story-camera-panel" hidden[^]*<video class="story-camera-preview" autoplay playsinline muted/);
    assert.match(html,/story-camera-capture">Take photo/);
    assert.match(html,/story-camera-record">Record video/);
    assert.match(html,/story-camera-switch">Switch camera/);

    const cameraTools=app.exportsOf('src/features/story-camera.js'),requests=[],stopped=[];
    app.context.navigator.mediaDevices={getUserMedia:async constraints=>{
        requests.push(constraints);
        const track={kind:constraints.audio?'audio':'video',stop(){stopped.push(this.kind);}};
        return {getTracks:()=>[track],getVideoTracks:()=>constraints.video?[track]:[],getAudioTracks:()=>constraints.audio?[track]:[]};
    }};
    class FakeMediaStream { constructor(tracks){this.tracks=tracks;} }
    class FakeMediaRecorder {
        static isTypeSupported(type){return type==='video/webm';}
        constructor(stream,options={}){this.stream=stream;this.mimeType=options.mimeType||'video/webm';this.state='inactive';this.handlers={};}
        addEventListener(type,callback){this.handlers[type]=callback;}
        start(timeslice){this.state='recording';this.timeslice=timeslice;}
        stop(){this.state='inactive';this.handlers.dataavailable?.({data:new Blob(['captured clip'],{type:this.mimeType})});this.handlers.stop?.();}
    }
    app.context.MediaStream=FakeMediaStream;app.context.MediaRecorder=FakeMediaRecorder;
    const video=app.element('.story-camera-preview');video.videoWidth=640;video.videoHeight=480;video.play=async()=>{};
    await cameraTools.openStoryCamera(video);
    assert.equal(video.srcObject!==null,true);
    assert.equal(requests[0].audio,false);
    assert.deepEqual({...requests[0].video.facingMode},{ideal:'environment'});
    await cameraTools.switchStoryCamera(video);
    assert.deepEqual({...requests[1].video.facingMode},{ideal:'user'});
    assert.ok(stopped.includes('video'),'switching stops the previous camera track');
    cameraTools.stopStoryCamera();
    assert.ok(stopped.filter(kind=>kind==='video').length>=2,'leaving camera mode stops the active track');

    const canvas=app.element('new-canvas'),draws=[];
    canvas.getContext=()=>({drawImage:(...args)=>draws.push(args)});
    canvas.toBlob=callback=>callback(new Blob(['local photo'],{type:'image/jpeg'}));
    const capture=await cameraTools.captureStoryPhoto(video);
    assert.deepEqual(draws[0].slice(1),[0,0,640,480]);
    assert.equal(capture.type,'image');assert.equal(capture.durationMs,30000);
    assert.equal(capture.media.startsWith('blob:'),true);
    URL.revokeObjectURL(capture.media);

    await cameraTools.openStoryCamera(video);
    let recordingStarted=false;
    const recording=cameraTools.startStoryVideoRecording({onStarted:()=>{recordingStarted=true;}});
    await new Promise(resolve=>setTimeout(resolve,0));
    assert.equal(recordingStarted,true);
    assert.deepEqual({...requests.at(-1)},{audio:true,video:false});
    cameraTools.stopStoryVideoRecording();
    const recorded=await recording;
    assert.equal(recorded.type,'video');assert.ok(recorded.durationMs<=240000);
    assert.equal(recorded.media.startsWith('blob:'),true);
    cameraTools.stopStoryCamera();URL.revokeObjectURL(recorded.media);
});

test('the first native photo or video selection opens the editor and paired mobile events do not clear it', async () => {
    for (const [type, name, mediaType] of [
        ['image/jpeg', 'phone-photo.jpg', 'image'],
        ['video/mp4', 'phone-video.mp4', 'video']
    ]) {
        const app = await loadApp();
        const {state} = app.exportsOf('src/core/state.js');
        const stories = app.exportsOf('src/features/stories.js');
        stories.openStoryCreator();
        const upload = app.element('#story-upload');
        const preview = app.element('.story-selected-preview');
        const appended = [];
        const created = [];
        app.document.createElement = tag => {
            const key = `phone-preview-${tag}-${created.length}`;
            const node = app.element(key);
            created.push({tag, key, node});
            return node;
        };
        preview.getBoundingClientRect = () => ({width: 390, height: 844});
        preview.append = node => appended.push({node, className: node.className});
        const file = new Blob(['phone fixture'], {type});
        Object.defineProperties(file, {name: {value: name}, lastModified: {value: 123}});
        upload.files = [file];
        upload.value = `C:\\fakepath\\${name}`;
        const handlers = app.listeners.filter(item => item.key === '#story-upload');
        const input = handlers.find(item => item.type === 'input').callback;
        const change = handlers.find(item => item.type === 'change').callback;

        input({type: 'input', target: upload});
        assert.equal(state.pendingStoryMedia, null, 'the picker input event does not hide the picker before it returns');
        assert.equal(app.element('.story-editor-step').hidden, true);
        change({target: upload});
        const selected = state.pendingStoryMedia;
        assert.equal(selected.type, mediaType, `${name} is accepted on its first selection`);
        assert.equal(selected.edits, undefined, 'the comparison frame is presentation-only');
        assert.equal(app.element('.story-editor-step').hidden, false);
        assert.equal(app.element('.story-media-step').hidden, true);
        assert.equal(upload.value, `C:\\fakepath\\${name}`, 'success does not reset the native picker during return');
        assert.deepEqual(appended.map(item => item.className), [mediaType === 'video' ? 'story-viewer-video' : 'story-viewer-image', 'story-frame-guide']);
        const source = fs.readFileSync(new URL('../src/features/stories.events.js', import.meta.url), 'utf8');
        assert.doesNotMatch(source, /story-frame-info|ResizeObserver/);
        const styles = fs.readFileSync(new URL('../styles/story-and-media-viewers.css', import.meta.url), 'utf8');
        assert.match(styles, /\.story-viewer,\s*\.story-create-dialog\.story-editing\s*\{[^}]*width:\s*min\(100vw,\s*440px\);[^}]*height:\s*min\(100dvh,\s*900px\);/);
        assert.match(styles, /\.story-viewer,\s*\.story-create-dialog\.story-editing\s*\{[^}]*overflow:\s*hidden;/);
        assert.match(styles, /\.story-editing \.story-selected-preview\s*\{[^}]*inset:\s*clamp\(88px,11dvh,112px\) 12px clamp\(156px,19dvh,190px\);[^}]*border-radius:\s*16px;/);
        assert.match(styles, /\.story-editing \.story-selected-preview :is\(img, video\)\s*\{[^}]*object-fit:\s*contain;/);
        assert.match(styles, /\.story-editing \.story-create-content\s*\{[^}]*inset:\s*0;[^}]*overflow:\s*hidden;/);
        assert.match(styles, /\.story-editing \.story-editor-step\s*\{[^}]*inset:\s*0;/);
        assert.match(styles, /\.story-editing \.story-selected-preview\s*\{[^}]*inset:\s*0;/);
        assert.match(styles, /\.story-frame-guide\s*\{[^}]*position:\s*absolute;[^}]*inset:\s*1px;[^}]*border:\s*1px solid rgba\(255,255,255,\.58\);[^}]*pointer-events:\s*none;/);
        assert.doesNotMatch(styles, /\.story-frame-info/);

        change({target: upload});
        assert.equal(state.pendingStoryMedia, selected, 'input/change pair is processed only once');
        assert.equal(app.element('.story-editor-step').hidden, false);
        URL.revokeObjectURL(selected.media);
    }
});

test('mobile input-only picker fallback accepts the first selected file after picker return', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const stories = app.exportsOf('src/features/stories.js');
    stories.openStoryCreator();
    const upload = app.element('#story-upload');
    const preview = app.element('.story-selected-preview');
    preview.append = () => {};
    const file = new Blob(['phone fixture'], {type: 'image/jpeg'});
    Object.defineProperties(file, {name: {value: 'first-photo.jpg'}, lastModified: {value: 456}});
    upload.files = [file];
    upload.value = 'C:\\fakepath\\first-photo.jpg';
    let fallback;
    app.context.window.setTimeout = callback => { fallback = callback; return 42; };
    app.context.window.clearTimeout = () => {};
    const input = app.listeners.find(item => item.key === '#story-upload' && item.type === 'input').callback;
    input({type: 'input', target: upload});
    assert.equal(state.pendingStoryMedia, null);
    assert.equal(typeof fallback, 'function');
    fallback();
    assert.equal(state.pendingStoryMedia.type, 'image');
    assert.equal(app.element('.story-editor-step').hidden, false);
    URL.revokeObjectURL(state.pendingStoryMedia.media);
});

test('phone generic MIME labels fall back to a recognized filename extension only', async () => {
    const app = await loadApp();
    const getType = app.exportsOf('src/features/create.js').getSupportedStoryFileType;
    assert.equal(getType({name: 'IMG_1001.HEIC', type: 'application/octet-stream'}), 'image');
    assert.equal(getType({name: 'VID_1002.MOV', type: 'binary/octet-stream'}), 'video');
    assert.equal(getType({name: 'photo.jpg', type: 'text/plain'}), null);
});

test('Story editor is outside the hidden media-picker container', () => {
    const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
    assert.match(html,/class="story-camera-panel"[\s\S]*?<\/div>\s*<\/div>\s*<div class="story-editor-step"/);
});

test('valid Story media reveals editor, Back is reversible, and invalid scheduling retains media', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const stories = app.exportsOf('src/features/stories.js');
    const events = app.exportsOf('src/features/stories.events.js');
    app.element('.story-selected-preview').append = () => {};
    stories.openStoryCreator();
    const change = app.listeners.find(item => item.key === '#story-upload' && item.type === 'change').callback;
    const file = new Blob(['fixture'],{type:'image/png'});
    change({target:{files:[file],value:'fixture.png'}});
    const media = state.pendingStoryMedia;
    assert.equal(media.type,'image');
    assert.equal(app.element('.story-editor-step').hidden,false);
    assert.equal(app.element('.story-create-dialog').classList.contains('story-editing'),true);
    assert.equal(app.element('.story-media-step').hidden,true);
    app.element('#story-caption').value='Retained caption';
    app.element('#story-audience').value='close-friends';
    app.element('#story-schedule-time').value='2030-01-01T10:30';
    events.handleStoryClick({target:{closest: selector => selector === '.story-create-back' ? {} : null}});
    assert.equal(app.element('.story-editor-step').hidden,false);
    assert.equal(app.element('.story-exit-backdrop').hidden,false);
    assert.equal(state.pendingStoryMedia,media);
    assert.equal(app.element('#story-caption').value,'Retained caption');
    assert.equal(app.element('#story-audience').value,'close-friends');
    assert.equal(app.element('#story-schedule-time').value,'2030-01-01T10:30');
    change({target:{files:[],value:''}});
    assert.equal(app.element('.story-editor-step').hidden,false);
    stories.closeStoryCreator();
    assert.equal(app.element('.story-exit-backdrop').hidden,false);
    assert.equal(state.pendingStoryMedia,media);
    app.element('#story-schedule-time').value='invalid';
    assert.equal(stories.scheduleOrPublishStory(media),false);
    assert.equal(state.pendingStoryMedia,media);
    URL.revokeObjectURL(media.media);
});

test('media decode failure shows an inline recovery message and blocks unusable Story actions', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    app.element('.story-selected-preview').append = () => {};
    app.exportsOf('src/features/stories.js').openStoryCreator();
    const change = app.listeners.find(item => item.key === '#story-upload' && item.type === 'change').callback;
    change({target:{files:[new Blob(['broken image'],{type:'image/heic'})],value:'photo.heic'}});
    const media = app.listeners.find(item => item.key === 'new-img' && item.type === 'error');
    assert.ok(media, 'selected media should handle browser decode errors');
    media.callback();
    assert.match(app.element('.story-selected-preview .story-media-preview-error').textContent,/could not be previewed here/);
    assert.equal(app.element('.story-publish-selected').disabled,true);
    assert.equal(app.element('.story-save-draft').disabled,true);
    assert.ok(state.pendingStoryMedia, 'keep the selected file available while the user recovers');
});

test('video Story preview shares viewer sizing classes and exposes reversible playback', async () => {
    const app = await loadApp();
    const stories = app.exportsOf('src/features/stories.js');
    const events = app.exportsOf('src/features/stories.events.js');
    let renderedMedia;
    app.element('.story-selected-preview').append = media => { if (media.className === 'story-viewer-video') renderedMedia=media; };
    stories.openStoryCreator();
    const change=app.listeners.find(item=>item.key==='#story-upload' && item.type==='change').callback;
    const file=new Blob(['video fixture'],{type:'video/mp4'});
    change({target:{files:[file],value:'fixture.mp4'}});
    assert.equal(renderedMedia.className,'story-viewer-video');
    assert.equal(renderedMedia.controls,true);
    assert.equal(renderedMedia.playsInline,true);
    assert.equal(app.element('.story-preview-play').hidden,false);
    let plays=0, pauses=0;
    const video=app.element('.story-selected-preview video');
    video.paused=true;video.play=()=>{plays++;return Promise.resolve();};video.pause=()=>{pauses++;};
    const event={target:{closest:selector=>selector==='.story-preview-play'?{}:null}};
    events.handleStoryClick(event);
    assert.equal(plays,1);
    video.paused=false;events.handleStoryClick(event);
    assert.equal(pauses,1);
    stories.setStoryCreationStep(false);
    assert.equal(pauses,2);
    URL.revokeObjectURL(app.exportsOf('src/core/state.js').state.pendingStoryMedia.media);
});

test('own Story opens creator when inactive while active Story keeps its viewer and separate Add action', async () => {
    const app = await loadApp();
    const {state} = app.exportsOf('src/core/state.js');
    const {currentUser} = app.exportsOf('src/data/sample-data.js');
    const stories = app.exportsOf('src/features/stories.js');
    state.stories=[];
    stories.openStoryGroup(currentUser.handle);
    assert.equal(app.element('.story-create-backdrop').hidden,false);
    assert.equal(app.element('.story-editor-step').hidden,true);
    stories.closeStoryCreator();
    state.stories=[{id:'active-fixture',handle:currentUser.handle,user:currentUser.name,avatar:currentUser.avatar,mine:true,type:'image',media:'fixture.png',caption:'',expiresAt:Date.now()+86400000}];
    stories.renderStories();
    assert.match(app.element('#stories-list').innerHTML,/story-add-control/);
    assert.match(app.element('#stories-list').innerHTML,/Your story/);
    app.element('.story-reply-form').reset = () => {};
    app.element('.story-like-button').firstChild = {textContent:''};
    stories.openStoryGroup(currentUser.handle);
    assert.equal(app.element('.story-viewer-backdrop').hidden,false);
    assert.equal(app.element('.story-create-backdrop').hidden,true);
    assert.equal(app.element('.story-viewer .story-settings-toggle').hidden,false);
    const events=app.exportsOf('src/features/stories.events.js');
    events.handleStoryClick({target:{closest:selector=>selector==='.story-settings-toggle'?{}:null}});
    assert.equal(app.element('.story-settings-backdrop').hidden,false,'gear opens the existing Story settings dialog');
    events.handleStoryClick({target:{closest:selector=>selector==='.story-settings-close'?{}:null}});
    assert.equal(app.element('.story-settings-backdrop').hidden,true);
    state.activeStorySequence=[{id:'other-fixture',handle:'noahvale',user:'Noah',avatar:'avatar.png',type:'image',media:'fixture.png',expiresAt:Date.now()+86400000}];
    stories.showStoryAtIndex(0);
    assert.equal(app.element('.story-viewer .story-settings-toggle').hidden,true,'Story settings shortcut is owner-only');
    app.exportsOf('src/features/stories.events.js').handleStoryOwnerClick({target:{closest: selector => selector === '.story-add-control' ? {} : null}});
    assert.equal(app.element('.story-create-backdrop').hidden,false);
    assert.equal(app.element('.story-editor-step').hidden,true);
});
