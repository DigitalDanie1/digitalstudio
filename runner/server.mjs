// FIELDNOTE 실행기: 유튜브 쇼츠 제작을 이 맥에서 돌려 주는 작은 서버 (127.0.0.1:4777)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HOME, StepError, StopError, sanitize, exists, parseRanges, isLocalSource, localPath, run, probe, FFMPEG, YTDLP, lastLines, fmtTime, MAX_RANGE } from './util.mjs';
import { createHighlights, LEN_MIN, LEN_MAX } from './highlights.mjs';
import { prepWhisper, pickThemeTopics, WH_LANGS, AI_STYLES, isRefLook, parseMine, aiSegs, analyzeRef, readRefAnalysis, refDir, refKind } from './ai.mjs';
import { listStyles, saveStyle, enqueue, cancelJob, listJobs, resolveReadable, thumbOf, shutdownImages, ImgError } from './images.mjs';
import { STEP_DEFS, STEP_FN, outputsFor, listAssets, checkScript, cleanPasted, parseScript, parseBanner, parseHook, PLACEHOLDER, SCRIPT_MAX_LINES, CHANNEL_PROFILES, LOOK_CHOICES, lookKeyOf, FX_PACKS, fxPackOf, parseFxTimes, migrateState, layoutLines, draftText, draftTranscript, splitAnswer, feedbackPrompt, callClaude, parseCredit, previewPlan, renderPreview } from './steps.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// 작업판이 쓰는 기능 수준. 3 = 새 9칸 순서 (/look, /ranges, deferRanges, 단계 clip·subs·fx)
const WH = { state: 'idle', log: [] };
let themeBusy = false;
const API_LEVEL = 28;   // 28 = yt-dlp 가 봇 확인으로 막히면 다른 플레이어(tv·mweb·web_safari·ios)로 다시 시도 · 27 = AI 주제 발굴: 테마별 소스 링크에서 주제 뽑기 (POST /themes/pick) · 26 = YouTube - Wrestling KOREA 채널 (yt-wrestling-kr), 영상 속 말 언어 16가지 (자동이면 제목 글자로 짐작) · 25 = 자막: Whisper 로 영상 소리 직접 받아 적기 (한국어·영어), 위 고정 제목 두 줄 고치기 (top1·top2), 자막 모양 7가지 (capStyle) · 24 = 자막: 기술 설명(tech)·영상 음성(speech) + 언어(ko|en|both) · 23 = Claude 가 지금 하는 일 실시간 (편집/진행_claude.json, stream-json) · 22 = 그리는 중인 화면 실시간 (진행_<단계>_live.jpg) · 21 = 자막 편집기 (GET /segs, run body.subs.edit) · 20 = 사이트에서 실행기 업데이트 (POST /update: GitHub 최신 runner 파일 받아서 검사 후 바꾸고 다시 켜기), 레퍼런스 분석 줄 세우기 (queued) · 19 = 모든 AI 단계 실시간 보기 (편집/진행_<단계>.json) · 18 = 1차 컷 실시간 보기 (편집/AI컷_진행.json) · 17 = 레퍼런스 쇼츠 분석 (POST /ref/analyze, GET /ref/status, GET /ref/<id>: 컷·후크·이펙트·이목 장치를 먼저 보여 주고 고르면 그대로 적용) · 16 = 자막 원문·번역·해설·내 자막 나눠 켜기 (run body.subs), 썸네일 내 카피 (run body.thumb) · 15 = 실행기 다시 켜기 (POST /restart, health.disk) · 14 = 내 영상 올리기 (POST /upload) · 13 = 레퍼런스 쇼츠 룩 (look ref-<영상ID>, view.refStyle) · 12 = 한 구간·하이라이트 길이 최대 3분(30초·1분·2분·3분), 쇼츠 최대 3분 · 11 = 하이라이트 '지난 작업' 초기화(/hl/reset, 돌고 있으면 멈추고 휴지통 한 폴더로) · 10 = AI 편집 단계(aicut·aistyle·aisubs, 맥의 Claude Code) · 9 = 유튜브 초기화(/reset, 에피소드·하이라이트 전부 휴지통 한 폴더로) · 8 = 미리보기 견본(/preview, 고른 룩·이펙트를 실제 영상 4초로) · 7 = 에피소드 완전히 지우기(/episode/delete, 휴지통으로) · 6 = 하이라이트 찾기(/hl/*) ·  4 = 7칸 순서 (/edit 1차·2차 편집, /draft, /feedback, 슬로우 구간 x0.5, 매트 스토리 룩) · 5 = 최종 결과물 레퍼런스(이펙트 팩: /fxpack, status.fxPacks)
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
const HL_DATA = process.env.FIELDNOTE_HIGHLIGHT_DATA || path.join(path.dirname(DATA), '하이라이트');
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
    look: E.s.look || '', lookUsed: lookKeyOf(E), vtype: E.s.vtype || '', subsOpt: E.s.subsOpt ? { en: E.s.subsOpt.en, ko: E.s.subsOpt.ko, ai: E.s.subsOpt.ai, tech: E.s.subsOpt.tech, speech: E.s.subsOpt.speech, techLang: E.s.subsOpt.techLang, speechLang: E.s.subsOpt.speechLang, mine: E.s.subsOpt.mineText || '', capStyle: E.s.subsOpt.capStyle || 'mat', top1: E.s.subsOpt.top1 || '', top2: E.s.subsOpt.top2 || '', srcLang: E.s.subsOpt.srcLang || '' } : null, aiFrame: (() => { try { return JSON.parse(fs.readFileSync(E.p(fs.existsSync(E.p('편집/AI스타일.json')) ? '편집/AI스타일.json' : '편집/AI완성.json'), 'utf8')).frame || null; } catch { return null; } })(), thumbText: E.s.thumbText || null, refStyle: E.s.refStyle && E.s.refStyle.look === E.s.look ? { name: E.s.refStyle.name, desc: E.s.refStyle.desc, base: E.s.refStyle.base } : null,
    fxPack: E.s.fxPack || '', fxPackUsed: fxPackOf(E).id, fxTimes: E.s.fxTimes || '', fxLabels: E.s.fxLabels || [],
    sources: E.s.sources.map(x => ({ url: x.url, ranges: x.ranges })),
    steps: STEP_DEFS.map(d => {
      const st = E.s.steps[d.id], o = { id: d.id, name: d.name, status: st.status, outputs: outputsFor(d.id, E).map(p => { const ex = exists(E.p(p)), r = { path: p, exists: ex }; if (ex) { try { r.mtime = Math.round(fs.statSync(E.p(p)).mtimeMs); } catch {} } return r; }) };
      if (d.gate) o.gate = true;
      if (st.error) o.error = st.error;
      return o;
    }),
    running: E.running, gate: !!E.s.gate,
    progress: E.prog ? editPct(E) : E.aiProg ? aiPct(E) : null,
    round: E.s.round || 0, editRound: E.s.editRound || 0, editAt: E.s.editAt || 0, feedbackAt: E.s.feedbackAt || 0, hasScript: hasScript(E),
  };
}

