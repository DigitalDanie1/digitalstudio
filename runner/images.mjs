// 인스타 그림: 이 맥의 ChatGPT "Codex" 로 그림을 그리는 대기열 + 그림체(스타일) 도서관
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn, execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOME } from './util.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODEX_BIN = () => process.env.FIELDNOTE_CODEX_BIN || '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex';
const ART_ROOT = () => process.env.FIELDNOTE_ART_ROOT || path.join(HOME, 'Documents/Codex');           // 기존 작품 위치
const TOON = () => path.join(ART_ROOT(), 'instagram-toon');
const OTTER = () => path.join(ART_ROOT(), 'otter-couple-assets');
const OUT_ROOT = () => path.join(TOON(), 'fieldnote');
const GEN_DIR = () => process.env.FIELDNOTE_GENERATED_DIR || path.join(HOME, '.codex/generated_images');
const STYLES_FILE = () => process.env.FIELDNOTE_STYLES_FILE || path.join(HERE, 'styles.json');
const JOBS_FILE = () => path.join(OUT_ROOT(), 'jobs.json');
const TIMEOUT = () => +(process.env.FIELDNOTE_IMG_TIMEOUT_MS || 6 * 60 * 1000);
const IMG_RE = /\.(png|jpe?g|webp)$/i;

export class ImgError extends Error { constructor(code, msg) { super(msg); this.code = code; } }

// ---------- 파일 읽기 허용 범위 (읽기 전용) ----------
export const readRoots = () => [TOON(), OTTER()].map(p => { try { return fs.realpathSync(p); } catch { return path.resolve(p); } });
export function resolveReadable(p) {
  p = String(p || ''); if (!path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) throw new ImgError(403, '허용되지 않은 위치예요.');
  let real; try { real = fs.realpathSync(p); } catch { throw new ImgError(404, '파일이 없어요.'); }
  if (!readRoots().some(r => real.startsWith(r + path.sep))) throw new ImgError(403, '이 폴더 밖의 파일은 열 수 없어요.');
  if (!IMG_RE.test(real)) throw new ImgError(403, '그림 파일만 열 수 있어요.');
  if (!fs.statSync(real).isFile()) throw new ImgError(404, '파일이 아니에요.');
  return real;
}
// 미리보기용 작은 그림 (sips, 캐시). 실패하면 원본.
export function thumbOf(real, px = 360) {
  const st = fs.statSync(real), key = crypto.createHash('md5').update(real + st.mtimeMs + px).digest('hex');
  const dir = path.join(os.tmpdir(), 'fieldnote-thumbs'); fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, key + '.jpg');
  return new Promise(res => {
    if (fs.existsSync(out)) return res(out);
    execFile('/usr/bin/sips', ['-s', 'format', 'jpeg', '-Z', String(px), real, '--out', out], { timeout: 15000 }, e => res(!e && fs.existsSync(out) ? out : real));
  });
}

// ---------- 그림체 도서관 ----------
const slug = s => String(s).toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '') || 'style';
const listImgs = d => { try { return fs.readdirSync(d).filter(f => IMG_RE.test(f) && !f.startsWith('.')).sort().map(f => path.join(d, f)); } catch { return []; } };
const pick = (arr, n = 3) => arr.length <= n ? arr : [...new Set([0, Math.floor(arr.length / 2), arr.length - 1].map(i => arr[i]))].slice(0, n);
const readJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const SIZE = '1024x1536';

