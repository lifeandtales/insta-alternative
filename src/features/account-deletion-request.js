import { getSupabaseClient } from '../storage/supabase.js';
import { state } from '../core/state.js';
import { showHomePanel } from './home-controls.js';
import { escapeHtml } from '../core/utils.js';

export function deletionWaitingMessage(deadline) {
    const date = new Date(deadline);
    const ending = Number.isFinite(date.getTime()) ? ` Deletion is scheduled for ${date.toLocaleString()}.` : '';
    return 'Your account has a seven-day waiting period before permanent deletion.' + ending
        + ' Log in again before that time to automatically cancel your request.';
}

export async function checkDeletionAfterLogin(client) {
    const { data, error } = await client.rpc('cancel_account_deletion_after_login');
    if (error) throw new Error('Could not verify account deletion status. Please try again.');
    return data;
}

export async function openDeletionRequest() {
    showHomePanel('Delete account', '<p role="status">Loading your request…</p>');
    if (!state.signedInAccountId) {
        showHomePanel('Delete account', '<p>Sign in to request account deletion.</p>');
        return;
    }
    try {
        const client = await getSupabaseClient();
        const { data, error } = await client.from('account_deletion_requests')
            .select('id,status,review_note,delete_after').eq('user_id', state.signedInAccountId)
            .order('created_at', { ascending: false }).limit(1);
        if (error) throw error;
        const latest = data[0];
        if (latest?.status === 'processing') {
            showHomePanel('Delete account', '<p>Account deletion is in progress.</p>');
        } else if (latest?.status === 'pending') {
            showHomePanel('Delete account', `<p>${escapeHtml(deletionWaitingMessage(latest.delete_after))}</p>`);
        } else {
            showHomePanel('Delete account', `<p>Confirm your identity and password to request account deletion. You have seven days to change your mind by logging in again. After seven days, your account and active uploads are permanently deleted.</p>
                <form class="cloud-deletion-request">
                  <label>Username, user ID, or email<input name="identifier" autocomplete="username" required /></label>
                  <label>Password<input name="password" type="password" autocomplete="current-password" required /></label>
                  <label>Reason (optional)<textarea name="reason" maxlength="1000"></textarea></label>
                  <label><input name="confirmed" type="checkbox" required /> I understand the seven-day waiting period and permanent deletion.</label>
                  <button type="submit">Request account deletion</button><p role="status"></p>
                </form>`);
        }
    } catch {
        showHomePanel('Delete account', '<p>Could not load deletion requests. Please try again.</p>');
    }
}

export async function submitDeletionRequest(form) {
    const status = form.querySelector('[role="status"]');
    const button = form.querySelector('button');
    if (button.disabled) return;
    if (!form.elements.confirmed?.checked) {
        status.textContent = 'Confirm that you want to send this request.';
        return;
    }
    button.disabled = true;
    try {
        const client = await getSupabaseClient();
        const { data, error } = await client.functions.invoke('account-deletion', { body: {
            action: 'request', identifier: form.elements.identifier.value,
            password: form.elements.password.value, confirmed: true, reason: form.elements.reason.value,
        } });
        form.elements.password.value = '';
        if (error) {
            let detail;
            try { detail = await error.context?.json(); } catch {}
            throw new Error(detail?.message || 'Could not confirm deletion. Check your details and try again.');
        }
        document.dispatchEvent(new CustomEvent('account-deletion-requested', { detail: data }));
    } catch (error) {
        status.textContent = error.message || 'Could not send your request. Try again.';
        button.disabled = false;
    }
}
