import { showShareFeedback } from '../components/feedback.js';
import { state } from '../core/state.js';
import { communities, currentUser } from '../data/sample-data.js';
import { renderProfile } from '../features/profile.js';
import { renderStories } from '../features/stories.js';

export function getSavedItemKey(type, id) {
    return `${type}:${id}`;
}

export function loadSavedItems() {
    try {
        const stored = JSON.parse(localStorage.getItem("insta-saved-items") || "[]");
        if (!Array.isArray(stored) || stored.some((item) => typeof item !== "string")) {
            state.savedStorageWarning = true;
            return new Set();
        }
        return new Set(stored);
    }
    catch {
        state.savedStorageWarning = true;
        return new Set();
    }
}

export function persistSavedItems() {
    try {
        localStorage.setItem("insta-saved-items", JSON.stringify([...state.savedItems]));
        return true;
    }
    catch {
        return false;
    }
}

export function loadJoinedCommunities() {
    try {
        const stored = JSON.parse(localStorage.getItem("insta-joined-communities") || "[]");
        if (!Array.isArray(stored) || stored.some((id) => typeof id !== "string")) {
            return new Set();
        }
        const validIds = new Set(communities.map((community) => community.id));
        return new Set(stored.filter((id) => validIds.has(id)));
    }
    catch {
        return new Set();
    }
}

export function persistJoinedCommunities() {
    try {
        localStorage.setItem("insta-joined-communities", JSON.stringify([...state.joinedCommunityIds]));
        return true;
    }
    catch (error) {
        console.error("Could not save community membership", error);
        return false;
    }
}

export function openInstaDatabase() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) {
            reject(new Error("IndexedDB is not available in this browser."));
            return;
        }
        const request = window.indexedDB.open("insta-browser-data", 1);
        request.onupgradeneeded = () => {
            if (!request.result.objectStoreNames.contains("app-data")) {
                request.result.createObjectStore("app-data");
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Could not open browser storage."));
    });
}

export function waitForTransaction(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = resolve;
        transaction.onabort = () => reject(transaction.error || new Error("Browser storage transaction was aborted."));
        transaction.onerror = () => reject(transaction.error || new Error("Browser storage transaction failed."));
    });
}

export function waitForRequest(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error("Browser storage request failed."));
    });
}

export async function serializeStoryMedia(story) {
    async function pack(value) {
        if (typeof value === 'string' && value.startsWith('blob:')) {
            const response=await fetch(value);
            if(!response.ok)throw new Error('Could not read Story media for browser storage.');
            return response.blob();
        }
        if(Array.isArray(value))return Promise.all(value.map(pack));
        if(value && typeof value==='object' && !(value instanceof Blob)) {
            const result={};for(const [key,item] of Object.entries(value))result[key]=await pack(item);return result;
        }
        return value;
    }
    return pack(story);
}

export function restoreStoryMedia(story) {
    function unpack(value){
        if(value instanceof Blob)return URL.createObjectURL(value);
        if(Array.isArray(value))return value.map(unpack);
        if(value && typeof value==='object')return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,unpack(item)]));
        return value;
    }
    return unpack(story);
}

export async function storeInstaData(key, value) {
    const database = await openInstaDatabase();
    try {
        const transaction = database.transaction("app-data", "readwrite");
        const completed = waitForTransaction(transaction);
        transaction.objectStore("app-data").put(value, key);
        await completed;
    }
    finally {
        database.close();
    }
}

export async function loadStoryHighlights() {
    const database = await openInstaDatabase();
    let expiredStoriesFound = false;
    try {
        const transaction = database.transaction("app-data", "readonly");
        const completed = waitForTransaction(transaction);
        const store = transaction.objectStore("app-data");
        const [storedHighlights, storedStories] = await Promise.all([
            waitForRequest(store.get("story-highlights")),
            waitForRequest(store.get("active-stories"))
        ]);
        await completed;
        if (storedHighlights !== undefined) {
            if (!Array.isArray(storedHighlights))
                throw new Error("Saved highlight data has an invalid format.");
            state.storyHighlights = storedHighlights.map((highlight) => ({
                ...highlight,
                stories: highlight.stories.map(restoreStoryMedia)
            }));
        }
        if (storedStories !== undefined) {
            if (!Array.isArray(storedStories))
                throw new Error("Saved story data has an invalid format.");
            const now = Date.now();
            const activeStories = storedStories.filter((story) => story.handle === currentUser.handle && story.expiresAt > now);
            expiredStoriesFound = activeStories.length !== storedStories.length;
            const uniqueStories = new Map(activeStories.map(story => [story.id, story]));
            state.stories = state.stories.filter(story => story.handle !== currentUser.handle);
            state.stories.push(...[...uniqueStories.values()].map(restoreStoryMedia));
        }
    }
    finally {
        database.close();
    }
    if (expiredStoriesFound) {
        persistActiveStories().catch((error) => {
            console.error("Could not remove expired stories from browser storage", error);
            showShareFeedback("Expired stories couldn't be removed from browser storage.");
        });
    }
    renderStories();
    if (state.currentView === "profile")
        renderProfile();
}

export async function persistStoryHighlights() {
    const stored = await Promise.all(state.storyHighlights.map(async (highlight) => ({
        ...highlight,
        stories: await Promise.all(highlight.stories.map(serializeStoryMedia))
    })));
    await storeInstaData("story-highlights", stored);
}

export async function persistActiveStories() {
    const activeStories = state.stories.filter((story) => story.handle === currentUser.handle && story.expiresAt > Date.now());
    const stored = await Promise.all(activeStories.map(serializeStoryMedia));
    await storeInstaData("active-stories", stored);
}
