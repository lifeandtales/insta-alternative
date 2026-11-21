import { liveNotifications, loadLiveData, markLiveNoticesRead } from '../storage/live-broadcasts.js';
import { reviewCloudFollowRequest } from './cloud-people.js';
import { followNotificationActor, markHomeNotificationsRead, readHomeNotificationPage } from '../storage/cloud-home-notifications.js';
import { getUnreadMessageCount } from './messages.js';
import { captionMentions } from '../components/caption.js';
import { actionIcon } from '../components/action-icons.js';
import { openProfileMedia } from './profile.js';
import { setView } from '../core/navigation.js';
import { state } from '../core/state.js';
import { conversations, currentUser, posts, reels, demoContentEnabled } from '../data/sample-data.js';
import { getAccount, canViewStory, canViewMedia, isFollowing, mayInteract, visibleAvatar } from '../core/social.js';
import { respondToFollowRequest } from './account-model.js';
import { toggleSessionFollow } from './follows.js';
import { escapeHtml, normalizeHandle } from '../core/utils.js';
import { persistPreferences } from '../storage/preferences.js';
import { openStoryGroup, showStoryAtIndex } from './stories.js';
import { storyComposition } from './story-composition.js';
import { persistSession } from '../storage/local-session.js';
import { showShareFeedback } from '../components/feedback.js';

let trigger;
const cloudNotificationIcons = {
    post_like: 'like', story_like: 'like', post_comment: 'comment', content_mention: 'mention', content_tag: 'mention',
    follow_request: 'follow', follow_accepted: 'follow', new_follower: 'follow',
};
const emptyHistory = () => ({ owner: null, items: [], pending: [], unread: 0, total: 0, connected: false });
let history = emptyHistory();
let historyRequest = 0;
let markingRead = false;
let followRequestsExpanded = false;
let pulseTimer;
let cloudRefreshTimer;
const busyFollowActions = new Set();

export function pulseHomeNotification(icon) {
    if (state.currentView !== 'home' || document.hidden || !icon) return;
    const pulse = document.querySelector('.home-notifications .notification-pulse');
    if (!pulse) return;
    window.clearTimeout(pulseTimer);
    pulse.innerHTML = actionIcon(icon);
    pulse.hidden = false;
    pulse.animate?.([{ transform: 'translate(3px, 5px) scale(.8)', opacity: 0 }, { transform: 'translate(0, 0)', opacity: 1 }],
        { duration: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 0 : 200, easing: 'ease-out' });
    pulseTimer = window.setTimeout(() => { pulse.hidden = true; }, 1000);
}

function currentHistory() {
    return history.owner === state.signedInAccountId ? history : emptyHistory();
}

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
export function groupLikeNotifications(notices){
    const groups = new Map(), items = [];
    for(const notice of [...notices].sort((a,b)=>notificationTimestamp(b)-notificationTimestamp(a))){
        const kind=notice.kind||(notice.postId!=null?'post-like':'story-like');
        const target=kind==='post-like'?notice.postId:notice.storyId;
        if(!['story-like','post-like'].includes(kind)||target==null){items.push({...notice});continue;}
        const key = JSON.stringify([notice.recipient, kind, notice.entityType || 'post', target]);
        if (!groups.has(key)) groups.set(key, []);
        const group = groups.get(key);
        if (!notice.actor || !group.some(item => item.actor === notice.actor)) group.push({ ...notice, kind });
    }
    for (const group of groups.values()) {
        if (group[0].kind === 'post-like' && group.length <= 3) { items.push(...group); continue; }
        items.push({
            ...group[0],
            actors: group.map(item => item.actor),
            otherCount: group.length - 1,
            read: group.every(item => item.read),
            storyPreview: group.find(item => item.storyPreview)?.storyPreview,
        });
    }
    return items.sort((a, b) => notificationTimestamp(b) - notificationTimestamp(a));
}

function actorLabel(notice) {
    const name = notice.actorName || notice.actor || 'Someone';
    const count = notice.otherCount;
    return count ? `${name} and ${count} ${count === 1 ? 'other' : 'others'}` : name;
}

