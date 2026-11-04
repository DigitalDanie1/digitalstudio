import { methodGuard, sendJson } from '../lib/http.mjs';

// Reaching this function means middleware already accepted the session cookie. `cloud:true` tells the studio it is
// running on the real deployment (not some other host that happens to answer /api/session).
export default function handler(req, res) {
  if (!methodGuard(req, res, ['GET'])) return;
  sendJson(res, 200, { ok: true, cloud: true });
}
