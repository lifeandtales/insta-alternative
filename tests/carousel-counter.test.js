import test from 'node:test';
import assert from 'node:assert/strict';
import {loadApp} from './helpers/app-harness.js';

test('single-media posts have no visible count; multiple media share one counter',async()=>{
    const app=await loadApp(),{renderMedia}=app.exportsOf('src/components/post-card.js');
    const post={id:1,user:'Test',mediaItems:[{type:'image',url:'one.jpg'}]};
    assert.doesNotMatch(renderMedia(post),/carousel-index|1\/1|Swipe left/);
    post.mediaItems.push({type:'video',url:'two.mp4'});const html=renderMedia(post);
    assert.equal((html.match(/class="carousel-index"/g)||[]).length,1);assert.match(html,/>1\/2<\/span>/);
});

test('carousel counter updates with scrolling, fades after two seconds, and resets its timer',async()=>{
    const app=await loadApp(),{initializePostCarousels}=app.exportsOf('src/media/carousel.js');
    const handlers={},classes=new Set(),timers=new Map();let serial=0;
    const badge={textContent:'',classList:{add:value=>classes.add(value),remove:value=>classes.delete(value)},setAttribute(){}};
    const slides={clientWidth:300,scrollLeft:0,querySelectorAll:()=>[1,2,3],addEventListener:(name,handler)=>handlers[name]=handler};
    const carousel={dataset:{},querySelector:selector=>selector==='.carousel-slides'?slides:badge};
    initializePostCarousels({querySelectorAll:()=>[carousel]},{setTimer:(callback,delay)=>{assert.equal(delay,2000);timers.set(++serial,callback);return serial;},clearTimer:id=>timers.delete(id)});
    assert.equal(badge.textContent,'1/3');assert.equal(timers.size,1);
    [...timers.values()][0]();assert.equal(classes.has('counter-hidden'),true);
    slides.scrollLeft=300;handlers.scroll();assert.equal(badge.textContent,'2/3');assert.equal(classes.has('counter-hidden'),false);assert.equal(timers.size,1);
    slides.scrollLeft=600;handlers.scroll();assert.equal(badge.textContent,'3/3');assert.equal(timers.size,1);
    [...timers.values()][0]();assert.equal(classes.has('counter-hidden'),true);
    handlers.pointerdown();assert.equal(classes.has('counter-hidden'),false);
});
