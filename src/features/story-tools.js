import { storyEmojiCatalog } from '../data/story-emojis.js';
import { storyFilterPresets, storyAdjustments, adjustmentFromSlider, adjustmentToSlider, createStoryEditSession } from './story-edit-session.js';
import { state } from '../core/state.js';
import { mayInteract } from '../core/social.js';
import { escapeHtml } from '../core/utils.js';
import { showShareFeedback } from '../components/feedback.js';
import { applyStoryComposition, storyComposition, compositionHistory, STORY_VIDEO_LIMIT_SECONDS } from './story-composition.js';
import { storyFontStyles, getStoryFontStyle } from './story-fonts.js';

const mediaPointers=new Map();
let storyRef, history, selectedLayer, gesture, drawMode, toolSession, activeAdjustment='brightness', moveMode=false, stickerView=null, textDraft=null;
export const storyColorSwatches=[
    ['Black','#000000'],['Charcoal','#262626'],['Dark gray','#4a4a4a'],['Gray','#6b7280'],['Slate gray','#9ca3af'],['Medium gray','#c5c5c5'],['Light gray','#e5e5e5'],['Pale gray','#f5f5f5'],['White','#ffffff'],
    ['Light red','#ff8a80'],['Red','#f44336'],['Dark red','#b71c1c'],['Light orange','#ffcc80'],['Orange','#ff9800'],['Dark orange','#e65100'],['Light yellow','#fff59d'],['Yellow','#ffeb3b'],['Dark yellow','#f9a825'],['Light green','#a5d6a7'],['Green','#4caf50'],['Dark green','#1b5e20'],['Light blue','#90caf9'],['Blue','#2196f3'],['Dark blue','#0d47a1'],['Light indigo','#9fa8da'],['Indigo','#3f51b5'],['Dark indigo','#1a237e'],['Light violet','#ce93d8'],['Violet','#9c27b0'],['Dark violet','#4a148c']
].map(([name,color])=>({name,color}));
let stickerQueries={emojis:'',stickers:'',gifs:''};
const storyEmojiChoices=['🙂','😂','😍','🥳','❤️','✨','🔥','🌈','🌸','☀️','🎉','💯','👏','🙌','🦋','🌿','⭐','💫','🎂','☕','📍','✈️','🏖️','🎵'];
const storyStickerChoices=[
    {id:'good-vibes',text:'GOOD VIBES',background:'#ef72b0',color:'#ffffff'},
    {id:'love-this',text:'LOVE THIS',background:'#ffca58',color:'#40234e'},
    {id:'wow',text:'WOW',background:'#71d7c0',color:'#143d3b'},
    {id:'yay',text:'YAY!',background:'#9277eb',color:'#ffffff'},
    {id:'good-day',text:'GOOD DAY',background:'#78b8ff',color:'#173250'},
    {id:'oh-yes',text:'OH YES',background:'#ff826f',color:'#ffffff'}
];
const currentComposition=()=>toolSession?toolSession.current():storyComposition(pending()?.edits);
const activeHistory=()=>toolSession?.history||history;
const preview=()=>document.querySelector('.story-selected-preview');
const pending=()=>state.pendingStoryMedia;
const id=()=>`layer-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
export function storyDrawingWidthFromPercent(value){return 1+clamp(Number(value)||0,0,100)*39/100;}
export function storyDrawingPercentFromWidth(width){return Math.round((clamp(Number(width)||1,1,40)-1)/39*100);}
export function buildStoryTextLayer(existing,{id:layerId,text,font='sans',color='#ffffff',mentions=[],type='text'}={}){
    return {...existing,id:existing?.id||layerId,type,text,font,color,size:existing?.size||7,x:existing?.x??.5,y:existing?.y??(type==='location'?.5:.4),width:existing?.width??.8,rotation:existing?.rotation??0,mentions};
}
export function hexToHsv(hex){
    const match=/^#?([\da-f]{6})$/i.exec(String(hex||''));if(!match)return {h:0,s:0,v:1};
    const n=parseInt(match[1],16),r=((n>>16)&255)/255,g=((n>>8)&255)/255,b=(n&255)/255,max=Math.max(r,g,b),min=Math.min(r,g,b),delta=max-min;
    let h=0;if(delta){if(max===r)h=((g-b)/delta)%6;else if(max===g)h=(b-r)/delta+2;else h=(r-g)/delta+4;h=(h*60+360)%360;}
    return {h,s:max?delta/max:0,v:max};
}
export function hsvToHex(h,s,v){
    h=((Number(h)||0)%360+360)%360;s=clamp(Number(s)||0,0,1);v=clamp(Number(v)||0,0,1);
    const c=v*s,x=c*(1-Math.abs((h/60)%2-1)),m=v-c;let rgb=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];
    return '#'+rgb.map(value=>Math.round((value+m)*255).toString(16).padStart(2,'0')).join('');
}
export function storyColorAtPoint(hue,x,y){return hsvToHex(hue,clamp(Number(x)||0,0,1),1-clamp(Number(y)||0,0,1));}
export function moveStoryColorSelection(hsv,key,largerStep=false){
    const next={...hsv},step=largerStep ? .1 : .01;
    if(key==='ArrowLeft')next.s=clamp(next.s-step,0,1);else if(key==='ArrowRight')next.s=clamp(next.s+step,0,1);
    else if(key==='ArrowUp')next.v=clamp(next.v+step,0,1);else if(key==='ArrowDown')next.v=clamp(next.v-step,0,1);
    else return null;
    return next;
}
export function storyLocationEditPosition(){return {x:.5,y:.5,width:.8,rotation:0};}
const val=(form,name)=>form.elements[name]?.value;
const numeric=(form,name)=>Number(val(form,name));
const input=(name,label,value,type='number',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(String(value??''))}" ${extra} /></label>`;
const range=(name,label,value,min,max,step)=>input(name,label,value,'range',`min="${min}" max="${max}" step="${step}"`);

// Small capture zones give quarter turns a detent without preventing free rotation.
export function snapStoryRotation(rotation){
    const normalized=((rotation+180)%360+360)%360-180;
    const nearest=Math.round(normalized/90)*90;
    const snapped=Math.abs(normalized-nearest)<=4;
    return {rotation:snapped?(nearest||0):normalized,snapped};
}
export function snapStoryCenter(x,y,media=false){
    const center=media?0:.5,tolerance=media?2:.02;
    const xSnap=Math.abs(x-center)<=tolerance,ySnap=Math.abs(y-center)<=tolerance;
    return {x:xSnap?center:x,y:ySnap?center:y,xSnap,ySnap};
}
export function snapStoryMedia(media) {
    const angle=snapStoryRotation(media.rotation),sizeSnap=Math.abs(media.zoom-1)<=.035;
    return {rotation:angle.rotation,zoom:sizeSnap?1:media.zoom,rotationSnap:angle.snapped,sizeSnap};
}
let guideRevision=0;
function clearAlignmentGuides(){
    guideRevision++;
    const stage=preview();stage.classList.remove('story-angle-snapped','story-size-snapped','story-center-x','story-center-y');
    stage.querySelectorAll('.story-overlay-angle-snapped').forEach(layer=>layer.classList.remove('story-overlay-angle-snapped'));
    stage.removeAttribute('data-alignment-hint');
}
function showAlignmentGuides(snap){
    guideRevision++;
    const stage=preview();
    stage.classList.toggle('story-angle-snapped',snap.rotationSnap);
    stage.classList.toggle('story-size-snapped',snap.sizeSnap);
    stage.removeAttribute('data-alignment-hint');
}
function showCenterGuides(snap){guideRevision++;preview().classList.toggle('story-center-x',snap.xSnap);preview().classList.toggle('story-center-y',snap.ySnap);}
function fadeAlignmentGuides(){const revision=guideRevision;setTimeout(()=>{if(revision===guideRevision)clearAlignmentGuides();},650);}


