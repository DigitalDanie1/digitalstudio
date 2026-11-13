import { runComic } from '../../lib/comic.mjs';
import { fail, methodGuard, readJson, sendJson } from '../../lib/http.mjs';

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const { status, body } = await runComic(await readJson(req, 1_000_000));
    return sendJson(res, status, body);
  } catch (error) { return fail(res, error); }
}
