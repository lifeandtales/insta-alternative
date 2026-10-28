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
    const media=stage.querySelector(':scope > img, :scope > video');Object.assign(media,{clientWidth:400,clientHeight:700,naturalWidth:800,naturalHeight:400,offsetLeft:0,offsetTop:0});
    app.exportsOf('src/features/story-composition.js').applyStoryComposition(stage,{edits:{media:{x:10,y:5,zoom:1,rotation:90}}},{editing:true});
    const style=stage.querySelector(':scope > .story-media-outline').style;
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

test('Story sticker picker opens on Emojis and keeps Stickers, Emojis and GIFs separate',async()=>{
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
    assert.match(markup,/Search GIFs/);assert.match(markup,/GIF search will be available/);
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

test('Text and Draw share exactly 30 accessible circular color swatches',async()=>{
    const tools=(await loadApp()).exportsOf('src/features/story-tools.js');
    const text=tools.storyTextColorPicker('#ffffff');
    const draw=tools.storyTextColorPicker('#00aaff',{name:'draw-color',label:'Drawing color',dataAttr:'data-story-draw-color'});
    for(const markup of [text,draw]){
        assert.match(markup,/story-color-picker-icon[^]*<svg viewBox="0 0 24 24"><g[^]*<path fill="#f472b6"/);
        assert.match(markup,/data-story-color-toggle[^]*aria-expanded="false"[^]*aria-controls="story-color-chart-/);
        assert.match(markup,/data-story-color-chart hidden/);
        assert.equal((markup.match(/data-story-color-choice=/g)||[]).length,30);
        assert.match(markup,/role="radiogroup" aria-label="[^"]+ choices"/);
        assert.match(markup,/data-story-color-choice="#000000"[^]*aria-label="[^"]+: Black"/);
        assert.match(markup,/data-story-color-choice="#ffffff"[^]*aria-label="[^"]+: White"/);
        assert.match(markup,/data-story-color-choice="#f44336"[^]*aria-label="[^"]+: Red"/);
        assert.match(markup,/data-story-color-value aria-live="polite"/);
    }
    assert.match(text,/--selected-story-color:#ffffff/);assert.match(draw,/--selected-story-color:#00aaff/);
    assert.match(text,/input type="hidden" name="color" value="#ffffff" data-story-text-color/);
    assert.match(draw,/input type="hidden" name="draw-color" value="#00aaff" data-story-draw-color/);
    const eventApp=await loadApp();
    assert.equal(tools.storyColorSwatches.length,30);
    assert.equal(new Set(tools.storyColorSwatches.map(item=>item.color)).size,30);
    assert.ok(tools.storyColorSwatches.some(item=>item.name==='Light red'));
    assert.ok(tools.storyColorSwatches.some(item=>item.name==='Dark violet'));
    assert.equal(eventApp.listeners.filter(listener=>listener.key==='document'&&listener.type==='click'&&listener.callback.toString().includes('data-story-color-choice')).length,1);
    assert.equal(eventApp.listeners.filter(listener=>listener.key==='document'&&listener.type==='keydown'&&listener.callback.toString().includes('data-story-color-choice')).length,1);
    assert.doesNotMatch(fs.readFileSync(new URL('../src/features/story-tools.js',import.meta.url),'utf8'),/data-story-color-plane|data-story-color-hue|colorPickerPointer/);
    assert.deepEqual({...tools.hexToHsv('#ff0000')},{h:0,s:1,v:1});
    assert.equal(tools.hsvToHex(240,1,1),'#0000ff');assert.equal(tools.hsvToHex(0,0,0),'#000000');
    assert.equal(tools.storyColorAtPoint(0,.5,.5),'#804040');
    assert.deepEqual({...tools.moveStoryColorSelection({h:210,s:.5,v:.5},'ArrowRight')},{h:210,s:.51,v:.5});
    assert.deepEqual({...tools.moveStoryColorSelection({h:210,s:.5,v:.5},'ArrowUp',true)},{h:210,s:.5,v:.6});
    assert.equal(tools.moveStoryColorSelection({h:0,s:1,v:1},'Enter'),null);
    assert.equal(JSON.stringify(tools.storyLocationEditPosition()),JSON.stringify({x:.5,y:.5,width:.8,rotation:0}));
    const newLocation=tools.buildStoryTextLayer(null,{id:'new-place',text:'Here',type:'location'});
    assert.deepEqual({x:newLocation.x,y:newLocation.y,width:newLocation.width,rotation:newLocation.rotation},{x:.5,y:.5,width:.8,rotation:0});
});

test('Filters and Tune show Cancel left and Done right while Draw keeps Save and Discard',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js');
    state.pendingStoryMedia={type:'image',media:'fixture.png'};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
    for(const kind of ['filters','adjustments']){
        tools.beginStoryMode(kind);
        const markup=app.element('.story-edit-mode-controls').innerHTML;
        assert.match(markup,/story-mode-actions-done-cancel[^]*data-story-mode-discard>Cancel<\/button>[^]*data-story-mode-save>Done<\/button>/);
        tools.finishStoryMode(false);
    }
    tools.beginStoryMode('draw');
    const draw=app.element('.story-edit-mode-controls').innerHTML;
    assert.match(draw,/data-story-mode-save>Save changes<\/button>[^]*data-story-mode-discard>Discard changes<\/button>/);
});

test('Draw offers Freehand, Dotted, Highlight and Colorful while keeping legacy Line and Arrow out of new controls',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js');state.pendingStoryMedia={type:'image',media:'fixture.png'};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();tools.beginStoryMode('draw');
    const markup=app.element('.story-edit-mode-controls').innerHTML;
    for(const mode of ['pen','dotted','highlight','colorful'])assert.match(markup,new RegExp(`data-story-draw-mode="${mode}"`));
    assert.doesNotMatch(markup,/data-story-draw-mode="(?:line|arrow)"/);
    assert.match(markup,/Colorful draws a smooth rainbow stroke/);
});

test('Dotted and Colorful drawing exports use visible dots and deterministic continuous path colors; legacy line and arrow still render',async()=>{
    const app=await loadApp(),composition=app.exportsOf('src/features/story-composition.js'),paint=app.exportsOf('src/features/story-export.js').paintLayer;
    const points=[{x:.05,y:.1},{x:.5,y:.35},{x:.9,y:.8}],segments=composition.storyDrawingSegments(points);
    assert.ok(segments.length>10);
    assert.equal(JSON.stringify(composition.storyDrawingSegments(points)),JSON.stringify(segments));
    assert.notEqual(segments[0].color,segments.at(-1).color);
    for(let index=1;index<segments.length;index++)assert.ok(Math.hypot(segments[index].from.x-segments[index-1].to.x,segments[index].from.y-segments[index-1].to.y)<1e-8);
    const makeContext=()=>({strokeStyles:[],dash:null,strokes:0,save(){},restore(){},scale(){},beginPath(){},moveTo(){},lineTo(){},stroke(){this.strokeStyles.push(this.strokeStyle);this.strokes++;},setLineDash(value){this.dash=value;}});
    const colorful=makeContext();paint(colorful,{type:'draw',mode:'colorful',width:8,points},1000,1000);
    assert.equal(JSON.stringify(colorful.strokeStyles),JSON.stringify(segments.map(segment=>segment.color)));
    const persisted=composition.storyComposition({layers:[{id:'rainbow',type:'draw',mode:'colorful',points}]});
    assert.equal(persisted.layers[0].mode,'colorful');assert.equal(JSON.stringify(persisted.layers[0].points),JSON.stringify(points));
    const dotted=makeContext();paint(dotted,{type:'draw',mode:'dotted',color:'#123456',width:8,points},1000,1000);
    assert.equal(JSON.stringify(dotted.dash),JSON.stringify([4.4,13.6]));
    const line=makeContext();paint(line,{type:'draw',mode:'line',color:'#123456',width:8,points},1000,1000);assert.equal(line.strokes,1);
    const arrow=makeContext();paint(arrow,{type:'draw',mode:'arrow',color:'#123456',width:8,points},1000,1000);assert.equal(arrow.strokes,2);
});

test('focused Story text mode offers all 15 circular fonts without a size slider and commits placement-preserving edits',async()=>{
    const app=await loadApp(),tools=app.exportsOf('src/features/story-tools.js');
    const source=fs.readFileSync(new URL('../src/features/story-tools.js',import.meta.url),'utf8');
    const css=fs.readFileSync(new URL('../styles/story-and-media-viewers.css',import.meta.url),'utf8');
    assert.match(source,/storyFontStyles\.map\(font=>`<button type="button" data-story-font=/);
    assert.doesNotMatch(source,/name="size" type="range" aria-label="Text size"/);
    assert.match(css,/\.story-mode-active \.story-inline-text\.story-text-mode\s*\{[^}]*display:\s*block!important/);
    assert.match(css,/\.story-font-strip\s*\{[^}]*overflow-x:\s*auto/);
    assert.match(css,/\.story-mode-active :is\(\.story-tools-open,\.story-editor-controls,\.story-draw-done,\.story-preview-play,\.story-preview-sound\)/);
    const existing={id:'kept',type:'text',text:'old',x:.27,y:.63,width:.55,rotation:28,size:11,other:'kept'};
    const edited=tools.buildStoryTextLayer(existing,{id:'ignored',text:'new @friend',font:'serif',color:'#ee00aa',mentions:[{id:'a',handle:'friend'}]});
    assert.deepEqual({id:edited.id,x:edited.x,y:edited.y,width:edited.width,rotation:edited.rotation,size:edited.size,other:edited.other},{id:'kept',x:.27,y:.63,width:.55,rotation:28,size:11,other:'kept'});
    assert.equal(edited.text,'new @friend');assert.equal(edited.color,'#ee00aa');assert.equal(edited.font,'serif');
    const fresh=tools.buildStoryTextLayer(null,{id:'new',text:'hello'});assert.equal(fresh.id,'new');assert.equal(fresh.x,.5);assert.equal(fresh.y,.4);
});

test('Draw size bar maps 0–100% onto visible supported stroke widths and preserves saved stroke widths',async()=>{
    const app=await loadApp(),tools=app.exportsOf('src/features/story-tools.js');
    assert.equal(tools.storyDrawingWidthFromPercent(0),1);assert.equal(tools.storyDrawingWidthFromPercent(100),40);
    assert.equal(tools.storyDrawingPercentFromWidth(8),18);assert.equal(tools.storyDrawingPercentFromWidth(40),100);
    assert.equal(tools.storyDrawingWidthFromPercent(50),20.5);
    const css=fs.readFileSync(new URL('../styles/story-and-media-viewers.css',import.meta.url),'utf8');
    const source=fs.readFileSync(new URL('../src/features/story-tools.js',import.meta.url),'utf8');
    assert.match(source,/aria-label="Drawing size"/);assert.match(source,/data-story-draw-size/);assert.match(source,/data-story-draw-color/);assert.match(source,/drawMode\.color=color/);assert.match(source,/storyTextColorPicker\(drawMode\.color/);
    assert.match(css,/\.story-draw-size input\[type="range"\]\s*\{[^}]*flex:\s*1/);
    const {state}=app.exportsOf('src/core/state.js');state.pendingStoryMedia={type:'image',media:'fixture.png'};tools.prepareStoryTools();tools.beginStoryMode('draw');
    const stroke={id:'existing-stroke',type:'draw',mode:'pen',color:'#ffffff',width:8,points:[{x:.1,y:.2},{x:.5,y:.6}]};tools.commitStoryEdit({layers:[stroke]});
    const input=app.listeners.find(item=>item.key==='document'&&item.type==='input'&&item.callback.toString().includes('data-story-draw-width')).callback;
    const sizeTarget=value=>({value,setAttribute(){},closest:selector=>selector==='[data-story-draw-width]'?{}:null});
    input({target:sizeTarget('0')});input({target:sizeTarget('100')});tools.finishStoryMode(true);
    assert.equal(state.pendingStoryMedia.edits.layers[0].width,8);assert.equal(state.pendingStoryMedia.edits.layers[0].points.length,2);
});

test('Location edits inline with a fixed pin and preserve existing placement on Done',async()=>{
    const app=await loadApp(),tools=app.exportsOf('src/features/story-tools.js');
    const source=fs.readFileSync(new URL('../src/features/story-tools.js',import.meta.url),'utf8');
    const css=fs.readFileSync(new URL('../styles/story-and-media-viewers.css',import.meta.url),'utf8');
    assert.match(source,/story-location-entry"><span aria-hidden="true">📍<\/span><input name="text" type="text"/);
    assert.match(source,/createStoryEditSession\('location',pending\(\)\.edits\)/);assert.match(source,/const editPosition=storyLocationEditPosition\(\);box\.style\.left=`\$\{editPosition\.x\*100\}%`;box\.style\.top=`\$\{editPosition\.y\*100\}%`;/);
    assert.doesNotMatch(source,/story-inline-location-form[^]*Location<input/);
    assert.match(css,/\.story-mode-active \.story-inline-text\.story-location-text-mode\s*\{[^}]*display:\s*block!important/);
    assert.match(css,/\.story-location-entry:focus-within\s*\{[^}]*outline:\s*2px solid/);assert.match(css,/\.story-inline-text\s*\{[^}]*transform:\s*translate\(-50%,-50%\)/);
    const existing={id:'place',type:'location',text:'Old place',x:.72,y:.31,width:.46,rotation:-17,size:6,extra:'preserved'};
    const edited=tools.buildStoryTextLayer(existing,{id:'unused',text:'New place',type:'location'});
    assert.deepEqual({id:edited.id,type:edited.type,x:edited.x,y:edited.y,width:edited.width,rotation:edited.rotation,extra:edited.extra},{id:'place',type:'location',x:.72,y:.31,width:.46,rotation:-17,extra:'preserved'});
    assert.equal(edited.text,'New place');
});

test('Location re-edit opens centered while Cancel restores and Done edits the saved layer in place',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js');
    const original={id:'place',type:'location',text:'Old place',x:.78,y:.29,width:.47,rotation:-23,size:7};
    state.pendingStoryMedia={type:'image',media:'fixture.png',edits:{layers:[original]}};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
    const click=app.listeners.find(item=>item.key==='document'&&item.type==='click'&&item.callback.toString().includes('data-story-text-cancel')).callback;
    const open=()=>tools.openInlineLocation('place');
    open();let box=app.element('.story-inline-text');
    assert.equal(box.style.left,'50%');assert.equal(box.style.top,'50%');assert.equal(box.style.width,'80%');assert.equal(box.style.rotate,'0deg');
    app.element('.story-inline-text form textarea').value='Canceled edit';
    click({target:{closest:selector=>selector==='[data-story-text-cancel]'?{}:null}});
    assert.equal(state.pendingStoryMedia.edits.layers[0].text,'Old place');assert.equal(state.pendingStoryMedia.edits.layers[0].x,.78);
    open();app.element('.story-inline-text form textarea').value='Updated place';
    click({target:{closest:selector=>selector==='[data-story-text-done]'?{}:null}});
    const saved=state.pendingStoryMedia.edits.layers[0];
    assert.equal(saved.id,'place');assert.equal(saved.text,'Updated place');assert.equal(saved.x,.78);assert.equal(saved.y,.29);assert.equal(saved.width,.47);assert.equal(saved.rotation,-23);
    const undo=app.listeners.find(item=>item.key==='document'&&item.type==='click'&&item.callback.toString().includes('story-undo')).callback;
    undo({target:{closest:selector=>selector==='.story-undo'?{}:null}});assert.equal(state.pendingStoryMedia.edits.layers[0].text,'Old place');
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


test('emoji names and symbols search the full catalog; sticker and GIF searches keep separate queries',async()=>{
    const app=await loadApp();const {state}=app.exportsOf('src/core/state.js');state.pendingStoryMedia={type:'image',media:'fixture.png'};
    const tools=app.exportsOf('src/features/story-tools.js');tools.prepareStoryTools();
    assert.ok(tools.searchStoryEmojis('butterfly').some(item=>item[0]==='🦋'));
    assert.ok(tools.searchStoryEmojis('giraffe').some(item=>item[0]==='🦒'));
    assert.ok(tools.searchStoryEmojis('🦒').some(item=>item[0]==='🦒'));
    assert.equal(tools.searchStoryEmojis('zzznomatchzzz').length,0);
    const click=app.listeners.find(l=>l.key==='document'&&l.type==='click'&&l.callback.toString().includes('story-undo')).callback;
    const target=(selector,dataset={})=>({dataset,closest:s=>s===selector?{dataset,focus(){}}:null});
    click({target:target('[data-story-tool]',{storyTool:'sticker'})});
    assert.match(app.element('.story-tool-options').innerHTML,/type="search"[^>]*aria-label="Search emojis"/);
    const input=app.listeners.find(l=>l.key==='document'&&l.type==='input'&&l.callback.toString().includes('story-sticker-search')).callback;
    input({target:{closest:s=>s==='[data-story-sticker-search]'?{value:'giraffe'}:null}});
    assert.match(app.element('#story-sticker-panel').innerHTML,/🦒/);
    click({target:target('[data-story-sticker-section]',{storyStickerSection:'stickers'})});
    input({target:{closest:s=>s==='[data-story-sticker-search]'?{value:'vibes'}:null}});
    assert.match(app.element('#story-sticker-panel').innerHTML,/GOOD VIBES/);assert.doesNotMatch(app.element('#story-sticker-panel').innerHTML,/LOVE THIS/);
    click({target:target('[data-story-sticker-section]',{storyStickerSection:'gifs'})});
    assert.match(app.element('.story-tool-options').innerHTML,/Search GIFs/);
    input({target:{closest:s=>s==='[data-story-sticker-search]'?{value:'dancing'}:null}});
    assert.match(app.element('#story-sticker-panel').innerHTML,/catalog is connected/);
    click({target:target('[data-story-sticker-section]',{storyStickerSection:'emojis'})});
    assert.match(app.element('.story-tool-options').innerHTML,/value="giraffe"/);
});

test('an interrupted media pinch cannot move or scale the next uploaded Story',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js');
    const tools=app.exportsOf('src/features/story-tools.js'),stage=app.element('.story-selected-preview');
    stage.getBoundingClientRect=()=>({left:0,top:0,width:400,height:800});
    stage.setPointerCapture=()=>{};
    const fire=(type,event)=>app.listeners.find(l=>l.key==='.story-selected-preview'&&l.type===type).callback(event);
    const point=(pointerId,x,y)=>({pointerId,clientX:x,clientY:y,target:{closest:()=>null},preventDefault(){}});
    state.pendingStoryMedia={type:'image',media:'first.png'};tools.prepareStoryTools();
    fire('pointerdown',point(1,100,200));fire('pointerdown',point(2,300,200));
    fire('pointermove',point(2,390,500));
    state.pendingStoryMedia={type:'image',media:'second.png'};tools.prepareStoryTools();
    fire('pointermove',point(1,390,700));fire('pointerup',point(2,390,700));
    assert.equal(state.pendingStoryMedia.edits,undefined,'previous fingers cannot commit a transform to the new upload');
    fire('pointerdown',point(3,200,400));fire('pointermove',point(3,240,400));fire('pointerup',point(3,240,400));
    assert.equal(state.pendingStoryMedia.edits.media.zoom,1);
    assert.ok(Math.abs(state.pendingStoryMedia.edits.media.x-10)<.001);
    assert.equal(state.pendingStoryMedia.edits.media.y,0);
});

test('lost capture cancels an unfinished gesture without saving its transform',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js');
    const tools=app.exportsOf('src/features/story-tools.js'),stage=app.element('.story-selected-preview');
    stage.getBoundingClientRect=()=>({left:0,top:0,width:400,height:800});stage.setPointerCapture=()=>{};
    state.pendingStoryMedia={type:'image',media:'photo.png'};tools.prepareStoryTools();
    const fire=(type,x,y)=>app.listeners.find(l=>l.key==='.story-selected-preview'&&l.type===type).callback({pointerId:1,clientX:x,clientY:y,target:{closest:()=>null},preventDefault(){}});
    fire('pointerdown',100,200);fire('pointermove',300,700);fire('lostpointercapture',300,700);fire('pointerup',300,700);
    assert.equal(state.pendingStoryMedia.edits,undefined);
});

test('footer controls fade only during a drag near their area and restore on release or cancellation',async()=>{
    const app=await loadApp(),{state}=app.exportsOf('src/core/state.js');
    const tools=app.exportsOf('src/features/story-tools.js'),stage=app.element('.story-selected-preview'),dialog=app.element('.story-create-dialog'),footer=app.element('.story-editor-controls');
    footer.hidden=false;footer.getBoundingClientRect=()=>({left:0,top:600,right:400,bottom:800});
    stage.getBoundingClientRect=()=>({left:0,top:0,width:400,height:800});stage.setPointerCapture=()=>{};
    state.pendingStoryMedia={type:'image',media:'photo.png'};tools.prepareStoryTools();
    const fire=(type,x,y)=>app.listeners.find(l=>l.key==='.story-selected-preview'&&l.type===type).callback({pointerId:1,clientX:x,clientY:y,target:{closest:()=>null},preventDefault(){}});
    fire('pointerdown',100,200);fire('pointermove',100,400);
    assert.equal(dialog.classList.contains('story-footer-drag-over'),false);
    fire('pointermove',100,650);assert.equal(dialog.classList.contains('story-footer-drag-over'),true);
    fire('pointermove',100,400);assert.equal(dialog.classList.contains('story-footer-drag-over'),false);
    fire('pointermove',100,650);fire('pointerup',100,650);assert.equal(dialog.classList.contains('story-footer-drag-over'),false);
    fire('pointerdown',100,400);fire('pointermove',100,650);fire('pointercancel',100,650);
    assert.equal(dialog.classList.contains('story-footer-drag-over'),false);
    tools.updateStoryEditorDrag({clientX:100,clientY:650});
    state.pendingStoryMedia={type:'image',media:'next.png'};tools.prepareStoryTools();
    assert.equal(dialog.classList.contains('story-footer-drag-over'),false);
});

test('any transformed object edge triggers the footer fade even when its center and finger remain above it',async()=>{
    const app=await loadApp(),tools=app.exportsOf('src/features/story-tools.js'),dialog=app.element('.story-create-dialog'),footer=app.element('.story-editor-controls');
    footer.hidden=false;footer.getBoundingClientRect=()=>({left:0,top:600,right:400,bottom:800});
    const finger={clientX:200,clientY:300};
    let bounds={left:100,top:200,right:300,bottom:599,width:200,height:399};
    const item={getBoundingClientRect:()=>bounds};
    tools.updateStoryEditorDrag(finger,item);assert.equal(dialog.classList.contains('story-footer-drag-over'),false);
    bounds={...bounds,bottom:600,height:400};
    tools.updateStoryEditorDrag(finger,item);assert.equal(dialog.classList.contains('story-footer-drag-over'),true,'touching the footer with an edge is enough');
    bounds={left:401,top:300,right:501,bottom:700,width:100,height:400};
    tools.updateStoryEditorDrag();tools.updateStoryEditorDrag(finger,item);assert.equal(dialog.classList.contains('story-footer-drag-over'),false,'no horizontal intersection');
    bounds={left:350,top:450,right:450,bottom:650,width:100,height:200};
    tools.updateStoryEditorDrag(finger,item);assert.equal(dialog.classList.contains('story-footer-drag-over'),true,'a rotated corner crossing the footer triggers fading');
    tools.updateStoryEditorDrag();assert.equal(dialog.classList.contains('story-footer-drag-over'),false,'release restores controls even while the object remains underneath');
});

test('the gray Story boundary flashes once on footer entry and clears after its brief timeout',async()=>{
    const app=await loadApp(),tools=app.exportsOf('src/features/story-tools.js'),dialog=app.element('.story-create-dialog'),footer=app.element('.story-editor-controls');
    const timers=[];app.context.setTimeout=callback=>{timers.push(callback);return timers.length;};
    footer.hidden=false;footer.getBoundingClientRect=()=>({left:0,top:600,right:400,bottom:800});
    tools.updateStoryEditorDrag({clientX:200,clientY:650});
    assert.equal(dialog.classList.contains('story-canvas-boundary-flash'),true);assert.equal(timers.length,1);
    tools.updateStoryEditorDrag({clientX:200,clientY:660});assert.equal(timers.length,1,'remaining inside the footer does not repeatedly blink');
    timers[0]();assert.equal(dialog.classList.contains('story-canvas-boundary-flash'),false);
    tools.flashStoryCanvasBoundary();assert.equal(dialog.classList.contains('story-canvas-boundary-flash'),true);
    timers[1]();assert.equal(dialog.classList.contains('story-canvas-boundary-flash'),false);
});