function scanStyles() {
  const out = [];
  for (const f of listImgs(OTTER())) { const b = path.basename(f).replace(/\.\w+$/, ''); out.push({ id: 'otter-' + slug(b), name: '수달 부부 ' + b, refs: [f], size: SIZE, group: '수달 부부' }); }
  for (const f of listImgs(TOON())) { const b = path.basename(f).replace(/\.\w+$/, ''); out.push({ id: 'toon-' + slug(b), name: '배심원 ' + b, refs: [f], size: SIZE, group: '인스타툰 세트' }); }
  let dirs = []; try { dirs = fs.readdirSync(TOON(), { withFileTypes: true }).filter(d => d.isDirectory() && !d.name.startsWith('.')).map(d => d.name).sort(); } catch {}
  for (const d of dirs) {
    const full = path.join(TOON(), d), imgs = listImgs(full);
    if (d === 'fieldnote') continue;
    if (d === 'style-previews') { for (const f of imgs) { const b = path.basename(f).replace(/\.\w+$/, ''); out.push({ id: 'preview-' + slug(b), name: '스타일 시안 ' + b, refs: [f], size: SIZE, group: '시안' }); } continue; }
    if (d === 'styles') { // 나중에 저장한 그림체: styles/<이름>/ 폴더
      for (const sd of fs.readdirSync(full, { withFileTypes: true }).filter(x => x.isDirectory())) { const im = listImgs(path.join(full, sd.name)); if (im.length) out.push({ id: 'saved-' + slug(sd.name), name: sd.name, refs: pick(im), size: SIZE, group: '내가 저장' }); }
      continue;
    }
    if (imgs.length) out.push({ id: 'set-' + slug(d), name: d, refs: pick(imgs), size: SIZE, group: '인스타툰 세트' });
  }
  return out;
}
// styles.json: { "<id>": {name, desc, refs?, size?, hidden?} }  (스캔한 것은 이름·설명만 덮어씀, 없는 id 는 직접 추가한 그림체)
export function listStyles() {
  const ov = readJson(STYLES_FILE(), {}), scanned = scanStyles(), seen = new Set(), res = [];
  for (const s of scanned) { seen.add(s.id); const o = ov[s.id] || {}; if (o.hidden) continue; res.push({ ...s, name: o.name || s.name, desc: o.desc || '', refs: (o.refs || s.refs).filter(f => fs.existsSync(f)), size: o.size || s.size }); }
  for (const [id, o] of Object.entries(ov)) { if (seen.has(id) || o.hidden) continue; const refs = (o.refs || []).filter(f => fs.existsSync(f)); if (refs.length) res.push({ id, name: o.name || id, desc: o.desc || '', refs, size: o.size || SIZE, group: o.group || '내가 저장' }); }
  return res;
}
export function saveStyle({ id, name, desc, refs, size }) {
  name = String(name || '').trim(); if (!name && !id) throw new ImgError(400, '그림체 이름이 필요해요.');
  const ov = readJson(STYLES_FILE(), {});
  id = String(id || '').trim() || 'my-' + slug(name);
  const o = ov[id] ||= {};
  if (name) o.name = name; if (desc != null) o.desc = String(desc);
  if (size) o.size = String(size);
  if (Array.isArray(refs) && refs.length) {
    o.refs = refs.slice(0, 3).map(f => { try { return resolveReadable(f); } catch { throw new ImgError(400, '참고 그림 위치가 이상해요: ' + f); } });
    o.group = o.group || '내가 저장';
  } else if (!listStyles().some(s => s.id === id)) throw new ImgError(400, '참고 그림이 하나는 필요해요.');
  const tmp = STYLES_FILE() + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(ov, null, 2)); fs.renameSync(tmp, STYLES_FILE());
  return listStyles().find(s => s.id === id);
}

