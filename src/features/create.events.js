import { registerCaptionSuggestions } from './caption-suggestions.js';
import { persistSession } from '../storage/local-session.js';
import { showShareFeedback } from '../components/feedback.js';
import { createMenuBackdrop, createUploadBackdrop } from '../core/dom.js';
import { state } from '../core/state.js';
import { mayInteract } from '../core/social.js';
import {
    dismissCreateExit, syncCreateCaptionPreview, finalizeCreateMedia, setCreateDetails, renderCreatePreview, saveCreateDraft, resumeCreateDraft, startCreateEditing, renderCreateTags, searchCreateTagAccounts,
    closeCreateMenu,
    closeCreateUpload,
    getSupportedStoryFileType,
    openCreateMenu,
    openCreateUpload,
    publishCreatedMedia,
} from './create.js';

export function handleOpenCreateClick(event) {
    if (event.target.closest(".create-button")) {
        openCreateMenu();
        return true;
    }
    if (event.target.closest(".profile-create-button")) {
        openCreateMenu();
        return true;
    }
    return false;
}

export function handleCreateUploadClick(event) {
    if(event.target.closest('.create-keep-editing')){dismissCreateExit();document.querySelector('.create-upload-close').focus();return true;}
    if(event.target.closest('.create-next')){finalizeCreateMedia();return true;}
    if(event.target.closest('.create-back-to-edit')){setCreateDetails(false);return true;}
    if(event.target.closest('.create-add-media')){state.createAppending=true;document.getElementById('post-upload').value='';document.getElementById('post-upload').click();return true;}
    const tool=event.target.closest('[data-create-tool]');
    if(tool){state.createTool=tool.dataset.createTool;renderCreatePreview();return true;}
    const active=event.target.closest('[data-create-active]');
    if(active){state.createActiveIndex=Number(active.dataset.createActive);renderCreatePreview();return true;}
    if(event.target.closest('.create-reset-edits')){const item=state.createMediaItems[state.createActiveIndex||0];if(item){item.brightness=100;item.contrast=100;item.saturation=100;item.rotation=0;renderCreatePreview();}return true;}
    if(event.target.closest('.create-start-editing')){startCreateEditing();return true;}
    if(event.target.closest('.create-tag-people')){document.querySelector('.create-tag-panel').hidden=false;document.querySelector('.create-tag-people').setAttribute('aria-expanded','true');renderCreateTags();document.getElementById('create-tag-search').focus();return true;}
    if(event.target.closest('.create-tags-done')){document.querySelector('.create-tag-panel').hidden=true;document.querySelector('.create-tag-people').setAttribute('aria-expanded','false');document.querySelector('.create-tag-people').focus();return true;}
    const tag=event.target.closest('[data-create-tag]'),removeTag=event.target.closest('[data-create-tag-remove]');
    if(tag||removeTag){const field=document.getElementById('create-tags'),handles=field.value.split(',').map(value=>value.trim()).filter(Boolean),handle=tag?.dataset.createTag||removeTag.dataset.createTagRemove;if(tag&&!searchCreateTagAccounts(document.getElementById('create-tag-search').value).some(account=>account.handle===handle))return true;field.value=(removeTag||handles.includes(handle)?handles.filter(value=>value!==handle):[...handles,handle]).join(',');renderCreateTags();return true;}

    const resume = event.target.closest('[data-resume-draft]');
    if (resume) { resumeCreateDraft(resume.dataset.resumeDraft); return true; }
    const removeDraft = event.target.closest('[data-delete-draft]');
    if (removeDraft) { if (!mayInteract()) return true; state.draftItems = state.draftItems.filter(item => item.id !== removeDraft.dataset.deleteDraft); persistSession().catch(() => showShareFeedback('Draft deletion could not be saved.')); openCreateMenu(); return true; }
    const cover = event.target.closest('[data-choose-cover]');
    if (cover) {
        const index = Number(cover.dataset.chooseCover);
        const video = document.querySelector('.create-upload-preview video');
        if (video) state.createMediaItems[index].coverTime = video.currentTime;
        state.createCoverIndex = index; renderCreatePreview(); return true;
    }
    if (event.target.closest('.create-discard')) { closeCreateUpload(true); return true; }
    const createTypeButton = event.target.closest("[data-create-type]");
    if (createTypeButton) {
        createMenuBackdrop.hidden = true;
        openCreateUpload(createTypeButton.dataset.createType);
        return true;
    }
    if (event.target.closest(".create-menu-close") || event.target === createMenuBackdrop) {
        closeCreateMenu();
        return true;
    }
    if (event.target.closest(".create-upload-close") || event.target === createUploadBackdrop) {
        closeCreateUpload();
        return true;
    }
    if (event.target.closest(".create-publish-button")) {
        publishCreatedMedia();
        return true;
    }
    return false;
}

export function registerMediaUploadEvents() {
    registerCaptionSuggestions(syncCreateCaptionPreview);
    document.querySelector('.create-exit-dialog').addEventListener('cancel',event=>{event.preventDefault();event.stopPropagation();dismissCreateExit();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&document.querySelector('.create-exit-dialog').open){event.preventDefault();event.stopImmediatePropagation();dismissCreateExit();document.querySelector('.create-upload-close').focus();}},true);
    document.getElementById('create-tag-search').addEventListener('input',renderCreateTags);
    document.getElementById('create-caption').addEventListener('input',syncCreateCaptionPreview);
    document.getElementById('create-caption').addEventListener('scroll',syncCreateCaptionPreview);
    document.addEventListener('change', event => {
        const control = event.target;
        const index = control.dataset.mediaFit ?? control.dataset.cropX ?? control.dataset.cropY;
        const item = state.createMediaItems[Number(index)];
        if (!item) return;
        if (control.dataset.mediaFit !== undefined) item.fit = control.value;
        if (control.dataset.cropX !== undefined) item.x = Number(control.value);
        if (control.dataset.cropY !== undefined) item.y = Number(control.value);
        renderCreatePreview();
    });
    document.getElementById('post-upload').addEventListener('change', event => {
        const files = [...event.target.files];
        if (!files.length) return;
        if (files.length + (state.createAppending ? state.createMediaItems.length : 0) > (state.createMediaType === 'reel' ? 1 : 20)) {
            showShareFeedback('Choose at most 20 items per post, or one video per reel.'); return;
        }
        if (files.some(file => !getSupportedStoryFileType(file) || (state.createMediaType === 'reel' && getSupportedStoryFileType(file) !== 'video'))) {
            showShareFeedback('Choose supported photos or videos.'); return;
        }
        if(!state.createAppending)state.createMediaItems.forEach(item=>{if(item.url?.startsWith('blob:'))URL.revokeObjectURL(item.url);});
        const incoming=files.map(file => ({ type: getSupportedStoryFileType(file), url: URL.createObjectURL(file), fit: 'contain', x: 50, y: 50, originalAudioMuted:false, ratio:state.createMediaType==='reel'?'9/16':'original', layout:state.createMediaType==='reel'?'reel':'post' }));
        if(state.createAppending){state.createMediaItems.push(...incoming);state.createAppending=false;state.createFinalizedItems=null;renderCreatePreview();return;}
        state.createMediaItems = incoming;
        state.createCoverIndex = null;
        state.createMediaFile = files[0];
        state.createMediaUrl = state.createMediaItems[0].url;
        document.querySelector('.create-file-selection').textContent=files.length===1?files[0].name:`${files.length} files selected`;
        document.querySelector('.create-start-editing').disabled=false;
    });
}
