import { getStoryGroups, renderOwnStoryTile } from './stories.js';
import { attachmentExpiryForSize, isExpiredAttachment } from './chat-attachment-expiry.js';
import { canViewMedia, canViewStory, visibleAvatar, mediaNeedsWarning, getAccount, DEFAULT_AVATAR } from '../core/social.js';
import { findEntity } from '../data/entities.js';
import { state } from '../core/state.js';
import { escapeHtml, formatConversationTime } from '../core/utils.js';
import { conversations } from '../data/sample-data.js';
import { currentUser } from '../data/sample-data.js';
import { mayInteract } from '../core/social.js';
import { canSendToConversation, isJoinedGroup, isGroupAdmin, visibleConversationMessages } from './message-access.js';

function contactFileUrl(name, phone) {
    const escapedName = String(name ?? '').replace(/\\/g, '\\\\')
        .replace(/\r\n|\r|\n/g, '\\n').replace(/[;,]/g, '\\$&');
    const fields = ['BEGIN:VCARD', 'VERSION:3.0', 'N:;' + escapedName + ';;;',
        'FN:' + escapedName, 'TEL:' + phone, 'END:VCARD', ''];
    return 'data:text/vcard;charset=utf-8,' + encodeURIComponent(fields.join('\r\n'));
}

export function conversationAvatar(conversation) {
    return conversation.isGroup ? conversation.photo || conversation.avatar || DEFAULT_AVATAR : visibleAvatar(conversation.handle, conversation.avatar);
}

export function getConversationPreview(conversation) {
    if (conversation.cloudId) return conversation.lastMessage || 'No messages yet.';
    const lastMessage = visibleConversationMessages(conversation).at(-1);
    if (!lastMessage)
        return conversation.messages?.length ? "Start a conversation" : conversation.lastMessage || "Start a conversation";
    return messagePreview(lastMessage);
}

function messagePreview(lastMessage) {
    if (lastMessage.type === "shared-post") return `${lastMessage.from === "me" ? "You: " : ""}Shared a ${lastMessage.entityType}`;
    if (lastMessage.type === "shared-story") return `${lastMessage.from === "me" ? "You: " : ""}Shared a story`;
    if (lastMessage.type === 'story-mention') return lastMessage.from === 'me' ? 'You mentioned them in your story' : 'Mentioned you in a story';
    if (lastMessage.type === "meme")
        return `${lastMessage.from === "me" ? "You: " : ""}Shared a meme`;
    if (lastMessage.type === "call")
        return `${lastMessage.from === "me" ? "Outgoing" : "Incoming"} ${lastMessage.media} call`;
    if (lastMessage.type === 'voice') return 'Voice message';
    if (lastMessage.type === 'location') return `Shared a location: ${lastMessage.place}`;
    if (lastMessage.type === 'contact') return `Shared a contact: ${lastMessage.contactName}`;
    if (lastMessage.type === 'attachment') {
        if (isExpiredAttachment(lastMessage)) return `Expired attachment: ${lastMessage.fileName || 'Attachment'}`;
        if (lastMessage.mediaKind === 'file') return `Shared a file: ${lastMessage.fileName || 'Attachment'}`;
        return `Shared a ${lastMessage.mediaKind === 'video' ? 'video' : 'photo'}`;
    }
    return `${lastMessage.from === "me" ? "You: " : ""}${lastMessage.text}`;
}

export function renderReplyQuote(message, conversation) {
    if (!message) return '<div class="chat-reply-quote">Original message unavailable</div>';
    const author = message.from === 'me' ? 'You' : conversation.senderNames?.[message.senderId] || getAccount(message.from)?.name || conversation.user;
    const preview = message.type === 'text' ? message.text : messagePreview(message);
    const entity = message.type === 'shared-post' ? findEntity(message.entityType, message.entityId) : null;
    const showPreview = entity && canViewMedia(entity)
        && (!mediaNeedsWarning(entity) || state.revealedMediaKeys.has(`${message.entityType}:${entity.id}`));
    const cover = showPreview && (entity.cover || entity.poster || entity.media);
    const video = showPreview && (entity.videoUrl || entity.video);
    const thumbnail = cover ? `<img src="${escapeHtml(cover)}" alt="" />`
        : video ? `<video src="${escapeHtml(video)}" preload="metadata" muted playsinline aria-hidden="true"></video>` : '';
    return `<div class="chat-reply-quote">
        <div class="chat-reply-copy"><strong>${escapeHtml(author)}</strong><span>${escapeHtml(preview || 'Message')}</span></div>
        ${thumbnail}
    </div>`;
}

