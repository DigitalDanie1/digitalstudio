// Reach 리서치: read-only research via the local `agent-reach` CLI (YouTube / Naver blog / Reddit).
// Mounted by server.mjs under GET /reach/* AFTER the origin + token checks. No network code here besides the CLI.
import { execFile } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const BIN = process.env.AGENT_REACH_BIN || path.join(os.homedir(), '.local/bin/agent-reach');
const TIMEOUT = 120000;
const CACHE_TTL = 10 * 60 * 1000;
const MAX_PROCS = 3;

class HttpErr extends Error { constructor(status, message) { super(message); this.status = status; } }

// ---- queue ----
let running = 0;
const waiting = [];
function schedule(fn) {
  return new Promise((resolve, reject) => {
    waiting.push({ fn, resolve, reject });
    pump();
  });
}
function pump() {
  while (running < MAX_PROCS && waiting.length) {
    const { fn, resolve, reject } = waiting.shift();
    running++;
    fn().then(resolve, reject).finally(() => { running--; pump(); });
  }
}

// ---- cache ----
const cache = new Map();
function runCli(args) {
  const key = JSON.stringify(args);
  const hit = cache.get(key);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.val);
  return schedule(() => new Promise((resolve) => {
    execFile(BIN, args, { timeout: TIMEOUT, maxBuffer: 20 * 1024 * 1024, encoding: 'utf8' }, (err, stdout) => {
      let val;
      if (err && (err.killed || err.code === 'ETIMEDOUT' || err.signal)) {
        val = { ok: false, error: { code: 'TIMEOUT', message: 'timeout' }, message: '응답이 너무 오래 걸려요. 다시 시도해보세요' };
      } else {
        try { val = JSON.parse(stdout); }
        catch {
          val = { ok: false, error: { code: 'BAD_OUTPUT', message: (err && err.message) || 'CLI 출력을 해석할 수 없어요' } };
        }
      }
      if (val && val.ok === false) {
        const e = val.error || {};
        if (!val.message) val.message = e.code === 'PLATFORM_BLOCKED' ? '연령 제한 또는 로그인이 필요한 영상이에요' : (e.message || '요청에 실패했어요');
      } else if (val) {
        cache.set(key, { val, exp: Date.now() + CACHE_TTL });
        if (cache.size > 300) cache.delete(cache.keys().next().value);
      }
      resolve(val);
    });
  }));
}

// ---- validation ----
function q(params, name = 'q') {
  const v = (params.get(name) || '').trim();
  if (!v) throw new HttpErr(400, '검색어를 입력하세요');
  if (v.length > 200) throw new HttpErr(400, '검색어는 200자 이하여야 해요');
  return v;
}
function limit(params) {
  const n = parseInt(params.get('limit') || '15', 10);
  return Math.min(25, Math.max(1, Number.isFinite(n) ? n : 15));
}
function urlParam(params) {
  const v = (params.get('url') || '').trim();
  let u;
  try { u = new URL(v); } catch { throw new HttpErr(400, '올바른 URL이 아니에요'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpErr(400, 'http/https URL만 가능해요');
  return u.toString();
}
function lang(params) {
  const v = (params.get('lang') || 'ko').trim();
  if (!/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,8})?$/.test(v)) throw new HttpErr(400, '잘못된 언어 코드예요');
  return v;
}

// ---- naver helpers ----
function naverParse(item) {
  const text = (item.text || '');
  const title = item.title || '';
  const re = /(20\d{2})\.\s?(\d{1,2})\.\s?(\d{1,2})\./;
  let date = null;
  const ti = title ? text.indexOf(title) : -1;
  let m = null;
  if (ti >= 0) m = re.exec(text.slice(ti + title.length));
  if (!m) m = re.exec(text);
  if (m) date = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  let dateSource = date ? 'text' : null;
  if (!date) {
    // fallback: naver image paths embed base64("YYYYMMDD_...") of the upload date
    for (const mm of text.matchAll(/phinf[a-z.-]*\/(M[jT][A-Za-z0-9]{10})/g)) {
      const d = Buffer.from(mm[1], 'base64').toString('latin1');
      const x = /^(20\d{2})(\d{2})(\d{2})/.exec(d);
      if (x) { date = `${x[1]}-${x[2]}-${x[3]}`; dateSource = 'image'; break; }
    }
  }
  // excerpt: strip nav links/images/headers
  let body = text.split('\n').filter((l) => {
    const t = l.trim();
    if (!t) return false;
    if (/^!?\[.*\]\(.*\)\s*$/.test(t)) return false;
    if (/^(\*|-)?\s*\[[^\]]*\]\([^)]*\)\s*$/.test(t)) return false;
    if (/^(Title|URL Source|Markdown Content|Published Time):/i.test(t)) return false;
    return true;
  }).join('\n');
  body = body.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/!\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  return { title, url: item.url, date, dateSource, year: date ? Number(date.slice(0, 4)) : null, chars: text.length, excerpt: body.slice(0, 600) };
}

const routes = {
  '/reach/health': async () => {
    const r = await runCli(['version']);
    return { ok: !!r.ok, version: (r.result && r.result.version) || null, message: r.ok ? undefined : r.message };
  },
  '/reach/yt/search': (p) => runCli(['youtube', 'search', q(p), '--limit', String(limit(p))]),
  '/reach/yt/subtitle': (p) => runCli(['youtube', 'subtitle', urlParam(p), '--lang', lang(p)]),
  '/reach/naver/search': (p) => runCli(['web', 'search', 'site:blog.naver.com ' + q(p), '--limit', String(limit(p))]),
  '/reach/naver/read': async (p) => {
    const r = await runCli(['web', 'read', urlParam(p)]);
    if (!r.ok) return r;
    const it = (r.items || [])[0];
    if (!it) return { ok: false, error: { code: 'EMPTY', message: '본문이 없어요' }, message: '본문을 읽지 못했어요' };
    return { ok: true, ...naverParse(it) };
  },
  '/reach/reddit/search': (p) => runCli(['reddit', 'search', q(p), '--limit', String(limit(p))]),
  '/reach/reddit/read': (p) => runCli(['reddit', 'read', urlParam(p)]),
};


// Returns { status, body } for a /reach/* pathname, or null when the route does not exist.
export async function reachRoute(pathname, searchParams) {
  const h = routes[pathname];
  if (!h) return null;
  try {
    return { status: 200, body: await h(searchParams) };
  } catch (e) {
    if (e instanceof HttpErr) return { status: e.status, body: { ok: false, error: { code: 'BAD_REQUEST', message: e.message }, message: e.message } };
    return { status: 500, body: { ok: false, message: String((e && e.message) || e) } };
  }
}
