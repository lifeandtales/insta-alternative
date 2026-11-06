import { showShareFeedback } from '../components/feedback.js';

// Reel editing uses a single tap target; feed, post and thumbnail players keep
// their existing controls and gesture behavior.
export function bindReelEditorPlayback(stage,canPlay=()=>true){
    const video=stage?.querySelector('video'),button=stage?.querySelector('.reel-editor-play-toggle');
    if(!video||!button)return;
    video.controls=false;
    let start=null,skipClick=false,requesting=false,timer;
    const paint=()=>{
        const paused=video.paused||video.ended;
        button.setAttribute('aria-label',paused?'Play reel preview':'Pause reel preview');
        button.textContent=paused?'▶':'Ⅱ';stage.classList.toggle('reel-preview-paused',Boolean(paused));
        stage.classList.add('reel-preview-show-state');window.clearTimeout(timer);
        if(!paused)timer=window.setTimeout(()=>stage.classList.remove('reel-preview-show-state'),650);
    };
    stage.addEventListener('pointerdown',event=>{
        if(event.isPrimary===false){skipClick=true;return;}
        if(event.button>0)return;
        start={id:event.pointerId,x:event.clientX,y:event.clientY};skipClick=false;
    });
    stage.addEventListener('pointermove',event=>{
        if(start&&start.id===event.pointerId&&Math.hypot(event.clientX-start.x,event.clientY-start.y)>10)skipClick=true;
    });
    stage.addEventListener('pointerup',()=>{start=null;});
    stage.addEventListener('pointercancel',()=>{start=null;skipClick=true;});
    stage.addEventListener('keydown',event=>{if(event.target===button&&(event.key==='Enter'||event.key===' '))skipClick=false;});
    stage.addEventListener('click',async event=>{
        if(event.target.closest('.post-media-text, input, select, textarea, a'))return;
        if(event.target.closest('button')&&event.target.closest('button')!==button)return;
        event.preventDefault();event.stopPropagation();
        if(skipClick){skipClick=false;return;}
        if(!canPlay()||requesting)return;
        if(!video.paused&&!video.ended){video.pause();return;}
        requesting=true;
        try{if(video.ended)video.currentTime=0;await video.play();}
        catch{showShareFeedback('This video could not play. Try another supported file.');paint();}
        finally{requesting=false;}
    });
    ['play','pause','ended','loadedmetadata'].forEach(name=>video.addEventListener(name,paint));
    paint();
}
