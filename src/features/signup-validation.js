import { getSupabaseClient } from '../storage/supabase.js';
const pending = new WeakMap();
const cache = new Map();
const labels = { email: 'Email', username: 'Username', displayName: 'Display name', password: 'Password', confirmPassword: 'Confirm password' };

export function localSignupFeedback(name, value, password = '') {
    const text = String(value || '');
    if (!text) return { state: 'empty', message: '' };
    if (name === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text.trim())
        ? { state: 'check', message: 'Checking email…' } : { state: 'invalid', message: 'Enter a valid email address.' };
    if (name === 'username') return /^[a-z0-9._]{8,20}$/i.test(text.trim())
        ? { state: 'check', message: 'Checking username…' } : { state: 'invalid', message: 'Use 8–20 letters, numbers, dots or underscores.' };
    if (name === 'displayName') return text.trim() && text.trim().length <= 100
        ? { state: 'valid', message: 'Display name looks good.' } : { state: 'invalid', message: 'Enter a display name up to 100 characters.' };
    if (name === 'password') return text.length >= 8 && !/\s/.test(text)
        ? { state: 'valid', message: 'Password meets the requirements.' } : { state: 'invalid', message: 'Use at least 8 characters without spaces.' };
    if (name === 'confirmPassword') return text === password
        ? { state: 'valid', message: 'Passwords match.' } : { state: 'invalid', message: 'The passwords do not match.' };
    return { state: 'empty', message: '' };
}
export function availabilityFeedback(name, status) {
    if (status === 'available') return { state: 'valid', message: name === 'email' ? 'Email format valid and available.' : 'Username available.' };
    if (status === 'taken') return { state: 'invalid', message: name === 'email' ? 'Email already exists. Enter another email.' : 'Username already exists. Choose another username.' };
    if (status === 'invalid') return { state: 'invalid', message: name === 'email' ? 'Enter a valid email address.' : 'Use 8–20 letters, numbers, dots or underscores.' };
    return { state: 'unavailable', message: status === 'limited' ? 'Too many checks. Wait a minute and try again.' : 'Could not check availability. Try again.' };
}
function target(form, name) { return form.querySelector(`[data-field-feedback="${name}"]`) || (name === 'email' ? form.querySelector('[data-email-error]') : null); }
function paint(form, input, feedback) {
    const node = target(form, input.name); if (!node) return;
    node.textContent = feedback.message; node.hidden = !feedback.message;
    node.dataset.state = feedback.state;
    node.setAttribute('role', feedback.state === 'invalid' ? 'alert' : 'status');
    if (feedback.state === 'invalid') input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
}
export function pauseSignupValidation(form) {
    for (const input of (form.querySelectorAll?.('input') || [])) {
        const old = pending.get(input); if (old) clearTimeout(old.timer);
        pending.set(input, { version: (old?.version || 0) + 1 });
    }
}
export function resetSignupFeedback(form) {
    pauseSignupValidation(form);
    for (const node of (form.querySelectorAll?.('[data-field-feedback]') || [])) { node.hidden = true; node.textContent = ''; delete node.dataset.state; }
}
export function registerSignupValidation(root) {
    function validate(input, immediate = false) {
        const form = input.closest('[data-entry-form]');
        if (!form || !['signup', 'login'].includes(form.dataset.entryForm) || !labels[input.name]) return;
        if (form.dataset.entryForm === 'login' && input.name !== 'email') return;
        const previous = pending.get(input); if (previous) clearTimeout(previous.timer);
        const record = { version: (previous?.version || 0) + 1 }; pending.set(input, record);
        if (form.dataset.entryForm === 'login' && !input.value.includes('@')) {
            const valid = /^[a-z0-9._]{3,30}$/i.test(input.value.trim());
            paint(form, input, valid ? { state: 'valid', message: 'Username format looks good.' }
                : immediate ? { state: 'invalid', message: 'Enter your email or username.' } : { state: 'empty', message: '' });
            return;
        }
        let feedback = localSignupFeedback(input.name, input.value, form.elements.password.value);
        if (feedback.state === 'empty' && immediate) feedback = { state: 'invalid', message: `Enter ${labels[input.name].toLowerCase()}.` };
        if (input.name === 'email' && feedback.state === 'check' && input.validity?.typeMismatch) feedback = availabilityFeedback('email', 'invalid');
        if (form.dataset.entryForm === 'login' && feedback.state === 'check') feedback = { state: 'valid', message: 'Email format looks good.' };
        paint(form, input, feedback);
        if (input.name === 'password' && form.elements.confirmPassword.value) validate(form.elements.confirmPassword);
        if (feedback.state !== 'check') return;
        const value = input.value.trim().toLowerCase(), name = input.name, key = name + ':' + value;
        const check = async () => {
            const cached = cache.get(key);
            let status;
            if (cached && cached.expires > Date.now()) status = cached.status;
            else {
                try {
                    const { data, error } = await (await getSupabaseClient()).functions.invoke('signup-availability', { body: { field: name, value } });
                    if (error) {
                        try { status = (await error.context?.json())?.status; } catch {}
                    } else status = data?.status;
                    if (['available', 'taken'].includes(status)) cache.set(key, { status, expires: Date.now() + 30000 });
                    if (cache.size > 100) cache.delete(cache.keys().next().value);
                } catch {}
            }
            // Never let a response for an old value or a hidden/reset form overwrite newer feedback.
            if (pending.get(input) !== record || form.hidden || input.value.trim().toLowerCase() !== value) return;
            paint(form, input, availabilityFeedback(name, status));
        };
        if (immediate) void check(); else record.timer = setTimeout(check, 650);
    }
    root.addEventListener('input', event => {
        if (event.target.matches('input')) validate(event.target);
    });
    root.addEventListener('focusout', event => {
        if (event.target.matches('input')) validate(event.target, true);
    });
}
