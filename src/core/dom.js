export const appShell = document.querySelector(".app-shell");
export const feed = document.getElementById("feed");
export const viewHeading = document.getElementById("view-heading");
export const commentsBackdrop = document.querySelector(".comments-backdrop");
export const commentsDialogList = document.querySelector(".comments-dialog-list");
export const commentsDialogForm = document.querySelector(".comments-dialog-form");
export const profilePostViewer = document.querySelector(".profile-post-viewer");
export const profilePostViewerContent = document.querySelector(".profile-post-viewer-content");
export const exploreSearchInput = document.querySelector(".search-wrap input");
export const exploreSearchResults = document.getElementById("explore-search-results");
export const exploreCommunityView = document.getElementById("community-view");
export const videoFullscreenBackdrop = document.querySelector(".video-fullscreen-backdrop");
export const videoFullscreenStage = document.querySelector(".video-fullscreen-stage");
export const mediaEditBackdrop = document.querySelector(".media-edit-backdrop");
export const mediaDeleteBackdrop = document.querySelector(".media-delete-backdrop");
export const likersBackdrop = document.querySelector(".likers-backdrop");
export const likersList = document.querySelector(".likers-list");
export const shareBackdrop = document.querySelector(".share-backdrop");
export const shareFriendsList = document.querySelector(".share-friends-list");
export const shareSendButton = document.querySelector(".share-send-button");
export const createMenuBackdrop = document.querySelector(".create-menu-backdrop");
export const createUploadBackdrop = document.querySelector(".create-upload-backdrop");
export const viewSections = {
    home: [feed],
    explore: [document.getElementById("explore-grid"), exploreCommunityView],
    reels: [document.getElementById("reels-feed")],
    messages: [document.getElementById("messages-list")],
    profile: [document.getElementById("profile-view")]
};
export const storyViewer = document.querySelector(".story-viewer");
