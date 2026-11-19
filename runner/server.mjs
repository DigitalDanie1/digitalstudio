// FIELDNOTE 실행기: 유튜브 쇼츠 제작을 이 맥에서 돌려 주는 작은 서버 (127.0.0.1:4777)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOME, StepError, StopError, sanitize, exists, parseRanges, isLocalSource, localPath, run, FFMPEG, lastLines } from './util.mjs';
import { listStyles, saveStyle, enqueue, cancelJob, listJobs, resolveReadable, thumbOf, shutdownImages, ImgError } from './images.mjs';
import { STEP_DEFS, STEP_FN, outputsFor, listAssets, checkScript, cleanPasted, parseScript, parseBanner, parseHook, PLACEHOLDER, SCRIPT_MAX_LINES, CHANNEL_PROFILES, LOOK_CHOICES, lookKeyOf, FX_PACKS, fxPackOf, parseFxTimes, migrateState, layoutLines, draftText, splitAnswer, feedbackPrompt, callClaude, parseCredit } from './steps.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 작업판이 쓰는 기능 수준. 3 = 새 9칸 순서 (/look, /ranges, deferRanges, 단계 clip·subs·fx)
const API_LEVEL = 5;   // 4 = 7칸 순서 (/edit 1차·2차 편집, /draft, /feedback, 슬로우 구간 x0.5, 매트 스토리 룩) · 5 = 최종 결과물 레퍼런스(이펙트 팩: /fxpack, status.fxPacks)
let VERSION = 'dev';
try { VERSION = fs.readFileSync(path.join(HERE, 'version.txt'), 'utf8').trim() || 'dev'; } catch {}
const PORT = +(process.env.FIELDNOTE_RUNNER_PORT || 4777);
const HOME_ROOT = process.env.FIELDNOTE_RUNNER_HOME || path.join(HOME, 'Desktop/유투브');
const DATA = process.env.FIELDNOTE_RUNNER_DATA || path.join(HOME_ROOT, '에피소드');
const ORIGINS = new Set(['https://digitalstudio-eight.vercel.app', 'http://localhost:5178', 'http://localhost:5179', 'http://127.0.0.1:5178', 'http://127.0.0.1:5179',
  ...String(process.env.FIELDNOTE_RUNNER_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean)]);

// 대본 AI 키: 환경변수 또는 실행기/anthropic-key.txt 첫 줄
if (!process.env.ANTHROPIC_API_KEY) {
  try { const k = fs.readFileSync(path.join(HERE, 'anthropic-key.txt'), 'utf8').split(/\r?\n/)[0].trim(); if (k) process.env.ANTHROPIC_API_KEY = k; } catch {}
}
for (const d of [DATA, path.join(HOME_ROOT, '소리/BGM'), path.join(HOME_ROOT, '소리/시그니처'), path.join(HOME_ROOT, '소리/효과음')]) fs.mkdirSync(d, { recursive: true });

// ---------- 에피소드 저장소 ----------
const episodes = new Map();   // ep -> E
const stamp = () => new Date().toTimeString().slice(0, 8);

function makeEpisode(dir, s) {
  const E = { dir, s, p: (...a) => path.join(dir, ...a), soundRoot: HOME_ROOT, homeRoot: HOME_ROOT, ctrl: { aborted: false, child: null }, running: null };
  return E;
}
const save = E => { fs.mkdirSync(E.dir, { recursive: true }); const f = E.p('state.json'); fs.writeFileSync(f + '.tmp', JSON.stringify(E.s, null, 2)); fs.renameSync(f + '.tmp', f); };

function loadAll() {
  for (const name of fs.readdirSync(DATA)) {
    const dir = path.join(DATA, name), f = path.join(dir, 'state.json');
    if (!exists(f)) continue;
    try {
      const s = migrateState(JSON.parse(fs.readFileSync(f, 'utf8')));   // 예전 8단계 에피소드는 새 단계로 옮겨요
      const E = makeEpisode(dir, s);
      for (const d of STEP_DEFS) {
        const st = s.steps[d.id] ||= { status: 'todo' };
        if (st.status === 'running') { st.status = 'failed'; st.error = '실행기가 꺼지면서 이 단계가 중간에 멈췄어요. 다시 실행하세요.'; }
      }
      save(E); episodes.set(name, E);
    } catch (e) { console.error('상태 파일을 못 읽었어요:', f, e.message); }
  }
}

