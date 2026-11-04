import { runGenerate } from '../../lib/generate.mjs';
import { fail, methodGuard, readJson, sendJson } from '../../lib/http.mjs';

// maxDuration (300s) is set in vercel.json "functions".
export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const { status, body } = await runGenerate('topics', await readJson(req, 1_000_000));
    return sendJson(res, status, body);
  } catch (e) { return fail(res, e); }
}
