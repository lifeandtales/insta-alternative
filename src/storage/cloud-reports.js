import { state } from '../core/state.js';
import { getSupabaseClient } from './supabase.js';

export async function submitContentReport(target, reason, details = '') {
    const owner = state.signedInAccountId;
    if (!owner) throw new Error('Sign in to submit a report.');
    const client = await getSupabaseClient();
    if (!client || owner !== state.signedInAccountId) throw new Error('Your account changed. Try again.');
    const { data, error } = await client.rpc('submit_content_report', {
        target_kind: target.kind, target_ref: target.ref, reason_code: reason, details: details.trim(),
    });
    if (error) throw error;
    if (owner !== state.signedInAccountId) throw new Error('Your account changed.');
    return data;
}

export async function loadMyReports(offset = 0) {
    const owner = state.signedInAccountId;
    if (!owner) return [];
    const client = await getSupabaseClient();
    if (!client || owner !== state.signedInAccountId) return null;
    const { data, error } = await client.rpc('my_content_reports', { page_offset: offset });
    if (error) throw error;
    return owner === state.signedInAccountId ? data : null;
}
