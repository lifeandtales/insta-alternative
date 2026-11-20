import { findEntity } from '../data/entities.js';
import { hasReposted } from '../storage/cloud-reposts.js';
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
        const repost = menu.querySelector('[data-post-option="repost"]');
        const card = repost && postOptionButton.closest('[data-id]');
        const entity = card && findEntity(card.dataset.entityType || 'post', Number(card.dataset.id));
        if (open && entity) {
            repost.disabled = true;
            void hasReposted(entity).then(present => {
                repost.dataset.reposted = String(present);
                repost.textContent = present ? 'Remove repost' : 'Repost';
                repost.hidden = false;
                repost.disabled = false;
            }).catch(() => { repost.hidden = true; });
        }
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
