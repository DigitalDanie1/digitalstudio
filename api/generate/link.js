import { runLink, LinkError } from '../../lib/link.mjs';
import { BadInput } from '../../lib/generate.mjs';
import { fail, methodGuard, readJson, sendJson } from '../../lib/http.mjs';

// maxDuration (300s) is set in vercel.json "functions" (api/generate/*.js).
export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const { status, body } = await runLink(await readJson(req, 100_000));
    return sendJson(res, status, body);
  } catch (e) {
    if (e instanceof BadInput) return sendJson(res, 400, { ok: false, message: e.message });
    if (e instanceof LinkError) return sendJson(res, e.status, { ok: false, code: e.code, message: e.message });
    return fail(res, e);
  }
}
