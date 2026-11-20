import { findCloudChatMessages, loadCloudSearchContext } from './cloud-chat.js';
import { isExpiredAttachment } from './chat-attachment-expiry.js';
import { visibleConversationMessages } from './message-access.js';
import { state } from '../core/state.js';
import { escapeHtml, formatConversationTime } from '../core/utils.js';

const pageSize = 100;

function isSearchableFile(message) {
    return message.type === 'attachment' && message.mediaKind === 'file' && !message.voiceRecording;
}

function searchableMessages(chat) {
    if (state.blockedHandles.has(chat.handle)) return [];
    return visibleConversationMessages(chat).filter(message => (message.type === 'text' || isSearchableFile(message)) &&
        (!message.serverExpiresAt || message.serverExpiresAt > Date.now()));
}

function renderSearchMatch(message, selectedId) {
    const file = isSearchableFile(message);
    const expired = file && isExpiredAttachment(message);
    const timestamp = escapeHtml(formatConversationTime(message.sentAt));
    const selected = message.id === selectedId ? ' chat-search-highlighted' : '';
    const direction = message.from === 'me' ? 'from-me' : 'from-them';
    if (!file) {
        return `<article class="chat-message chat-text-message ${direction}${selected}">
          <p>${escapeHtml(message.text || '')}</p><time>${timestamp}</time>
        </article>`;
    }
    const name = escapeHtml(message.fileName || 'File');
    const url = message.media;
    const fileLabel = `<strong>${name}</strong>`;
    const available = !expired && url && /^(blob:|https?:)/.test(url);
    const content = available
        ? `<a class="chat-share-card" href="${escapeHtml(url)}" download="${name}" data-attachment-expires="${message.expiresAt || ''}">${fileLabel}<small>Download</small></a>`
        : `<div class="chat-share-card">${fileLabel}<small>${expired ? 'Expired after 24 hours. Ask the sender to resend.' : 'Attachment unavailable.'}</small></div>`;
    return `<article class="chat-message chat-attachment ${direction}${selected}${expired ? ' chat-search-expired' : ''}">
      ${content}<time>${timestamp}</time>
    </article>`;
}