const hasScript = E => { if (E.s.steps?.script?.status !== 'done') return false; try { checkScript(E); return true; } catch { return false; } };
// ---------- 실행 ----------
const logFile = (E, id) => E.p('로그', id + '.log');
function makeCtx(E, id) {
  fs.mkdirSync(E.p('로그'), { recursive: true });
  const f = logFile(E, id);
  const ctx = {
    log: l => { if (l == null || l === '') return; try { fs.appendFileSync(f, `[${stamp()}] ${l}\n`); } catch {} },
    aborted: () => E.ctrl.aborted, setChild: c => { E.ctrl.child = c; }, stepId: id,
  };
  if (E.prog && EDIT_W[id]) {   // 편집 중이면 ffmpeg 진행을 퍼센트로 (여러 번 돌면 이어서 더해요)
    const P = E.prog; P.cur = id; P.sub = 0; let base = 0, last = 0; const exp = expectSecs(E);
    ctx.onTime = t => { if (t + 0.5 < last) base += last; last = t; P.sub = Math.min(1, (base + t) / exp); };
  }
  return ctx;
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
  const ai = ids.filter(id => AI_SECS[id]);
  E.aiProg = ai.length ? { ids: ai, cur: '', t0: 0 } : null;
  (async () => {
    for (const id of ids) {
      if (E.ctrl.aborted) break;
      if (chain && E.s.steps[id].status === 'done' && id !== ids[0]) continue;
      if (chain && id === 'mix') { makeCtx(E, 'mix').log('목소리 녹음 단계에서 멈췄어요. "음악/녹음"에서 녹음하고 "목소리·음악 넣기"를 누르세요.'); break; }
      if (E.aiProg) { E.aiProg.cur = id; E.aiProg.t0 = Date.now(); }
      const ok = await runStep(E, id);
      if (ok && E.aiProg && AI_SECS[id]) aiLearn(id, (Date.now() - E.aiProg.t0) / 1000);
      if (!ok) break;
      if (id === 'script') break;  // 게이트
    }
    E.running = null; E.aiProg = null;
  })();
}
// ---------- AI 편집 진행 퍼센트 ----------
// Claude 가 영상을 보는 동안은 진행을 알 수 없어서, 단계마다 지난번에 걸린 시간으로 어림해요 (처음엔 기본값). 끝나기 전에는 95%를 넘지 않아요.
const AI_SECS = { research: 10, download: 60, aicut: 300, aistyle: 240, aisubs: 150, aibrand: 120, aithumb: 120 };
const AI_TIMES_F = path.join(DATA, '.ai-times.json');
let aiTimes = {}; try { aiTimes = JSON.parse(fs.readFileSync(AI_TIMES_F, 'utf8')); } catch {}
const aiExp = id => aiTimes[id] || AI_SECS[id];
function aiLearn(id, sec) { if (!(sec > 1)) return; aiTimes[id] = Math.round(aiTimes[id] ? aiTimes[id] * 0.6 + sec * 0.4 : sec); try { fs.writeFileSync(AI_TIMES_F, JSON.stringify(aiTimes)); } catch {} }
function aiPct(E) {
  const P = E.aiProg, total = P.ids.reduce((t, id) => t + aiExp(id), 0); let done = 0;
  for (const id of P.ids) {
    if (id === P.cur) { const x = (Date.now() - P.t0) / 1000 / aiExp(id); done += aiExp(id) * (x < 0.9 ? x : 0.9 + 0.09 * (1 - Math.exp(-(x - 0.9) * 3))); break; }
    done += aiExp(id);
  }
  return Math.min(95, Math.max(1, Math.round(done / total * 100)));
}
// ---------- 1차·2차 편집 진행 퍼센트 ----------
// 단계 무게(합 100): 자르기·이펙트·합치기가 오래 걸려요. 단계 안에서는 ffmpeg 가 만든 길이 / 예상 길이.
const EDIT_W = { clip: 30, plan: 2, rough: 15, subs: 10, fx: 20, script: 3, mix: 20 };
const editPct = E => { const P = E.prog; let done = 0; for (const id of Object.keys(EDIT_W)) { if (id === P.cur) return Math.min(99, Math.round(done + EDIT_W[id] * Math.min(1, P.sub || 0))); done += EDIT_W[id]; } return 99; };   // cur 앞 단계는 끝난(또는 건너뛴) 것
function expectSecs(E) {   // 결과 영상 예상 길이 (편집 계획이 있으면 그 길이)
  try { const P = JSON.parse(fs.readFileSync(E.p('편집/편집계획.json'), 'utf8')); if (P.total > 0) return P.total; } catch {}
  let t = 0, info = []; try { info = JSON.parse(fs.readFileSync(E.p('소스.json'), 'utf8')); } catch {}
  for (const [i, s] of E.s.sources.entries()) for (const r of s.ranges) { if (r === '전체') { t += Math.min(180, info[i]?.duration || 180); continue; } const m = /^(\d+(?::\d+)*)-(\d+(?::\d+)*)(?:x([\d.]+))?$/.exec(r); if (!m) continue; const sec = x => x.split(':').reduce((a, n) => a * 60 + +n, 0); t += (sec(m[2]) - sec(m[1])) / (m[3] ? +m[3] : 1); }
  return t || 30;
}
// 1차·2차 편집: 자르기 → 계획 → 가편집 → 자막 → 이펙트 → (대본이 없으면 양식) → 대본 자막·소리 합치기(최종본). 대본 확인에서 멈추지 않아요.
function launchEdit(E, round) {
  E.ctrl.aborted = false; E.s.editRound = round; E.running = 'clip'; E.prog = { cur: 'clip', sub: 0 }; save(E);
  (async () => {
    try {
      for (const id of ['clip', 'plan', 'rough', 'subs', 'fx']) { if (E.ctrl.aborted || !(await runStep(E, id))) return; }
      if (E.s.steps.script.status !== 'done' && !(await runStep(E, 'script'))) return;
      E.s.gate = false; save(E);
      const ctx = makeCtx(E, 'mix');
      if (hasScript(E)) { try { layoutLines(E, ctx); } catch (e) { ctx.log('대본 시간표를 못 짰어요: ' + e.message); } }
      else {   // 대본이 아직 빈 양식이면 자막 없이 만들어요 (자막 넣기 단계에서 자막을 넣어요)
        try { const f = E.p('편집/편집계획.json'), P = JSON.parse(fs.readFileSync(f, 'utf8')); P.lines = []; fs.writeFileSync(f, JSON.stringify(P, null, 2)); } catch {}
      }
      if (E.ctrl.aborted) return;
      const keep = fs.existsSync(logFile(E, 'mix')) ? fs.readFileSync(logFile(E, 'mix'), 'utf8') : '';
      if (await runStep(E, 'mix')) {
        if (keep) try { fs.writeFileSync(logFile(E, 'mix'), keep + fs.readFileSync(logFile(E, 'mix'), 'utf8')); } catch {}
        E.s.round = Math.max(E.s.round || 0, round); E.s.editAt = Date.now(); save(E);
      }
    } finally { E.running = null; E.prog = null; }
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
// 파인더에서 폴더를 지운 에피소드는 목록에서도 빼요 (돌고 있는 건 그대로)
const pruneGone = () => { for (const [k, E] of episodes) if (!E.running && !exists(E.dir)) { episodes.delete(k); try { HL.dropEpisodeRef(k); } catch {} } };
const getEp = name => { const E = episodes.get(String(name || '')); if (!E) throw new HttpError(404, '에피소드를 찾을 수 없어요.'); return E; };
const mustIdle = E => { if (E.running) throw new HttpError(409, '지금 다른 단계가 돌고 있어요. 끝나거나 멈춘 뒤에 눌러 주세요.'); };

function addSource(E, url, ranges, defer = false) {
  url = String(url || '').trim(); if (!url) return;
  if (!isLocalSource(url) && !/^https?:\/\//i.test(url)) throw new HttpError(400, '소스 주소가 이상해요. https:// 로 시작하는 유튜브 주소를 넣어 주세요.');
  let rg; try { rg = parseRanges(ranges); } catch (e) { throw new HttpError(400, e.message); }
  if (!rg.length && !defer) rg = ['0:00-0:15'];   // defer: 구간은 컷 편집에서 나중에 정해요
  E.s.sources.push({ url, ranges: rg });
}

// 에피소드 하나 만들기 (POST /episodes 와 하이라이트 만들기가 같이 써요)
function createEpisode(body, nameBase = '') {
  const title = String(body.title || '').trim(); if (!title) throw new HttpError(400, '제목이 필요해요.');
  let ep = sanitize(nameBase || title) || '새 주제', n = 1; const base = ep;
  while (exists(path.join(DATA, ep))) ep = `${base}-${++n}`;
  const s = { ep, title, note: String(body.note || ''), ideaId: body.ideaId || '', format: body.format === 'long' ? 'long' : 'shorts',
    channel: String(body.channel || '').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 40), look: CHANNEL_PROFILES[body.look] ? body.look : '', voice: String(body.voice || '').slice(0, 2000), sources: [], created: Date.now(), gate: false, mix: {}, voices: {},
    steps: Object.fromEntries(STEP_DEFS.map(d => [d.id, { status: 'todo' }])) };
  const E = makeEpisode(path.join(DATA, ep), s);
  addSource(E, body.url, body.ranges, !!body.deferRanges);
  for (const d of ['원본', '클립', '편집/녹음', '업로드', '로그']) fs.mkdirSync(E.p(d), { recursive: true });
  save(E); episodes.set(ep, E);
  return E;
}

// ---------- 하이라이트 찾기 ----------
const HL = createHighlights({ dataDir: HL_DATA });
const refJobs = new Map();   // 레퍼런스 분석 작업: id -> {status: queued|running|done|failed, stage, error, kind}. 한 번에 하나씩 차례대로
function refNext() {
  if ([...refJobs.values()].some(J => J.status === 'running')) return;
  const next = [...refJobs.entries()].filter(([, J]) => J.status === 'queued').sort((a, b) => a[1].at - b[1].at)[0];
  if (!next) return;
  const [id, J] = next; J.status = 'running'; J.stage = '시작';
  const ctx = { log: l => { if (l) J.stage = String(l).trim().slice(0, 120); }, aborted: () => J.aborted, setChild: c => { J.child = c; } };
  analyzeRef(id, J.ch, ctx).then(() => { J.status = 'done'; }, e => { J.status = 'failed'; J.error = e instanceof StepError || e instanceof StopError ? e.message : '예상 못 한 오류: ' + e.message; if (!(e instanceof StepError || e instanceof StopError)) console.error(e); }).finally(refNext);
}
const readJsonSafe = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const getHL = id => { const J = HL.get(id); if (!J) throw new HttpError(404, '이 하이라이트 작업을 찾을 수 없어요.'); return J; };
const hlErr = e => { if (e instanceof StepError) throw new HttpError(400, e.message); throw e; };
const linkOrCopy = (from, to) => { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.rmSync(to, { force: true }); try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); } };
// 하이라이트 → 에피소드. 받아 둔 통영상을 그대로 붙이고(하드링크, 안 되면 복사) "소스 확인·영상 받기"는 끝난 걸로 해 둬요. 구간 자르기부터 이어서 하면 돼요.
function hlMake(J, body) {
  const s = J.s, v = HL.videoOf(J);
  if (!exists(v)) throw new HttpError(409, '원본 영상이 아직 없어요. 분석이 끝난 뒤에 눌러 주세요.');
  const mode = body.mode === 'merge' ? 'merge' : body.mode === 'each' ? 'each' : ''; if (!mode) throw new HttpError(400, 'mode 는 each 또는 merge 여야 해요.');
  if (!Array.isArray(body.picks) || !body.picks.length) throw new HttpError(400, '체크한 후보가 없어요.');
  if (body.picks.length > 40) throw new HttpError(400, '한 번에 40개까지만 만들 수 있어요.');
  const picks = body.picks.map((p, i) => {
    const a = Math.round(+p?.a), b = Math.round(+p?.b);
    if (!(a >= 0) || !(b > a)) throw new HttpError(400, `${i + 1}번째 구간이 이상해요. 끝이 시작보다 늦어야 해요.`);
    if (b - a > MAX_RANGE) throw new HttpError(400, `${i + 1}번째 구간이 ${MAX_RANGE}초를 넘어요 (${fmtTime(a)}-${fmtTime(b)}).`);
    if (s.duration && b > s.duration + 0.5) throw new HttpError(400, `${i + 1}번째 구간이 영상 길이(${fmtTime(s.duration)})를 넘어요.`);
    return { a, b, rank: Number.isInteger(p?.rank) && p.rank > 0 ? p.rank : i + 1 };
  });
  const channel = String(body.channel || 'yt-wrestling').toLowerCase().replace(/[^a-z-]/g, '').slice(0, 40) || 'yt-wrestling';
  const isLocal = isLocalSource(s.url), shortTitle = sanitize(s.title, 30) || '하이라이트';
  const range = p => `${fmtTime(p.a)}-${fmtTime(p.b)}`;
  const groups = mode === 'each' ? picks.map(p => ({ title: `${s.title} 하이라이트 ${p.rank}`, name: `${shortTitle} 하이라이트 ${p.rank}`, ranges: [range(p)] }))
    : [{ title: `${s.title} 하이라이트 모음`, name: `${shortTitle} 하이라이트 모음`, ranges: [...picks].sort((x, y) => x.a - y.a).map(range) }];
  const made = [], warns = [];
  for (const g of groups) {
    const E = createEpisode({ title: g.title, url: s.url, ranges: g.ranges, channel, format: 'shorts' }, g.name);
    const info = { url: s.url, local: isLocal, title: s.title, channel: s.channel || (isLocal ? '(내 파일)' : ''), duration: s.duration || null, id: s.videoId || path.basename(s.url), license: s.license || null, ranges: parseRanges(g.ranges) };
    if (!isLocal) {
      linkOrCopy(v, E.p('원본/full_1.mp4')); info.full = '원본/full_1.mp4';
      const sub = s.subFile && path.join(J.dir, s.subFile);
      if (sub && exists(sub)) { const rel = `원본/자막/${path.basename(sub)}`; fs.mkdirSync(E.p('원본/자막'), { recursive: true }); fs.copyFileSync(sub, E.p(rel)); info.subFile = rel; } else info.subFile = '';
    }
    fs.writeFileSync(E.p('소스.json'), JSON.stringify([info], null, 2));
    E.s.steps.research = { status: 'done' }; E.s.steps.download = { status: 'done' };
    save(E);
    const total = g.ranges.reduce((t, r) => { const [x, y] = r.split('-').map(z => z.split(':').reduce((a, n) => a * 60 + +n, 0)); return t + y - x; }, 0);
    if (total > 180) warns.push(`"${g.title}" 는 합치면 ${fmtTime(total)}라서 쇼츠 한도(3분)를 넘어요. 컷 편집에서 줄여 주세요.`);
    made.push({ ep: E.s.ep, title: g.title, ranges: g.ranges });
  }
  return { ok: true, mode, episodes: made, warnings: warns };
}
const hlStart = async body => {
  try {
    if (body.episode) {
      const E = getEp(body.episode), info = readJsonSafe(E.p('소스.json')), si = Number.isInteger(body.source) ? body.source : 0, s = info?.[si];
      if (!s) throw new HttpError(400, '이 에피소드는 소스 확인과 영상 받기가 먼저예요.');
      const local = s.local ? localPath(s.url) : (s.full && exists(E.p(s.full)) ? E.p(s.full) : '');
      if (!local || !exists(local)) throw new HttpError(400, '이 에피소드는 영상을 아직 못 받았어요. 영상 받기를 먼저 해 주세요.');
      const J = await HL.start({ local, info: { url: s.url, title: s.local ? E.s.title : s.title, id: s.id, duration: s.duration, channel: s.channel, license: s.license }, count: body.count, len: body.len, fromEpisode: E.s.ep });
      const sub = !s.local && s.subFile && E.p(s.subFile);
      if (sub && exists(sub) && !J.s.subFile) { const rel = `원본/자막/${path.basename(sub)}`; fs.mkdirSync(path.join(J.dir, '원본/자막'), { recursive: true }); fs.copyFileSync(sub, path.join(J.dir, rel)); J.s.subFile = rel; }
      return J;
    }
    return await HL.start({ url: body.url, count: body.count, len: body.len });
  } catch (e) { hlErr(e); }
};
// /hl/<id>, /hl/<id>/make|stop|pick
const HL_RESERVED = new Set(['start', 'list']);
const hlDynamic = async (method, url, body) => {
  const m = /^\/hl\/([^/]+)(?:\/(make|stop|pick))?$/.exec(url.pathname); if (!m) return null;
  let id; try { id = decodeURIComponent(m[1]); } catch { throw new HttpError(400, '주소가 이상해요.'); }
  if (HL_RESERVED.has(id)) return null;
  const J = getHL(id), act = m[2] || '';
  if (!act && method === 'GET') return { json: HL.detail(J) };
  if (act === 'make' && method === 'POST') return { json: hlMake(J, body) };
  if (act === 'stop' && method === 'POST') { HL.stop(J); return { json: { ok: true } }; }
  if (act === 'pick' && method === 'POST') { try { HL.repick(J, body); } catch (e) { hlErr(e); } return { json: { ok: true } }; }
  return null;
};

const imgWrap = fn => a => { try { return fn(a); } catch (e) { if (e instanceof ImgError) throw new HttpError(e.code || 400, e.message); throw e; } };
// ---------- 휴지통 ----------
const trashRoot = () => process.env.FIELDNOTE_TRASH_DIR || path.join(os.homedir(), '.Trash');
const tsNow = () => { const d = new Date(), p2 = n => String(n).padStart(2, '0'); return `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}-${p2(d.getHours())}${p2(d.getMinutes())}${p2(d.getSeconds())}`; };
// src 폴더를 parent/name 으로 옮겨요 (이름이 있으면 -2, -3). 다른 디스크면 복사한 뒤 지워요. 옮긴 곳을 돌려줘요.
function moveToTrash(src, parent, name) {
  fs.mkdirSync(parent, { recursive: true });
  let dest = path.join(parent, name), n = 1;
  while (exists(dest)) dest = path.join(parent, `${name}-${++n}`);
  try { fs.renameSync(src, dest); }
  catch (e) {
    try { fs.cpSync(src, dest, { recursive: true }); fs.rmSync(src, { recursive: true, force: true }); }
    catch (e2) { try { fs.rmSync(dest, { recursive: true, force: true }); } catch {} throw new HttpError(500, '휴지통으로 옮기지 못했어요: ' + e2.message); }
  }
  return dest;
}
// ---------- 견본 작업 (한 번에 하나) ----------
let pvJob = null;   // { key, ctrl, promise }
async function previewRun(E, spec) {
  let plan;
  try { plan = await previewPlan(E, spec); } catch (e) { if (e instanceof StepError) throw new HttpError(400, e.message); throw e; }
  if (exists(E.p(plan.rel))) return { ok: true, path: plan.rel, cached: true };
  const key = E.s.ep + '|' + plan.rel;
  if (pvJob && pvJob.key === key) return pvJob.promise;   // 같은 견본을 이미 만드는 중이면 그걸 기다려요
  if (pvJob) { pvJob.ctrl.aborted = true; try { pvJob.ctrl.child?.kill('SIGTERM'); } catch {} }   // 새 요청이 오면 옛 견본은 멈춰요
  const ctrl = { aborted: false, child: null }, job = { key, ctrl, promise: null };
  job.promise = (async () => {
    try { await renderPreview(E, plan, { aborted: () => ctrl.aborted, setChild: c => { ctrl.child = c; } }); return { ok: true, path: plan.rel }; }
    catch (e) {
      if (e instanceof StopError) throw new HttpError(409, '새 견본 요청이 와서 이 견본은 멈췄어요.');
      if (e instanceof StepError) throw new HttpError(422, e.message);
      throw e;
    } finally { if (pvJob === job) pvJob = null; }
  })();
  pvJob = job;
  return job.promise;
}

const topCache = new Map();
const routes = {
  'GET /img/styles': imgWrap(() => ({ json: { styles: listStyles() } })),
  'POST /img/styles': imgWrap(({ body }) => ({ json: { ok: true, style: saveStyle(body) } })),
  'POST /img/generate': imgWrap(({ body }) => ({ json: { ok: true, job: enqueue(body) } })),
  'GET /img/jobs': ({ q }) => ({ json: { jobs: listJobs(q.get('projectId') || '') } }),
  'POST /img/cancel': imgWrap(({ body }) => ({ json: { ok: true, job: cancelJob(body.id) } })),
  // 레퍼런스 쇼츠 분석: 한 번에 하나. 끝나면 ~/Desktop/유투브/레퍼런스/<id>/analysis-<kind>.json
  'POST /ref/analyze': ({ body }) => {
    const id = String(body.id || ''), ch = String(body.channel || 'yt-wrestling');
    if (!/^[\w-]{11}$/.test(id)) throw new HttpError(400, '쇼츠 ID 가 이상해요.');
    const cur = refJobs.get(id);
    if (cur && (cur.status === 'running' || cur.status === 'queued')) return { json: { ok: true, status: cur.status } };
    const J = { status: 'queued', stage: '차례를 기다려요', error: '', kind: refKind(ch), ch, aborted: false, child: null, at: Date.now() };
    refJobs.set(id, J); refNext();
    return { json: { ok: true, status: J.status } };
  },
  'GET /ref/status': ({ q }) => {
    const kind = refKind(String(q.get('channel') || 'yt-wrestling')), out = {};
    for (const id of String(q.get('ids') || '').split(',').filter(x => /^[\w-]{11}$/.test(x)).slice(0, 60)) {
      const J = refJobs.get(id), a = readRefAnalysis(id, kind);
      out[id] = J && (J.status === 'running' || J.status === 'queued') ? { status: J.status, stage: J.stage } : a ? { status: 'done', name: a.name, desc: a.desc } : J && J.status === 'failed' && J.kind === kind ? { status: 'failed', error: J.error } : { status: 'none' };
    }
    return { json: { refs: out } };
  },
  'GET /hl/list': () => ({ json: { jobs: HL.list(), dir: HL.dir, limits: { lenMin: LEN_MIN, lenMax: LEN_MAX } } }),
  'POST /hl/start': async ({ body }) => { const J = await hlStart(body); return { json: { ok: true, id: J.id } }; },
  // 하이라이트 '지난 작업' 초기화: 돌고 있으면 멈추고, 작업 폴더를 전부 휴지통 '하이라이트 초기화 <시각>' 한 폴더로. 에피소드는 그대로
  'POST /hl/reset': async () => {
    for (const J of HL.jobs.values()) if (J.running) HL.stop(J);
    for (let i = 0; i < 50 && HL.anyRunning(); i++) await new Promise(r => setTimeout(r, 100));
    if (HL.anyRunning()) throw new HttpError(409, '아직 멈추는 중이에요. 잠시 뒤에 다시 눌러 주세요.');
    const dest = path.join(trashRoot(), `하이라이트 초기화 ${tsNow()}`);
    let n = 0;
    try { n = HL.resetAll((dir, name) => { if (exists(dir)) moveToTrash(dir, dest, name); }); }
    catch (e) { if (e instanceof StepError) throw new HttpError(409, e.message); throw e; }
    return { json: { ok: true, trashed: exists(dest) ? dest : '', highlights: n } };
  },
  'GET /': () => ({ text: '실행기가 켜져 있어요.' }),
  // 레퍼런스 탭: 채널 링크의 대표 영상(최근 쇼츠 50개 중 조회수 1위). 한 번 찾으면 기억해요.
  'GET /yt/top': async ({ q }) => {
    let u = String(q.get('url') || '').trim();
    if (!/^https:\/\/(www\.|m\.)?youtube\.com\/(@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)/i.test(u)) throw new HttpError(400, '유튜브 채널 주소가 아니에요.');
    u = u.replace(/[?#].*$/, '').replace(/\/(shorts|videos|featured|streams)\/?$/i, '').replace(/\/$/, '');
    if (topCache.has(u)) return { json: topCache.get(u) };
    const pick = async tab => {
      let r; try { r = await run(YTDLP, ['--flat-playlist', '-I', '1:50', '--no-warnings', '--print', '%(id)s\t%(view_count)s\t%(title)s', `${u}/${tab}`]); } catch { return null; }
      const rows = r.out.split('\n').map(l => l.split('\t')).filter(x => /^[\w-]{11}$/.test(x[0] || '')).map(([id, v, ...t]) => ({ videoId: id, views: +v || 0, title: t.join('\t') }));
      return rows.sort((a, b) => b.views - a.views)[0] || null;
    };
    const best = (await pick('shorts')) || (await pick('videos'));
    if (!best) throw new HttpError(404, '이 채널에서 영상을 찾지 못했어요.');
    const out = { ok: true, ...best }; topCache.set(u, out); return { json: out };
  },
  'GET /health': () => { let disk = ''; try { disk = fs.readFileSync(path.join(HERE, 'version.txt'), 'utf8').trim(); } catch {}
    return { json: { ok: true, api: API_LEVEL, version: VERSION, disk, auto: !!process.env.XPC_SERVICE_NAME && process.env.XPC_SERVICE_NAME.includes('digitalstudio'), ffmpeg: exists(FFMPEG), data: DATA, ai: !!process.env.ANTHROPIC_API_KEY } }; },
  // 실행기 다시 켜기: 새 파일을 받은 뒤 사이트 버튼으로. 자동실행(launchd KeepAlive)이 곧바로 새 버전으로 다시 켜요.
  // 사이트의 '실행기 업데이트': GitHub main 의 runner 파일을 받아 문법 검사 후 바꾸고 다시 켜요 (자동실행이면 launchd 가 새 버전으로 다시 띄워요)
  'POST /update': async () => {
    if ([...episodes.values()].some(E => E.running) || HL.anyRunning() || [...refJobs.values()].some(J => J.status === 'running')) throw new HttpError(409, '작업이 돌고 있어요. 끝난 뒤에 업데이트해 주세요.');
    if (typeof fetch !== 'function') throw new HttpError(500, '이 맥의 node 가 너무 예전 버전이라 업데이트를 못 받아요.');
    const REPO = 'DigitalDanie1/digitalstudio', get = async (u, json) => { const r = await fetch(u, { headers: { 'User-Agent': 'fieldnote-runner' } }); if (!r.ok) throw new HttpError(502, `GitHub 에서 못 받았어요 (${r.status}): ${u.split('/').slice(-2).join('/')}`); return json ? r.json() : r.text(); };
    const sha = String((await get(`https://api.github.com/repos/${REPO}/commits/main`, true)).sha || '');
    if (!/^[0-9a-f]{40}$/.test(sha)) throw new HttpError(502, 'GitHub 최신 버전을 못 읽었어요.');
    const to = sha.slice(0, 7), auto = !!process.env.XPC_SERVICE_NAME && process.env.XPC_SERVICE_NAME.includes('digitalstudio');
    const FILES = ['server.mjs', 'steps.mjs', 'ai.mjs', 'util.mjs', 'images.mjs', 'highlights.mjs', 'whisper.mjs', 'styles.json', 'README.md', '실행기 켜기.command', '자동실행 켜기.command', '자동실행 끄기.command', '유튜브 로그인 연결.command'];
    if (to === VERSION && FILES.every(f => exists(path.join(HERE, f)))) return { json: { ok: true, same: true, version: VERSION } };   // 빠진 파일이 있으면 같은 버전이어도 다시 받아요
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldnote-update-'));
    try {
      for (const f of FILES) {
        fs.writeFileSync(path.join(tmp, f), await get(`https://raw.githubusercontent.com/${REPO}/${sha}/runner/${encodeURIComponent(f)}`));
        if (f.endsWith('.mjs')) { const c = spawnSync(process.execPath, ['--check', path.join(tmp, f)], { encoding: 'utf8' }); if (c.status !== 0) throw new HttpError(500, `${f} 검사에서 걸렸어요. 업데이트를 멈췄어요: ${lastLines(c.stderr || '')}`); }
      }
      for (const f of FILES) { fs.copyFileSync(path.join(tmp, f), path.join(HERE, f)); if (f.endsWith('.command')) fs.chmodSync(path.join(HERE, f), 0o755); }
      fs.writeFileSync(path.join(HERE, 'version.txt'), to + '\n');
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
    console.log(`실행기 업데이트: ${VERSION} -> ${to}`);
    if (auto) setTimeout(bye, 300);
    return { json: { ok: true, from: VERSION, to, restarting: auto } };
  },
  // AI 주제 발굴: 테마별 소스 링크에서 영상 목록을 모으고 Claude 가 테마에 맞는 영상을 골라 주제로 (1~3분)
  'POST /themes/pick': async ({ body: b }) => {
    const S = (v, n) => String(v || '').slice(0, n), links = (Array.isArray(b.links) ? b.links : []).map(u => S(u, 300).trim()).filter(u => /^https:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i.test(u)).slice(0, 10);
    if (!links.length) throw new HttpError(400, '유튜브 채널·영상·재생목록 링크를 한 줄에 하나씩 넣어 주세요.');
    if (themeBusy) throw new HttpError(409, '다른 테마의 주제를 뽑는 중이에요. 끝난 뒤에 다시 눌러 주세요.');
    themeBusy = true;
    try {
      const r = await pickThemeTopics({ channelName: S(b.channelName, 60), persona: S(b.persona, 1500), theme: S(b.theme, 80), note: S(b.note, 1500), format: b.format === 'long' ? 'long' : 'shorts', links,
        count: Math.max(1, Math.min(10, +b.count || 5)), existing: (Array.isArray(b.existing) ? b.existing : []).map(t => S(t, 200)).slice(0, 200), used: (Array.isArray(b.used) ? b.used : []).map(t => S(t, 11)) },
        { log: l => console.log('[주제 뽑기] ' + l), aborted: () => false, setChild: () => {}, onTime: () => {}, stepId: 'themes' });
      return { json: { ok: true, ...r } };
    } catch (e) { if (e instanceof StepError) throw new HttpError(422, e.message); throw e; }
    finally { themeBusy = false; }
  },
  'POST /whisper/prep': () => {   // Whisper 미리 설치 (패키지 + 모델 약 1GB). 상태는 GET /whisper
    if (WH.state !== 'running') { WH.state = 'running'; WH.log = []; prepWhisper({ log: l => { WH.log.push(l); WH.log = WH.log.slice(-20); }, aborted: () => false, setChild: () => {}, onTime: () => {} }).then(() => { WH.state = 'done'; }, e => { WH.state = 'error'; WH.log.push(e.message); }); }
    return { json: { ok: true, state: WH.state } };
  },
  'GET /whisper': () => ({ json: { state: WH.state, log: WH.log } }),
  'POST /restart': () => {
    if ([...episodes.values()].some(E => E.running)) throw new HttpError(409, '작업이 돌고 있어요. 끝난 뒤에 다시 켜 주세요.');
    setTimeout(bye, 300); return { json: { ok: true } };
  },
  'GET /segs': ({ q }) => { const E = getEp(q.get('ep')); try { return { json: aiSegs(E) }; } catch (e) { throw new HttpError(409, '1차 컷을 먼저 만들어 주세요.'); } },
  'GET /status': () => { pruneGone(); return { json: { looks: LOOK_CHOICES, fxPacks: FX_PACKS, episodes: [...episodes.values()].sort((a, b) => b.s.created - a.s.created).map(view) } }; },
  'GET /episodes': () => routes['GET /status'](),
  'POST /episodes': ({ body }) => { const E = createEpisode(body); return { json: { ok: true, ep: E.s.ep } }; },
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
    const look = String(body.look || ''); if (!CHANNEL_PROFILES[look] && !AI_STYLES[look] && !isRefLook(look)) throw new HttpError(400, '모르는 편집 룩이에요: ' + look);
    const was = AI_STYLES[E.s.look] || isRefLook(E.s.look) ? E.s.look : lookKeyOf(E);
    E.s.look = look;
    if (look !== was) for (const id of ['clip', 'plan', 'rough', 'subs', 'fx', 'mix', 'upload', 'aistyle', 'aisubs', 'aibrand']) { const st = E.s.steps[id]; if (st.status !== 'todo') { st.status = 'todo'; delete st.error; } }
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
  // ⑤ 자막 넣기: 지금 구간·자막·원본 영어 자막 읽기 / 고친 것 저장 / 고칠 점 글 → (AI 키가 있으면 바로 반영, 없으면 Claude 채팅용 요청문)
  'GET /draft': ({ q }) => { const E = getEp(q.get('ep')); return { json: { ranges: (E.s.sources[0]?.ranges || []).join(', '), text: draftText(E), hasScript: hasScript(E), ai: !!process.env.ANTHROPIC_API_KEY, feedback: E.s.feedback || '', transcript: draftTranscript(E) } }; },
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
    if (typeof body.vtype === 'string' && /^[a-z0-9]{1,20}$/.test(body.vtype)) E.s.vtype = body.vtype;   // AI 편집: 영상 종류
    if (ids.includes('aisubs') && body.subs && typeof body.subs === 'object') {   // AI 자막: 원문(en)·번역(ko)·해설/후크(ai) 켜고 끄기 + 내 자막
      let mine; try { mine = parseMine(body.subs.mine); } catch (e) { throw new HttpError(400, e.message); }
      const b = body.subs, L = x => ['ko', 'en', 'both'].includes(x) ? x : null;
      // 새 방식: tech(기술 설명 자막) + techLang, speech(영상 음성 자막) + speechLang (ko|en|both)
      if ('tech' in b || 'speech' in b) E.s.subsOpt = { ai: !!b.tech, aiLang: L(b.techLang) || 'ko', en: !!b.speech && (L(b.speechLang) || 'both') !== 'ko', ko: !!b.speech && (L(b.speechLang) || 'both') !== 'en', tech: !!b.tech, speech: !!b.speech, techLang: L(b.techLang) || 'ko', speechLang: L(b.speechLang) || 'both', mine, mineText: String(b.mine || '').slice(0, 4000),
        capStyle: String(b.capStyle || 'mat').replace(/[^\w-]/g, '').slice(0, 20), top1: String(b.top1 || '').trim().slice(0, 30), top2: String(b.top2 || '').trim().slice(0, 30), srcLang: WH_LANGS.includes(b.srcLang) ? b.srcLang : '' };
      else E.s.subsOpt = { en: b.en !== false, ko: b.ko !== false, ai: b.ai !== false, mine, mineText: String(b.mine || '').slice(0, 4000) };
      if (Array.isArray(body.subs.edit)) {   // 자막 편집기: [{s, e, kind: sp|ai|my, ko, en}]
        if (body.subs.edit.length > 400) throw new HttpError(400, '자막이 너무 많아요 (400줄까지).');
        E.s.subsOpt.edit = body.subs.edit.map(r => ({ s: Math.max(0, Math.round(+r.s * 10) / 10 || 0), e: Math.round(+r.e * 10) / 10 || 0, kind: ['sp', 'ai', 'my'].includes(r.kind) ? r.kind : 'ai', ko: String(r.ko || '').slice(0, 120), en: String(r.en || '').slice(0, 200) }));
      }
    }
    if (ids.includes('aithumb')) {   // 썸네일: 내가 적은 상단·하단 카피 (비우면 Claude 가 써요)
      const t = body.thumb || {}; E.s.thumbText = { top: String(t.top || '').trim().slice(0, 30), bot: String(t.bot || '').trim().slice(0, 40) };
    }
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
  'POST /episode/delete': async ({ body }) => {
    const E = getEp(body.ep);
    const root = path.resolve(DATA), dir = path.resolve(E.dir);
    if (path.dirname(dir) !== root || dir === root || E.s.ep !== path.basename(dir)) throw new HttpError(400, '이 폴더는 지울 수 없어요.');
    if (E.running) {   // 돌고 있으면 먼저 멈추고 쉬는 상태가 될 때까지 잠깐 기다려요
      E.ctrl.aborted = true;
      try { E.ctrl.child?.kill('SIGTERM'); setTimeout(() => { try { E.ctrl.child?.kill('SIGKILL'); } catch {} }, 3000); } catch {}
      for (let i = 0; i < 50 && E.running; i++) await new Promise(r => setTimeout(r, 100));
      if (E.running) throw new HttpError(409, '아직 멈추는 중이에요. 잠시 뒤에 다시 눌러 주세요.');
    }
    const dest = exists(dir) ? moveToTrash(dir, trashRoot(), `${path.basename(dir)} ${tsNow()}`) : null;   // 폴더가 이미 없으면(파인더에서 지움 등) 목록에서만 빼요
    episodes.delete(E.s.ep);
    try { HL.dropEpisodeRef(E.s.ep); } catch {}
    return { json: { ok: true, trashed: dest } };
  },
  // 유튜브 초기화: 에피소드·하이라이트 작업을 전부 휴지통 '유투브 초기화 <시각>' 한 폴더로. 소리 폴더·스타일·키는 그대로. 뭐가 돌고 있으면 409
  'POST /reset': async ({ body }) => {
    if (!body || body.scope !== 'youtube') throw new HttpError(400, '지울 범위(scope)가 이상해요.');
    const busy = [...episodes.values()].find(E => E.running);
    if (busy) throw new HttpError(409, `영상 단계가 돌고 있어요(${busy.s.title || busy.s.ep}). 끝나거나 멈춘 뒤에 눌러 주세요.`);
    if (pvJob) throw new HttpError(409, '결과물 미리보기(견본)를 만드는 중이에요. 끝난 뒤에 눌러 주세요.');
    if (HL.anyRunning()) throw new HttpError(409, '하이라이트 찾기가 돌고 있어요. 끝나거나 멈춘 뒤에 눌러 주세요.');
    const dest = path.join(trashRoot(), `유투브 초기화 ${tsNow()}`);
    let epN = 0, hlN = 0;
    for (const [name, E] of [...episodes]) {
      const dir = path.resolve(E.dir);
      if (path.dirname(dir) !== path.resolve(DATA) || E.s.ep !== path.basename(dir)) continue;
      moveToTrash(dir, path.join(dest, '에피소드'), name); episodes.delete(name); epN++;
    }
    try { hlN = HL.resetAll((dir, name) => moveToTrash(dir, path.join(dest, '하이라이트'), name)); }
    catch (e) { if (e instanceof StepError) throw new HttpError(409, e.message); throw e; }
    return { json: { ok: true, trashed: exists(dest) ? dest : '', episodes: epN, highlights: hlN } };
  },
  // 견본: 고른 룩·이펙트 팩이 이 에피소드의 진짜 영상에서 어떻게 보이는지 4초짜리(540x960)로. 에피소드 단계·상태는 건드리지 않아요. 한 번에 하나만, 새 요청이 오면 옛 요청은 멈춰요.
  'POST /preview': async ({ body }) => {
    const E = getEp(body.ep);
    return { json: await previewRun(E, { look: body.look || lookKeyOf(E), pack: body.pack || '', times: body.times, labels: body.labels }) };
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
    if (key === 'POST /upload') {   // 내 영상 파일 올리기: ~/Desktop/유투브/업로드/ 에 저장하고 그 경로를 소스로 써요
      const name = sanitize(path.basename(String(url.searchParams.get('name') || '')).replace(/\.[^.]+$/, ''), 60) || 'video', ext = (path.extname(String(url.searchParams.get('name') || '')).toLowerCase() || '.mp4');
      if (!/^\.(mp4|mov|m4v|mkv|webm|avi)$/.test(ext)) throw new HttpError(400, '영상 파일(mp4, mov, m4v, mkv, webm, avi)만 올릴 수 있어요.');
      const dir = path.join(HOME_ROOT, '업로드'); fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, ''), dest = path.join(dir, `${stamp}_${name}${ext}`), part = dest + '.part';
      let n = 0; const out = fs.createWriteStream(part);
      try { for await (const c of req) { n += c.length; if (n > 8e9) throw new HttpError(413, '파일이 너무 커요 (8GB 까지).'); if (!out.write(c)) await new Promise(r => out.once('drain', r)); } await new Promise((r, j) => out.end(e => e ? j(e) : r())); }
      catch (e) { out.destroy(); fs.rmSync(part, { force: true }); throw e; }
      fs.renameSync(part, dest);
      const pr = await probe(dest).catch(() => ({}));
      if (!pr.hasVideo) { fs.rmSync(dest, { force: true }); throw new HttpError(422, '영상 파일을 읽지 못했어요.'); }
      return send(200, JSON.stringify({ ok: true, path: dest, name: path.basename(dest), duration: pr.duration || null, bytes: n }));
    }
    if (key === 'POST /voice') { const r = await saveVoice(getEp(url.searchParams.get('ep')), url.searchParams, req); return send(200, JSON.stringify(r.json)); }
    const rm = /^\/ref\/([\w-]{11})(\/file)?$/.exec(url.pathname);
    if (rm && req.method !== 'POST') {
      if (rm[2]) return serveFile(req, res, { dir: refDir(rm[1]) }, url.searchParams.get('path'));
      const a = readRefAnalysis(rm[1], refKind(String(url.searchParams.get('channel') || 'yt-wrestling')));
      if (!a) throw new HttpError(404, '아직 분석하지 않았어요.');
      return send(200, JSON.stringify({ ok: true, analysis: a }));
    }
    const hm = /^\/hl\/([^/]+)\/file$/.exec(url.pathname);
    if (hm && key === 'GET /hl/' + hm[1] + '/file') { let id; try { id = decodeURIComponent(hm[1]); } catch { throw new HttpError(400, '주소가 이상해요.'); } return serveFile(req, res, { dir: getHL(id).dir }, url.searchParams.get('path')); }
    let fn = routes[key];
    if (!fn && url.pathname.startsWith('/hl/')) fn = async ({ body }) => { const r = await hlDynamic(req.method === 'HEAD' ? 'GET' : req.method, url, body); if (!r) throw new HttpError(404, '없는 주소예요: ' + url.pathname); return r; };
    if (!fn) throw new HttpError(404, '없는 주소예요: ' + url.pathname);
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
// 알아서 업데이트: 자동실행(launchd)으로 켜져 있으면 1분 뒤, 그다음 10분마다 GitHub 최신 실행기를 확인해서 일이 없을 때 바꾸고 다시 켜요
if (process.env.XPC_SERVICE_NAME && process.env.XPC_SERVICE_NAME.includes('digitalstudio')) {
  const autoUpdate = async () => { try { const r = await routes['POST /update']({ body: {}, q: new URLSearchParams() }); if (r && r.json && r.json.to) console.log(`자동 업데이트: ${r.json.from} -> ${r.json.to}`); } catch (e) { if (e.status !== 409) console.log('자동 업데이트 못 함: ' + e.message); } };
  setTimeout(autoUpdate, 60e3); setInterval(autoUpdate, 10 * 60e3);
}
// 실행기가 켜져 있는 동안 맥이 스스로 잠들지 않게 (화면은 꺼져도 돼요). 실행기를 끄면 같이 풀려요.
if (process.platform === 'darwin') { try { spawn('/usr/bin/caffeinate', ['-i', '-s', '-w', String(process.pid)], { stdio: 'ignore', detached: true }).unref(); } catch {} }
server.listen(PORT, '127.0.0.1', () => console.log(`실행기 주소 http://127.0.0.1:${PORT} · 에피소드 폴더 ${DATA}${process.env.ANTHROPIC_API_KEY ? ' · 대본 AI 켜짐' : ''}`));
const bye = () => { shutdownImages(); try { if (pvJob) { pvJob.ctrl.aborted = true; pvJob.ctrl.child?.kill('SIGTERM'); } } catch {} HL.shutdown(); for (const E of episodes.values()) { E.ctrl.aborted = true; try { E.ctrl.child?.kill('SIGTERM'); } catch {} } setTimeout(() => process.exit(0), 300); };
process.on('SIGINT', bye); process.on('SIGTERM', bye);
