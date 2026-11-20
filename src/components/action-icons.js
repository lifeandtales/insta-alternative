const paths = {
    like: '<path d="M12 20.25 4.5 13A4.5 4.5 0 0 1 11 6.8l1 1.1 1-1.1a4.5 4.5 0 0 1 6.5 6.2L12 20.25Z"/>',
    comment: '<path d="M7 18.1 3.7 20v-4.1A7 7 0 0 1 3 13V10a5 5 0 0 1 5-5h8a5 5 0 0 1 5 5v3a5 5 0 0 1-5 5H7Z"/><path d="M8 10h8m-8 3.6h4.5"/>',
    share: '<path d="M12.5 10H9.7C5.2 10 3 13 3 18.5c1.6-2.8 3.9-4.2 7.4-4.2h2.1V20L21 12l-8.5-8Z"/>',
    save: '<path d="M7 4h10a1.5 1.5 0 0 1 1.5 1.5v14l-6.5-4-6.5 4v-14A1.5 1.5 0 0 1 7 4Z"/>',
    'sound-on': '<path d="M4 9v6h4l5 4V5L8 9H4Zm12.5 1a3.2 3.2 0 0 1 0 4m2-6.5a6.1 6.1 0 0 1 0 9"/>',
    'sound-off': '<path d="M4 9v6h4l5 4V5L8 9H4Zm12 1 4 4m0-4-4 4"/>',
    options: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    link: '<path d="m9 15 6-6m-4-2 2-2a4 4 0 0 1 6 6l-2 2m-4 4-2 2a4 4 0 0 1-6-6l2-2"/>',
    story: '<circle cx="12" cy="12" r="9"/><path d="M12 8v8m-4-4h8"/>',
    mention: '<path d="M16.5 12a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0v1.5a2 2 0 0 0 4 0V12a8.5 8.5 0 1 0-3.7 7"/>',
    follow: '<circle cx="9" cy="7" r="3"/><path d="M3.5 19v-1a4.5 4.5 0 0 1 4.5-4.5h2a4.5 4.5 0 0 1 4.5 4.5v1M19 8v6m-3-3h6"/>',
};

export function actionIcon(name) {
    return `<svg class="action-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}
