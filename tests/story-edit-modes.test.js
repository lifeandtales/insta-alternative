import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadApp } from './helpers/app-harness.js';

test('adjustments preview in a private session; discard preserves the baseline and Save creates one undo step',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
    state.pendingStoryMedia={type:'image',media:'fixture.png',edits:{filter:{brightness:1.2},layers:[{id:'text',type:'text',text:'Keep me'}]}};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
    assert.equal(tools.beginStoryMode('adjustments'),true);
    assert.equal(app.element('.story-create-dialog').classList.contains('story-mode-active'),true);
    tools.updateStoryAdjustment('brightness',90);tools.updateStoryAdjustment('hue',75);
    assert.equal(state.pendingStoryMedia.edits.filter.brightness,1.2);
    tools.finishStoryMode(false);
    assert.equal(state.pendingStoryMedia.edits.filter.brightness,1.2);
    assert.equal(state.pendingStoryMedia.edits.layers[0].text,'Keep me');
    tools.beginStoryMode('adjustments');tools.updateStoryAdjustment('brightness',80);tools.updateStoryAdjustment('hue',75);tools.finishStoryMode(true);
    assert.equal(state.pendingStoryMedia.edits.filter.brightness,1.6);assert.equal(state.pendingStoryMedia.edits.filter.hue,90);
    const click=app.listeners.find(l=>l.key==='document'&&l.type==='click'&&l.callback.toString().includes('story-undo')).callback;
    click({target:{closest:s=>s==='.story-undo'?{}:null}});
    assert.equal(state.pendingStoryMedia.edits.filter.brightness,1.2);assert.equal(state.pendingStoryMedia.edits.filter.hue,0);
});

test('Draw discard rolls back strokes and Save retains them without changing original media',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');state.pendingStoryMedia={type:'image',media:'original.png'};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
    const layer={id:'stroke',type:'draw',mode:'pen',color:'#ffffff',width:8,points:[{x:.2,y:.2},{x:.8,y:.8}]};
    tools.beginStoryMode('draw');tools.commitStoryEdit({layers:[layer]});tools.finishStoryMode(false);
    assert.equal(state.pendingStoryMedia.edits,undefined);
    tools.beginStoryMode('draw');tools.commitStoryEdit({layers:[layer]});tools.finishStoryMode(true);
    assert.equal(state.pendingStoryMedia.edits.layers[0].id,'stroke');assert.equal(state.pendingStoryMedia.media,'original.png');
});

test('adjustment slider mappings round-trip at neutral and bounds and hue/tint survive normalized playback',async()=>{
    const app=await loadApp();const helpers=app.exportsOf('src/features/story-edit-session.js');
    for(const key of ['brightness','contrast','warmth','tint','hue','saturation']){
        for(const v of [0,50,100])assert.equal(helpers.adjustmentToSlider(key,helpers.adjustmentFromSlider(key,v)),v);
    }
    const composition=app.exportsOf('src/features/story-composition.js');
    const edit=composition.storyComposition({filter:{hue:90,tint:.5,preset:'rose'}});
    assert.equal(edit.filter.hue,90);assert.equal(edit.filter.tint,.5);assert.equal(edit.filter.preset,'rose');
    assert.match(composition.compositionMediaStyle(edit).filter,/hue-rotate\(90deg\)/);
});

test('Back in a focused mode discards that mode and stays in the Story editor',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');state.pendingStoryMedia={type:'image',media:'fixture.png'};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();tools.beginStoryMode('adjustments');tools.updateStoryAdjustment('brightness',75);
    const listener=app.listeners.find(l=>l.key==='document'&&l.type==='click'&&l.callback.toString().includes('stopImmediatePropagation')&&l.callback.toString().includes('toolSession'));
    let stopped=false;listener.callback({target:{closest:s=>s==='.story-create-back'?{}:null},preventDefault(){},stopImmediatePropagation(){stopped=true;}});
    assert.equal(stopped,true);assert.equal(state.pendingStoryMedia.edits,undefined);
    assert.equal(app.element('.story-create-dialog').classList.contains('story-mode-active'),false);
    assert.equal(app.element('.story-exit-backdrop').hidden,true);
});

