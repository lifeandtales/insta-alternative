import { resetReelCover, suspendReelCover, renderReelCover, getReelCover } from './reel-cover.js';
import { renderSquareCover } from '../media/cover-canvas.js';
import { initializePostCarousels } from '../media/carousel.js';
import { bindHorizontalReorder } from '../media/horizontal-reorder.js';
import { hideCaptionSuggestions } from './caption-suggestions.js';
import { recordPostMentions } from './notifications.js';
import { renderCaption } from '../components/caption.js';
import { POST_FILTERS, bindPostFilterSwipe, bindPostTextGestures, mediaEdits, mediaFilter, mediaAspect, mediaFit, renderEditedMedia } from './post-media.js';
import { escapeHtml, normalizeHandle, normalizeSearchText } from '../core/utils.js';
import { mayInteract } from '../core/social.js';
import { persistSession, unexpiredDrafts } from '../storage/local-session.js';
import { showShareFeedback } from '../components/feedback.js';
import { createMenuBackdrop, createUploadBackdrop } from '../core/dom.js';
import { setView } from '../core/navigation.js';
import { state } from '../core/state.js';
import { currentUser, posts, reels } from '../data/sample-data.js';

export function openCreateMenu() {
    if (!mayInteract()) { showShareFeedback('Approval is required to create content.'); return; }
    state.createOriginView = state.currentView;
    createMenuBackdrop.hidden = false;
    document.body.classList.add("story-overlay-open");
    document.querySelector(".create-menu-close").focus();
}

export function closeCreateMenu() {
    createMenuBackdrop.hidden = true;
    if (createUploadBackdrop.hidden && document.querySelector(".story-viewer-backdrop").hidden) {
        document.body.classList.remove("story-overlay-open");
    }
}

export function searchCreateTagAccounts(query){
    const needle=normalizeSearchText(String(query||'').trim().replace(/^@/,''));
    if(!needle)return [];
    return state.accountDirectory.filter(account=>account.handle!==currentUser.handle&&!state.blockedHandles.has(account.handle)&&[account.name,account.handle].some(value=>normalizeSearchText(value||'').includes(needle))).sort((a,b)=>Number(state.followedAccountHandles.has(b.handle))-Number(state.followedAccountHandles.has(a.handle))||(a.name||a.handle).localeCompare(b.name||b.handle));
}
export function syncCreateCaptionPreview() {
    const field=document.getElementById('create-caption'),highlight=document.querySelector('.create-caption-highlight');
    highlight.innerHTML=renderCaption(field.value,{interactive:false})+'\n';
    highlight.scrollTop=field.scrollTop;highlight.scrollLeft=field.scrollLeft;
}
export function renderCreateTags(){
    const handles=document.getElementById('create-tags').value.split(',').map(value=>value.trim()).filter(Boolean);
    document.querySelector('.create-tag-selected').innerHTML=handles.map(handle=>`<button type="button" data-create-tag-remove="${escapeHtml(handle)}" aria-label="Remove tag ${escapeHtml(handle)}">${escapeHtml(handle)} ×</button>`).join('');
    const query=document.getElementById('create-tag-search').value;
    const accounts=searchCreateTagAccounts(query);
    document.getElementById('create-tag-results').innerHTML=!query.trim()?'':accounts.length?accounts.map(account=>`<button type="button" data-create-tag="${escapeHtml(account.handle)}" aria-pressed="${handles.includes(account.handle)}"><strong>${escapeHtml(account.name)}</strong><span>${escapeHtml(account.handle)}${state.followedAccountHandles.has(account.handle)?' · Following':''}</span></button>`).join(''):'<p>No matching accounts.</p>';
}
export function startCreateEditing(){
    if(!state.createMediaItems.length||!mayInteract())return false;
    document.querySelector('.create-picker-step').hidden=true;
    document.querySelector('.create-editor-step').hidden=false;
    document.querySelector('.create-upload-dialog').classList.add('create-editing');
    document.querySelector('.create-upload-backdrop').classList.add('create-editor-open');
    document.getElementById('create-upload-title').textContent=state.createMediaType==='reel'?'Edit reel':'Edit post';
    if(state.createCoverIndex===null)state.createCoverIndex=0;
    setCreateDetails(false);renderCreateTags();
    document.getElementById('create-upload-title').focus();return true;
}

