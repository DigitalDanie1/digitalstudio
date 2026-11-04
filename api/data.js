import { fail, HttpError, methodGuard, readJson, sendJson } from '../lib/http.mjs';
import { getStore, StoreUnavailable } from '../lib/store.mjs';

const LIMIT = 4 * 1024 * 1024;

// Bridge/connection tokens must never reach the cloud copy.
function stripTokens(data) {
  if (data.integrations && typeof data.integrations === 'object') {
    for (const k of Object.keys(data.integrations)) {
      const i = data.integrations[k];
      if (i && typeof i === 'object') delete i.token;
    }
  }
  return data;
}

export default async function handler(req, res) {
  if (!methodGuard(req, res, ['GET', 'PUT'])) return;
  try {
    const store = await getStore();
    if (req.method === 'GET') {
      const rec = await store.get();
      return sendJson(res, 200, { ok: true, data: rec.data, version: rec.version, updatedAt: rec.updatedAt });
    }
    const body = await readJson(req, LIMIT);
    const { data, baseVersion } = body || {};
    if (!Number.isInteger(baseVersion) || baseVersion < 0) throw new HttpError(400, 'baseVersion은 0 이상의 정수여야 합니다.');
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.version !== 1 || !Array.isArray(data.ideas) || !Array.isArray(data.posts)) {
      throw new HttpError(400, '워크스페이스 데이터 형식이 올바르지 않습니다 (version 1, ideas[], posts[] 필요).');
    }
    const result = await store.put(stripTokens(data), baseVersion);
    if (!result.ok) return sendJson(res, 409, { ok: false, conflict: true, data: result.data, version: result.version, updatedAt: result.updatedAt, message: '다른 컴퓨터에서 먼저 저장한 내용이 있습니다.' });
    return sendJson(res, 200, { ok: true, version: result.version, updatedAt: result.updatedAt });
  } catch (e) {
    if (e instanceof StoreUnavailable) return sendJson(res, 503, { ok: false, message: e.message });
    if (e?.name === 'UrlError' || /Upstash|fetch failed|ECONN|ENOTFOUND/i.test(e?.message || '')) return sendJson(res, 502, { ok: false, message: `클라우드 저장소 오류: ${e.message}` });
    return fail(res, e);
  }
}
