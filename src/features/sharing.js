import { canViewMedia, mayInteract, visibleAvatar } from '../core/social.js';
import { currentUser } from '../data/sample-data.js';
import { findMessageRecipients, openCloudChat, sendCloudText } from './cloud-chat.js';
import { actionIcon } from '../components/action-icons.js';
import { mediaUrl } from '../core/media-links.js';
import { appendChatMessage } from './messages.js';
import { showShareFeedback } from '../components/feedback.js';
import { shareBackdrop, shareFriendsList, shareSendButton } from '../core/dom.js';
import { state } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { conversations } from '../data/sample-data.js';
import { getFollowedConnections } from './follows.js';
import { startStoryProgress } from './stories.js';
import { canViewStory } from '../core/social.js';

const recipientPageSize = 30;
let shareRevision = 0;
let loadMoreRecipients;

function shareFriendRows(recipients) {
    return recipients.map(friend => `
      <button class="share-friend" type="button" data-share-handle="${escapeHtml(friend.handle)}" aria-pressed="false">
        <img src="${escapeHtml(friend.avatar)}" alt="" />
        <span><strong>${escapeHtml(friend.user)}</strong><small>${escapeHtml(friend.handle)}</small></span>
        <span class="share-friend-check" aria-hidden="true">✓</span>
      </button>
    `).join('') || '<p class="share-friends-status" role="status">No friends available to send to.</p>';
}

function renderShareShortcuts(show) {
    const shortcuts = shareBackdrop.querySelector('.share-shortcuts');
    shortcuts.hidden = !show;
    shortcuts.innerHTML = !show ? '' : `
      <button type="button" data-share-shortcut="copy-link">${actionIcon('link')}<span>Copy link</span></button>
      <button type="button" data-share-shortcut="add-to-story">${actionIcon('story')}<span>Add to story</span></button>
      <button type="button" data-share-shortcut="share">${actionIcon('share')}<span>Share</span></button>`;
    shareBackdrop.classList.toggle('media-share-open', show);
}

export function openHighlightShareDialog(highlight) {
    if (!mayInteract()) return;
    const connections = getFollowedConnections();
    if (!connections.length) {
        showShareFeedback("Follow someone first to share this highlight with them.");
        return;
    }
    ++shareRevision;
    loadMoreRecipients = null;
    renderShareShortcuts(false);
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
    const shareable = type === 'story' ? canViewStory(post) : canViewMedia(post);
    if (!mayInteract() || !shareable) { showShareFeedback('This item is unavailable to share.'); return; }
    const revision = ++shareRevision;
    const owner = state.signedInAccountId;
    const media = type === 'post' || type === 'reel';
    const connected = owner && media && (post.cloudClientId || post.cloudContentId);
    renderShareShortcuts(media);
    const recipients = state.accountDirectory.filter(account => account.handle !== currentUser.handle && !state.blockedHandles.has(account.handle) && (type === 'story' ? canViewStory(post, account.handle) : canViewMedia(post, account.handle))).map(account => ({ handle: account.handle, user: account.name, avatar: visibleAvatar(account.handle, account.avatar) }));
    state.activeSharePost = post;
    if (type === 'story') {
        clearTimeout(state.storyAdvanceTimer);
        document.querySelector('.story-viewer-stage video')?.pause();
    }
    state.activeShareType = type;
    state.activeShareHighlight = null;
    state.activeShareConnections = recipients;
    state.selectedShareRecipients.clear();
    shareSendButton.disabled = true;
    document.getElementById("share-dialog-title").textContent = "Share with friends";
    shareFriendsList.innerHTML = connected ? '<p class="share-friends-status" role="status">Loading friends…</p>' : shareFriendRows(recipients);
    loadMoreRecipients = null;
    if (connected) {
        let offset = 0;
        let loading = false;
        state.activeShareConnections = [];
        loadMoreRecipients = async () => {
            if (loading) return;
            loading = true;
            const original = shareFriendsList.querySelector('[data-share-load-more]');
            if (original) original.disabled = true;
            try {
                const people = await findMessageRecipients('', offset);
                if (revision !== shareRevision || owner !== state.signedInAccountId) return;
                const friends = people.slice(0, recipientPageSize).filter(person => !state.blockedHandles.has(person.handle))
                    .map(person => ({ ...person, user: person.name }));
                const markup = shareFriendRows(friends);
                if (offset > 0) {
                    original?.remove();
                    if (friends.length) shareFriendsList.insertAdjacentHTML('beforeend', markup);
                } else shareFriendsList.innerHTML = markup;
                state.activeShareConnections.push(...friends);
                offset += Math.min(people.length, recipientPageSize);
                if (people.length > recipientPageSize) {
                    shareFriendsList.insertAdjacentHTML('beforeend', '<button type="button" class="share-load-more" data-share-load-more>Load more</button>');
                }
            } catch {
                if (revision === shareRevision && original) {
                    original.disabled = false;
                    showShareFeedback('Could not load more friends. Try again.');
                } else if (revision === shareRevision) {
                    shareFriendsList.innerHTML = '<button type="button" class="share-load-more" data-share-load-more>Retry loading friends</button>';
                }
            } finally {
                loading = false;
            }
        };
        void loadMoreRecipients();
    }
    shareBackdrop.hidden = false;
    document.body.classList.add("share-open");
    shareBackdrop.querySelector(".share-close").focus();
}

export function loadNextShareRecipients() {
    if (!shareBackdrop.hidden) void loadMoreRecipients?.();
}

export function closeShareDialog() {
    ++shareRevision;
    loadMoreRecipients = null;
    shareBackdrop.hidden = true;
    document.body.classList.remove("share-open");
    state.activeSharePost = null;
    state.activeShareType = "post";
    state.activeShareHighlight = null;
    state.activeShareConnections = conversations;
    if (!document.querySelector(".story-viewer-backdrop").hidden && state.activeStoryIndex >= 0) {
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
    if (!post || !mayInteract() || !(state.activeShareType === 'story' ? canViewStory(post) : canViewMedia(post))) return 0;
    let sent = 0;
    for (const person of state.activeShareConnections) {
        if (!state.selectedShareRecipients.has(person.handle) || state.blockedHandles.has(person.handle) || !(state.activeShareType === 'story' ? canViewStory(post, person.handle) : canViewMedia(post, person.handle))) continue;
        let chat = conversations.find(item => item.handle === person.handle);
        if (!chat) { chat = { ...person, messages: [] }; conversations.push(chat); }
        appendChatMessage(chat, state.activeShareType === 'story'
            ? { from: 'me', type: 'shared-story', story: { id: post.id, user: post.user, handle: post.handle, avatar: post.avatar, media: post.media, caption: post.caption || '' } }
            : { from: 'me', type: 'shared-post', entityType: state.activeShareType, entityId: post.id });
        sent++;
    }
    return sent;
}

export async function sendCloudSharedMedia(entity, type, recipients) {
    const owner = state.signedInAccountId;
    const url = mediaUrl(entity, type);
    const sent = [];
    for (const person of recipients) {
        if (owner !== state.signedInAccountId || !mayInteract() || !canViewMedia(entity)) break;
        if (!person.id || state.blockedHandles.has(person.handle)) continue;
        try {
            const chat = await openCloudChat(person, { fromInbox: true });
            if (owner !== state.signedInAccountId) break;
            await sendCloudText(chat, url);
            sent.push(person.handle);
        } catch {
            // Keep failed recipients selected so they can be retried.
        }
    }
    return sent;
}
