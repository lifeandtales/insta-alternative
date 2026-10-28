import { escapeHtml } from '../core/utils.js';

export const POST_FILTERS = Object.freeze([
    {id:'none',name:'Original',effect:''},
    {id:'warm',name:'Warm',effect:'sepia(.25) saturate(1.15)'},
    {id:'cool',name:'Cool',effect:'hue-rotate(15deg) saturate(.85)'},
    {id:'mono',name:'Black & white',effect:'grayscale(1)'},
    {id:'vivid',name:'Vivid',effect:'saturate(1.5) contrast(1.12)'},
    {id:'soft',name:'Soft',effect:'contrast(.86) brightness(1.08) saturate(.85)'},
    {id:'cinematic',name:'Cinematic',effect:'contrast(1.22) saturate(.75) sepia(.12)'},
    {id:'vintage',name:'Vintage',effect:'sepia(.4) contrast(.9) saturate(.8)'},
    {id:'fade',name:'Fade',effect:'contrast(.72) brightness(1.14) saturate(.7)'},
    {id:'noir',name:'Noir',effect:'grayscale(1) contrast(1.5) brightness(.85)'},
    {id:'sepia',name:'Sepia',effect:'sepia(.9) saturate(.75)'},
    {id:'sunset',name:'Sunset',effect:'sepia(.28) saturate(1.5) hue-rotate(-15deg)'},
    {id:'golden',name:'Golden',effect:'sepia(.38) saturate(1.25) brightness(1.08)'},
    {id:'matte',name:'Matte',effect:'contrast(.8) saturate(.9) brightness(1.06)'},
    {id:'crisp',name:'Crisp',effect:'contrast(1.3) saturate(1.12)'},
    {id:'rose',name:'Rose',effect:'sepia(.2) hue-rotate(-30deg) saturate(1.2) brightness(1.05)'},
    {id:'dreamy',name:'Dreamy',effect:'contrast(.78) brightness(1.18) saturate(1.15)'},
    {id:'arctic',name:'Arctic',effect:'sepia(.18) hue-rotate(160deg) saturate(.7) brightness(1.08)'},
    {id:'earth',name:'Earth',effect:'sepia(.3) saturate(.8) contrast(1.15)'},
    {id:'dramatic',name:'Dramatic',effect:'contrast(1.4) brightness(.9) saturate(.85)'},
    {id:'retro',name:'Retro',effect:'sepia(.32) hue-rotate(-12deg) saturate(1.3) contrast(.9)'}
].map(Object.freeze));

const bounded = (value, fallback, min, max) => Number.isFinite(Number(value)) ? Math.max(min, Math.min(max, Number(value))) : fallback;
export function mediaEdits(item = {}) {
    return {
        brightness: bounded(item.brightness, 100, 0, 200),
        contrast: bounded(item.contrast, 100, 0, 200),
        saturation: bounded(item.saturation, 100, 0, 200),
        rotation: bounded(item.rotation, 0, -180, 180),
        text: String(item.text || '').slice(0, 200),
        textX: bounded(item.textX, 50, 5, 95), textY: bounded(item.textY, 75, 5, 95),
        textSize: bounded(item.textSize, 6, 2, 12),
        filter: POST_FILTERS.some(filter => filter.id === item.filter) ? item.filter : 'none',
        ratio: ['original', '1/1', '4/5', '3/4', '16/9', '1.91/1', '9/16'].includes(item.ratio) ? item.ratio : 'original',
        originalAudioMuted: item.originalAudioMuted === true,
    };
}
export function mediaFilter(item) {
    const edit = mediaEdits(item);
    const effect = POST_FILTERS.find(filter => filter.id === edit.filter).effect;
    return `brightness(${edit.brightness}%) contrast(${edit.contrast}%) saturate(${edit.saturation}%)${effect ? ' '+effect : ''}`;
}
export function mediaAspect(item) {
    const edit = mediaEdits(item);
    const parts=edit.ratio.split('/').map(Number);
    const ratio=edit.ratio==='original'?bounded(item.naturalRatio,1,.1,10):parts[0]/parts[1];
    return item.layout==='reel' ? bounded(ratio,9/16,9/16,1.91) : bounded(ratio,4/5,3/4,1.91);
}
export function mediaFit(item) {
    const edit=mediaEdits(item);
    const source=bounded(item.naturalRatio,mediaAspect(item),.1,10);
    return item.fit==='cover'||edit.ratio!=='original'||Math.abs(source-mediaAspect(item))>.0001?'cover':'contain';
}
export function renderEditedMedia(item, {className = 'post-image', alt = 'Selected media', preview = false} = {}) {
    const edit = mediaEdits(item);
    const style = `object-fit:${mediaFit(item)};object-position:${bounded(item.x,50,0,100)}% ${bounded(item.y,50,0,100)}%;filter:${mediaFilter(item)};transform:rotate(${edit.rotation}deg)`;
    const media = item.type === 'video'
        ? `<video class="${escapeHtml(className)}" playsinline controls preload="metadata" ${preview || edit.originalAudioMuted ? 'muted' : ''} ${edit.originalAudioMuted ? 'data-original-audio-muted="true"' : ''} src="${escapeHtml(item.url)}" style="${style}"></video>`
        : `<img class="${escapeHtml(className)}" src="${escapeHtml(item.url)}" alt="${escapeHtml(alt)}" style="${style}" />`;
    const aspect = String(mediaAspect(item)).split("/").map(Number);
    const numericAspect = aspect.length === 2 ? aspect[0]/aspect[1] : aspect[0];
    return `<div class="post-media-stage" style="aspect-ratio:${mediaAspect(item)};--media-ratio:${numericAspect}">${media}${edit.text ? `<span class="post-media-text" style="left:${edit.textX}%;top:${edit.textY}%;font-size:${edit.textSize}cqw">${escapeHtml(edit.text)}</span>` : ''}</div>`;
}