function view(E) {
  return {
    ep: E.s.ep, title: E.s.title, note: E.s.note || '', ideaId: E.s.ideaId || '', format: E.s.format, channel: E.s.channel || '',
    look: E.s.look || '', lookUsed: lookKeyOf(E),
    fxPack: E.s.fxPack || '', fxPackUsed: fxPackOf(E).id, fxTimes: E.s.fxTimes || '', fxLabels: E.s.fxLabels || [],
    sources: E.s.sources.map(x => ({ url: x.url, ranges: x.ranges })),
    steps: STEP_DEFS.map(d => {
      const st = E.s.steps[d.id], o = { id: d.id, name: d.name, status: st.status, outputs: outputsFor(d.id, E).map(p => { const ex = exists(E.p(p)), r = { path: p, exists: ex }; if (ex) { try { r.mtime = Math.round(fs.statSync(E.p(p)).mtimeMs); } catch {} } return r; }) };
      if (d.gate) o.gate = true;
      if (st.error) o.error = st.error;
      return o;
    }),
    running: E.running, gate: !!E.s.gate,
    round: E.s.round || 0, editRound: E.s.editRound || 0, editAt: E.s.editAt || 0, feedbackAt: E.s.feedbackAt || 0, hasScript: hasScript(E),
  };
}

