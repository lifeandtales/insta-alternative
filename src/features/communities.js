import { getSupabaseClient } from '../storage/supabase.js';
import { state } from '../core/state.js';
import { escapeHtml as esc } from '../core/utils.js';

let dialog, catalog = [], selected, entries = [], mode = 'list', busy = false, generation = 0;
let accountId, directoryReturnSlug;
let screen = 'directory', storyIndex = 0, storyRows = [], pollTimer;
const accept = 'image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime';
const icon = (name) => name === 'grid'
    ? '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h7v7H3zm11 0h7v7h-7zM3 14h7v7H3zm11 0h7v7h-7z"/></svg>'
    : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h18v7H3zm0 11h18v7H3z"/></svg>';
const relative = time => {
    const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(time)) / 60000));
    return minutes < 1 ? 'Just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
};
function result(response) { if (response.error) throw response.error; return response.data; }
async function api() { return getSupabaseClient(); }
async function rpc(name, args) { return result(await (await api()).rpc(name, args)); }
function notice(text, error = false) {
    const node = dialog?.querySelector('[data-community-notice]');
    if (node) { node.textContent = text; node.setAttribute('role', error ? 'alert' : 'status'); }
}
function shell(title, content) {
    dialog.innerHTML = `<header class="community-top"><button type="button" data-community-back aria-label="Back">‹</button><h2>${esc(title)}</h2><button type="button" data-community-close aria-label="Close communities">×</button></header><p class="community-notice" data-community-notice role="status"></p><div class="community-content">${content}</div>`;
}
function showError(error) {
    notice(/function|relation|schema cache/i.test(error?.message || '')
        ? 'Communities are not ready on the server yet. Apply the Communities migration, then try again.'
        : 'Could not complete this action. Check your connection and try again.', true);
}
function followedNavigation() {
    const followed = catalog.filter(c => c.following);
    return `<nav class="community-followed-nav" aria-label="Your communities">${followed.map(c => `<button type="button" class="community-followed-circle" data-community-open="${esc(c.slug)}" aria-label="Open ${esc(c.name)}" aria-current="${selected?.slug === c.slug ? 'page' : 'false'}"><span>${esc(c.name)}</span></button>`).join('')}<button type="button" class="community-add-circle" data-community-directory aria-label="Add communities"><span aria-hidden="true">+</span></button></nav>`;
}
function drawDirectory() {
    screen = 'directory'; selected = null;
    const available = catalog.filter(c => !c.following);
    shell(catalog.some(c => c.following) ? 'Add communities' : 'Communities', `<p>Find your interests. Follow a community to share posts and stories.</p><div class="community-directory">${available.length ? available.map(c => `<button type="button" data-community-open="${esc(c.slug)}"><span class="community-topic-icon" aria-hidden="true">${esc(c.icon)}</span><strong>${esc(c.name)}</strong><small>${c.followers} followers</small></button>`).join('') : '<p>You are following all communities.</p>'}</div><button type="button" data-community-refresh>Refresh</button>`);
}
async function openDefaultCommunity() {
    catalog = await rpc('community_directory');
    if (!dialog.open) return;
    const first = catalog.find(c => c.following);
    if (first) await loadCommunity(first.slug);
    else drawDirectory();
}

