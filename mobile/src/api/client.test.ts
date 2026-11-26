jest.mock('expo-constants', () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));
jest.mock('../utils/secureStorage', () => ({
  getItem: jest.fn(async () => null),
  setItem: jest.fn(async () => undefined),
  deleteItem: jest.fn(async () => undefined),
}));

import { getErrorMessage } from './client';

const apiError = (data: unknown, status = 400) => ({ response: { status, data }, message: 'Request failed with status code' });

describe('getErrorMessage', () => {
  it('shows the API message', () => {
    expect(getErrorMessage(apiError({ code: 'FORBIDDEN', message: 'Only the main admin can do that.' }, 403))).toBe(
      'Only the main admin can do that.'
    );
  });

  it('shows the lockout message from a 429', () => {
    const message = 'Too many failed sign-in attempts. Please wait about 15 minutes and try again.';
    expect(getErrorMessage(apiError({ code: 'ERROR', message, details: { detail: message } }, 429))).toBe(message);
  });

  it('digs the real reason out of generic validation errors', () => {
    const error = apiError({
      code: 'ERROR',
      message: 'Request failed',
      details: { email: ['A user with this email already exists.'] },
    });
    expect(getErrorMessage(error)).toBe('Email: A user with this email already exists.');
  });

  it('joins several field errors and humanises names', () => {
    const error = apiError({
      message: 'Request failed',
      details: { first_name: ['Required'], role: ['Invalid'] },
    });
    expect(getErrorMessage(error)).toBe('First name: Required; Role: Invalid');
  });

  it('handles plain DRF field errors and detail strings', () => {
    expect(getErrorMessage(apiError({ username: ['Taken'] }))).toBe('username: Taken');
    expect(getErrorMessage(apiError({ detail: 'Not found.' }, 404))).toBe('Not found.');
  });

  it('never dumps an HTML error page', () => {
    expect(getErrorMessage(apiError('<html><body>Bad gateway</body></html>', 502))).toBe('Request failed');
  });

  it('falls back to the error message, then a default', () => {
    expect(getErrorMessage(new Error('Network Error'))).toBe('Network Error');
    expect(getErrorMessage({})).toBe('Something went wrong');
  });
});
