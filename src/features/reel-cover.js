import { state } from '../core/state.js';
import { renderSquareCover, REEL_COVER_SIZE } from '../media/cover-canvas.js';

let generation=0,video=null,sampler=null,galleryUrl='',signature='',draftMedia=null,draftItem=null,crop={x:50,y:50,zoom:1},working=false;
export function reelCoverSignature(item){return JSON.stringify(item||null);}
export function getReelCover(item){return state.createReelThumbnail?.signature===reelCoverSignature(item)?state.createReelThumbnail.data:null;}
function releaseMedia(){
    if(video){video.pause();video.removeAttribute('src');video.load();video=null;}
    if(sampler){sampler.pause();sampler.removeAttribute('src');sampler.load();sampler=null;}
    if(galleryUrl){URL.revokeObjectURL(galleryUrl);galleryUrl='';}
    draftMedia=null;draftItem=null;working=false;
}
export function resetReelCover(){generation++;releaseMedia();signature='';state.createReelThumbnail=null;}
export function suspendReelCover(){generation++;releaseMedia();signature='';}
function ready(media,event,trigger){return new Promise((resolve,reject)=>{
    const finish=error=>{clearTimeout(timer);media.removeEventListener(event,loaded);media.removeEventListener('error',failed);error?reject(error):resolve();};
    const loaded=()=>finish(),failed=()=>finish(new Error('This file could not be opened.'));
    const timer=window.setTimeout(()=>finish(new Error('Loading took too long. Please try again.')),12000);
    media.addEventListener(event,loaded,{once:true});media.addEventListener('error',failed,{once:true});trigger();
});}
async function seek(media,time){
    const target=Math.min(Math.max(0,time),Math.max(0,media.duration-.025));
    if(Math.abs(media.currentTime-target)<.001&&media.readyState>=2)return;
    await ready(media,'seeked',()=>{media.currentTime=target;});
}
// Close samples around the stopped time; never wrap or duplicate at clip boundaries.
export function nearbyFrameTimes(time,duration,count=6,step=1/30){
    const end=Math.max(0,duration-.025),center=Math.max(0,Math.min(end,time));
    return {before:Array.from({length:count},(_,i)=>center-(count-i)*step).filter(value=>value>=0),after:Array.from({length:count},(_,i)=>center+(i+1)*step).filter(value=>value<=end)};
}
const timeLabel=value=>`${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}.${Math.floor(value%1*10)}`;