export function openCreateUpload(type) {
    if (!mayInteract()) return;
    resetReelCover();
    dismissCreateExit();
    hideCaptionSuggestions();
    state.createMediaItems = [];
    state.createReorderOpen = false; state.createActiveIndex = 0; state.createTool = ""; state.createDetailsOpen = false; state.createFinalizedItems = null; state.createAppending = false;
    document.getElementById("create-schedule").value = "";
    for(const name of ['music','schedule']){
        document.getElementById(`create-${name}-panel`).hidden=true;
        document.querySelector(`[data-create-detail="${name}"]`).setAttribute('aria-expanded','false');
    }
    document.querySelector(".create-editor-fields").hidden = true;
    document.querySelector(".create-media-editing").hidden = false;
    state.createCoverIndex = null;
    document.querySelector('.create-picker-step').hidden=false;
    document.querySelector('.create-editor-step').hidden=true;
    document.querySelector('.create-upload-dialog').classList.remove('create-editing');
    document.querySelector('.create-upload-backdrop').classList.remove('create-editor-open');
    document.querySelector('.create-start-editing').disabled=true;
    document.querySelector('.create-file-selection').textContent='';
    document.querySelector('.create-tag-panel').hidden=true;
    document.querySelector('.create-tag-people').setAttribute('aria-expanded','false');
    document.getElementById('create-tag-search').value='';
    document.getElementById('create-tag-results').replaceChildren();
    document.querySelector('.create-tag-selected').replaceChildren();
    document.querySelector('.create-upload-hint').hidden=true;
    document.querySelector('.create-upload-hint').textContent='';
    state.activeDraftId = null;
    state.createMediaType = type;
    state.createMediaFile = null;
    if (state.createMediaUrl)
        URL.revokeObjectURL(state.createMediaUrl);
    state.createMediaUrl = "";
    document.getElementById("post-upload").value = "";
    document.getElementById("create-caption").value = "";
    syncCreateCaptionPreview();
    document.getElementById('create-location').value = '';
    document.getElementById('create-tags').value = '';
    document.querySelector('.create-media-controls').hidden = true;
    document.getElementById('post-upload').multiple = type !== 'reel';
    document.querySelector(".create-upload-preview").replaceChildren();
    document.querySelector(".create-upload-preview").hidden = true;
    document.querySelector(".create-publish-button").disabled = true;
    const isReel = type === "reel";
    document.getElementById("create-upload-title").textContent = isReel ? "New reel" : "New post";
    document.getElementById("post-upload").accept = isReel
        ? ".mp4,.webm,.mov,.m4v,.3gp,.ogv,video/mp4,video/webm,video/quicktime,video/x-m4v,video/3gpp,video/ogg"
        : ".jpg,.jpeg,.png,.gif,.webp,.avif,.heic,.heif,.bmp,.mp4,.webm,.mov,.m4v,.3gp,.ogv,image/jpeg,image/png,image/gif,image/webp,image/avif,image/heic,image/heif,image/bmp,video/mp4,video/webm,video/quicktime,video/x-m4v,video/3gpp,video/ogg";
    document.querySelector(".create-publish-button").textContent = isReel ? "Share reel" : "Share post";
    createUploadBackdrop.hidden = false;
    document.body.classList.add("story-overlay-open");
    document.querySelector(".create-upload-close").focus();
}