export function getUnreadMessageCount(conversation) {
    const count = conversation.unreadCount;
    return conversation.unread && Number.isSafeInteger(count) && count > 0 ? count : 0;
}

export function markInboxChatRead(chat) {
    chat.unread = false;
    chat.unreadCount = 0;
}

function inboxMessageTime(conversation) {
    if (conversation.cloudId) return conversation.lastActivity ?? 0;
    return visibleConversationMessages(conversation).at(-1)?.sentAt
        ?? (conversation.messages?.length ? 0 : conversation.lastActivity ?? 0);
}

function formatInboxTime(timestamp) {
    if (!timestamp) return '';
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000));
    if (minutes === 0) return 'Just now';
    if (minutes < 60) return `${minutes} min ago`;
    if (minutes < 1440) return `${Math.floor(minutes / 60)}h ago`;
    return `${Math.floor(minutes / 1440)}d ago`;
}

function renderGroupProfile(group) {
    const members = [...new Set(group.members)];
    const admin = !group.cloudId && isGroupAdmin(group);
    return `
      <section class="group-profile" aria-label="Group profile">
        <header class="group-profile-header">
          <button class="chat-back-button" type="button" data-group-profile-back aria-label="Back from group profile">‹</button>
          <h2>Group profile</h2>
        </header>
        <div class="group-profile-identity">
          ${mayInteract() ? `<button class="group-profile-photo" type="button" data-group-photo ${group.photo ? 'data-has-photo' : ''} aria-label="${group.photo ? 'Change' : 'Add'} group photo">
            ${group.photo ? `<img src="${escapeHtml(group.photo)}" alt="" />` : '<span aria-hidden="true">+</span>'}
          </button>` : `<img src="${escapeHtml(conversationAvatar(group))}" alt="" />`}
          <h3>${escapeHtml(group.user)}</h3>
        </div>
        <h4>Members (${members.length})</h4>
        <ul class="group-profile-members">
          ${members.map(handle => {
              const account = group.participantProfiles?.[handle] || getAccount(handle);
              return `<li><img src="${escapeHtml(visibleAvatar(handle, account?.avatar))}" alt="" />
                <span>${escapeHtml(account?.name || handle)}</span>
                ${handle === currentUser.handle ? '<small>You</small>' : ''}
                ${group.admins?.includes(handle) ? '<small>Admin</small>' : ''}
                ${admin && handle !== currentUser.handle ? `<button class="group-member-options" type="button"
                  data-group-member-options="${escapeHtml(handle)}" aria-label="Options for ${escapeHtml(account?.name || handle)}">⋯</button>` : ''}
              </li>`;
          }).join('')}
        </ul>
        ${admin && mayInteract() ? '<button class="group-add-member" type="button" data-group-add-member>Add group member</button>' : ''}
      </section>`;
}


function renderInboxStories() {
    const contacts = new Set(conversations.filter(chat => !chat.isGroup &&
        (chat.cloudId ? chat.cloudHasMessages : chat.messages?.length)).map(chat => chat.handle));
    const groups = new Map();
    const stories = state.signedInAccountId ? state.inboxStories : state.stories;
    for (const story of stories || []) {
        if (!contacts.has(story.handle) || story.handle === currentUser.handle || story.expiresAt <= Date.now() ||
            state.mutedStoryHandles.has(story.handle) || !canViewStory(story)) continue;
        const group = groups.get(story.handle) || { ...story, seen: true };
        group.seen &&= state.seenStoryIds.has(story.id);
        groups.set(story.handle, group);
    }
    const ownStories = getStoryGroups().find(group => group.handle === currentUser.handle);
    return renderOwnStoryTile(ownStories) + [...groups.values()].map(story =>
        `<button type="button" class="story-item" data-inbox-story="${escapeHtml(story.handle)}">
          <span class="story-ring has-story ${story.seen ? 'seen-story' : ''}"><img src="${escapeHtml(story.avatar)}" alt="" /></span>
          <span>${escapeHtml(story.user)}</span></button>`).join('');
}

export function getInboxConversations() {
    return conversations.filter(item => item.cloudId ? item.cloudHasMessages
        : !conversations.some(other => other.cloudId && other.cloudHasMessages && other.handle === item.handle))
        .sort((left, right) => Number(right.pinned) - Number(left.pinned) || inboxMessageTime(right) - inboxMessageTime(left));
}

