import { persistSession, unexpiredDrafts } from '../storage/local-session.js';
import { setView } from '../core/navigation.js';
import { showShareFeedback } from '../components/feedback.js';
import { renderPostCards } from '../components/post-card.js';
import {
    mediaDeleteBackdrop,
    mediaEditBackdrop,
    profilePostViewer,
    profilePostViewerContent,
} from '../core/dom.js';
import { state } from '../core/state.js';
import { escapeHtml, normalizeHandle } from '../core/utils.js';
import { findEntity } from '../data/entities.js';
import { currentUser, posts, reels } from '../data/sample-data.js';
import { getSearchableAccounts } from './explore.js';
import { isAccountFollowed } from './follows.js';
import { renderProfileHighlights } from './highlights.js';
import { getSavedItemKey, persistSavedItems } from '../storage/browser-storage.js';
import { canViewMedia, canViewAccount, getAccount, visibleAvatar, mediaNeedsWarning, mayInteract } from '../core/social.js';

export function renderSavedTile(type, entity) {
    return `
    <article class="profile-media-tile" data-profile-media-type="${type}" data-profile-media-id="${entity.id}" tabindex="0" role="button" aria-label="View ${escapeHtml(entity.user)}'s saved ${type}">
      ${renderProfileMedia(type, entity)}
    </article>
  `;
}

export function getProfileMediaCollection() {
    if (state.activeMediaViewerItems)
        return state.activeMediaViewerItems;
    const ownPosts = posts.filter((post) => post.handle === state.profileHandle && canViewMedia(post));
    const ownReels = reels.filter((reel) => reel.handle === state.profileHandle && canViewMedia(reel));
    const savedCollection = [
        ...posts.filter((post) => state.profileHandle === currentUser.handle && state.savedItems.has(getSavedItemKey("post", post.id))).map((entity) => ({ type: "post", entity })),
        ...reels.filter((reel) => state.profileHandle === currentUser.handle && state.savedItems.has(getSavedItemKey("reel", reel.id))).map((entity) => ({ type: "reel", entity }))
    ];
    const taggedCollection = [
        ...posts.filter((post) => (post.taggedUsers || []).some(handle => normalizeHandle(handle) === normalizeHandle(state.profileHandle))).map((entity) => ({ type: "post", entity })),
        ...reels.filter((reel) => (reel.taggedUsers || []).some(handle => normalizeHandle(handle) === normalizeHandle(state.profileHandle))).map((entity) => ({ type: "reel", entity }))
    ];
    const collection = state.activeProfileSection === "reels"
        ? ownReels.map((entity) => ({ type: "reel", entity }))
        : state.activeProfileSection === "saved"
            ? savedCollection
            : state.activeProfileSection === "tags"
                ? taggedCollection
                : ownPosts.map((entity) => ({ type: "post", entity }));
    return collection.filter(item => canViewMedia(item.entity) && canViewAccount(state.profileHandle));
}

export function renderProfileViewerAt(type, id) {
    const collection = getProfileMediaCollection();
    const selectedIndex = collection.findIndex((item) => item.type === type && item.entity.id === id);
    const viewerItems = collection.map(({ type: itemType, entity: item }) => ({ ...item, reel: itemType === "reel" }));
    document.getElementById("profile-post-viewer-title").textContent = type === "reel" ? "Reels" : "Posts";
    renderPostCards(viewerItems, profilePostViewerContent);
    if (selectedIndex < 0)
        return -1;
    const selectedCard = profilePostViewerContent.children[selectedIndex];
    profilePostViewerContent.scrollTop = selectedCard.getBoundingClientRect().top
        - profilePostViewerContent.getBoundingClientRect().top
        + profilePostViewerContent.scrollTop;
    return selectedIndex;
}

export function openProfileMedia(type, id, trigger, options = {}) {
    const entity = findEntity(type, id);
    if (state.deletionRequestedAt || !entity || !canViewMedia(entity))
        return;
    state.activeProfileMediaTrigger = trigger;
    const isSharedMedia = Boolean(trigger?.closest(".chat-shared-post"));
    const isExploreMedia = Boolean(trigger?.closest("#explore-grid, #community-view"));
    profilePostViewer.classList.toggle("square-media", isExploreMedia);
    state.activeMediaViewerItems = options.singleItem || isSharedMedia || (!trigger && state.currentView === 'profile') ? [{ type, entity }] : isExploreMedia
        ? state.activeExplorePosts.map((post) => ({ type: "post", entity: post }))
        : null;
    if (renderProfileViewerAt(type, id) < 0)
        return;
    profilePostViewer.hidden = false;
    document.body.classList.add("profile-post-viewer-open");
    profilePostViewer.querySelector(".profile-post-viewer-close").focus();
}

