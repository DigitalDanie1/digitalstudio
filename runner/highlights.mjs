// 하이라이트 찾기: 긴 영상 하나를 통째로 받아서, 움직임·소리 신호만으로 볼 만한 장면 후보를 골라 줘요 (AI 키 필요 없음).
//  신호 뽑기(ffmpeg 한 번) → 점수 계산 → 봉우리 고르기 → 후보마다 썸네일 3장 + 미리보기 영상.
//  순수 계산(scoreSeries, pickHighlights)은 따로 빼 둬서 ffmpeg 없이도 검사할 수 있어요.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { FFMPEG, YTDLP, HOME, StepError, StopError, run, ff, probe, lastLines, exists, fmtTime, sanitize, MAX_RANGE } from './util.mjs';
import { SRC_FORMAT, fetchSubs } from './steps.mjs';

export const HL_VERSION = 3;          // 분석 파일 형식. 올리면 예전 분석은 다시 해요
export const DT = 0.25;               // 신호 간격 (초): 영상은 초당 4장, 소리도 0.25초씩 묶어요
export const GAP = 20;                // 후보끼리 최소 간격 (초)
export const PAYOFF = 0.7;            // 구간의 70% 지점에 하이라이트 정점이 오게 → 결정 장면은 맨 끝 쪽
export const LEN_MIN = 5, LEN_MAX = MAX_RANGE, LEN_DEFAULT = 10, COUNT_DEFAULT = 8, COUNT_MAX = 30;
// H.264(avc1)를 먼저 받아요: AV1 은 읽는 데 3~5배 오래 걸려요. 없으면 평소 형식
const HL_FORMAT = 'bv*[height<=1080][vcodec^=avc1][ext=mp4]+ba[ext=m4a]/' + SRC_FORMAT;
const W_MOTION = 0.6, W_AUDIO = 0.4, SCENE_CUT = 0.4;

