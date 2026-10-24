import { findEntity } from '../data/entities.js';
import { handlePostOption } from './media-options.js';

export function handlePostOptionsClick(event) {
    const postOptionButton = event.target.closest('[data-action="post-options"]');
    if (postOptionButton) {
        const menu = postOptionButton.parentElement.querySelector(".post-options-menu");
        const open = menu.hidden;
        document.querySelectorAll(".post-options-menu").forEach((item) => { item.hidden = true; });
        document.querySelectorAll('[data-action="post-options"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
        menu.hidden = !open;
        postOptionButton.setAttribute("aria-expanded", String(open));
        return true;
    }
    const postOption = event.target.closest("[data-post-option]");
    if (postOption) {
        const card = postOption.closest("[data-id]");
        const type = card.dataset.entityType || "post";
        const post = findEntity(type, Number(card.dataset.id));
        if (post)
            handlePostOption(postOption.dataset.postOption, post, type, postOption);
        document.querySelectorAll(".post-options-menu").forEach((item) => { item.hidden = true; });
        document.querySelectorAll('[data-action="post-options"]').forEach((button) => button.setAttribute("aria-expanded", "false"));
        return true;
    }
    return false;
}
