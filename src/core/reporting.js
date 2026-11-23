export const REPORT_REASONS = [
    ['dislike', "I just don't like it"], ['unwanted', 'Unwanted content'],
    ['bullying', 'Bullying or harassment'], ['self_harm', 'Suicide, self-injury or eating disorders'],
    ['violence', 'Violence or dangerous behaviour'], ['hate', 'Hate speech or discrimination'],
    ['exploitation', 'Abuse or exploitation'], ['sexual', 'Nudity or sexual activity'],
    ['scam', 'Fraud or scam'], ['spam', 'Spam'], ['misinformation', 'False information'],
    ['intellectual_property', 'Intellectual property infringement'],
    ['impersonation', 'Impersonation'], ['other', 'Something else'],
];
export const REPORT_ACTIONS = {
    reviewing: 'Under review', dismissed: 'No violation found', warned: 'Warning issued',
    removed: 'Content hidden', restricted: 'Profile restricted', restored: 'Restriction lifted',
};

// Image posts have a composite key. Local display IDs must never reach the backend.
export function reportTarget(item, kind) {
    if (kind === 'profile') return { kind, ref: String(item.cloudProfileId || item.id), cloud: Boolean(item.cloudProfileId || item.cloud) };
    if (kind === 'message') return { kind, ref: String(item.id), cloud: Boolean(item.cloud) };
    if (item.cloudContentId) return { kind, ref: String(item.cloudContentId), cloud: true };
    if (item.cloudOwnerId && item.cloudClientId != null) return { kind: 'image_post', ref: `${item.cloudOwnerId}:${item.cloudClientId}`, cloud: true };
    return { kind, ref: String(item.id), cloud: Boolean(item.cloud) };
}

export function reportStatus(report) {
    return REPORT_ACTIONS[report.action] || (report.status === 'reviewing' ? 'Under review' : report.status === 'resolved' ? 'Reviewed' : 'Waiting for review');
}