// Work in percentages of the same fixed canvas used for the published post.
export function bindPostTextGestures(stage, item, changed = () => {}, canEdit = () => true) {
    const text = stage?.querySelector('.post-media-text');
    if (!text) return;
    text.tabIndex = 0;
    text.setAttribute('role','button');
    text.setAttribute('aria-label','Move text: drag or use arrow keys. Resize: pinch or use plus and minus.');
    stage.classList.add('post-text-editable');
    const points = new Map();
    let base = null;
    const geometry = () => {
        const values=[...points.values()];
        return {x:values.reduce((sum,p)=>sum+p.x,0)/values.length,y:values.reduce((sum,p)=>sum+p.y,0)/values.length,distance:values.length===2?Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y):0};
    };
    const rebase = () => { base=points.size?{...geometry(),...mediaEdits(item),bounds:stage.getBoundingClientRect()}:null; };
    const paint = () => {
        const edit=mediaEdits(item);
        text.style.left=`${edit.textX}%`;text.style.top=`${edit.textY}%`;text.style.fontSize=`${edit.textSize}cqw`;
        changed();
    };
    stage.addEventListener('pointerdown',event=>{
        if(!canEdit()||event.button>0||points.size>=2||(!points.size&&!event.target.closest('.post-media-text')))return;
        event.preventDefault();event.stopPropagation();
        points.set(event.pointerId,{x:event.clientX,y:event.clientY});
        stage.setPointerCapture(event.pointerId);stage.classList.add('post-text-dragging');rebase();
    });
    stage.addEventListener('pointermove',event=>{
        if(!points.has(event.pointerId)||!canEdit()||!base)return;
        event.preventDefault();
        points.set(event.pointerId,{x:event.clientX,y:event.clientY});
        const current=geometry();
        if(!base.bounds.width||!base.bounds.height)return;
        item.textX=bounded(base.textX+(current.x-base.x)/base.bounds.width*100,50,5,95);
        item.textY=bounded(base.textY+(current.y-base.y)/base.bounds.height*100,75,5,95);
        if(points.size===2&&base.distance>0)item.textSize=bounded(base.textSize*current.distance/base.distance,6,2,12);
        paint();
    });
    const release=event=>{
        if(!points.has(event.pointerId))return;
        points.delete(event.pointerId);
        if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);
        rebase();
        if(!points.size)stage.classList.remove('post-text-dragging');
    };
    stage.addEventListener('pointerup',release);
    stage.addEventListener('lostpointercapture',release);
    stage.addEventListener('pointercancel',()=>{
        const ids=[...points.keys()];points.clear();base=null;
        ids.forEach(id=>{if(stage.hasPointerCapture(id))stage.releasePointerCapture(id);});
        stage.classList.remove('post-text-dragging');
    });
    text.addEventListener('keydown',event=>{
        if(!canEdit())return;
        const edit=mediaEdits(item),step=event.shiftKey?5:1;
        if(event.key==='ArrowLeft')item.textX=Math.max(5,edit.textX-step);
        else if(event.key==='ArrowRight')item.textX=Math.min(95,edit.textX+step);
        else if(event.key==='ArrowUp')item.textY=Math.max(5,edit.textY-step);
        else if(event.key==='ArrowDown')item.textY=Math.min(95,edit.textY+step);
        else if(event.key==='+'||event.key==='=')item.textSize=Math.min(12,edit.textSize+.5);
        else if(event.key==='-')item.textSize=Math.max(2,edit.textSize-.5);
        else return;
        event.preventDefault();event.stopPropagation();paint();
    });
}

export function bindPostFilterSwipe(stage, change) {
    if (!stage) return;
    stage.classList.add('post-filter-swipe');
    let start = null;
    stage.addEventListener('pointerdown',event=>{
        if(event.button>0||event.target.closest('.post-media-text'))return;
        const video=event.target.closest('video');
        if(video&&event.clientY>video.getBoundingClientRect().bottom-48)return;
        if(start){start=null;return;}
        start={id:event.pointerId,x:event.clientX,y:event.clientY};
        stage.setPointerCapture(event.pointerId);
    });
    stage.addEventListener('pointermove',event=>{
        if(!start||start.id!==event.pointerId)return;
        const dx=event.clientX-start.x,dy=event.clientY-start.y;
        if(Math.abs(dx)>=35&&Math.abs(dx)>Math.abs(dy)*1.3){
            start=null;if(event.cancelable)event.preventDefault();change(dx<0?1:-1);
        }
    });
    stage.addEventListener('pointerup',event=>{
        if(!start||start.id!==event.pointerId)return;
        const dx=event.clientX-start.x,dy=event.clientY-start.y;
        start=null;
        if(stage.hasPointerCapture(event.pointerId))stage.releasePointerCapture(event.pointerId);
        if(Math.abs(dx)>=35&&Math.abs(dx)>Math.abs(dy)*1.3)change(dx<0?1:-1);
    });
    stage.addEventListener('pointercancel',()=>{start=null;});
    stage.addEventListener('lostpointercapture',()=>{start=null;});
}