function describeSocialNotification(notice) {
    const name = actorLabel(notice);
    const entity = notice.entityType === 'reel' ? 'reel' : 'post';
    const [title, activity] = {
        'post-like': [entity === 'reel' ? 'Reel like' : 'Post like', `liked your ${entity}.`],
        'story-like': ['Story like', 'liked your story.'],
        'story-mention': ['Story mention', 'mentioned you in their story.'],
        'post-mention': ['Caption mention', 'mentioned you in a caption.'],
        'post-tag': ['Post tag', `tagged you in a ${entity}.`],
        'post-comment': ['Comment', `commented on your ${entity}.`],
        'follow-approved': ['Follow request approved', 'accepted your follow request.'],
        'new-follower': ['New follower', 'started following you.'],
    }[notice.kind || 'story-like'] || ['Activity', 'interacted with your content.'];
    return { ...notice, title, activity, text: `${name} ${activity}`, read: Boolean(notice.read) };
}

function describeCloudNotification(row) {
    const payload = row.payload || {};
    const entityType = payload.content_kind === 'reel' ? 'reel' : 'post';
    const collection = entityType === 'reel' ? reels : posts;
    const entity = payload.content_id
        ? collection.find(item => item.cloudContentId === payload.content_id)
        : collection.find(item => payload.post_client_id && item.cloudOwnerId === payload.post_owner
            && String(item.cloudClientId) === String(payload.post_client_id));
    const kind = {
        post_like: 'post-like', story_like: 'story-like', post_comment: 'post-comment',
        content_mention: payload.content_kind === 'story' ? 'story-mention' : 'post-mention', content_tag: 'post-tag',
        follow_request: 'new-follower', new_follower: 'new-follower', follow_accepted: 'follow-approved',
    }[row.kind];
    return describeSocialNotification({
        id: row.id, kind, actor: row.username ? '@' + row.username : null, actorName: row.display_name,
        actorId: payload.actor_id, createdAt: Date.parse(row.created_at), read: row.read,
        otherCount: Number(row.other_count) || 0, targetKey: payload.target_key, entityType, postId: entity?.id,
        storyId: payload.content_kind === 'story' ? payload.content_id : null,
        allowFollowBack: kind === 'new-follower', followBackStatus: row.follow_back_status,
    });
}

function requestsForBell() {
    if (state.signedInAccountId) return currentHistory().pending.map(row => ({
        id: row.follower_id, notificationId: row.notification_id, name: row.display_name, handle: '@' + row.username,
        createdAt: Date.parse(row.created_at), local: false,
    }));
    return state.incomingFollowRequests.filter(handle => !state.blockedHandles.has(handle)).map(handle => ({
        id: handle, name: getAccount(handle)?.name || handle, handle, createdAt: 0, local: true,
    }));
}