// ---------- 작업 대기열 ----------
const jobs = new Map(); let queue = [], current = null, loaded = false;
const sanitize = s => String(s || '').replace(/[\\/:*?"<>|\0]/g, '_').replace(/\.\.+/g, '_').trim().slice(0, 80);
const persist = () => { try { fs.mkdirSync(OUT_ROOT(), { recursive: true }); const f = JOBS_FILE(); fs.writeFileSync(f + '.tmp', JSON.stringify([...jobs.values()].map(j => pubJob(j, true)), null, 1)); fs.renameSync(f + '.tmp', f); } catch {} };
function load() {
  if (loaded) return; loaded = true;
  for (const j of readJson(JOBS_FILE(), [])) { if (j.status === 'queued' || j.status === 'running') { j.status = 'failed'; j.error = '실행기가 꺼지면서 멈췄어요. 다시 그려 주세요.'; } jobs.set(j.id, { ...j }); }
}
const pubJob = (j, full) => ({ id: j.id, account: j.account, projectId: j.projectId, cardIndex: j.cardIndex, styleId: j.styleId, status: j.status, file: j.file || '', error: j.error || '', startedAt: j.startedAt || 0, createdAt: j.createdAt, finishedAt: j.finishedAt || 0, ...(full ? { prompt: j.prompt } : {}) });
export function listJobs(projectId) { load(); return [...jobs.values()].filter(j => !projectId || j.projectId === projectId).sort((a, b) => a.createdAt - b.createdAt).map(j => pubJob(j)); }

export function buildInstruction(j, style) {
  const ko = j.lang !== 'en', text = (j.text || []).filter(t => t && t.text);
  const aspect = j.aspect === '1:1' ? 'square 1:1' : j.aspect === '9:16' ? 'tall 9:16' : 'portrait 4:5 (Instagram feed, about 1080x1350)';
  const L = [
    'Use your built-in image generation tool exactly ONCE to create ONE image. Do not write code, do not browse, do not make more than one image.',
    `The attached reference image(s) define the art style. Match them exactly: the same character designs (faces, proportions, outfits, props), the same line quality, colour palette, shading and lettering style.`,
    style?.desc ? `Style notes: ${style.desc}` : '',
    `Format: ${aspect}, full bleed, no watermark, no logo, no signature, no UI chrome unless the references have it.`,
    `Scene: ${String(j.prompt || '').trim()}`,
    text.length ? `Draw ONLY this text in the image, spelled exactly, in ${ko ? 'Korean (Hangul)' : 'English'}, inside speech bubbles / title banners / caption boxes in the same lettering style as the references. Text lines, in order:\n${text.map(t => `- ${t.role}: "${t.text}"`).join('\n')}` : 'Do not put any text in the image.',
    'When the image is saved, reply with just the saved file path.',
  ];
  return L.filter(Boolean).join('\n\n');
}

function snapshot(dir) { const m = new Map(); (function walk(d) { let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const e of es) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (IMG_RE.test(e.name)) { try { m.set(p, fs.statSync(p).mtimeMs); } catch {} } } })(dir); return m; }

function mapError(code, signal, out, timedOut) {
  if (timedOut) return `Codex가 ${Math.round(TIMEOUT() / 60000 * 10) / 10}분 안에 못 끝내서 멈췄어요. 다시 시도해 주세요.`;
  const t = out.slice(-4000);
  if (/not logged in|log ?in required|please (log|sign) ?in|unauthori[sz]ed|401|auth(entication)? (failed|required|error)|token (expired|invalid)|run .?codex login/i.test(t)) return 'ChatGPT 로그인이 필요해요 — ChatGPT 앱에서 Codex를 한 번 열어 주세요';
  if (/usage limit|rate limit|quota|too many requests|429/i.test(t)) return 'Codex가 그림을 못 만들었어요: ChatGPT 사용 한도에 걸렸어요. 잠시 뒤에 다시 해 보세요.';
  if (/ENOENT|not found|spawn/i.test(t) && code == null) return 'Codex가 그림을 못 만들었어요: Codex 프로그램을 찾지 못했어요 (ChatGPT 앱이 설치돼 있나요?)';
  const last = t.split(/\r?\n/).map(s => s.replace(/\x1b\[[0-9;]*m/g, '').trim()).filter(s => s && !/^\{.*\}$/.test(s)).slice(-2).join(' / ');
  return `Codex가 그림을 못 만들었어요: ${last || (code != null ? '종료 코드 ' + code : '알 수 없는 오류')}`;
}

async function runJob(j) {
  const style = listStyles().find(s => s.id === j.styleId);
  if (!style) throw new ImgError(0, '그림체를 찾을 수 없어요: ' + j.styleId);
  const jobDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldnote-img-'));
  const lastMsg = path.join(jobDir, 'last.txt'), genDir = GEN_DIR(), before = snapshot(genDir), t0 = Date.now() - 1500;
  const args = ['exec', buildInstruction(j, style), '--skip-git-repo-check', '-s', 'workspace-write', '-C', jobDir, '--json', '-o', lastMsg];
  for (const r of style.refs.slice(0, 3)) args.push('-i', r);
  let out = '', timedOut = false, cancelled = false;
  const code = await new Promise(res => {
    let child; try { child = spawn(CODEX_BIN(), args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env }); } catch { return res(null); }
    j.child = child; j.cancel = () => { cancelled = true; try { child.kill('SIGTERM'); } catch {} setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000); };
    const timer = setTimeout(() => { timedOut = true; j.cancel(); }, TIMEOUT());
    const add = d => { out += d; if (out.length > 200000) out = out.slice(-100000); };
    child.stdout.on('data', add); child.stderr.on('data', add);
    child.on('error', e => { add(String(e.message)); clearTimeout(timer); res(null); });
    child.on('close', c => { clearTimeout(timer); res(c); });
  });
  j.child = null;
  try {
    if (cancelled && !timedOut) throw new ImgError(0, '멈췄어요.');
    if (timedOut) throw new ImgError(0, mapError(code, null, out, true));
    // 새로 생긴 그림 찾기 (대기열이 하나씩이라 diff 로 충분)
    const now = snapshot(genDir), fresh = [...now].filter(([p, m]) => !before.has(p) && m >= t0).sort((a, b) => b[1] - a[1]);
    if (!fresh.length) throw new ImgError(0, code ? mapError(code, null, out) : 'Codex가 그림을 못 만들었어요: 그림 파일이 생기지 않았어요 (Codex가 이미지 도구를 쓰지 않았어요). 다시 그려 보세요.');
    const src = fresh[0][0], dir = path.join(OUT_ROOT(), sanitize(j.account), sanitize(j.projectId)); fs.mkdirSync(dir, { recursive: true });
    const dest = path.join(dir, `${String(j.cardIndex + 1).padStart(2, '0')}-${Date.now()}${path.extname(src).toLowerCase() || '.png'}`);
    fs.copyFileSync(src, dest); j.file = dest;
  } finally { fs.rmSync(jobDir, { recursive: true, force: true }); }
}

