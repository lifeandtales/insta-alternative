import { setView } from '../core/navigation.js';
import { state } from '../core/state.js';
import { conversations, currentUser } from '../data/sample-data.js';
import { getAccount, canViewStory } from '../core/social.js';
import { escapeHtml } from '../core/utils.js';
import { persistPreferences } from '../storage/preferences.js';
import { openStoryGroup, showStoryAtIndex } from './stories.js';
import { storyComposition } from './story-composition.js';
import { persistSession } from '../storage/local-session.js';
import { showShareFeedback } from '../components/feedback.js';

let trigger;


const notificationTimestamp=item=>{
    const timestamp=Number(item.createdAt)||0;
    return timestamp>0&&Number.isFinite(new Date(timestamp).getTime())?timestamp:0;
};
export function formatNotificationAge(createdAt,now=Date.now()){
    const timestamp=notificationTimestamp({createdAt});
    if(!timestamp)return '';
    const seconds=Math.max(0,Math.floor((now-timestamp)/1000));
    if(seconds<60)return 'Just now';
    const minutes=Math.floor(seconds/60);
    if(minutes<60)return `${minutes} ${minutes===1?'minute':'minutes'} ago`;
    const hours=Math.floor(minutes/60);
    if(hours<24)return `${hours} ${hours===1?'hour':'hours'} ago`;
    const days=Math.floor(hours/24);
    return `${days} ${days===1?'day':'days'} ago`;
}
function notificationTime(item){
    const timestamp=notificationTimestamp(item);
    return timestamp?`<time class="notification-time" datetime="${new Date(timestamp).toISOString()}">${formatNotificationAge(timestamp)}</time>`:'';
}
function renderNotificationItem(item){
    let thumbnail='';
    if(item.storyId){
        const story=state.stories.find(story=>story.id===item.storyId);
        const available=story&&canViewStory(story)&&(!story.expiresAt||story.expiresAt>Date.now());
        const preview=available?story:(item.recipient===currentUser.handle&&item.storyPreview?.owner===currentUser.handle?item.storyPreview:null);
        const image=preview&&(preview.type==='video'?preview.poster:preview.media);
        const label=available?`View story: ${item.text}`:'Story unavailable';
        const content=image?`<img src="${escapeHtml(image)}" alt="" loading="lazy" />`:preview?.type==='video'&&preview.media?`<video src="${escapeHtml(preview.media)}" muted playsinline preload="metadata" aria-hidden="true"></video>`:`<span aria-hidden="true">${available?'▶':'◷'}</span>`;
        thumbnail=`<button type="button" class="notification-story-link" data-story-notice="${escapeHtml(item.storyId)}" aria-label="${escapeHtml(label)}" ${available?'':'disabled'}>${content}</button>`;
    }
    return `<li class="notification-card"><div class="notification-copy"><div class="notification-item-heading"><strong>${escapeHtml(item.title)}</strong>${notificationTime(item)}</div><p>${escapeHtml(item.text)}</p></div>${thumbnail}</li>`;
}

export function availableLocalNotifications() {
    if (state.deletionRequestedAt) return [];
    const requests = state.incomingFollowRequests.filter(handle => !state.blockedHandles.has(handle)).map(handle => ({
        createdAt: 0, title: 'Follow request', text: `${getAccount(handle)?.name || handle} requested to follow you.`
    }));
    const unread = conversations.filter(chat => chat.unread && !state.blockedHandles.has(chat.handle)
        && (!chat.isGroup || chat.members?.includes(currentUser.handle))).map(chat => ({
        createdAt: Math.max(0,...(chat.messages||[]).filter(message=>message.from==='them').map(message=>Number(message.sentAt)||0)) || chat.lastActivity || 0, title: 'Unread conversation', text: `You have unread messages in ${chat.user || chat.handle}.`
    }));
    const approvals = (state.localApprovalNotices || []).filter(notice => notice.recipient === currentUser.handle).map(notice => ({
        createdAt: notice.createdAt || 0, title: 'Follow request approved', text: 'A follow request was approved in this local preview.'
    }));
    const storyLikes = (state.localStoryNotifications || []).filter(notice => notice.recipient === currentUser.handle && !state.blockedHandles.has(notice.actor)).sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0)).map(notice => ({
        ...notice,
        title: notice.kind === 'story-mention' ? 'Story mention' : 'Story like',
        text: notice.kind === 'story-mention' ? `${notice.actorName || notice.actor} mentioned you in their story.` : `${notice.actorName || notice.actor} liked your story.`
    }));
    return [...storyLikes, ...requests, ...unread, ...approvals].sort((left,right)=>notificationTimestamp(right)-notificationTimestamp(left));
}

