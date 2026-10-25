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
    {id:'rose',name:'Rose',css:'sepia(.2) hue-rotate(310deg) saturate(1.15)'},
    {id:'amber',name:'Amber',css:'sepia(.28) saturate(1.35) hue-rotate(350deg) brightness(1.03)'},
    {id:'blush',name:'Blush',css:'sepia(.14) hue-rotate(320deg) saturate(1.2)'},
    {id:'mint',name:'Mint',css:'hue-rotate(85deg) saturate(1.08) brightness(1.02)'},
    {id:'twilight',name:'Twilight',css:'hue-rotate(230deg) saturate(1.12) brightness(.93)'},
    {id:'film',name:'Film',css:'sepia(.2) contrast(1.08) saturate(.78)'},
    {id:'bright',name:'Bright',css:'brightness(1.15) contrast(.96) saturate(1.04)'},
    {id:'deep',name:'Deep',css:'brightness(.9) contrast(1.16) saturate(1.08)'},
    {id:'punch',name:'Punch',css:'contrast(1.18) saturate(1.55)'},
    {id:'arctic',name:'Arctic',css:'hue-rotate(185deg) saturate(.78) brightness(1.08)'},
    {id:'chalk',name:'Chalk',css:'grayscale(.72) brightness(1.11) contrast(.88)'}
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
