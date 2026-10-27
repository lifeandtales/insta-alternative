import { state } from '../core/state.js';
import { getStoryFontStyle } from './story-fonts.js';

export const STORY_VIDEO_LIMIT_SECONDS=240;
export const STORY_FILTER_PRESET_IDS=Object.freeze(['none','mono','vivid','sepia','soft','golden','cool','fade','dramatic','rose','amber','blush','mint','twilight','film','bright','deep','punch','arctic','chalk']);
export const cloneComposition = value => JSON.parse(JSON.stringify(value));
const number = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
export function storyComposition(value = {}) {
    const media = value.media || {}, filter = value.filter || {}, video = value.video || {};
    return {
        version: 1,
        media: { x:number(media.x,0,-100,100), y:number(media.y,0,-100,100), zoom:number(media.zoom,1,.2,4), rotation:number(media.rotation,0,-360,360), straighten:number(media.straighten,0,-15,15), fit:media.fit === 'cover' ? 'cover' : 'contain' },
        filter: { brightness:number(filter.brightness,1,.2,2), contrast:number(filter.contrast,1,.2,2), warmth:number(filter.warmth,0,-1,1), tint:number(filter.tint,0,-1,1), hue:number(filter.hue,0,-180,180), saturation:number(filter.saturation,1,0,2), preset:STORY_FILTER_PRESET_IDS.includes(filter.preset) ? filter.preset : 'none' },
        layers: Array.isArray(value.layers) ? cloneComposition(value.layers) : [],
        music: value.music?.src ? cloneComposition(value.music) : null,
        video: { start:number(video.start,0,0,STORY_VIDEO_LIMIT_SECONDS-.05), end:video.end == null ? null : number(video.end,0,0,STORY_VIDEO_LIMIT_SECONDS), muted:Boolean(video.muted), volume:number(video.volume,1,0,1) }
    };
}

export function storyNeedsFullCanvasRepost(story, media, canvas) {
    const layers = storyComposition(story?.edits).layers;
    if (!layers.length) return false;
    const canvasRect = canvas?.getBoundingClientRect?.();
    const canvasWidth = canvasRect?.width || window.innerWidth;
    const canvasHeight = canvasRect?.height || window.innerHeight;
    const mediaWidth = media?.naturalWidth || media?.videoWidth;
    const mediaHeight = media?.naturalHeight || media?.videoHeight;
    if (!mediaWidth || !mediaHeight || !canvasWidth || !canvasHeight) return true;
    const edit = storyComposition(story.edits).media;
    if (edit.fit === 'cover') return false;
    const scale = Math.min(canvasWidth / mediaWidth, canvasHeight / mediaHeight);
    const imageWidth = mediaWidth * scale / canvasWidth;
    const imageHeight = mediaHeight * scale / canvasHeight;
    const left = (1 - imageWidth) / 2;
    const top = (1 - imageHeight) / 2;
    return layers.some(layer => {
        if (layer.type === 'draw') {
            const strokeRadius = number(layer.width, 8, 1, 40) / 2000;
            return (layer.points || []).some(point => point.x - strokeRadius < left || point.x + strokeRadius > left + imageWidth || point.y - strokeRadius < top || point.y + strokeRadius > top + imageHeight);
        }
        const x = number(layer.x, .5, 0, 1), y = number(layer.y, .4, 0, 1);
        const fontSize = number(layer.size, 7, 2, 25);
        const width = layer.type === 'text' ? Math.min(number(layer.width, .9, .1, .9), Math.max(.04, String(layer.text || '').length * fontSize * .0055)) : .12;
        const height = fontSize / 100 * canvasWidth / canvasHeight * Math.max(1, String(layer.text || '').split('\n').length) * 1.25;
        return x - width / 2 < left || x + width / 2 > left + imageWidth || y - height / 2 < top || y + height / 2 > top + imageHeight;
    });
}

// Rainbow ink follows traveled Story distance, so adding later pointer samples
// never changes colors already painted. The same segments drive preview/export.
export function storyDrawingSegments(points, {cycleLength=180, maxSegmentLength=5}={}) {
    const scaled=(points||[]).map(point=>({x:number(point.x,0,0,1)*1000,y:number(point.y,0,0,1)*1000}));
    const segments=[];let distanceAlongPath=0;
    for(let index=1;index<scaled.length;index++){
        const from=scaled[index-1],to=scaled[index],length=Math.hypot(to.x-from.x,to.y-from.y);
        if(!length)continue;
        const pieces=Math.max(1,Math.ceil(length/maxSegmentLength));
        for(let piece=0;piece<pieces;piece++){
            const startDistance=distanceAlongPath+length*piece/pieces,endDistance=distanceAlongPath+length*(piece+1)/pieces;
            const startRatio=piece/pieces,endRatio=(piece+1)/pieces;
            const start={x:from.x+(to.x-from.x)*startRatio,y:from.y+(to.y-from.y)*startRatio};
            const end={x:from.x+(to.x-from.x)*endRatio,y:from.y+(to.y-from.y)*endRatio};
            const hue=((((startDistance+endDistance)/2)/cycleLength*360)%360+360)%360;
            segments.push({from:start,to:end,color:`hsl(${hue.toFixed(2)} 100% 55%)`});
        }
        distanceAlongPath+=length;
    }
    return segments;
}