export function updateStoryEditorDrag(point=null,item=null){
    const footer=document.querySelector('.story-editor-controls');
    const rect=footer.getBoundingClientRect();
    const faded=document.querySelector('.story-create-dialog').classList.contains('story-footer-drag-over');
    const bounds=item?.getBoundingClientRect();
    // Use the visible object's transformed bounds, not the finger or the full media element's letterbox.
    const hasBounds=bounds && bounds.width>0 && bounds.height>0;
    const buffer=faded?16:0;
    const over=Boolean(point && !footer.hidden && (hasBounds
        ? bounds.bottom>=rect.top-buffer && bounds.top<=rect.bottom+buffer && bounds.right>=rect.left-buffer && bounds.left<=rect.right+buffer
        : point.clientY>=rect.top-(faded?48:24) && point.clientY<=rect.bottom && point.clientX>=rect.left && point.clientX<=rect.right));
    document.querySelector('.story-create-dialog').classList.toggle('story-footer-drag-over',over);
}
function ensureHistory(){
    if(storyRef!==pending()){
        for(const pointerId of mediaPointers.keys()){if(preview().hasPointerCapture?.(pointerId))preview().releasePointerCapture(pointerId);}
        mediaPointers.clear();gesture=null;updateStoryEditorDrag();
        clearAlignmentGuides();hideDeleteTarget();closeInlineText();resetStoryMode();storyRef=pending();history=storyRef?compositionHistory(storyRef.edits):null;selectedLayer=null;drawMode=null;moveMode=false;
    }
    return history;
}
function repaint(){
    if(!pending())return;
    applyStoryComposition(preview(),{...pending(),edits:currentComposition()},{editing:true});
    preview().querySelectorAll('.story-composition-layer').forEach(layer=>layer.classList.toggle('story-layer-selected',layer.dataset.layerId===selectedLayer));
    document.querySelector('.story-undo').disabled=!activeHistory()?.canUndo();
    document.querySelector('.story-redo').disabled=!activeHistory()?.canRedo();
    document.querySelector('.story-draw-done').hidden=Boolean(toolSession)||(!drawMode && !moveMode);
    preview().classList.toggle('story-drawing-mode',Boolean(drawMode||moveMode));
    const sound=document.querySelector('.story-preview-sound'),muted=currentComposition().video.muted;
    sound.hidden=pending().type!=='video';sound.textContent=muted?'🔇':'🔊';
    sound.setAttribute('aria-label',muted?'Unmute video sound':'Mute video sound');sound.setAttribute('aria-pressed',String(muted));
}
export function prepareStoryTools(){ensureHistory();repaint();}
export function commitStoryEdit(next){
    if(!pending() || !mayInteract() || !ensureHistory())return false;
    const changed=activeHistory().commit(next);if(!toolSession)pending().edits=history.current();repaint();return changed;
}
function closeTools(){
    document.querySelector('.story-tools-backdrop').hidden=true;
    document.querySelector('.story-tools-backdrop').classList.remove('story-sticker-picker-active');
    stickerView=null;
    document.querySelector('.story-tools-back').hidden=true;
    document.getElementById('story-tools-title').textContent='Story tools';
    document.querySelector('.story-tool-options').replaceChildren();
    document.querySelector('.story-create-dialog').inert=false;
    if(pending() && !state.deletionRequestedAt)document.querySelector('.story-tools-open').focus();
}
function closeStickerPicker(){
    stickerView=null;
    document.querySelector('.story-tools-backdrop').classList.remove('story-tool-active','story-tool-mini','story-sticker-picker-active');
    document.querySelector('.story-tools-back').hidden=true;
    document.getElementById('story-tools-title').textContent='Story tools';
    document.querySelector('.story-tool-options').replaceChildren();
    document.querySelector('[data-story-tool="sticker"]').focus();
}
export function searchStoryEmojis(query){
    const terms=query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if(!terms.length)return storyEmojiChoices.map(emoji=>[emoji,storyEmojiCatalog.find(item=>item[0]===emoji)?.[1]||emoji]);
    return storyEmojiCatalog.filter(([emoji,name])=>terms.every(term=>emoji.includes(term)||name.toLowerCase().includes(term)));
}
function stickerResults(section){
    const query=stickerQueries[section];
    if(section==='gifs')return '<p class="story-sticker-empty" role="status">GIF search will be available when the catalog is connected.</p>';
    if(section==='stickers'){
        const matches=storyStickerChoices.filter(item=>item.text.toLowerCase().includes(query.trim().toLowerCase()));
        return matches.length?`<div class="story-static-sticker-grid">${matches.map(item=>`<button type="button" data-story-sticker-label="${item.id}" style="background:${item.background};color:${item.color}">${item.text}</button>`).join('')}</div>`:'<p role="status">No stickers found. Try another search.</p>';
    }
    const matches=searchStoryEmojis(query);
    return matches.length?`<div class="story-sticker-picker">${matches.map(([emoji,name])=>`<button type="button" data-story-sticker="${emoji}" aria-label="Add ${escapeHtml(name)}" title="${escapeHtml(name)}">${emoji}</button>`).join('')}</div>`:'<p role="status">No emojis found. Try another search.</p>';
}
function renderStickerPicker(section='emojis'){
    if(!stickerView)stickerQueries={emojis:'',stickers:'',gifs:''};
    stickerView=section;
    const label={emojis:'Search emojis',stickers:'Search stickers',gifs:'Search GIFs'}[section];
    const options=document.querySelector('.story-tool-options');options.innerHTML=`<div class="story-sticker-section-tabs" role="tablist" aria-label="Story stickers, emojis and GIFs">${[['stickers','Stickers'],['emojis','Emojis'],['gifs','GIFs']].map(([key,label])=>`<button type="button" id="story-sticker-tab-${key}" role="tab" data-story-sticker-section="${key}" aria-controls="story-sticker-panel" aria-selected="${section===key}" aria-pressed="${section===key}" tabindex="${section===key?0:-1}">${label}</button>`).join('')}</div><input class="story-sticker-search" type="search" data-story-sticker-search="${section}" aria-label="${label}" placeholder="${label}" value="${escapeHtml(stickerQueries[section])}" autocomplete="off"><div class="story-sticker-section" id="story-sticker-panel" role="tabpanel" aria-labelledby="story-sticker-tab-${section}">${stickerResults(section)}</div>`;
}
function resetStoryMode(){
    toolSession=null;drawMode=null;moveMode=false;textDraft=null;
    document.querySelector('.story-create-dialog').classList.remove('story-mode-active');
    const textBox=document.querySelector('.story-inline-text');textBox.hidden=true;textBox.classList.remove('story-text-mode','story-location-text-mode');document.querySelector('.story-create-dialog').classList.remove('story-location-editing');
    const panel=document.querySelector('.story-edit-mode-controls');panel.hidden=true;panel.setAttribute('aria-label','Story editing controls');
}
function syncFilterSelection(preset){
    document.querySelectorAll('[data-story-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.storyFilter===preset)));
}
export function beginStoryMode(kind){
    if(!pending()||!mayInteract())return false;
    ensureHistory();closeTools();closeInlineText();clearAlignmentGuides();hideDeleteTarget();selectedLayer=null;
    toolSession=createStoryEditSession(kind,pending().edits);activeAdjustment='brightness';
    drawMode=kind==='draw'?{mode:'pen',color:'#ffffff',width:8}:null;
    document.querySelector('.story-create-dialog').classList.add('story-mode-active');
    renderStoryMode();repaint();document.querySelector('.story-edit-mode-controls button')?.focus();return true;
}
export function finishStoryMode(save){
    if(!toolSession)return false;
    const result=toolSession.save();resetStoryMode();gesture=null;
    if(save)commitStoryEdit(result);else repaint();
    document.querySelector('.story-tools-open').focus();return true;
}
export function storyTextColorPicker(color,{name='color',label='Text color',dataAttr='data-story-text-color',open=false}={}){
    const id=`story-color-chart-${name}`;
    return `<div class="story-color-control" data-story-color-control style="--selected-story-color:${color}"><button type="button" class="story-color-trigger" data-story-color-toggle aria-label="${label}: choose color" aria-expanded="${open}" aria-controls="${id}"><span class="story-color-picker-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><g stroke="#584c70" stroke-width=".55"><path fill="#f472b6" d="M12 3.2 14.5 4.65v2.9L12 9 9.5 7.55v-2.9Z"/><path fill="#fbbf24" d="m7.1 6 2.5 1.45v2.9l-2.5 1.45-2.5-1.45v-2.9Z"/><path fill="#34d399" d="m16.9 6 2.5 1.45v2.9L16.9 12l-2.5 1.45-2.5-1.45v-2.9Z"/><path fill="#60a5fa" d="m7.1 12 2.5 1.45v2.9l-2.5 1.45-2.5-1.45v-2.9Z"/><path fill="#c084fc" d="M12 9 14.5 10.45v2.9L12 14.8l-2.5-1.45-2.5-1.45v-2.9Z"/><path fill="#fb7185" d="m16.9 12 2.5 1.45v2.9L16.9 12l-2.5-1.45v-2.9Z"/><path fill="#f59e0b" d="m12 14.8 2.5 1.45v2.9L12 20.6l-2.5-1.45v-2.9Z"/></g></svg></span><span class="story-color-picker-swatch" aria-hidden="true"></span></button><div class="story-color-chart" id="${id}" data-story-color-chart ${open?'':'hidden'}><div class="story-color-swatches" role="radiogroup" aria-label="${label} choices">${storyColorSwatches.map(swatch=>`<button type="button" class="story-color-choice" data-story-color-choice="${swatch.color}" aria-label="${label}: ${swatch.name}" aria-checked="${swatch.color.toLowerCase()===String(color).toLowerCase()}" role="radio" tabindex="${swatch.color.toLowerCase()===String(color).toLowerCase()?0:-1}" style="--swatch-color:${swatch.color}"></button>`).join('')}</div><output data-story-color-value aria-live="polite">${color.toUpperCase()}</output><input type="hidden" name="${name}" value="${color}" ${dataAttr} /></div></div>`;
}
function renderStoryTextControls(){
    const panel=document.querySelector('.story-edit-mode-controls');if(!panel||!textDraft)return;
    panel.hidden=false;panel.setAttribute('aria-label',textDraft.kind==='location'?'Location editing controls':'Text and mention controls');
    const fonts=textDraft.kind==='location'?'':`<div class="story-font-strip" role="group" aria-label="Swipe to browse writing styles">${storyFontStyles.map(font=>`<button type="button" data-story-font="${font.id}" aria-pressed="${textDraft.font===font.id}"><span class="story-font-circle" style="font-family:${font.family};font-weight:${font.weight};font-style:${font.style};letter-spacing:${font.spacing}em;text-transform:${font.transform}">Aa</span><span>${font.label}</span></button>`).join('')}</div>`;
    const color=textDraft.kind==='location'?'':storyTextColorPicker(textDraft.color);
    panel.innerHTML=`${fonts}<div class="story-text-mode-actions">${color}<button type="button" data-story-text-cancel>Cancel</button><button type="button" data-story-text-done>Done</button></div>`;
}
function applyTextDraftPreview(){
    const box=document.querySelector('.story-inline-text'),field=box.querySelector('textarea')||box.querySelector('input[name="text"]');if(!field||!textDraft)return;
    if(textDraft.kind==='location'){const layer=selectedLayer&&preview().querySelector(`[data-layer-id="${selectedLayer}"]`);if(layer)layer.style.visibility='hidden';return;}
    const font=getStoryFontStyle(textDraft.font),size=Number(textDraft.size)||7;
    Object.assign(field.style,{fontFamily:font.family,fontWeight:String(font.weight),fontStyle:font.style,letterSpacing:`${font.spacing}em`,textTransform:font.transform,fontSize:`${size}cqw`,color:textDraft.color});
    const layer=selectedLayer&&preview().querySelector(`[data-layer-id="${selectedLayer}"]`);
    if(layer)layer.style.visibility='hidden';
}
function finishInlineText(save){
    if(!toolSession||!['text','location'].includes(toolSession.kind))return false;
    const form=document.querySelector('.story-inline-text form');
    if(save&&form&&textDraft){
        const field=form.querySelector('textarea')||form.querySelector('input[name="text"]'),text=String(field?.value||'').trim();
        if(!text){field?.focus();return false;}
        const type=textDraft.kind==='location'?'location':'text';
        const e=toolSession.current(),existing=e.layers.find(item=>item.id===selectedLayer&&item.type===type);
        const mentions=type==='text'?[...text.matchAll(/@[a-zA-Z0-9._]+/g)].map(match=>state.accountDirectory.find(a=>a.handle.toLowerCase()===match[0].toLowerCase()&&!state.blockedHandles.has(a.handle))).filter(Boolean).map(a=>({id:a.id,handle:a.handle})):[];
        const layer=buildStoryTextLayer(existing,{id:id(),text,font:textDraft.font,color:textDraft.color,mentions,type});
        e.layers=existing?e.layers.map(item=>item.id===existing.id?layer:item):[...e.layers,layer];selectedLayer=layer.id;
        toolSession.history.commit(e);
    }
    finishStoryMode(Boolean(save));document.querySelector('.story-tools-open').focus();return true;
}
export function updateStoryAdjustment(key,value){
    if(toolSession?.kind!=='adjustments'||!storyAdjustments.some(item=>item.id===key))return false;
    const next=toolSession.current();next.filter[key]=adjustmentFromSlider(key,value);commitStoryEdit(next);return true;
}
function renderStoryMode(){
    if(!toolSession)return;
    const panel=document.querySelector('.story-edit-mode-controls');panel.hidden=false;
    panel.setAttribute('aria-label',toolSession.kind==='adjustments'?'Tune controls':toolSession.kind==='filters'?'Story filters':'Story drawing controls');
    const kind=toolSession.kind,e=toolSession.current();let controls='';
    if(kind==='filters'){
        controls=`<div class="story-filter-strip" role="group" aria-label="Swipe to browse filters">${storyFilterPresets.map(preset=>`<button type="button" data-story-filter="${preset.id}" aria-pressed="${e.filter.preset===preset.id}"><span class="story-filter-circle" style="filter:${preset.css||'none'}">${pending().type==='image'?`<img src="${escapeHtml(pending().media)}" alt="" />`:'◉'}</span><span>${preset.name}</span></button>`).join('')}</div>`;
    }
    if(kind==='adjustments'){
        const option=storyAdjustments.find(item=>item.id===activeAdjustment);
        controls=`<label class="story-live-slider"><span>${option.name} <output data-story-adjust-value>${adjustmentToSlider(option.id,e.filter[option.id])}%</output></span><input type="range" min="0" max="100" value="${adjustmentToSlider(option.id,e.filter[option.id])}" data-story-adjustment="${option.id}" aria-label="${option.name}" /></label><div class="story-adjustment-strip">${storyAdjustments.map(item=>`<button type="button" data-story-adjustment-select="${item.id}" aria-pressed="${item.id===activeAdjustment}"><span aria-hidden="true">${item.icon}</span>${item.name}</button>`).join('')}</div>`;
    }
    if(kind==='draw'){
        controls=`<div class="story-draw-modes">${[['pen','✎','Freehand'],['dotted','⋯','Dotted'],['highlight','▰','Highlight'],['colorful','🌈','Colorful']].map(([mode,icon,label])=>`<button type="button" data-story-draw-mode="${mode}" aria-pressed="${drawMode.mode===mode}"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}</div><div class="story-draw-settings">${storyTextColorPicker(drawMode.color,{name:'draw-color',label:'Drawing color',dataAttr:'data-story-draw-color'})}<label class="story-draw-size"><span aria-hidden="true">✎</span><input type="range" min="0" max="100" step="1" value="${storyDrawingPercentFromWidth(drawMode.width)}" data-story-draw-width aria-label="Drawing size" aria-valuetext="${storyDrawingPercentFromWidth(drawMode.width)}%" /><output data-story-draw-size aria-live="polite">${storyDrawingPercentFromWidth(drawMode.width)}%</output></label></div><p class="story-draw-color-hint">Colorful draws a smooth rainbow stroke. The selected color applies to Freehand, Dotted and Highlight.</p>`;
    }
    const doneCancel=kind==='filters'||kind==='adjustments';
    panel.innerHTML=`${controls}<div class="story-mode-actions${doneCancel?' story-mode-actions-done-cancel':''}"><button type="button" data-story-mode-${doneCancel?'discard':'save'}>${doneCancel?'Cancel':'Save changes'}</button><button type="button" data-story-mode-${doneCancel?'save':'discard'}>${doneCancel?'Done':'Discard changes'}</button></div>`;
}
function currentStoryColor(){return toolSession?.kind==='draw'?drawMode?.color:textDraft?.color;}
function closeStoryColorPalette(chart,toggle){
    if(!chart||!toggle)return;
    chart.hidden=true;toggle.setAttribute('aria-expanded','false');toggle.focus();
}
function renderColorPickerState(color){
    const control=document.querySelector('[data-story-color-control]');if(!control)return;
    const swatch=control.querySelector('.story-color-picker-swatch'),value=control.querySelector('[data-story-color-value]');
    control.style.setProperty('--selected-story-color',color);
    if(swatch)swatch.style.background=color;if(value)value.value=value.textContent=color.toUpperCase();
    control.querySelectorAll('[data-story-color-choice]').forEach(choice=>{const selected=choice.dataset.storyColorChoice.toLowerCase()===color.toLowerCase();choice.setAttribute('aria-checked',String(selected));choice.tabIndex=selected?0:-1;});
    const hidden=control.querySelector('input[type="hidden"]');if(hidden)hidden.value=color;
}
function setStoryPickerColor(color){
    if(toolSession?.kind==='draw'&&drawMode)drawMode.color=color;
    else if(toolSession?.kind==='text'&&textDraft){textDraft.color=color;syncInlineTextStyle();}
    renderColorPickerState(color);
}
function syncInlineTextStyle(){
    const form=document.querySelector('.story-inline-text form');if(!form)return;
    const field=form.querySelector('textarea')||form.querySelector('input[name="text"]'),font=getStoryFontStyle(textDraft?.font||val(form,'font'));
    const size=Number(textDraft?.size||7),color=textDraft?.color||val(form,'color')||'#ffffff';
    if(textDraft)textDraft.color=color;
    if(field.tagName==='TEXTAREA'){field.style.height='auto';field.style.height=`${Math.min(field.scrollHeight||40,Math.round((preview().getBoundingClientRect().height||700)*.55))}px`;}
    form.querySelector('input[name="color"]')?.closest('.story-color-picker')?.style.setProperty('--selected-story-color',color);
    Object.assign(field.style,{fontFamily:font.family,fontWeight:String(font.weight),fontStyle:font.style,letterSpacing:`${font.spacing}em`,textTransform:font.transform,fontSize:`${size}cqw`,color});
    applyTextDraftPreview();
}
function closeInlineText(){const box=document.querySelector('.story-inline-text'),wasVisible=!box.hidden;if(['text','location'].includes(toolSession?.kind)){finishInlineText(false);return;}box.hidden=true;box.classList.remove('story-text-mode','story-location-text-mode');document.querySelector('.story-create-dialog').classList.remove('story-location-editing');if(wasVisible&&pending())repaint();}
export function openInlineLocation(layerId=null){
    if(!pending()||!mayInteract())return;
    ensureHistory();selectedLayer=layerId;
    const layer=storyComposition(pending().edits).layers.find(item=>item.id===layerId&&item.type==='location');
    closeTools();closeInlineText();toolSession=createStoryEditSession('location',pending().edits);textDraft={kind:'location',font:layer?.font||'sans',color:layer?.color||'#ffffff',size:layer?.size||7};
    document.querySelector('.story-create-dialog').classList.add('story-mode-active');
    if(layer)preview().querySelector(`[data-layer-id="${layerId}"]`)?.classList.add('story-layer-selected');
    const box=document.querySelector('.story-inline-text');box.hidden=false;box.classList.add('story-location-text-mode');
    const editPosition=storyLocationEditPosition();box.style.left=`${editPosition.x*100}%`;box.style.top=`${editPosition.y*100}%`;box.style.width=`${editPosition.width*100}%`;box.style.rotate=`${editPosition.rotation}deg`;
    box.innerHTML=`<form class="story-tool-form story-location-inline-form" data-tool="labels"><div class="story-location-entry"><span aria-hidden="true">📍</span><input name="text" type="text" placeholder="Add a location" maxlength="100" required aria-label="Location text" value="${escapeHtml(layer?.text||'')}" /></div></form>`;
    renderStoryTextControls();box.querySelector('input[name="text"]').focus();
}
function openInlineText(layerId=null,kind='text'){
    if(!pending()||!mayInteract())return;
    ensureHistory();selectedLayer=layerId;
    const type=kind==='location'?'location':'text';
    const layer=storyComposition(pending().edits).layers.find(item=>item.id===layerId&&item.type===type);
    closeTools();closeInlineText();
    toolSession=createStoryEditSession(type,pending().edits);textDraft={kind:type,font:layer?.font||'sans',color:/^#[\da-f]{6}$/i.test(layer?.color||'')?layer.color:'#ffffff',size:layer?.size||7};
    document.querySelector('.story-create-dialog').classList.add('story-mode-active');
    if(layer)preview().querySelector(`[data-layer-id="${layerId}"]`)?.classList.add('story-layer-selected');
    const box=document.querySelector('.story-inline-text');box.hidden=false;box.classList.add('story-text-mode');
    box.style.left=`${(layer?.x??.5)*100}%`;box.style.top=`${(layer?.y??.4)*100}%`;box.style.width=`${(layer?.width??.8)*100}%`;box.style.rotate=`${layer?.rotation||0}deg`;
    box.innerHTML=`<form class="story-tool-form story-inline-form" data-tool="text"><textarea name="text" maxlength="500" placeholder="Write text or @mention" aria-label="Story text">${escapeHtml(layer?.text||'')}</textarea><div id="story-mention-suggestions" class="story-inline-mentions" role="listbox" aria-label="Mention suggestions"></div></form>`;
    renderStoryTextControls();syncInlineTextStyle();box.querySelector('textarea').focus();
}
function hideDeleteTarget(){const target=document.querySelector('.story-delete-target');target.hidden=true;target.classList.remove('story-delete-ready');}
export function isStoryDeleteDrop(rect,x,y){return x>=rect.left&&x<=rect.right&&y>=rect.top&&y<=rect.bottom;}
function updateDeleteTarget(event){
    const target=document.querySelector('.story-delete-target');target.hidden=false;
    const over=isStoryDeleteDrop(target.getBoundingClientRect(),event.clientX,event.clientY);
    target.classList.toggle('story-delete-ready',over);return over;
}
function toolForm(tool){
    if(['filters','adjustments','draw'].includes(tool)){beginStoryMode(tool);return;}
    if(tool==='labels'){openInlineLocation();return;}
    if(tool==='text'){openInlineText();return;}
    const popup=document.querySelector('.story-tools-backdrop');
    popup.classList.add('story-tool-active');
    popup.classList.toggle('story-tool-mini',tool==='labels');
    document.getElementById('story-tools-title').textContent=({labels:'Location',sticker:'Stickers / Emojis / GIFs',text:'Text / @mentions'})[tool]||tool.charAt(0).toUpperCase()+tool.slice(1);
    if(tool==='sticker'){
        document.querySelector('.story-tools-backdrop').classList.add('story-tool-active','story-sticker-picker-active');document.querySelector('.story-tools-back').hidden=false;renderStickerPicker('emojis');return;
    }
    const e=storyComposition(pending().edits), layer=e.layers.find(item=>item.id===selectedLayer);
    let fields='';
    if(tool==='move')fields=`${range('x','Horizontal position',e.media.x,-100,100,1)}${range('y','Vertical position',e.media.y,-100,100,1)}${range('zoom','Zoom',e.media.zoom,.2,4,.05)}<button type="button" data-story-drag-media>Drag media on Story</button>`;
    if(tool==='fit')fields=`<label>Media framing<select name="fit"><option value="contain" ${e.media.fit==='contain'?'selected':''}>Fit · keep full media</option><option value="cover" ${e.media.fit==='cover'?'selected':''}>Fill · crop to Story</option></select></label>`;
    if(tool==='rotate')fields=`${range('rotation','Rotation',e.media.rotation,-180,180,1)}${range('straighten','Straighten',e.media.straighten,-15,15,.5)}<button type="button" data-story-rotate>Rotate 90°</button>`;
    if(tool==='filters')fields=`<label>Filter<select name="preset">${storyFilterPresets.map(preset=>`<option value="${preset.id}" ${e.filter.preset===preset.id?'selected':''}>${preset.name}</option>`).join('')}</select></label>${range('brightness','Brightness',e.filter.brightness,.2,2,.05)}${range('contrast','Contrast',e.filter.contrast,.2,2,.05)}${range('warmth','Warmth / cool tint',e.filter.warmth,-1,1,.05)}${range('saturation','Color saturation',e.filter.saturation,0,2,.05)}`;
    if(tool==='draw')fields=`<label>Drawing<select name="mode"><option value="pen">Freehand</option><option value="line">Line</option><option value="arrow">Arrow</option><option value="highlight">Highlighter</option></select></label>${input('color','Color','#ffffff','color')}${range('width','Stroke width',8,2,30,1)}<p>Choose Apply, then draw on the preview. Select Done when finished.</p>`;
    if(tool==='sticker')fields=`${input('text','Sticker / emoji','🙂','text','maxlength="40" required')}${range('size','Size (% of Story width)',15,4,25,.5)}<p>Drag the sticker to place it anywhere on the Story.</p>`;
    if(tool==='labels')fields=`<input type="hidden" name="kind" value="location" />${input('text','Location','','text','maxlength="100" required')}<p>Enter a location label.</p>`;
    if(tool==='music')fields=`<p>User-selected audio only. No commercial music catalogue or licence is provided.</p><label>Choose audio<input id="story-music-file" type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" /></label><p>${escapeHtml(e.music?.title||'No audio selected.')}</p>${input('start','Segment start (seconds)',e.music?.start||0,'number','min="0" step="0.1"')}${input('end','Segment end (blank = full track)',e.music?.end??'','number','min="0" step="0.1"')}${range('volume','Music volume',e.music?.volume??1,0,1,.05)}<button type="button" data-story-remove-music>Remove music</button>`;
    if(tool==='video')fields=`<p>Stories use only the first 4 minutes. Leave end blank to use the remaining allowed video.</p>${input('start','Trim start (seconds)',e.video.start,'number','min="0" max="239.9" step="0.1"')}${input('end','Trim end (blank = full length)',e.video.end??'','number','min="0" max="240" step="0.1"')}`;
    document.querySelector('.story-tool-options').innerHTML=`<form class="story-tool-form" data-tool="${tool}">${fields}<p class="story-tool-error" role="alert"></p><button type="submit" class="primary-btn">Apply ${tool==='draw'?'and draw':'changes'}</button>${layer?'<button type="button" data-story-remove-layer>Remove selected overlay</button>':''}</form>`;
}
function openTools(){
    if(!pending() || !mayInteract())return;
    ensureHistory();
    stickerView=null;
    document.querySelector('.story-tools-backdrop').classList.remove('story-tool-active','story-tool-mini','story-sticker-picker-active');
    document.getElementById('story-tools-title').textContent='Story tools';
    document.querySelector('.story-tools-back').hidden=true;
    document.querySelector('.story-tool-options').replaceChildren();
    document.querySelector('[data-story-tool="video"]').hidden=pending().type!=='video';
    document.querySelector('.story-tools-backdrop').hidden=false;
    document.querySelector('.story-create-dialog').inert=true;
    document.querySelector('.story-tools-close').focus();
}
function applyTool(form){
    const e=storyComposition(pending().edits), tool=form.dataset.tool;
    if(tool==='text' || tool==='sticker' || tool==='labels'){
        const type=tool==='text'?'text':tool==='sticker'?'emoji':val(form,'kind');
        let text=val(form,'text').trim();if(!text)return;
        if(type==='hashtag')text='#'+text.replace(/^#+/,'').replace(/\s+/g,'');
        const existing=tool==='text' ? e.layers.find(item=>item.id===selectedLayer && item.type==='text') : null;
        const mentions=[...text.matchAll(/@[a-zA-Z0-9._]+/g)].map(match=>state.accountDirectory.find(a=>a.handle.toLowerCase()===match[0].toLowerCase() && !state.blockedHandles.has(a.handle))).filter(Boolean).map(a=>({id:a.id,handle:a.handle}));
        const layer={...existing,id:existing?.id||id(),x:existing?.x??.5,y:existing?.y??.4,type,text,font:val(form,'font')||'sans',color:val(form,'color')||'#ffffff',size:numeric(form,'size')||6,mentions};
        if(tool==='text'&&form.matches('.story-inline-form')){const field=form.querySelector('textarea');const width=field.getBoundingClientRect().width/preview().getBoundingClientRect().width;if(Number.isFinite(width))layer.width=clamp(width,.1,.9);}
        e.layers=existing?e.layers.map(item=>item.id===existing.id?layer:item):[...e.layers,layer];selectedLayer=layer.id;
    }
    if(tool==='move')Object.assign(e.media,{x:numeric(form,'x'),y:numeric(form,'y'),zoom:numeric(form,'zoom')});
    if(tool==='fit')e.media.fit=val(form,'fit');
    if(tool==='rotate')Object.assign(e.media,{rotation:numeric(form,'rotation'),straighten:numeric(form,'straighten')});
    if(tool==='filters')Object.assign(e.filter,{preset:val(form,'preset'),brightness:numeric(form,'brightness'),contrast:numeric(form,'contrast'),warmth:numeric(form,'warmth'),saturation:numeric(form,'saturation')});
    if(tool==='draw'){drawMode={mode:val(form,'mode'),color:val(form,'color'),width:numeric(form,'width')};moveMode=false;closeTools();repaint();return;}
    if(tool==='music' || tool==='video'){
        const start=numeric(form,'start'), end=val(form,'end')===''?null:numeric(form,'end');
        if(!Number.isFinite(start) || start<0 || (end!=null && (!Number.isFinite(end)||end<=start))){form.querySelector('.story-tool-error').textContent='End must be after start, in seconds.';return;}
        if(tool==='video'){
            const sourceDuration=preview().querySelector('video')?.duration;
            const duration=Number.isFinite(sourceDuration)?Math.min(sourceDuration,STORY_VIDEO_LIMIT_SECONDS):STORY_VIDEO_LIMIT_SECONDS;
            if(Number.isFinite(duration) && (start>=duration || (end!=null && end>duration))){form.querySelector('.story-tool-error').textContent=`Choose a segment within the first ${duration.toFixed(1)} seconds (maximum 4 minutes).`;return;}
            Object.assign(e.video,{start,end});
        }else if(e.music)Object.assign(e.music,{start,end,volume:numeric(form,'volume')});
        else{form.querySelector('.story-tool-error').textContent='Choose an audio file first.';return;}
    }
    commitStoryEdit(e);closeInlineText();closeTools();
}

export function registerStoryToolEvents(){
    document.addEventListener('click',event=>{
        if(toolSession&&(event.target.closest('.story-create-back')||event.target.closest('.story-create-close'))){event.preventDefault();event.stopImmediatePropagation();finishStoryMode(false);}
    },true);
    document.addEventListener('keydown',event=>{
        const choice=event.target.closest?.('[data-story-color-choice]');
        if(choice&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
            const choices=[...choice.closest('[role="radiogroup"]').querySelectorAll('[data-story-color-choice]')];
            const current=choices.indexOf(choice),nextIndex=event.key==='Home'?0:event.key==='End'?choices.length-1:(current+(event.key==='ArrowRight'?1:-1)+choices.length)%choices.length;
            event.preventDefault();choices[nextIndex].focus();setStoryPickerColor(choices[nextIndex].dataset.storyColorChoice);return;
        }
        if(choice&&event.key==='Escape'){
            const chart=choice.closest('[data-story-color-chart]'),toggle=document.querySelector(`[aria-controls="${chart.id}"]`);
            event.preventDefault();event.stopImmediatePropagation();closeStoryColorPalette(chart,toggle);return;
        }
        if(toolSession&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finishStoryMode(false);}
    },true);

    document.addEventListener('click',event=>{
        const target=event.target;
        const colorToggle=target.closest('[data-story-color-toggle]');if(colorToggle){const chart=document.getElementById(colorToggle.getAttribute('aria-controls'));const open=chart.hidden;renderColorPickerState(currentStoryColor()||'#ffffff');chart.hidden=!open;colorToggle.setAttribute('aria-expanded',String(open));if(open)(chart.querySelector('[aria-checked="true"]')||chart.querySelector('[data-story-color-choice]'))?.focus();return;}
        const colorChoice=target.closest('[data-story-color-choice]');if(colorChoice){const chart=colorChoice.closest('[data-story-color-chart]'),toggle=document.querySelector(`[aria-controls="${chart.id}"]`);setStoryPickerColor(colorChoice.dataset.storyColorChoice);closeStoryColorPalette(chart,toggle);return;}
        if(target.closest('[data-story-mode-save]')){finishStoryMode(true);return;}
        if(target.closest('[data-story-mode-discard]')){finishStoryMode(false);return;}
        const filter=target.closest('[data-story-filter]');if(filter&&toolSession?.kind==='filters'){
            const e=toolSession.current();e.filter.preset=filter.dataset.storyFilter;commitStoryEdit(e);
            syncFilterSelection(e.filter.preset);filter.scrollIntoView?.({block:'nearest',inline:'center',behavior:'smooth'});return;
        }
        const adjust=target.closest('[data-story-adjustment-select]');if(adjust&&toolSession?.kind==='adjustments'){activeAdjustment=adjust.dataset.storyAdjustmentSelect;renderStoryMode();return;}
        const brush=target.closest('[data-story-draw-mode]');if(brush&&drawMode){drawMode.mode=brush.dataset.storyDrawMode;renderStoryMode();return;}
        if(target.closest('[data-story-stroke-toggle]')){const slider=document.querySelector('.story-stroke-slider');slider.hidden=!slider.hidden;target.closest('[data-story-stroke-toggle]').setAttribute('aria-expanded',String(!slider.hidden));return;}

        if(target.closest('[data-story-text-cancel]')){if(['text','location'].includes(toolSession?.kind))finishInlineText(false);else closeInlineText();return;}
        if(target.closest('[data-story-text-done]')){finishInlineText(true);return;}
        const fontButton=target.closest('[data-story-font]');if(fontButton&&toolSession?.kind==='text'&&textDraft){textDraft.font=fontButton.dataset.storyFont;renderStoryTextControls();syncInlineTextStyle();return;}
        const mention=target.closest('[data-inline-mention]');if(mention){const field=document.querySelector('.story-inline-text textarea');field.value=field.value.replace(/@[a-zA-Z0-9._]*$/,mention.dataset.inlineMention);document.getElementById('story-mention-suggestions').replaceChildren();field.focus();return;}
        if(target.closest('.story-tools-open')){closeInlineText();openTools();return;}
        if(target.closest('.story-tools-back')){closeStickerPicker();return;}
        if(target.closest('.story-tools-close') || target===document.querySelector('.story-tools-backdrop')){closeTools();return;}
        if(!pending() || !mayInteract())return;
        if(target.closest('.story-preview-sound')){if(pending().type!=='video')return;const next=currentComposition();next.video.muted=!next.video.muted;commitStoryEdit(next);return;}
        if(target.closest('.story-undo') || target.closest('.story-redo')){
            ensureHistory();const next=target.closest('.story-undo')?activeHistory().undo():activeHistory().redo();if(!toolSession)pending().edits=next;else if(toolSession.kind==='filters')syncFilterSelection(next.filter.preset);repaint();return;
        }
        const section=target.closest('[data-story-sticker-section]');
        if(section&&stickerView){const key=section.dataset.storyStickerSection;renderStickerPicker(key);document.getElementById(`story-sticker-tab-${key}`).focus();return;}
        const stickerChoice=target.closest('[data-story-sticker-label]');
        if(stickerChoice){const choice=storyStickerChoices.find(item=>item.id===stickerChoice.dataset.storyStickerLabel);if(!choice)return;const e=storyComposition(pending().edits),layer={id:id(),type:'sticker',text:choice.text,background:choice.background,color:choice.color,x:.5,y:.4,size:8,rotation:0};e.layers.push(layer);selectedLayer=layer.id;commitStoryEdit(e);closeTools();return;}
        const sticker=target.closest('[data-story-sticker]');
        if(sticker){const e=storyComposition(pending().edits);const layer={id:id(),type:'emoji',text:sticker.dataset.storySticker,x:.5,y:.4,size:15};e.layers.push(layer);selectedLayer=layer.id;commitStoryEdit(e);closeTools();return;}
        const tool=target.closest('[data-story-tool]');if(tool){toolForm(tool.dataset.storyTool);return;}
        if(target.closest('.story-draw-done')){drawMode=null;moveMode=false;repaint();return;}
        if(target.closest('[data-story-drag-media]')){moveMode=true;drawMode=null;closeTools();repaint();return;}
        const e=storyComposition(pending().edits);
        if(target.closest('[data-story-rotate]')){e.media.rotation=((e.media.rotation+90+180)%360)-180;commitStoryEdit(e);toolForm('rotate');}
        if(target.closest('[data-story-remove-music]')){e.music=null;commitStoryEdit(e);toolForm('music');}
        if(target.closest('[data-story-remove-layer]')){e.layers=e.layers.filter(item=>item.id!==selectedLayer);selectedLayer=null;commitStoryEdit(e);closeTools();}
    });
    document.addEventListener('submit',event=>{if(!event.target.matches('.story-tool-form'))return;event.preventDefault();if(['text','location'].includes(toolSession?.kind)&&event.target.matches('.story-inline-form,.story-location-inline-form'))return;if(pending()&&mayInteract())applyTool(event.target);});
    document.addEventListener('input',event=>{
        const search=event.target.closest('[data-story-sticker-search]');if(search&&stickerView){stickerQueries[stickerView]=search.value;document.getElementById('story-sticker-panel').innerHTML=stickerResults(stickerView);return;}
        const adjust=event.target.closest('[data-story-adjustment]');if(adjust){updateStoryAdjustment(adjust.dataset.storyAdjustment,adjust.value);document.querySelector('[data-story-adjust-value]').textContent=`${adjust.value}%`;return;}
        if(event.target.closest('[data-story-draw-width]')&&drawMode){const percent=clamp(Number(event.target.value),0,100);drawMode.width=storyDrawingWidthFromPercent(percent);event.target.setAttribute('aria-valuetext',`${Math.round(percent)}%`);const output=document.querySelector('[data-story-draw-size]');if(output)output.textContent=`${Math.round(percent)}%`;return;}
        const form=event.target.closest('.story-tool-form');if(form?.matches('.story-inline-form'))syncInlineTextStyle();if(!form || form.dataset.tool!=='text' || event.target.name!=='text')return;
        const value=event.target.value, match=/@[a-zA-Z0-9._]*$/.exec(value);
        document.getElementById('story-mention-suggestions').innerHTML=match?state.accountDirectory.filter(a=>!state.blockedHandles.has(a.handle)&&a.handle.toLowerCase().startsWith(match[0].toLowerCase())).slice(0,8).map(a=>`<button type="button" data-inline-mention="${escapeHtml(a.handle)}">${escapeHtml(a.name)} · ${escapeHtml(a.handle)}</button>`).join(''):'';
    });
    document.addEventListener('change',event=>{
        if(event.target.closest('.story-inline-form')){syncInlineTextStyle();return;}
        if(event.target.id!=='story-music-file' || !pending() || !mayInteract())return;
        const file=event.target.files?.[0];if(!file)return;
        if(!file.type.startsWith('audio/') || file.size>20*1024*1024){showShareFeedback('Choose an audio file up to 20 MB.');event.target.value='';return;}
        const e=storyComposition(pending().edits);e.music={src:URL.createObjectURL(file),title:`User-selected: ${file.name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,90)}`,start:0,end:null,volume:1};commitStoryEdit(e);toolForm('music');
    });
    let filterScrollTimer;
    document.addEventListener('scroll',event=>{
        if(!event.target.matches?.('.story-filter-strip')||toolSession?.kind!=='filters')return;
        clearTimeout(filterScrollTimer);const session=toolSession,strip=event.target;
        filterScrollTimer=setTimeout(()=>{
            if(toolSession!==session)return;
            const rect=strip.getBoundingClientRect(),center=rect.left+rect.width/2;
            const buttons=[...strip.querySelectorAll('[data-story-filter]')];
            const chosen=buttons.reduce((best,button)=>{const r=button.getBoundingClientRect(),distance=Math.abs(r.left+r.width/2-center);return !best||distance<best.distance?{button,distance}:best;},null)?.button;
            if(!chosen)return;const e=toolSession.current();e.filter.preset=chosen.dataset.storyFilter;commitStoryEdit(e);
            buttons.forEach(button=>button.setAttribute('aria-pressed',String(button===chosen)));
        },160);
    },true);
    const stage=preview();
    const pointers=mediaPointers;
    const pair=()=>{const [a,b]=[...pointers.values()];return {distance:Math.hypot(b.x-a.x,b.y-a.y),angle:Math.atan2(b.y-a.y,b.x-a.x),x:(a.x+b.x)/2,y:(a.y+b.y)/2};};
    stage.addEventListener('pointerdown',event=>{
        if((toolSession&&toolSession.kind!=='draw')||!pending() || !mayInteract() || event.target.closest('audio, .story-music-toggle, button') || !document.querySelector('.story-inline-text').hidden)return;
        if(pointers.size>=2)return;
        ensureHistory();
        if(pointers.size===0)clearAlignmentGuides();
        pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
        stage.setPointerCapture(event.pointerId);event.preventDefault();
        if(pointers.size===2 && !drawMode){
            // Start from the on-screen single-finger position without losing that movement.
            const e=storyComposition(gesture?.next||currentComposition());
            gesture={story:pending(),e,rect:stage.getBoundingClientRect(),mode:'pinch',layer:gesture?.mode==='layer'?gesture.layer:null,pair:pair()};return;
        }
        if(pointers.size===2)return;
        const layer=drawMode?null:event.target.closest('.story-composition-layer');
        const rect=stage.getBoundingClientRect(),point={x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1)};
        if(layer){selectedLayer=layer.dataset.layerId;layer.classList.add('story-layer-selected');}
        gesture={story:pending(),e:currentComposition(),point,rect,layer:layer?.dataset.layerId,draw:drawMode?{id:id(),type:'draw',...drawMode,points:[point]}:null,mode:drawMode?'draw':layer?'layer':'media'};
    });
    stage.addEventListener('pointermove',event=>{
        if(!gesture || gesture.story!==pending() || !pointers.has(event.pointerId))return;
        pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
        const e=storyComposition(gesture.e);
        if(gesture.mode==='pinch'){
            if(pointers.size!==2)return;
            const now=pair(),base=gesture.pair,ratio=now.distance/Math.max(1,base.distance);
            const dx=(now.x-base.x)/gesture.rect.width,dy=(now.y-base.y)/gesture.rect.height;
            const rotation=Math.atan2(Math.sin(now.angle-base.angle),Math.cos(now.angle-base.angle))*180/Math.PI;
            const layer=e.layers.find(item=>item.id===gesture.layer);
            if(layer){layer.size=clamp((layer.size||7)*ratio,2,25);layer.x=clamp(layer.x+dx,0,1);layer.y=clamp(layer.y+dy,0,1);layer.rotation=((layer.rotation||0)+rotation+540)%360-180;}
            else{e.media.zoom=clamp(e.media.zoom*ratio,.2,4);e.media.x=clamp(e.media.x+dx*100,-100,100);e.media.y=clamp(e.media.y+dy*100,-100,100);e.media.rotation=(e.media.rotation+rotation+540)%360-180;const snap=snapStoryMedia(e.media);e.media.rotation=snap.rotation;e.media.zoom=snap.zoom;showAlignmentGuides(snap);}
        }else{
            const point={x:clamp((event.clientX-gesture.rect.left)/gesture.rect.width,0,1),y:clamp((event.clientY-gesture.rect.top)/gesture.rect.height,0,1)},dx=point.x-gesture.point.x,dy=point.y-gesture.point.y;
            if(gesture.mode==='draw'){
                if(gesture.draw.points.length<1000)gesture.draw.points.push(point);
                e.layers.push(gesture.draw);
            }else if(gesture.mode==='media'){e.media.x=clamp(e.media.x+dx*100,-100,100);e.media.y=clamp(e.media.y+dy*100,-100,100);}
            else{const item=e.layers.find(layer=>layer.id===gesture.layer);if(item){item.x=clamp(item.x+dx,0,1);item.y=clamp(item.y+dy,0,1);}}
        }
        if(gesture.mode!=='draw'){
            const layer=gesture.layer?e.layers.find(item=>item.id===gesture.layer):null;
            const position=snapStoryCenter(layer?layer.x:e.media.x,layer?layer.y:e.media.y,!layer);
            Object.assign(layer||e.media,{x:position.x,y:position.y});showCenterGuides(position);
            if(layer){
                const angle=snapStoryRotation(layer.rotation||0);layer.rotation=angle.rotation;
                gesture.overlayAngleSnapped=gesture.mode==='pinch'&&angle.snapped;
                preview().classList.remove('story-angle-snapped','story-size-snapped');
                gesture.deleteDrop=updateDeleteTarget(event);
            }
        }
        gesture.next=e;applyStoryComposition(stage,{...pending(),edits:e},{editing:true});
        if(gesture.mode!=='draw')updateStoryEditorDrag(event,stage.querySelector(gesture.layer?`[data-layer-id="${gesture.layer}"]`:':scope > .story-media-outline'));
        if(gesture.layer){const selected=stage.querySelector(`[data-layer-id="${gesture.layer}"]`);selected?.classList.add('story-layer-selected');if(gesture.overlayAngleSnapped)selected?.classList.add('story-overlay-angle-snapped');}
    });
    stage.addEventListener('pointerup',event=>{
        updateStoryEditorDrag();
        pointers.delete(event.pointerId);
        if(gesture&&gesture.story===pending()){const next=gesture.next,layerId=gesture.layer;
            if(next&&gesture.deleteDrop&&layerId)next.layers=next.layers.filter(item=>item.id!==layerId);
            const tappedLayer=!next&&layerId?gesture.e.layers.find(item=>item.id===layerId):null;
            gesture=null;pointers.clear();hideDeleteTarget();if(next)commitStoryEdit(next);fadeAlignmentGuides();
            if(tappedLayer?.type==='text')openInlineText(layerId);
            else if(tappedLayer?.type==='location')openInlineLocation(layerId);
        }
    });
    const cancelMediaGesture=()=>{updateStoryEditorDrag();pointers.clear();gesture=null;hideDeleteTarget();clearAlignmentGuides();repaint();};
    stage.addEventListener('pointercancel',cancelMediaGesture);
    stage.addEventListener('lostpointercapture',()=>{if(gesture)cancelMediaGesture();});
    stage.addEventListener('keydown',event=>{
        const target=event.target.closest('.story-composition-layer');if(!target || !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key) || !mayInteract())return;
        event.preventDefault();const e=storyComposition(pending().edits),layer=e.layers.find(item=>item.id===target.dataset.layerId);if(!layer)return;
        selectedLayer=layer.id;layer.x=clamp(layer.x+(event.key==='ArrowRight' ? .01 : event.key==='ArrowLeft' ? -.01 : 0),0,1);layer.y=clamp(layer.y+(event.key==='ArrowDown' ? .01 : event.key==='ArrowUp' ? -.01 : 0),0,1);commitStoryEdit(e);
        stage.querySelector(`[data-layer-id="${layer.id}"]`)?.focus();
    });
    document.addEventListener('keydown',event=>{
        const popup=document.querySelector('.story-tools-backdrop');if(popup.hidden)return;
        const section=event.target.closest('[data-story-sticker-section]');
        if(section&&['ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
            event.preventDefault();const order=['stickers','emojis','gifs'],current=order.indexOf(section.dataset.storyStickerSection);
            const index=event.key==='Home'?0:event.key==='End'?order.length-1:(current+(event.key==='ArrowRight'?1:-1)+order.length)%order.length;
            const key=order[index];renderStickerPicker(key);document.getElementById(`story-sticker-tab-${key}`).focus();return;
        }
        if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeTools();return;}
        if(event.key==='Tab'){
            const controls=[...popup.querySelectorAll('button,input,select')].filter(e=>!e.disabled&&e.getClientRects().length),first=controls[0],last=controls.at(-1);
            if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
            else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
        }
    },true);
    document.addEventListener('account-deletion-lock',()=>{closeInlineText();hideDeleteTarget();resetStoryMode();document.querySelector('.story-tools-backdrop').hidden=true;});
}
