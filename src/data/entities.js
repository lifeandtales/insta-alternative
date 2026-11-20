import { getRepostedMedia } from '../storage/cloud-reposts.js';
import { cloudSavedEntities } from '../storage/cloud-saved-items.js';
import { state } from '../core/state.js';
import { posts, reels } from './sample-data.js';

export function findEntity(type, id) {
    const collection = type === "reel" ? reels : posts;
    return collection.find(item => item.id === id) || cloudSavedEntities(type).find(item => item.id === id)
        || getRepostedMedia().find(item => item.type === type && item.entity.id === id)?.entity
        || (type === 'post' ? state.cloudTaggedPosts?.get(state.profileHandle)?.find(item => item.id === id) : undefined);
}