export function closeProfileMedia() {
    profilePostViewer.hidden = true;
    profilePostViewer.classList.remove("square-media");
    profilePostViewerContent.replaceChildren();
    document.body.classList.remove("profile-post-viewer-open");
    if (state.activeProfileMediaTrigger?.isConnected)
        state.activeProfileMediaTrigger.focus();
    state.activeProfileMediaTrigger = null;
    state.activeMediaViewerItems = null;
}

export function renderProfileMedia(type, entity) {
    if (mediaNeedsWarning(entity) && !state.revealedMediaKeys.has(`${type}:${entity.id}`)) return `<div class="sensitive-thumbnail"><img class="profile-thumbnail" src="${escapeHtml(entity.cover || entity.poster || entity.media || '')}" alt="Sensitive content obscured" /><span>Sensitive content</span></div>`;
    const videoUrl = type === "reel"
        ? entity.video
        : entity.mediaType === "video" ? entity.videoUrl : "";
    const mediaUrl = type === "reel" ? (entity.cover || entity.poster) : (entity.cover || entity.media);
    const alt = `${entity.user}'s ${type === "reel" ? "reel" : "post"}`;
    return entity.cover || !videoUrl
        ? `<img class="profile-thumbnail" src="${escapeHtml(mediaUrl)}" alt="${escapeHtml(alt)}" />`
        : `<video class="profile-thumbnail" src="${escapeHtml(videoUrl)}" muted playsinline preload="metadata" aria-label="${escapeHtml(alt)}"></video>`;
}

export function getProfileUser(handle) {
    const person = getAccount(handle);
    if (handle === currentUser.handle) {
        return { ...currentUser, followers: person?.followers?.length || 0, following: state.followedAccountHandles.size, isFollowing: false };
    }
    const post = posts.find((item) => item.handle === handle);
    const reel = reels.find((item) => item.handle === handle);
    const account = getSearchableAccounts().find((item) => item.handle === handle);
    const user = post || reel;
    const userMedia = [...posts, ...reels].filter((item) => item.handle === handle);
    return {
        name: person?.name || user?.user || account?.name || handle,
        handle,
        avatar: visibleAvatar(handle, user?.avatar || account?.avatar || currentUser.avatar),
        bio: person?.bio || "Welcome to my profile.",
        links: person?.links || [],
        followers: canViewAccount(handle) ? (person?.followers?.length || 0) : '—',
        following: canViewAccount(handle) ? (person?.following?.length || 0) : '—',
        isPrivate: person?.isPrivate ?? (userMedia.length > 0 && userMedia.every((item) => !item.public)),
        isFollowing: isAccountFollowed(handle)
    };
}

