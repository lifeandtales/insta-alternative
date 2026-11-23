import { mediaBucket } from '../storage/s3-media-access.js';
import { requestReelStorage, isS3ReelAsset } from '../storage/s3-reel-access.js';
import { applyStoryComposition } from './story-composition.js';
import { reportKindLabel } from '../core/reporting.js?v=352';

const node = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
const timestamp = value => new Date(value).toLocaleString();

export async function signReviewAsset(client, asset) {
    let url;
    if (asset.namespace === 'reels' && isS3ReelAsset(asset.path)) {
        const id = asset.content_id || asset.path.split('/')[1];
        const result = await requestReelStorage(client, { action: 'read', ids: [id] });
        url = result.urls.find(item => item.path === asset.path)?.signedUrl;
    } else {
        const result = await mediaBucket(client, asset.namespace === 'reels' ? 'app-media' : asset.namespace).createSignedUrl(asset.path, 300);
        if (result.error) throw result.error;
        url = result.data?.signedUrl;
    }
    if (!url || !['https:', 'http:'].includes(new URL(url).protocol)) throw new Error('Preview unavailable');
    return url;
}

export function createAdminContentReview(client, { isActive, openProfile }) {
    function stopMedia(host) {
        host.querySelectorAll('video,audio').forEach(media => { media.pause(); media.removeAttribute('src'); media.load(); });
    }
    function renderItem(item, host, heading = 'Reported content') {
        host.append(node('h3', heading));
        if (!item) { host.append(node('p', 'This item was deleted or is no longer available.')); return; }
        const card = node('article'); card.className = 'admin-content-card';
        card.append(node('strong', reportKindLabel(item.kind)));
        if (item.author) card.append(node('p', '@' + item.author));
        if (item.owner_id && openProfile) {
            const visit = node('button', 'View author profile and content'); visit.type = 'button';
            visit.addEventListener('click', () => openProfile(item.owner_id)); card.append(visit);
        }
        if (item.caption) card.append(node('p', item.caption));
        if (item.parent_comment?.caption) { const quote = node('blockquote', item.parent_comment.caption); quote.prepend(node('strong', 'Replying to: ')); card.append(quote); }
        if (item.publish_at) card.append(node('small', 'Published ' + timestamp(item.publish_at)));
        if (item.expires_at) card.append(node('small', (new Date(item.expires_at).getTime() < Date.now() ? 'Expired ' : 'Expires ') + timestamp(item.expires_at)));
        if (item.source) card.append(node('p', 'Shared from ' + reportKindLabel(item.source.kind)));
        if (item.audience) card.append(node('p', 'Audience: ' + item.audience.replace('_', ' ')));
        host.append(card);
        const assets = (item.assets || []).slice(0, 32);
        if (!assets.length && !item.caption) card.append(node('p', 'No attachment or text is available for this item.'));
        for (const asset of assets) {
            const figure = node('figure'); figure.className = 'report-evidence'; card.append(figure);
            let attempt = 0;
            async function load() {
                const current = ++attempt;
                stopMedia(figure); figure.replaceChildren(node('p', 'Loading attachment…'));
                const active = () => current === attempt && isActive() && figure.isConnected;
                function failed() {
                    if (!active()) return;
                    stopMedia(figure);
                    const retry = node('button', 'Try attachment again'); retry.type = 'button';
                    retry.addEventListener('click', () => { void load(); });
                    figure.replaceChildren(node('p', 'Could not display this attachment. It may have expired or been deleted.'), retry);
                }
                try {
                    const url = await signReviewAsset(client, asset);
                    if (!active()) return;
                    figure.replaceChildren();
                    const type = asset.mime?.split('/')[0];
                    if (['image', 'video', 'audio'].includes(type)) {
                        const media = document.createElement(type === 'image' ? 'img' : type);
                        if (type === 'image') media.alt = 'Content under admin review';
                        else { media.controls = true; media.preload = 'metadata'; }
                        media.addEventListener('error', failed, { once: true });
                        media.src = url;
                        if (item.kind === 'story' && ['image', 'video'].includes(type)) {
                            const stage = node('div'); stage.className = 'admin-story-preview'; stage.append(media); figure.append(stage);
                            const edits = { ...(item.metadata?.edits || {}), music: null };
                            applyStoryComposition(stage, { edits });
                        } else figure.append(media);
                        if (asset.role === 'soundtrack') figure.append(node('figcaption', 'Story soundtrack'));
                    } else {
                        const link = node('a', 'Open reported attachment'); link.href = url; link.target = '_blank'; link.rel = 'noopener noreferrer'; figure.append(link);
                    }
                } catch { failed(); }
            }
            void load();
        }
    }

    async function renderProfile(profile, host) {
        stopMedia(host); host.replaceChildren();
        if (!profile) { host.append(node('p', 'The account is no longer available.')); return; }
        host.append(node('h3', profile.display_name || profile.username), node('p', '@' + profile.username),
            node('p', profile.is_private ? 'Private account · Admin review access' : 'Public account'));
        if (profile.bio) host.append(node('p', profile.bio));
        if (profile.restricted) host.append(node('p', 'This profile is currently restricted.'));
        if (profile.assets?.length) {
            const avatar = node('div'); avatar.className = 'admin-review-avatar'; host.append(avatar);
            renderItem({ kind: 'profile', assets: profile.assets }, avatar, 'Profile photo');
        }
        const label = node('label', 'Account content'), filter = node('select');
        filter.setAttribute('aria-label', 'Account content');
        for (const [key, name] of [['posts','Posts'],['reels','Reels'],['stories','Stories']]) {
            const option = node('option', `${name} (${profile.counts?.[key] || 0})`); option.value = key; filter.append(option);
        }
        label.append(filter); host.append(label);
        const content = node('div'), feedback = node('p'), controls = node('div'); controls.className = 'actions pagination';
        feedback.setAttribute('role', 'status');
        const previous = node('button', 'Previous content'), next = node('button', 'Next content'); previous.type = next.type = 'button';
        controls.append(previous, next); host.append(feedback, content, controls);
        let offset = 0, version = 0;
        async function load() {
            const current = ++version;
            previous.disabled = next.disabled = true; feedback.textContent = 'Loading account content…';
            try {
                const { data, error } = await client.rpc('admin_profile_media', { target: profile.id, kind_filter: filter.value, page_offset: offset });
                if (error) throw error;
                if (current !== version || !isActive() || !host.isConnected) return;
                stopMedia(content); content.replaceChildren();
                for (const item of data) renderItem(item, content, reportKindLabel(item.kind));
                if (!data.length) content.append(node('p', 'No content in this category.'));
                previous.disabled = offset === 0; next.disabled = data.length < 12; feedback.textContent = '';
            } catch {
                if (current !== version || !isActive() || !host.isConnected) return;
                const retry = node('button', 'Retry account content'); retry.type = 'button'; retry.addEventListener('click', () => { void load(); });
                feedback.replaceChildren(node('span', 'Could not load account content. '), retry);
            }
        }
        filter.addEventListener('change', () => { offset = 0; void load(); });
        previous.addEventListener('click', () => { offset = Math.max(0, offset - 12); void load(); });
        next.addEventListener('click', () => { offset += 12; void load(); });
        await load();
    }
    return { renderItem, renderProfile, stopMedia };
}
