self.addEventListener('push', event => {
    let message = {};
    try { message = event.data?.json() || {}; } catch { /* A generic notification is still useful. */ }
    event.waitUntil(self.registration.showNotification('Insta Alternative', {
        body: typeof message.body === 'string' ? message.body : 'You have a new notification.',
        tag: typeof message.id === 'string' ? message.id : undefined,
    }));
});

self.addEventListener('notificationclick', event => {
    event.notification.close();
    const url = self.registration.scope;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const app = windows.find(client => client.url.startsWith(url));
        if (app) await app.focus();
        else await self.clients.openWindow(url);
    })());
});
