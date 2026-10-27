import { canViewMedia, canViewStory, visibleAvatar, mediaNeedsWarning } from '../core/social.js';
import { findEntity } from '../data/entities.js';
import { state } from '../core/state.js';
import { escapeHtml, formatConversationTime } from '../core/utils.js';
import { conversations, posts, reels } from '../data/sample-data.js';
import { currentUser } from '../data/sample-data.js';
import { mayInteract } from '../core/social.js';
import { canSendToConversation, canShareToConversation } from './message-access.js';

export function conversationAvatar(conversation) {
    return conversation.isGroup ? conversation.photo || conversation.avatar : visibleAvatar(conversation.handle, conversation.avatar);
}

export function getConversationPreview(conversation) {
    const lastMessage = conversation.messages?.[conversation.messages.length - 1];
    if (!lastMessage)
        return conversation.lastMessage || "Start a conversation";
    if (lastMessage.type === "shared-post") return `${lastMessage.from === "me" ? "You: " : ""}Shared a ${lastMessage.entityType}`;
    if (lastMessage.type === "shared-story") return `${lastMessage.from === "me" ? "You: " : ""}Shared a story`;
    if (lastMessage.type === 'story-mention') return lastMessage.from === 'me' ? 'You mentioned them in your story' : 'Mentioned you in a story';
    if (lastMessage.type === "meme")
        return `${lastMessage.from === "me" ? "You: " : ""}Shared a meme`;
    if (lastMessage.type === "call")
        return `${lastMessage.from === "me" ? "Outgoing" : "Incoming"} ${lastMessage.media} call`;
    if (lastMessage.type === 'voice') return 'Voice message';
    if (lastMessage.type === 'attachment') return `Shared a ${lastMessage.mediaKind === 'video' ? 'video' : 'photo'}`;
    return `${lastMessage.from === "me" ? "You: " : ""}${lastMessage.text}`;
}

