// Reversible development setting. Public hosts always retain the welcome screen.
export const localPreviewSettings = { pauseWelcome: true };

export function opensDirectlyToHome(href) {
    const url = new URL(href);
    return localPreviewSettings.pauseWelcome
        && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
        && url.searchParams.get('welcome') !== '1';
}