function renderFollowRequests(item) {
    const { pending } = item;
    return `<li class="notification-card notification-requests"><div class="notification-copy">
        <button type="button" class="notification-requests-summary" data-toggle-follow-requests aria-expanded="${followRequestsExpanded}" aria-controls="pending-notification-requests">
            ${actionIcon('follow')}<span><strong>Follow requests</strong><small>${pending.length} pending</small></span><span aria-hidden="true">›</span>
        </button>
        <ul id="pending-notification-requests" ${followRequestsExpanded ? '' : 'hidden'}>
            ${pending.map(row => `<li class="notification-request" ${row.notificationId ? `data-notification-id="${escapeHtml(row.notificationId)}"` : ''}><div><strong>${escapeHtml(row.name)}</strong><small>${escapeHtml(row.handle)}</small></div>
                <div class="notification-request-actions"><button type="button" class="notification-action" data-cloud-request="accept" data-requester="${escapeHtml(row.id)}" ${row.local ? 'data-local-request' : ''}>Confirm</button>
                <button type="button" class="notification-action subtle" data-cloud-request="decline" data-requester="${escapeHtml(row.id)}" ${row.local ? 'data-local-request' : ''}>Decline</button></div></li>`).join('')}
        </ul>
    </div></li>`;
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
    if(['post-like','post-comment','post-mention','post-tag'].includes(item.kind)&&item.postId!=null){
        const post=(item.entityType==='reel'?reels:posts).find(post=>String(post.id)===String(item.postId));
        const available=post&&canViewMedia(post);
        const preview=available?post:(item.kind==='post-like'&&item.recipient===currentUser.handle&&item.storyPreview?.owner===currentUser.handle?item.storyPreview:null);
        const image=preview?.cover||preview?.poster||preview?.media;
        thumbnail=`<button type="button" class="notification-story-link" data-post-notice="${escapeHtml(String(item.postId))}" data-notice-entity-type="${item.entityType==='reel'?'reel':'post'}" aria-label="${escapeHtml(available?`View post: ${item.text}`:'Post unavailable')}" ${available?'':'disabled'}>${image?`<img src="${escapeHtml(image)}" alt="" loading="lazy" />`:'<span aria-hidden="true">◷</span>'}</button>`;
    }
    if (item.liveId) thumbnail = `<button type="button" class="notification-live-link" data-open-live="${escapeHtml(item.liveId)}" ${item.isLive ? '' : 'disabled'}>${item.isLive ? 'Watch LIVE' : 'Live ended'}</button>`;
    const followBack = item.allowFollowBack && item.actor
        ? item.followBackStatus
            ? `<span class="notification-follow-status">${item.followBackStatus === 'accepted' ? 'Following' : 'Requested'}</span>`
            : `<button class="notification-action" type="button" data-notification-follow-back="${escapeHtml(item.actorId || item.actor)}" ${item.actorId ? '' : 'data-local-request'}>Follow back</button>`
        : '';
    const avatar = item.activity
        ? `<img class="notification-avatar" src="${escapeHtml(visibleAvatar(item.actor))}" alt="" loading="lazy" />`
        : '';
    const description = item.activity
        ? `<strong>${escapeHtml(actorLabel(item))}</strong> ${escapeHtml(item.activity)}`
        : `<strong>${escapeHtml(item.title)}</strong> ${escapeHtml(item.text)}`;
    const actions = followBack || thumbnail
        ? `<div class="notification-row-actions">${followBack}${thumbnail}</div>`
        : '';
    return `<li class="notification-card" ${item.id ? `data-notification-id="${escapeHtml(item.id)}"` : ''}>${avatar}
        <p class="notification-copy">${description} ${notificationTime(item)}</p>${actions}</li>`;
}

function renderNotificationGroup(title, items) {
    if (!items.length) return '';
    return `<section class="notification-group"><h2>${title}</h2><ul class="notification-list">${items
        .map(item => item.pending ? renderFollowRequests(item) : renderNotificationItem(item)).join('')}</ul></section>`;
}

export function availableLocalNotifications() {
    if (state.deletionRequestedAt) return [];
    const approvals = (state.localApprovalNotices || []).filter(notice => notice.recipient === currentUser.handle).map(notice => ({
        createdAt: notice.createdAt || 0, title: 'Follow request approved', text: 'A follow request was approved in this local preview.'
    }));
    const localNotices = (state.localStoryNotifications || [])
        .filter(notice => notice.recipient === currentUser.handle && !state.blockedHandles.has(notice.actor));
    const social = groupLikeNotifications(localNotices).map(notice => describeSocialNotification(notice.allowFollowBack
        ? { ...notice, followBackStatus: isFollowing(notice.actor) ? 'accepted' : state.followRequests.includes(notice.actor) ? 'requested' : null }
        : notice));
    const live = liveNotifications().map(row => ({ liveId: row.broadcast_id, isLive: row.is_live, createdAt: Date.parse(row.created_at), title: 'Live broadcast', text: `${row.display_name} ${row.is_live ? 'is live now.' : 'went live.'}` }));
    return [...live, ...social, ...approvals].sort((left,right)=>notificationTimestamp(right)-notificationTimestamp(left));
}

const noticeTarget = item => JSON.stringify([item.kind, item.actor,
    item.storyId || null, item.postId == null ? null : String(item.postId), item.entityType || 'post']);