export function compositionHistory(initial = {}) {
    let entries=[storyComposition(initial)], cursor=0;
    return {
        current:()=>cloneComposition(entries[cursor]),
        commit(value) {
            const next=storyComposition(value);
            if (JSON.stringify(next) === JSON.stringify(entries[cursor])) return false;
            entries=entries.slice(0,cursor+1); entries.push(next);
            if (entries.length>80) entries.shift();
            cursor=entries.length-1; return true;
        },
        undo(){if(cursor>0)cursor--;return this.current();},
        redo(){if(cursor<entries.length-1)cursor++;return this.current();},
        canUndo:()=>cursor>0, canRedo:()=>cursor<entries.length-1
    };
}

export function storyVideoRange(story, duration) {
    const edit=storyComposition(story.edits).video;
    const full=Math.min(STORY_VIDEO_LIMIT_SECONDS,Number.isFinite(duration) && duration>0 ? duration : 15);
    const start=Math.min(edit.start,Math.max(0,full-.05));
    const end=edit.end == null ? full : Math.max(start+.05,Math.min(edit.end,full));
    return {start,end,duration:end-start};
}

export function compositionMediaStyle(value) {
    const {media:m,filter:f}=storyComposition(value);
    const presets={none:'',mono:' grayscale(1)',vivid:' saturate(1.35)',sepia:' sepia(.65)',soft:' contrast(.9) brightness(1.08)',golden:' sepia(.25) saturate(1.2)',cool:' sepia(.15) hue-rotate(160deg)',fade:' contrast(.8) saturate(.8) brightness(1.1)',dramatic:' contrast(1.3) saturate(.8)',rose:' sepia(.2) hue-rotate(310deg) saturate(1.15)',amber:' sepia(.28) saturate(1.35) hue-rotate(350deg) brightness(1.03)',blush:' sepia(.14) hue-rotate(320deg) saturate(1.2)',mint:' hue-rotate(85deg) saturate(1.08) brightness(1.02)',twilight:' hue-rotate(230deg) saturate(1.12) brightness(.93)',film:' sepia(.2) contrast(1.08) saturate(.78)',bright:' brightness(1.15) contrast(.96) saturate(1.04)',deep:' brightness(.9) contrast(1.16) saturate(1.08)',punch:' contrast(1.18) saturate(1.55)',arctic:' hue-rotate(185deg) saturate(.78) brightness(1.08)',chalk:' grayscale(.72) brightness(1.11) contrast(.88)'};
    return {objectFit:m.fit, transform:`translate(${m.x}%, ${m.y}%) scale(${m.zoom}) rotate(${m.rotation+m.straighten}deg)`,
        filter:`brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturation}) sepia(${Math.abs(f.warmth)*.4}) hue-rotate(${f.warmth<0 ? 180*Math.abs(f.warmth) : 0}deg) hue-rotate(${f.hue}deg) sepia(${Math.abs(f.tint)*.25}) hue-rotate(${f.tint*35}deg)${presets[f.preset]}`};
}