export function dismissCreateExit() {
    const dialog=document.querySelector('.create-exit-dialog');
    if(dialog.open)dialog.close();dialog.hidden=true;
}
export function closeCreateUpload(discard = false) {
    if (!discard && state.createMediaItems.length && !document.querySelector('.create-editor-step').hidden) {
        hideCaptionSuggestions();
        const dialog=document.querySelector('.create-exit-dialog');dialog.hidden=false;
        if(!dialog.open)dialog.showModal?.();
        document.querySelector('.create-keep-editing').focus();return;
    }
    dismissCreateExit();hideCaptionSuggestions();
    resetReelCover();
    createUploadBackdrop.hidden = true;
    const mediaIsSaved = state.draftItems.some(draft => draft.items?.some(item => item.url === state.createMediaUrl));
    if (state.createMediaUrl && !mediaIsSaved)
        URL.revokeObjectURL(state.createMediaUrl);
    state.createMediaUrl = "";
    state.createMediaFile = null;
    state.createMediaItems = [];
    if (createMenuBackdrop.hidden && document.querySelector(".story-viewer-backdrop").hidden) {
        document.body.classList.remove("story-overlay-open");
    }
}

export async function publishCreatedMedia() {
    if (!mayInteract()) return;
    if (!state.createDetailsOpen || !state.createFinalizedItems?.length) { showShareFeedback('Tap Next to review your post first.'); return; }
    const scheduledValue = document.getElementById('create-schedule').value;
    const scheduledAt = scheduledValue ? new Date(scheduledValue).getTime() : null;
    if (scheduledValue && (!Number.isFinite(scheduledAt) || scheduledAt <= Date.now())) { showShareFeedback('Choose a future date and time.'); return; }
    if (state.createCoverIndex === null) { showShareFeedback('Choose a square cover before publishing.'); return; }
    if (!state.createMediaItems.length || state.createMediaItems.length > 20) return;
    const cover = state.createMediaType==='reel'?getReelCover(state.createMediaItems[0]):await createSquareCover(state.createMediaItems[state.createCoverIndex]);
    if(state.createMediaType==='reel'&&!cover){showShareFeedback('Choose and confirm a reel thumbnail before sharing.');return;}
    if (!cover) { showShareFeedback('This media cannot be decoded here. Choose another supported file.'); return; }
    if (!state.createMediaFile || !state.createMediaUrl)
        return;
    const caption = document.getElementById("create-caption").value.trim();
    const mediaType = getSupportedStoryFileType(state.createMediaFile);
    const createdAt = Date.now();
    if (state.createMediaType === "reel") {
        const reel = {
            id: createdAt,
            user: currentUser.name,
            handle: currentUser.handle,
            avatar: currentUser.avatar,
            poster: cover,
            cover,
            video: state.createMediaUrl,
            coverIndex: state.createCoverIndex,
            mediaItems: state.createFinalizedItems.map(item => ({...item})),
            originalAudioMuted: state.createFinalizedItems[0].originalAudioMuted === true,
            taggedUsers: document.getElementById('create-tags').value.split(',').map(value=>value.trim()).filter(Boolean).map(normalizeHandle),
            caption,
            createdAt,
            likes: 0,
            comments: 0,
            liked: false,
            commentItems: [],
            public: !currentUser.isPrivate,
            followed: true,
            reel: true,
            mine: true
        };
        if (scheduledAt) (state.scheduledPosts ??= []).push({type:'reel',item:reel,scheduledAt}); else { reels.unshift(reel);recordPostMentions(reel); }
    }
    else {
        const post = {
            id: createdAt,
            user: currentUser.name,
            handle: currentUser.handle,
            location: document.getElementById('create-location').value.trim(),
            taggedHandles: document.getElementById('create-tags').value.split(',').map(value => value.trim()).filter(Boolean).map(normalizeHandle),
            taggedUsers: document.getElementById('create-tags').value.split(',').map(value => value.trim()).filter(Boolean).map(normalizeHandle),
            coverIndex: state.createCoverIndex,
            mediaItems: state.createFinalizedItems.map(item => ({ ...item })),
            cover,
            avatar: currentUser.avatar,
            media: state.createMediaUrl,
            videoUrl: mediaType === "video" ? state.createMediaUrl : undefined,
            mediaType: mediaType === "video" ? "video" : "photo",
            caption,
            createdAt,
            likes: 0,
            comments: 0,
            liked: false,
            commentItems: [],
            followed: true,
            public: !currentUser.isPrivate,
            reel: false,
            mine: true
        };
        if (scheduledAt) (state.scheduledPosts ??= []).push({type:'post',item:post,scheduledAt}); else { posts.unshift(post);recordPostMentions(post); }
    }
    state.draftItems = state.draftItems.filter(item => item.id !== state.activeDraftId);
    try { await persistSession(); }
    catch { showShareFeedback('Published on this screen, but storage failed. Keep this page open.'); return; }
    armScheduledPosts();
    const publishedType = state.createMediaType;
    state.createMediaUrl = "";
    state.createMediaFile = null;
    createUploadBackdrop.hidden = true;
    createMenuBackdrop.hidden = true;
    document.body.classList.remove("story-overlay-open");
    if (state.createOriginView === "profile") {
        state.activeProfileSection = publishedType === "reel" ? "reels" : "posts";
        setView("profile");
    }
    else {
        setView("home");
    }
    state.createOriginView = "";
    showShareFeedback(scheduledAt ? `Your ${publishedType} is scheduled on this device.` : `Your ${publishedType} was shared to your profile.`);
}

