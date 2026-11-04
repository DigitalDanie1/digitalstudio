// Vercel Routing Middleware (file convention, plain JS, Node.js runtime): password gate for the whole site.
// Signature per https://vercel.com/docs/routing-middleware/js-reference : default export (request, context);
// returning nothing continues the request, returning a Response ends it.
import { COOKIE, parseCookies, verifySession } from './lib/auth.mjs';

export const config = { matcher: ['/(.*)'] };

const PUBLIC = new Set(['/login.html', '/api/login']);
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
const isApi = (p) => p === '/api' || p.startsWith('/api/');

export default async function middleware(request) {
  const url = new URL(request.url);
  const path = url.pathname;
  const password = process.env.STUDIO_PASSWORD;

  if (!password) {
    const message = 'STUDIO_PASSWORD 환경변수가 설정되지 않아 접근을 차단했습니다. Vercel 프로젝트 설정에서 STUDIO_PASSWORD를 추가하고 다시 배포하세요.';
    if (isApi(path)) return json(503, { ok: false, message });
    return new Response(`<!doctype html><meta charset="utf-8"><title>FIELDNOTE</title><body style="font:16px sans-serif;background:#0c0e11;color:#eceef2;padding:40px"><p>${message}</p>`, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });
  }

  if (PUBLIC.has(path)) return;

  const session = parseCookies(request.headers.get('cookie'))[COOKIE];
  if (await verifySession(session, password)) return;

  if (isApi(path)) return json(401, { ok: false, auth: true, message: '로그인이 필요하거나 세션이 만료되었습니다. 다시 로그인하세요.' });
  const next = encodeURIComponent(path + url.search);
  return new Response(null, { status: 302, headers: { Location: `/login.html?next=${next}`, 'Cache-Control': 'no-store' } });
}
