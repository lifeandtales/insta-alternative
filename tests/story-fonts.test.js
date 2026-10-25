import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-harness.js';

test('Story writing styles provide 15 distinct renderings and retain legacy font keys',async()=>{
    const app=await loadApp();
    const {storyFontStyles,getStoryFontStyle,transformStoryText}=app.exportsOf('src/features/story-fonts.js');
    assert.equal(storyFontStyles.length,15);
    assert.deepEqual(Array.from(storyFontStyles.slice(0,3),style=>style.id),['sans','serif','mono']);
    const signatures=new Set(storyFontStyles.map(({family,weight,style,spacing,transform})=>JSON.stringify([family,weight,style,spacing,transform])));
    assert.equal(signatures.size,15);
    assert.equal(getStoryFontStyle('sans').family,'Inter, sans-serif');
    assert.equal(getStoryFontStyle('serif').family,'Georgia, serif');
    assert.equal(getStoryFontStyle('mono').family,'ui-monospace, SFMono-Regular, Menlo, monospace');
    assert.equal(getStoryFontStyle('unknown').id,'sans');
    assert.equal(transformStoryText('Hello',getStoryFontStyle('condensed')),'HELLO');
});

test('all writing styles reach flattened Story export with their typography settings',async()=>{
    const app=await loadApp();
    const {storyFontStyles}=app.exportsOf('src/features/story-fonts.js');
    const {paintLayer}=app.exportsOf('src/features/story-export.js');
    const fonts=[],labels=[];
    const context={letterSpacing:'',save(){},restore(){},translate(){},rotate(){},measureText:text=>({width:text.length*10}),fillText:text=>labels.push(text)};
    for(const font of storyFontStyles){
        paintLayer(context,{type:'text',font:font.id,text:'Hello',x:.5,y:.4,size:8},400,800);
        fonts.push(context.font);
    }
    assert.equal(new Set(fonts).size,15);
    assert.ok(labels.includes('HELLO'));
});
