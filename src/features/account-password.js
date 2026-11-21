export async function changeVerifiedPassword(client, password, confirmation) {
    if (password.length < 8 || /\s/.test(password)) throw new Error('Use at least 8 characters without spaces.');
    if (password !== confirmation) throw new Error('The passwords do not match.');
    const verified = await client.auth.getUser();
    if (verified.error || !verified.data?.user) throw new Error('Your session expired. Sign in again to change your password.');
    const { error } = await client.auth.updateUser({ password });
    if (error) throw error;
}
