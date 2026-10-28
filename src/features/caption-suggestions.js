import { state } from '../core/state.js';
import { currentUser, posts } from '../data/sample-data.js';
import { normalizeSearchText, escapeHtml } from '../core/utils.js';
import { canViewMedia, canViewStory } from '../core/social.js';
import { extractHashtags, storyHashtags, isPublicHashtagItem, hashtagKey } from '../core/hashtags.js';

export function getCaptionSuggestionContext(text, caret=String(text||'').length) {
    text=String(text||'');caret=Math.max(0,Math.min(text.length,caret));
    const match=text.slice(0,caret).match(/([@#])([\p{L}\p{N}_.]*)$/u);
    if(!match)return null;
    const start=caret-match[0].length,before=text[start-1]||'';
    if(/[\p{L}\p{N}_@#]/u.test(before)||(match[1]==='#'&&match[2].includes('.')))return null;
    const pattern=match[1]==='@'?/[A-Za-z0-9_.]/:/[\p{L}\p{N}_]/u;
    let end=caret;while(end<text.length&&pattern.test(text[end]))end++;
    if(match[1]==='@')while(end>caret&&text[end-1]==='.')end--;
    return {start,end,kind:match[1],query:match[2]};
}
export function getCaptionSuggestionItems(context,now=Date.now()) {
    if(!context)return [];
    const query=normalizeSearchText(context.query);
    if(context.kind==='@')return state.accountDirectory.filter(account=>account.handle!==currentUser.handle&&!state.blockedHandles.has(account.handle)&&(!query||[account.handle.replace(/^@/,''),account.name||''].some(value=>normalizeSearchText(value).includes(query)))).sort((a,b)=>Number(state.followedAccountHandles.has(b.handle))-Number(state.followedAccountHandles.has(a.handle))||(a.name||a.handle).localeCompare(b.name||b.handle)).slice(0,8).map(account=>({value:account.handle,label:account.name||account.handle,description:account.handle+(state.followedAccountHandles.has(account.handle)?' · Following':'')}));
    const tags=new Map();
    const add=values=>{for(const value of values){const key=hashtagKey(value),entry=tags.get(key)||{name:value,count:0};entry.count++;tags.set(key,entry);}};
    posts.filter(post=>isPublicHashtagItem(post)&&canViewMedia(post)).forEach(post=>add(extractHashtags(post.caption)));
    state.stories.filter(story=>!story.fromHighlight&&isPublicHashtagItem(story)&&canViewStory(story)&&(!story.createdAt||story.createdAt<=now)&&((story.expiresAt||((story.createdAt||0)+state.storyLifetimeMs))>now)).forEach(story=>add(storyHashtags(story)));
    const matches=[...tags.values()].filter(tag=>hashtagKey(tag.name).includes(query)).sort((a,b)=>Number(hashtagKey(b.name).startsWith(query))-Number(hashtagKey(a.name).startsWith(query))||b.count-a.count||a.name.localeCompare(b.name)).slice(0,8).map(tag=>({value:'#'+tag.name,label:'#'+tag.name,description:`${tag.count} public ${tag.count===1?'item':'items'}`}));
    if(context.query&&/^[\p{L}\p{N}_]+$/u.test(context.query)&&!tags.has(hashtagKey(context.query)))matches.unshift({value:'#'+context.query,label:'#'+context.query,description:'Use this hashtag'});
    return matches.slice(0,8);
}
export function completeCaptionSuggestion(text,context,value) {
    if(!context)return {text,caret:String(text).length};
    const tail=text.slice(context.end),separator=!tail?' ':'';
    return {text:text.slice(0,context.start)+value+separator+tail,caret:context.start+value.length+separator.length};
}
let active=0,current=null,items=[];
export function hideCaptionSuggestions(){
    current=null;items=[];active=0;
    const field=document.getElementById('create-caption');field.setAttribute('aria-expanded','false');field.removeAttribute('aria-activedescendant');
    document.querySelector('.create-caption-suggestions').hidden=true;
}
export function renderCaptionSuggestions(){
    const field=document.getElementById('create-caption');
    current=getCaptionSuggestionContext(field.value,field.selectionStart??field.value.length);items=getCaptionSuggestionItems(current);active=0;
    paint();
}
function paint(){
    const field=document.getElementById('create-caption'),panel=document.querySelector('.create-caption-suggestions');
    panel.hidden=!items.length;field.setAttribute('aria-expanded',String(Boolean(items.length)));
    if(!items.length){field.removeAttribute('aria-activedescendant');return;}
    field.setAttribute('aria-activedescendant',`caption-suggestion-${active}`);
    panel.innerHTML=items.map((item,index)=>`<button type="button" role="option" id="caption-suggestion-${index}" data-caption-suggestion="${index}" aria-selected="${index===active}"><strong>${escapeHtml(item.label)}</strong><span>${escapeHtml(item.description)}</span></button>`).join('');
}
export function registerCaptionSuggestions(changed){
    const field=document.getElementById('create-caption'),panel=document.querySelector('.create-caption-suggestions');
    const choose=index=>{
        if(!items[index]||!current)return;
        const completion=completeCaptionSuggestion(field.value,current,items[index].value);
        if(completion.text.length>field.maxLength)return;
        field.value=completion.text;field.focus();field.setSelectionRange?.(completion.caret,completion.caret);hideCaptionSuggestions();changed();
    };
    field.addEventListener('input',renderCaptionSuggestions);
    field.addEventListener('click',renderCaptionSuggestions);
    field.addEventListener('keyup',event=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(event.key))renderCaptionSuggestions();});
    field.addEventListener('keydown',event=>{
        if(!items.length)return;
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();active=(active+(event.key==='ArrowDown'?1:-1)+items.length)%items.length;paint();}
        else if(event.key==='Enter'||event.key==='Tab'){event.preventDefault();event.stopPropagation();choose(active);}
        else if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();hideCaptionSuggestions();}
    },true);
    panel.addEventListener('mousedown',event=>event.preventDefault());
    panel.addEventListener('click',event=>{const button=event.target.closest('[data-caption-suggestion]');if(button)choose(Number(button.dataset.captionSuggestion));});
    document.addEventListener('click',event=>{if(event.target!==field&&!event.target.closest('.create-caption-suggestions'))hideCaptionSuggestions();});
}
