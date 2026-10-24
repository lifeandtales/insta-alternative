import { storyFilterPresets, storyAdjustments, adjustmentFromSlider, adjustmentToSlider, createStoryEditSession } from './story-edit-session.js';
import { state } from '../core/state.js';
import { mayInteract } from '../core/social.js';
import { escapeHtml } from '../core/utils.js';
import { showShareFeedback } from '../components/feedback.js';
import { applyStoryComposition, storyComposition, compositionHistory } from './story-composition.js';

let storyRef, history, selectedLayer, gesture, drawMode, toolSession, activeAdjustment='brightness', moveMode=false;
const currentComposition=()=>toolSession?toolSession.current():storyComposition(pending()?.edits);
const activeHistory=()=>toolSession?.history||history;
const preview=()=>document.querySelector('.story-selected-preview');
const pending=()=>state.pendingStoryMedia;
const id=()=>`layer-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const val=(form,name)=>form.elements[name]?.value;
const numeric=(form,name)=>Number(val(form,name));
const input=(name,label,value,type='number',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(String(value??''))}" ${extra} /></label>`;
const range=(name,label,value,min,max,step)=>input(name,label,value,'range',`min="${min}" max="${max}" step="${step}"`);

// Small capture zones give quarter turns a detent without preventing free rotation.
export function snapStoryMedia(media) {
    const normalized=((media.rotation+180)%360+360)%360-180;
    const nearest=Math.round(normalized/90)*90;
    const rotationSnap=Math.abs(normalized-nearest)<=4;
    const sizeSnap=Math.abs(media.zoom-1)<=.035;
    return {rotation:rotationSnap?(nearest||0):normalized,zoom:sizeSnap?1:media.zoom,rotationSnap,sizeSnap};
}
let guideRevision=0;
function clearAlignmentGuides(){
    guideRevision++;
    const stage=preview();stage.classList.remove('story-angle-snapped','story-size-snapped');
    stage.removeAttribute('data-alignment-hint');
}
function showAlignmentGuides(snap){
    guideRevision++;
    const stage=preview();
    stage.classList.toggle('story-angle-snapped',snap.rotationSnap);
    stage.classList.toggle('story-size-snapped',snap.sizeSnap);
    stage.removeAttribute('data-alignment-hint');
}
function fadeAlignmentGuides(){const revision=guideRevision;setTimeout(()=>{if(revision===guideRevision)clearAlignmentGuides();},650);}


