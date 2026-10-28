// One fixed counter per carousel; its timer restarts when the visible slide changes.
export function initializePostCarousels(container, {setTimer=(callback,delay)=>window.setTimeout(callback,delay),clearTimer=timer=>clearTimeout(timer)}={}) {
    container.querySelectorAll('.post-carousel').forEach(carousel=>{
        const slides=carousel.querySelector('.carousel-slides'),badge=carousel.querySelector('.carousel-index');
        if(!slides||!badge||carousel.dataset.carouselBound)return;
        const total=slides.querySelectorAll('.carousel-slide').length;
        if(total<2){badge.remove();return;}
        carousel.dataset.carouselBound='true';let timer=null,current=0;
        const flash=()=>{
            clearTimer(timer);badge.classList.remove('counter-hidden');
            timer=setTimer(()=>badge.classList.add('counter-hidden'),2000);
        };
        const update=(force=false)=>{
            const width=slides.clientWidth||slides.getBoundingClientRect().width;
            const next=width>0?Math.min(total-1,Math.max(0,Math.round(Math.abs(slides.scrollLeft)/width))):0;
            if(next===current&&!force)return;
            current=next;badge.textContent=`${current+1}/${total}`;
            badge.setAttribute('aria-label',`Item ${current+1} of ${total}`);flash();
        };
        slides.addEventListener('scroll',()=>update(),{passive:true});
        slides.addEventListener('scrollend',()=>update(true),{passive:true});
        slides.addEventListener('pointerdown',flash,{passive:true});
        slides.addEventListener('keydown',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))flash();});
        update(true);
    });
}