export function getSupportedStoryFileType(file) {
    const mimeType = String(file?.type || '').split(';', 1)[0].trim().toLowerCase();
    if (mimeType) {
        if (/^image\/(jpeg|png|gif|webp|avif|heic|heif|bmp|tiff?)$/.test(mimeType))
            return "image";
        if (/^video\/(mp4|webm|quicktime|x-m4v|3gpp|ogg|mpeg|x-msvideo)$/.test(mimeType))
            return "video";
        // Phone file providers sometimes label a recognized file with a generic
        // binary MIME type. Use its extension only for those generic labels.
        if (!/^(application|binary)\/(octet-stream|x-octet-stream)$/.test(mimeType))
            return null;
    }
    const extension = String(file?.name || '').toLowerCase().split(".").pop();
    if (["jpg", "jpeg", "png", "gif", "webp", "avif", "heic", "heif", "bmp", "tif", "tiff"].includes(extension))
        return "image";
    if (["mp4", "webm", "mov", "m4v", "3gp", "ogv", "mpeg", "mpg", "avi"].includes(extension))
        return "video";
    return null;
}

export async function finalizeCreateMedia() {
    if (!state.createMediaItems.length || state.createFinalizing) return false;
    state.createFinalizing=true;
    const finalizingItems=state.createMediaItems;
    const next=document.querySelector('.create-next');next.disabled=true;next.textContent='Preparing media…';
    try {
        await Promise.all(state.createMediaItems.map(item=>item.naturalRatio ? Promise.resolve() : new Promise((resolve,reject)=>{
            const media=document.createElement(item.type==='video'?'video':'img');
            if(item.type==='video'){media.muted=true;media.preload='metadata';}
            const timeout=window.setTimeout(()=>{media.removeAttribute('src');reject(new Error('Media load timed out'));},15000);
            media.addEventListener(item.type==='video'?'loadedmetadata':'load',()=>{
                clearTimeout(timeout);const width=media.naturalWidth||media.videoWidth,height=media.naturalHeight||media.videoHeight;
                if(width&&height){item.naturalRatio=width/height;resolve();}else reject(new Error('Media dimensions unavailable'));
            },{once:true});
            media.addEventListener('error',()=>{clearTimeout(timeout);reject(new Error('Unsupported media'));},{once:true});media.src=item.url;
        })));
        if(createUploadBackdrop.hidden || state.createMediaItems!==finalizingItems)return false;
        return setCreateDetails(true);
    } catch { showShareFeedback('One of these files could not be opened. Try a supported photo or video.');return false; }
    finally {state.createFinalizing=false;next.disabled=false;next.textContent='Next →';}
}
export function updateCreateScheduleMinimum() {
    const next=new Date(Math.ceil((Date.now()+1)/60000)*60000);
    document.getElementById('create-schedule').min=new Date(next.getTime()-next.getTimezoneOffset()*60000).toISOString().slice(0,16);
}
export function setCreateDetails(details) {
    if (!state.createMediaItems.length) return false;
    state.createDetailsOpen = Boolean(details);
    if(details)updateCreateScheduleMinimum();
    else suspendReelCover();
    document.querySelector('.create-reel-cover').hidden=!details||state.createMediaType!=='reel';
    state.createFinalizedItems = details ? state.createMediaItems.map(item => ({...item})) : null;
    document.querySelector('.create-media-editing').hidden = Boolean(details);
    document.querySelector('.create-editor-fields').hidden = !details;
    document.getElementById('create-upload-title').textContent = details ? (state.createMediaType==='reel'?'New reel':'New post') : state.createMediaType === 'reel' ? 'Edit reel' : 'Edit post';
    renderCreatePreview();
    document.getElementById('create-upload-title').focus();
    return true;
}
export function syncCreateMediaSelection() {
    const first=state.createMediaItems[0];
    state.createMediaUrl=first?.url||'';
    state.createMediaFile=first?{type:first.type==='video'?'video/mp4':'image/jpeg'}:null;
    state.createFinalizedItems=null;
}
export function reorderCreateMedia(from,to) {
    const items=[...state.createMediaItems];
    if(!mayInteract()||state.createDetailsOpen||state.createFinalizing||!Number.isInteger(from)||!Number.isInteger(to)||from<0||to<0||from>=items.length||to>=items.length||from===to)return false;
    const active=items[state.createActiveIndex||0],cover=items[state.createCoverIndex];
    const [moved]=items.splice(from,1);items.splice(to,0,moved);state.createMediaItems=items;
    state.createActiveIndex=items.indexOf(active);state.createCoverIndex=cover?items.indexOf(cover):0;
    syncCreateMediaSelection();renderCreatePreview();return true;
}
export function removeCreateMedia(index=state.createActiveIndex||0) {
    if(!mayInteract()||state.createDetailsOpen||state.createFinalizing||!Number.isInteger(index)||index<0||index>=state.createMediaItems.length)return false;
    const items=[...state.createMediaItems],active=items[state.createActiveIndex||0],cover=items[state.createCoverIndex],removed=items.splice(index,1)[0];
    state.createMediaItems=items;state.createActiveIndex=items.includes(active)?items.indexOf(active):Math.min(index,Math.max(0,items.length-1));
    state.createCoverIndex=items.length?(items.includes(cover)?items.indexOf(cover):Math.min(index,items.length-1)):null;
    if(items.length<2)state.createReorderOpen=false;
    const retained=[...state.draftItems,...posts,...reels].some(entity=>entity.media===removed.url||entity.video===removed.url||entity.videoUrl===removed.url||[...(entity.items||[]),...(entity.mediaItems||[])].some(item=>item.url===removed.url));
    if(removed.url?.startsWith('blob:')&&!retained)URL.revokeObjectURL(removed.url);
    syncCreateMediaSelection();renderCreatePreview();return true;
}
function renderCreateMediaOrder() {
    const items=state.createMediaItems,index=state.createActiveIndex||0,panel=document.querySelector('.create-media-tabs');
    panel.hidden=state.createMediaType==='reel';
    if(panel.hidden){panel.replaceChildren();return;}
    panel.innerHTML=items.map((item,i)=>`<div class="create-order-tile" role="listitem"><button type="button" class="create-media-thumbnail create-order-thumb" data-create-active="${i}" data-order-index="${i}" aria-pressed="${i===index}" aria-label="${item.type==='video'?'Video':'Image'} ${i+1}" aria-description="Swipe to scroll. Hold for 0.8 seconds to reorder or remove. Keyboard: Alt and left or right arrow.">${item.type==='image'?`<img src="${escapeHtml(item.url)}" alt="" draggable="false" style="filter:${mediaFilter(item)}" />`:`<video src="${escapeHtml(item.url+(item.url.includes('#')?'':'#t=0.01'))}" muted playsinline preload="metadata" aria-hidden="true" style="filter:${mediaFilter(item)}"></video><span class="create-media-video-mark" aria-hidden="true">▶</span>`}<span class="create-media-position" aria-hidden="true">${i+1}</span></button><button type="button" class="create-thumb-remove" data-create-remove="${i}" aria-label="Remove ${item.type==='video'?'video':'image'} ${i+1}">×</button></div>`).join('');
    bindHorizontalReorder(panel,reorderCreateMedia);
}

