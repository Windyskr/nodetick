import { ApiError } from './api';
import { serverError, tOf } from '../i18n';

/** fetch() rejects with a TypeError when the network or server is unreachable. */
export function isNetworkError(error: unknown): boolean {
  return error instanceof TypeError && /fetch|network|load failed/i.test(error.message);
}

/** Errors that come from talking to the server (as opposed to bugs). */
export function isRequestError(error: unknown): boolean {
  return error instanceof ApiError || isNetworkError(error);
}

/**
 * A message for the user in the current language. Validation messages the
 * server writes in English are translated where a mapping exists.
 */
export function errorMessage(error: unknown): string {
  if (isNetworkError(error)) return tOf('errorNetwork');
  if (error instanceof ApiError) {
    if (error.status === 401) return tOf('errorSignedOut');
    if (error.status === 404) return tOf('errorNotFound');
    if (error.status === 413) return tOf('errorTooLarge');
    if (error.status >= 500) return tOf('errorServer');
    return serverError(error.message);
  }
  if (error instanceof Error && error.message) return serverError(error.message);
  return tOf('errorUnknown');
}
