import { state } from '../core/state.js';

export function showShareFeedback(message) {
    if (state.deletionRequestedAt) return;
    const feedback = document.getElementById("share-feedback");
    feedback.textContent = message;
    feedback.hidden = false;
    window.clearTimeout(state.shareFeedbackTimeout);
    state.shareFeedbackTimeout = window.setTimeout(() => {
        feedback.hidden = true;
    }, 3200);
}