export function renderInboxConversation(item) {
    const unreadCount = getUnreadMessageCount(item);
    const timestamp = inboxMessageTime(item);
    const preview = getConversationPreview(item);
    return `
    <button class="conversation-tile ${item.unread ? "unread" : ""}" type="button" data-open-conversation="${escapeHtml(item.handle)}">
      <img class="conversation-avatar" src="${escapeHtml(conversationAvatar(item))}" alt="" />
      <span class="conversation-copy">
        <strong>${escapeHtml(item.user)}</strong>
        ${item.isGroup || item.pinned || item.muted ? `<span class="conversation-handle">${[
          item.isGroup ? `${item.members?.length || 0} members` : '',
          item.isGroup && item.pendingMembers?.length ? `${item.pendingMembers.length} invited` : '',
          item.pinned ? 'Pinned' : '',
          item.muted ? 'Muted' : '',
        ].filter(Boolean).join(' · ')}</span>` : ''}
        ${item.membershipStatus === 'pending'
          ? '<span class="conversation-preview">Group invitation — review to join</span>'
          : `<span class="conversation-preview">${escapeHtml(preview)}</span>`}
      </span>
      <span class="conversation-meta">
        <time class="conversation-time">${formatInboxTime(timestamp)}</time>
        ${unreadCount > 0 && item.membershipStatus !== 'pending'
          ? `<span class="conversation-unread-count" aria-label="${unreadCount > 4 ? 'More than 4' : unreadCount} unread ${unreadCount === 1 ? 'message' : 'messages'}">${unreadCount > 4 ? '+4' : unreadCount}</span>` : ''}
      </span>
    </button>
  `;
}

function renderMessagesInbox(list) {
    const rows = getInboxConversations().map(renderInboxConversation).join('');
    const empty = state.signedInAccountId ? '<p class="messages-local-note">No messages yet.</p>' : '';
    const stories = renderInboxStories();
    if (list.firstElementChild?.classList.contains('messages-inbox')) {
        list.querySelector('.inbox-stories').innerHTML = stories;
        list.querySelector('.inbox-conversation-rows').innerHTML = rows || empty;
        return;
    }
    list.innerHTML = `
    <section class="messages-inbox" aria-label="Messages inbox">
      <header class="messages-inbox-header"><h2>Messages</h2><button class="new-group-button" type="button" data-create-group aria-label="New group" title="New group">
        <svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="8" cy="7" r="3" /><path d="M2 19v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M15 4a3 3 0 0 1 0 6M19 13v7M15.5 16.5h7" />
        </svg>
      </button></header>
      <form class="messages-inbox-search" role="search" aria-label="Search messages">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
          <circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 4.5 4.5" stroke-linecap="round" />
        </svg>
        <input type="search" name="inboxSearch" aria-label="Search by name or username" placeholder="Search name or username"
          maxlength="100" autocomplete="off" aria-controls="inbox-search-results" />
      </form>
      <section class="inbox-stories stories-list" aria-label="Stories from your chats">${stories}</section>
      <div class="conversation-list">
        <div class="inbox-conversation-rows">${rows || empty}</div>
        <div class="inbox-search-results" id="inbox-search-results" hidden>
          <p class="inbox-search-status" role="status"></p>
          <div class="inbox-search-chats"></div>
          <div class="inbox-search-people"></div>
        </div>
      </div>
      ${state.signedInAccountId ? '' : '<p class="messages-local-note">Messages are saved on this device. Delivery and connected calls will be added later.</p>'}
    </section>`;
}

let chatSlide;

export function renderMessages(options) {
    const list = document.getElementById('messages-list');
    const previous = list.dataset.messageScreen;
    renderMessagesView(options);
    const screen = state.activeGroupProfileHandle ? 'profile' : state.activeConversationHandle ? 'chat' : 'inbox';
    list.dataset.messageScreen = screen;
    if (!previous || previous === screen || state.currentView !== 'messages' || document.hidden ||
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches) return;
    const backwards = screen === 'inbox' || previous === 'profile';
    chatSlide?.cancel();
    chatSlide = list.firstElementChild?.animate?.(
        [{ transform: `translateX(${backwards ? -28 : 28}px)`, opacity: .75 }, { transform: 'translateX(0)', opacity: 1 }],
        { duration: 220, easing: 'cubic-bezier(.18,.84,.28,1)' },
    );
}