function ensureHistory(){
    if(storyRef!==pending()){
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
}
export function prepareStoryTools(){ensureHistory();repaint();}
export function commitStoryEdit(next){
    if(!pending() || !mayInteract() || !ensureHistory())return false;
    const changed=activeHistory().commit(next);if(!toolSession)pending().edits=history.current();repaint();return changed;
}
function closeTools(){
    document.querySelector('.story-tools-backdrop').hidden=true;
    document.querySelector('.story-create-dialog').inert=false;
    if(pending() && !state.deletionRequestedAt)document.querySelector('.story-tools-open').focus();
}
function resetStoryMode(){
    toolSession=null;drawMode=null;moveMode=false;
    document.querySelector('.story-create-dialog').classList.remove('story-mode-active');
    document.querySelector('.story-edit-mode-controls').hidden=true;
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
export function updateStoryAdjustment(key,value){
    if(toolSession?.kind!=='adjustments'||!storyAdjustments.some(item=>item.id===key))return false;
    const next=toolSession.current();next.filter[key]=adjustmentFromSlider(key,value);commitStoryEdit(next);return true;
}
function renderStoryMode(){
    if(!toolSession)return;
    const panel=document.querySelector('.story-edit-mode-controls');panel.hidden=false;
    const kind=toolSession.kind,e=toolSession.current();let controls='';
    if(kind==='filters'){
        controls=`<div class="story-filter-strip" role="group" aria-label="Swipe to browse filters">${storyFilterPresets.map(preset=>`<button type="button" data-story-filter="${preset.id}" aria-pressed="${e.filter.preset===preset.id}"><span class="story-filter-circle" style="filter:${preset.css||'none'}">${pending().type==='image'?`<img src="${escapeHtml(pending().media)}" alt="" />`:'◉'}</span><span>${preset.name}</span></button>`).join('')}</div>`;
    }
    if(kind==='adjustments'){
        const option=storyAdjustments.find(item=>item.id===activeAdjustment);
        controls=`<label class="story-live-slider"><span>${option.name} <output data-story-adjust-value>${adjustmentToSlider(option.id,e.filter[option.id])}%</output></span><input type="range" min="0" max="100" value="${adjustmentToSlider(option.id,e.filter[option.id])}" data-story-adjustment="${option.id}" aria-label="${option.name}" /></label><div class="story-adjustment-strip">${storyAdjustments.map(item=>`<button type="button" data-story-adjustment-select="${item.id}" aria-pressed="${item.id===activeAdjustment}"><span aria-hidden="true">${item.icon}</span>${item.name}</button>`).join('')}</div>`;
    }
    if(kind==='draw'){
        controls=`<div class="story-draw-modes">${[['pen','✎','Freehand'],['line','╱','Line'],['arrow','↗','Arrow'],['highlight','▰','Highlight']].map(([mode,icon,label])=>`<button type="button" data-story-draw-mode="${mode}" aria-pressed="${drawMode.mode===mode}"><span aria-hidden="true">${icon}</span>${label}</button>`).join('')}</div><div class="story-draw-settings"><label>Color<input type="color" data-story-draw-color value="${drawMode.color}" aria-label="Drawing color" /></label><button type="button" data-story-stroke-toggle aria-expanded="false">Stroke width</button><label class="story-stroke-slider" hidden>Stroke width<input type="range" min="2" max="30" value="${drawMode.width}" data-story-draw-width aria-label="Stroke width" /></label></div>`;
    }
    panel.innerHTML=`${controls}<div class="story-mode-actions"><button type="button" data-story-mode-save>Save changes</button><button type="button" data-story-mode-discard>Discard changes</button></div>`;
}
function syncInlineTextStyle(){
    const form=document.querySelector('.story-inline-text form');if(!form)return;
    const field=form.querySelector('textarea');
    Object.assign(field.style,{fontFamily:{sans:'Inter, sans-serif',serif:'Georgia, serif',mono:'monospace'}[val(form,'font')]||'Inter, sans-serif',fontSize:`${preview().getBoundingClientRect().width*(numeric(form,'size')||7)/100}px`,color:val(form,'color')||'#ffffff'});
}
function closeInlineText(){document.querySelector('.story-inline-text').hidden=true;document.querySelector('.story-create-dialog').classList.remove('story-location-editing');}
function openInlineLocation(){
    if(!pending()||!mayInteract())return;
    ensureHistory();selectedLayer=null;closeTools();closeInlineText();
    const box=document.querySelector('.story-inline-text');box.hidden=false;
    Object.assign(box.style,{left:'50%',top:'40%',width:'80%'});
    box.innerHTML=`<form class="story-tool-form story-inline-location-form" data-tool="labels"><input type="hidden" name="kind" value="location" /><label>📍 Location<input name="text" type="text" placeholder="Enter a location" maxlength="100" required aria-label="Location" /></label><button type="button" data-story-text-cancel>Cancel</button><button type="submit">Apply changes</button></form>`;
    document.querySelector('.story-create-dialog').classList.add('story-location-editing');
    box.querySelector('input[name="text"]').focus();
}
function openInlineText(layerId=null){
    if(!pending()||!mayInteract())return;
    ensureHistory();selectedLayer=layerId;
    const layer=storyComposition(pending().edits).layers.find(item=>item.id===layerId);
    closeTools();
    const box=document.querySelector('.story-inline-text');box.hidden=false;
    box.style.left=`${clamp(layer?.x??.5,.15,.85)*100}%`;box.style.top=`${clamp(layer?.y??.4,.15,.7)*100}%`;box.style.width=`${(layer?.width??.8)*100}%`;
    box.innerHTML=`<form class="story-tool-form story-inline-form" data-tool="text"><textarea name="text" maxlength="500" placeholder="Write text or @mention" aria-label="Story text">${escapeHtml(layer?.text||'')}</textarea><div id="story-mention-suggestions" class="story-inline-mentions"></div><div class="story-inline-format"><select name="font" aria-label="Font">${['sans','serif','mono'].map(font=>`<option ${layer?.font===font?'selected':''}>${font}</option>`).join('')}</select><input name="color" aria-label="Text color" type="color" value="${escapeHtml(layer?.color||'#ffffff')}" /><input name="size" type="range" aria-label="Text size" min="2" max="20" step=".5" value="${layer?.size||7}" /><button type="button" data-story-text-cancel>Cancel</button><button type="submit">Done</button></div></form>`;
    syncInlineTextStyle();box.querySelector('textarea').focus();
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
    document.getElementById('story-tools-title').textContent=({labels:'Location',sticker:'Stickers / Emojis',text:'Text / @mentions'})[tool]||tool.charAt(0).toUpperCase()+tool.slice(1);
    if(tool==='sticker'){
        document.querySelector('.story-tool-options').innerHTML=`<div class="story-sticker-picker">${['🙂','😂','😍','🥳','❤️','✨','🔥','🌈','🌸','☀️','🎉','💯','👏','🙌','🦋','🌿','⭐','💫','🎂','☕','📍','✈️','🏖️','🎵'].map(emoji=>`<button type="button" data-story-sticker="${emoji}" aria-label="Add ${emoji}">${emoji}</button>`).join('')}</div>`;return;
    }
    const e=storyComposition(pending().edits), layer=e.layers.find(item=>item.id===selectedLayer);
    let fields='';
    if(tool==='text')fields=`<p>Text may include @mentions. Suggestions resolve only local available accounts; no notifications are sent.</p>${input('text','Text',layer?.type==='text'?layer.text:'','text','maxlength="500" list="story-mention-suggestions" required')}<datalist id="story-mention-suggestions"></datalist><label>Font<select name="font">${['sans','serif','mono'].map(v=>`<option ${layer?.font===v?'selected':''}>${v}</option>`).join('')}</select></label>${range('size','Text size (% of Story width)',layer?.size||7,2,20,.5)}${input('color','Color',layer?.color||'#ffffff','color')}`;
    if(tool==='move')fields=`${range('x','Horizontal position',e.media.x,-100,100,1)}${range('y','Vertical position',e.media.y,-100,100,1)}${range('zoom','Zoom',e.media.zoom,.2,4,.05)}<button type="button" data-story-drag-media>Drag media on Story</button>`;
    if(tool==='fit')fields=`<label>Media framing<select name="fit"><option value="contain" ${e.media.fit==='contain'?'selected':''}>Fit · keep full media</option><option value="cover" ${e.media.fit==='cover'?'selected':''}>Fill · crop to Story</option></select></label>`;
    if(tool==='rotate')fields=`${range('rotation','Rotation',e.media.rotation,-180,180,1)}${range('straighten','Straighten',e.media.straighten,-15,15,.5)}<button type="button" data-story-rotate>Rotate 90°</button>`;
    if(tool==='filters')fields=`<label>Filter<select name="preset">${['none','mono','vivid','sepia'].map(v=>`<option ${e.filter.preset===v?'selected':''}>${v}</option>`).join('')}</select></label>${range('brightness','Brightness',e.filter.brightness,.2,2,.05)}${range('contrast','Contrast',e.filter.contrast,.2,2,.05)}${range('warmth','Warmth / cool tint',e.filter.warmth,-1,1,.05)}${range('saturation','Color saturation',e.filter.saturation,0,2,.05)}`;
    if(tool==='draw')fields=`<label>Drawing<select name="mode"><option value="pen">Freehand</option><option value="line">Line</option><option value="arrow">Arrow</option><option value="highlight">Highlighter</option></select></label>${input('color','Color','#ffffff','color')}${range('width','Stroke width',8,2,30,1)}<p>Choose Apply, then draw on the preview. Select Done when finished.</p>`;
    if(tool==='sticker')fields=`${input('text','Sticker / emoji','🙂','text','maxlength="40" required')}${range('size','Size (% of Story width)',15,4,25,.5)}<p>Drag the sticker to place it anywhere on the Story.</p>`;
    if(tool==='labels')fields=`<input type="hidden" name="kind" value="location" />${input('text','Location','','text','maxlength="100" required')}<p>Enter a location label.</p>`;
    if(tool==='music')fields=`<p>User-selected audio only. No commercial music catalogue or licence is provided.</p><label>Choose audio<input id="story-music-file" type="file" accept="audio/*,.mp3,.m4a,.wav,.ogg" /></label><p>${escapeHtml(e.music?.title||'No audio selected.')}</p>${input('start','Segment start (seconds)',e.music?.start||0,'number','min="0" step="0.1"')}${input('end','Segment end (blank = full track)',e.music?.end??'','number','min="0" step="0.1"')}${range('volume','Music volume',e.music?.volume??1,0,1,.05)}<button type="button" data-story-remove-music>Remove music</button>`;
    if(tool==='video')fields=`<p>Leave end blank to keep the full video after the chosen start.</p>${input('start','Trim start (seconds)',e.video.start,'number','min="0" step="0.1"')}${input('end','Trim end (blank = full length)',e.video.end??'','number','min="0" step="0.1"')}<label><input name="muted" type="checkbox" ${e.video.muted?'checked':''} /> Mute original sound</label>${range('volume','Original sound volume',e.video.volume,0,1,.05)}`;
    document.querySelector('.story-tool-options').innerHTML=`<form class="story-tool-form" data-tool="${tool}">${fields}<p class="story-tool-error" role="alert"></p><button type="submit" class="primary-btn">Apply ${tool==='draw'?'and draw':'changes'}</button>${layer?'<button type="button" data-story-remove-layer>Remove selected overlay</button>':''}</form>`;
}
function openTools(){
    if(!pending() || !mayInteract())return;
    ensureHistory();
    document.querySelector('.story-tools-backdrop').classList.remove('story-tool-active','story-tool-mini');
    document.getElementById('story-tools-title').textContent='Story tools';
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
            const duration=preview().querySelector('video')?.duration;
            if(Number.isFinite(duration) && (start>=duration || (end!=null && end>duration))){form.querySelector('.story-tool-error').textContent=`Choose a segment within ${duration.toFixed(1)} seconds.`;return;}
            Object.assign(e.video,{start,end,muted:form.elements.muted.checked,volume:numeric(form,'volume')});
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
        if(toolSession&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();finishStoryMode(false);}
    },true);

    document.addEventListener('click',event=>{
        const target=event.target;
        if(target.closest('[data-story-mode-save]')){finishStoryMode(true);return;}
        if(target.closest('[data-story-mode-discard]')){finishStoryMode(false);return;}
        const filter=target.closest('[data-story-filter]');if(filter&&toolSession?.kind==='filters'){
            const e=toolSession.current();e.filter.preset=filter.dataset.storyFilter;commitStoryEdit(e);
            document.querySelectorAll('[data-story-filter]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.storyFilter===e.filter.preset)));filter.scrollIntoView?.({block:'nearest',inline:'center',behavior:'smooth'});return;
        }
        const adjust=target.closest('[data-story-adjustment-select]');if(adjust&&toolSession?.kind==='adjustments'){activeAdjustment=adjust.dataset.storyAdjustmentSelect;renderStoryMode();return;}
        const brush=target.closest('[data-story-draw-mode]');if(brush&&drawMode){drawMode.mode=brush.dataset.storyDrawMode;renderStoryMode();return;}
        if(target.closest('[data-story-stroke-toggle]')){const slider=document.querySelector('.story-stroke-slider');slider.hidden=!slider.hidden;target.closest('[data-story-stroke-toggle]').setAttribute('aria-expanded',String(!slider.hidden));return;}

        if(target.closest('[data-story-text-cancel]')){closeInlineText();return;}
        const mention=target.closest('[data-inline-mention]');if(mention){const field=document.querySelector('.story-inline-text textarea');field.value=field.value.replace(/@[a-zA-Z0-9._]*$/,mention.dataset.inlineMention);document.getElementById('story-mention-suggestions').replaceChildren();field.focus();return;}
        if(target.closest('.story-tools-open')){closeInlineText();openTools();return;}
        if(target.closest('.story-tools-close') || target===document.querySelector('.story-tools-backdrop')){closeTools();return;}
        if(!pending() || !mayInteract())return;
        if(target.closest('.story-undo') || target.closest('.story-redo')){
            ensureHistory();const next=target.closest('.story-undo')?activeHistory().undo():activeHistory().redo();if(!toolSession)pending().edits=next;repaint();return;
        }
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
    document.addEventListener('submit',event=>{if(!event.target.matches('.story-tool-form'))return;event.preventDefault();if(pending()&&mayInteract())applyTool(event.target);});
    document.addEventListener('input',event=>{
        const adjust=event.target.closest('[data-story-adjustment]');if(adjust){updateStoryAdjustment(adjust.dataset.storyAdjustment,adjust.value);document.querySelector('[data-story-adjust-value]').textContent=`${adjust.value}%`;return;}
        if(event.target.closest('[data-story-draw-color]')&&drawMode){drawMode.color=event.target.value;return;}
        if(event.target.closest('[data-story-draw-width]')&&drawMode){drawMode.width=Number(event.target.value);return;}
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
    const pointers=new Map();
    const pair=()=>{const [a,b]=[...pointers.values()];return {distance:Math.hypot(b.x-a.x,b.y-a.y),angle:Math.atan2(b.y-a.y,b.x-a.x),x:(a.x+b.x)/2,y:(a.y+b.y)/2};};
    stage.addEventListener('pointerdown',event=>{
        if((toolSession&&toolSession.kind!=='draw')||!pending() || !mayInteract() || event.target.closest('audio, .story-music-toggle, button') || !document.querySelector('.story-inline-text').hidden)return;
        if(pointers.size>=2)return;
        ensureHistory();
        pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
        stage.setPointerCapture(event.pointerId);event.preventDefault();
        if(pointers.size===2 && !drawMode){
            // Start from the on-screen single-finger position without losing that movement.
            const e=storyComposition(gesture?.next||currentComposition());
            gesture={e,rect:stage.getBoundingClientRect(),mode:'pinch',layer:gesture?.mode==='layer'?gesture.layer:null,pair:pair()};return;
        }
        if(pointers.size===2)return;
        const layer=drawMode?null:event.target.closest('.story-composition-layer');
        const rect=stage.getBoundingClientRect(),point={x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1)};
        if(layer){selectedLayer=layer.dataset.layerId;layer.classList.add('story-layer-selected');}
        gesture={e:currentComposition(),point,rect,layer:layer?.dataset.layerId,draw:drawMode?{id:id(),type:'draw',...drawMode,points:[point]}:null,mode:drawMode?'draw':layer?'layer':'media'};
    });
    stage.addEventListener('pointermove',event=>{
        if(!gesture || !pointers.has(event.pointerId))return;
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
                if(gesture.draw.mode==='line'||gesture.draw.mode==='arrow')gesture.draw.points=[gesture.point,point];
                else if(gesture.draw.points.length<1000)gesture.draw.points.push(point);
                e.layers.push(gesture.draw);
            }else if(gesture.mode==='media'){e.media.x=clamp(e.media.x+dx*100,-100,100);e.media.y=clamp(e.media.y+dy*100,-100,100);}
            else{const item=e.layers.find(layer=>layer.id===gesture.layer);if(item){item.x=clamp(item.x+dx,0,1);item.y=clamp(item.y+dy,0,1);}}
        }
        if(gesture.mode==='layer'||(gesture.mode==='pinch'&&gesture.layer))gesture.deleteDrop=updateDeleteTarget(event);
        gesture.next=e;applyStoryComposition(stage,{...pending(),edits:e},{editing:true});
    });
    stage.addEventListener('pointerup',event=>{
        pointers.delete(event.pointerId);
        if(gesture){const next=gesture.next,layerId=gesture.layer;
            if(next&&gesture.deleteDrop&&layerId)next.layers=next.layers.filter(item=>item.id!==layerId);
            const tappedText=!next&&layerId&&gesture.e.layers.find(item=>item.id===layerId)?.type==='text';
            gesture=null;pointers.clear();hideDeleteTarget();if(next)commitStoryEdit(next);fadeAlignmentGuides();
            if(tappedText)openInlineText(layerId);
        }
    });
    stage.addEventListener('pointercancel',()=>{pointers.clear();gesture=null;hideDeleteTarget();clearAlignmentGuides();repaint();});
    stage.addEventListener('keydown',event=>{
        const target=event.target.closest('.story-composition-layer');if(!target || !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key) || !mayInteract())return;
        event.preventDefault();const e=storyComposition(pending().edits),layer=e.layers.find(item=>item.id===target.dataset.layerId);if(!layer)return;
        selectedLayer=layer.id;layer.x=clamp(layer.x+(event.key==='ArrowRight' ? .01 : event.key==='ArrowLeft' ? -.01 : 0),0,1);layer.y=clamp(layer.y+(event.key==='ArrowDown' ? .01 : event.key==='ArrowUp' ? -.01 : 0),0,1);commitStoryEdit(e);
        stage.querySelector(`[data-layer-id="${layer.id}"]`)?.focus();
    });
    document.addEventListener('keydown',event=>{
        const popup=document.querySelector('.story-tools-backdrop');if(popup.hidden)return;
        if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeTools();return;}
        if(event.key==='Tab'){
            const controls=[...popup.querySelectorAll('button,input,select')].filter(e=>!e.disabled&&e.getClientRects().length),first=controls[0],last=controls.at(-1);
            if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
            else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
        }
    },true);
    document.addEventListener('account-deletion-lock',()=>{closeInlineText();hideDeleteTarget();resetStoryMode();document.querySelector('.story-tools-backdrop').hidden=true;});
}
