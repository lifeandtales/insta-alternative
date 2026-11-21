// Business data and access rules stay in Supabase; new media bytes go to private S3.
export function mediaBucket(client, namespace) {
    return client.mediaStorage?.from(namespace) || client.storage.from(namespace);
}

export function installS3MediaStorage(client) {
    async function request(body) {
        const { data, error } = await client.functions.invoke('media-storage', { body });
        if (error) {
            let detail;
            try { detail = await error.context?.json(); } catch { /* Use the safe fallback. */ }
            throw new Error(detail?.error || 'Could not connect to media storage. Try again.');
        }
        return data;
    }
    client.mediaStorage = {
        from(namespace) {
            const legacy = client.storage.from(namespace);
            async function signed(paths, expiresIn) {
                const unique = [...new Set(paths)];
                const results = [];
                // Bound parallel signing so large feeds do not wait one network round trip per batch.
                for (let start = 0; start < unique.length; start += 200) {
                    const group = [];
                    for (let offset = start; offset < Math.min(start + 200, unique.length); offset += 50) {
                        const batch = unique.slice(offset, offset + 50);
                        group.push((async () => {
                            const result = await request({ action: 'read', namespace, paths: batch, expiresIn });
                            if (!result.legacy.length) return result.urls;
                            const old = await legacy.createSignedUrls(result.legacy, expiresIn);
                            if (old.error) throw old.error;
                            return [...result.urls, ...old.data || []];
                        })());
                    }
                    results.push(...await Promise.all(group));
                }
                return { data: results.flat(), error: null };
            }
            return {
                async upload(path, file, options = {}) {
                    const media = { mime: (options.contentType || file.type).split(';')[0], size: file.size };
                    const prepared = await request({ action: 'prepare', namespace, path, media });
                    if (prepared.exists) return { error: { statusCode: '409', message: 'File already uploaded.' } };
                    const form = new FormData();
                    for (const [name, value] of Object.entries(prepared.upload.fields)) form.append(name, value);
                    form.append('file', file);
                    const uploaded = await fetch(prepared.upload.url, { method: 'POST', body: form });
                    if (!uploaded.ok) throw new Error('Media upload failed. Try again.');
                    await request({ action: 'complete', namespace, path, media, ticket: prepared.ticket });
                    return { data: { path }, error: null };
                },
                createSignedUrls: signed,
                async createSignedUrl(path, expiresIn) {
                    const result = await signed([path], expiresIn);
                    return { data: result.data.find(item => item.path === path) || null, error: null };
                },
                async remove(paths) {
                    const unique = [...new Set(paths)];
                    for (let start = 0; start < unique.length; start += 50) {
                        const result = await request({ action: 'delete', namespace, paths: unique.slice(start, start + 50) });
                        if (result.legacy.length) {
                            const old = await legacy.remove(result.legacy);
                            if (old.error) throw old.error;
                        }
                        if (!result.filesRemoved) throw new Error('The item was removed, but some stored files could not be cleaned up.');
                    }
                    return { data: [], error: null };
                },
            };
        },
    };
    return client;
}