export function openChatSearch(chat) {
    const view = document.querySelector('.chat-window');
    if (!view || view.classList.contains('chat-search-open')) return;
    const history = view.querySelector('.chat-history');
    view.classList.add('chat-search-open');
    history.insertAdjacentHTML('beforebegin', `<form class="chat-search" role="search" aria-label="Search chat">
      <input type="search" name="chatSearch" aria-label="Search messages or filenames" placeholder="Search chat" maxlength="100" autocomplete="off" />
      <button type="button" data-chat-search-older aria-label="Older match" title="Older match" disabled>↑</button>
      <button type="button" data-chat-search-newer aria-label="Newer match" title="Newer match" disabled>↓</button>
      <button type="button" data-chat-search-close aria-label="Close search" title="Close search">×</button>
    </form>
    <p class="chat-search-status" role="status" hidden></p>`);
    history.insertAdjacentHTML('afterend', '<div class="chat-history chat-search-history" aria-label="Chat search results" hidden></div>');
    const form = view.querySelector('.chat-search');
    const input = form.elements.chatSearch;
    const context = view.querySelector('.chat-search-history');
    const status = view.querySelector('.chat-search-status');
    const older = form.querySelector('[data-chat-search-older]');
    const newer = form.querySelector('[data-chat-search-newer]');
    const owner = state.signedInAccountId;
    let revision = 0;
    let timer;
    let busy = false;
    let canLoadOlder = false;
    let matches = [];
    let current = -1;
    let term = '';
    let contextMessages;

    const isCurrent = token => token === revision && form.isConnected && state.currentView === 'messages' &&
        state.signedInAccountId === owner && state.activeConversationHandle === chat.handle;
    const explain = text => {
        status.hidden = !text;
        status.textContent = text;
    };
    const syncArrows = () => {
        newer.disabled = busy || current < 1;
        older.disabled = busy || current < 0 || (current >= matches.length - 1 && !canLoadOlder);
    };
    const showOriginalHistory = () => {
        context.hidden = true;
        view.classList.remove('chat-search-results-open');
    };

    async function fillPage(token) {
        const rows = await findCloudChatMessages(chat, term, matches.at(-1));
        if (!isCurrent(token) || !rows) return false;
        matches.push(...rows.slice(0, pageSize));
        canLoadOlder = rows.length > pageSize;
        return true;
    }

    async function jumpTo(index, token) {
        if (index === matches.length && canLoadOlder) await fillPage(token);
        if (!isCurrent(token) || !matches[index]) return;
        const match = matches[index];
        let messages = contextMessages?.some(message => message.id === match.id) ? contextMessages : searchableMessages(chat);
        if (chat.cloudId && !messages.some(message => message.id === match.id)) {
            messages = await loadCloudSearchContext(chat, match);
            if (!isCurrent(token)) return;
        }
        current = index;
        if (!messages.some(message => message.id === match.id)) {
            showOriginalHistory();
            explain('This message is no longer available.');
            return;
        }
        contextMessages = messages;
        context.innerHTML = messages.map(message => renderSearchMatch(message, match.id)).join('');
        context.hidden = false;
        view.classList.add('chat-search-results-open');
        const row = context.querySelector('.chat-search-highlighted');
        const inset = row.getBoundingClientRect().top - context.getBoundingClientRect().top;
        context.scrollTop += inset - (context.clientHeight - row.offsetHeight) / 2;
        explain('');
    }

    async function moveBy(direction) {
        if (busy) return;
        const token = revision;
        busy = true;
        syncArrows();
        try {
            await jumpTo(current + direction, token);
        } catch {
            if (isCurrent(token)) explain('Could not load this result. Try again.');
        } finally {
            if (isCurrent(token)) {
                busy = false;
                syncArrows();
            }
        }
    }

    async function search(token) {
        if (!isCurrent(token)) return;
        try {
            if (!chat.cloudId || !await fillPage(token)) {
                if (!isCurrent(token)) return;
                matches = searchableMessages(chat)
                    .filter(message => (isSearchableFile(message) ? message.fileName || '' : message.text || '')
                        .toLowerCase().includes(term.toLowerCase()))
                    .reverse();
            }
            if (!isCurrent(token)) return;
            if (matches.length) await jumpTo(0, token);
            else explain('No matching messages or files.');
        } catch {
            if (isCurrent(token)) explain('Could not search this chat. Try again.');
        } finally {
            if (isCurrent(token)) {
                busy = false;
                syncArrows();
            }
        }
    }

    function scheduleSearch(delay) {
        const token = ++revision;
        window.clearTimeout(timer);
        term = input.value.trim();
        current = -1;
        canLoadOlder = false;
        matches = [];
        contextMessages = null;
        busy = Boolean(term);
        showOriginalHistory();
        explain(term ? 'Searching chat…' : '');
        syncArrows();
        if (term) timer = window.setTimeout(() => void search(token), delay);
    }

    function close() {
        revision += 1;
        window.clearTimeout(timer);
        showOriginalHistory();
        view.classList.remove('chat-search-open');
        form.remove();
        status.remove();
        context.remove();
        view.querySelector('[data-chat-options]')?.focus();
    }

    input.addEventListener('input', event => { if (!event.isComposing) scheduleSearch(180); });
    form.addEventListener('submit', event => { event.preventDefault(); scheduleSearch(0); });
    form.addEventListener('keydown', event => {
        if (event.key === 'Escape') { event.stopPropagation(); close(); }
    });
    older.addEventListener('click', () => { if (!older.disabled) void moveBy(1); });
    newer.addEventListener('click', () => { if (!newer.disabled) void moveBy(-1); });
    context.addEventListener('click', event => {
        const file = event.target.closest('[data-attachment-expires]');
        if (!file?.dataset.attachmentExpires || Number(file.dataset.attachmentExpires) > Date.now()) return;
        event.preventDefault();
        void moveBy(0);
    });
    form.querySelector('[data-chat-search-close]').addEventListener('click', close);
    input.focus();
}