export function renderProfile() {
    const user = getProfileUser(state.profileHandle);
    const accessible = canViewAccount(state.profileHandle);
    const ownPosts = posts.filter((post) => post.handle === state.profileHandle && canViewMedia(post));
    const ownReels = reels.filter((reel) => reel.handle === state.profileHandle && canViewMedia(reel));
    const taggedPosts = posts.filter((post) => accessible && canViewMedia(post) && (post.taggedUsers || []).some(handle => normalizeHandle(handle) === normalizeHandle(state.profileHandle)));
    const taggedReels = reels.filter((reel) => accessible && canViewMedia(reel) && (reel.taggedUsers || []).some(handle => normalizeHandle(handle) === normalizeHandle(state.profileHandle)));
    const isOwnProfile = state.profileHandle === currentUser.handle;
    const drafts=isOwnProfile?unexpiredDrafts(state.draftItems):[];
    const canViewHighlights = accessible;
    const savedCollection = isOwnProfile
        ? [
            ...posts.filter((post) => canViewMedia(post) && state.savedItems.has(getSavedItemKey("post", post.id))).map((entity) => ({ type: "post", entity })),
            ...reels.filter((reel) => canViewMedia(reel) && state.savedItems.has(getSavedItemKey("reel", reel.id))).map((entity) => ({ type: "reel", entity }))
        ]
        : [];
    document.getElementById("profile-view").innerHTML = `
    <div class="profile-topbar">
      <span aria-hidden="true"></span>
      <h2>${escapeHtml(user.handle)}</h2>
      ${isOwnProfile
        ? '<button class="profile-settings-button" type="button" aria-label="Settings" title="Settings">⚙</button>'
        : '<span aria-hidden="true"></span>'}
    </div>
    <header class="profile-header">
      <img class="profile-avatar" src="${escapeHtml(user.avatar)}" alt="${escapeHtml(user.name)} profile photo" />
      <div class="profile-details">
        <div class="profile-name-row">
          <div><h3>${escapeHtml(user.name)}</h3></div>
          ${isOwnProfile
        ? '<button class="profile-action" type="button" data-edit-profile>Edit profile</button>'
        : `<button class="profile-action ${user.isFollowing ? "secondary" : ""}" type="button" data-follow-kind="account" data-follow-value="${escapeHtml(state.profileHandle)}" aria-pressed="${user.isFollowing}" ${state.blockedHandles.has(state.profileHandle) ? 'disabled' : ''}>${state.followRequests.includes(state.profileHandle) ? 'Cancel request' : user.isFollowing ? 'Following' : 'Follow'}</button><button class="profile-block-button" type="button" data-account-block="${escapeHtml(state.profileHandle)}" ${state.blockedHandles.has(state.profileHandle) ? 'disabled' : ''}>${state.blockedHandles.has(state.profileHandle) ? 'Blocked' : 'Block'}</button>`}
        </div>
        <div class="profile-stats">
          <span><strong>${ownPosts.length}</strong><span>posts</span></span>
          <span><strong>${user.followers}</strong><span>followers</span></span>
          <span><strong>${user.following}</strong><span>following</span></span>
        </div>
        <p>${escapeHtml(user.bio)}</p>
        <div class="profile-links">${(user.links || []).map(link => `<button type="button" data-profile-link="${escapeHtml(link)}">${escapeHtml(link)}</button>`).join('')}</div>
        ${isOwnProfile ? `<button class="profile-create-button" type="button" aria-label="Create a post or reel"><span aria-hidden="true">+</span> post</button><button class="profile-drafts-button" type="button" data-profile-section="drafts" aria-pressed="${state.activeProfileSection==='drafts'}">Drafts · ${drafts.length}</button>` : ""}
      </div>
    </header>
    ${accessible ? '' : `<p class="private-profile-note">${state.blockedHandles.has(state.profileHandle) ? 'This account is blocked. Unblock it from Settings to restore search and request access.' : 'This account is private. Send a follow request to view their profile photo and content.'}</p>`}
    ${canViewHighlights ? renderProfileHighlights(state.profileHandle, isOwnProfile) : ""}
    <nav class="profile-section-tabs" aria-label="Profile sections">
      <button class="profile-section-tab ${state.activeProfileSection === "posts" ? "active" : ""}" type="button" data-profile-section="posts" aria-pressed="${state.activeProfileSection === "posts"}">Posts</button>
      <button class="profile-section-tab ${state.activeProfileSection === "reels" ? "active" : ""}" type="button" data-profile-section="reels" aria-pressed="${state.activeProfileSection === "reels"}">Reels</button>
      ${isOwnProfile ? `<button class="profile-section-tab ${state.activeProfileSection === "saved" ? "active" : ""}" type="button" data-profile-section="saved" aria-pressed="${state.activeProfileSection === "saved"}">Saved <span>${savedCollection.length}</span></button>` : ""}
      <button class="profile-section-tab ${state.activeProfileSection === "tags" ? "active" : ""}" type="button" data-profile-section="tags" aria-pressed="${state.activeProfileSection === "tags"}">Tags</button>
    </nav>
    <section class="profile-section-content" data-profile-content="posts" ${state.activeProfileSection === "posts" ? "" : "hidden"}>
      <div class="media-grid profile-media-grid">
        ${ownPosts.length ? ownPosts.map((post) => `<article class="profile-media-tile" data-profile-media-type="post" data-profile-media-id="${post.id}" tabindex="0" role="button" aria-label="View ${escapeHtml(post.user)}'s post">${renderProfileMedia("post", post)}</article>`).join("") : '<p class="empty-profile-posts">No posts yet.</p>'}
      </div>
    </section>
    <section class="profile-section-content" data-profile-content="reels" ${state.activeProfileSection === "reels" ? "" : "hidden"}>
      <div class="media-grid profile-media-grid">
        ${ownReels.length ? ownReels.map((reel) => `<article class="profile-media-tile" data-profile-media-type="reel" data-profile-media-id="${reel.id}" tabindex="0" role="button" aria-label="View ${escapeHtml(reel.user)}'s reel">${renderProfileMedia("reel", reel)}</article>`).join("") : '<p class="empty-profile-posts">No reels yet.</p>'}
      </div>
    </section>
    ${isOwnProfile ? `<section class="profile-section-content" data-profile-content="saved" ${state.activeProfileSection === "saved" ? "" : "hidden"}>
      <div class="media-grid profile-media-grid">
        ${savedCollection.length ? savedCollection.map(({ type, entity }) => renderSavedTile(type, entity)).join("") : '<p class="empty-profile-posts">Posts and reels you save will appear here.</p>'}
      </div>
    </section>` : ""}
    ${isOwnProfile?`<section class="profile-section-content" data-profile-content="drafts" ${state.activeProfileSection==='drafts'?'':'hidden'}><h3>Drafts</h3><p>Saved on this device for 7 days from the last save.</p><div class="media-grid profile-draft-grid">${drafts.length?drafts.map(draft=>`<button type="button" class="profile-draft-tile" data-resume-draft="${escapeHtml(draft.id)}">${draft.thumbnail?`<img src="${escapeHtml(draft.thumbnail)}" alt="Draft preview" />`:draft.items[0]?.type==='image'?`<img src="${escapeHtml(draft.items[0].url)}" alt="Draft preview" />`:'<span aria-hidden="true">▶</span>'}<strong>${escapeHtml(draft.caption||'Untitled '+draft.type)}</strong><span>Continue editing</span></button>`).join(''):'<p>No drafts yet.</p>'}</div></section>`:''}
    <section class="profile-section-content" data-profile-content="tags" ${state.activeProfileSection === "tags" ? "" : "hidden"}>
      <div class="media-grid profile-media-grid">
        ${[...taggedPosts.map((post) => ({ type: "post", entity: post })), ...taggedReels.map((reel) => ({ type: "reel", entity: reel }))]
        .map(({ type, entity }) => `<article class="profile-media-tile" data-profile-media-type="${type}" data-profile-media-id="${entity.id}" tabindex="0" role="button" aria-label="View ${escapeHtml(entity.user)}'s ${type}">${renderProfileMedia(type, entity)}</article>`).join("")
        || '<p class="empty-profile-posts">Photos and reels you are tagged in will appear here.</p>'}
      </div>
    </section>
  `;
}