export function renderCreatePreview() {
    const preview = document.querySelector('.create-upload-preview');
    const controls = document.querySelector('.create-media-controls');
    const index = Math.max(0, Math.min(state.createMediaItems.length - 1, state.createActiveIndex || 0));
    state.createActiveIndex = index;
    const item = state.createMediaItems[index];
    renderCreateMediaOrder();
    document.querySelector('.create-next').disabled=!item||Boolean(state.createFinalizing);
    document.querySelector('.create-add-media').hidden=state.createDetailsOpen||(state.createMediaType==='reel'&&Boolean(item));
    document.querySelector('.create-add-media').innerHTML=state.createMediaType==='reel'?'＋ Add video':'<span>＋ Add media</span><small>(up to 20 posts)</small>';
    document.querySelector('.create-add-media').disabled=state.createMediaItems.length>=(state.createMediaType==='reel'?1:20);
    document.querySelector('.create-tool-tabs').hidden=!item;
    preview.hidden = false;
    controls.hidden = !item;
    if (!item) {
        preview.innerHTML='<p class="create-media-empty">Add a photo or video to continue.</p>';
        controls.replaceChildren();document.querySelector('.create-media-tabs').replaceChildren();
        document.querySelector('.create-publish-button').disabled=true;return;
    }
    preview.classList.toggle('create-final-preview',state.createDetailsOpen);
    if(state.createDetailsOpen){
        const items=state.createFinalizedItems||state.createMediaItems;
        controls.hidden=true;
        preview.innerHTML=`<div class="post-carousel" aria-label="${items.length} media items"><div class="carousel-slides" tabindex="0" aria-label="Post preview: swipe to see all media">${items.map((entry,i)=>`<div class="carousel-slide" role="group" aria-label="${i+1} of ${items.length}">${renderEditedMedia(entry,{preview:true,alt:`Media ${i+1}`})}</div>`).join('')}</div>${items.length>1?`<span class="carousel-index" role="status" aria-live="polite" aria-label="Item 1 of ${items.length}">1/${items.length}</span>`:''}</div>`;
        initializePostCarousels(preview);
        renderReelCover(items[0]);
        document.querySelector('.create-publish-button').disabled=state.createMediaType==='reel'&&!getReelCover(items[0]);
        return;
    }
    const edit = mediaEdits(item), tool = state.createTool || '';
    document.querySelectorAll('[data-create-tool]').forEach(button=>{const open=button.dataset.createTool===tool;button.setAttribute('aria-pressed',String(open));button.setAttribute('aria-expanded',String(open));});
    controls.hidden=!tool;
    preview.innerHTML = `<div class="upload-media-item">${renderEditedMedia(item, {preview:true,alt:`Media ${index+1}`})}</div>`;
    const bindText = () => { if (!state.createDetailsOpen) bindPostTextGestures(preview.querySelector('.post-media-stage'),item,()=>{state.createFinalizedItems=null;},()=>!state.createDetailsOpen&&!state.createFinalizing); };
    bindText();
    const media = preview.querySelector('img,video');
    if (media) {
        const rememberSize = () => {
            const width = media.naturalWidth || media.videoWidth, height = media.naturalHeight || media.videoHeight;
            if (width && height && !item.naturalRatio) {
                item.naturalRatio = width / height;
                const stage = media.closest('.post-media-stage');
                if (stage) { stage.style.aspectRatio = String(mediaAspect(item)); stage.style.setProperty("--media-ratio",String(mediaAspect(item))); }
            }
        };
        media.addEventListener(item.type === 'video' ? 'loadedmetadata' : 'load', rememberSize, {once:true});
        rememberSize();
        if (item.type === 'video') media.addEventListener('volumechange', () => { if (item.originalAudioMuted && !media.muted) media.muted = true; });
    }
    const range = (key,label,min,max,value) => `<label>${label}<input type="range" data-create-edit="${key}" min="${min}" max="${max}" value="${value}" /></label>`;
    const options = (key,label,values,current) => `<label>${label}<select data-create-edit="${key}">${values.map(([value,text])=>`<option value="${value}" ${value===current?'selected':''}>${text}</option>`).join('')}</select></label>`;
    let fields = '';
    if (tool === 'text') fields = `<label>Text on media<input data-create-edit="text" maxlength="200" value="${escapeHtml(edit.text)}" placeholder="Write on your image or video" /></label><small>Drag text on the preview to move it. Pinch with two fingers to resize.</small>`;
    if (tool === 'filters') fields = `<div class="create-filter-strip" role="group" aria-label="Filters">${POST_FILTERS.map(({id:value,name:label})=>`<button type="button" data-create-filter="${value}" aria-pressed="${edit.filter===value}"><span class="create-filter-swatch" style="filter:${mediaFilter({...item,filter:value})}">${item.type==='image'?`<img src="${escapeHtml(item.url)}" alt="" draggable="false" />`:'✦'}</span><span>${label}</span></button>`).join('')}</div><small>Swipe the preview left or right to change filters.</small>`;
    if (tool === 'ratio') fields = options('ratio',state.createMediaType==='reel'?'Reel ratio':'Post ratio',(state.createMediaType==='reel'?[['9/16','Full portrait · 9:16'],['original','Original'],['1/1','Square · 1:1'],['4/5','Portrait · 4:5'],['16/9','Landscape · 16:9']]:[['original','Original · within post limits'],['1/1','Square · 1:1'],['4/5','Portrait · 4:5'],['3/4','Tall portrait · 3:4'],['16/9','Landscape · 16:9'],['1.91/1','Wide landscape · 1.91:1']]),edit.ratio)+range('x','Horizontal crop',0,100,item.x??50)+range('y','Vertical crop',0,100,item.y??50);
    if (tool === 'edit') fields = range('brightness','Brightness',0,200,edit.brightness)+range('contrast','Contrast',0,200,edit.contrast)+range('saturation','Saturation',0,200,edit.saturation)+`<button type="button" class="create-reset-edits">Reset adjustments</button>`;
    controls.innerHTML = !tool?'':fields + (item.type === 'video' ? `<label class="create-original-audio"><input type="checkbox" data-create-edit="originalAudioMuted" ${edit.originalAudioMuted?'checked':''} /> Mute original audio</label>` : '') + (state.createMediaType==='reel'?'':`<button type="button" data-choose-cover="${index}" aria-pressed="${state.createCoverIndex===index}">${state.createCoverIndex===index?'✓ Selected cover':'Use this media as cover'}</button>`);
    if (tool === 'filters' && !state.createDetailsOpen) {
        const selectFilter = value => { item.filter=value;state.createFinalizedItems=null;renderCreatePreview(); };
        controls.querySelectorAll('[data-create-filter]').forEach(button=>button.addEventListener('click',()=>selectFilter(button.dataset.createFilter)));
        const strip=controls.querySelector('.create-filter-strip'),selected=strip?.querySelector('[aria-pressed=true]');
        if(strip&&selected)strip.scrollLeft=Math.max(0,selected.offsetLeft-strip.offsetLeft-(strip.clientWidth-selected.offsetWidth)/2);
        bindPostFilterSwipe(preview.querySelector('.post-media-stage'),direction=>{
            const filters=POST_FILTERS.map(filter=>filter.id),current=filters.indexOf(mediaEdits(item).filter);
            selectFilter(filters[(current+direction+filters.length)%filters.length]);
        });
    }
    controls.querySelectorAll('[data-create-edit]').forEach(control => {
        const update = () => {
            if (state.createDetailsOpen) return;
            const key=control.dataset.createEdit;
            item[key]=key==='originalAudioMuted'?control.checked:['text','filter','ratio'].includes(key)?control.value:Number(control.value);
            state.createFinalizedItems=null;
            preview.innerHTML=`<div class="upload-media-item">${renderEditedMedia(item,{preview:true,alt:`Media ${index+1}`})}</div>`;
            bindText();
            const video=preview.querySelector('video');
            if(video)video.addEventListener('volumechange',()=>{if(item.originalAudioMuted&&!video.muted)video.muted=true;});
        };
        control.addEventListener('input',update);
        control.addEventListener('change',update);
    });
    document.querySelector('.create-publish-button').disabled = state.createCoverIndex === null;
}
export async function saveCreateDraft() {
    if (!mayInteract()) return;
    if (!state.createMediaItems.length) return;
    const draft = { id: state.activeDraftId || `draft-${Date.now()}`, type: state.createMediaType, savedAt: Date.now(), items: state.createMediaItems.map(item => ({ ...item })), coverIndex: state.createCoverIndex, caption: document.getElementById('create-caption').value, location: document.getElementById('create-location').value, tags: document.getElementById('create-tags').value, schedule: document.getElementById('create-schedule').value };
    state.draftItems = state.draftItems.filter(item => item.id !== draft.id);
    state.draftItems.push(draft);
    try { await persistSession(); }
    catch { showShareFeedback('Draft could not be saved. Your editor is still open.'); return; }
    // Retain draft object URLs while they are used by this session.
    state.createMediaUrl = '';
    closeCreateUpload(true);
    showShareFeedback('Draft saved for 7 days from this save.');
}
export function resumeCreateDraft(id) {
    if (!mayInteract()) return;
    const draft = unexpiredDrafts(state.draftItems).find(item => item.id === id);
    if (!draft) return;
    state.createOriginView=state.currentView;
    openCreateUpload(draft.type);
    state.activeDraftId = draft.id;
    state.createMediaItems = draft.items.map(item => ({ ...item, layout:draft.type==='reel'?'reel':'post' }));
    state.createCoverIndex = draft.coverIndex;
    state.createMediaUrl = draft.items[0]?.url || '';
    state.createMediaFile = { type: draft.items[0]?.type === 'video' ? 'video/mp4' : 'image/jpeg' };
    document.getElementById('create-caption').value = draft.caption;
    syncCreateCaptionPreview();
    document.getElementById('create-location').value = draft.location || '';
    document.getElementById('create-tags').value = draft.tags || '';
    document.getElementById('create-schedule').value = draft.schedule || '';
    closeCreateMenu();
    startCreateEditing();
}
async function createSquareCover(item) {
    const media = document.createElement(item.type === 'video' ? 'video' : 'img');
    if (item.type === 'video') { media.muted = true; media.playsInline = true; }
    const ready = new Promise(resolve => {
        media.addEventListener(item.type === 'video' ? 'loadeddata' : 'load', () => resolve(true), { once: true });
        media.addEventListener('error', () => resolve(false), { once: true });
    });
    media.src = item.url;
    if (!await ready) return null;
    if (item.type === 'video') {
        const source = document.querySelectorAll('.create-upload-preview video')[state.createMediaItems.slice(0, state.createCoverIndex).filter(entry => entry.type === 'video').length];
        const seekTo = Math.min(item.coverTime || 0, media.duration || 0);
        if (seekTo > 0) { const seeked = new Promise(resolve => media.addEventListener('seeked', resolve, { once: true })); media.currentTime = seekTo; await seeked; }
    }
    try{return renderSquareCover(media,item);}catch{return null;}
}

let scheduledPostTimer = null;
export function processScheduledPosts(now = Date.now()) {
    const due = (state.scheduledPosts || []).filter(entry => entry.scheduledAt <= now);
    for (const entry of due) {
        const target = entry.type === 'reel' ? reels : posts;
        if (!target.some(item => item.id === entry.item.id)) { const published={...entry.item,createdAt:now};target.unshift(published);recordPostMentions(published); }
    }
    state.scheduledPosts = (state.scheduledPosts || []).filter(entry => entry.scheduledAt > now);
    if (due.length) { persistSession().catch(()=>showShareFeedback('Scheduled post published, but saving failed.')); setView(state.currentView); }
    armScheduledPosts();
    return due.length;
}
export function armScheduledPosts() {
    clearTimeout(scheduledPostTimer);
    const next = Math.min(...(state.scheduledPosts || []).map(entry => entry.scheduledAt));
    if (Number.isFinite(next)) scheduledPostTimer = window.setTimeout(()=>processScheduledPosts(),Math.max(0,Math.min(2147483647,next-Date.now())));
}
