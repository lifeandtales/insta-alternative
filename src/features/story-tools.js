import { state } from '../core/state.js';
import { mayInteract } from '../core/social.js';
import { escapeHtml } from '../core/utils.js';
import { showShareFeedback } from '../components/feedback.js';
import { applyStoryComposition, storyComposition, compositionHistory } from './story-composition.js';

let storyRef, history, selectedLayer, gesture, drawMode, moveMode=false;
const preview=()=>document.querySelector('.story-selected-preview');
const pending=()=>state.pendingStoryMedia;
const id=()=>`layer-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;
const clamp=(v,min,max)=>Math.min(max,Math.max(min,v));
const val=(form,name)=>form.elements[name]?.value;
const numeric=(form,name)=>Number(val(form,name));
const input=(name,label,value,type='number',extra='')=>`<label>${label}<input name="${name}" type="${type}" value="${escapeHtml(String(value??''))}" ${extra} /></label>`;
const range=(name,label,value,min,max,step)=>input(name,label,value,'range',`min="${min}" max="${max}" step="${step}"`);

function ensureHistory(){
    if(storyRef!==pending()){
        storyRef=pending();history=storyRef?compositionHistory(storyRef.edits):null;selectedLayer=null;drawMode=null;moveMode=false;
    }
    return history;
}
function repaint(){
    if(!pending())return;
    applyStoryComposition(preview(),pending(),{editing:true});
    preview().querySelectorAll('.story-composition-layer').forEach(layer=>layer.classList.toggle('story-layer-selected',layer.dataset.layerId===selectedLayer));
    document.querySelector('.story-undo').disabled=!history?.canUndo();
    document.querySelector('.story-redo').disabled=!history?.canRedo();
    document.querySelector('.story-draw-done').hidden=!drawMode && !moveMode;
    preview().classList.toggle('story-drawing-mode',Boolean(drawMode||moveMode));
}
export function prepareStoryTools(){ensureHistory();repaint();}
export function commitStoryEdit(next){
    if(!pending() || !mayInteract() || !ensureHistory())return false;
    const changed=history.commit(next);pending().edits=history.current();repaint();return changed;
}
function closeTools(){
    document.querySelector('.story-tools-backdrop').hidden=true;
    document.querySelector('.story-create-dialog').inert=false;
    if(pending() && !state.deletionRequestedAt)document.querySelector('.story-tools-open').focus();
}
function toolForm(tool){
    const popup=document.querySelector('.story-tools-backdrop');
    popup.classList.add('story-tool-active');
    popup.classList.toggle('story-tool-mini',tool==='labels');
    document.getElementById('story-tools-title').textContent=({labels:'Location / Hashtag',sticker:'Stickers / Emojis',text:'Text / @mentions'})[tool]||tool.charAt(0).toUpperCase()+tool.slice(1);
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
    if(tool==='labels')fields=`<label>Label<select name="kind"><option value="location">Location</option><option value="hashtag">Hashtag</option></select></label>${input('text','Label text','','text','maxlength="100" required')}<p>Location is a text label you enter; it does not request your device location.</p>`;
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
        const layer={id:existing?.id||id(),x:existing?.x??.5,y:existing?.y??.4,type,text,font:val(form,'font')||'sans',color:val(form,'color')||'#ffffff',size:numeric(form,'size')||6,mentions};
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
    commitStoryEdit(e);closeTools();
}

export function registerStoryToolEvents(){
    document.addEventListener('click',event=>{
        const target=event.target;
        if(target.closest('.story-tools-open')){openTools();return;}
        if(target.closest('.story-tools-close') || target===document.querySelector('.story-tools-backdrop')){closeTools();return;}
        if(!pending() || !mayInteract())return;
        if(target.closest('.story-undo') || target.closest('.story-redo')){
            ensureHistory();pending().edits=target.closest('.story-undo')?history.undo():history.redo();repaint();return;
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
        const form=event.target.closest('.story-tool-form');if(!form || form.dataset.tool!=='text' || event.target.name!=='text')return;
        const value=event.target.value, match=/@[a-zA-Z0-9._]*$/.exec(value);
        document.getElementById('story-mention-suggestions').innerHTML=match?state.accountDirectory.filter(a=>!state.blockedHandles.has(a.handle)&&a.handle.toLowerCase().startsWith(match[0].toLowerCase())).slice(0,8).map(a=>`<option value="${escapeHtml(value.slice(0,match.index)+a.handle)}">${escapeHtml(a.name)}</option>`).join(''):'';
    });
    document.addEventListener('change',event=>{
        if(event.target.id!=='story-music-file' || !pending() || !mayInteract())return;
        const file=event.target.files?.[0];if(!file)return;
        if(!file.type.startsWith('audio/') || file.size>20*1024*1024){showShareFeedback('Choose an audio file up to 20 MB.');event.target.value='';return;}
        const e=storyComposition(pending().edits);e.music={src:URL.createObjectURL(file),title:`User-selected: ${file.name.replace(/[\u0000-\u001f\u007f]/g,'').slice(0,90)}`,start:0,end:null,volume:1};commitStoryEdit(e);toolForm('music');
    });
    const stage=preview();
    const pointers=new Map();
    const pair=()=>{const [a,b]=[...pointers.values()];return {distance:Math.hypot(b.x-a.x,b.y-a.y),angle:Math.atan2(b.y-a.y,b.x-a.x),x:(a.x+b.x)/2,y:(a.y+b.y)/2};};
    stage.addEventListener('pointerdown',event=>{
        if(!pending() || !mayInteract() || event.target.closest('audio, .story-music-toggle, button'))return;
        if(pointers.size>=2)return;
        ensureHistory();
        pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
        stage.setPointerCapture(event.pointerId);event.preventDefault();
        if(pointers.size===2 && !drawMode){
            // Start from the on-screen single-finger position without losing that movement.
            const e=storyComposition(gesture?.next||pending().edits);
            gesture={e,rect:stage.getBoundingClientRect(),mode:'pinch',layer:gesture?.mode==='layer'?gesture.layer:null,pair:pair()};return;
        }
        if(pointers.size===2)return;
        const layer=event.target.closest('.story-composition-layer');
        const rect=stage.getBoundingClientRect(),point={x:clamp((event.clientX-rect.left)/rect.width,0,1),y:clamp((event.clientY-rect.top)/rect.height,0,1)};
        if(layer){selectedLayer=layer.dataset.layerId;layer.classList.add('story-layer-selected');}
        gesture={e:storyComposition(pending().edits),point,rect,layer:layer?.dataset.layerId,draw:drawMode?{id:id(),type:'draw',...drawMode,points:[point]}:null,mode:drawMode?'draw':layer?'layer':'media'};
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
            else{e.media.zoom=clamp(e.media.zoom*ratio,.2,4);e.media.x=clamp(e.media.x+dx*100,-100,100);e.media.y=clamp(e.media.y+dy*100,-100,100);e.media.rotation=(e.media.rotation+rotation+540)%360-180;}
        }else{
            const point={x:clamp((event.clientX-gesture.rect.left)/gesture.rect.width,0,1),y:clamp((event.clientY-gesture.rect.top)/gesture.rect.height,0,1)},dx=point.x-gesture.point.x,dy=point.y-gesture.point.y;
            if(gesture.mode==='draw'){
                if(gesture.draw.mode==='line'||gesture.draw.mode==='arrow')gesture.draw.points=[gesture.point,point];
                else if(gesture.draw.points.length<1000)gesture.draw.points.push(point);
                e.layers.push(gesture.draw);
            }else if(gesture.mode==='media'){e.media.x=clamp(e.media.x+dx*100,-100,100);e.media.y=clamp(e.media.y+dy*100,-100,100);}
            else{const item=e.layers.find(layer=>layer.id===gesture.layer);if(item){item.x=clamp(item.x+dx,0,1);item.y=clamp(item.y+dy,0,1);}}
        }
        gesture.next=e;applyStoryComposition(stage,{...pending(),edits:e},{editing:true});
    });
    stage.addEventListener('pointerup',event=>{
        pointers.delete(event.pointerId);
        if(gesture){const next=gesture.next;gesture=null;pointers.clear();if(next)commitStoryEdit(next);}
    });
    stage.addEventListener('pointercancel',()=>{pointers.clear();gesture=null;repaint();});
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
    document.addEventListener('account-deletion-lock',()=>{drawMode=null;moveMode=false;document.querySelector('.story-tools-backdrop').hidden=true;});
}