const hasScript = E => { if (E.s.steps?.script?.status !== 'done') return false; try { checkScript(E); return true; } catch { return false; } };
// ---------- 실행 ----------
const logFile = (E, id) => E.p('로그', id + '.log');
function makeCtx(E, id) {
  fs.mkdirSync(E.p('로그'), { recursive: true });
  const f = logFile(E, id);
  return {
    log: l => { if (l == null || l === '') return; try { fs.appendFileSync(f, `[${stamp()}] ${l}\n`); } catch {} },
    aborted: () => E.ctrl.aborted, setChild: c => { E.ctrl.child = c; },
  };
}
async function runStep(E, id) {
  const st = E.s.steps[id], ctx = makeCtx(E, id), def = STEP_DEFS.find(d => d.id === id);
  fs.writeFileSync(logFile(E, id), '');
  E.running = id; st.status = 'running'; delete st.error; save(E);
  ctx.log(`▶ ${def.name} 시작`);
  try {
    await STEP_FN[id](E, ctx);
    st.status = 'done'; delete st.error; ctx.log(`✔ ${def.name} 끝났어요.`);
    return true;
  } catch (e) {
    st.status = 'failed';
    st.error = e instanceof StopError ? '사용자가 멈췄어요.' : e instanceof StepError ? e.message : `예상 못 한 오류: ${e.message}`;
    if (!(e instanceof StepError || e instanceof StopError)) console.error(e);
    ctx.log(`✖ ${st.error}`);
    if (id === 'script') E.s.gate = false;
    return false;
  } finally { E.running = null; E.ctrl.child = null; save(E); }
}
// 한 단계 또는 여러 단계를 백그라운드로 돌린다. chain=true 면 게이트·목소리 단계에서 멈춘다.
function launch(E, ids, chain) {
  E.ctrl.aborted = false;
  E.running = ids[0];
  (async () => {
    for (const id of ids) {
      if (E.ctrl.aborted) break;
      if (chain && E.s.steps[id].status === 'done' && id !== ids[0]) continue;
      if (chain && id === 'mix') { makeCtx(E, 'mix').log('목소리 녹음 단계에서 멈췄어요. "음악/녹음"에서 녹음하고 "목소리·음악 넣기"를 누르세요.'); break; }
      const ok = await runStep(E, id);
      if (!ok) break;
      if (id === 'script') break;  // 게이트
    }
    E.running = null;
  })();
}
// 1차·2차 편집: 자르기 → 계획 → 가편집 → 자막 → 이펙트 → (대본이 없으면 양식) → 대본 자막·소리 합치기(최종본). 대본 확인에서 멈추지 않아요.
function launchEdit(E, round) {
  E.ctrl.aborted = false; E.s.editRound = round; E.running = 'clip'; save(E);
  (async () => {
    try {
      for (const id of ['clip', 'plan', 'rough', 'subs', 'fx']) { if (E.ctrl.aborted || !(await runStep(E, id))) return; }
      if (E.s.steps.script.status !== 'done' && !(await runStep(E, 'script'))) return;
      E.s.gate = false; save(E);
      const ctx = makeCtx(E, 'mix');
      if (hasScript(E)) { try { layoutLines(E, ctx); } catch (e) { ctx.log('대본 시간표를 못 짰어요: ' + e.message); } }
      else {   // 대본이 아직 빈 양식이면 자막 없이 만들어요 (피드백 단계에서 대본을 넣어요)
        try { const f = E.p('편집/편집계획.json'), P = JSON.parse(fs.readFileSync(f, 'utf8')); P.lines = []; fs.writeFileSync(f, JSON.stringify(P, null, 2)); } catch {}
      }
      if (E.ctrl.aborted) return;
      const keep = fs.existsSync(logFile(E, 'mix')) ? fs.readFileSync(logFile(E, 'mix'), 'utf8') : '';
      if (await runStep(E, 'mix')) {
        if (keep) try { fs.writeFileSync(logFile(E, 'mix'), keep + fs.readFileSync(logFile(E, 'mix'), 'utf8')); } catch {}
        E.s.round = Math.max(E.s.round || 0, round); E.s.editAt = Date.now(); save(E);
      }
    } finally { E.running = null; }
  })();
}
// 고친 구간 저장 (바뀌면 자르기부터 다시 해야 해요)
function setRanges(E, ranges) {
  const src = E.s.sources[0]; if (!src) throw new HttpError(400, '소스가 없어요.');
  let rg; try { rg = parseRanges(ranges); } catch (e) { throw new HttpError(400, e.message); }
  if (!rg.length) throw new HttpError(400, '구간을 하나 이상 넣어 주세요. (예: 0:30-0:42)');
  const changed = JSON.stringify(rg) !== JSON.stringify(src.ranges);
  src.ranges = rg;
  if (changed) { for (const id of ['clip', 'plan', 'rough', 'subs', 'fx', 'mix', 'upload']) { const st = E.s.steps[id]; if (st.status !== 'todo') { st.status = 'todo'; delete st.error; } } delete E.s.legacyBurn; }
  return changed;
}
// 고친 대본 저장 ("> 배너:"·"> 출처:" 줄 + 대사 줄)
function saveDraftText(E, text) {
  const lines = cleanPasted(text);
  if (!lines.length) throw new HttpError(400, '대사가 한 줄도 없어요.');
  const bad = lines.findIndex(l => l.includes(PLACEHOLDER));
  if (bad >= 0) throw new HttpError(400, `${bad + 1}번째 줄에 "${PLACEHOLDER}" 가 남아 있어요. 진짜 대사로 바꿔 주세요.`);
  if (lines.length > SCRIPT_MAX_LINES) throw new HttpError(400, `대사가 너무 많아요. ${SCRIPT_MAX_LINES}줄 이하로 줄여 주세요.`);
  const ban = parseBanner(text), credit = parseCredit(text);
  if (ban && /\[여기에/.test(ban.raw)) throw new HttpError(400, '배너 줄에 "[여기에 …]" 가 남아 있어요.');
  const f = E.p('편집/대본.md'); fs.mkdirSync(E.p('편집'), { recursive: true });
  if (exists(f)) fs.copyFileSync(f, E.p('편집/대본.bak.md'));
  const head = `# ${E.s.title}\n> 한 줄 = 자막 한 장면. "#"·">" 로 시작하는 줄은 무시돼요.\n` + (ban ? `> 배너: ${ban.raw}\n` : '') + (credit ? `> 출처: ${credit}\n` : '');
  fs.writeFileSync(f, head + '\n' + lines.join('\n') + '\n');
  E.s.steps.script = { status: 'done' }; E.s.gate = false;
  for (const id of ['fx', 'mix', 'upload']) { const st = E.s.steps[id]; if (st.status === 'done') st.status = 'todo'; }   // 제목·자막이 바뀌었으니 다시 입혀요
  return lines.length;
}
const orderIds = () => STEP_DEFS.map(d => d.id);
const firstNotDone = E => orderIds().find(id => E.s.steps[id].status !== 'done');

// ---------- 라우터 ----------
class HttpError extends Error { constructor(code, msg) { super(msg); this.code = code; } }
const getEp = name => { const E = episodes.get(String(name || '')); if (!E) throw new HttpError(404, '에피소드를 찾을 수 없어요.'); return E; };
const mustIdle = E => { if (E.running) throw new HttpError(409, '지금 다른 단계가 돌고 있어요. 끝나거나 멈춘 뒤에 눌러 주세요.'); };

function addSource(E, url, ranges, defer = false) {
  url = String(url || '').trim(); if (!url) return;
  if (!isLocalSource(url) && !/^https?:\/\//i.test(url)) throw new HttpError(400, '소스 주소가 이상해요. https:// 로 시작하는 유튜브 주소를 넣어 주세요.');
  let rg; try { rg = parseRanges(ranges); } catch (e) { throw new HttpError(400, e.message); }
  if (!rg.length && !defer) rg = ['0:00-0:15'];   // defer: 구간은 컷 편집에서 나중에 정해요
  E.s.sources.push({ url, ranges: rg });
}

const imgWrap = fn => a => { try { return fn(a); } catch (e) { if (e instanceof ImgError) throw new HttpError(e.code || 400, e.message); throw e; } };
const routes = {
  'GET /img/styles': imgWrap(() => ({ json: { styles: listStyles() } })),
  'POST /img/styles': imgWrap(({ body }) => ({ json: { ok: true, style: saveStyle(body) } })),
  'POST /img/generate': imgWrap(({ body }) => ({ json: { ok: true, job: enqueue(body) } })),
  'GET /img/jobs': ({ q }) => ({ json: { jobs: listJobs(q.get('projectId') || '') } }),
  'POST /img/cancel': imgWrap(({ body }) => ({ json: { ok: true, job: cancelJob(body.id) } })),
  'GET /': () => ({ text: '실행기가 켜져 있어요.' }),
  'GET /health': () => ({ json: { ok: true, api: API_LEVEL, version: VERSION, ffmpeg: exists(FFMPEG), data: DATA, ai: !!process.env.ANTHROPIC_API_KEY } }),
  'GET /status': () => ({ json: { looks: LOOK_CHOICES, fxPacks: FX_PACKS, episodes: [...episodes.values()].sort((a, b) => b.s.created - a.s.created).map(view) } }),
  'GET /episodes': () => routes['GET /status'](),
  'POST /episodes': ({ body }) => {
    const title = String(body.title || '').trim(); if (!title) throw new HttpError(400, '제목이 필요해요.');
    let ep = sanitize(title) || '새 주제', n = 1; const base = ep;
    while (exists(path.join(DATA, ep))) ep = `${base}-${++n}`;
    const s = { ep, title, note: String(body.note || ''), ideaId: body.ideaId || '', format: body.format === 'long' ? 'long' : 'shorts',
      channel: String(body.channel || '').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 40), look: CHANNEL_PROFILES[body.look] ? body.look : '', voice: String(body.voice || '').slice(0, 2000), sources: [], created: Date.now(), gate: false, mix: {}, voices: {},
      steps: Object.fromEntries(STEP_DEFS.map(d => [d.id, { status: 'todo' }])) };
    const E = makeEpisode(path.join(DATA, ep), s);
    addSource(E, body.url, body.ranges, !!body.deferRanges);
    for (const d of ['원본', '클립', '편집/녹음', '업로드', '로그']) fs.mkdirSync(E.p(d), { recursive: true });
    save(E); episodes.set(ep, E);
    return { json: { ok: true, ep } };
  },
  'POST /source': ({ body }) => {
    const E = getEp(body.ep); mustIdle(E);
    if (!String(body.url || '').trim()) throw new HttpError(400, '영상 주소를 넣어 주세요.');
    addSource(E, body.url, body.ranges);
    // 소스가 바뀌면 소스에서 파생되는 단계는 다시 돌려야 해요 (대본은 그대로 둠)
    for (const id of ['research', 'download', 'clip', 'plan', 'rough', 'subs', 'fx', 'mix', 'upload']) E.s.steps[id].status = 'todo';
    save(E); return { json: { ok: true, sources: E.s.sources.length } };
  },
  // ② 편집 레퍼런스(룩) 고르기. 룩이 바뀌면 영상 모양에 영향을 받는 단계(구간 자르기부터 업로드까지)를 다시 돌려야 해요. 대본·소스는 그대로.
  'POST /look': ({ body }) => {
    const E = getEp(body.ep); mustIdle(E);
    const look = String(body.look || ''); if (!CHANNEL_PROFILES[look]) throw new HttpError(400, '모르는 편집 룩이에요: ' + look);
    const was = lookKeyOf(E);
    E.s.look = look;
    if (look !== was) for (const id of ['clip', 'plan', 'rough', 'subs', 'fx', 'mix', 'upload']) { const st = E.s.steps[id]; if (st.status !== 'todo') { st.status = 'todo'; delete st.error; } }
    if (look !== was) delete E.s.legacyBurn;
    save(E); return { json: { ok: true, look, lookUsed: lookKeyOf(E), reset: look !== was } };
  },
  // ③ 최종 결과물 레퍼런스(이펙트 팩) 고르기. 바뀌면 이펙트(영상 효과)와 목소리·음악(효과음)을 다시 만들어야 해요. 컷·자막·대본은 그대로.
  'POST /fxpack': ({ body }) => {
    const E = getEp(body.ep); mustIdle(E);
    const pack = String(body.pack || ''); if (!FX_PACKS.some(p => p.id === pack)) throw new HttpError(400, '모르는 이펙트 팩이에요: ' + pack);
    let times; try { times = parseFxTimes(body.times).text; } catch (e) { throw new HttpError(400, e.message); }
    const labels = (Array.isArray(body.labels) ? body.labels : String(body.labels || '').split(',')).map(x => String(x || '').replace(/[{}\\]/g, '').trim().slice(0, 20)).slice(0, 12);
    while (labels.length && !labels[labels.length - 1]) labels.pop();
    const was = fxPackOf(E).id, wasTimes = E.s.fxTimes || '', wasLabels = (E.s.fxLabels || []).join('\n'), changed = pack !== was || times !== wasTimes || labels.join('\n') !== wasLabels;
    const clipsChange = (pack === 'raw') !== (was === 'raw');   // 한 방 리얼은 끝에 리플레이 클립이 붙어서, 들어가고 나올 때 클립부터 다시 만들어요
    E.s.fxPack = pack; E.s.fxTimes = times; E.s.fxLabels = labels;
    if (changed) for (const id of clipsChange ? ['clip', 'plan', 'rough', 'subs', 'fx', 'mix', 'upload'] : ['fx', 'mix', 'upload']) { const st = E.s.steps[id]; if (st.status !== 'todo') { st.status = 'todo'; delete st.error; } }
    save(E); return { json: { ok: true, pack, fxPackUsed: fxPackOf(E).id, fxTimes: times, fxLabels: labels, reset: changed } };
  },
  // ④ 컷 편집: 쓸 구간 정하기 (소스 하나의 구간 목록을 통째로 바꿔요). 구간이 바뀌면 자르기부터 다시 돌려야 해요.
  'POST /ranges': ({ body }) => {
    const E = getEp(body.ep); mustIdle(E);
    const si = Number.isInteger(body.source) ? body.source : 0, src = E.s.sources[si]; if (!src) throw new HttpError(400, '소스가 없어요.');
    let rg; try { rg = parseRanges(body.ranges); } catch (e) { throw new HttpError(400, e.message); }
    if (!rg.length) throw new HttpError(400, '구간을 하나 이상 넣어 주세요. (예: 0:30-0:42)');
    const changed = JSON.stringify(rg) !== JSON.stringify(src.ranges);
    src.ranges = rg;
    if (changed) for (const id of ['clip', 'plan', 'rough', 'subs', 'fx', 'mix', 'upload']) { const st = E.s.steps[id]; if (st.status !== 'todo') { st.status = 'todo'; delete st.error; } }
    if (changed) delete E.s.legacyBurn;
    save(E); return { json: { ok: true, ranges: rg, reset: changed } };
  },
  // ④·⑥ 1차·2차 편집 (구간을 같이 보내면 먼저 저장)
  'POST /edit': ({ body }) => {
    const E = getEp(body.ep); mustIdle(E);
    if (E.s.steps.download.status !== 'done') throw new HttpError(400, '링크 영상 다운이 먼저예요.');
    if (String(body.ranges || '').trim()) setRanges(E, body.ranges);
    if (!E.s.sources.some(s => s.ranges.length)) throw new HttpError(400, '쓸 구간을 넣어 주세요. (예: 0:30-0:42, 슬로우는 0:30-0:34x0.5)');
    const round = Math.max(1, Math.min(9, +body.round || (E.s.round || 0) + 1));
    save(E); launchEdit(E, round); return { json: { ok: true, round } };
  },
  // ⑤ 피드백: 지금 구간·대본 읽기 / 고친 것 저장 / 피드백 글 → (AI 키가 있으면 바로 반영, 없으면 Claude 채팅용 요청문)
  'GET /draft': ({ q }) => { const E = getEp(q.get('ep')); return { json: { ranges: (E.s.sources[0]?.ranges || []).join(', '), text: draftText(E), hasScript: hasScript(E), ai: !!process.env.ANTHROPIC_API_KEY, feedback: E.s.feedback || '' } }; },
  'POST /draft': ({ body }) => {
    const E = getEp(body.ep); mustIdle(E);
    let ranges = body.ranges, text = body.text;
    if (body.answer != null) { const a = splitAnswer(body.answer); if (!a.text) throw new HttpError(400, 'Claude 답이 비어 있어요. 받은 답을 통째로 붙여 넣어 주세요.'); text = a.text; if (a.ranges) ranges = a.ranges; }
    let changed = false, n = 0;
    if (String(ranges || '').trim()) changed = setRanges(E, ranges);
    if (text != null && String(text).trim()) n = saveDraftText(E, text);
    if (body.feedback != null) E.s.feedback = String(body.feedback).slice(0, 4000);
    E.s.feedbackAt = Date.now(); save(E);
    return { json: { ok: true, rangesChanged: changed, lines: n, ranges: (E.s.sources[0]?.ranges || []).join(', ') } };
  },
  'POST /feedback': async ({ body }) => {
    const E = getEp(body.ep); mustIdle(E);
    E.s.feedback = String(body.feedback || '').slice(0, 4000); save(E);
    const prompt = await feedbackPrompt(E, E.s.feedback);
    if (!process.env.ANTHROPIC_API_KEY || body.copyOnly) return { json: { ok: true, ai: false, request: prompt } };
    let txt; try { txt = await callClaude(prompt); } catch (e) { throw new HttpError(502, 'Claude 호출 실패: ' + e.message); }
    const a = splitAnswer(txt); let changed = false;
    if (a.ranges) changed = setRanges(E, a.ranges);
    const n = saveDraftText(E, a.text); E.s.feedbackAt = Date.now(); save(E);
    return { json: { ok: true, ai: true, lines: n, rangesChanged: changed, text: draftText(E), ranges: (E.s.sources[0]?.ranges || []).join(', ') } };
  },
  'POST /link': ({ body }) => { const E = getEp(body.ep); E.s.ideaId = String(body.ideaId || ''); save(E); return { json: { ok: true } }; },
  'POST /run': ({ body }) => {
    const E = getEp(body.ep); mustIdle(E);
    // 한 단계(step) 또는 여러 단계(steps: [...]). 여러 단계는 순서대로 돌고, 하나가 실패하거나 대본(게이트)에서 멈춘다.
    let ids;
    if (Array.isArray(body.steps)) {
      if (!body.steps.length) throw new HttpError(400, '돌릴 단계가 비어 있어요.');
      for (const id of body.steps) if (typeof id !== 'string' || !STEP_FN[id]) throw new HttpError(400, '모르는 단계예요: ' + id);
      ids = orderIds().filter(id => body.steps.includes(id));
    } else {
      const id = String(body.step || ''); if (!STEP_FN[id]) throw new HttpError(400, '모르는 단계예요: ' + id);
      ids = [id];
    }
    if (ids.includes('script')) E.s.gate = false;
    launch(E, ids, false); return { json: { ok: true, step: ids[0], steps: ids } };
  },
  'POST /runall': ({ body }) => {
    const E = getEp(body.ep); mustIdle(E);
    if (E.s.gate) throw new HttpError(400, '대본 확인이 먼저예요. 대본을 읽고 "계속"을 눌러 주세요.');
    const from = firstNotDone(E); if (!from) throw new HttpError(400, '모든 단계가 이미 끝났어요.');
    if (from === 'mix') throw new HttpError(400, '다음은 목소리·음악 단계예요. "음악/녹음"에서 녹음한 뒤 "목소리·음악 넣기"를 누르세요.');
    launch(E, orderIds().slice(orderIds().indexOf(from)), true);
    return { json: { ok: true, from } };
  },
  'GET /script': ({ q }) => {
    const E = getEp(q.get('ep')), rd = rel => { try { return fs.readFileSync(E.p(rel), 'utf8'); } catch { return ''; } };
    const all = parseScript(rd('편집/대본.md')), hasPlaceholder = all.some(l => l.includes(PLACEHOLDER));
    return { json: { request: rd('편집/대본-요청.txt'), lines: all.filter(l => !l.includes(PLACEHOLDER)), hasPlaceholder, ai: !!process.env.ANTHROPIC_API_KEY } };
  },
  'POST /script': ({ body }) => {
    const E = getEp(body.ep); mustIdle(E);
    const lines = cleanPasted(body.text);
    if (!lines.length) throw new HttpError(400, '대사가 한 줄도 없어요. 받은 대사를 붙여 넣어 주세요.');
    const bad = lines.findIndex(l => l.includes(PLACEHOLDER));
    if (bad >= 0) throw new HttpError(400, `${bad + 1}번째 줄에 "${PLACEHOLDER}" 가 남아 있어요. 진짜 대사로 바꿔 주세요.`);
    if (lines.length > SCRIPT_MAX_LINES) throw new HttpError(400, `대사가 너무 많아요. ${SCRIPT_MAX_LINES}줄 이하로 줄여 주세요.`);
    const f = E.p('편집/대본.md'); fs.mkdirSync(E.p('편집'), { recursive: true });
    let head = '';
    if (exists(f)) {
      const old = fs.readFileSync(f, 'utf8'); fs.copyFileSync(f, E.p('편집/대본.bak.md'));
      for (const l of old.split(/\r?\n/)) { const t = l.trim(); if (!t) continue; if (!/^[#>]/.test(t)) break; if (!t.includes('대본-요청.txt')) head += t + '\n'; }
    }
    if (!head) head = `# ${E.s.title}\n> 한 줄 = 자막 한 장면(25자 안팎). "#"·">" 로 시작하는 줄은 무시돼요.\n`;
    for (const [tag, fn] of [['배너', parseBanner], ['훅', parseHook]]) {  // 붙여 넣은 글의 "> 배너:" / "> 훅:" 줄은 머리말에 남겨요
      const t = fn(body.text); if (t) head = head.split('\n').filter(l => !new RegExp(`^>\\s*${tag}`).test(l)).join('\n').replace(/\n*$/, '\n') + `> ${tag}: ${t.raw}\n`;
    }
    fs.writeFileSync(f, head + '\n' + lines.join('\n') + '\n');
    if (E.s.steps.script.status !== 'done') E.s.gate = true;  // 막 만든 대본은 사람이 한 번 더 확인
    E.s.steps.script = { status: 'done' }; save(E);
    return { json: { ok: true, lines: lines.length } };
  },
  'POST /continue': ({ body }) => {
    const E = getEp(body.ep); mustIdle(E);
    if (E.s.steps.script.status !== 'done') throw new HttpError(400, '대본이 아직 안 만들어졌어요.');
    try { checkScript(E); } catch (e) { throw new HttpError(400, e.message); }
    // 대본을 확인했어요 → 줄마다 시간표를 짜요 (영상은 이미 만들어져 있어서 더 돌릴 것 없이 녹음으로 넘어가요)
    try { layoutLines(E); } catch (e) { throw new HttpError(400, e.message); }
    E.s.gate = false; save(E);
    return { json: { ok: true, from: 'mix' } };
  },
  'POST /stop': ({ body }) => {
    const E = getEp(body.ep); E.ctrl.aborted = true;
    try { E.ctrl.child?.kill('SIGTERM'); setTimeout(() => { try { E.ctrl.child?.kill('SIGKILL'); } catch {} }, 3000); } catch {}
    return { json: { ok: true } };
  },
  'POST /open': ({ body }) => { const E = getEp(body.ep); spawn('/usr/bin/open', [E.dir], { stdio: 'ignore', detached: true }).unref(); return { json: { ok: true } }; },
  'GET /log': ({ q }) => {
    const E = getEp(q.get('ep')), id = String(q.get('step') || ''); if (!STEP_FN[id]) throw new HttpError(400, '모르는 단계예요.');
    const f = logFile(E, id), tail = Math.min(+q.get('tail') || 6000, 200000);
    if (!exists(f)) return { text: '' };
    const buf = fs.readFileSync(f); return { text: buf.subarray(Math.max(0, buf.length - tail)).toString('utf8') };
  },
  'GET /lines': ({ q }) => {
    const E = getEp(q.get('ep'));
    let P = null; try { P = JSON.parse(fs.readFileSync(E.p('편집/편집계획.json'), 'utf8')); } catch {}
    const lines = (P?.lines || []).map(l => {
      const v = E.s.voices?.[l.i], ok = v && v.text === l.text && exists(E.p('편집/녹음', v.file));
      return { i: l.i, text: l.text, start: l.start, end: l.end, file: ok ? v.file : null };
    });
    return { json: { lines, assets: { bgm: listAssets(E, 'bgm'), sting: listAssets(E, 'sting') }, mix: E.s.mix || {} } };
  },
  'POST /mixset': ({ body }) => {
    const E = getEp(body.ep), pick = (k, v) => { v = String(v || ''); if (v && !listAssets(E, k).includes(v)) throw new HttpError(400, `목록에 없는 파일이에요: ${v}`); return v; };
    E.s.mix = { bgm: pick('bgm', body.bgm), sting: pick('sting', body.sting) }; save(E); return { json: { ok: true, mix: E.s.mix } };
  },
};

async function readBody(req, limit) {
  const chunks = []; let n = 0;
  for await (const c of req) { n += c.length; if (n > limit) throw new HttpError(413, '파일이 너무 커요.'); chunks.push(c); }
  return Buffer.concat(chunks);
}
const MIME = { '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.webm': 'audio/webm', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.json': 'application/json; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.ass': 'text/plain; charset=utf-8', '.log': 'text/plain; charset=utf-8', '.jpg': 'image/jpeg', '.png': 'image/png' };

function serveFile(req, res, E, rel, dlName = '') {
  const full = path.resolve(E.dir, String(rel || ''));
  if (!rel || !(full === E.dir || full.startsWith(E.dir + path.sep))) throw new HttpError(403, '이 폴더 밖의 파일은 열 수 없어요.');
  let real; try { real = fs.realpathSync(full); } catch { throw new HttpError(404, '파일이 없어요.'); }
  if (!real.startsWith(fs.realpathSync(E.dir) + path.sep)) throw new HttpError(403, '이 폴더 밖의 파일은 열 수 없어요.');
  const st = fs.statSync(real); if (!st.isFile()) throw new HttpError(404, '파일이 아니에요.');
  const type = MIME[path.extname(real).toLowerCase()] || 'application/octet-stream';
  const h = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (dlName) h['Content-Disposition'] = `attachment; filename="download${path.extname(real)}"; filename*=UTF-8''${encodeURIComponent(dlName)}`;   // ⑦ 내려받기
  let start = 0, end = st.size - 1, code = 200;
  const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    if (m[1]) { start = +m[1]; if (m[2]) end = Math.min(+m[2], end); } else { start = Math.max(0, st.size - +m[2]); }
    if (start > end || start >= st.size) { res.writeHead(416, { ...h, 'Content-Range': `bytes */${st.size}` }); return res.end(); }
    code = 206; h['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
  }
  h['Content-Length'] = end - start + 1;
  res.writeHead(code, h);
  if (req.method === 'HEAD' || st.size === 0) return res.end();
  fs.createReadStream(real, { start, end }).on('error', () => res.destroy()).pipe(res);
}

async function saveVoice(E, q, req) {
  const idx = +q.get('idx'); let P = null;
  try { P = JSON.parse(fs.readFileSync(E.p('편집/편집계획.json'), 'utf8')); } catch {}
  if (!P || !P.lines?.length) throw new HttpError(400, '대본을 확인한 뒤에 녹음할 수 있어요. 대본 단계에서 "대본 확인 완료 · 계속"을 눌러 주세요.');
  const line = P.lines[idx]; if (!Number.isInteger(idx) || !line) throw new HttpError(400, '줄 번호가 이상해요.');
  const buf = await readBody(req, 60e6); if (buf.length < 200) throw new HttpError(400, '녹음이 비어 있어요. 다시 녹음해 주세요.');
  fs.mkdirSync(E.p('편집/녹음'), { recursive: true });
  const base = String(idx + 1).padStart(2, '0'), raw = E.p('편집/녹음', `${base}.raw`), out = E.p('편집/녹음', `${base}.m4a`);
  fs.writeFileSync(raw, buf);
  try {
    await run(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-i', raw, '-vn', '-ac', '1', '-ar', '44100',
      '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1', '-c:a', 'aac', '-b:a', '128k', out]);
  } catch (e) { throw new HttpError(422, '녹음 파일을 읽지 못했어요: ' + lastLines(e.err)); }
  finally { fs.rmSync(raw, { force: true }); }
  E.s.voices[idx] = { file: `${base}.m4a`, text: line.text }; save(E);
  return { json: { ok: true, file: `${base}.m4a` } };
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin, host = String(req.headers.host || '').toLowerCase();
  const send = (code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'Content-Type': type }); res.end(body); };
  const cors = {};
  if (origin && ORIGINS.has(origin)) Object.assign(cors, { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin', 'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Allow-Methods': 'GET, POST, HEAD, OPTIONS', 'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || 'Content-Type', 'Access-Control-Max-Age': '600',
    'Access-Control-Expose-Headers': 'Content-Range, Content-Length, Accept-Ranges' });
  const origWrite = res.writeHead.bind(res);
  res.writeHead = (code, h = {}) => origWrite(code, { ...cors, ...h });
  try {
    if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(403, JSON.stringify({ error: '이 주소로는 쓸 수 없어요.' }));
    if (origin && !ORIGINS.has(origin)) return send(403, JSON.stringify({ error: '허용되지 않은 사이트예요.' }));
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://127.0.0.1'), key = `${req.method === 'HEAD' ? 'GET' : req.method} ${url.pathname}`;
    if (key === 'GET /file' && !url.searchParams.get('ep') && url.searchParams.get('path')) {   // 그림 도서관·생성 그림 (읽기 전용)
      let real; try { real = resolveReadable(url.searchParams.get('path')); } catch (e) { throw new HttpError(e.code || 403, e.message); }
      if (url.searchParams.get('thumb')) real = await thumbOf(real);
      const ext = path.extname(real).toLowerCase(); res.writeHead(200, { 'Content-Type': ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png', 'Cache-Control': 'no-cache' });
      return req.method === 'HEAD' ? res.end() : fs.createReadStream(real).pipe(res);
    }
    if (key === 'GET /file') { const E = getEp(url.searchParams.get('ep')), rel = url.searchParams.get('path'); return serveFile(req, res, E, rel, url.searchParams.get('dl') ? `${sanitize(E.s.title, 60) || E.s.ep}-${path.basename(String(rel || ''))}` : ''); }
    if (key === 'POST /voice') { const r = await saveVoice(getEp(url.searchParams.get('ep')), url.searchParams, req); return send(200, JSON.stringify(r.json)); }
    const fn = routes[key]; if (!fn) throw new HttpError(404, '없는 주소예요: ' + url.pathname);
    let body = {};
    if (req.method === 'POST') { const raw = (await readBody(req, 1e6)).toString('utf8'); try { body = raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, '요청이 JSON 이 아니에요.'); } }
    const r = await fn({ body, q: url.searchParams });
    if (r.json) return send(200, JSON.stringify(r.json));
    return send(200, r.text ?? '', 'text/plain; charset=utf-8');
  } catch (e) {
    if (res.headersSent) return res.destroy();
    if (e instanceof HttpError) return send(e.code, JSON.stringify({ error: e.message }));
    console.error(e); send(500, JSON.stringify({ error: '실행기 안에서 오류가 났어요: ' + e.message }));
  }
});

loadAll();
server.listen(PORT, '127.0.0.1', () => console.log(`실행기 주소 http://127.0.0.1:${PORT} · 에피소드 폴더 ${DATA}${process.env.ANTHROPIC_API_KEY ? ' · 대본 AI 켜짐' : ''}`));
const bye = () => { shutdownImages(); for (const E of episodes.values()) { E.ctrl.aborted = true; try { E.ctrl.child?.kill('SIGTERM'); } catch {} } setTimeout(() => process.exit(0), 300); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
