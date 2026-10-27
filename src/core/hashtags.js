import { normalizeSearchText } from './utils.js';

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
