const observers = new WeakMap();
const requested = new WeakSet();

export function prepareNextPosts(current, canWarm, environment = globalThis) {
    const connection = environment.navigator?.connection;
    if (environment.document?.hidden || connection?.saveData || /^(slow-)?2g$/.test(connection?.effectiveType || '')) return;
    let card = current;
    for (let i = 0; i < 10 && (card = card?.nextElementSibling); i++) {
        if (!canWarm(card)) continue;
        for (const image of card.querySelectorAll('.post-media-stage img, .likeable-media > img')) {
            image.fetchPriority = 'low';
            image.loading = 'eager';
        }
        for (const video of card.querySelectorAll('.likeable-media video')) {
            video.preload = 'auto';
            if (!requested.has(video) && video.paused && video.readyState < 2) {
                video.load();
                requested.add(video);
            }
        }
    }
}

export function observePostPrefetch(container, canWarm, environment = globalThis) {
    observers.get(container)?.disconnect();
    if (!environment.IntersectionObserver) return;
    const observer = new environment.IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting)
            .sort((a, b) => Math.abs(a.boundingClientRect.top) - Math.abs(b.boundingClientRect.top));
        if (visible[0]) prepareNextPosts(visible[0].target, canWarm, environment);
    }, { threshold: [0, 0.25, 0.5] });
    observers.set(container, observer);
    container.querySelectorAll('.post-card').forEach(card => observer.observe(card));
}