function renderLayer(layer, editing) {
    if(layer.type==='draw') {
        const svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
        svg.setAttribute('viewBox','0 0 1000 1000');svg.setAttribute('preserveAspectRatio','none');
        svg.setAttribute('role','img');svg.setAttribute('aria-label',`Story ${layer.mode||'freehand'} drawing`);
        svg.classList.add('story-draw-layer');svg.dataset.layerId=layer.id;
        const points=(layer.points||[]).map(p=>({x:number(p.x,0,0,1)*1000,y:number(p.y,0,0,1)*1000}));
        const path=document.createElementNS(svg.namespaceURI,'polyline');
        path.setAttribute('points',points.map(p=>`${p.x},${p.y}`).join(' '));path.setAttribute('fill','none');path.setAttribute('stroke',layer.color||'#ffffff');
        path.setAttribute('stroke-width',String(number(layer.width,8,1,40)));path.setAttribute('stroke-linecap','round');path.setAttribute('stroke-linejoin','round');
        if(layer.mode==='dotted'){const width=number(layer.width,8,1,40);path.setAttribute('stroke-dasharray',`${width*.55} ${width*1.7}`);}
        if(layer.mode==='highlight')path.setAttribute('opacity','.4');
        if(layer.mode==='colorful'){
            for(const segment of storyDrawingSegments(layer.points)){
                const stroke=document.createElementNS(svg.namespaceURI,'line');
                stroke.setAttribute('x1',String(segment.from.x));stroke.setAttribute('y1',String(segment.from.y));
                stroke.setAttribute('x2',String(segment.to.x));stroke.setAttribute('y2',String(segment.to.y));
                stroke.setAttribute('stroke',segment.color);stroke.setAttribute('stroke-width',String(number(layer.width,8,1,40)));
                stroke.setAttribute('stroke-linecap','round');svg.append(stroke);
            }
        }else svg.append(path);
        if(layer.mode==='arrow' && points.length>1){
            const a=points.at(-2),b=points.at(-1),angle=Math.atan2(b.y-a.y,b.x-a.x),size=number(layer.width,8,1,40)*3;
            const head=document.createElementNS(svg.namespaceURI,'polyline');
            head.setAttribute('points',`${b.x-size*Math.cos(angle-.5)},${b.y-size*Math.sin(angle-.5)} ${b.x},${b.y} ${b.x-size*Math.cos(angle+.5)},${b.y-size*Math.sin(angle+.5)}`);
            head.setAttribute('fill','none');head.setAttribute('stroke',layer.color||'#fff');head.setAttribute('stroke-width',String(layer.width||8));svg.append(head);
        }
        return svg;
    }
    const node=document.createElement('div');node.className=`story-composition-layer story-layer-${layer.type}`;node.dataset.layerId=layer.id;
    node.style.left=`${number(layer.x,.5,0,1)*100}%`;node.style.top=`${number(layer.y,.4,0,1)*100}%`;
    if(layer.type==='text'&&layer.width)node.style.maxWidth=`${number(layer.width,.8,.1,.9)*100}%`;
    node.style.rotate=`${number(layer.rotation,0,-360,360)}deg`;
    node.style.fontSize=`${number(layer.size,7,2,25)}cqw`;node.style.color=layer.color||'#ffffff';
    const font=getStoryFontStyle(layer.font);
    node.style.fontFamily=font.family;node.style.fontWeight=String(font.weight);node.style.fontStyle=font.style;
    node.style.letterSpacing=`${font.spacing}em`;node.style.textTransform=font.transform;
    if(layer.type==='sticker'){node.style.backgroundColor=layer.background||'#9277eb';node.style.color=layer.color||'#ffffff';}
    const text=String(layer.text||'');
    if(layer.type==='text' && !editing){
        let offset=0;
        for(const match of text.matchAll(/@[a-zA-Z0-9._]+/g)){
            node.append(document.createTextNode(text.slice(offset,match.index)));
            const ref=(layer.mentions||[]).find(item=>item.handle.toLowerCase()===match[0].toLowerCase());
            const account=ref && state.accountDirectory.find(item=>item.id===ref.id || item.handle.toLowerCase()===ref.handle.toLowerCase());
            if(account && !state.blockedHandles.has(account.handle)){
                const button=document.createElement('button');button.type='button';button.dataset.storyMentionHandle=account.handle;button.className='story-text-mention';button.textContent=match[0];node.append(button);
            } else node.append(document.createTextNode(match[0]));
            offset=match.index+match[0].length;
        }
        node.append(document.createTextNode(text.slice(offset)));
    }else node.textContent=layer.type==='location'?`📍 ${text}`:text;
    if(editing){node.tabIndex=0;node.setAttribute('aria-label',`Move ${layer.type}: ${text}`);}
    return node;
}

