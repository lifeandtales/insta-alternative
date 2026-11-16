import assert from 'node:assert/strict';
import test from 'node:test';
import { loadApp } from './helpers/app-harness.js';

test('a connected profile opens a direct chat and keeps the recipient inbox separate until a send', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { conversations } = app.exportsOf('src/data/sample-data.js');
    const { rememberCloudPerson } = app.exportsOf('src/features/cloud-people.js');
    const { openCloudChat, sendCloudText } = app.exportsOf('src/features/cloud-chat.js');
    const { renderMessages } = app.exportsOf('src/features/messages.js');
    const createElement = app.document.createElement;
    app.document.createElement = tag => Object.assign(createElement(tag), { remove() {} });
    app.document.head = { append: script => script.onload() };
    app.context.window.supabase = { createClient: () => ({
        rpc: async (name, args) => {
            assert.equal(name, 'open_mutual_chat');
            assert.equal(args.other_user, 'second');
            return { data: 'thread' };
        },
        from(table) {
            assert.equal(table, 'messages');
            return { insert(row) {
                assert.equal(row.conversation_id, 'thread');
                assert.equal(row.sender_id, 'first');
                return { select: () => ({ single: async () => ({ data: {
                    ...row, id: 'stored-message', created_at: '2026-11-16T12:00:00Z'
                } }) }) };
            } };
        }
    }) };
    state.signedInAccountId = 'first';
    const person = rememberCloudPerson({ id: 'second', username: 'seconduser', display_name: 'Second User', follow_status: 'accepted', mutual: true });
    const chat = await openCloudChat(person);
    renderMessages();
    assert.doesNotMatch(app.element('#messages-list').innerHTML, /Second User/);
    assert.equal(conversations.find(item => item.cloudId === 'thread'), chat);
    await sendCloudText(chat, 'Hi from Supabase');
    renderMessages();
    assert.match(app.element('#messages-list').innerHTML, /Hi from Supabase/);
    assert.equal(chat.messages[0].id, 'stored-message');
});

test('pull to refresh uses the first Reel or the top of the active scroller', async () => {
    const app = await loadApp();
    const { state } = app.exportsOf('src/core/state.js');
    const { registerHomePullToRefresh } = app.exportsOf('src/features/home.js');
    const shell = app.element('social-pull-shell');
    const scroller = app.element('social-reels-scroller');
    const views = [];
    registerHomePullToRefresh(shell, app.element('status-indicator'), async view => views.push(view), () => scroller);
    const event = (type, y) => app.listeners.find(listener => listener.key === 'social-pull-shell' && listener.type === type)
        .callback({ touches: [{ clientX: 20, clientY: y }], cancelable: true, preventDefault() {} });
    state.currentView = 'reels';
    scroller.scrollTop = 300;
    event('touchstart', 20);
    event('touchmove', 140);
    await event('touchend', 140);
    assert.deepEqual(views, []);
    scroller.scrollTop = 0;
    event('touchstart', 20);
    event('touchmove', 140);
    await event('touchend', 140);
    assert.deepEqual(views, ['reels']);
});
