export async function requestReelStorage(client, body) {
    const { data, error } = await client.functions.invoke('reel-storage', { body });
    if (error) {
        const result = await error.context?.json?.().catch(() => null);
        throw new Error(result?.error || 'Could not connect to Reel storage. Try again.');
    }
    return data;
}

export function isS3ReelAsset(path) {
    return path.split('/')[2] === 's3';
}

export async function signS3Reels(client, ids) {
    ids = [...new Set(ids)];
    const batches = [];
    for (let start = 0; start < ids.length; start += 50) {
        batches.push(requestReelStorage(client, { action: 'read', ids: ids.slice(start, start + 50) })
            .then(result => result.urls).catch(() => []));
    }
    return (await Promise.all(batches)).flat();
}
