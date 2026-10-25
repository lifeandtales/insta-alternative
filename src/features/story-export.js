import { state } from '../core/state.js';
import { mayInteract } from '../core/social.js';
import { storyComposition, compositionMediaStyle, storyVideoRange } from './story-composition.js';
import { showShareFeedback } from '../components/feedback.js';
import { getStoryFontStyle, transformStoryText } from './story-fonts.js';

const clamp=(value,min,max)=>Math.max(min,Math.min(max,value));
let operation,readyFile,readyURL;

// Export the original pixel dimensions (swapped for portrait/landscape turns),
// without the Story UI/background. At arbitrary angles, crop corners inside the
// actual media and render that crop into the original-size output frame.
export function storyExportGeometry(width,height,rotation=0,video=false){
    if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)throw new Error('Media dimensions are unavailable.');
    const radians=rotation*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));
    const quarter=((Math.round(rotation/90)%4)+4)%4;
    const outWidth=quarter%2?height:width,outHeight=quarter%2?width:height,ratio=outWidth/outHeight;
    const contentHeight=Math.min(width/(ratio*c+s),height/(ratio*s+c)),contentWidth=contentHeight*ratio;
    return {width:Math.max(1,Math.round(outWidth)),height:Math.max(1,Math.round(outHeight)),contentWidth,contentHeight,scale:outWidth/contentWidth};
}
export function storyExportMime(Recorder){
    return ['video/mp4;codecs=avc1.42E01E,mp4a.40.2','video/mp4','video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm'].find(type=>Recorder?.isTypeSupported?.(type))||'';
}
const check=signal=>{if(signal.aborted)throw new DOMException('Export cancelled.','AbortError');};
function waitForMedia(media,event,signal){
    return new Promise((resolve,reject)=>{
        let timer;
        const clean=()=>{clearTimeout(timer);media.removeEventListener(event,done);media.removeEventListener('error',fail);signal.removeEventListener('abort',abort);};
        const done=()=>{clean();resolve();},fail=()=>{clean();reject(new Error('This browser could not decode the source media. Try a compatible file; large/8K video may need server processing.'));},abort=()=>{clean();reject(new DOMException('Export cancelled.','AbortError'));};
        media.addEventListener(event,done,{once:true});media.addEventListener('error',fail,{once:true});signal.addEventListener('abort',abort,{once:true});
        timer=setTimeout(fail,30000);if(signal.aborted)abort();
    });
}
async function loadSource(story,signal){
    const media=document.createElement(story.type==='video'?'video':'img');
    media.crossOrigin='anonymous';
    if(story.type==='video'){media.playsInline=true;media.muted=true;media.preload='auto';}
    const loaded=waitForMedia(media,story.type==='video'?'loadeddata':'load',signal);media.src=story.media;
    try{await loaded;return media;}catch(error){media.pause?.();media.removeAttribute('src');throw error;}
}
function wrapText(context,text,maxWidth){
    const lines=[];
    for(const paragraph of String(text).split('\n')){
        let line='';
        for(const character of Array.from(paragraph)){
            if(line&&context.measureText(line+character).width>maxWidth){lines.push(line);line='';}
            line+=character;
        }
        lines.push(line);
    }
    return lines;
}
function roundedRect(ctx,x,y,width,height,radius){
    ctx.beginPath();ctx.moveTo(x+radius,y);ctx.arcTo(x+width,y,x+width,y+height,radius);ctx.arcTo(x+width,y+height,x,y+height,radius);ctx.arcTo(x,y+height,x,y,radius);ctx.arcTo(x,y,x+width,y,radius);ctx.closePath();
}
export function paintLayer(ctx,layer,stageWidth,stageHeight){
    ctx.save();
    if(layer.type==='draw'){
        ctx.scale(stageWidth/1000,stageHeight/1000);
        const points=(layer.points||[]).map(point=>({x:point.x*1000,y:point.y*1000}));
        if(!points.length){ctx.restore();return;}
        ctx.strokeStyle=layer.color||'#ffffff';ctx.lineWidth=layer.width||8;ctx.lineCap='round';ctx.lineJoin='round';ctx.globalAlpha=layer.mode==='highlight'?.4:1;
        ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);points.slice(1).forEach(point=>ctx.lineTo(point.x,point.y));ctx.stroke();
        if(layer.mode==='arrow'&&points.length>1){
            const a=points.at(-2),b=points.at(-1),angle=Math.atan2(b.y-a.y,b.x-a.x),size=(layer.width||8)*3;
            ctx.beginPath();ctx.moveTo(b.x-size*Math.cos(angle-.5),b.y-size*Math.sin(angle-.5));ctx.lineTo(b.x,b.y);ctx.lineTo(b.x-size*Math.cos(angle+.5),b.y-size*Math.sin(angle+.5));ctx.stroke();
        }
        ctx.restore();return;
    }
    ctx.translate(clamp(layer.x??.5,0,1)*stageWidth,clamp(layer.y??.4,0,1)*stageHeight);ctx.rotate((layer.rotation||0)*Math.PI/180);
    const fontSize=clamp(layer.size||7,2,25)*stageWidth/100;
    const font=getStoryFontStyle(layer.font);
    ctx.font=`${font.style} ${layer.type==='sticker'?800:font.weight} ${fontSize}px ${font.family}`;
    if('letterSpacing' in ctx)ctx.letterSpacing=`${fontSize*font.spacing}px`;
    ctx.textAlign='center';ctx.textBaseline='middle';
    const rawText=layer.type==='location'?`📍 ${layer.text||''}`:layer.text||'';
    const text=transformStoryText(rawText,font);
    const lines=wrapText(ctx,text,stageWidth*(layer.width||.9));
    const lineHeight=fontSize*1.2,height=lines.length*lineHeight;
    if(layer.type==='location'){
        const width=Math.max(...lines.map(line=>ctx.measureText(line).width))+24;
        ctx.fillStyle='#ffffffdc';roundedRect(ctx,-width/2,-height/2-8,width,height+16,10);ctx.fill();ctx.fillStyle='#21162e';
    }else if(layer.type==='sticker'){
        const width=Math.max(...lines.map(line=>ctx.measureText(line).width))+fontSize*.9;
        ctx.fillStyle=layer.background||'#9277eb';roundedRect(ctx,-width/2,-height/2-5,width,height+10,fontSize*.45);ctx.fill();
        ctx.fillStyle=layer.color||'#ffffff';ctx.shadowColor='transparent';
    }else{ctx.fillStyle=layer.color||'#ffffff';ctx.shadowColor='#000c';ctx.shadowBlur=5;ctx.shadowOffsetY=2;}
    lines.forEach((line,index)=>ctx.fillText(line,0,(index-(lines.length-1)/2)*lineHeight));ctx.restore();
}
export function paintFrame(ctx,media,story,geometry,stage){
    const edits=storyComposition(story.edits),w=media.videoWidth||media.naturalWidth,h=media.videoHeight||media.naturalHeight;
    const {width:sw,height:sh,mediaWidth:mw,mediaHeight:mh,mediaLeft:ml,mediaTop:mt}=stage;
    const angle=(edits.media.rotation+edits.media.straighten)*Math.PI/180;
    const fit=edits.media.fit==='cover'?Math.max(mw/w,mh/h):Math.min(mw/w,mh/h);
    const mediaScale=fit*edits.media.zoom;
    const cx=ml+mw/2+mw*edits.media.x/100,cy=mt+mh/2+mh*edits.media.y/100;
    const sx=geometry.width/geometry.contentWidth,sy=geometry.height/geometry.contentHeight;
    ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,geometry.width,geometry.height);
    ctx.save();ctx.translate(geometry.width/2,geometry.height/2);ctx.scale(sx,sy);ctx.rotate(angle);
    ctx.filter=compositionMediaStyle(edits).filter;ctx.drawImage(media,-w/2,-h/2,w,h);ctx.restore();
    // Draw overlays in their Story coordinates, mapped to the media-only output.
    ctx.save();ctx.translate(geometry.width/2,geometry.height/2);ctx.scale(sx/mediaScale,sy/mediaScale);ctx.translate(-cx,-cy);
    ctx.save();ctx.translate(cx,cy);ctx.rotate(angle);ctx.scale(mediaScale,mediaScale);ctx.beginPath();ctx.rect(-w/2,-h/2,w,h);ctx.restore();ctx.clip();
    for(const layer of edits.layers)paintLayer(ctx,layer,sw,sh);
    ctx.restore();
}
async function seek(media,time,signal){
    if(Math.abs(media.currentTime-time)<.01)return;
    const moved=waitForMedia(media,'seeked',signal);media.currentTime=time;await moved;
}
async function recordStory(canvas,source,story,geometry,stage,signal,onProgress,audioContext){
    if(!canvas.captureStream||typeof MediaRecorder==='undefined')throw new Error('Video export is unavailable in this browser. Try a supported browser or use the later server export.');
    const mimeType=storyExportMime(MediaRecorder);if(!mimeType)throw new Error('This browser has no supported video export format.');
    const edits=storyComposition(story.edits),stream=canvas.captureStream(30),chunks=[],audioElements=[];
    let frame,timer,recorder,visibilityHandler,recordingError;
    try{
        const range=story.type==='video'?storyVideoRange(story,source.duration):{start:0,end:Math.min(30,story.durationMs?story.durationMs/1000:30),duration:Math.min(30,story.durationMs?story.durationMs/1000:30)};
        if(story.type==='video')await seek(source,range.start,signal);
        const needsOriginal=story.type==='video'&&!edits.video.muted&&edits.video.volume>0;
        if((needsOriginal||edits.music)&&!audioContext)throw new Error('Audio export is unavailable in this browser.');
        let destination;
        const connect=(element,volume)=>{
            destination??=audioContext.createMediaStreamDestination();
            const node=audioContext.createMediaElementSource(element),gain=audioContext.createGain();gain.gain.value=volume;node.connect(gain).connect(destination);
        };
        if(needsOriginal){source.muted=false;source.volume=1;connect(source,edits.video.volume);}
        if(edits.music){
            const audio=document.createElement('audio');audio.crossOrigin='anonymous';audio.preload='auto';audioElements.push(audio);
            const loaded=waitForMedia(audio,'loadeddata',signal);audio.src=edits.music.src;await loaded;
            await seek(audio,Math.min(edits.music.start||0,Math.max(0,audio.duration-.05)),signal);connect(audio,edits.music.volume??1);
            audio.addEventListener('timeupdate',()=>{if(edits.music.end!=null&&audio.currentTime>=edits.music.end)audio.pause();});
        }
        if(destination)destination.stream.getAudioTracks().forEach(track=>stream.addTrack(track));
        check(signal);paintFrame(canvas.getContext('2d'),source,story,geometry,stage);
        recorder=new MediaRecorder(stream,{mimeType,videoBitsPerSecond:Math.max(4000000,Math.min(100000000,Math.round(geometry.width*geometry.height*30*.16))),audioBitsPerSecond:192000});
        let resolveStop,rejectStop;
        const stopped=new Promise((resolve,reject)=>{resolveStop=resolve;rejectStop=reject;});
        // Attach an immediate rejection handler while source playback is awaited.
        stopped.catch(()=>{});
        recorder.ondataavailable=event=>{if(event.data.size)chunks.push(event.data);};
        recorder.onstop=()=>resolveStop();recorder.onerror=()=>{recordingError=new Error('This browser could not encode the source resolution. No lower-resolution copy was substituted.');rejectStop(recordingError);};
        recorder.start(1000);
        const started=performance.now();
        let resolveFrames,rejectFrames;
        const frames=new Promise((resolve,reject)=>{resolveFrames=resolve;rejectFrames=reject;});frames.catch(()=>{});
        const abort=()=>rejectFrames(new DOMException('Export cancelled.','AbortError'));
        signal.addEventListener('abort',abort,{once:true});
        visibilityHandler=()=>{if(document.hidden)rejectFrames(new Error('Keep this page visible while video is exporting.'));};document.addEventListener('visibilitychange',visibilityHandler);
        timer=setTimeout(()=>rejectFrames(new Error('Video export stalled. Try a shorter or compatible source.')),(range.duration+30)*1000);
        const tick=()=>{
            if(recordingError){rejectFrames(recordingError);return;}
            if(signal.aborted){abort();return;}
            const elapsed=story.type==='video'?source.currentTime-range.start:(performance.now()-started)/1000;
            paintFrame(canvas.getContext('2d'),source,story,geometry,stage);onProgress(clamp(elapsed/range.duration,0,1));
            if(elapsed>=range.duration-.03||(story.type==='video'&&source.ended)){resolveFrames();return;}
            frame=requestAnimationFrame(tick);
        };
        try{
            if(story.type==='video')await source.play();
            await Promise.all(audioElements.map(audio=>audio.play()));
            frame=requestAnimationFrame(tick);await frames;
        }finally{signal.removeEventListener('abort',abort);}
        recorder.stop();await stopped;check(signal);
        const blob=new Blob(chunks,{type:recorder.mimeType||mimeType});if(!blob.size)throw new Error('Video export produced an empty file.');
        return blob;
    }finally{
        cancelAnimationFrame(frame);clearTimeout(timer);if(visibilityHandler)document.removeEventListener('visibilitychange',visibilityHandler);
        source.pause?.();audioElements.forEach(audio=>{audio.pause();audio.removeAttribute('src');});
        if(recorder&&recorder.state!=='inactive')recorder.stop();stream.getTracks().forEach(track=>track.stop());
    }
}
export async function buildStoryExport(story,stage,signal,onProgress=()=>{},audioContext=null){
    const source=await loadSource(story,signal);
    try{
        check(signal);await document.fonts?.ready;check(signal);
        const edits=storyComposition(story.edits),video=story.type==='video'||Boolean(edits.music);
        const geometry=storyExportGeometry(source.videoWidth||source.naturalWidth,source.videoHeight||source.naturalHeight,edits.media.rotation+edits.media.straighten,video);
        const canvas=document.createElement('canvas');canvas.width=geometry.width;canvas.height=geometry.height;
        const context=canvas.getContext('2d');if(!context)throw new Error('Image export is unavailable.');
        // Do not silently export an unfiltered source on a browser lacking Canvas filters.
        if(!('filter' in context)&&compositionMediaStyle(edits).filter!==compositionMediaStyle({}).filter)throw new Error('This browser cannot export these filters. Use a browser with Canvas filter support.');
        let blob;
        if(video)blob=await recordStory(canvas,source,story,geometry,stage,signal,onProgress,audioContext);
        else{
            paintFrame(context,source,story,geometry,stage);
            blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('Image export failed. Try a smaller image.')),'image/png'));
        }
        check(signal);return {blob,width:geometry.width,height:geometry.height};
    }finally{source.pause?.();source.removeAttribute('src');}
}
function closeExport(){
    operation?.abort();operation=null;readyFile=null;
    if(readyURL)URL.revokeObjectURL(readyURL);readyURL=null;
    document.querySelector('.story-export-backdrop').hidden=true;
    document.querySelector('.story-create-dialog').inert=false;
    if(!state.deletionRequestedAt)document.querySelector('.story-tools-open').focus();
}
async function openExport(){
    if(!mayInteract()||!state.pendingStoryMedia)return;
    const stage=document.querySelector('.story-selected-preview'),media=stage.querySelector('img, video');if(!media)return;
    const box=stage.getBoundingClientRect();
    const mapping={width:box.width,height:box.height,mediaWidth:media.clientWidth,mediaHeight:media.clientHeight,mediaLeft:media.offsetLeft,mediaTop:media.offsetTop};
    const story={...state.pendingStoryMedia,edits:storyComposition(state.pendingStoryMedia.edits)};
    operation?.abort();const controller=new AbortController();operation=controller;
    document.querySelector('.story-tools-backdrop').hidden=true;document.querySelector('.story-create-dialog').inert=true;
    document.querySelector('.story-export-backdrop').hidden=false;
    const message=document.querySelector('.story-export-message');message.textContent='Preparing edited media…';
    document.querySelector('.story-export-download').hidden=true;document.querySelector('.story-export-share').hidden=true;
    document.querySelector('.story-export-close').focus();
    stage.querySelectorAll('video,audio').forEach(element=>element.pause());
    let audioContext;
    if(story.type==='video'||story.edits.music){
        const Audio=window.AudioContext||window.webkitAudioContext;
        if(Audio){audioContext=new Audio();audioContext.resume().catch(()=>{});}
    }
    try{
        const result=await buildStoryExport(story,mapping,controller.signal,value=>{message.textContent=`Exporting edited video… ${Math.round(value*100)}%. Keep this page open.`;},audioContext);
        if(operation!==controller)return;
        const extension=result.blob.type.includes('mp4')?'mp4':result.blob.type.startsWith('video/')?'webm':'png';
        readyFile=new File([result.blob],`insta-story-${Date.now()}.${extension}`,{type:result.blob.type});readyURL=URL.createObjectURL(readyFile);
        message.textContent=`Ready · ${result.width} × ${result.height}. Edited media only. Use Download or your phone’s share options to save it.`;
        document.querySelector('.story-export-download').hidden=false;
        document.querySelector('.story-export-share').hidden=!navigator.canShare?.({files:[readyFile]});
    }catch(error){if(operation===controller&&error.name!=='AbortError')message.textContent=error.message||'Export failed. The original media and edits are unchanged.';}
    finally{if(audioContext)await audioContext.close().catch(()=>{});}
}
export function registerStoryExportEvents(){
    document.addEventListener('click',event=>{
        if(event.target.closest('.story-export-open')){openExport();return;}
        if(event.target.closest('.story-export-close')||event.target===document.querySelector('.story-export-backdrop')){closeExport();return;}
        if(event.target.closest('.story-export-download')&&readyFile&&readyURL){
            const anchor=document.createElement('a');anchor.href=readyURL;anchor.download=readyFile.name;anchor.click();showShareFeedback('Download requested. Check your browser’s downloads.');
        }
        if(event.target.closest('.story-export-share')&&readyFile){navigator.share({files:[readyFile],title:'Edited Story'}).catch(error=>{if(error.name!=='AbortError')showShareFeedback('Sharing failed. Use Download instead.');});}
    });
    document.addEventListener('keydown',event=>{
        const popup=document.querySelector('.story-export-backdrop');if(popup.hidden)return;
        if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeExport();}
        if(event.key==='Tab'){
            const controls=[...popup.querySelectorAll('button')].filter(button=>!button.hidden&&!button.disabled),first=controls[0],last=controls.at(-1);
            if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
            else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
        }
    },true);
    document.addEventListener('account-deletion-lock',closeExport);
}
