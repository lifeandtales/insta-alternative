import { normalizeSearchText, newestFirst } from './utils.js';

export const hashtagKey = value => normalizeSearchText(String(value || '').replace(/^#/, ''));
export function extractHashtags(text) {
    return [...new Set((String(text || '').match(/#[\p{L}\p{N}_]+/gu) || []).map(tag => tag.slice(1)))];
}
export function storyHashtags(story) {
    const texts = story.repostedFromUser ? [] : [story.caption || ''];
    for (const edits of [story.edits, story.repostSourceEdits])
        for (const layer of edits?.layers || [])
            if (layer.type === 'text' || layer.type === 'hashtag') texts.push(layer.text || '');
    return [...new Set(texts.flatMap(extractHashtags))];
}

import { state } from './state.js';
import { canViewStory, getAccount } from './social.js';

export function isPublicHashtagItem(item, visited = new Set()) {
    if (item.public === false || item.audience === 'close-friends' || getAccount(item.handle)?.isPrivate) return false;
    if (item.repostedFromHandle && getAccount(item.repostedFromHandle)?.isPrivate) return false;
    if (item.repostedStoryId) {
        if (visited.has(item.id)) return false;
        const source = state.stories.find(story => story.id === item.repostedStoryId);
        if (source) { const chain = new Set(visited); chain.add(item.id); return isPublicHashtagItem(source, chain); }
    }
    return true;
}

export function getPublicHashtagStories(tag, now = Date.now()) {
    const key = hashtagKey(tag);
    if (!key || !/^[\p{L}\p{N}_]+$/u.test(key)) return [];
    const matches = story => storyHashtags(story).some(value => hashtagKey(value) === key);
    const stories = state.stories.filter(story => {
        const expiresAt = Number.isFinite(story.expiresAt) ? story.expiresAt : Number.isFinite(story.createdAt) ? story.createdAt + state.storyLifetimeMs : null;
        return !story.fromHighlight && (!Number.isFinite(story.createdAt) || story.createdAt <= now) && (expiresAt == null || expiresAt > now) && isPublicHashtagItem(story) && canViewStory(story) && matches(story);
    });
    return newestFirst([...new Map(stories.map(story => [story.id, story])).values()]);
}
