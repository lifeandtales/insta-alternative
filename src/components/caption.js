import { escapeHtml, normalizeHandle } from '../core/utils.js';
import { state } from '../core/state.js';

export function captionMentions(value) {
    const caption=String(value||''),matches=[];
    const accounts=new Set(state.accountDirectory.map(account=>normalizeHandle(account.handle)));
    const pattern=/@[A-Za-z0-9_](?:[A-Za-z0-9_.]{0,28}[A-Za-z0-9_])?/g;
    for(const match of caption.matchAll(pattern)) {
        const before=caption[match.index-1]||'',after=caption[match.index+match[0].length]||'';
        if(/[\p{L}\p{N}_@.]/u.test(before)||/[A-Za-z0-9_]/.test(after)||(after==='.'&&/[A-Za-z0-9_]/.test(caption[match.index+match[0].length+1]||'')))continue;
        const handle=normalizeHandle(match[0]);
        if(accounts.has(handle)&&!state.blockedHandles.has(handle))matches.push({start:match.index,end:match.index+match[0].length,label:match[0],handle});
    }
    return matches;
}
export function renderCaption(value,{interactive=true}={}) {
    const caption=String(value||'');let end=0,html='';
    const tokens=captionMentions(caption).map(mention=>({...mention,kind:'mention'}));
    for(const match of caption.matchAll(/#[\p{L}\p{N}_]+/gu)) {
        if(/[\p{L}\p{N}_]/u.test(caption[match.index-1]||''))continue;
        tokens.push({start:match.index,end:match.index+match[0].length,label:match[0],kind:'hashtag'});
    }
    for(const token of tokens.sort((a,b)=>a.start-b.start)) {
        if(token.start<end)continue;
        html+=escapeHtml(caption.slice(end,token.start));
        const name=token.kind==='mention'?'caption-mention':'caption-hashtag';
        const attributes=token.kind==='mention'?`data-profile-handle="${escapeHtml(token.handle)}" aria-label="Visit profile ${escapeHtml(token.label)}"`:`data-search-kind="hashtag" data-search-value="${escapeHtml(token.label.slice(1))}" aria-label="View hashtag ${escapeHtml(token.label)}"`;
        html+=interactive?`<button type="button" class="${name}" ${attributes}>${escapeHtml(token.label)}</button>`:`<span class="${name}">${escapeHtml(token.label)}</span>`;
        end=token.end;
    }
    return html+escapeHtml(caption.slice(end));
}
