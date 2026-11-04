import { sessionCookie, isSecureHost } from '../lib/auth.mjs';
import { methodGuard, sendJson } from '../lib/http.mjs';

export default function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  sendJson(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie('', { secure: isSecureHost(req.headers.host), clear: true }) });
}
