import { getSupabaseClient } from '../storage/supabase.js';
import { state } from '../core/state.js';
import { showHomePanel } from './home-controls.js';
import { escapeHtml } from '../core/utils.js';

export async function openDeletionRequest() {
    showHomePanel('Delete account', '<p role="status">Loading your request…</p>');
    if (!state.signedInAccountId) {
        showHomePanel('Delete account', '<p>Sign in to request account deletion.</p>');
        return;
    }
    try {
        const client = await getSupabaseClient();
        const { data, error } = await client.from('account_deletion_requests').select('id,status,review_note')
            .eq('user_id', state.signedInAccountId).order('created_at', { ascending: false }).limit(1);
        if (error) throw error;
        const latest = data[0];
        if (latest?.status === 'processing') {
            showHomePanel('Delete account', '<p>An admin approved your request. Account deletion is in progress.</p>');
        } else if (latest?.status === 'pending') {
            showHomePanel('Delete account', `<p>Your deletion request is pending admin review. Your account has not been deleted.</p><form class="cloud-deletion-withdraw" data-request-id="${escapeHtml(latest.id)}"><button type="submit">Withdraw request</button><p role="status"></p></form>`);
        } else {
            showHomePanel('Delete account', `${latest?.status === 'rejected' ? `<p>The admin declined your previous request. ${escapeHtml(latest.review_note)}</p>` : ''}<p>Your request goes to the admin for approval. Sending it does not immediately delete your account.</p><form class="cloud-deletion-request"><label>Reason (optional)<textarea name="reason" maxlength="1000"></textarea></label><label><input name="confirmed" type="checkbox" required /> I want the admin to review deletion of my account.</label><button type="submit">Send deletion request</button><p role="status"></p></form>`);
        }
    } catch {
        showHomePanel('Delete account', '<p>Could not load deletion requests. Please try again.</p>');
    }
}

export async function submitDeletionRequest(form) {
    const withdrawing = form.matches('.cloud-deletion-withdraw');
    const status = form.querySelector('[role="status"]');
    const button = form.querySelector('button');
    if (!withdrawing && !form.elements.confirmed.checked) {
        status.textContent = 'Confirm that you want to send this request.';
        return;
    }
    button.disabled = true;
    try {
        const client = await getSupabaseClient();
        const result = withdrawing
            ? await client.rpc('withdraw_account_deletion', { request_id: form.dataset.requestId })
            : await client.rpc('request_account_deletion', { request_reason: form.elements.reason.value });
        if (result.error) throw result.error;
        if (withdrawing && !result.data) throw new Error('This request can no longer be withdrawn. Refresh its status.');
        await openDeletionRequest();
    } catch (error) {
        status.textContent = error.message || 'Could not send your request. Try again.';
        button.disabled = false;
    }
}