export function applyStoryComposition(stage, story, {editing=false}={}) {
    if(!stage?.ownerDocument)return; // The lightweight test DOM does not render media.
    stage.classList.add('story-composition-stage');stage.__compositionStory=story;
    const edit=storyComposition(story.edits), media=stage.querySelector(':scope > img, :scope > video');
    const musicKey=JSON.stringify(edit.music), keepMusic=stage.dataset.storyMusic===musicKey && Boolean(stage.querySelector(':scope > .story-composition-audio'));
    stage.querySelectorAll(':scope > .story-composition-layer, :scope > .story-draw-layer').forEach(node=>node.remove());
    if(!keepMusic)stage.querySelectorAll(':scope > .story-composition-audio, :scope > .story-music-toggle').forEach(node=>{if(node.tagName==='AUDIO')node.pause();node.remove();});
    stage.dataset.storyMusic=musicKey;
    if(!media){
        const repost=stage.querySelector(':scope > .story-repost-drag-frame, :scope > .story-reposted-card');
        if(repost)repost.style.filter=compositionMediaStyle(edit).filter;
    }
    if(media){
        Object.assign(media.style,compositionMediaStyle(edit));media.style.transformOrigin='center';
        if(editing){
            let guide=stage.querySelector(':scope > .story-media-outline');
            if(!guide){guide=document.createElement('div');guide.className='story-media-outline';guide.setAttribute('aria-hidden','true');stage.append(guide);}
            const width=media.clientWidth,height=media.clientHeight,nw=media.naturalWidth||media.videoWidth,nh=media.naturalHeight||media.videoHeight;
            if(width&&height&&nw&&nh){
                const factor=edit.media.fit==='cover'?Math.max(width/nw,height/nh):Math.min(width/nw,height/nh);
                const w=nw*factor,h=nh*factor;
                Object.assign(guide.style,{width:`${w}px`,height:`${h}px`,left:`${media.offsetLeft+(width-w)/2}px`,top:`${media.offsetTop+(height-h)/2}px`,transform:`translate(${edit.media.x*width/100}px, ${edit.media.y*height/100}px) scale(${edit.media.zoom}) rotate(${edit.media.rotation+edit.media.straighten}deg)`});
            }
        }
    }
    for(const layer of edit.layers)stage.append(renderLayer(layer,editing));
    if(edit.music?.src && !keepMusic){
        const audio=document.createElement('audio');audio.className='story-composition-audio';audio.src=edit.music.src;audio.preload='metadata';
        audio.setAttribute('aria-label',`Story audio: ${edit.music.title||'User-selected audio'}`);
        audio.volume=number(edit.music.volume,1,0,1);
        audio.dataset.segmentEnd=edit.music.end == null ? '' : String(edit.music.end);
        audio.addEventListener('loadedmetadata',()=>{audio.currentTime=Math.min(Number(edit.music.start)||0,Math.max(0,audio.duration-.05));});
        audio.addEventListener('play',()=>{if(audio.currentTime<(Number(edit.music.start)||0) || (edit.music.end!=null && audio.currentTime>=edit.music.end))audio.currentTime=Number(edit.music.start)||0;});
        audio.addEventListener('timeupdate',()=>{if(edit.music.end!=null && audio.currentTime>=edit.music.end)audio.pause();});
        stage.append(audio);
        const toggle=document.createElement('button');toggle.type='button';toggle.className='story-music-toggle';toggle.title=edit.music.title||'User-selected audio';
        const update=()=>{toggle.textContent=audio.paused?'♫':'Ⅱ';toggle.setAttribute('aria-label',`${audio.paused?'Play':'Pause'} Story music: ${edit.music.title||'User-selected audio'}`);};
        toggle.addEventListener('click',()=>{if(audio.paused)audio.play().catch(()=>{});else audio.pause();});audio.addEventListener('play',update);audio.addEventListener('pause',update);audio.addEventListener('ended',update);update();stage.append(toggle);
        if(!editing)audio.play().catch(()=>{}); // Native controls remain available if autoplay is blocked.
    }
    if(media?.tagName==='VIDEO'){
        media.volume=edit.video.volume;if(editing)media.muted=edit.video.muted;else if(edit.video.muted)media.muted=true;
        if(!media.dataset.compositionBound){
            media.dataset.compositionBound='true';
            media.addEventListener('loadedmetadata',()=>{const range=storyVideoRange(stage.__compositionStory,media.duration);media.currentTime=range.start;});
            media.addEventListener('timeupdate',()=>{const range=storyVideoRange(stage.__compositionStory,media.duration);if(media.currentTime>=range.end-.03 && range.end<media.duration-.03){media.pause();if(media.currentTime>range.end)media.currentTime=range.end;}});
            media.addEventListener('seeking',()=>{const range=storyVideoRange(stage.__compositionStory,media.duration);if(media.currentTime<range.start)media.currentTime=range.start;else if(media.currentTime>range.end)media.currentTime=range.end;});
            media.addEventListener('play',()=>{const range=storyVideoRange(stage.__compositionStory,media.duration);if(media.currentTime<range.start || media.currentTime>=range.end-.05)media.currentTime=range.start;const audio=stage.querySelector('audio');if(audio)audio.play().catch(()=>{});});
            media.addEventListener('pause',()=>stage.querySelector('audio')?.pause());
        }
        if(Number.isFinite(media.duration)){const range=storyVideoRange(story,media.duration);if(media.currentTime<range.start || media.currentTime>range.end)media.currentTime=range.start;}
    }
}
