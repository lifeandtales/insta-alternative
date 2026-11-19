const duplicateEmailMessage = 'Email already exists. Enter another email.';

export function emailFieldError(message) {
    return Object.assign(new Error(message), { field: 'email' });
}

export function readAuthEmail(input) {
    const email = String(input.value || '').trim().toLowerCase();
    input.value = email;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || input.validity?.valid === false) {
        throw emailFieldError('Enter a valid email address.');
    }
    return email;
}

export function checkSignupEmailResponse({ data, error }) {
    const duplicate = ['user_already_exists', 'email_exists'].includes(error?.code)
        || /user already registered|email.*already (?:registered|exists|in use)/i.test(error?.message || '');
    // Supabase may mask an existing confirmed account with an empty identities array.
    const maskedExisting = !error && !data?.session && Array.isArray(data?.user?.identities)
        && data.user.identities.length === 0;
    if (duplicate || maskedExisting) throw emailFieldError(duplicateEmailMessage);
    if (error) {
        if (error.code === 'email_address_invalid' || /(?:invalid.*email|email.*invalid)/i.test(error.message || '')) {
            throw emailFieldError('Enter a valid email address.');
        }
        throw error;
    }
    return data;
}
