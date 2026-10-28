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
    for(const mention of captionMentions(caption)) {
        html+=escapeHtml(caption.slice(end,mention.start));
        html+=interactive?`<button type="button" class="caption-mention" data-profile-handle="${escapeHtml(mention.handle)}" aria-label="Visit profile ${escapeHtml(mention.label)}">${escapeHtml(mention.label)}</button>`:`<span class="caption-mention">${escapeHtml(mention.label)}</span>`;
        end=mention.end;
    }
    return html+escapeHtml(caption.slice(end));
}