test('media alignment outline follows contained landscape media rather than the full Story frame',async()=>{
    const app=await loadApp();const stage=app.element('.story-selected-preview');stage.ownerDocument={};
    const media=stage.querySelector('img, video');Object.assign(media,{clientWidth:400,clientHeight:700,naturalWidth:800,naturalHeight:400,offsetLeft:0,offsetTop:0});
    app.exportsOf('src/features/story-composition.js').applyStoryComposition(stage,{edits:{media:{x:10,y:5,zoom:1,rotation:90}}},{editing:true});
    const style=stage.querySelector('.story-media-outline').style;
    assert.equal(style.width,'400px');assert.equal(style.height,'200px');assert.equal(style.top,'250px');
    assert.equal(style.transform,'translate(40px, 35px) scale(1) rotate(90deg)');
});


test('Brightness 40 and Contrast 60 retain independent values when saving adjustments',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');state.pendingStoryMedia={type:'image',media:'fixture.png'};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();tools.beginStoryMode('adjustments');
    tools.updateStoryAdjustment('brightness',40);tools.updateStoryAdjustment('contrast',60);tools.finishStoryMode(true);
    const {adjustmentToSlider}=app.exportsOf('src/features/story-edit-session.js');
    assert.equal(adjustmentToSlider('brightness',state.pendingStoryMedia.edits.filter.brightness),40);
    assert.equal(adjustmentToSlider('contrast',state.pendingStoryMedia.edits.filter.contrast),60);
    assert.equal(state.pendingStoryMedia.edits.filter.saturation,1);
});

test('video trim preserves mute/volume and the main Story sound button toggles mute',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');state.pendingStoryMedia={type:'video',media:'fixture.webm',edits:{video:{muted:true,volume:.4,start:0,end:null}}};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
    assert.equal(app.element('.story-preview-sound').hidden,false);
    assert.equal(app.element('.story-preview-sound').getAttribute('aria-label'),'Unmute video sound');
    const form={dataset:{tool:'video'},elements:{start:{value:'1'},end:{value:'3'}},matches:()=>true};
    app.listeners.find(l=>l.key==='document'&&l.type==='submit'&&l.callback.toString().includes('applyTool')).callback({target:form,preventDefault(){}});
    assert.equal(state.pendingStoryMedia.edits.video.start,1);assert.equal(state.pendingStoryMedia.edits.video.end,3);
    assert.equal(state.pendingStoryMedia.edits.video.muted,true);assert.equal(state.pendingStoryMedia.edits.video.volume,.4);
    app.listeners.find(l=>l.key==='document'&&l.type==='click'&&l.callback.toString().includes('story-preview-sound')).callback({target:{closest:s=>s==='.story-preview-sound'?{}:null}});
    assert.equal(state.pendingStoryMedia.edits.video.muted,false);
    assert.equal(app.element('.story-preview-sound').getAttribute('aria-label'),'Mute video sound');
});

test('Story sticker picker opens on Emojis and keeps Stickers, Emojis and blank GIFs separate',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
    state.pendingStoryMedia={type:'image',media:'fixture.png'};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
    const click=app.listeners.find(item=>item.key==='document'&&item.type==='click'&&item.callback.toString().includes('story-tools-open')).callback;
    const makeTarget=(selector,data={})=>({closest:value=>value===selector?{dataset:data,focus(){}}:null});
    click({target:makeTarget('.story-tools-open')});
    click({target:makeTarget('[data-story-tool]',{storyTool:'sticker'})});
    let markup=app.element('.story-tool-options').innerHTML;
    assert.equal(app.element('.story-tools-backdrop').classList.contains('story-sticker-picker-active'),true);
    assert.match(markup,/data-story-sticker-section="emojis"[^>]*aria-selected="true"/);
    assert.match(markup,/data-story-sticker="🙂"/);assert.doesNotMatch(markup,/data-story-sticker-label=/);
    const keydown=app.listeners.find(item=>item.key==='document'&&item.type==='keydown'&&item.callback.toString().includes('story-sticker-tab-')).callback;
    keydown({target:makeTarget('[data-story-sticker-section]',{storyStickerSection:'emojis'}),key:'ArrowLeft',preventDefault(){}});
    assert.match(app.element('.story-tool-options').innerHTML,/data-story-sticker-section="stickers"[^>]*aria-selected="true"/);
    click({target:makeTarget('[data-story-sticker-section]',{storyStickerSection:'stickers'})});
    markup=app.element('.story-tool-options').innerHTML;
    assert.match(markup,/story-static-sticker-grid/);assert.match(markup,/GOOD VIBES/);assert.doesNotMatch(markup,/data-story-sticker="🙂"/);
    click({target:makeTarget('[data-story-sticker-section]',{storyStickerSection:'gifs'})});
    markup=app.element('.story-tool-options').innerHTML;
    assert.equal(app.element('.story-tools-backdrop').classList.contains('story-sticker-picker-active'),true);
    assert.match(markup,/data-story-sticker-section="gifs"[^>]*aria-selected="true"/);
    assert.match(markup,/role="tabpanel" aria-labelledby="story-sticker-tab-gifs"><div class="story-sticker-empty" aria-hidden="true"><\/div><\/div>/);
    assert.doesNotMatch(markup,/img|suggest|trending|file|data-story-sticker=/i);
    click({target:makeTarget('.story-tools-back')});
    assert.equal(app.element('.story-tools-backdrop').classList.contains('story-tool-active'),false);
    assert.equal(app.element('.story-tools-backdrop').classList.contains('story-sticker-picker-active'),false);
    click({target:makeTarget('.story-tools-open')});
    click({target:makeTarget('[data-story-tool]',{storyTool:'sticker'})});
    click({target:makeTarget('[data-story-sticker]',{storySticker:'🙂'})});
    assert.equal(state.pendingStoryMedia.edits.layers[0].type,'emoji');assert.equal(state.pendingStoryMedia.edits.layers[0].text,'🙂');
});

