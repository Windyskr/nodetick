import { afterEach, describe, expect, it } from 'vitest';
import { ApiError } from '../src/lib/api';
import { errorMessage, isNetworkError, isRequestError } from '../src/lib/errors';
import { useI18n } from '../src/i18n';

const setLang = (lang: 'zh' | 'en') => useI18n.setState({ lang });
afterEach(() => setLang('en'));

describe('errorMessage', () => {
  it('explains network failures and server errors in the UI language', () => {
    setLang('zh');
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('无法连接服务器，请检查网络后重试。');
    expect(errorMessage(new ApiError(500, 'internal server error'))).toBe('服务器出错了，请稍后再试。');
    expect(errorMessage(new ApiError(503, 'Request failed (503)'))).toBe('服务器出错了，请稍后再试。');
    expect(errorMessage(new ApiError(413, 'request body too large'))).toBe('内容太大，无法保存。');
    expect(errorMessage(new ApiError(404, 'task not found'))).toContain('已不存在');
    expect(errorMessage(new ApiError(401, 'Unauthorized'))).toBe('登录已失效，请重新登录。');
    setLang('en');
    expect(errorMessage(new TypeError('NetworkError when attempting to fetch resource.'))).toMatch(/can't reach the server/i);
  });

  it('translates known validation messages and passes others through', () => {
    setLang('zh');
    expect(errorMessage(new ApiError(403, 'Admin only.'))).toBe('只有管理员可以进行此操作。');
    expect(errorMessage(new ApiError(409, 'a tag with that name already exists'))).toBe('已有同名标签。');
    expect(errorMessage(new ApiError(400, 'some new validation message'))).toBe('some new validation message');
    expect(errorMessage('weird')).toBe('出错了。');
  });

  it('tells request failures from programming errors', () => {
    expect(isNetworkError(new TypeError('Failed to fetch'))).toBe(true);
    expect(isNetworkError(new TypeError("Cannot read properties of undefined (reading 'id')"))).toBe(false);
    expect(isRequestError(new ApiError(400, 'bad'))).toBe(true);
    expect(isRequestError(new Error('boom'))).toBe(false);
  });
});
