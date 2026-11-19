self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    const zh = /^zh/i.test((self.navigator && self.navigator.language) || '');
    payload = { title: 'NodeTick', body: event.data ? event.data.text() : (zh ? '你有一条新提醒' : 'You have a new reminder') };
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'NodeTick', {
    body: payload.body || '',
    tag: payload.tag || undefined,
    icon: '/favicon.svg',
    badge: '/favicon.svg',
    silent: payload.sound === 'off',
    data: { url: payload.url || '/app/tasks/today' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/app/tasks/today', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        await client.navigate(target);
        return client.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