function media(row, controls = true) {
    return row.mime_type.startsWith('video/')
        ? `<video src="${esc(row.url)}" ${controls ? 'controls' : ''} playsinline preload="metadata"></video>`
        : `<img src="${esc(row.url)}" alt="${esc(row.caption || 'Community post')}" loading="lazy" />`;
}
function post(row, grid = false) {
    if (grid) return `<button type="button" class="community-grid-post" data-community-post="${esc(row.id)}" aria-label="Open post by ${esc(row.display_name || row.username)}">${media(row, false)}${row.mime_type.startsWith('video/') ? '<span>▶</span>' : ''}</button>`;
    return `<article class="community-post" data-community-entry="${esc(row.id)}"><header><strong>${esc(row.display_name || row.username)}</strong><small>${esc(relative(row.created_at))}</small></header>${media(row)}${row.caption ? `<p class="community-caption">${esc(row.caption)}</p>` : ''}<div class="community-post-actions"><button type="button" data-community-like="${esc(row.id)}" aria-pressed="${row.liked}" aria-label="${row.liked ? 'Unlike' : 'Like'} post">${row.liked ? '♥' : '♡'} ${row.likes}</button><button type="button" data-community-comments="${esc(row.id)}">Comments ${row.comments}</button><button type="button" data-community-download="${esc(row.id)}">Download</button>${row.author_id === state.signedInAccountId ? `<button type="button" data-community-delete="${esc(row.id)}">Delete</button>` : ''}</div></article>`;
}
function drawCommunity() {
    screen = 'community';
    const c = selected;
    shell(c.name, `${followedNavigation()}<section class="community-profile"><div class="community-avatar-wrap"><button type="button" class="community-avatar ${c.has_stories ? 'has-stories' : ''}" data-community-stories aria-label="${c.has_stories ? 'View community stories' : 'Add community story'}">${esc(c.icon)}</button><button type="button" class="community-story-add" data-community-upload="story" aria-label="Add community story">+</button></div><h3>${esc(c.name)}</h3><p>${esc(c.description)}</p><div class="community-counts"><span><strong>${c.followers}</strong> followers</span><span><strong>${c.posts}</strong> posts</span></div><div class="community-profile-actions"><button type="button" data-community-follow>${c.following ? 'Unfollow' : 'Follow'}</button>${c.following ? `<button type="button" data-community-mute aria-pressed="${c.muted}">${c.muted ? 'Unmute' : 'Mute'}</button><button type="button" data-community-upload="post">Create post</button>` : ''}</div></section><div class="community-feed-toolbar"><h3>Posts</h3><button type="button" data-community-refresh aria-label="Refresh community">↻</button><button type="button" data-community-mode="grid" aria-label="Grid view" aria-pressed="${mode === 'grid'}">${icon('grid')}</button><button type="button" data-community-mode="list" aria-label="List view" aria-pressed="${mode === 'list'}">${icon('list')}</button></div><div class="community-feed ${mode === 'grid' ? 'community-grid' : ''}">${entries.length ? entries.map(row => post(row, mode === 'grid')).join('') : '<p>No posts yet. Be the first to share.</p>'}</div>${entries.length && entries.length % 50 === 0 ? '<button type="button" data-community-more>Load older posts</button>' : ''}`);
}
async function signedRows(rows) {
    if (!rows?.length) return [];
    const client = await api();
    return Promise.all(rows.map(async row => {
        const signed = result(await client.storage.from('community-media').createSignedUrl(row.object_path, 300));
        return { ...row, url: signed.signedUrl };
    }));
}
async function loadCommunity(slug, more = false) {
    const token = ++generation;
    const directory = await rpc('community_directory');
    const found = directory.find(c => c.slug === slug);
    if (!found) throw new Error('Community unavailable');
    const rows = await signedRows(await rpc('community_feed', { target: slug, entry_kind: 'post', before_time: more ? entries.at(-1)?.created_at : null }));
    if (!dialog.open || token !== generation) return;
    catalog = directory; selected = found;
    entries = more ? [...entries, ...rows.filter(row => !entries.some(old => old.id === row.id))] : rows;
    drawCommunity();
}
async function refresh() {
    if (selected) await loadCommunity(selected.slug);
    else { catalog = await rpc('community_directory'); if (dialog.open) drawDirectory(); }
}
function drawUpload(kind) {
    if (!selected.following) { notice('Follow this community before sharing.'); return; }
    screen = 'upload';
    shell(`Add ${kind === 'story' ? 'story' : 'post'} to ${selected.name}`, `<form class="community-upload" data-community-upload-form="${kind}"><p>Shared with everyone in this community.${kind === 'story' ? ' Stories expire after 24 hours.' : ''}</p><label>Photo or video<input type="file" name="media" accept="${accept}" required /></label><div class="community-upload-preview"></div><label>Caption<textarea name="caption" maxlength="2200" rows="3" placeholder="Tell the community about it…"></textarea></label><button type="submit">Publish ${kind}</button></form>`);
}
let previewUrl;
function revokePreview() { if (previewUrl) URL.revokeObjectURL(previewUrl); previewUrl = null; }
async function publish(form) {
    const kind = form.dataset.communityUploadForm, file = form.elements.media.files[0];
    if (!file || !accept.split(',').includes(file.type) || file.size > 50000000) {
        notice('Choose a supported photo or video up to 50 MB.', true); return;
    }
    const client = await api();
    const user = result(await client.auth.getUser()).user;
    if (!user) throw new Error('Login required');
    const id = crypto.randomUUID(), path = `${user.id}/${id}/media`, slug = selected.slug;
    const now = new Date();
    result(await client.storage.from('community-media').upload(path, file, { contentType: file.type, upsert: false }));
    try {
        result(await client.from('community_entries').insert({ id, community_slug: slug, author_id: user.id, kind,
            caption: form.elements.caption.value.trim(), object_path: path, mime_type: file.type,
            created_at: now.toISOString(), expires_at: kind === 'story' ? new Date(now.getTime() + 86400000).toISOString() : null }));
    } catch (error) {
        await client.storage.from('community-media').remove([path]); throw error;
    }
    revokePreview();
    await loadCommunity(slug);
    notice(`${kind === 'story' ? 'Story' : 'Post'} published.`);
}
function drawStory() {
    screen = 'stories';
    storyRows = storyRows.filter(row => Date.parse(row.expires_at) > Date.now());
    if (!storyRows.length) { drawCommunity(); notice('No active stories right now.'); return; }
    storyIndex = Math.min(storyIndex, storyRows.length - 1);
    const row = storyRows[storyIndex];
    shell(`${selected.name} stories`, `<div class="community-story-view"><p><strong>${esc(row.display_name || row.username)}</strong> · ${esc(relative(row.created_at))} · ${storyIndex + 1}/${storyRows.length}</p>${media(row)}<p>${esc(row.caption)}</p><div class="community-story-controls"><button type="button" data-community-story-prev ${storyIndex === 0 ? 'disabled' : ''}>Previous</button><button type="button" data-community-like="${esc(row.id)}" aria-pressed="${row.liked}">${row.liked ? '♥' : '♡'} ${row.likes}</button><button type="button" data-community-story-next ${storyIndex === storyRows.length - 1 ? 'disabled' : ''}>Next</button>${row.author_id === state.signedInAccountId ? `<button type="button" data-community-delete="${esc(row.id)}">Delete</button>` : ''}</div></div>`);
}
async function comments(row) {
    const token = ++generation;
    const client = await api();
    const rows = result(await client.from('community_comments').select('id,body,author_id,created_at,profiles(display_name,username)').eq('entry_id', row.id).order('created_at').limit(200));
    if (!dialog.open || token !== generation) return;
    screen = 'comments';
    shell('Comments', `<div class="community-comments">${rows.length ? rows.map(c => `<article><strong>${esc(c.profiles?.display_name || c.profiles?.username || 'Member')}</strong><p>${esc(c.body)}</p><small>${esc(relative(c.created_at))}</small></article>`).join('') : '<p>No comments yet.</p>'}</div><form data-community-comment-form="${esc(row.id)}"><label>Add a comment<textarea name="body" maxlength="1000" required rows="2"></textarea></label><button type="submit">Send comment</button></form>`);
}
async function action(button) {
    const client = await api();
    if (button.hasAttribute('data-community-close')) { dialog.close(); return; }
    if (button.hasAttribute('data-community-back')) {
        generation++; revokePreview();
        if (screen === 'directory') {
            if (directoryReturnSlug) { const slug = directoryReturnSlug; directoryReturnSlug = null; await loadCommunity(slug); }
            else dialog.close();
        }
        else if (screen === 'community') { if (selected?.following) dialog.close(); else drawDirectory(); }
        else drawCommunity();
        return;
    }
    if (button.hasAttribute('data-community-directory')) { directoryReturnSlug = selected?.slug; drawDirectory(); return; }
    if (button.dataset.communityOpen) { await loadCommunity(button.dataset.communityOpen); return; }
    if (button.hasAttribute('data-community-refresh')) { await refresh(); return; }
    if (button.hasAttribute('data-community-more')) { await loadCommunity(selected.slug, true); return; }
    if (button.dataset.communityMode) { mode = button.dataset.communityMode; drawCommunity(); return; }
    if (button.hasAttribute('data-community-follow')) {
        const query = client.from('community_subscriptions');
        const wasFollowing = selected.following;
        result(wasFollowing ? await query.delete().eq('community_slug', selected.slug).eq('user_id', state.signedInAccountId)
            : await query.insert({ community_slug: selected.slug, user_id: state.signedInAccountId }));
        directoryReturnSlug = null;
        if (wasFollowing) await openDefaultCommunity();
        else await loadCommunity(selected.slug);
        return;
    }
    if (button.hasAttribute('data-community-mute')) {
        result(await client.from('community_subscriptions').update({ muted: !selected.muted }).eq('community_slug', selected.slug).eq('user_id', state.signedInAccountId));
        await loadCommunity(selected.slug); return;
    }
    if (button.dataset.communityUpload) { drawUpload(button.dataset.communityUpload); return; }
    if (button.hasAttribute('data-community-stories')) {
        if (!selected.has_stories) { drawUpload('story'); return; }
        storyRows = (await signedRows(await rpc('community_feed', { target: selected.slug, entry_kind: 'story' }))).reverse();
        storyIndex = 0; drawStory(); return;
    }
    if (button.hasAttribute('data-community-story-prev')) { storyIndex--; drawStory(); return; }
    if (button.hasAttribute('data-community-story-next')) { storyIndex++; drawStory(); return; }
    const entryId = button.dataset.communityLike || button.dataset.communityComments || button.dataset.communityDownload || button.dataset.communityDelete || button.dataset.communityPost;
    const row = [...entries, ...storyRows].find(item => item.id === entryId);
    if (!row) return;
    if (button.dataset.communityLike) {
        result(row.liked ? await client.from('community_likes').delete().eq('entry_id', row.id).eq('user_id', state.signedInAccountId)
            : await client.from('community_likes').insert({ entry_id: row.id, user_id: state.signedInAccountId }));
        row.likes = Number(row.likes) + (row.liked ? -1 : 1); row.liked = !row.liked;
        if (screen === 'stories') drawStory(); else if (screen === 'post') drawPost(row); else drawCommunity();
    } else if (button.dataset.communityComments) await comments(row);
    else if (button.dataset.communityDelete) {
        if (!window.confirm('Delete this community post or story?')) return;
        result(await client.from('community_entries').delete().eq('id', row.id).eq('author_id', state.signedInAccountId));
        await client.storage.from('community-media').remove([row.object_path]);
        await loadCommunity(selected.slug);
    } else if (button.dataset.communityDownload) {
        const signed = result(await client.storage.from('community-media').createSignedUrl(row.object_path, 60, { download: `community-${row.id}.${({ 'image/jpeg': 'jpg', 'video/quicktime': 'mov' })[row.mime_type] || row.mime_type.split('/')[1]}` }));
        const link = document.createElement('a'); link.href = signed.signedUrl; link.download = 'community-media'; link.click();
    } else drawPost(row);
}
function drawPost(row) { screen = 'post'; shell(selected.name, post(row)); }
async function run(work, control) {
    if (busy) return;
    busy = true; if (control) control.disabled = true;
    try { await work(); } catch (error) { showError(error); }
    finally { busy = false; if (control?.isConnected) control.disabled = false; }
}
export async function openCommunities() {
    if (!state.signedInAccountId) return;
    if (!dialog) {
        dialog = document.createElement('dialog'); dialog.className = 'communities-page';
        dialog.setAttribute('aria-label', 'Communities'); document.body.append(dialog);
        dialog.addEventListener('close', () => { if (history.state?.communities) history.back(); generation++; clearInterval(pollTimer); revokePreview(); dialog.querySelectorAll('video').forEach(v => v.pause()); });
        dialog.addEventListener('click', event => {
            const button = event.target.closest('button');
            if (button) void run(() => action(button), button);
        });
        dialog.addEventListener('submit', event => {
            event.preventDefault(); const form = event.target;
            void run(async () => {
                if (form.matches('[data-community-upload-form]')) await publish(form);
                else if (form.matches('[data-community-comment-form]')) {
                    const body = form.elements.body.value.trim(); if (!body) return;
                    const row = entries.find(row => row.id === form.dataset.communityCommentForm);
                    result(await (await api()).from('community_comments').insert({ entry_id: row.id, author_id: state.signedInAccountId, body }));
                    row.comments = Number(row.comments) + 1; await comments(row);
                }
            }, form.querySelector('[type=submit]'));
        });
        dialog.addEventListener('change', event => {
            if (!event.target.matches('input[type=file]')) return;
            revokePreview(); const file = event.target.files?.[0]; if (!file) return;
            if (!accept.split(',').includes(file.type) || file.size > 50000000) { notice('Choose a supported photo or video up to 50 MB.', true); event.target.value = ''; return; }
            previewUrl = URL.createObjectURL(file);
            dialog.querySelector('.community-upload-preview').innerHTML = media({ url: previewUrl, mime_type: file.type, caption: 'Upload preview' });
        });
    }
    shell('Communities', '<p>Loading communities…</p>');
    accountId = state.signedInAccountId;
    directoryReturnSlug = null; selected = null; entries = []; storyRows = [];
    dialog.showModal();
    if (!history.state?.communities) history.pushState({ ...history.state, communities: true }, '');
    await run(openDefaultCommunity);
    clearInterval(pollTimer);
    // Refresh only passive directory/profile screens; never interrupt typing or playback.
    pollTimer = setInterval(() => {
        if (state.signedInAccountId !== accountId) { dialog.close(); return; }
        if (dialog.open && !document.hidden && ['directory', 'community'].includes(screen)
            && ![...dialog.querySelectorAll('video')].some(video => !video.paused) && !busy) {
            const scroll = dialog.scrollTop;
            void run(async () => { await refresh(); dialog.scrollTop = scroll; });
        }
    }, 30000);
}
export function registerCommunityEvents() {
    window.addEventListener('popstate', () => { if (dialog?.open && !history.state?.communities) dialog.close(); });
    document.addEventListener('click', event => {
        if (event.target.closest('[data-open-communities]')) void openCommunities();
    });
}