function notificationItems() {
    const cloud = currentHistory().items.map(describeCloudNotification);
    const cloudTargets = new Set(cloud.filter(item => item.storyId || item.postId != null).map(noticeTarget));
    const pending = requestsForBell();
    const local = availableLocalNotifications().filter(item => !cloudTargets.has(noticeTarget(item)));
    const requestGroup = pending.length ? [{ pending, createdAt: pending[0].createdAt }] : [];
    return [...requestGroup, ...cloud, ...local].sort((left, right) => notificationTimestamp(right) - notificationTimestamp(left));
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
        const messageId = `mention-${story.id}-${recipient}`;
        if (state.deletedChatMentionIds.has(messageId)) continue;
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
            chat.messages.push({ id: messageId, type: 'story-mention', storyId: story.id, recipient, actor: story.handle, from: incoming ? 'them' : 'me', sentAt: Date.now() });
            chat.lastActivity = Date.now();
            chat.lastMessage = incoming ? 'Mentioned you in a story' : `You mentioned ${recipient} in your story`;
            const chatIsOpen = state.currentView === 'messages' && state.activeConversationHandle === chat.handle;
            if (chatIsOpen) {
                chat.unread = false;
                chat.unreadCount = 0;
            } else if (incoming) {
                chat.unreadCount = getUnreadMessageCount(chat) + 1;
                chat.unread = true;
            }
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
        if (recipients.has(currentUser.handle) && !story.cloudContentId) pulseHomeNotification('mention');
    }
    return created;
}

// Caption mentions and explicit photo tags are separate relationships.
export function recordPostMentions(post) {
    if (!post?.id || !post.handle || state.deletionRequestedAt || state.blockedHandles.has(post.handle)) return 0;
    const recipients=new Map(captionMentions(post.caption).map(mention=>[mention.handle,'post-mention']));
    for(const value of post.taggedUsers || post.taggedHandles || []) {
        const handle=normalizeHandle(value);
        if(getAccount(handle)&&!state.blockedHandles.has(handle))recipients.set(handle,'post-tag');
    }
    let created=0;state.localStoryNotifications ||= [];
    const entityType=post.reel?'reel':'post';
    for(const [recipient,kind] of recipients) {
        if(recipient===post.handle || (post.handle!==currentUser.handle&&recipient!==currentUser.handle))continue;
        if(state.localStoryNotifications.some(notice=>notice.kind===kind&&notice.recipient===recipient&&String(notice.postId)===String(post.id)&&(notice.entityType||'post')===entityType&&notice.actor===post.handle))continue;
        state.localStoryNotifications.push({kind,recipient,postId:post.id,entityType,actor:post.handle,actorName:post.user||post.handle,createdAt:post.createdAt||Date.now(),read:false});created++;
    }
    if (created) {
        persistPreferences();
        updateNotificationBadge();
        if (recipients.has(currentUser.handle) && !post.cloudClientId && !post.cloudContentId) pulseHomeNotification('mention');
    }
    return created;
}
export function syncIncomingPostMentions() {
    [...posts,...reels].filter(post=>post.handle!==currentUser.handle).forEach(recordPostMentions);
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
    pulseHomeNotification('like');
    return true;
}

export function recordIncomingPostLike(post,actor){
    if(!post||post.handle!==currentUser.handle||!actor?.handle||actor.handle===currentUser.handle)return false;
    state.localStoryNotifications ||= [];
    if(state.localStoryNotifications.some(notice=>notice.kind==='post-like'&&notice.postId===post.id&&notice.actor===actor.handle&&notice.recipient===currentUser.handle))return false;
    state.localStoryNotifications.push({kind:'post-like',recipient:currentUser.handle,postId:post.id,actor:actor.handle,actorName:actor.name||actor.handle,createdAt:Date.now(),read:false,storyPreview:storyNotificationPreview(post)});
    saveNotificationPreviews();updateNotificationBadge();pulseHomeNotification('like');return true;
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
    const cloud = currentHistory();
    const cloudTargets = new Set(cloud.items.map(describeCloudNotification).filter(item => item.storyId || item.postId != null).map(noticeTarget));
    const localUnread = availableLocalNotifications().filter(notice => notice.read === false && !cloudTargets.has(noticeTarget(notice))).length;
    const count = localUnread + cloud.unread + liveNotifications().filter(notice => !notice.read_at).length;
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
    followRequestsExpanded = false;
    trigger?.setAttribute('aria-expanded','true');
    setView('notifications');
    if (state.signedInAccountId) {
        void loadLiveData().catch(() => {});
        void refreshHomeNotifications().catch(() => {});
    }
}

