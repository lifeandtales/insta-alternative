export const TEMPORARY_ATTACHMENT_BYTES = 200_000_000;
const TEMPORARY_ATTACHMENT_MS = 24 * 60 * 60 * 1000;

export function attachmentExpiryForSize(size, sentAt) {
    return size > TEMPORARY_ATTACHMENT_BYTES ? sentAt + TEMPORARY_ATTACHMENT_MS : undefined;
}

export function isExpiredAttachment(message, now = Date.now()) {
    return message.type === 'attachment' && Number.isFinite(message.expiresAt) && message.expiresAt <= now;
}

export function expireChatAttachments(conversations, now = Date.now()) {
    let changed = false;
    let nextExpiry = Infinity;
    for (const chat of conversations) {
        for (const message of chat.messages || []) {
            if (message.type !== 'attachment' || !message.media || !Number.isFinite(message.expiresAt)) continue;
            if (isExpiredAttachment(message, now)) {
                if (typeof message.media === 'string' && message.media.startsWith('blob:')) URL.revokeObjectURL(message.media);
                delete message.media;
                changed = true;
            } else {
                nextExpiry = Math.min(nextExpiry, message.expiresAt);
            }
        }
    }
    return { changed, nextExpiry };
}