export function canManageProfileMedia(type, entity, control) {
    return mayInteract() && canViewMedia(entity) && !profilePostViewer.hidden &&
        profilePostViewerContent.contains(control) &&
        state.profileHandle === currentUser.handle &&
        entity.handle === currentUser.handle &&
        (type === "post" || type === "reel");
}

export function openMediaEditor(type, entity) {
    if (!mayInteract() || !canViewMedia(entity)) return;
    const card = profilePostViewerContent.querySelector(`[data-id="${entity.id}"]`);
    state.activeMediaEdit = {
        type,
        id: entity.id,
        trigger: card?.querySelector('[data-action="post-options"]') || null
    };
    document.getElementById("media-edit-title").textContent = type === "reel" ? "Edit reel" : "Edit post";
    document.getElementById("media-edit-location").value = entity.location || "";
    document.getElementById("media-edit-caption").value = entity.caption || "";
    document.getElementById('media-edit-cover').value = '';
    document.getElementById('media-edit-cover-x').value = 50;
    document.getElementById('media-edit-cover-y').value = 50;
    const preview = document.querySelector('.media-edit-cover-preview');
    preview.hidden = !entity.cover;
    preview.replaceChildren();
    if (entity.cover) { const image = document.createElement('img'); image.src = entity.cover; image.alt = 'Current square thumbnail'; preview.append(image); }
    mediaEditBackdrop.hidden = false;
    document.body.classList.add("media-edit-open");
    document.getElementById("media-edit-location").focus();
}

export function closeMediaEditor() {
    mediaEditBackdrop.hidden = true;
    const previewImage = document.querySelector('.media-edit-cover-preview img');
    if (previewImage?.src.startsWith('blob:')) URL.revokeObjectURL(previewImage.src);
    document.querySelector('.media-edit-cover-preview').replaceChildren();
    document.querySelector('.media-edit-cover-preview').hidden = true;
    const trigger = state.activeMediaEdit?.trigger;
    state.activeMediaEdit = null;
    document.body.classList.remove("media-edit-open");
    if (trigger?.isConnected)
        trigger.focus();
}

