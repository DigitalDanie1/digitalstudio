import { fail, HttpError, methodGuard, readJson, sendJson } from '../../lib/http.mjs';

// Posts a finished post to a Telegram channel through the Bot API.
//   GET  -> { ok, configured, target }            (never returns the token)
//   POST -> { text, postId, force? } => { ok, messageIds, url }
// Env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (@channel or numeric id), TELEGRAM_API_BASE (tests only).

const LIMIT = 4000;          // Telegram allows 4096 after entity parsing; keep headroom
const DEDUPE_MS = 10 * 60 * 1000;
const recent = new Map();    // postId -> { at, promise }  (per function instance; real guard is client-side)

const env = () => ({
  token: (process.env.TELEGRAM_BOT_TOKEN || '').trim(),
  chat: (process.env.TELEGRAM_CHAT_ID || '').trim(),
  base: (process.env.TELEGRAM_API_BASE || 'https://api.telegram.org').trim().replace(/\/+$/, ''),
});
const publicName = (chat) => (/^@[A-Za-z0-9_]{4,}$/.test(chat) ? chat.slice(1) : null);

export const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Light Markdown -> Telegram HTML. Everything is escaped first; only the tags we add are live.
export function mdToTelegramHtml(md) {
  const lines = escapeHtml(md).replace(/\r\n?/g, '\n').split('\n').map((line) => {
    let heading = false;
    line = line.replace(/^\s{0,3}#{1,6}\s+(.*)$/, (_, t) => { heading = true; return t; });
    line = line.replace(/\[([^\]\n]+?)\]\((https?:\/\/[^\s)"'<>]+)\)/g, (_, t, u) => `<a href="${u}">${t}</a>`);
    line = line.replace(/\*\*(?=\S)(.+?)(?<=\S)\*\*/g, '<b>$1</b>');
    return heading ? `<b>${line.replace(/<\/?b>/g, '')}</b>` : line;
  });
  return lines.join('\n');
}

// Break text into pieces whose HTML fits in LIMIT, preferring paragraph, then line, then space boundaries.
function fitPieces(md) {
  if (mdToTelegramHtml(md).length <= LIMIT) return [md];
  const cut = (s) => {
    const mid = Math.floor(s.length / 2);
    for (const sep of ['\n\n', '\n', ' ']) {
      const a = s.lastIndexOf(sep, mid), b = s.indexOf(sep, mid);
      const at = a > 0 ? a : b > 0 ? b : -1;
      if (at > 0) return [s.slice(0, at), s.slice(at + sep.length)];
    }
    return [s.slice(0, mid), s.slice(mid)];
  };
  const [x, y] = cut(md);
  return [...fitPieces(x), ...fitPieces(y)];
}

export function splitMessages(text) {
  const paras = String(text).replace(/\r\n?/g, '\n').trim().split(/\n{2,}/).flatMap(fitPieces);
  const chunks = [];
  let cur = [];
  const len = (arr) => mdToTelegramHtml(arr.join('\n\n')).length;
  for (const p of paras) {
    if (cur.length && len([...cur, p]) > LIMIT) { chunks.push(cur); cur = []; }
    cur.push(p);
  }
  if (cur.length) chunks.push(cur);
  return chunks.map((arr) => { const md = arr.join('\n\n'); return { md, html: mdToTelegramHtml(md) }; });
}

const NO_ADMIN = '봇이 채널 관리자로 추가돼 있는지 확인하세요. (채널 아이디도 다시 확인)';
function telegramError(status, desc = '') {
  if (status === 401) return new HttpError(502, '봇 토큰이 맞지 않아요. Vercel의 TELEGRAM_BOT_TOKEN을 확인하세요.');
  if (status === 403 || (status === 400 && /chat not found|not enough rights|have no rights|need administrator|CHAT_WRITE_FORBIDDEN|bot is not a member/i.test(desc))) return new HttpError(502, NO_ADMIN);
  if (status === 429) return new HttpError(429, '텔레그램이 잠깐 막았어요. 잠시 뒤에 다시 눌러 주세요.');
  if (status === 400) return new HttpError(502, '텔레그램이 글을 받지 않았어요. 내용을 확인해 주세요.');
  return new HttpError(502, '텔레그램에서 오류가 났어요. 잠시 뒤에 다시 해 주세요.');
}

async function callSend(cfg, payload) {
  let r, j = null;
  try {
    r = await fetch(`${cfg.base}/bot${cfg.token}/sendMessage`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15000) });
    j = await r.json().catch(() => null);
  } catch {
    throw new HttpError(502, '텔레그램에 연결하지 못했어요. 잠시 뒤에 다시 해 주세요.');   // never echo the underlying error (may carry the URL/token)
  }
  if (r.ok && j?.ok) return j.result;
  throw Object.assign(telegramError(r.status, j?.description || ''), { tgStatus: r.status, tgDesc: j?.description || '' });
}

async function sendChunk(cfg, chunk, first) {
  const base = { chat_id: cfg.chat, ...(first ? {} : { link_preview_options: { is_disabled: true } }) };
  try {
    return await callSend(cfg, { ...base, text: chunk.html, parse_mode: 'HTML' });
  } catch (e) {
    if (e.tgStatus === 400 && /can't parse entities/i.test(e.tgDesc)) return callSend(cfg, { ...base, text: chunk.md });
    throw e;
  }
}

async function post(cfg, text) {
  const chunks = splitMessages(text);
  const ids = [];
  try {
    for (let i = 0; i < chunks.length; i++) ids.push((await sendChunk(cfg, chunks[i], i === 0)).message_id);
  } catch (e) {
    if (ids.length && e instanceof HttpError) e.message = `${chunks.length}개 중 ${ids.length}개만 올라갔어요. 채널을 확인한 뒤 이어서 처리하세요. (${e.message})`;
    throw e;
  }
  const name = publicName(cfg.chat);
  return { ok: true, messageIds: ids, url: name ? `https://t.me/${name}/${ids[0]}` : null };
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'POST'])) return;
  const cfg = env();
  try {
    if (req.method === 'GET') {
      const configured = !!(cfg.token && cfg.chat);
      return sendJson(res, 200, { ok: true, configured, target: !configured ? null : cfg.chat.startsWith('@') ? cfg.chat : '비공개 채널' });
    }
    const missing = [!cfg.token && 'TELEGRAM_BOT_TOKEN', !cfg.chat && 'TELEGRAM_CHAT_ID'].filter(Boolean);
    if (missing.length) throw new HttpError(503, `${missing.join(', ')} 환경변수가 설정되지 않았어요. Vercel 설정에 넣고 Redeploy 하세요.`);
    const body = await readJson(req, 200_000);
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) throw new HttpError(400, '올릴 글이 비어 있어요.');
    if (text.length > 60000) throw new HttpError(413, '글이 너무 길어요.');
    const postId = typeof body.postId === 'string' ? body.postId.slice(0, 80) : '';

    const now = Date.now();
    for (const [k, v] of recent) if (now - v.at > DEDUPE_MS) recent.delete(k);
    const prior = postId && !body.force ? recent.get(postId) : null;
    if (prior) return sendJson(res, 200, { ...(await prior.promise), duplicate: true });

    const promise = post(cfg, text);
    if (postId) {
      recent.set(postId, { at: now, promise });
      promise.catch(() => recent.delete(postId));
    }
    return sendJson(res, 200, await promise);
  } catch (e) {
    return fail(res, e);
  }
}
