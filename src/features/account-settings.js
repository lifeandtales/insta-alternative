import { state } from '../core/state.js';
import { currentUser, posts, reels } from '../data/sample-data.js';
import { escapeHtml } from '../core/utils.js';
import { canViewMedia, getAccount, mayInteract } from '../core/social.js';
import { showHomePanel, openHomeSettings } from './home-controls.js';
import { renderProfile, openProfileMedia } from './profile.js';
import { setEntityLiked } from './likes.js';
import { showShareFeedback } from '../components/feedback.js';
import { persistPreferences } from '../storage/preferences.js';
import { persistSession } from '../storage/local-session.js';
import { persistStoryHighlights, persistActiveStories } from '../storage/browser-storage.js';
import { updateOwnProfile, updateOwnAvatar, setAccountPrivacy, setAccountBlocked, respondToFollowRequest, removeFollower } from './account-model.js';
import { syncDeletionLock } from '../core/account-lock.js';
import { refreshEntityComments } from './comments.js';

const closePanel = () => { document.querySelector('.home-controls-backdrop').hidden = true; };
let cropImage;
function saveAccountChanges() {
    const stored = persistPreferences();
    persistSession().catch(() => showShareFeedback('Content changes could not be saved on this device.'));
    persistStoryHighlights().catch(() => {}); persistActiveStories().catch(() => {});
    document.querySelectorAll('.profile-nav-button img, .profile-card img, .mini-avatar-wrap img, .desktop-profile-button img').forEach(image => { image.src = currentUser.avatar; });
    if (state.currentView === 'profile') renderProfile();
    if (!stored) showShareFeedback('Account changes could not be saved on this device.');
}
export function openAccountSettings() {
    if (syncDeletionLock()) return;
    const pending = state.verificationStatus !== 'approved';
    showHomePanel('Settings', `<div class="settings-menu"><p class="settings-account">${escapeHtml(currentUser.name)} <small>${escapeHtml(currentUser.handle)}</small></p>${state.deletionRequestedAt ? deletionNotice() : ''}<button type="button" data-settings-page="verification">Verification · ${pending ? 'Pending' : 'Approved demo account'}</button>${pending ? '<p>You can browse accessible content and Stories while review is pending. Social actions become available after approval.</p>' : `<button type="button" data-edit-profile>Edit profile</button><button type="button" data-settings-page="privacy">Account privacy and followers</button><button type="button" data-settings-page="friends">Close Friends and muted accounts</button><button type="button" data-settings-page="activity">Your Activity</button><button type="button" data-settings-page="blocked">Blocked accounts</button><button type="button" data-settings-page="groups">Group invitations</button><button type="button" data-settings-page="audience">Creator audience</button><button type="button" data-settings-page="deletion">${state.deletionRequestedAt ? 'Cancel deletion request' : 'Delete account'}</button>`}<button type="button" data-settings-page="help">Help</button><button type="button" data-preview-logout>Log out of preview</button></div>`);
}
function deletionNotice() {
    const end = new Date(state.deletionRequestedAt + 15 * 86400000);
    return `<div class="settings-notice"><strong>Deletion request pending</strong><p>The 15-day grace period ends ${escapeHtml(end.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'long', year: 'numeric' }))}. Opening the preview does not cancel it.</p><p>This is a local workflow. No server account is being deleted.</p></div>`;
}
function openProfileEditor() {
    if (!mayInteract()) { showShareFeedback('Profile editing is unavailable in the current account state.'); return; }
    const currentUsername = currentUser.handle.slice(1);
    const currentUsernameIsLegacy = !/^[a-zA-Z0-9._]{8,20}$/.test(currentUsername);
    const usernameMin = currentUsernameIsLegacy ? Math.min(8, currentUsername.length) : 8;
    const usernameMax = currentUsernameIsLegacy ? Math.max(20, currentUsername.length) : 20;
    const usernamePattern = currentUsernameIsLegacy ? '[a-zA-Z0-9._]{1,35}' : '[a-zA-Z0-9._]{8,20}';
    showHomePanel('Edit profile', `<form class="account-profile-form"><label>Display name<input name="displayName" maxlength="100" required value="${escapeHtml(currentUser.name)}" /></label><label>Username<input name="username" minlength="${usernameMin}" maxlength="${usernameMax}" pattern="${usernamePattern}" required value="${escapeHtml(currentUsername)}" /></label><p>New usernames must contain 8–20 letters, numbers, dots or underscores; no particular character mix is required. Spaces and other whitespace are not allowed. Your current username can stay unchanged. ${5 - state.usernameChanges} of five lifetime username changes remain. A former username is held for you for one day. Reclaiming it counts as a username change. Availability is checked against local demo accounts.</p><label>Bio (optional)<textarea name="bio" rows="4">${escapeHtml(currentUser.bio || '')}</textarea></label><small class="bio-character-count">${[...(currentUser.bio || '')].length}/200 characters</small><label>Links (up to five, one per line)<textarea name="links" rows="3" placeholder="https://example.com">${escapeHtml((currentUser.links || []).join('\n'))}</textarea></label><button type="submit">Save profile</button><button type="button" data-settings-page="photo">Change profile photo</button></form>`);
}
function openPrivacySettings() {
    const owner = getAccount(currentUser.handle);
    showHomePanel('Account privacy and followers', `<label><input type="checkbox" data-private-account ${currentUser.isPrivate ? 'checked' : ''} /> Private account</label><p>Existing followers remain when you switch to private. New people must be approved before viewing your photo and content.</p><h3>Follow requests</h3>${state.incomingFollowRequests.map(handle => `<div class="settings-person"><span>${escapeHtml(getAccount(handle)?.name || handle)}</span><button type="button" data-follow-request="accept" data-handle="${escapeHtml(handle)}">Accept</button><button type="button" data-follow-request="decline" data-handle="${escapeHtml(handle)}">Decline</button></div>`).join('') || '<p>No pending requests.</p>'}<h3>Followers</h3>${(owner?.followers || []).map(handle => `<div class="settings-person"><span>${escapeHtml(getAccount(handle)?.name || handle)}</span><button type="button" data-remove-follower="${escapeHtml(handle)}">Remove</button></div>`).join('') || '<p>No followers.</p>'}`);
}
function openActivity() {
    const media = [...posts.map(entity => ({ type: 'post', entity })), ...reels.map(entity => ({ type: 'reel', entity }))].filter(item => canViewMedia(item.entity));
    const liked = media.filter(item => item.entity.liked);
    const comments = media.flatMap(item => (item.entity.commentItems || []).filter(comment => comment.handle === currentUser.handle).map(comment => ({ ...item, comment })));
    showHomePanel('Your Activity', `<h3>Liked posts and Reels</h3>${liked.map(({type, entity}) => `<div class="activity-row"><button type="button" data-activity-open="${entity.id}" data-type="${type}">${escapeHtml(entity.user)} · ${type}</button><button type="button" data-activity-unlike="${entity.id}" data-type="${type}">Unlike</button></div>`).join('') || '<p>No accessible liked posts.</p>'}<h3>Your comments</h3>${comments.map(({ type, entity, comment }) => `<div class="activity-row"><p>${escapeHtml(comment.text)}</p><button type="button" data-activity-delete-comment="${escapeHtml(String(comment.id))}" data-entity-id="${entity.id}" data-type="${type}">Delete your comment</button></div>`).join('') || '<p>No comments to show.</p>'}`);
}
function openBlockedAccounts() {
    showHomePanel('Blocked accounts', `<p>Blocked chats stay in your inbox. New messages and interactions stay paused until you unblock. Unblocking does not restore following.</p>${[...state.blockedHandles].map(handle => `<div class="settings-person"><span>${escapeHtml(getAccount(handle)?.name || handle)}</span><button type="button" data-account-unblock="${escapeHtml(handle)}">Unblock</button></div>`).join('') || '<p>No blocked accounts.</p>'}`);
}
function openPhotoEditor() {
    if (!mayInteract()) return;
    cropImage = null;
    showHomePanel('Profile photo', `<form class="account-photo-form"><label>Choose photo<input name="photo" type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" /></label><p>Up to 20 MB. JPG, PNG and WebP work in supported browsers. HEIC/HEIF can be used only when this browser can decode it.</p><canvas class="avatar-crop-preview" width="360" height="360" hidden></canvas><div class="avatar-crop-controls" hidden><label>Horizontal position<input name="cropX" type="range" min="0" max="100" value="50" /></label><label>Vertical position<input name="cropY" type="range" min="0" max="100" value="50" /></label><label>Zoom<input name="cropZoom" type="range" min="1" max="3" step="0.05" value="1" /></label></div><div class="panel-actions"><button type="submit">Save photo</button><button type="button" data-remove-avatar>Remove photo</button></div></form>`);
}
function drawCrop(canvas, image, form) {
    const size = Math.min(image.naturalWidth, image.naturalHeight) / Number(form.elements.cropZoom.value);
    const x = (image.naturalWidth - size) * Number(form.elements.cropX.value) / 100;
    const y = (image.naturalHeight - size) * Number(form.elements.cropY.value) / 100;
    canvas.getContext('2d').drawImage(image, x, y, size, size, 0, 0, canvas.width, canvas.height);
}
function openSettingsPage(page) {
    if (page === 'privacy') openPrivacySettings();
    if (page === 'friends') openHomeSettings();
    if (page === 'activity') openActivity();
    if (page === 'blocked') openBlockedAccounts();
    if (page === 'photo') openPhotoEditor();
    if (page === 'groups') showHomePanel('Group invitations', `<label>When someone adds you to a group<select data-group-preference><option value="automatic" ${state.groupJoinMode === 'automatic' ? 'selected' : ''}>Join directly (default)</option><option value="review" ${state.groupJoinMode === 'review' ? 'selected' : ''}>Review invitation first</option></select></label><p>With review enabled, group history stays hidden until you accept. This preference applies to invitations sent to you.</p>`);
    if (page === 'audience') showHomePanel('Creator audience', `<p>Current audience: <strong>${state.contentAudience === 'adult' ? '18+' : 'All ages'}</strong></p>${state.audienceReview ? `<p>A change to ${state.audienceReview.requested === 'adult' ? '18+' : 'All ages'} is pending review. Your current audience remains active. Automated and admin review services are not connected in this preview.</p>` : `<form class="audience-request-form"><label>Request audience change<select name="audience"><option value="all" ${state.contentAudience === 'all' ? 'selected' : ''}>All ages</option><option value="adult" ${state.contentAudience === 'adult' ? 'selected' : ''}>18+</option></select></label><button type="submit">Request review</button></form>`}`);
    if (page === 'verification') showHomePanel('Verification', `<p>Status: <strong>${state.verificationStatus === 'approved' ? 'Approved demo account' : 'Pending review'}</strong></p><p>No identity review service is connected to this local preview. Do not upload real identity documents.</p>${state.verificationStatus !== 'approved' ? '<button type="button" data-verification-resubmit>Correct or resubmit demo request</button><p>Your request will stay pending until a real review system is available.</p>' : ''}`);
    if (page === 'help') showHomePanel('Help', '<p>This is a local social-app preview. Account review, reports, connected calls and message delivery need future services.</p><p>While verification is pending, browse accessible content and Stories, check status, correct a demo request, or log out. No real ID documents or passwords are needed here.</p>');
    if (page === 'deletion') showHomePanel(state.deletionRequestedAt ? 'Cancel deletion request' : 'Delete account', `${state.deletionRequestedAt ? deletionNotice() : '<p>Request account deletion with a 15-day grace period. During that time, cancellation requires password re-entry.</p><p>This preview records the request locally; it does not authenticate you or delete a server account.</p>'}<form class="account-deletion-form"><label><input type="checkbox" name="confirmed" required /> ${state.deletionRequestedAt ? 'I want to cancel the deletion request.' : 'I understand the deletion request and grace period.'}</label><label>Demo password<input type="password" name="password" required autocomplete="off" /></label><p>For this local flow, enter <strong>demo-password</strong>. Never enter a real password.</p><button type="submit">${state.deletionRequestedAt ? 'Cancel deletion request' : 'Request deletion'}</button></form>`);
}
export function registerAccountSettingsEvents() {
    document.addEventListener('click', event => {
        if (event.target.closest('[data-edit-profile]')) openProfileEditor();
        const page = event.target.closest('[data-settings-page]'); if (page) openSettingsPage(page.dataset.settingsPage);
        const block = event.target.closest('[data-account-block]');
        if (block && setAccountBlocked(block.dataset.accountBlock, true)) { saveAccountChanges(); showShareFeedback('Account blocked. Chat history is kept.'); }
        const unblock = event.target.closest('[data-account-unblock]');
        if (unblock && setAccountBlocked(unblock.dataset.accountUnblock, false)) { saveAccountChanges(); openBlockedAccounts(); }
        const request = event.target.closest('[data-follow-request]');
        if (request && respondToFollowRequest(request.dataset.handle, request.dataset.followRequest === 'accept')) { saveAccountChanges(); openPrivacySettings(); }
        const remove = event.target.closest('[data-remove-follower]'); if (remove && removeFollower(remove.dataset.removeFollower)) { saveAccountChanges(); openPrivacySettings(); }
        if (event.target.closest('[data-remove-avatar]') && mayInteract()) { updateOwnAvatar(); saveAccountChanges(); closePanel(); showShareFeedback('Profile photo removed.'); }
        const external = event.target.closest('[data-profile-link]');
        if (external) {
            const url = external.dataset.profileLink;
            try { if (!['https:', 'http:'].includes(new URL(url).protocol)) return; } catch { return; }
            showHomePanel('Open external link?', `<p>This link opens in your phone's default browser. In this browser preview, it opens a new tab.</p><p class="external-url">${escapeHtml(url)}</p><div class="panel-actions"><button type="button" data-external-cancel>Cancel</button><button type="button" data-external-open="${escapeHtml(url)}">Open browser</button></div>`);
        }
        const open = event.target.closest('[data-external-open]'); if (open) { window.open(open.dataset.externalOpen, '_blank', 'noopener,noreferrer'); closePanel(); }
        if (event.target.closest('[data-external-cancel]')) closePanel();
        const activityOpen = event.target.closest('[data-activity-open]');
        if (activityOpen) { const entity = (activityOpen.dataset.type === 'reel' ? reels : posts).find(item => item.id === Number(activityOpen.dataset.activityOpen)); if (entity && canViewMedia(entity)) { closePanel(); openProfileMedia(activityOpen.dataset.type, entity.id, null); } }
        const unlike = event.target.closest('[data-activity-unlike]');
        if (unlike && mayInteract()) { const entity = (unlike.dataset.type === 'reel' ? reels : posts).find(item => item.id === Number(unlike.dataset.activityUnlike)); if (entity?.liked) setEntityLiked(unlike.dataset.type, entity, false); saveAccountChanges(); openActivity(); }
        const commentButton = event.target.closest('[data-activity-delete-comment]');
        if (commentButton && mayInteract()) {
            const entity = (commentButton.dataset.type === 'reel' ? reels : posts).find(item => item.id === Number(commentButton.dataset.entityId));
            const index = entity?.commentItems?.findIndex(comment => String(comment.id) === commentButton.dataset.activityDeleteComment && comment.handle === currentUser.handle);
            if (index >= 0) { entity.commentItems.splice(index, 1); entity.comments = Math.max(0, entity.comments - 1); refreshEntityComments(commentButton.dataset.type, entity); saveAccountChanges(); openActivity(); }
        }
        if (event.target.closest('[data-verification-resubmit]')) { state.verificationStatus = 'pending'; state.verificationResubmittedAt = Date.now(); persistPreferences(); showShareFeedback('Demo request resubmitted. Status remains pending.'); }
        if (event.target.closest('[data-preview-logout]')) showHomePanel('Signed out of local preview', '<p>No real authentication session is connected.</p><button type="button" data-preview-login>Open preview</button>');
        if (event.target.closest('[data-preview-login]')) { if (state.deletionRequestedAt) openAccountSettings(); else closePanel(); }
    });
    document.addEventListener('input', event => {
        if (event.target.name === 'bio' && event.target.closest('.account-profile-form')) document.querySelector('.bio-character-count').textContent = `${[...event.target.value].length}/200 characters`;
        const form = event.target.closest('.account-photo-form'); if (form && cropImage && event.target.type === 'range') drawCrop(form.querySelector('canvas'), cropImage, form);
    });
    document.addEventListener('change', async event => {
        if (event.target.matches('[data-private-account]')) { if (setAccountPrivacy(event.target.checked)) saveAccountChanges(); }
        if (event.target.matches('[data-group-preference]') && mayInteract()) { state.groupJoinMode = event.target.value; const owner = getAccount(currentUser.handle); if (owner) owner.groupJoinMode = state.groupJoinMode; saveAccountChanges(); }
        const form = event.target.closest('.account-photo-form'); if (!form || event.target.name !== 'photo') return;
        const file = event.target.files?.[0]; if (!file) return;
        if (file.size > 20 * 1024 * 1024 || !(/\.(jpe?g|png|webp|heic|heif)$/i.test(file.name) || ['image/jpeg','image/png','image/webp','image/heic','image/heif'].includes(file.type))) { showShareFeedback('Choose a supported image up to 20 MB.'); return; }
        const url = URL.createObjectURL(file), image = new Image();
        image.onload = () => { URL.revokeObjectURL(url); cropImage = image; form.querySelector('canvas').hidden = false; form.querySelector('.avatar-crop-controls').hidden = false; drawCrop(form.querySelector('canvas'), image, form); };
        image.onerror = () => { URL.revokeObjectURL(url); cropImage = null; showShareFeedback('This browser cannot decode that photo. Try JPG, PNG or WebP.'); };
        image.src = url;
    });
    document.addEventListener('submit', event => {
        const form = event.target;
        if (form.matches('.account-profile-form')) {
            event.preventDefault();
            const error = updateOwnProfile({ name: form.elements.displayName.value, username: form.elements.username.value, bio: form.elements.bio.value, links: form.elements.links.value.split('\n').map(link => link.trim()).filter(Boolean) });
            if (error) { showShareFeedback(error); return; } saveAccountChanges(); closePanel(); showShareFeedback('Profile saved on this device.');
        }
        if (form.matches('.account-photo-form')) {
            event.preventDefault(); if (!cropImage || !mayInteract()) { showShareFeedback('Choose a photo before saving.'); return; }
            const canvas = document.createElement('canvas'); canvas.width = 720; canvas.height = 720; drawCrop(canvas, cropImage, form);
            updateOwnAvatar(canvas.toDataURL('image/jpeg', .85)); saveAccountChanges(); closePanel(); cropImage = null;
        }
        if (form.matches('.audience-request-form')) {
            event.preventDefault(); if (!mayInteract()) return;
            if (form.elements.audience.value === state.contentAudience) { showShareFeedback('This is already your current audience.'); return; }
            state.audienceReview = { requested: form.elements.audience.value, status: 'pending', requestedAt: Date.now() }; saveAccountChanges(); openSettingsPage('audience');
        }
        if (form.matches('.account-deletion-form')) {
            event.preventDefault(); if (!form.elements.confirmed.checked || form.elements.password.value !== 'demo-password') { showShareFeedback('Confirm the action and enter the demo password shown above.'); return; }
            const cancelling = Boolean(state.deletionRequestedAt);
            if (cancelling && Date.now() - state.deletionRequestedAt >= 15 * 86400000) { showShareFeedback('The local grace period has ended. A real account service is needed for further processing.'); return; }
            state.deletionRequestedAt = cancelling ? null : Date.now(); form.reset(); saveAccountChanges(); if (!syncDeletionLock()) openAccountSettings();
        }
    });
}
