export function formatCount(value) {
    if (value >= 999950000)
        return `${compactCountPart(value / 1000000000)}b`;
    if (value >= 999950)
        return `${compactCountPart(value / 1000000)}m`;
    if (value >= 1000000000)
        return `${compactCountPart(value / 1000000000)}b`;
    if (value >= 1000000)
        return `${compactCountPart(value / 1000000)}m`;
    if (value >= 1000)
        return `${compactCountPart(value / 1000)}k`;
    return value.toLocaleString();
}

export function compactCountPart(value) {
    return value.toFixed(1).replace(/\.0$/, "");
}

export function newestFirst(items) {
    return [...items].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function randomizeItems(items) {
    const shuffled = [...items];
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
        const swapIndex = Math.floor(Math.random() * (index + 1));
        [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
    }
    return shuffled;
}

export function escapeHtml(value) {
    return value.replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;"
    })[character]);
}

export function toDateTimeLocalValue(date) {
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
    return local.toISOString().slice(0, 16);
}

export function normalizeSearchText(value) {
    return value.toLocaleLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function normalizeHandle(value) {
    return '@' + String(value).trim().replace(/^@+/, '').toLowerCase();
}

export function formatConversationTime(timestamp) {
    const date = new Date(timestamp);
    if (!Number.isFinite(date.getTime()))
        return "";
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
        return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return date.toLocaleDateString([], { month: "short", day: "numeric" });
}