test('Story sticker tabs keep one responsive shell and scroll content inside it',async()=>{
    const css=fs.readFileSync(new URL('../styles/story-and-media-viewers.css',import.meta.url),'utf8');
    assert.match(css,/\.story-sticker-picker-active \.story-tools-dialog\s*\{[^}]*height:\s*min\(564px,\s*calc\(100dvh\s*-\s*36px\)\);[^}]*overflow:\s*hidden;/);
    assert.match(css,/\.story-sticker-picker-active \.story-tool-options\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/);
    assert.match(css,/\.story-sticker-picker-active \.story-sticker-section\s*\{[^}]*flex:\s*1 1 auto;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/);
});

test('Story tool presents Tune while retaining the existing adjustment mode',async()=>{
    const app=await loadApp();
    const html=fs.readFileSync(new URL('../index.html',import.meta.url),'utf8');
    assert.match(html,/<button[^>]*data-story-tool="adjustments"[^>]*>[\s\S]*?<span>Tune<\/span><\/button>/);
    const {state}=app.exportsOf('src/core/state.js');state.pendingStoryMedia={type:'image',media:'fixture.png'};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
    assert.equal(tools.beginStoryMode('adjustments'),true);
    assert.equal(app.element('.story-edit-mode-controls').getAttribute('aria-label'),'Tune controls');
    tools.finishStoryMode(false);
    assert.equal(app.element('.story-edit-mode-controls').getAttribute('aria-label'),'Story editing controls');
});

