import { createAdminContentReview } from './admin-review-content.js?v=352';
import { getSupabaseClient } from '../storage/supabase.js';
import { REPORT_REASONS, REPORT_ACTIONS, reportStatus, reportKindLabel } from '../core/reporting.js?v=352';

const $ = selector => document.querySelector(selector);
const status = $('#reports-status');
const form = $('#reports-sign-in');
const workspace = $('#reports-workspace');
const detail = $('#report-detail');
const refresh = $('#reports-refresh');
const signOut = $('#reports-sign-out');
const queue = $('#reports-queue');
const filter = $('#reports-filter');
const previous = $('#reports-prev');
const next = $('#reports-next');
const date = value => new Date(value).toLocaleString();
const node = (tag, text = '') => { const element = document.createElement(tag); element.textContent = text; return element; };
let sessionVersion = 0, listVersion = 0, detailVersion = 0, offset = 0, selected = null;

function clearDetail() {
    detailVersion++;
    selected = null;
    detail.querySelectorAll('video,audio').forEach(media => { media.pause(); media.removeAttribute('src'); media.load(); });
    detail.replaceChildren(node('p', 'Choose a report to see its evidence.'));
}

async function start() {
    const client = await getSupabaseClient();
    async function rpc(name, args) {
        const { data, error } = await client.rpc(name, args);
        if (error) throw error;
        return data;
    }
    async function load() {
        const version = ++listVersion, session = sessionVersion;
        refresh.disabled = previous.disabled = next.disabled = true;
        status.textContent = 'Loading reports…';
        try {
            const rows = await rpc('admin_content_reports', { status_filter: filter.value, page_offset: offset });
            if (version !== listVersion || session !== sessionVersion) return;
            queue.replaceChildren(...rows.map(report => {
                const row = node('li'), button = node('button');
                button.type = 'button'; button.className = 'report-queue-item';
                button.append(node('strong', reportKindLabel(report.target_kind)), node('span', REPORT_REASONS.find(([code]) => code === report.reason_code)?.[1] || report.reason), node('small', `${reportStatus(report)} · ${date(report.created_at)}`));
                button.addEventListener('click', () => { void showReport(report.id); });
                row.append(button); return row;
            }));
            if (!rows.length) queue.append(node('li', 'No reports in this category.'));
            workspace.hidden = false;
            status.textContent = '';
            previous.disabled = offset === 0; next.disabled = rows.length < 50;
        } catch (error) {
            if (version !== listVersion || session !== sessionVersion) return;
            if (error.code === '42501') { workspace.hidden = true; clearDetail(); status.textContent = 'This account does not have admin access.'; }
            else status.textContent = 'Could not load reports. Check the connection and reporting migration, then refresh.';
        } finally {
            if (version === listVersion && session === sessionVersion) refresh.disabled = false;
        }
    }
    async function showAccount(target) {
        clearDetail();
        const version = detailVersion;
        detail.replaceChildren(node('p', 'Loading account profile…'));
        try {
            const profile = await rpc('admin_profile_review', { target });
            if (version !== detailVersion) return;
            const content = createAdminContentReview(client, { isActive: () => version === detailVersion, openProfile: showAccount });
            detail.replaceChildren();
            await content.renderProfile(profile, detail);
        } catch {
            if (version === detailVersion) detail.replaceChildren(node('p', 'Could not open this account. Check admin access and try again.'));
        }
    }
    async function showReport(id) {
        clearDetail(); selected = id;
        const version = detailVersion;
        detail.replaceChildren(node('p', 'Loading complaint and evidence…'));
        try {
            const [data, context] = await Promise.all([
                rpc('admin_report_detail', { report_id: id }),
                rpc('admin_report_context', { report_id: id }),
            ]);
            if (version !== detailVersion) return;
            const { report, evidence, history } = data;
            detail.replaceChildren(node('h2', `Reported ${reportKindLabel(report.target_kind)}`), node('p', report.reason), node('p', `${reportStatus(report)} · ${date(report.created_at)}`));
            const profileHost = node('section'); profileHost.className = 'admin-profile-review'; profileHost.hidden = true;
            let profileRequest = 0;
            const reviewContent = createAdminContentReview(client, {
                isActive: () => version === detailVersion,
                openProfile: async target => {
                    const request = ++profileRequest;
                    profileHost.hidden = false;
                    reviewContent.stopMedia(profileHost); profileHost.replaceChildren(node('p', 'Loading profile…'));
                    try {
                        const profile = target === context.profile?.id ? context.profile : await rpc('admin_profile_review', { target });
                        if (version !== detailVersion || request !== profileRequest) return;
                        await reviewContent.renderProfile(profile, profileHost);
                    } catch {
                        if (version === detailVersion && request === profileRequest) profileHost.replaceChildren(node('p', 'Could not load this profile. Open it again to retry.'));
                    }
                },
            });
            if (evidence) {
                const presented = { ...context.item, ...evidence, kind: report.target_kind, ref: report.target_ref };
                reviewContent.renderItem(presented, detail, 'Reported content · saved when submitted');
                if (context.target_deleted) detail.append(node('p', 'The original item is no longer available. Saved report evidence is shown above.'));
                if (context.item?.caption && evidence.caption && context.item.caption !== evidence.caption) detail.append(node('p', 'Current text: ' + context.item.caption));
                const parent = evidence.parent_item || context.parent_item;
                if (parent) reviewContent.renderItem(parent, detail, 'Post linked to the reported comment');
                if (context.profile) {
                    const visit = node('button', 'View @' + context.profile.username + ' profile and content'); visit.type = 'button';
                    visit.addEventListener('click', () => { void reviewContent.renderProfile(context.profile, profileHost); profileHost.hidden = false; });
                    detail.append(visit);
                }
            } else detail.append(node('p', 'This older report has no verified saved evidence. It cannot be used to hide content, issue warnings or restrict an account.'));
            detail.append(profileHost);
            if (report.target_kind === 'profile' && context.profile) { profileHost.hidden = false; void reviewContent.renderProfile(context.profile, profileHost); }
            if (report.public_note) detail.append(node('p', 'Latest response: ' + report.public_note));
            if (history.length) {
                const list = node('ul');
                for (const item of history) list.append(node('li', `${REPORT_ACTIONS[item.action] || item.action}: ${item.public_note} · ${date(item.created_at)}`));
                detail.append(node('h3', 'Action history'), list);
            }
            const review = node('form'); review.className = 'report-review-form';
            const actionLabel = node('label', 'Action'), action = node('select'); action.name = 'action'; action.required = true;
            const choices = report.status === 'resolved' || report.status === 'dismissed'
                ? (data.restricted ? ['restored'] : [])
                : ['reviewing', 'dismissed', ...(evidence ? ['warned', report.target_kind === 'profile' ? 'restricted' : 'removed'] : [])];
            for (const value of choices) { const option = node('option', { reviewing: 'Start review', dismissed: 'Dismiss — no violation', warned: 'Issue warning', removed: 'Hide content', restricted: 'Restrict profile', restored: 'Lift restriction' }[value]); option.value = value; action.append(option); }
            actionLabel.append(action);
            const noteLabel = node('label', 'Explain the result (shared with the reporter and affected account)'), note = node('textarea');
            note.name = 'note'; note.required = true; note.minLength = 8; note.maxLength = 500; note.rows = 4; noteLabel.append(note);
            const feedback = node('p'); feedback.setAttribute('role', 'status');
            const button = node('button', 'Review action'); button.type = 'submit';
            review.append(actionLabel, noteLabel, node('p', 'Hiding content is reversible. Restricting a profile hides its content and prevents new posts and messages. A warning leaves the content visible.'), feedback, button);
            if (!choices.length) return;
            detail.append(review);
            let confirmed = false;
            review.addEventListener('input', () => { confirmed = false; button.textContent = 'Review action'; feedback.textContent = ''; });
            review.addEventListener('submit', async event => {
                event.preventDefault(); if (button.disabled) return;
                if (note.value.trim().length < 8) { feedback.textContent = 'Explain the result in at least 8 characters.'; return; }
                if (!confirmed) { confirmed = true; feedback.textContent = `Confirm: ${REPORT_ACTIONS[action.value]}. Your explanation will be shared with the reporter.`; button.textContent = 'Confirm and save'; return; }
                const choice = action.value, explanation = note.value.trim();
                button.disabled = action.disabled = note.disabled = true;
                feedback.textContent = 'Saving action…';
                try {
                    await rpc('admin_moderate_report', { report_id: id, action_name: choice, note: explanation });
                    if (version !== detailVersion) return;
                    await load();
                    if (version === detailVersion) await showReport(id);
                } catch {
                    if (version === detailVersion) feedback.textContent = 'Could not save. Another admin may have reviewed it. Refresh the report before trying again.';
                } finally { button.disabled = action.disabled = note.disabled = false; }
            });
        } catch {
            if (version === detailVersion) detail.replaceChildren(node('p', 'Could not load this report. Select it again to retry.'));
        }
    }
    function sessionChanged(session) {
        sessionVersion++; listVersion++; clearDetail(); offset = 0;
        workspace.hidden = true; queue.replaceChildren();
        form.hidden = Boolean(session); refresh.hidden = signOut.hidden = !session; status.textContent = '';
        if (session) void load().then(() => {
            const target = new URL(window.location.href).searchParams.get('profile');
            if (target && !workspace.hidden) return showAccount(target);
        });
    }
    client.auth.onAuthStateChange((event, session) => {
        if (['INITIAL_SESSION', 'SIGNED_IN', 'SIGNED_OUT'].includes(event)) setTimeout(() => sessionChanged(session), 0);
    });
    form.addEventListener('submit', async event => {
        event.preventDefault(); const button = form.querySelector('button'); button.disabled = true; status.textContent = 'Signing in…';
        try {
            const { error } = await client.auth.signInWithPassword({ email: form.elements.email.value.trim(), password: form.elements.password.value });
            if (error) throw error; form.reset();
        } catch { status.textContent = 'Sign-in failed. Check your email and password, then try again.'; }
        finally { button.disabled = false; }
    });
    signOut.addEventListener('click', async () => {
        clearDetail(); workspace.hidden = true; queue.replaceChildren(); listVersion++; sessionVersion++;
        try { const { error } = await client.auth.signOut({ scope: 'local' }); if (error) throw error; }
        catch { status.textContent = 'Could not sign out. Try again.'; }
    });
    filter.addEventListener('change', () => { offset = 0; clearDetail(); void load(); });
    previous.addEventListener('click', () => { offset = Math.max(0, offset - 50); clearDetail(); void load(); });
    next.addEventListener('click', () => { offset += 50; clearDetail(); void load(); });
    refresh.addEventListener('click', async () => { const id = selected; await load(); if (id && !workspace.hidden) await showReport(id); });
}
start().catch(() => { status.textContent = 'Could not connect. Reload this page to try again.'; });
