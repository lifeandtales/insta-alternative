import { state } from '../core/state.js';
import { mayInteract } from '../core/social.js';
import { escapeHtml } from '../core/utils.js';
import { unexpiredDrafts, persistSession } from '../storage/local-session.js';
import { showShareFeedback } from '../components/feedback.js';
let selecting=false, saving=false;
const selected=new Set();
export function renderStoryDrafts(reset=false){
    if(reset){selecting=false;selected.clear();}
    const drafts=unexpiredDrafts(state.draftItems).filter(item=>item.type==='story');
    for(const id of selected)if(!drafts.some(item=>item.id===id))selected.delete(id);
    const disabled=saving?'disabled':'';
    document.querySelector('.story-draft-list').innerHTML=drafts.length?`
      <div class="story-draft-actions">${selecting?`<button type="button" data-story-drafts-delete ${disabled} ${selected.size?'':'disabled'}>Delete selected (${selected.size})</button><button type="button" data-story-drafts-cancel ${disabled}>Cancel</button>`:`<button type="button" data-story-drafts-select aria-label="Select Story drafts to delete">🗑 Delete drafts</button>`}</div>
      ${drafts.map(item=>`<div class="story-draft-row">${selecting?`<button type="button" role="checkbox" aria-checked="${selected.has(item.id)}" data-story-draft-select="${escapeHtml(item.id)}" ${disabled}>${selected.has(item.id)?'☑':'☐'} Story draft · ${escapeHtml(new Date(item.savedAt).toLocaleDateString())}</button>`:`<button type="button" data-story-draft="${escapeHtml(item.id)}">Resume Story draft · ${escapeHtml(new Date(item.savedAt).toLocaleDateString())}</button><button type="button" data-story-drafts-select="${escapeHtml(item.id)}" aria-label="Select this draft to delete">🗑</button>`}</div>`).join('')}`:'<p>No Story drafts yet.</p>';
}
export function handleStoryDraftManagement(event){
    const target=event.target;
    const begin=target.closest('[data-story-drafts-select]');
    const choice=target.closest('[data-story-draft-select]');
    const cancel=target.closest('[data-story-drafts-cancel]');
    const remove=target.closest('[data-story-drafts-delete]');
    if(!begin&&!choice&&!cancel&&!remove)return false;
    if(!mayInteract()||saving)return true;
    if(begin){selecting=true;if(begin.dataset.storyDraftsSelect)selected.add(begin.dataset.storyDraftsSelect);renderStoryDrafts();}
    if(choice){const id=choice.dataset.storyDraftSelect;if(selected.has(id))selected.delete(id);else selected.add(id);renderStoryDrafts();}
    if(cancel)renderStoryDrafts(true);
    if(remove&&selected.size){
        const ids=new Set(selected),previous=state.draftItems;
        state.draftItems=previous.filter(item=>item.type!=='story'||!ids.has(item.id));
        saving=true;renderStoryDrafts();
        persistSession().then(()=>{saving=false;renderStoryDrafts(true);showShareFeedback('Selected Story drafts deleted.');}).catch(()=>{state.draftItems=previous;saving=false;renderStoryDrafts();showShareFeedback('Drafts could not be deleted. Try again.');});
    }
    return true;
}
