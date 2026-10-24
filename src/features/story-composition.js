import { state } from '../core/state.js';

export const cloneComposition = value => JSON.parse(JSON.stringify(value));
const number = (value, fallback, min, max) => Math.max(min, Math.min(max, Number.isFinite(Number(value)) ? Number(value) : fallback));
export function storyComposition(value = {}) {
    const media = value.media || {}, filter = value.filter || {}, video = value.video || {};
    return {
        version: 1,
        media: { x:number(media.x,0,-100,100), y:number(media.y,0,-100,100), zoom:number(media.zoom,1,.2,4), rotation:number(media.rotation,0,-360,360), straighten:number(media.straighten,0,-15,15), fit:media.fit === 'cover' ? 'cover' : 'contain' },
        filter: { brightness:number(filter.brightness,1,.2,2), contrast:number(filter.contrast,1,.2,2), warmth:number(filter.warmth,0,-1,1), saturation:number(filter.saturation,1,0,2), preset:['none','mono','vivid','sepia'].includes(filter.preset) ? filter.preset : 'none' },
        layers: Array.isArray(value.layers) ? cloneComposition(value.layers) : [],
        music: value.music?.src ? cloneComposition(value.music) : null,
        video: { start:number(video.start,0,0,86400), end:video.end == null ? null : number(video.end,0,0,86400), muted:Boolean(video.muted), volume:number(video.volume,1,0,1) }
    };
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
    const full=Number.isFinite(duration) && duration>0 ? duration : 15;
    const start=Math.min(edit.start,Math.max(0,full-.05));
    const end=edit.end == null ? full : Math.max(start+.05,Math.min(edit.end,full));
    return {start,end,duration:end-start};
}

export function compositionMediaStyle(value) {
    const {media:m,filter:f}=storyComposition(value);
    const presets={none:'',mono:' grayscale(1)',vivid:' saturate(1.35)',sepia:' sepia(.65)'};
    return {objectFit:m.fit, transform:`translate(${m.x}%, ${m.y}%) scale(${m.zoom}) rotate(${m.rotation+m.straighten}deg)`,
        filter:`brightness(${f.brightness}) contrast(${f.contrast}) saturate(${f.saturation}) sepia(${Math.abs(f.warmth)*.4}) hue-rotate(${f.warmth<0 ? 180*Math.abs(f.warmth) : 0}deg)${presets[f.preset]}`};
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
        if(layer.mode==='highlight')path.setAttribute('opacity','.4');svg.append(path);
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
    if(layer.type==='text'&&layer.width)node.style.width=`${number(layer.width,.8,.1,.9)*100}%`;
    node.style.rotate=`${number(layer.rotation,0,-360,360)}deg`;
    node.style.fontSize=`${number(layer.size,7,2,25)}cqw`;node.style.color=layer.color||'#ffffff';
    node.style.fontFamily={sans:'Inter, sans-serif',serif:'Georgia, serif',mono:'monospace'}[layer.font]||'Inter, sans-serif';
    const text=String(layer.text||'');
    if(layer.type==='text' && !editing){
        let offset=0;
        for(const match of text.matchAll(/@[a-zA-Z0-9._]+/g)){
            node.append(document.createTextNode(text.slice(offset,match.index)));
            const ref=(layer.mentions||[]).find(item=>item.handle.toLowerCase()===match[0].toLowerCase());
            const account=ref && state.accountDirectory.find(item=>item.id===ref.id || item.handle.toLowerCase()===ref.handle.toLowerCase());
            if(account && !state.blockedHandles.has(account.handle)){
                const button=document.createElement('button');button.type='button';button.dataset.profileHandle=account.handle;button.className='story-text-mention';button.textContent=match[0];node.append(button);
            } else node.append(document.createTextNode(match[0]));
            offset=match.index+match[0].length;
        }
        node.append(document.createTextNode(text.slice(offset)));
    }else node.textContent=text;
    if(editing){node.tabIndex=0;node.setAttribute('aria-label',`Move ${layer.type}: ${text}`);}
    return node;
}

export function applyStoryComposition(stage, story, {editing=false}={}) {
    if(!stage?.ownerDocument)return; // The lightweight test DOM does not render media.
    stage.classList.add('story-composition-stage');stage.__compositionStory=story;
    const edit=storyComposition(story.edits), media=stage.querySelector('img, video');
    const musicKey=JSON.stringify(edit.music), keepMusic=stage.dataset.storyMusic===musicKey && Boolean(stage.querySelector('.story-composition-audio'));
    stage.querySelectorAll('.story-composition-layer, .story-draw-layer').forEach(node=>node.remove());
    if(!keepMusic)stage.querySelectorAll('.story-composition-audio, .story-music-toggle').forEach(node=>{if(node.tagName==='AUDIO')node.pause();node.remove();});
    stage.dataset.storyMusic=musicKey;
    if(media){Object.assign(media.style,compositionMediaStyle(edit));media.style.transformOrigin='center';}
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
            media.addEventListener('timeupdate',()=>{const range=storyVideoRange(stage.__compositionStory,media.duration);if(media.currentTime>=range.end-.03 && range.end<media.duration-.03)media.pause();});
            media.addEventListener('play',()=>{const range=storyVideoRange(stage.__compositionStory,media.duration);if(media.currentTime<range.start || media.currentTime>=range.end-.05)media.currentTime=range.start;const audio=stage.querySelector('audio');if(audio)audio.play().catch(()=>{});});
            media.addEventListener('pause',()=>stage.querySelector('audio')?.pause());
        }
        if(Number.isFinite(media.duration)){const range=storyVideoRange(story,media.duration);if(media.currentTime<range.start || media.currentTime>range.end)media.currentTime=range.start;}
    }
}
