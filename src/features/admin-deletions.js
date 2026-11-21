export function setupAdminDeletions(client) {
    const list = document.getElementById('deletion-request-list');
    const status = document.getElementById('deletion-requests-status');
    let revision = 0;
    function reset() { revision++; list.replaceChildren(); status.textContent = ''; }
    async function load() {
        const request = ++revision;
        status.textContent = 'Loading deletion requests…';
        try {
            const { data, error } = await client.rpc('admin_deletion_requests');
            if (request !== revision) return;
            if (error) throw error;
            list.replaceChildren(...data.map(entry => {
                const row = document.createElement('li');
                const heading = document.createElement('strong');
                heading.textContent = '@' + entry.username + ' · ' + entry.status;
                const reason = document.createElement('p');
                reason.textContent = entry.reason || 'No reason supplied.';
                row.append(heading, reason);
                if (entry.last_error) {
                    const failure = document.createElement('p'); failure.textContent = entry.last_error; row.append(failure);
                }
                for (const action of entry.status === 'pending' ? ['approve', 'reject'] : entry.status === 'processing' ? ['approve'] : []) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.textContent = action === 'reject' ? 'Reject request' : entry.status === 'processing' ? 'Retry deletion' : 'Approve and delete account';
                    button.addEventListener('click', async () => {
                        let confirmation = '';
                        if (action === 'approve') {
                            confirmation = window.prompt('This permanently deletes the account and its active uploads. Type ' + entry.username + ' to confirm.');
                            if (confirmation !== entry.username) return;
                        }
                        const note = action === 'reject' ? window.prompt('Reason for rejecting this request (optional):') : '';
                        if (note === null) return;
                        button.disabled = true;
                        try {
                            const result = await client.functions.invoke('admin-users', { body: {
                                action: action === 'approve' ? 'approve_deletion' : 'reject_deletion',
                                request_id: entry.id, confirmation, note,
                            } });
                            if (result.error) {
                                let detail; try { detail = await result.error.context?.json(); } catch {}
                                throw new Error(detail?.message || 'Could not review the request.');
                            }
                            await load();
                            status.textContent = result.data.message;
                        } catch (error) { status.textContent = error.message; button.disabled = false; }
                    });
                    row.append(button);
                }
                return row;
            }));
            status.textContent = data.length ? '' : 'No deletion requests.';
        } catch { if (request === revision) status.textContent = 'Could not load deletion requests. Check admin access and the migration.'; }
    }
    return { load, reset };
}