// ---------- 순수 계산 ----------
const median = a => { const b = a.filter(Number.isFinite).sort((x, y) => x - y); if (!b.length) return 0; const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
export function robustZ(a) {
  const med = median(a), mad = median(a.map(x => Math.abs(x - med))) * 1.4826;
  let sc = mad;
  if (!(sc > 1e-9)) { const f = a.filter(Number.isFinite), mean = f.reduce((s, x) => s + x, 0) / (f.length || 1); sc = Math.sqrt(f.reduce((s, x) => s + (x - mean) ** 2, 0) / (f.length || 1)); }
  if (!(sc > 1e-9)) return a.map(() => 0);
  return a.map(x => (x - med) / sc);
}
// 가운데 기준 이동 평균 (w 칸)
export function smooth(a, w) {
  const n = a.length, out = new Array(n), lo = Math.floor((w - 1) / 2), hi = w - 1 - lo, ps = [0];
  for (const x of a) ps.push(ps[ps.length - 1] + x);
  for (let i = 0; i < n; i++) { const s = Math.max(0, i - lo), e = Math.min(n - 1, i + hi); out[i] = (ps[e + 1] - ps[s]) / (e - s + 1); }
  return out;
}
const fillGaps = a => {   // NaN 칸을 양옆 값으로 이어 채워요
  const out = a.slice(); let i = 0;
  while (i < out.length) {
    if (!Number.isNaN(out[i])) { i++; continue; }
    let j = i; while (j < out.length && Number.isNaN(out[j])) j++;
    const l = i > 0 ? out[i - 1] : (j < out.length ? out[j] : 0), r = j < out.length ? out[j] : l;
    for (let k = i; k < j; k++) out[k] = l + (r - l) * (k - i + 1) / (j - i + 1);
    i = j;
  }
  return out;
};
// an = { dt, motion[], loud[]|null, cuts[](초) } → { score[], zm[], za[] }
export function scoreSeries(an) {
  const dt = an.dt || DT, n = an.motion.length, perSec = Math.round(1 / dt);
  const m = an.motion.map(x => (Number.isFinite(x) ? Math.sqrt(Math.max(0, x)) : NaN));
  for (const t of an.cuts || []) for (let k = -1; k <= 1; k++) { const i = Math.round(t / dt) + k; if (i >= 0 && i < n) m[i] = NaN; }   // 장면이 바뀌는 순간은 움직임이 아니에요
  const zm = smooth(robustZ(fillGaps(m)), perSec);
  let za = new Array(n).fill(0);
  if (an.loud && an.loud.length) {
    const L = fillGaps(an.loud.map(x => (Number.isFinite(x) ? Math.max(-70, x) : NaN))), tail = Math.round(3 / dt), rise = new Array(n);
    let sum = 0;
    for (let i = 0; i < n; i++) {   // 소리 = 바로 앞 3초 평균보다 얼마나 커졌나 (관중 함성)
      const cnt = Math.min(i, tail);
      rise[i] = i === 0 ? 0 : L[i] - sum / cnt;
      sum += L[i]; if (i >= tail) sum -= L[i - tail];
    }
    za = smooth(robustZ(rise), perSec);
  }
  const score = zm.map((x, i) => W_MOTION * x + W_AUDIO * za[i]);
  return { score, zm, za };
}
// 화면 모양(지문)으로 본 "경기가 아닌 장면" 정도: 화면 전체가 확 바뀌거나(카메라 휙 돌기·중계 그래픽) 밝기가 크게 출렁이면 깎아요. 1 = 그대로, 0.3 = 많이 깎임
export function graphicFactor(sig, n, i0, i1) {
  if (!sig || sig.length < n * SIG_N) return { f: 1, spread: 0, lum: 0 };
  i0 = Math.max(1, i0); i1 = Math.min(n, i1);
  let sp = 0, cnt = 0, lmin = 255, lmax = 0;
  for (let i = i0; i < i1; i++) {
    let c = 0, l = 0;
    for (let k = 0; k < SIG_N; k++) { const v = sig[i * SIG_N + k]; l += v; if (Math.abs(v - sig[(i - 1) * SIG_N + k]) > 12) c++; }
    sp += c / SIG_N; cnt++; l /= SIG_N; if (l < lmin) lmin = l; if (l > lmax) lmax = l;
  }
  if (!cnt) return { f: 1, spread: 0, lum: 0 };
  const spread = sp / cnt, lum = lmax - lmin;
  const fs_ = spread <= 0.3 ? 1 : Math.max(0.4, 1 - (spread - 0.3) / 0.4), fl = lum <= 30 ? 1 : Math.max(0.3, 1 - (lum - 30) / 50);
  return { f: fs_ * fl, spread: +spread.toFixed(2), lum: Math.round(lum) };
}
const pct = (arr, v) => { let c = 0; for (const x of arr) if (x <= v) c++; return arr.length ? Math.round(100 * c / arr.length) : 0; };
// 가장 높은 봉우리부터 하나씩 고르고, 그 양옆 GAP 초는 지워요 (non-max suppression)
export function pickHighlights(an, { count = COUNT_DEFAULT, len = LEN_DEFAULT, gap = GAP, duration } = {}) {
  const dt = an.dt || DT, dur = duration || an.duration || an.motion.length * dt;
  count = Math.max(1, Math.min(COUNT_MAX, Math.round(count))); len = Math.max(LEN_MIN, Math.min(LEN_MAX, Math.round(len)));
  const { score, zm, za } = scoreSeries(an), work = score.slice(), gs = Math.round(gap / dt);
  const cuts = an.cuts || [], peaks = [];
  for (let k = 0; k < count * 2; k++) {   // 컷이 많은 구간은 점수를 깎아서 순서가 바뀔 수 있어서, 넉넉히 뽑은 뒤 추려요
    let p = -1, best = 0.3;   // 이보다 낮은 건 그냥 평범한 장면
    for (let i = Math.ceil(2 / dt); i < work.length; i++) if (work[i] > best) { best = work[i]; p = i; }   // 영상 맨 앞 2초는 건너뛰어요
    if (p < 0) break;
    peaks.push({ p, v: score[p] });
    for (let i = Math.max(0, p - gs + 1); i <= Math.min(work.length - 1, p + gs - 1); i++) work[i] = -Infinity;
  }
  const out = peaks.map(({ p, v }) => {
    const t = p * dt;
    let a = Math.round(t - PAYOFF * len), b;
    a = Math.max(0, Math.min(a, Math.floor(dur) - len)); if (a < 0) a = 0;
    b = Math.min(a + len, Math.floor(dur)); if (b - a < 1) return null;
    const nc = cuts.filter(c => c >= a && c < b).length, factor = nc <= 1 ? 1 : Math.max(0.3, 1 - 0.25 * (nc - 1));   // 방송 재생 화면·그래픽 전환 같은 컷 덩어리는 깎아요
    const i0 = Math.round(a / dt), i1 = Math.min(work.length, Math.round(b / dt));
    const zmMax = Math.max(...zm.slice(i0, i1)), zaMax = Math.max(...za.slice(i0, i1));
    const gf = graphicFactor(an.sig, work.length, Math.round(a / dt), Math.round(b / dt));
    return { a, b, peak: +t.toFixed(2), score: +(v * factor * gf.f).toFixed(3), shape: { spread: gf.spread, lum: gf.lum }, motion: pct(zm, zmMax), audio: pct(za, zaMax), cuts: nc };
  }).filter(c => c && c.score >= 0.5).sort((x, y) => y.score - x.score).slice(0, count);   // 0.5 보다 낮으면 그냥 평범하거나 중계 화면이에요
  out.forEach((c, i) => { c.rank = i + 1; });
  return out;
}

// ---------- 신호 뽑기 (ffmpeg 한 번) ----------
function parseMeta(text, key) {   // metadata=print 결과 → [{t, v}]
  const out = []; let t = null;
  for (const l of String(text).split(/\r?\n/)) {
    const m = /pts_time:([\d.]+)/.exec(l);
    if (m) { t = +m[1]; if (!key) out.push({ t, v: 1 }); continue; }
    if (key && t != null && l.startsWith(key + '=')) { const v = parseFloat(l.slice(key.length + 1)); out.push({ t, v: Number.isFinite(v) ? v : NaN }); t = null; }
  }
  return out;
}
export function runProgress(cmd, args, ctx, onSecs) {
  return new Promise((resolve, reject) => {
    if (ctx.aborted?.()) return reject(new StopError('멈췄어요'));
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, PATH: `${path.join(HOME, '.local/bin')}:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ''}` } });
    ctx.setChild?.(child);
    let err = '';
    child.stdout.on('data', d => { for (const l of String(d).split(/\r?\n/)) { const m = /^out_time_(?:us|ms)=(\d+)/.exec(l); if (m) onSecs?.(+m[1] / 1e6); } });
    child.stderr.on('data', d => { err += d; if (err.length > 2e6) err = err.slice(-1e6); });
    child.on('error', e => reject(new StepError(`프로그램을 못 켰어요(${path.basename(cmd)}): ${e.message}`)));
    child.on('close', (code, sig) => {
      ctx.setChild?.(null);
      if (ctx.aborted?.()) return reject(new StopError('멈췄어요'));
      if (code === 0) return resolve({ err });
      const e = new Error(`${path.basename(cmd)} 종료 코드 ${code ?? sig}`); e.err = err; reject(e);
    });
  });
}
const SIG_W = 16, SIG_H = 9, SIG_N = SIG_W * SIG_H;
const CHUNK_SECS = 150, PARALLEL = 3;   // 영상 읽기가 제일 느려서, 긴 영상은 토막을 내서 동시에 읽어요
export async function extractSignals(file, duration, ctx, onFrac) {
  const pr = await probe(file, ctx);
  if (!pr.hasVideo) throw new StepError('영상 파일이 아니에요.');
  const dur = duration || pr.duration || 0;
  if (!(dur > 0)) throw new StepError('영상 길이를 알 수 없어요.');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hl-sig-'));
  const rd = f => { try { return fs.readFileSync(f, 'utf8'); } catch { return ''; } };
  try {
    // 소리: 아주 빨라요 (영상 읽기 없이)
    let loudP = [];
    if (pr.hasAudio) {
      const fA = path.join(tmp, 'a.txt');
      try { await runProgress(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-nostats', '-i', file, '-vn', '-af', `aresample=16000,ebur128=metadata=1:peak=none:framelog=quiet,ametadata=print:key=lavfi.r128.M:file=${fA}`, '-f', 'null', '-'], ctx); loudP = parseMeta(rd(fA), 'lavfi.r128.M'); }
      catch (e) { if (e instanceof StopError) throw e; ctx.log?.('소리는 못 읽었어요. 움직임만으로 골라요.'); }
    }
    // 영상: 낮은 해상도 흑백 4장/초 → 앞뒤 장면 차이(움직임)와 장면 전환 점수
    const nChunks = Math.max(1, Math.min(Math.ceil(dur / CHUNK_SECS), 24)), per = Math.ceil(dur / nChunks / DT) * DT, chunks = Array.from({ length: nChunks }, (_, i) => ({ i, start: i * per, len: Math.min(per, dur - i * per), frac: 0 })).filter(c => c.len > 0.5);
    const report = () => onFrac?.(Math.min(1, chunks.reduce((t, c) => t + c.frac * c.len, 0) / dur));
    const doChunk = async c => {
      const fM = path.join(tmp, `m${c.i}.txt`), fS = path.join(tmp, `s${c.i}.txt`), fG = path.join(tmp, `g${c.i}.raw`);
      const fc = `[0:v]fps=${Math.round(1 / DT)},scale=160:-2,format=gray,split=3[v1][v2][v3];[v1]tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=${fM}[m];[v2]select='gte(scene\\,0)',metadata=print:key=lavfi.scene_score:file=${fS}[s];[v3]scale=${SIG_W}:${SIG_H}:flags=area,format=gray[g]`;
      const go = hw => runProgress(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', ...(hw ? ['-hwaccel', 'videotoolbox'] : []), '-ss', String(c.start), '-t', String(c.len), '-i', file, '-an',
        '-filter_complex', fc, '-map', '[m]', '-f', 'null', '-', '-map', '[s]', '-f', 'null', '-', '-map', '[g]', '-f', 'rawvideo', fG], ctx, secs => { c.frac = Math.min(1, secs / c.len); report(); });
      try { await go(true); }   // 맥의 영상 칩(videotoolbox)이 되면 훨씬 빨라요. 안 되면 CPU 로
      catch (e) { if (e instanceof StopError) throw e; c.frac = 0; try { await go(false); } catch (e2) { if (e2 instanceof StopError) throw e2; throw new StepError('영상을 분석하지 못했어요: ' + lastLines(e2.err || e2.message)); } }
      c.frac = 1; report();
      let g = Buffer.alloc(0); try { g = fs.readFileSync(fG); } catch {}
      return { start: c.start, m: parseMeta(rd(fM), 'lavfi.signalstats.YAVG'), s: parseMeta(rd(fS), 'lavfi.scene_score'), g };
    };
    const results = new Array(chunks.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(PARALLEL, chunks.length) }, async () => { while (next < chunks.length) { const k = next++; results[k] = await doChunk(chunks[k]); } }));
    const n = Math.max(1, Math.ceil(dur / DT)), motion = new Array(n).fill(NaN), loudSum = new Array(n).fill(0), loudCnt = new Array(n).fill(0), cuts = []; let got = 0;
    for (const r of results) {
      for (const { t, v } of r.m) { const i = Math.round((t + r.start) / DT); if (i >= 0 && i < n && Number.isFinite(v)) { motion[i] = v; got++; } }
      for (const { t, v } of r.s) if (v > SCENE_CUT) cuts.push(+(t + r.start).toFixed(2));
    }
    const sig = Buffer.alloc(n * SIG_N);   // 프레임마다 작은 흑백 지문 (같은 그래픽이 되풀이되는지 보려고)
    for (const r of results) { const k0 = Math.round(r.start / DT), cnt = Math.floor(r.g.length / SIG_N); for (let k = 0; k < cnt; k++) { const i = k0 + k; if (i >= 0 && i < n) r.g.copy(sig, i * SIG_N, k * SIG_N, (k + 1) * SIG_N); } }
    for (const { t, v } of loudP) { if (!Number.isFinite(v)) continue; const i = Math.min(n - 1, Math.floor(t / DT)); loudSum[i] += v; loudCnt[i]++; }
    if (got < 4) throw new StepError('영상에서 움직임을 읽지 못했어요.');
    const loud = loudP.length ? loudSum.map((s2, i) => (loudCnt[i] ? s2 / loudCnt[i] : NaN)) : null;
    return { version: HL_VERSION, dt: DT, duration: dur, hasAudio: !!loud, motion: motion.map(x => (Number.isFinite(x) ? +x.toFixed(3) : null)), loud: loud && loud.map(x => (Number.isFinite(x) ? +x.toFixed(2) : null)), cuts: cuts.sort((x, y) => x - y), sig };
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const nanify = a => a && a.map(x => (x == null ? NaN : x));
export const saveAnalysis = (f, an) => { const { sig, ...rest } = an; fs.writeFileSync(f.replace(/\.json$/, '.sig'), sig || Buffer.alloc(0)); fs.writeFileSync(f, JSON.stringify(rest)); };
export const loadAnalysis = f => { try { const a = JSON.parse(fs.readFileSync(f, 'utf8')); let sig = null; try { sig = fs.readFileSync(f.replace(/\.json$/, '.sig')); } catch {} return a.version === HL_VERSION ? { ...a, motion: nanify(a.motion), loud: nanify(a.loud), sig } : null; } catch { return null; } };

// ---------- 후보 미리보기 (썸네일 3장 + 작은 영상) ----------
// 맥 영상 칩(videotoolbox)으로 읽어 보고, 안 되면 CPU 로 (AV1 은 CPU 로 읽으면 한 장면 자르는 데도 몇 초씩 걸려요)
async function ffHw(args, ctx) {
  const i = args.indexOf('-i'), withHw = [...args.slice(0, i), '-hwaccel', 'videotoolbox', ...args.slice(i)];
  try { return await ff(withHw, ctx); } catch (e) { if (e instanceof StopError) throw e; return ff(args, ctx); }
}
export const PREVIEW_PAD = 2;   // 미리보기 영상은 앞뒤 2초씩 더 들어 있어서, 시작·끝을 ±1초 옮겨 가며 볼 수 있어요
export async function renderCandidate(src, dir, c, duration, ctx) {
  fs.mkdirSync(dir, { recursive: true });
  const id = `${c.a}_${c.b}`, rel = f => `후보/${f}`, times = [c.a + 0.3, Math.min(Math.max(c.peak, c.a), c.b - 0.3), Math.max(c.a, c.b - 0.4)];
  const thumbs = [];
  for (const [i, t] of times.entries()) {
    const f = path.join(dir, `t_${id}_${i}.jpg`);
    if (!exists(f)) try { await ffHw(['-ss', t.toFixed(2), '-i', src, '-frames:v', '1', '-vf', 'scale=320:-2', '-q:v', '4', f], ctx); } catch (e) { if (e instanceof StopError) throw e; }
    if (exists(f)) thumbs.push(rel(path.basename(f)));
  }
  const pa = Math.max(0, c.a - PREVIEW_PAD), pb = Math.min(duration || c.b + PREVIEW_PAD, c.b + PREVIEW_PAD), pf = path.join(dir, `p_${pa}_${pb}.mp4`);
  if (!exists(pf)) {
    const args = ['-ss', String(pa), '-t', String(pb - pa), '-i', src, '-vf', 'scale=480:-2,fps=24', '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '28', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', pf];
    try { await ffHw(args, ctx); }
    catch (e) { if (e instanceof StopError) throw e; try { await ffHw(args.filter((x, i, a) => !(x === '-c:a' || a[i - 1] === '-c:a' || x === '-b:a' || a[i - 1] === '-b:a' || x === '-ac' || a[i - 1] === '-ac')), ctx); } catch (e2) { if (e2 instanceof StopError) throw e2; } }
  }
  return { ...c, thumbs, preview: exists(pf) ? rel(path.basename(pf)) : '', pv: { a: pa, b: pb } };
}

// ---------- 일감 (영상 받기 → 분석 → 후보 만들기) ----------
export function createHighlights({ dataDir, log: logErr = console.error }) {
  fs.mkdirSync(dataDir, { recursive: true });
  const jobs = new Map(), stamp = () => new Date().toTimeString().slice(0, 8);
  const jf = J => path.join(J.dir, 'job.json'), logf = J => path.join(J.dir, '로그.log');
  const save = J => { const o = { ...J.s }; fs.mkdirSync(J.dir, { recursive: true }); fs.writeFileSync(jf(J) + '.tmp', JSON.stringify(o, null, 2)); fs.renameSync(jf(J) + '.tmp', jf(J)); };
  const videoOf = J => path.join(J.dir, '원본.mp4');

  for (const name of fs.readdirSync(dataDir)) {
    const dir = path.join(dataDir, name), f = path.join(dir, 'job.json');
    try {
      const s = JSON.parse(fs.readFileSync(f, 'utf8')), J = { id: name, dir, s, ctrl: { aborted: false, child: null }, running: false };
      if (['queued', 'downloading', 'analyzing', 'rendering'].includes(s.status)) { s.status = 'failed'; s.error = '실행기가 꺼지면서 중간에 멈췄어요. 다시 눌러 주세요.'; save(J); }
      jobs.set(name, J);
    } catch {}
  }

  const summary = J => ({ id: J.id, title: J.s.title, url: J.s.url, status: J.s.status, stage: J.s.stage || '', progress: J.s.progress || 0, error: J.s.error || '', count: J.s.count, len: J.s.len,
    duration: J.s.duration || 0, created: J.s.created, found: (J.s.candidates || []).length, running: J.running });
  const detail = J => { let tail = ''; try { tail = fs.readFileSync(logf(J), 'utf8').slice(-4000); } catch {} return { ...summary(J), videoId: J.s.videoId || '', channel: J.s.channel || '', fromEpisode: J.s.fromEpisode || '', candidates: J.s.candidates || [], log: tail }; };
  const mkCtx = J => ({ log: l => { if (l == null || l === '') return; try { fs.appendFileSync(logf(J), `[${stamp()}] ${l}\n`); } catch {} }, aborted: () => J.ctrl.aborted, setChild: c => { J.ctrl.child = c; } });
  const setStage = (J, status, stage, progress) => { J.s.status = status; J.s.stage = stage; if (progress != null) J.s.progress = +progress.toFixed(3); };

  async function ytInfo(url, ctx) {
    let r;
    try { r = await run(YTDLP, ['-O', '%(.{id,title,channel,uploader,duration,webpage_url,license})j', '--no-playlist', '--no-warnings', url], ctx); }
    catch (e) { if (e instanceof StopError) throw e; throw new StepError(`yt-dlp가 이 영상을 받지 못했어요: ${lastLines(e.err) || e.message}`); }
    let j; try { j = JSON.parse(r.out.split('\n').filter(Boolean)[0]); } catch { throw new StepError('yt-dlp 응답을 읽지 못했어요.'); }
    return { id: j.id, title: j.title, channel: j.channel || j.uploader || '', duration: j.duration ?? null, url: j.webpage_url || url, license: j.license || null };
  }
  const linkOrCopy = (from, to) => { fs.rmSync(to, { force: true }); try { fs.linkSync(from, to); } catch { fs.copyFileSync(from, to); } };

  // 새 일감 만들기 (이미 같은 영상이 있으면 그걸 다시 열어요: 분석은 캐시)
  function open({ url, title, videoId, duration, channel, license, fromEpisode, local }) {
    for (const J of jobs.values()) if ((videoId && J.s.videoId === videoId) || (!videoId && J.s.url === url)) return J;
    let id = sanitize(title, 60) || sanitize(videoId, 40) || '하이라이트', n = 1; const base = id;
    while (exists(path.join(dataDir, id))) id = `${base}-${++n}`;
    const s = { id, title: title || id, url, videoId: videoId || '', duration: duration || 0, channel: channel || '', license: license || null, fromEpisode: fromEpisode || '', local: local || '', created: Date.now(), status: 'queued', stage: '', progress: 0, count: COUNT_DEFAULT, len: LEN_DEFAULT, candidates: [] };
    const J = { id, dir: path.join(dataDir, id), s, ctrl: { aborted: false, child: null }, running: false };
    fs.mkdirSync(path.join(J.dir, '후보'), { recursive: true }); save(J); jobs.set(id, J);
    return J;
  }

  async function pipeline(J, ctx) {
    const s = J.s, v = videoOf(J);
    // 1) 영상
    if (!exists(v) || !fs.statSync(v).size) {
      setStage(J, 'downloading', '영상 받는 중', 0); save(J);
      if (s.local) { ctx.log(`내 컴퓨터의 영상을 가져와요: ${path.basename(s.local)}`); linkOrCopy(s.local, v); }
      else {
        ctx.log(`영상을 통째로 받아요: ${s.title}${s.duration ? ` (${fmtTime(s.duration)})` : ''}`);
        for (const f of fs.readdirSync(J.dir)) if (/^원본\.(?!mp4$)/.test(f) || /^원본\..*\.(part|ytdl)$/.test(f)) fs.rmSync(path.join(J.dir, f), { force: true });
        try {
          await run(YTDLP, ['--no-playlist', '--no-warnings', '--newline', '-f', HL_FORMAT, '--merge-output-format', 'mp4', '--ffmpeg-location', path.dirname(FFMPEG), '-o', path.join(J.dir, '원본.%(ext)s'), s.url],
            { ...ctx, log: l => { const m = /\[download\]\s+([\d.]+)%/.exec(l || ''); if (m) { J.s.progress = +(+m[1] / 100 * 0.5).toFixed(3); } if (l && /download|Merg|ERROR/i.test(l)) ctx.log('  ' + l); } }, { tee: true });
        } catch (e) { if (e instanceof StopError) throw e; throw new StepError(`yt-dlp가 이 영상을 받지 못했어요: ${lastLines(e.err) || e.message}`); }
        if (!exists(v)) { const got = fs.readdirSync(J.dir).find(f => f.startsWith('원본.') && !/\.(part|ytdl)$/.test(f)); if (!got) throw new StepError('받은 파일을 찾지 못했어요.'); if (got !== '원본.mp4') fs.renameSync(path.join(J.dir, got), v); }
        s.subFile = await fetchSubs({ p: (...a) => path.join(J.dir, ...a) }, s.url, s.videoId, ctx);   // 에피소드로 만들 때 자막도 같이 가져가요
      }
      if (!s.duration) s.duration = (await probe(v, ctx)).duration || 0;
    }
    if (!s.duration) s.duration = (await probe(v, ctx)).duration || 0;
    // 2) 분석 (캐시)
    let an = loadAnalysis(path.join(J.dir, '분석.json'));
    if (an) ctx.log('이미 분석한 영상이에요. 분석은 건너뛰고 후보만 다시 골라요.');
    else {
      setStage(J, 'analyzing', '움직임·소리 분석 중', 0.5); save(J);
      const t0 = Date.now(); ctx.log('움직임과 소리를 읽어요…');
      an = await extractSignals(v, s.duration, ctx, f => { J.s.progress = +(0.5 + 0.4 * f).toFixed(3); });
      saveAnalysis(path.join(J.dir, '분석.json'), an);
      ctx.log(`분석 끝 (${((Date.now() - t0) / 1000).toFixed(1)}초) · 컷 ${an.cuts.length}번 · 소리 ${an.hasAudio ? '있음' : '없음'}`);
    }
    await pickAndRender(J, an, ctx);
  }
  async function pickAndRender(J, an, ctx) {
    const s = J.s;
    setStage(J, 'rendering', '후보 만드는 중', 0.9); save(J);
    const picks = pickHighlights(an, { count: s.count, len: s.len, duration: s.duration });
    ctx.log(`후보 ${picks.length}개를 골랐어요. 미리보기를 만들어요…`);
    const out = new Array(picks.length); let next = 0, done = 0;
    await Promise.all(Array.from({ length: Math.min(3, picks.length) }, async () => {   // 셋씩 동시에
      while (next < picks.length) { const k = next++; out[k] = await renderCandidate(videoOf(J), path.join(J.dir, '후보'), picks[k], s.duration, ctx); J.s.progress = +(0.9 + 0.1 * (++done) / picks.length).toFixed(3); }
    }));
    s.candidates = out; setStage(J, 'done', '끝', 1); delete s.error;
    ctx.log(`✔ 하이라이트 후보 ${out.length}개 완성.`);
  }
  function launch(J, fn) {
    J.ctrl.aborted = false; J.running = true; fs.writeFileSync(logf(J), '');
    const ctx = mkCtx(J); J.s.status = 'queued'; delete J.s.error; save(J);
    (async () => {
      try { await fn(ctx); }
      catch (e) {
        J.s.status = e instanceof StopError ? 'stopped' : 'failed';
        J.s.error = e instanceof StopError ? '사용자가 멈췄어요.' : e instanceof StepError ? e.message : `예상 못 한 오류: ${e.message}`;
        if (!(e instanceof StepError || e instanceof StopError)) logErr(e);
        ctx.log(`✖ ${J.s.error}`);
      } finally { J.running = false; J.ctrl.child = null; save(J); }
    })();
  }
  const clampN = (v, lo, hi, d) => { v = Math.round(+v); return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d; };
  const anyRunning = () => [...jobs.values()].some(J => J.running);

  return {
    dir: dataDir, jobs,
    get: id => jobs.get(String(id || '')) || null,
    list: () => [...jobs.values()].sort((a, b) => b.s.created - a.s.created).map(summary),
    summary, detail, videoOf,
    // 에피소드를 지울 때: 하이라이트 작업이 들고 있던 그 에피소드 이름만 비워요 (작업·원본.mp4 는 그대로)
    dropEpisodeRef(ep) { let n = 0; for (const J of jobs.values()) if (J.s.fromEpisode && J.s.fromEpisode === ep) { J.s.fromEpisode = ''; try { save(J); } catch {} n++; } return n; },
    // 링크(url) 또는 이미 받은 에피소드 영상(local + info)으로 시작
    async start({ url, local, info, count, len, fromEpisode }) {
      if (anyRunning()) throw new StepError('지금 다른 하이라이트 작업이 돌고 있어요. 끝나거나 멈춘 뒤에 눌러 주세요.');
      count = clampN(count, 1, COUNT_MAX, COUNT_DEFAULT); len = clampN(len, LEN_MIN, LEN_MAX, LEN_DEFAULT);
      let J;
      if (local) J = open({ url: info.url, title: info.title, videoId: info.id, duration: info.duration, channel: info.channel, license: info.license, fromEpisode, local });
      else {
        url = String(url || '').trim(); if (!/^https?:\/\//i.test(url)) throw new StepError('영상 주소가 이상해요. https:// 로 시작하는 유튜브 주소를 넣어 주세요.');
        const known = [...jobs.values()].find(x => x.s.url === url);
        if (known) J = known;
        else { const ctx0 = { log() {}, aborted: () => false, setChild() {} }; const i = await ytInfo(url, ctx0); J = open({ url: i.url, title: i.title, videoId: i.id, duration: i.duration, channel: i.channel, license: i.license }); }
      }
      if (local && !J.s.local) J.s.local = local;
      J.s.count = count; J.s.len = len;
      launch(J, ctx => pipeline(J, ctx));
      return J;
    },
    // 개수·길이만 바꿔서 다시 고르기 (분석은 그대로)
    repick(J, { count, len }) {
      if (J.running) throw new StepError('지금 이 작업이 돌고 있어요.');
      if (anyRunning()) throw new StepError('지금 다른 하이라이트 작업이 돌고 있어요.');
      J.s.count = clampN(count, 1, COUNT_MAX, J.s.count); J.s.len = clampN(len, LEN_MIN, LEN_MAX, J.s.len);
      launch(J, ctx => pipeline(J, ctx));
    },
    stop(J) { J.ctrl.aborted = true; try { J.ctrl.child?.kill('SIGTERM'); setTimeout(() => { try { J.ctrl.child?.kill('SIGKILL'); } catch {} }, 3000); } catch {} },
    shutdown() { for (const J of jobs.values()) { J.ctrl.aborted = true; try { J.ctrl.child?.kill('SIGTERM'); } catch {} } },
  };
}
