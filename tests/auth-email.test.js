import test from 'node:test';
import assert from 'node:assert/strict';
import { readAuthEmail, checkSignupEmailResponse } from '../src/features/auth-email.js';

const emailError = message => error => error.field === 'email' && error.message === message;
test('email normalization removes surrounding spaces and ignores case, preserving aliases', () => {
    const input = { value: '  Person+notes@Example.COM  ', validity: { valid: true } };
    assert.equal(readAuthEmail(input), 'person+notes@example.com');
    assert.equal(input.value, 'person+notes@example.com');
});
test('invalid email format is separate from duplicate-account errors', () => {
    for (const value of ['', 'name', 'name@', '@example.com', 'name@example', 'name @example.com']) {
        assert.throws(() => readAuthEmail({ value, validity: { valid: true } }), emailError('Enter a valid email address.'));
    }
    assert.throws(() => readAuthEmail({ value: 'name@example.com', validity: { valid: false } }), emailError('Enter a valid email address.'));
});
test('both explicit duplicate and masked existing-account responses show the email-specific message', () => {
    for (const response of [
        { error: { code: 'user_already_exists', message: 'Already registered' } },
        { error: { code: 'email_exists' } },
        { error: { message: 'User already registered' } },
        { data: { session: null, user: { identities: [] } } },
    ]) assert.throws(() => checkSignupEmailResponse(response), emailError('Email already exists. Enter another email.'));
});
test('new email confirmations and unrelated server errors are not mistaken for duplicate accounts', () => {
    const data = { session: null, user: { identities: [{ provider: 'email' }] } };
    assert.equal(checkSignupEmailResponse({ data }), data);
    const network = new Error('Network request failed');
    assert.throws(() => checkSignupEmailResponse({ error: network }), error => error === network);
    const username = { code: '23505', message: 'duplicate username' };
    assert.throws(() => checkSignupEmailResponse({ error: username }), error => error === username);
});