export function recordStoryMentions(story) {
    if (!story?.id || !story.handle || state.deletionRequestedAt || state.blockedHandles.has(story.handle) || (story.expiresAt && story.expiresAt <= Date.now())) return 0;
    const recipients = new Set();
    for (const layer of storyComposition(story.edits).layers) {
        if (layer.type !== 'text') continue;
        const written = new Set((String(layer.text || '').match(/@[a-zA-Z0-9._]+/g) || []).map(handle => handle.toLowerCase()));
        for (const mention of layer.mentions || []) {
            const account = getAccount(mention.handle);
            if (account && written.has(account.handle.toLowerCase()) && account.handle !== story.handle && !state.blockedHandles.has(account.handle) && canViewStory(story, account.handle)) recipients.add(account.handle);
        }
    }
    let created = 0;
    state.localStoryNotifications ||= [];
    for (const recipient of recipients) {
        if (story.handle !== currentUser.handle && recipient !== currentUser.handle) continue;
        const incoming = recipient === currentUser.handle;
        const contactHandle = incoming ? story.handle : recipient;
        const account = getAccount(contactHandle);
        let chat = conversations.find(item => item.handle === contactHandle && !item.isGroup);
        if (!chat) {
            chat = { handle: contactHandle, user: account?.name || story.user || contactHandle, avatar: account?.avatar || story.avatar, messages: [] };
            conversations.push(chat);
        }
        chat.messages ||= [];
        if (!chat.messages.some(message => message.type === 'story-mention' && message.storyId === story.id && message.recipient === recipient)) {
            chat.messages.push({ id: `mention-${story.id}-${recipient}`, type: 'story-mention', storyId: story.id, recipient, actor: story.handle, from: incoming ? 'them' : 'me', sentAt: Date.now() });
            chat.lastActivity = Date.now();
            chat.lastMessage = incoming ? 'Mentioned you in a story' : `You mentioned ${recipient} in your story`;
            chat.unread = incoming && !(state.currentView === 'messages' && state.activeConversationHandle === chat.handle);
            created++;
        }
        if (!state.localStoryNotifications.some(notice => notice.kind === 'story-mention' && notice.storyId === story.id && notice.recipient === recipient)) {
            state.localStoryNotifications.push({ kind: 'story-mention', recipient, storyId: story.id, actor: story.handle, actorName: story.user || story.handle, createdAt: Date.now(), read: false });
            created++;
        }
    }
    if (created) {
        persistPreferences();
        persistSession().catch(() => showShareFeedback('The Story mention could not be saved on this device.'));
        updateNotificationBadge();
    }
    return created;
}

export function syncIncomingStoryMentions() {
    state.stories.filter(story => story.handle !== currentUser.handle).forEach(recordStoryMentions);
}

function storyNotificationPreview(story){
    return {owner:story.handle,type:story.type,media:story.media,poster:story.poster||''};
}
function saveNotificationPreviews(){
    persistPreferences();
    persistSession().catch(()=>showShareFeedback('The notification preview could not be saved on this device.'));
}

// Called by an incoming like event; this preview has no connected service that can generate one yet.
export function recordIncomingStoryLike(story, actor) {
    if (!story || story.handle !== currentUser.handle || !actor?.handle || actor.handle === currentUser.handle) return false;
    state.localStoryNotifications ||= [];
    if (state.localStoryNotifications.some(item => (item.kind || 'story-like') === 'story-like' && item.storyId === story.id && item.actor === actor.handle)) return false;
    state.localStoryNotifications.push({ recipient: currentUser.handle, storyId: story.id, actor: actor.handle,
        actorName: actor.name || actor.handle, createdAt: Date.now(), read: false, storyPreview:storyNotificationPreview(story) });
    saveNotificationPreviews();
    updateNotificationBadge();
    return true;
}