function renderMessagesView({ preserveComposer = false, preserveHistoryAnchor = false, scrollToLatest = false } = {}) {
    const list = document.getElementById("messages-list");
    const group = conversations.find(item => item.handle === state.activeGroupProfileHandle);
    if (isJoinedGroup(group)) {
        list.innerHTML = renderGroupProfile(group);
        return;
    }
    state.activeGroupProfileHandle = null;
    const conversation = conversations.find((item) => item.handle === state.activeConversationHandle);
    if (!conversation) {
        state.activeConversationHandle = null;
        renderMessagesInbox(list);
        return;
    }
    if (conversation.cloudId) {
        renderConnectedChat(list, conversation, { preserveComposer, preserveHistoryAnchor, scrollToLatest });
        return;
    }
    markInboxChatRead(conversation);
    const canSend = canSendToConversation(conversation);
    const pending = conversation.membershipStatus === 'pending';
    const messages = visibleConversationMessages(conversation);
    const messagesById = new Map(messages.map(message => [message.id, message]));
    const messageMarkup = messages.map(message => renderConversationMessage(message, conversation, messagesById))
    .map((markup, index) => {
        const message = messages[index];
        if (message.id == null) return markup;
        const reaction = message.reactionsBy?.[currentUser.handle] ?? (message.likedBy?.includes(currentUser.handle) ? '❤️' : '');
        return markup.replace('<article ', `<article data-reactable-message="${escapeHtml(String(message.id))}" `)
            .replace('</article>', `<span class="chat-message-reaction" role="status"${reaction ? '' : ' hidden'}>${escapeHtml(reaction)}</span></article>`);
    }).join("");
    if (preserveComposer) {
        const history = list.querySelector('.chat-history');
        if (history) {
            history.innerHTML = messageMarkup;
            history.scrollTop = history.scrollHeight;
            return;
        }
    }
    list.innerHTML = `
    <section class="chat-window" aria-label="Chat with ${escapeHtml(conversation.user)}">
      <header class="chat-header">
        <button class="chat-back-button" type="button" data-chat-back aria-label="Back to messages">‹</button>
        ${renderChatIdentity(conversation, conversationAvatar(conversation))}
        ${renderConversationActions(conversation, canSend)}
      </header>
      <div class="chat-history${/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(conversation.wallpaper || '') ? ` chat-history-custom" style="background-image:url(${conversation.wallpaper})` : ''}" aria-live="polite">
        ${canSend ? '' : `<p class="chat-empty">${conversation.membershipStatus === 'pending' ? 'Accept this group invitation before viewing its history.' : state.verificationStatus !== 'approved' ? 'Messaging is unavailable while verification is pending.' : 'Messaging is paused while this account is blocked.'}</p>`}
        ${pending ? `<div class="group-invitation-actions"><button type="button" data-group-invite="accept">Accept invitation</button><button type="button" data-group-invite="decline">Decline</button></div>` : messageMarkup || '<p class="chat-empty">Start a conversation with a message or shared post.</p>'}
      </div>
      ${canSend ? renderChatComposer() : ''}
    </section>
  `;
    const history = list.querySelector(".chat-history");
    history.scrollTop = history.scrollHeight;
}

function renderChatIdentity(chat, avatar) {
    const photo = `<img src="${escapeHtml(avatar)}" alt="" />`;
    const name = `<strong>${escapeHtml(chat.user)}</strong>`;
    const members = chat.isGroup ? `<small>${chat.members?.length || 0} members</small>` : '';
    const profile = `data-chat-profile data-profile-handle="${escapeHtml(chat.handle)}"`;
    return `<div class="chat-header-identity">
        ${chat.isGroup ? photo : `<button type="button" class="chat-header-photo" ${profile} aria-label="View profile photo and details">${photo}</button>`}
        <div class="chat-header-copy">
          ${chat.isGroup ? name + members : `<button type="button" ${profile}>${name}</button>`}
        </div>
      </div>`;
}

