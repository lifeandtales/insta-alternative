import { changeVerifiedPassword } from './account-password.js';

export function setupAdminPassword(client) {
    const form = document.getElementById('admin-password-form');
    const status = document.getElementById('admin-password-status');
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('button');
        button.disabled = true;
        status.textContent = 'Updating your password…';
        try {
            await changeVerifiedPassword(client, form.elements.password.value, form.elements.confirmPassword.value);
            form.reset();
            status.textContent = 'Your password was updated. Use the new password to log in on Android. Keep this browser session open until you confirm login works.';
        } catch (error) {
            status.textContent = ['reauthentication_needed','reauthentication_not_valid'].includes(error.code)
                ? 'Supabase requires recent verification. Complete email recovery before changing your password.'
                : error.message || 'Could not update your password. This session has been kept open.';
        } finally { button.disabled = false; }
    });
}
