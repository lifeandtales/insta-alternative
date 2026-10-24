import { posts, reels } from './sample-data.js';

export function findEntity(type, id) {
    const collection = type === "reel" ? reels : posts;
    return collection.find((item) => item.id === id);
}
