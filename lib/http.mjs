// Tiny helpers for Vercel Node functions (req/res). Work with Vercel's augmented objects and with raw node:http.
export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function sendJson(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify(data));
}

// Reads a JSON body (<= limit bytes). Uses req.body when the platform already parsed it, else the stream.
export async function readJson(req, limit = 1_000_000) {
  const declared = Number(req.headers?.['content-length']);
  if (Number.isFinite(declared) && declared > limit) throw new HttpError(413, '요청 본문이 너무 큽니다.');
  let raw;
  if (req.body !== undefined && req.body !== null && !(typeof req.body === 'string' && req.body === '' )) {
    if (Buffer.isBuffer(req.body)) raw = req.body.toString('utf8');
    else if (typeof req.body === 'string') raw = req.body;
    else {
      raw = JSON.stringify(req.body);
      if (Buffer.byteLength(raw) > limit) throw new HttpError(413, '요청 본문이 너무 큽니다.');
      return req.body;
    }
  } else {
    const chunks = []; let size = 0;
    for await (const c of req) {
      size += c.length;
      if (size > limit) throw new HttpError(413, '요청 본문이 너무 큽니다.');
      chunks.push(c);
    }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(raw) > limit) throw new HttpError(413, '요청 본문이 너무 큽니다.');
  try { return JSON.parse(raw); } catch { throw new HttpError(400, '요청 본문이 올바른 JSON이 아닙니다.'); }
}

export function methodGuard(req, res, allowed) {
  if (allowed.includes(req.method)) return true;
  sendJson(res, 405, { ok: false, message: '허용되지 않는 요청 방식입니다.' }, { Allow: allowed.join(', ') });
  return false;
}

export function fail(res, error) {
  if (error instanceof HttpError) return sendJson(res, error.status, { ok: false, message: error.message });
  console.error(error);
  return sendJson(res, 500, { ok: false, message: error?.message || '서버 오류가 발생했습니다.' });
}