function markCloudHistoryRead() {
    const snapshot = currentHistory();
    if (!snapshot.connected || !snapshot.unread || markingRead) return;
    markingRead = true;
    void markHomeNotificationsRead(snapshot.as_of).then(() => {
        if (snapshot === history) {
            snapshot.unread = 0;
            snapshot.items = snapshot.items.map(item => ({ ...item, read: true }));
            updateNotificationBadge();
        }
    }).catch(() => {}).finally(() => {
        markingRead = false;
        if (snapshot !== history && state.currentView === 'notifications') markCloudHistoryRead();
    });
}

export async function refreshHomeNotifications({ older = false } = {}) {
    const owner = state.signedInAccountId;
    if (!owner || state.deletionRequestedAt) return;
    const request = ++historyRequest;
    const previous = currentHistory();
    const offset = older ? previous.items.length : 0;
    const result = await readHomeNotificationPage(offset);
    if (request !== historyRequest || owner !== state.signedInAccountId) return;
    const items = result.connected ? result.items || [] : previous.items;
    const ids = new Set(items.map(item => item.id));
    const groups = new Set(items.filter(item => item.other_count > 0).map(item => item.payload?.target_key).filter(Boolean));
    history = {
        ...result, owner, items: older ? [...previous.items.filter(item => !ids.has(item.id)
            && !groups.has(item.payload?.target_key)), ...items] : items,
        pending: result.pending || [], unread: Number(result.unread) || 0,
    };
    if (state.currentView === 'notifications') renderNotificationsPage({ focus: false });
    else updateNotificationBadge();
}

export function handleHomeNotificationEvent(row, isNew) {
    if (!row || !cloudNotificationIcons[row.kind]) return;
    if (isNew && !row.read_at) pulseHomeNotification(cloudNotificationIcons[row.kind]);
    window.clearTimeout(cloudRefreshTimer);
    cloudRefreshTimer = window.setTimeout(() => { void refreshHomeNotifications().catch(() => {}); }, 160);
}

export function renderNotificationsPage({ focus = true } = {}){
    if(state.deletionRequestedAt)return;
    if (demoContentEnabled) ensureDemoStoryLike();
    updateNotificationBadge();
    void markLiveNoticesRead().then(updateNotificationBadge).catch(() => {});
    markCloudHistoryRead();
    const items = notificationItems();
    const content = document.querySelector('.notifications-content');
    const cloud = currentHistory();
    const older = cloud.total > cloud.items.length
        ? '<button type="button" class="notification-action notification-load-older" data-notification-older>Load older notifications</button>' : '';
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const recent = items.filter(item => notificationTimestamp(item) > cutoff);
    const earlier = items.slice(recent.length);
    content.innerHTML = items.length
        ? `${renderNotificationGroup('New', recent)}${renderNotificationGroup('Earlier', earlier)}${older}`
        : '<div class="notification-empty"><strong>You’re all caught up.</strong><p>No notifications yet.</p></div>';
    if (focus) document.getElementById('notifications-title').focus();
    let changed=false;
    for(const notice of state.localStoryNotifications || []){
        if(notice.recipient===currentUser.handle && !notice.read){notice.read=true;changed=true;}
    }
    if(changed)persistPreferences();
    updateNotificationBadge();
}

