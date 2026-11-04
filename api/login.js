import { createSession, passwordMatches, sessionCookie, isSecureHost } from '../lib/auth.mjs';
import { fail, methodGuard, readJson, sendJson } from '../lib/http.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['POST'])) return;
  try {
    const password = process.env.STUDIO_PASSWORD;
    if (!password) return sendJson(res, 503, { ok: false, message: 'STUDIO_PASSWORD 환경변수가 설정되지 않아 로그인할 수 없습니다.' });
    const body = await readJson(req, 10_000);
    if (!(await passwordMatches(body?.password, password))) {
      await sleep(800);
      return sendJson(res, 401, { ok: false, message: '비밀번호가 올바르지 않습니다.' });
    }
    const cookie = sessionCookie(await createSession(password), { secure: isSecureHost(req.headers.host) });
    return sendJson(res, 200, { ok: true }, { 'Set-Cookie': cookie });
  } catch (e) { return fail(res, e); }
}