function renderConversationActions(conversation, canSend) {
    return `
        <button class="chat-call-button" type="button" data-chat-call="voice" aria-label="Voice call" title="Voice call" ${canSend ? '' : 'disabled'}><svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor" aria-hidden="true"><path d="M7.1 2.8H4.5A1.7 1.7 0 0 0 2.8 4.6c.5 8.8 7.8 16.1 16.6 16.6a1.7 1.7 0 0 0 1.8-1.7v-2.6l-5.4-2.3-2 2c-2.9-1.1-5.3-3.5-6.4-6.4l2-2z"/></svg></button>
        <button class="chat-call-button" type="button" data-chat-call="video" aria-label="Video call" title="Video call" ${canSend ? '' : 'disabled'}><svg viewBox="0 0 24 24" width="23" height="23" fill="currentColor" aria-hidden="true"><rect x="2" y="5" width="14" height="14" rx="3.5"/><path d="m17 10 4.5-2.5v9L17 14z"/></svg></button>
        <div class="chat-options-wrap">
          <button class="chat-options-button" type="button" data-chat-options aria-label="Chat options" aria-expanded="false">•••</button>
          <div class="chat-options-menu" role="menu" hidden>
            <button type="button" role="menuitem" data-chat-option="pin">${conversation.pinned ? "Unpin chat" : "Pin chat"}</button>
            <button type="button" role="menuitem" data-chat-option="mute">Mute</button>
            ${!conversation.isGroup || isJoinedGroup(conversation) ? '<button type="button" role="menuitem" data-chat-option="search">Search chat</button>' : ''}
            <button type="button" role="menuitem" data-chat-option="wallpaper">Change chat wallpaper</button>
            ${!conversation.isGroup ? '<button type="button" role="menuitem" data-chat-option="timer">Chat timer</button>' : ''}
            ${!conversation.isGroup || isJoinedGroup(conversation) ? '<button type="button" role="menuitem" data-chat-option="delete">Delete chat</button>' : ''}
            ${conversation.isGroup ? '' : `<button type="button" role="menuitem" data-chat-profile data-profile-handle="${escapeHtml(conversation.handle)}">View profile</button>`}
            ${isJoinedGroup(conversation) ? '<button type="button" role="menuitem" data-chat-option="group-profile">View group profile</button><button type="button" role="menuitem" data-chat-option="leave-group">Leave group</button>' : ''}
            ${conversation.isGroup && !conversation.cloudId && conversation.admins?.includes(currentUser.handle) ? '<button type="button" role="menuitem" data-chat-option="manage-group">Manage group</button>' : ''}
            ${conversation.isGroup ? '' : `<div class="chat-more-wrap">
              <button class="chat-more-toggle" type="button" role="menuitem" data-chat-more aria-haspopup="menu" aria-expanded="false" aria-controls="chat-more-menu">More <span aria-hidden="true">›</span></button>
              <div class="chat-more-menu" id="chat-more-menu" role="menu" aria-label="More chat options" hidden>
                <button type="button" role="menuitem" data-chat-report>Report</button>
                <button type="button" role="menuitem" data-account-block="${escapeHtml(conversation.handle)}" ${state.blockedHandles.has(conversation.handle) ? 'disabled' : ''}>${state.blockedHandles.has(conversation.handle) ? 'Blocked' : 'Block'}</button>
              </div>
            </div>`}
          </div>
        </div>`;
}

function renderChatComposer() {
    return `<form class="chat-composer">
        <button class="chat-attach-button" type="button" data-chat-attach aria-label="More attachment options"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></button>
        <button class="chat-attach-button" type="button" data-chat-gallery aria-label="Attach a photo or video"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 17H3V5a2 2 0 0 1 2-2h12v2"/><g transform="translate(3 3) scale(.85)"><rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1.5"/><path d="m4 17 5-5 4 3 3-5 4 6"/></g></svg></button>
        <input class="chat-gallery-input" type="file" accept="image/*,video/*" hidden />
        <input class="chat-file-input" type="file" hidden />
        <input class="chat-sticker-input" type="file" accept="image/gif,image/webp,image/png,image/apng" hidden />
        <button class="chat-attach-button" type="button" data-chat-voice aria-label="Record a voice message"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="2.5" width="6" height="12" rx="3" fill="currentColor" stroke="none"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3.5m-3 0h6"/></svg></button>
        <input name="message" type="text" maxlength="1000" placeholder="Message..." aria-label="Message" autocomplete="off" enterkeyhint="send" />
        <button class="chat-send-button" type="submit">Send</button>
      </form>`;
}