async function pump() {
  if (current) return;
  const j = queue.shift(); if (!j) return;
  current = j; j.status = 'running'; j.startedAt = Date.now(); persist();
  try { await runJob(j); j.status = 'done'; j.error = ''; }
  catch (e) { j.status = e.message === '멈췄어요.' ? 'failed' : 'failed'; j.error = e instanceof ImgError ? e.message : 'Codex가 그림을 못 만들었어요: ' + e.message; }
  j.finishedAt = Date.now(); current = null; persist(); pump();
}

export function enqueue(b) {
  load();
  const styleId = String(b.styleId || ''); if (!listStyles().some(s => s.id === styleId)) throw new ImgError(400, '그림체를 먼저 골라 주세요.');
  const prompt = String(b.prompt || '').trim(); if (!prompt) throw new ImgError(400, '장면 설명이 비어 있어요.');
  const projectId = sanitize(b.projectId), account = sanitize(b.account); if (!projectId || !account) throw new ImgError(400, '계정/작업 번호가 필요해요.');
  const cardIndex = Number.isInteger(+b.cardIndex) && +b.cardIndex >= 0 ? +b.cardIndex : 0;
  const text = (Array.isArray(b.text) ? b.text : String(b.text || '').split(/\r?\n/))
    .map(t => (t && typeof t === 'object') ? { role: String(t.role || 'text').slice(0, 30), text: String(t.text || '').trim() } : { role: 'text', text: String(t).trim() })
    .filter(t => t.text).slice(0, 12);
  const j = { id: crypto.randomBytes(5).toString('hex'), account, projectId, cardIndex, styleId, prompt, text, lang: b.lang === 'en' ? 'en' : 'ko', aspect: String(b.aspect || '4:5'), status: 'queued', createdAt: Date.now() };
  jobs.set(j.id, j); queue.push(j); persist(); setImmediate(pump);
  return pubJob(j);
}
export function cancelJob(id) {
  load(); const j = jobs.get(String(id || '')); if (!j) throw new ImgError(404, '그 작업이 없어요.');
  if (j.status === 'queued') { queue = queue.filter(x => x !== j); j.status = 'failed'; j.error = '취소했어요.'; j.finishedAt = Date.now(); persist(); }
  else if (j.status === 'running') { j.cancel?.(); }
  return pubJob(j);
}
export function shutdownImages() { for (const j of jobs.values()) try { j.cancel?.(); } catch {} }
