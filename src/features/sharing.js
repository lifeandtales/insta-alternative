import { canViewMedia, mayInteract, visibleAvatar } from '../core/social.js';
import { currentUser } from '../data/sample-data.js';
import { appendChatMessage } from './messages.js';
import { showShareFeedback } from '../components/feedback.js';
import { shareBackdrop, shareFriendsList, shareSendButton } from '../core/dom.js';
import { state } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { conversations } from '../data/sample-data.js';
import { getFollowedConnections } from './follows.js';
import { startStoryProgress } from './stories.js';

export function openHighlightShareDialog(highlight) {
    if (!mayInteract()) return;
    const connections = getFollowedConnections();
    if (!connections.length) {
        showShareFeedback("Follow someone first to share this highlight with them.");
        return;
    }
    state.activeSharePost = null;
    clearTimeout(state.storyAdvanceTimer);
    document.querySelector(".story-viewer-stage video")?.pause();
    state.activeShareType = "highlight";
    state.activeShareHighlight = highlight;
    state.activeShareConnections = connections;
    state.selectedShareRecipients.clear();
    shareSendButton.disabled = true;
    document.getElementById("share-dialog-title").textContent = "Share highlight with people you follow";
    shareFriendsList.innerHTML = connections.map((friend) => `
    <button class="share-friend" type="button" data-share-handle="${escapeHtml(friend.handle)}" aria-pressed="false">
      <img src="${escapeHtml(friend.avatar)}" alt="" />
      <span><strong>${escapeHtml(friend.user)}</strong><small>${escapeHtml(friend.handle)}</small></span>
      <span class="share-friend-check" aria-hidden="true">✓</span>
    </button>
  `).join("");
    shareBackdrop.hidden = false;
    document.body.classList.add("share-open");
    shareBackdrop.querySelector(".share-close").focus();
}

export function openShareDialog(post, type = "post") {
    if (!mayInteract() || !canViewMedia(post)) { showShareFeedback('This post is unavailable to share.'); return; }
    const recipients = state.accountDirectory.filter(account => account.handle !== currentUser.handle && !state.blockedHandles.has(account.handle) && canViewMedia(post, account.handle)).map(account => ({ handle: account.handle, user: account.name, avatar: visibleAvatar(account.handle, account.avatar) }));
    state.activeSharePost = post;
    state.activeShareType = type;
    state.activeShareHighlight = null;
    state.activeShareConnections = recipients;
    state.selectedShareRecipients.clear();
    shareSendButton.disabled = true;
    document.getElementById("share-dialog-title").textContent = "Share with friends";
    shareFriendsList.innerHTML = recipients.map((friend) => `
    <button class="share-friend" type="button" data-share-handle="${friend.handle}" aria-pressed="false">
      <img src="${friend.avatar}" alt="" />
      <span><strong>${escapeHtml(friend.user)}</strong><small>${escapeHtml(friend.handle)}</small></span>
      <span class="share-friend-check" aria-hidden="true">✓</span>
    </button>
  `).join("");
    shareBackdrop.hidden = false;
    document.body.classList.add("share-open");
    shareBackdrop.querySelector(".share-close").focus();
}

export function closeShareDialog() {
    shareBackdrop.hidden = true;
    document.body.classList.remove("share-open");
    state.activeSharePost = null;
    state.activeShareType = "post";
    state.activeShareHighlight = null;
    state.activeShareConnections = conversations;
    if (!document.querySelector(".story-viewer-backdrop").hidden && state.activeStoryHighlightId && state.activeStoryIndex >= 0) {
        const video = document.querySelector(".story-viewer-stage video");
        if (video) {
            video.play().catch((error) => {
                if (error.name !== "AbortError")
                    showShareFeedback("This highlight story couldn't resume.");
            });
        }
        startStoryProgress(state.activeStoryIndex);
    }
}

export function sendSharedPost() {
    const post = state.activeSharePost;
    if (!post || !mayInteract() || !canViewMedia(post)) return 0;
    let sent = 0;
    for (const person of state.activeShareConnections) {
        if (!state.selectedShareRecipients.has(person.handle) || state.blockedHandles.has(person.handle) || !canViewMedia(post, person.handle)) continue;
        let chat = conversations.find(item => item.handle === person.handle);
        if (!chat) { chat = { ...person, messages: [] }; conversations.push(chat); }
        appendChatMessage(chat, { from: 'me', type: 'shared-post', entityType: state.activeShareType, entityId: post.id });
        sent++;
    }
    return sent;
}
