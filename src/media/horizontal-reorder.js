const boundPanels=new WeakSet();
export function horizontalDropIndex(pointerX,rectangles) {
    return rectangles.filter(rect=>pointerX>rect.left+rect.width/2).length;
}
export function edgeScrollSpeed(pointerX,left,right,margin=36) {
    if(pointerX<left+margin)return -Math.min(14,Math.max(0,(left+margin-pointerX)/margin*14));
    if(pointerX>right-margin)return Math.min(14,Math.max(0,(pointerX-right+margin)/margin*14));
    return 0;
}
export function bindHorizontalReorder(panel,onReorder,{requestFrame=callback=>window.requestAnimationFrame(callback),cancelFrame=id=>window.cancelAnimationFrame(id),setTimer=(callback,delay)=>window.setTimeout(callback,delay),clearTimer=id=>window.clearTimeout(id)}={}) {
    if(!panel||boundPanels.has(panel))return;
    boundPanels.add(panel);
    let drag=null,frame=null,hold=null,held=null,suppressClickUntil=0;
    const dismissHeld=()=>{held?.classList.remove('is-held');held=null;};
    const restore=state=>{if(state.strip.isConnected)state.original.forEach(tile=>state.strip.append(tile));};
    const stop=(commit=false)=>{
        const state=drag;if(!state)return;drag=null;
        if(hold!=null)clearTimer(hold);hold=null;
        if(frame!=null)cancelFrame(frame);frame=null;
        if(panel.hasPointerCapture?.(state.id))panel.releasePointerCapture(state.id);
        state.ghost?.remove();state.tile.classList.remove('is-dragging');
        if(!state.started){if(state.scrolling)suppressClickUntil=Date.now()+700;return;}
        suppressClickUntil=Date.now()+700;
        const scroll=state.strip.scrollLeft;
        if(!commit)restore(state);
        else {
            const moved=state.from===state.to||onReorder(state.from,state.to)!==false;
            if(!moved)restore(state);
            const strip=(panel.matches?.('.create-order-strip')?panel:panel.querySelector('.create-order-strip'));
            if(strip)strip.scrollLeft=scroll;
            const index=moved?state.to:state.from;
            const next=panel.querySelector(`[data-order-index="${index}"]`);
            next?.focus({preventScroll:true});
            dismissHeld();held=next?.closest('.create-order-tile');held?.classList.add('is-held');
        }
    };
    const place=()=>{
        if(!drag?.started)return;
        const others=[...drag.strip.querySelectorAll('.create-order-tile')].filter(tile=>tile!==drag.tile);
        drag.to=horizontalDropIndex(drag.x,others.map(tile=>tile.getBoundingClientRect()));
        const reference=others[drag.to]||null;
        if(drag.tile.nextElementSibling!==reference)drag.strip.insertBefore(drag.tile,reference);
        drag.ghost.style.transform=`translate3d(${drag.x-drag.grabX}px,${drag.top}px,0) scale(1.06)`;
    };
    const tick=()=>{
        if(!drag?.started)return;
        if(panel.hidden||panel.isConnected===false){stop(false);return;}
        const rect=drag.strip.getBoundingClientRect();
        drag.strip.scrollLeft+=edgeScrollSpeed(drag.x,rect.left,rect.right);
        place();frame=requestFrame(tick);
    };
    const beginHold=()=>{
        hold=null;if(!drag||drag.scrolling)return;
        if(panel.hidden||panel.isConnected===false){stop(false);return;}
        dismissHeld();held=drag.tile;held.classList.add('is-held');
        drag.started=true;panel.setPointerCapture(drag.id);
        const rect=drag.tile.getBoundingClientRect();drag.ghost=drag.tile.cloneNode(true);
        drag.ghost.classList.add('create-order-ghost');drag.ghost.setAttribute('aria-hidden','true');
        drag.ghost.querySelectorAll('button').forEach(button=>button.tabIndex=-1);
        Object.assign(drag.ghost.style,{width:`${rect.width}px`,height:`${rect.height}px`});
        document.body.append(drag.ghost);drag.tile.classList.add('is-dragging');
        place();frame=requestFrame(tick);
    };
    panel.addEventListener('contextmenu',event=>{if(drag)event.preventDefault();});
    panel.addEventListener('pointerdown',event=>{
        if(drag){stop(false);return;}
        if(event.button>0||event.target.closest('[data-create-remove]'))return;
        dismissHeld();
        const button=event.target.closest('[data-order-index]'),strip=button?.closest('.create-order-strip');
        if(!button||!strip)return;
        const tile=button.closest('.create-order-tile'),rect=tile.getBoundingClientRect();
        drag={id:event.pointerId,pointerType:event.pointerType,from:Number(button.dataset.orderIndex),to:Number(button.dataset.orderIndex),x:event.clientX,startX:event.clientX,startY:event.clientY,scrollStart:strip.scrollLeft,grabX:event.clientX-rect.left,top:rect.top,tile,strip,original:[...strip.querySelectorAll('.create-order-tile')],started:false,scrolling:false};
        hold=setTimer(beginHold,800);
    });
    panel.addEventListener('pointermove',event=>{
        if(!drag||drag.id!==event.pointerId)return;
        const dx=event.clientX-drag.startX,dy=event.clientY-drag.startY;
        if(!drag.started){
            if(Math.abs(dy)>8&&Math.abs(dy)>Math.abs(dx)){stop(false);return;}
            if(!drag.scrolling&&Math.abs(dx)<8)return;
            if(hold!=null)clearTimer(hold);hold=null;
            drag.scrolling=true;
            // Let the browser own touch swipes, including momentum and cancellation.
            // Only a completed hold may take over a touch gesture for reordering.
            if(drag.pointerType==='touch'){stop(false);return;}
            panel.setPointerCapture(event.pointerId);
            drag.strip.scrollLeft=drag.scrollStart-dx;
            event.preventDefault();return;
        }
        event.preventDefault();drag.x=event.clientX;place();
    },{passive:false});
    panel.addEventListener('touchmove',event=>{
        if(drag?.started&&drag.pointerType==='touch'&&event.cancelable)event.preventDefault();
    },{passive:false});
    panel.addEventListener('pointerup',event=>{if(drag?.id===event.pointerId)stop(true);});
    panel.addEventListener('pointercancel',()=>stop(false));
    panel.addEventListener('lostpointercapture',()=>stop(false));
    panel.addEventListener('click',event=>{
        if(!event.target?.closest('[data-create-remove]')&&event.detail!==0&&Date.now()<suppressClickUntil){suppressClickUntil=0;event.preventDefault();event.stopImmediatePropagation();}
    },true);
    panel.addEventListener('keydown',event=>{
        if((drag||held)&&event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();stop(false);dismissHeld();return;}
        const button=event.target.closest('[data-order-index]');
        if(!button||!event.altKey||!['ArrowLeft','ArrowRight'].includes(event.key))return;
        event.preventDefault();event.stopPropagation();
        const from=Number(button.dataset.orderIndex),to=from+(event.key==='ArrowLeft'?-1:1),count=panel.querySelectorAll('[data-order-index]').length;
        if(to<0||to>=count)return;
        const scroll=button.closest('.create-order-strip').scrollLeft;
        if(onReorder(from,to)!==false){const next=panel.querySelector(`[data-order-index="${to}"]`);next?.focus({preventScroll:true});const strip=(panel.matches?.('.create-order-strip')?panel:panel.querySelector('.create-order-strip'));if(strip)strip.scrollLeft=scroll;next?.scrollIntoView({block:'nearest',inline:'nearest'});}
    });
    document.addEventListener('pointerdown',event=>{
        if(held&&!event.target.closest('.create-order-tile.is-held'))dismissHeld();
    });
    window.addEventListener('blur',()=>{stop(false);dismissHeld();});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){stop(false);dismissHeld();}});
}