export function openMediaDeleteConfirmation(type, entity, { fromHome = false } = {}) {
    if (!mayInteract() || !canViewMedia(entity) || entity.handle!==currentUser.handle) return;
    state.activeMediaDelete = { type, id: entity.id, origin:fromHome?'home':'profile' };
    document.getElementById("media-delete-title").textContent = type === "reel" ? "Remove reel?" : "Remove post?";
    document.getElementById("media-delete-message").textContent = "Move it to drafts to keep editing, or delete it permanently. Either choice removes it from your published posts.";
    mediaDeleteBackdrop.hidden = false;
    document.getElementById("media-delete-cancel").focus();
}

export function closeMediaDeleteConfirmation() {
    mediaDeleteBackdrop.hidden = true;
    state.activeMediaDelete = null;
}

export function updateProfileMediaAfterEdit(type, id) {
    renderProfile();
    const trigger = document.querySelector(`#profile-view [data-profile-media-type="${type}"][data-profile-media-id="${id}"]`);
    state.activeProfileMediaTrigger = trigger;
    renderProfileViewerAt(type, id);
}

export function deleteProfileMedia(type, id, { fromHome = false } = {}) {
    if (!mayInteract()) return false;
    const entity = findEntity(type, id);
    if (!entity || entity.handle !== currentUser.handle || (fromHome ? state.currentView!=='home' : state.profileHandle !== currentUser.handle))
        return false;
    const collection = type === "reel" ? reels : posts;
    const previousIndex = getProfileMediaCollection().findIndex((item) => item.type === type && item.entity.id === id);
    const entityIndex = collection.findIndex((item) => item.id === id);
    if (entityIndex < 0)
        return false;
    collection.splice(entityIndex, 1);
    state.savedItems.delete(getSavedItemKey(type, id));
    const persisted = persistSavedItems();
    if(fromHome){setView('home');showShareFeedback(persisted?'Your post was deleted.':"Your post was deleted, but saved collection storage couldn't be updated.");return true;}
    renderProfile();
    const nextCollection = getProfileMediaCollection();
    if (!nextCollection.length) {
        state.activeProfileMediaTrigger = null;
        closeProfileMedia();
        showShareFeedback(persisted ? "Your media was deleted." : "Your media was deleted, but saved collection storage couldn't be updated.");
        return true;
    }
    const nextItem = nextCollection[Math.min(Math.max(previousIndex, 0), nextCollection.length - 1)];
    state.activeProfileMediaTrigger = document.querySelector(`#profile-view [data-profile-media-type="${nextItem.type}"][data-profile-media-id="${nextItem.entity.id}"]`);
    renderProfileViewerAt(nextItem.type, nextItem.entity.id);
    showShareFeedback(persisted ? "Your media was deleted." : "Your media was deleted, but saved collection storage couldn't be updated.");
    return true;
}

export function draftFromPublishedMedia(type, entity, now=Date.now()) {
    const items=entity.mediaItems?.length?entity.mediaItems.map(item=>({...item})):[{type:type==='reel'||entity.mediaType==='video'?'video':'image',url:type==='reel'?entity.video:entity.mediaType==='video'?entity.videoUrl:entity.media,fit:'contain',x:50,y:50,ratio:'original',layout:type==='reel'?'reel':'post'}];
    return {id:`draft-${type}-${entity.id}-${now}`,type,savedAt:now,sourceId:entity.id,items,coverIndex:Math.min(entity.coverIndex||0,items.length-1),caption:entity.caption||'',location:entity.location||'',tags:(entity.taggedUsers||entity.taggedHandles||[]).join(','),thumbnail:entity.cover||entity.poster||'',schedule:''};
}
export async function movePublishedMediaToDraft(type,id,{fromHome=false}={}) {
    if(!mayInteract()||state.movingMediaToDraft)return false;
    const entity=findEntity(type,id);
    if(!entity||entity.handle!==currentUser.handle||!canViewMedia(entity)||(fromHome?state.currentView!=='home':state.profileHandle!==currentUser.handle))return false;
    const collection=type==='reel'?reels:posts,index=collection.indexOf(entity),previousDrafts=state.draftItems;
    if(index<0)return false;
    state.movingMediaToDraft=true;
    state.draftItems=[...unexpiredDrafts(previousDrafts),draftFromPublishedMedia(type,entity)];collection.splice(index,1);
    try {await persistSession();}
    catch {collection.splice(index,0,entity);state.draftItems=previousDrafts;state.movingMediaToDraft=false;showShareFeedback('Could not save the draft. Your published post is unchanged.');return false;}
    state.movingMediaToDraft=false;state.savedItems.delete(getSavedItemKey(type,id));persistSavedItems();
    closeProfileMedia();setView(state.currentView);
    showShareFeedback('Moved to drafts. Find it on your profile; saved for 7 days.');return true;
}
