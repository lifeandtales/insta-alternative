import test from 'node:test';
import assert from 'node:assert/strict';
import { loadApp } from './helpers/app-harness.js';

test('chat location retries an unavailable fix with standard accuracy, then enables Send', async () => {
    const app = await loadApp();
    const attempts = [];
    app.context.navigator.geolocation = {
        getCurrentPosition(success, fail, options) {
            attempts.push(options.enableHighAccuracy);
            if (options.enableHighAccuracy) fail({ code: 2 });
            else success({ coords: { latitude: 12.345, longitude: 67.89, accuracy: 22.3 } });
        },
    };
    const status = {};
    const send = {};
    const place = {};
    const button = { form: {
        isConnected: true, elements: { place },
        querySelector: selector => selector === '.chat-location-status' ? status : send,
    } };
    app.exportsOf('src/features/messages.events.js').handleMessageClick({
        target: { closest: selector => selector === '[data-chat-current-location]' ? button : null },
    });
    assert.deepEqual(attempts, [true, false]);
    assert.equal(place.value, '12.345000, 67.890000');
    assert.equal(send.disabled, false);
    assert.match(status.textContent, /23 m/);
});
