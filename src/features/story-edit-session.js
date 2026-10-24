import { compositionHistory, storyComposition } from './story-composition.js';

export const storyFilterPresets = [
    {id:'none',name:'Original',css:''},
    {id:'mono',name:'Mono',css:'grayscale(1)'},
    {id:'vivid',name:'Vivid',css:'saturate(1.35)'},
    {id:'sepia',name:'Sepia',css:'sepia(.65)'},
    {id:'soft',name:'Soft',css:'contrast(.9) brightness(1.08)'},
    {id:'golden',name:'Golden',css:'sepia(.25) saturate(1.2)'},
    {id:'cool',name:'Cool',css:'sepia(.15) hue-rotate(160deg)'},
    {id:'fade',name:'Fade',css:'contrast(.8) saturate(.8) brightness(1.1)'},
    {id:'dramatic',name:'Drama',css:'contrast(1.3) saturate(.8)'},
    {id:'rose',name:'Rose',css:'sepia(.2) hue-rotate(310deg) saturate(1.15)'}
];
export const storyAdjustments = [
    {id:'brightness',name:'Brightness',icon:'☀'},
    {id:'contrast',name:'Contrast',icon:'◐'},
    {id:'warmth',name:'Warmth',icon:'♨'},
    {id:'tint',name:'Cool tint',icon:'◒'},
    {id:'hue',name:'Hue',icon:'◉'},
    {id:'saturation',name:'Saturation',icon:'◕'}
];
// Sliders use a consistent 0–100 scale; 50 is neutral for every adjustment.
export function adjustmentFromSlider(key,value){
    const v=Math.max(0,Math.min(100,Number(value)));
    if(key==='warmth'||key==='tint')return (v-50)/50;
    if(key==='hue')return (v-50)*3.6;
    return v/50;
}
export function adjustmentToSlider(key,value){
    if(key==='warmth'||key==='tint')return Math.round((value+1)*50);
    if(key==='hue')return Math.round(value/3.6+50);
    return Math.round(value*50);
}
export function createStoryEditSession(kind,edits){
    const baseline=storyComposition(edits),history=compositionHistory(baseline);
    return {kind,baseline,history,current:()=>history.current(),save:()=>history.current(),discard:()=>storyComposition(baseline)};
}
