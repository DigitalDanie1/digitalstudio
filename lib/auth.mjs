// Session cookie helpers. Web Crypto only, so the same code runs in Routing Middleware and in Node functions.
// Cookie value: <expiryEpochMs>.<hex HMAC-SHA256(key, "v1|"+expiry)>, key = SHA-256("fieldnote-session|" + STUDIO_PASSWORD).
// Changing STUDIO_PASSWORD therefore invalidates every existing session.
export const COOKIE = 'fn_session';
export const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = (text) => crypto.subtle.digest('SHA-256', enc.encode(text));

export function timingSafeEqualStr(a, b) {
  a = String(a); b = String(b);
  let diff = a.length ^ b.length;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export async function passwordMatches(input, password) {
  if (typeof input !== 'string' || !password) return false;
  return timingSafeEqualStr(hex(await sha256('pw|' + input)), hex(await sha256('pw|' + password)));
}

async function sign(password, expiry) {
  const key = await crypto.subtle.importKey('raw', await sha256('fieldnote-session|' + password), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, enc.encode('v1|' + expiry)));
}

export async function createSession(password, now = Date.now()) {
  const expiry = now + MAX_AGE_MS;
  return `${expiry}.${await sign(password, String(expiry))}`;
}

export async function verifySession(value, password, now = Date.now()) {
  if (!password || typeof value !== 'string') return false;
  const m = /^(\d{1,15})\.([0-9a-f]{64})$/.exec(value);
  if (!m || !(Number(m[1]) > now)) return false;
  return timingSafeEqualStr(m[2], await sign(password, m[1]));
}

export function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (k && !(k in out)) { try { out[k] = decodeURIComponent(part.slice(i + 1).trim()); } catch { out[k] = part.slice(i + 1).trim(); } }
  }
  return out;
}

export function sessionCookie(value, { secure = true, clear = false } = {}) {
  return `${COOKIE}=${clear ? '' : value}; Max-Age=${clear ? 0 : Math.floor(MAX_AGE_MS / 1000)}; Path=/; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

// Secure everywhere except plain-http localhost (local dev server / tests).
export function isSecureHost(hostHeader) {
  return !/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/i.test(String(hostHeader || ''));
}
