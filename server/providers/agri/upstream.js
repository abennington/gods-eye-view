import { readResponseJsonCapped } from '../common/http.js';
import { providerUserAgent } from '../common/userAgent.js';

const MIB = 1024 * 1024;
const TIMEOUT_MS = 30_000;

/** An error whose `code` is safe to show: never a URL, which may hold a key. */
export function upstreamError(code, status) {
  const error = new Error(code);
  error.code = code;
  if (status) error.status = status;
  return error;
}

/**
 * GET JSON from an upstream with a timeout, a byte cap and no redirects.
 * Non-2xx answers become `upstream_<status>` (401/403 become `key_rejected`).
 * @param {typeof fetch} fetchImpl
 * @param {string} url
 * @param {{headers?: Record<string,string>, maxBytes?: number}} [options]
 */
export async function getJson(
  fetchImpl,
  url,
  { headers = {}, maxBytes = 8 * MIB } = {},
) {
  const signal = AbortSignal.timeout(TIMEOUT_MS);
  let response;
  try {
    response = await fetchImpl(url, {
      signal,
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        'User-Agent': providerUserAgent('agri'),
        ...headers,
      },
    });
  } catch (error) {
    throw upstreamError(
      error?.name === 'TimeoutError'
        ? 'upstream_timeout'
        : 'upstream_unreachable',
    );
  }
  if (!response.ok) {
    await response.body?.cancel?.();
    if (response.status === 401 || response.status === 403)
      throw upstreamError('key_rejected', response.status);
    if (response.status === 429)
      throw upstreamError('upstream_rate_limited', 429);
    throw upstreamError(`upstream_${response.status}`, response.status);
  }
  try {
    return await readResponseJsonCapped(response, maxBytes, signal);
  } catch {
    throw upstreamError('upstream_invalid_json');
  }
}

/** A finite number from upstream text such as "1,234.5"; null for "(D)", "", etc. */
export function toNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value ?? '')
    .replace(/,/g, '')
    .trim();
  if (!text || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(text)) return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

/** Round to `digits` decimals, keeping null. */
export const round = (value, digits = 2) =>
  value === null || value === undefined
    ? null
    : Math.round(value * 10 ** digits) / 10 ** digits;

/** A trimmed environment value, or ''. */
export const envValue = (env, name) => String(env?.[name] ?? '').trim();