function renderConversationMessage(message, conversation, messagesById) {
        if (message.type === 'story-mention') {
            const story = state.stories.find(item => item.id === message.storyId && item.handle === message.actor);
            const incoming = message.recipient === currentUser.handle && message.from !== 'me';
            const available = story && canViewStory(story) && (!story.expiresAt || story.expiresAt > Date.now());
            const text = incoming ? `${conversation.user} mentioned you in their story.` : `You mentioned ${conversation.user} in your story.`;
            const preview = available ? `<button type="button" class="chat-shared-post" data-story-mention-view="${escapeHtml(story.id)}">${story.type === 'video' ? `<video muted playsinline preload="metadata" src="${escapeHtml(story.media)}"></video>` : `<img src="${escapeHtml(story.media)}" alt="Story by ${escapeHtml(story.user)}" />`}<span>View story</span></button>${incoming ? `<button type="button" class="story-mention-repost" data-story-mention-repost="${escapeHtml(story.id)}">Add to your story</button>` : ''}` : '<small>This Story is no longer available.</small>';
            return `<article class="chat-message ${incoming ? 'from-them' : 'from-me'}"><p>${escapeHtml(text)}</p>${preview}<time>${escapeHtml(formatConversationTime(message.sentAt))}</time></article>`;
        }
        if (message.type === 'shared-story') {
            const story = message.story;
            if (!story?.media) return '<article class="chat-message">This shared story is unavailable.</article>';
            return `<article class="chat-message ${message.from === 'me' ? 'from-me' : 'from-them'}"><div class="chat-shared-post"><img src="${escapeHtml(story.media)}" alt="Story shared by ${escapeHtml(story.user)}" /><strong>${escapeHtml(story.user)}</strong>${story.caption ? `<p>${escapeHtml(story.caption)}</p>` : ''}<span>Shared story · preview on this device</span></div></article>`;
        }
        if (message.type === 'shared-post') {
            const entity = findEntity(message.entityType, message.entityId);
            if (!entity || !canViewMedia(entity)) return '<article class="chat-message">This shared post is unavailable.</article>';
            const warning = mediaNeedsWarning(entity) && !state.revealedMediaKeys.has(`${message.entityType}:${entity.id}`);
            if (message.entityType === 'post') {
                const author = entity.user || entity.handle;
                const cover = entity.cover || entity.poster || entity.media;
                const video = entity.mediaType === 'video' && entity.videoUrl;
                const media = video && !cover && !warning
                    ? `<video class="chat-post-media" src="${escapeHtml(video)}" preload="metadata" muted playsinline></video>`
                    : `<img class="chat-post-media" src="${escapeHtml(cover)}" alt="${warning ? 'Sensitive content obscured' : ''}" />`;
                return `<article class="chat-message chat-post-message ${message.from === 'me' ? 'from-me' : 'from-them'}">
                  <button type="button" class="chat-post-card" data-shared-type="post" data-shared-id="${Number(entity.id)}" aria-label="Open post by ${escapeHtml(author)}">
                    <span class="chat-post-author"><img src="${escapeHtml(visibleAvatar(entity.handle, entity.avatar))}" alt="" /><strong>${escapeHtml(author)}</strong></span>
                    <span class="chat-post-preview${warning ? ' sensitive-preview' : ''}">${media}${warning ? '<span class="chat-post-media-label">Sensitive content</span>' : video ? '<span class="chat-post-media-label" aria-hidden="true">▶</span>' : ''}</span>
                  </button>
                </article>`;
            }
            return `<article class="chat-message ${message.from === 'me' ? 'from-me' : 'from-them'}"><button type="button" class="chat-shared-post ${warning ? 'sensitive-preview' : ''}" data-shared-type="${escapeHtml(message.entityType)}" data-shared-id="${Number(message.entityId)}"><img src="${escapeHtml(entity.cover || entity.poster || entity.media)}" alt="${warning ? 'Sensitive content obscured' : 'Shared post cover'}" /><strong>${escapeHtml(entity.user)}</strong><p>${escapeHtml(entity.caption)}</p><span>${warning ? 'Sensitive content · open to review' : `Open ${escapeHtml(message.entityType)}`}</span></button></article>`;
        }
        if (message.type === "meme") {
            return `
        <article class="chat-message ${message.from === "me" ? "from-me" : "from-them"} chat-meme">
          <img src="${escapeHtml(message.media)}" alt="Shared meme" />
          ${message.caption ? `<p>${escapeHtml(message.caption)}</p>` : ""}
          <time>${escapeHtml(formatConversationTime(message.sentAt))}</time>
        </article>
      `;
        }
        if (message.type === "call") {
            return `
        <article class="chat-call-event ${message.from === "me" ? "from-me" : "from-them"}">
          <span aria-hidden="true">${message.media === "video" ? "▣" : "☎"}</span>
          <div><strong>Sample ${escapeHtml(message.media)} call</strong><small>Demo history · ${escapeHtml(formatConversationTime(message.sentAt))}</small></div>
        </article>
      `;
        }
        if (message.type === 'voice') return `<article class="chat-message chat-voice-message ${message.from === 'me' ? 'from-me' : 'from-them'}">
          <div class="chat-voice-player">
            <audio preload="metadata" src="${escapeHtml(message.media)}"></audio>
            <div class="chat-voice-play-row">
              <button type="button" data-voice-play aria-label="Play voice message"><span aria-hidden="true">▶</span></button>
              <span class="chat-voice-time">0:00 / –:––</span>
            </div>
            <input type="range" data-voice-seek aria-label="Seek voice message" min="0" max="0" value="0" step="0.01"
              data-recorded-duration="${Number(message.durationSeconds) || 0}" disabled />
          </div>
          <time>${escapeHtml(formatConversationTime(message.sentAt))}</time>
        </article>`;
        if (message.type === 'location' || message.type === 'contact') {
            const location = message.type === 'location';
            const phone = String(message.phone ?? '').replace(/[^+0-9]/g, '');
            const details = location
                ? `<a class="chat-share-card" href="https://www.google.com/maps/search/?api=1&amp;query=${encodeURIComponent(message.place)}" target="_blank" rel="noopener noreferrer"><small>Location · Open in Maps</small><strong>${escapeHtml(message.place)}</strong></a>`
                : `<div class="chat-share-card"><a href="${contactFileUrl(message.contactName, phone)}" download="contact.vcf"><small>Contact · Save to phone</small><strong>${escapeHtml(message.contactName)}</strong></a>
                    ${phone ? `<a href="tel:${phone}">Call ${escapeHtml(message.phone)}</a>` : ''}</div>`;
            return `<article class="chat-message ${message.from === 'me' ? 'from-me' : 'from-them'}">
              ${details}<time>${escapeHtml(formatConversationTime(message.sentAt))}</time></article>`;
        }
        if (message.type === 'attachment') {
            const fileName = escapeHtml(message.fileName || 'Attachment');
            const expired = isExpiredAttachment(message);
            const expiresAt = Number.isFinite(message.expiresAt) ? message.expiresAt : null;
            const download = (message.media?.startsWith('blob:') || (conversation.cloudId && message.media))
                ? `<a class="${message.mediaKind === 'file' ? 'chat-share-card' : 'chat-file-download'}" href="${escapeHtml(message.media)}" download="${fileName}" data-attachment-expires="${expiresAt ?? ''}">${message.mediaKind === 'file' ? `<small>File · Download</small><strong>${fileName}</strong>` : 'Download'}</a>` : '';
            let content;
            if (!message.media && !expired) {
                content = `<div class="chat-share-card"><strong>${fileName}</strong><small>Attachment unavailable.</small></div>`;
            } else if (expired) {
                content = `<div class="chat-share-card"><strong>${fileName}</strong><small>Expired · Ask the sender to resend.</small></div>`;
            } else {
                const media = message.mediaKind === 'video'
                    ? `<button type="button" class="chat-gallery-preview" data-open-gallery-attachment aria-label="Open video attachment"><video muted playsinline preload="metadata" src="${escapeHtml(message.media)}"></video><span aria-hidden="true">▶</span></button>`
                    : message.mediaKind === 'file' ? download
                        : `<button type="button" class="chat-gallery-preview" data-open-gallery-attachment aria-label="Open photo attachment"><img src="${escapeHtml(message.media)}" alt="" /></button>`;
                content = media;
                if (expiresAt) {
                    content += `<small>Download by ${escapeHtml(new Date(expiresAt).toLocaleString())}</small>`;
                }
            }
            return `<article class="chat-message ${message.from === 'me' ? 'from-me' : 'from-them'} chat-attachment${message.sticker ? ' chat-sticker-message' : message.animated ? ' chat-gif-message' : ''}">${content}${message.caption ? `<p>${escapeHtml(message.caption)}</p>` : ''}<time>${escapeHtml(formatConversationTime(message.sentAt))}</time></article>`;
        }
        return `
      <article class="chat-message chat-text-message ${message.from === "me" ? "from-me" : "from-them"}">
        ${message.replyToId != null ? renderReplyQuote(messagesById.get(message.replyToId), conversation) : ''}
        <p>${escapeHtml(message.text)}</p>
        <time>${escapeHtml(formatConversationTime(message.sentAt))}</time>
      </article>
    `;
}

