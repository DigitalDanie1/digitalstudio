// Storage adapter for the single synced document. Interface (all async):
//   get()                         -> { data|null, version, updatedAt }
//   put(data, baseVersion)        -> { ok:true, version, updatedAt } | { ok:false, conflict:true, data, version, updatedAt }
// put is an atomic compare-and-set on the version. Tests inject createMemoryStore() through setStore().
const DATA_KEY = 'fieldnote:data';
const VERSION_KEY = 'fieldnote:version';
const CAS = `local v = tonumber(redis.call('GET', KEYS[2]) or '0')
if v ~= tonumber(ARGV[1]) then return -1 end
redis.call('SET', KEYS[1], ARGV[2])
redis.call('SET', KEYS[2], tostring(v + 1))
return v + 1`;

export class StoreUnavailable extends Error {}

export function createMemoryStore() {
  let rec = { data: null, version: 0, updatedAt: 0 };
  return {
    async get() { return structuredClone(rec); },
    async put(data, baseVersion) {
      if (baseVersion !== rec.version) return { ok: false, conflict: true, ...structuredClone(rec) };
      rec = { data: structuredClone(data), version: rec.version + 1, updatedAt: Date.now() };
      return { ok: true, version: rec.version, updatedAt: rec.updatedAt };
    }
  };
}

// `redis` is an @upstash/redis client created with automaticDeserialization:false (values stay JSON strings).
export function createRedisStore(redis) {
  return {
    async get() {
      const [raw, ver] = await redis.mget(DATA_KEY, VERSION_KEY);
      if (raw == null) return { data: null, version: Number(ver) || 0, updatedAt: 0 };
      const rec = JSON.parse(raw);
      return { data: rec.data, version: Number(ver) || 0, updatedAt: rec.updatedAt || 0 };
    },
    async put(data, baseVersion) {
      const updatedAt = Date.now();
      const res = Number(await redis.eval(CAS, [DATA_KEY, VERSION_KEY], [String(baseVersion), JSON.stringify({ data, updatedAt })]));
      if (res === -1) return { ok: false, conflict: true, ...(await this.get()) };
      return { ok: true, version: res, updatedAt };
    }
  };
}

let override = null;
let real = null;
export function setStore(store) { override = store; }

export async function getStore() {
  if (override) return override;
  if (real) return real;
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new StoreUnavailable('클라우드 저장소(Upstash Redis)가 연결되지 않았습니다. Vercel Storage에서 Upstash for Redis를 프로젝트에 연결하세요.');
  const { Redis } = await import('@upstash/redis');
  real = createRedisStore(new Redis({ url, token, automaticDeserialization: false }));
  return real;
}
