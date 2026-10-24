// Repair only the original, unavailable sample URLs. Uploaded media is untouched.
const replacements = new Map([
    ['https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4', {url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', credit: 'Sample clip: MDN flower · CC0'}],
    ['https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerJoyrides.mp4', {url: 'https://media.w3.org/2010/05/bunny/trailer.mp4', credit: 'Sample clip: Big Buck Bunny · © Blender Foundation · CC BY 3.0'}],
    ['https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerFun.mp4', {url: 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4', credit: 'Sample clip: MDN flower · CC0'}]
]);

export function repairDemoVideoSources(items) {
    for (const item of items) for (const field of ['video', 'videoUrl']) {
        const replacement = replacements.get(item[field]);
        if (replacement) { item[field] = replacement.url; item.demoVideoCredit = replacement.credit; }
    }
}