function ensureDemoStoryLike() {
    const ownStory=state.stories.find(story=>story.handle===currentUser.handle&&!story.fromHighlight&&(!story.expiresAt||story.expiresAt>Date.now()));
    if(!ownStory)return;
    state.localStoryNotifications ||= [];
    // Repair obsolete sample cards without changing real notification history.
    state.localStoryNotifications=state.localStoryNotifications.filter(notice=>!notice.demo||notice.recipient!==currentUser.handle||state.stories.some(story=>story.id===notice.storyId));
    const existing=state.localStoryNotifications.find(notice=>notice.demo&&notice.recipient===currentUser.handle);
    if(existing){
        const original=state.stories.find(story=>story.id===existing.storyId);
        if(original&&!existing.storyPreview){existing.storyPreview=storyNotificationPreview(original);saveNotificationPreviews();}
        return;
    }
    state.localStoryNotifications.push({recipient:currentUser.handle,storyId:ownStory.id,actor:'@aribloom',actorName:'Ari Bloom',createdAt:Date.now(),read:false,demo:true,storyPreview:storyNotificationPreview(ownStory)});
    saveNotificationPreviews();
}

export function updateNotificationBadge() {
    const badge = document.querySelector('.home-notifications .notification-badge');
    if (!badge) return;
    const count = (state.localStoryNotifications || []).filter(notice => notice.recipient === currentUser.handle && !notice.read).length;
    badge.hidden = count === 0;
    badge.textContent = count ? (count > 9 ? '9+' : String(count)) : '';
    document.querySelector('.home-notifications')?.setAttribute('aria-label', count ? `Notifications, ${count} unread` : 'Notifications');
}

export function restoreNotificationFocus(){
    trigger?.setAttribute('aria-expanded','false');
    if(!state.deletionRequestedAt&&trigger?.isConnected)trigger.focus();
    trigger=null;
}

export function closeNotifications(){
    if(state.currentView!=='notifications'||state.deletionRequestedAt)return;
    window.history.back();
}

export function openNotifications(button){
    if(state.deletionRequestedAt)return;
    trigger=button;
    trigger?.setAttribute('aria-expanded','true');
    setView('notifications');
}

export function renderNotificationsPage(){
    if(state.deletionRequestedAt)return;
    ensureDemoStoryLike();
    updateNotificationBadge();
    const items = availableLocalNotifications();
    document.querySelector('.notifications-content').innerHTML = items.length
        ? `<ul class="notification-list">${items.map(renderNotificationItem).join('')}</ul>`
        : '<div class="notification-empty"><strong>You’re all caught up.</strong><p>No notifications are available in this local preview.</p></div>';
    document.getElementById('notifications-title').focus();
    let changed=false;
    for(const notice of state.localStoryNotifications || []){
        if(notice.recipient===currentUser.handle && !notice.read){notice.read=true;changed=true;}
    }
    if(changed)persistPreferences();
    updateNotificationBadge();
}

export function registerNotificationEvents() {
    const page = document.getElementById('notifications-page');
    updateNotificationBadge();
    page.addEventListener('click', event => {
        const storyLink = event.target.closest('[data-story-notice]');
        if (storyLink) {
            const storyId = storyLink.dataset.storyNotice;
            const notices = (state.localStoryNotifications || []).filter(item => item.storyId === storyId && item.recipient === currentUser.handle);
            notices.forEach(notice => { notice.read = true; });
            if (notices.length) persistPreferences();
            updateNotificationBadge();
            const story = state.stories.find(item => item.id === storyId);
            if (!story || !canViewStory(story) || story.expiresAt <= Date.now()) { showShareFeedback('This Story is no longer available.'); return; }
            openStoryGroup(story.handle, { allowUnfollowed: true });
            const index = state.activeStorySequence.findIndex(item => item.id === storyId);
            if (index >= 0) showStoryAtIndex(index);
            return;
        }
        if (event.target.closest('.notifications-close')) closeNotifications();
    });
    document.addEventListener('keydown', event => {
        if(state.currentView!=='notifications')return;
        if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();closeNotifications();}
    }, true);
    document.addEventListener('account-deletion-lock', closeNotifications);
}
