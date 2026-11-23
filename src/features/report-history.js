import { state } from '../core/state.js';
import { escapeHtml } from '../core/utils.js';
import { REPORT_REASONS, reportStatus } from '../core/reporting.js';
import { loadMyReports } from '../storage/cloud-reports.js';
import { showHomePanel } from './home-controls.js';

export async function openReportedActivity() {
    const owner = state.signedInAccountId;
    showHomePanel('Reported activities', '<div data-report-history><p role="status">Loading your reports…</p></div>');
    const host = document.querySelector('[data-report-history]');
    let offset = 0;
    let busy = false;
    const active = () => host.isConnected && state.signedInAccountId === owner;
    async function load(reset = false) {
        if (busy || !active()) return;
        busy = true;
        const controls = host.querySelectorAll('button');
        controls.forEach(button => { button.disabled = true; });
        try {
            const rows = await loadMyReports(reset ? 0 : offset);
            if (!active() || rows === null) return;
            if (reset) { offset = 0; host.innerHTML = ''; }
            host.querySelector('[data-report-more]')?.remove();
            host.querySelector('[data-report-history-error]')?.remove();
            const list = rows.map(report => `<article class="report-history-item"><h3>${escapeHtml(report.target_kind.replace('_', ' '))} · ${escapeHtml(reportStatus(report))}</h3>${report.target_username ? `<p>Reported account: @${escapeHtml(report.target_username)}</p>` : ''}<p>${escapeHtml(REPORT_REASONS.find(([code]) => code === report.reason_code)?.[1] || report.reason)}</p><time>${escapeHtml(new Date(report.created_at).toLocaleString())}</time>${report.public_note ? `<p>Admin response: ${escapeHtml(report.public_note)}</p>` : (report.status === 'resolved' || report.status === 'dismissed' ? '<p>This report was reviewed. No further explanation was recorded.</p>' : '<p>Your report is waiting for an admin decision.</p>')}${report.reviewed_at ? `<p>Updated ${escapeHtml(new Date(report.reviewed_at).toLocaleString())}</p>` : ''}</article>`).join('');
            if (!offset) host.innerHTML = '<button type="button" data-report-history-refresh>Refresh status</button>';
            host.insertAdjacentHTML('beforeend', list || (!offset ? '<p>You have not submitted any reports.</p>' : ''));
            offset += rows.length;
            if (rows.length === 50) host.insertAdjacentHTML('beforeend', '<button type="button" data-report-more>Load older reports</button>');
        } catch {
            if (active()) {
                if (!offset) host.innerHTML = '';
                host.querySelector('[data-report-history-error]')?.remove();
                host.insertAdjacentHTML('beforeend', '<p data-report-history-error role="status">Could not load reports. <button type="button" data-report-history-refresh>Try again</button></p>');
            }
        } finally {
            busy = false;
            if (active()) host.querySelectorAll('button').forEach(button => { button.disabled = false; });
        }
    }
    host.addEventListener('click', event => {
        if (event.target.closest('[data-report-history-refresh]')) void load(true);
        if (event.target.closest('[data-report-more]')) void load();
    });
    await load();
    // Poll only while this signed-in person's report panel remains open.
    const poll = async () => {
        if (!active() || document.querySelector('.home-controls-backdrop').hidden) return;
        if (!document.hidden && offset <= 50) await load(true);
        if (active()) window.setTimeout(poll, 15000);
    };
    window.setTimeout(poll, 15000);
}
