import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadApp} from './helpers/app-harness.js';

test('image export preserves native pixels without including the Story frame',async()=>{
    const app=await loadApp();const {storyExportGeometry}=app.exportsOf('src/features/story-export.js');
    let size=storyExportGeometry(4000,3000,0,false);assert.equal(size.width,4000);assert.equal(size.height,3000);
    size=storyExportGeometry(4000,3000,90,false);assert.equal(size.width,3000);assert.equal(size.height,4000);
});
test('video export preserves native 8K, portrait and smaller source dimensions',async()=>{
    const app=await loadApp();const {storyExportGeometry}=app.exportsOf('src/features/story-export.js');
    for(const [w,h,outW,outH] of [[7680,4320,7680,4320],[4320,7680,4320,7680],[640,360,640,360],[641,359,641,359]]){
        const size=storyExportGeometry(w,h,0,true);assert.equal(size.width,outW);assert.equal(size.height,outH);
    }
});
test('arbitrary rotation crops inside the media while retaining original output dimensions',async()=>{
    const app=await loadApp();const {storyExportGeometry}=app.exportsOf('src/features/story-export.js');
    for(const angle of [15,45,75,120,270]){
        const g=storyExportGeometry(1920,1080,angle,true),c=Math.abs(Math.cos(angle*Math.PI/180)),s=Math.abs(Math.sin(angle*Math.PI/180));
        assert.ok(g.contentWidth*c+g.contentHeight*s<=1920+.001);
        assert.ok(g.contentWidth*s+g.contentHeight*c<=1080+.001);
        const swapped=Math.round(angle/90)%2!==0;assert.equal(g.width,swapped?1080:1920);assert.equal(g.height,swapped?1920:1080);
    }
});
test('video export uses a genuinely supported format, or reports none',async()=>{
    const app=await loadApp();const {storyExportMime}=app.exportsOf('src/features/story-export.js');
    assert.equal(storyExportMime({isTypeSupported:type=>type==='video/mp4'}),'video/mp4');
    assert.equal(storyExportMime({isTypeSupported:type=>type==='video/webm'}),'video/webm');
    assert.equal(storyExportMime({isTypeSupported:()=>false}),'');
});

test('custom Story stickers export as colored badge overlays',async()=>{
    const app=await loadApp();const {paintLayer}=app.exportsOf('src/features/story-export.js');const fills=[],labels=[];
    const context={save(){},restore(){},translate(){},rotate(){},measureText:text=>({width:text.length*10}),beginPath(){},moveTo(){},arcTo(){},closePath(){},fill(){fills.push(this.fillStyle);},fillText:text=>labels.push(text)};
    paintLayer(context,{type:'sticker',text:'GOOD VIBES',background:'#ef72b0',color:'#ffffff',x:.5,y:.4,size:8},400,800);
    assert.ok(fills.includes('#ef72b0'));assert.deepEqual(labels,['GOOD VIBES']);
});

test('gallery export applies the same new preset filter used by live preview',async()=>{
    const app=await loadApp();
    const {paintFrame}=app.exportsOf('src/features/story-export.js');
    const {compositionMediaStyle,storyComposition}=app.exportsOf('src/features/story-composition.js');
    let drawFilter='';
    const context={filter:'none',setTransform(){},clearRect(){},save(){},restore(){},translate(){},scale(){},rotate(){},drawImage(){drawFilter=this.filter;},beginPath(){},rect(){},clip(){}};
    const story={type:'image',edits:{filter:{preset:'arctic'}}};
    const geometry={width:100,height:100,contentWidth:100,contentHeight:100};
    const stage={width:100,height:100,mediaWidth:100,mediaHeight:100,mediaLeft:0,mediaTop:0};
    paintFrame(context,{naturalWidth:100,naturalHeight:100},story,geometry,stage);
    assert.equal(drawFilter,compositionMediaStyle(storyComposition(story.edits)).filter);
    assert.match(drawFilter,/hue-rotate\(185deg\).*brightness\(1\.08\)/);
});

test('editor Story frame guide stays out of media export',async()=>{
    const source=fs.readFileSync(new URL('../src/features/story-export.js',import.meta.url),'utf8');
    assert.doesNotMatch(source,/story-frame-guide|story-frame-info/);
});
