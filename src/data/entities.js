import { cloudSavedEntities } from '../storage/cloud-saved-items.js';
import { state } from '../core/state.js';
import { posts, reels } from './sample-data.js';

export function findEntity(type, id) {
    const collection = type === "reel" ? reels : posts;
    return collection.find(item => item.id === id) || cloudSavedEntities(type).find(item => item.id === id)
        || (type === 'post' ? state.cloudTaggedPosts?.get(state.profileHandle)?.find(item => item.id === id) : undefined);
}