function readReceiptLabel(readAt) {
    const seconds = (Date.now() - Date.parse(readAt)) / 1000;
    if (!Number.isFinite(seconds)) return 'Seen';
    if (seconds < 60) return 'Seen just now';
    if (seconds < 3600) return `Seen ${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `Seen ${Math.floor(seconds / 3600)}h ago`;
    return `Seen ${Math.floor(seconds / 86400)}d ago`;
}

export function refreshReadReceiptLabel(chat) {
    const receipt = document.querySelector('.chat-read-receipt');
    if (receipt) {
        const label = readReceiptLabel(chat.peerReadAt);
        if (receipt.textContent !== label) receipt.textContent = label;
    }
}

function renderConnectedChat(list, chat, { preserveComposer, preserveHistoryAnchor, scrollToLatest }) {
    const messages = state.blockedHandles.has(chat.handle) ? [] : chat.messages;
    const byId = new Map(messages.map(message => [message.id, message]));
    const seenAt = Date.parse(chat.peerSeenAt);
    const seenMessage = messages.findLast(message => message.from === 'me' && message.sentAt <= seenAt);
    const wallpaper = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(chat.wallpaper || '') ? chat.wallpaper : '';
    const bubbles = messages.map(message => {
        const markup = renderConversationMessage(message, chat, byId);
        const sender = chat.isGroup && message.from !== 'me' ? chat.senderNames?.[message.senderId] || 'Former member' : '';
        const badges = (message.reactions || []).map(reaction => reaction.emoji).join(' ');
        const receipt = seenMessage === message
            ? `<span class="chat-read-receipt">${readReceiptLabel(chat.peerReadAt)}</span>` : '';
        return markup.replace('<article ', `<article data-reactable-message="${escapeHtml(String(message.id))}" `)
            .replace(/^(<article[^>]*>)/, tag => tag + (sender ? `<small class="chat-group-sender">${escapeHtml(sender)}</small>` : ''))
            .replace('</article>', `<span class="chat-message-reaction" role="status"${badges ? '' : ' hidden'}>${escapeHtml(badges)}</span>${receipt}</article>`);
    }).join('') || `<p class="chat-empty">${chat.cloudLoaded ? 'Start with a message.' : 'Loading messages…'}</p>`;
    const invitation = '<p class="chat-empty">Accept this invitation to join the group.</p><div class="group-invitation-actions"><button type="button" data-group-invite="accept">Accept invitation</button><button type="button" data-group-invite="decline">Decline</button></div>';
    const markup = chat.membershipStatus === 'pending' ? invitation : (chat.cloudHasOlder && messages.length
        ? '<button type="button" class="chat-load-older" data-load-older-chat>Load older messages</button>'
        : '') + bubbles;
    let history = list.querySelector('.chat-history');
    if (preserveComposer && history && Boolean(list.querySelector('.chat-composer')) === Boolean(chat.cloudCanSend)) {
        const previousHeight = history.scrollHeight;
        const previousTop = history.scrollTop;
        const atBottom = previousHeight - previousTop - history.clientHeight < 40;
        const avatar = list.querySelector('.chat-header-identity img');
        if (avatar) avatar.src = chat.avatar;
        const name = list.querySelector('.chat-header-copy strong');
        if (name) name.textContent = chat.user;
        history.classList.toggle('chat-history-custom', Boolean(wallpaper));
        history.style.backgroundImage = wallpaper ? `url("${wallpaper}")` : '';
        history.innerHTML = markup;
        if (preserveHistoryAnchor) history.scrollTop = previousTop + history.scrollHeight - previousHeight;
        else if (atBottom || scrollToLatest) history.scrollTop = history.scrollHeight;
        else history.scrollTop = previousTop;
        return;
    }
    list.innerHTML = `
      <section class="chat-window" aria-label="Chat with ${escapeHtml(chat.user)}">
        <header class="chat-header">
          <button class="chat-back-button" type="button" data-chat-back aria-label="Back to messages">‹</button>
          ${renderChatIdentity(chat, chat.avatar)}
            ${renderConversationActions(chat, chat.cloudCanSend)}
        </header>
        <div class="chat-history${wallpaper ? ` chat-history-custom" style="background-image:url(${wallpaper})` : ''}" aria-live="polite">${markup}</div>
        ${chat.cloudCanSend ? renderChatComposer() : chat.cloudLoaded && !chat.isGroup ? '<p class="chat-empty">Messaging requires an accepted follow between these accounts.</p>' : ''}
      </section>`;
    history = list.querySelector('.chat-history');
    history.scrollTop = history.scrollHeight;
}

export function appendChatMessage(conversation, message, options) {
    conversation.messages = conversation.messages || [];
    const sentAt = Date.now();
    const expiresAt = message.type === 'attachment' ? attachmentExpiryForSize(message.fileSize, sentAt) : undefined;
    conversation.messages.push({ ...message, id: `chat-${sentAt}-${Math.random().toString(36).slice(2, 8)}`, sentAt, ...(expiresAt ? { expiresAt } : {}) });
    conversation.lastActivity = sentAt;
    conversation.lastMessage = getConversationPreview(conversation);
    renderMessages(options);
}
