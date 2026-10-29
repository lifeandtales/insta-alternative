import { mediaEdits, mediaAspect, mediaFit, mediaFilter } from '../features/post-media.js';

export const REEL_COVER_SIZE=720;
const clamp=(value,min,max)=>Math.max(min,Math.min(max,Number(value)));
export function squareCropBounds(width,height,{x=50,y=50,zoom=1}={}) {
    const size=Math.min(width,height)/clamp(zoom,1,3);
    return {x:(width-size)*clamp(x,0,100)/100,y:(height-size)*clamp(y,0,100)/100,size};
}
// Render the edited composition before selecting its square cover crop.
export function renderSquareCover(media,item=null,{size=REEL_COVER_SIZE,x=50,y=50,zoom=1}={}) {
    const width=media.videoWidth||media.naturalWidth,height=media.videoHeight||media.naturalHeight;
    if(!width||!height)throw new Error('The media has no readable dimensions.');
    let source=media,sourceWidth=width,sourceHeight=height;
    if(item){
        const edit=mediaEdits(item),ratio=mediaAspect({...item,naturalRatio:width/height});
        const stage=document.createElement('canvas');stage.width=Math.round(size*Math.min(1,ratio));stage.height=Math.round(stage.width/ratio);
        const context=stage.getContext('2d');if(!context)throw new Error('Cover rendering is unavailable.');
        context.fillStyle='#17131d';context.fillRect(0,0,stage.width,stage.height);
        const scale=(mediaFit({...item,naturalRatio:width/height})==='cover'?Math.max:Math.min)(stage.width/width,stage.height/height);
        const drawWidth=width*scale,drawHeight=height*scale;
        context.save();context.translate(stage.width/2,stage.height/2);context.rotate(edit.rotation*Math.PI/180);context.filter=mediaFilter(item);
        context.drawImage(media,(stage.width-drawWidth)*(item.x??50)/100-stage.width/2,(stage.height-drawHeight)*(item.y??50)/100-stage.height/2,drawWidth,drawHeight);context.restore();
        if(edit.text){
            const fontSize=stage.width*edit.textSize/100;context.font=`700 ${fontSize}px sans-serif`;context.fillStyle='#fff';context.textAlign='center';context.textBaseline='middle';context.shadowColor='#000';context.shadowBlur=4;
            const lines=[];for(const paragraph of edit.text.split('\n')){let line='';for(const word of paragraph.split(' ')){const next=line?line+' '+word:word;if(line&&context.measureText(next).width>stage.width*.9){lines.push(line);line=word;}else line=next;}lines.push(line);}
            lines.forEach((line,index)=>context.fillText(line,stage.width*edit.textX/100,stage.height*edit.textY/100+(index-(lines.length-1)/2)*fontSize*1.2,stage.width*.9));
        }
        source=stage;sourceWidth=stage.width;sourceHeight=stage.height;
    }
    const crop=squareCropBounds(sourceWidth,sourceHeight,{x,y,zoom}),canvas=document.createElement('canvas');canvas.width=size;canvas.height=size;
    const context=canvas.getContext('2d');if(!context)throw new Error('Cover rendering is unavailable.');
    context.drawImage(source,crop.x,crop.y,crop.size,crop.size,0,0,size,size);
    return canvas.toDataURL('image/jpeg',.85);
}