export function renderMessages() {
    const list = document.getElementById("messages-list");
    const conversation = conversations.find((item) => item.handle === state.activeConversationHandle);
    if (!conversation) {
        state.activeConversationHandle = null;
        state.chatAttachmentPickerOpen = false;
        list.innerHTML = `
      <header class="messages-inbox-header"><h2>Messages</h2><button type="button" data-create-group>New group</button></header>
      <div class="conversation-list">
        ${[...conversations].sort((left, right) => Number(right.pinned) - Number(left.pinned) || right.lastActivity - left.lastActivity).map((item) => `
          <button class="conversation-tile ${item.unread ? "unread" : ""}" type="button" data-open-conversation="${escapeHtml(item.handle)}">
            <img class="conversation-avatar" src="${escapeHtml(conversationAvatar(item))}" alt="" />
            <span class="conversation-copy">
              <strong>${escapeHtml(item.user)}</strong>
              <span class="conversation-handle">${item.isGroup ? `${item.members?.length || 0} members${item.pendingMembers?.length ? ` · ${item.pendingMembers.length} invited` : ''}` : escapeHtml(item.handle)}${item.pinned ? " · Pinned" : ""}${item.muted ? " · Muted" : ""}</span>
              <span class="conversation-preview">${item.membershipStatus === 'pending' ? 'Group invitation — review to join' : escapeHtml(getConversationPreview(item))}</span>
            </span>
            <span class="conversation-time">${escapeHtml(formatConversationTime(item.lastActivity))}</span>
          </button>
        `).join("")}
      </div>
      <p class="messages-local-note">Messages are saved on this device. Delivery and connected calls will be added later.</p>
    `;
        return;
    }
    conversation.unread = false;
    const canSend = canSendToConversation(conversation);
    const pending = conversation.membershipStatus === 'pending';
    const messageMarkup = (conversation.messages || []).map((message) => {
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
        if (message.type === 'voice') return `<article class="chat-message ${message.from === 'me' ? 'from-me' : 'from-them'}"><audio controls preload="metadata" src="${escapeHtml(message.media)}"></audio><time>${escapeHtml(formatConversationTime(message.sentAt))}</time><small>Voice message · stored in this browser preview</small></article>`;
        if (message.type === 'attachment') {
            const media = message.mediaKind === 'video'
                ? `<video controls playsinline preload="metadata" src="${escapeHtml(message.media)}"></video>`
                : `<img src="${escapeHtml(message.media)}" alt="Photo attachment" />`;
            return `<article class="chat-message ${message.from === 'me' ? 'from-me' : 'from-them'} chat-attachment">${media}${message.caption ? `<p>${escapeHtml(message.caption)}</p>` : ''}<time>${escapeHtml(formatConversationTime(message.sentAt))}</time></article>`;
        }
        return `
      <article class="chat-message ${message.from === "me" ? "from-me" : "from-them"}">
        <p>${escapeHtml(message.text)}</p>
        <time>${escapeHtml(formatConversationTime(message.sentAt))}</time>
      </article>
    `;
    }).join("");
    list.innerHTML = `
    <section class="chat-window" aria-label="Chat with ${escapeHtml(conversation.user)}">
      <header class="chat-header">
        <button class="chat-back-button" type="button" data-chat-back aria-label="Back to messages">‹</button>
        <img src="${escapeHtml(conversationAvatar(conversation))}" alt="" />
        <span class="chat-header-copy"><strong>${escapeHtml(conversation.user)}</strong><small>${conversation.isGroup ? `${conversation.members?.length || 0} members` : escapeHtml(conversation.handle)}</small></span>
        <button class="chat-call-button" type="button" data-chat-call="voice" aria-label="Open voice call preview" title="Voice call" ${canSend ? '' : 'disabled'}>☎</button>
        <button class="chat-call-button" type="button" data-chat-call="video" aria-label="Open video call preview" title="Video call" ${canSend ? '' : 'disabled'}>▣</button>
        <div class="chat-options-wrap">
          <button class="chat-options-button" type="button" data-chat-options aria-label="Chat options" aria-expanded="false">•••</button>
          <div class="chat-options-menu" role="menu" hidden>
            <button type="button" role="menuitem" data-chat-option="pin">${conversation.pinned ? "Unpin chat" : "Pin chat"}</button>
            <button type="button" role="menuitem" data-chat-option="mute">${conversation.muted ? "Unmute notifications" : "Mute notifications"}</button>
            <button type="button" role="menuitem" data-chat-option="unread">Mark as unread</button>
            ${conversation.isGroup ? '' : '<button type="button" role="menuitem" data-chat-option="profile">View profile</button>'}
            ${conversation.isGroup && conversation.admins?.includes(currentUser.handle) ? '<button type="button" role="menuitem" data-chat-option="manage-group">Manage group</button>' : ''}
          </div>
        </div>
      </header>
      <div class="chat-history" aria-live="polite">
        ${canSend ? '' : `<p class="chat-empty">${conversation.membershipStatus === 'pending' ? 'Accept this group invitation before viewing its history.' : state.verificationStatus !== 'approved' ? 'Messaging is unavailable while verification is pending.' : 'Messaging is paused while this account is blocked.'}</p>`}
        ${pending ? `<div class="group-invitation-actions"><button type="button" data-group-invite="accept">Accept invitation</button><button type="button" data-group-invite="decline">Decline</button></div>` : messageMarkup || '<p class="chat-empty">Start a conversation with a message or shared post.</p>'}
      </div>
      <div class="chat-attachment-picker" ${state.chatAttachmentPickerOpen && canSend ? "" : "hidden"}>
        <p>Share a post or reel</p>
        <div>${[...posts, ...reels].filter(item => canShareToConversation(item, conversation)).map((item) => {
        const type = item.reel ? "reel" : "post";
        const media = item.cover || (type === "reel" ? item.poster : item.media);
        const warning = mediaNeedsWarning(item) && !state.revealedMediaKeys.has(`${type}:${item.id}`);
        return `<button class="${warning ? 'sensitive-preview' : ''}" type="button" data-chat-share-type="${type}" data-chat-share-id="${item.id}" aria-label="Share ${warning ? 'sensitive ' : ''}${type} by ${escapeHtml(item.user)}"><img src="${escapeHtml(media)}" alt="" /></button>`;
    }).join("")}</div>
      </div>
      ${canSend ? `<form class="chat-composer">
        <button class="chat-attach-button" type="button" data-chat-attach aria-label="Share a post or reel">＋</button>
        <button class="chat-attach-button" type="button" data-chat-gallery aria-label="Attach a photo or video">▧</button>
        <input class="chat-gallery-input" type="file" accept="image/*,video/*" hidden />
        <button class="chat-attach-button" type="button" data-chat-voice aria-label="Record a voice message">🎙</button>
        <input name="message" type="text" maxlength="1000" placeholder="Message..." aria-label="Message" autocomplete="off" />
        <button class="chat-send-button" type="submit">Send</button>
      </form>` : ''}
    </section>
  `;
    const history = list.querySelector(".chat-history");
    history.scrollTop = history.scrollHeight;
}

export function appendChatMessage(conversation, message) {
    conversation.messages = conversation.messages || [];
    conversation.messages.push({ ...message, id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, sentAt: Date.now() });
    conversation.lastActivity = Date.now();
    conversation.lastMessage = getConversationPreview(conversation);
    conversation.unread = false;
    renderMessages();
}