export function renderReelCover(item){
    const root=document.querySelector('.create-reel-cover');root.hidden=state.createMediaType!=='reel'||!state.createDetailsOpen;
    if(root.hidden)return;
    const next=reelCoverSignature(item);if(signature===next)return;
    generation++;releaseMedia();signature=next;
    const saved=getReelCover(item);
    root.innerHTML=`<h3>Reel thumbnail</h3><p class="reel-cover-size">Square · ${REEL_COVER_SIZE} × ${REEL_COVER_SIZE}</p><div class="reel-cover-saved" ${saved?'':'hidden'}><img alt="Selected reel thumbnail" /><button type="button" class="reel-cover-change">Change thumbnail</button></div><div class="reel-cover-editor" ${saved?'hidden':''}><p>Choose a frame from your reel or upload an image.</p><div class="reel-cover-sources"><button type="button" data-cover-source="video" aria-pressed="false">From video</button><button type="button" data-cover-source="gallery" aria-pressed="false">Upload image</button></div><input class="reel-cover-file" type="file" accept="image/*" hidden /><p class="reel-cover-status" role="status"></p><div class="reel-cover-crop" hidden><img class="reel-cover-preview" alt="Square thumbnail crop preview" /><div class="reel-cover-timeline" hidden><div class="reel-cover-frames" aria-label="Nearby video frames" hidden><div class="reel-cover-frame-group" data-nearby="before" aria-label="Earlier frames"></div><span class="reel-cover-frame-divider" aria-hidden="true"></span><div class="reel-cover-frame-group" data-nearby="after" aria-label="Later frames"></div></div><label>Choose frame <output class="reel-cover-time">0:00.0</output><input class="reel-cover-seek" aria-label="Choose video frame" type="range" min="0" max="0" step="0.01" value="0" /></label></div><div class="reel-cover-position"><label>Horizontal crop<input data-cover-crop="x" type="range" min="0" max="100" value="50" /></label><label>Vertical crop<input data-cover-crop="y" type="range" min="0" max="100" value="50" /></label><label>Zoom<input data-cover-crop="zoom" type="range" min="1" max="3" step="0.01" value="1" /></label></div><button type="button" class="reel-cover-apply">Use thumbnail</button></div></div>`;
    const q=selector=>root.querySelector(selector),editor=q('.reel-cover-editor'),savedPanel=q('.reel-cover-saved'),status=q('.reel-cover-status'),cropPanel=q('.reel-cover-crop'),timeline=q('.reel-cover-timeline'),range=q('.reel-cover-seek'),apply=q('.reel-cover-apply');
    if(saved)q('.reel-cover-saved img').src=saved;
    const current=token=>token===generation&&root.isConnected&&state.createDetailsOpen;
    const paint=()=>{if(draftMedia)q('.reel-cover-preview').src=renderSquareCover(draftMedia,draftItem,crop);};
    const setBusy=value=>{working=value;apply.disabled=value;range.disabled=value;};
    const failed=(error,token)=>{if(current(token)){status.textContent=error.message||'The thumbnail could not be prepared.';setBusy(false);}};
    const resetCrop=()=>{crop={x:50,y:50,zoom:1};root.querySelectorAll('[data-cover-crop]').forEach(input=>{input.value=String(crop[input.dataset.coverCrop]);});};
    const selectSource=mode=>{root.querySelectorAll('[data-cover-source]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.coverSource===mode)));};
    let seekQueue=Promise.resolve(),wantedTime=null,nearbyRequest=0,refreshQueue=Promise.resolve();
    const frames=q('.reel-cover-frames');
    const hideNearby=()=>{nearbyRequest++;frames.hidden=true;};
    const selectTime=time=>{
        wantedTime=time;
        if(working)return seekQueue;
        const token=generation,media=video;working=true;apply.disabled=true;
        seekQueue=seekQueue.then(async()=>{
            while(wantedTime!==null&&current(token)){
                const nextTime=wantedTime;wantedTime=null;await seek(media,nextTime);if(!current(token))return;
                q('.reel-cover-time').textContent=timeLabel(media.currentTime);paint();
            }
        }).catch(error=>failed(error,token)).finally(()=>{if(current(token))setBusy(false);});
        return seekQueue;
    };
    const showNearby=async time=>{
        const request=++nearbyRequest,token=generation;
        // Serialize sampling on a separate decoder so it never changes the chosen preview.
        refreshQueue=refreshQueue.catch(()=>{}).then(async()=>{
            if(!current(token)||request!==nearbyRequest)return;
            if(!sampler){
                const media=document.createElement('video');sampler=media;media.muted=true;media.playsInline=true;media.preload='auto';
                await ready(media,'loadeddata',()=>{media.src=item.url;media.load();});
            }
            if(!current(token)||request!==nearbyRequest)return;
            const media=sampler,times=nearbyFrameTimes(time,video.duration),results={before:[],after:[]};
            status.textContent='Preparing nearby frames…';
            for(const side of ['before','after'])for(const frameTime of times[side]){
                if(!current(token)||request!==nearbyRequest)return;
                await seek(media,frameTime);if(!current(token)||request!==nearbyRequest)return;
                results[side].push({time:frameTime,image:renderSquareCover(media,item,{size:96})});
            }
            for(const side of ['before','after']){
                const group=q(`[data-nearby="${side}"]`);group.replaceChildren();
                for(const frame of results[side]){
                    const button=document.createElement('button');button.type='button';button.setAttribute('aria-label',`Choose frame at ${frame.time.toFixed(2)} seconds`);
                    const image=document.createElement('img');image.alt='';image.src=frame.image;button.append(image);
                    button.addEventListener('click',()=>{range.value=String(frame.time);selectTime(frame.time);});group.append(button);
                }
                group.scrollLeft=side==='before'?group.scrollWidth:0;
            }
            frames.hidden=false;status.textContent='';
        }).catch(error=>{if(current(token)&&request===nearbyRequest)status.textContent='Nearby frames could not load. You can still choose with the time slider.';});
        return refreshQueue;
    };
    range.addEventListener('input',()=>{hideNearby();selectTime(Number(range.value));});
    range.addEventListener('change',async()=>{
        const time=Number(range.value),token=generation;await selectTime(time);
        if(current(token))showNearby(time);
    });
    q('[data-cover-source="video"]').addEventListener('click',async()=>{
        const token=++generation;releaseMedia();hideNearby();wantedTime=null;seekQueue=Promise.resolve();refreshQueue=Promise.resolve();selectSource('video');resetCrop();cropPanel.hidden=true;timeline.hidden=false;status.textContent='Preparing video…';setBusy(true);
        const media=document.createElement('video');video=media;media.muted=true;media.playsInline=true;media.preload='auto';
        try{
            await ready(media,'loadeddata',()=>{media.src=item.url;media.load();});if(!current(token))return;
            if(!Number.isFinite(media.duration)||media.duration<=0)throw new Error('This video has no readable duration.');
            draftMedia=media;draftItem=item;range.max=String(Math.max(0,media.duration-.025));
            await seek(media,0);if(!current(token))return;range.value='0';q('.reel-cover-time').textContent=timeLabel(0);cropPanel.hidden=false;paint();status.textContent='Drag the time selector to choose a moment.';
        }catch(error){failed(error,token);}finally{if(current(token))setBusy(false);}
    });
    q('[data-cover-source="gallery"]').addEventListener('click',()=>{q('.reel-cover-file').value='';q('.reel-cover-file').click();});
    q('.reel-cover-file').addEventListener('change',async event=>{
        const file=event.target.files?.[0];if(!file)return;
        if(!file.type.startsWith('image/')){status.textContent='Choose an image for the thumbnail.';return;}
        const token=++generation;releaseMedia();hideNearby();wantedTime=null;seekQueue=Promise.resolve();refreshQueue=Promise.resolve();selectSource('gallery');resetCrop();cropPanel.hidden=true;timeline.hidden=true;status.textContent='Preparing image…';setBusy(true);
        galleryUrl=URL.createObjectURL(file);const image=document.createElement('img');
        try{await ready(image,'load',()=>{image.src=galleryUrl;});if(!current(token))return;draftMedia=image;draftItem=null;paint();cropPanel.hidden=false;status.textContent='Adjust the crop to fit the square thumbnail.';}catch(error){failed(error,token);}finally{if(current(token))setBusy(false);}
    });
    root.querySelectorAll('[data-cover-crop]').forEach(input=>input.addEventListener('input',()=>{crop[input.dataset.coverCrop]=Number(input.value);try{paint();}catch(error){status.textContent=error.message;}}));
    apply.addEventListener('click',()=>{
        if(working||!draftMedia)return;
        try{const data=renderSquareCover(draftMedia,draftItem,crop);state.createReelThumbnail={signature:next,data};q('.reel-cover-saved img').src=data;savedPanel.hidden=false;editor.hidden=true;document.querySelector('.create-publish-button').disabled=false;generation++;releaseMedia();}catch(error){status.textContent=error.message;}
    });
    q('.reel-cover-change').addEventListener('click',()=>{savedPanel.hidden=true;editor.hidden=false;cropPanel.hidden=true;status.textContent='Choose a source to change your thumbnail.';});
}