async function reviewRequest(button) {
    const id = button.dataset.requester;
    const local = button.hasAttribute('data-local-request');
    if (!mayInteract() || busyFollowActions.has(id)) return;
    busyFollowActions.add(id);
    const buttons = Array.from(button.closest('li').querySelectorAll('button'));
    buttons.forEach(action => { action.disabled = true; });
    const owner = state.signedInAccountId;
    const snapshot = currentHistory();
    const pending = snapshot.pending.find(row => row.follower_id === id);
    const accept = button.dataset.cloudRequest === 'accept';
    try {
        const changed = local ? respondToFollowRequest(id, accept) : await reviewCloudFollowRequest(id, accept);
        if (owner !== state.signedInAccountId) return;
        if (local && changed) {
            if (accept) state.localStoryNotifications.push({ id: `follow-${id}-${Date.now()}`, kind: 'new-follower',
                recipient: currentUser.handle, actor: id, actorName: getAccount(id)?.name, allowFollowBack: true,
                read: true, createdAt: Date.now() });
            persistPreferences();
        }
        if (!local && changed && pending && snapshot === history) {
            snapshot.pending = snapshot.pending.filter(row => row !== pending);
            if (accept) {
                snapshot.items.unshift({ id: pending.notification_id || `follow-${id}`, kind: 'follow_request',
                    payload: { actor_id: id, review_status: 'accepted' }, username: pending.username,
                    display_name: pending.display_name, created_at: pending.created_at, read: true });
            }
        }
        if (!local) await refreshHomeNotifications().catch(() => {});
        if (state.currentView === 'notifications') {
            renderNotificationsPage({ focus: false });
            const actions = Array.from(document.querySelectorAll('[data-notification-follow-back]'));
            (actions.find(action => action.dataset.notificationFollowBack === id) ||
                document.querySelector('[data-toggle-follow-requests]') ||
                document.getElementById('notifications-title')).focus({ preventScroll: true });
        }
        showShareFeedback(changed ? (accept ? 'Follow request accepted.' : 'Follow request declined.') : 'This request is no longer pending.');
    } catch {
        showShareFeedback('Could not update the follow request.');
    } finally {
        busyFollowActions.delete(id);
        buttons.forEach(action => { action.disabled = false; });
    }
}

async function followBack(button) {
    const id = button.dataset.notificationFollowBack;
    if (!mayInteract() || busyFollowActions.has(id)) return;
    const owner = state.signedInAccountId;
    busyFollowActions.add(id);
    button.disabled = true;
    try {
        if (button.hasAttribute('data-local-request')) toggleSessionFollow('account', id);
        else {
            const status = await followNotificationActor(id);
            if (owner !== state.signedInAccountId) return;
            if (status === 'accepted') (state.cloudFollowingIds ||= new Set()).add(id);
            for (const row of currentHistory().items) {
                if (row.payload?.actor_id === id) row.follow_back_status = status;
            }
        }
        if (state.currentView === 'notifications') renderNotificationsPage({ focus: false });
    } catch { showShareFeedback('Could not follow this account. Try again.'); }
    finally { busyFollowActions.delete(id); button.disabled = false; }
}

export function registerNotificationEvents() {
    const page = document.getElementById('notifications-page');
    updateNotificationBadge();
    window.addEventListener('live-broadcasts-updated', () => {
        if (state.currentView === 'notifications') renderNotificationsPage({ focus: false });
        else updateNotificationBadge();
    });
    document.addEventListener('visibilitychange', () => {
        if (!document.hidden) void refreshHomeNotifications().catch(() => {});
    });
    page.addEventListener('click', event => {
        const expand = event.target.closest('[data-toggle-follow-requests]');
        if (expand) {
            followRequestsExpanded = !followRequestsExpanded;
            expand.setAttribute('aria-expanded', String(followRequestsExpanded));
            document.getElementById('pending-notification-requests').hidden = !followRequestsExpanded;
            return;
        }
        const older = event.target.closest('[data-notification-older]');
        if (older && !older.disabled) {
            older.disabled = true;
            void refreshHomeNotifications({ older: true }).catch(() => {
                showShareFeedback('Could not load older notifications.');
            }).finally(() => { older.disabled = false; });
            return;
        }
        const follow = event.target.closest('[data-notification-follow-back]');
        if (follow) { void followBack(follow); return; }
        const request = event.target.closest('[data-cloud-request]');
        if (request) { void reviewRequest(request); return; }
        const postLink=event.target.closest('[data-post-notice]');
        if(postLink){const type=postLink.dataset.noticeEntityType==='reel'?'reel':'post';const post=(type==='reel'?reels:posts).find(post=>String(post.id)===postLink.dataset.postNotice);if(post&&canViewMedia(post))openProfileMedia(type,post.id,postLink,{singleItem:true});return;}
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
