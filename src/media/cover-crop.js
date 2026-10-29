import { squareCropBounds } from './cover-canvas.js';
const bound=(value,min,max)=>Math.max(min,Math.min(max,value));
export function cropAroundCenter(width,height,cx,cy,zoom){
    zoom=bound(zoom,1,3);const size=Math.min(width,height)/zoom,freeX=width-size,freeY=height-size;
    return {zoom,x:freeX>0?bound(cx-size/2,0,freeX)/freeX*100:50,y:freeY>0?bound(cy-size/2,0,freeY)/freeY*100:50};
}
export function bindCoverCrop(stage,geometry,getCrop,changed){
    const box=stage.querySelector('.reel-cover-selection'),points=new Map();let base=null;
    const paint=()=>{
        const {width,height}=geometry(),crop=squareCropBounds(width,height,getCrop());
        Object.assign(box.style,{left:`${crop.x/width*100}%`,top:`${crop.y/height*100}%`,width:`${crop.size/width*100}%`,height:`${crop.size/height*100}%`});
    };
    const metrics=()=>{const values=[...points.values()];return {x:values.reduce((sum,p)=>sum+p.x,0)/values.length,y:values.reduce((sum,p)=>sum+p.y,0)/values.length,distance:values.length===2?Math.hypot(values[1].x-values[0].x,values[1].y-values[0].y):0};};
    const rebase=()=>{if(!points.size){base=null;return;}const {width,height}=geometry(),crop=squareCropBounds(width,height,getCrop());base={...metrics(),width,height,cx:crop.x+crop.size/2,cy:crop.y+crop.size/2,zoom:getCrop().zoom,rect:stage.getBoundingClientRect()};};
    const update=()=>{
        if(!base)return;const now=metrics(),zoom=points.size===2&&base.distance>0?base.zoom*now.distance/base.distance:base.zoom;
        changed(cropAroundCenter(base.width,base.height,base.cx+(now.x-base.x)*base.width/base.rect.width,base.cy+(now.y-base.y)*base.height/base.rect.height,zoom));paint();
    };
    stage.addEventListener('pointerdown',event=>{
        if(event.button>0||points.size>=2||event.target.closest('button'))return;
        event.preventDefault();points.set(event.pointerId,{x:event.clientX,y:event.clientY});stage.setPointerCapture(event.pointerId);rebase();
    });
    stage.addEventListener('pointermove',event=>{if(!points.has(event.pointerId))return;event.preventDefault();points.set(event.pointerId,{x:event.clientX,y:event.clientY});update();});
    const release=event=>{if(!points.has(event.pointerId))return;points.delete(event.pointerId);if(stage.hasPointerCapture?.(event.pointerId))stage.releasePointerCapture(event.pointerId);rebase();};
    for(const name of ['pointerup','pointercancel','lostpointercapture'])stage.addEventListener(name,release);
    const cancel=()=>{for(const id of points.keys())if(stage.hasPointerCapture?.(id))stage.releasePointerCapture(id);points.clear();base=null;};
    const zoomBy=factor=>{const {width,height}=geometry(),crop=squareCropBounds(width,height,getCrop());changed(cropAroundCenter(width,height,crop.x+crop.size/2,crop.y+crop.size/2,getCrop().zoom*factor));paint();rebase();};
    stage.querySelector('[data-cover-zoom="in"]').addEventListener('click',()=>zoomBy(1.2));
    stage.querySelector('[data-cover-zoom="out"]').addEventListener('click',()=>zoomBy(1/1.2));
    stage.addEventListener('keydown',event=>{
        if(event.target.closest('button'))return;
        if(['+','=','-','_'].includes(event.key)){event.preventDefault();zoomBy(['-','_'].includes(event.key)?1/1.2:1.2);return;}
        const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!delta)return;
        event.preventDefault();const {width,height}=geometry(),crop=squareCropBounds(width,height,getCrop()),step=(event.shiftKey?5:1)/100;
        changed(cropAroundCenter(width,height,crop.x+crop.size/2+delta[0]*width*step,crop.y+crop.size/2+delta[1]*height*step,getCrop().zoom));paint();
    });
    const visibility=()=>{if(document.hidden)cancel();};
    window.addEventListener('blur',cancel);document.addEventListener('visibilitychange',visibility);
    paint();return {paint,cancel,dispose(){cancel();window.removeEventListener?.('blur',cancel);document.removeEventListener?.('visibilitychange',visibility);}};
}