test('Story text editing has an input border but placed overlays only outline for keyboard focus',async()=>{
    const css=fs.readFileSync(new URL('../styles/story-and-media-viewers.css',import.meta.url),'utf8');
    const composition=fs.readFileSync(new URL('../src/features/story-composition.js',import.meta.url),'utf8');
    assert.doesNotMatch(css,/\.story-layer-selected(?:\.story-layer-text)?\s*\{[^}]*outline:/);
    assert.match(css,/\.story-composition-layer:focus-visible\s*\{\s*outline:\s*2px solid #fff;/);
    assert.match(css,/\.story-inline-text textarea\s*\{[^}]*border:\s*1px dashed #[a-f0-9]{6,8};[^}]*border-radius:\s*8px;/i);
    assert.match(composition,/node\.style\.maxWidth=`\$\{number\(layer\.width,.8,.1,.9\)\*100\}%`/);
    assert.doesNotMatch(composition,/node\.style\.width=`\$\{number\(layer\.width/);
});

test('Story Text color control uses honeycomb swatches and keeps native color input accessible',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js');
    state.pendingStoryMedia={type:'image',media:'fixture.png'};
    app.element('.story-selected-preview').getBoundingClientRect=()=>({left:0,top:0,width:390,height:700});
    const form=app.element('.story-inline-text form'),textarea=app.element('.story-inline-text form textarea'),colorInput=app.element('.story-inline-text form input[name="color"]'),picker=app.element('.story-inline-text form .story-color-picker');
    form.dataset.tool='text';form.elements={font:{value:'sans'},size:{value:'7'},color:colorInput};
    form.matches=selector=>selector==='.story-inline-form';
    form.querySelector=selector=>selector==='textarea'?textarea:selector==='input[name="color"]'?colorInput:app.element(`.story-inline-text form ${selector}`);
    colorInput.value='#ffffff';colorInput.closest=selector=>selector==='.story-color-picker'?picker:null;
    picker.style.setProperty=(name,value)=>{picker.style[name]=value;};
    const click=app.listeners.find(item=>item.key==='document'&&item.type==='click'&&item.callback.toString().includes('story-tools-open')).callback;
    const target=(selector,data={})=>({closest:value=>value===selector?{dataset:data,focus(){}}:null});
    click({target:target('.story-tools-open')});click({target:target('[data-story-tool]',{storyTool:'text'})});
    assert.match(app.element('.story-inline-text').innerHTML,/story-color-picker[^>]*selected-story-color/);
    assert.match(app.element('.story-inline-text').innerHTML,/<svg viewBox="0 0 24 24"><g[^>]*><path fill="#f472b6"/);
    assert.match(app.element('.story-inline-text').innerHTML,/<input name="color" type="color" value="#ffffff" aria-label="Text color" \/>/);
    const input=app.listeners.find(item=>item.key==='document'&&item.type==='input'&&item.callback.toString().includes('syncInlineTextStyle')).callback;
    form.elements.color.value='#ff0000';colorInput.value='#ff0000';
    input({target:{name:'color',closest:selector=>['.story-inline-form','.story-tool-form'].includes(selector)?form:null}});
    assert.equal(picker.style['--selected-story-color'],'#ff0000');
});

test('selected Story sticker becomes a draggable, undoable sticker layer',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');
    state.pendingStoryMedia={type:'image',media:'fixture.png'};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
    const click=app.listeners.find(item=>item.key==='document'&&item.type==='click'&&item.callback.toString().includes('story-tools-open')).callback;
    const makeTarget=(selector,data={})=>({closest:value=>value===selector?{dataset:data,focus(){}}:null});
    click({target:makeTarget('.story-tools-open')});click({target:makeTarget('[data-story-tool]',{storyTool:'sticker'})});
    click({target:makeTarget('[data-story-sticker-label]',{storyStickerLabel:'good-vibes'})});
    const layer=state.pendingStoryMedia.edits.layers[0];
    assert.equal(layer.type,'sticker');assert.equal(layer.text,'GOOD VIBES');assert.equal(layer.background,'#ef72b0');
    assert.equal(app.element('.story-tools-backdrop').hidden,true);
    const undo=app.listeners.find(item=>item.key==='document'&&item.type==='click'&&item.callback.toString().includes('story-undo')).callback;
    undo({target:{closest:selector=>selector==='.story-undo'?{}:null}});
    assert.equal(state.pendingStoryMedia.edits.layers.length,0);
});

test('long Story videos use only the first four minutes and legacy edits cannot seek beyond it',async()=>{
    const app=await loadApp();const {storyVideoRange,storyComposition}=app.exportsOf('src/features/story-composition.js');
    let range=storyVideoRange({edits:{}},600);assert.equal(range.start,0);assert.equal(range.end,240);assert.equal(range.duration,240);
    range=storyVideoRange({edits:{}},45);assert.equal(range.duration,45);
    range=storyVideoRange({edits:{video:{start:600,end:900}}},1000);assert.ok(range.start<240);assert.equal(range.end,240);
    assert.equal(storyComposition({video:{end:999}}).video.end,240);
});

test('video trim rejects times past the first four minutes before changing the saved edit',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');state.pendingStoryMedia={type:'video',media:'fixture.webm'};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
    const error={textContent:''},form={dataset:{tool:'video'},elements:{start:{value:'250'},end:{value:'300'}},matches:()=>true,querySelector:()=>error};
    app.element('.story-selected-preview').querySelector('video').duration=600;
    const submit=app.listeners.find(l=>l.key==='document'&&l.type==='submit'&&l.callback.toString().includes('applyTool')).callback;
    submit({target:form,preventDefault(){}});
    assert.match(error.textContent,/first 240/);assert.equal(state.pendingStoryMedia.edits,undefined);
});
