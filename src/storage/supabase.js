// Supabase's public anon key is safe to ship with the browser client.
// Access to account and chat data is enforced by database policies.
const projectUrl = 'https://nbmxfsadqflsjlibxqor.supabase.co';
const anonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5ibXhmc2FkcWZsc2psaWJ4cW9yIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQzOTQ0NjQsImV4cCI6MjEwOTk3MDQ2NH0.gd_dwOnMi5N9Grkxwv0tMojNpy2qZCsEeUOU0UOsqqs';
const sdkUrl = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.119.0';
let client;

export function getSupabaseClient() {
    client ??= new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = sdkUrl;
        script.onload = () => {
            try {
                resolve(window.supabase.createClient(projectUrl, anonKey));
            } catch (error) {
                reject(error);
            } finally {
                script.remove();
            }
        };
        script.onerror = () => {
            script.remove();
            reject(new Error('Could not load the Supabase client.'));
        };
        document.head.append(script);
    }).catch(error => {
        client = undefined;
        throw error;
    });
    return client;
}
