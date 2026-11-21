// 공용 도구: 시간 계산, 외부 프로그램 실행, ffmpeg 도우미
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HOME = os.homedir();
export const FFMPEG = process.env.FIELDNOTE_FFMPEG || path.join(HOME, '.local/bin/ffmpeg');
export const YTDLP = process.env.FIELDNOTE_YTDLP || path.join(HOME, '.local/bin/yt-dlp');
export const FONT_DIR = '/System/Library/Fonts';
export const FONT_NAME = 'Apple SD Gothic Neo';

export class StopError extends Error {}   // 사용자가 멈춤
export class StepError extends Error {}   // 짧은 한국어 사유를 그대로 화면에 보여 줌

// "0:30" "1:02:03" "45" → 초
export function parseTime(s) {
  const p = String(s).trim().split(':').map(Number);
  if (!p.length || p.length > 3 || p.some(n => !Number.isFinite(n) || n < 0)) return NaN;
  return p.reduce((a, n) => a * 60 + n, 0);
}
export function fmtTime(sec) {
  sec = Math.max(0, Math.round(sec));
  const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}
// "0:30-0:42, 1:05-1:12x0.5" → ['0:30-0:42','1:05-1:12x0.5'] (잘못된 항목이 있으면 Error). 끝의 x0.5 = 0.5배 느리게(슬로우)
export const MAX_RANGE = 180;   // 한 구간 최대 3분 (하이라이트 30초·1분·2분·3분)
export const ALL_RANGE = '전체';
export function parseRanges(input) {
  const toks = Array.isArray(input) ? input : String(input || '').split(/[,\s]+/).map(x => x.trim()).filter(Boolean);
  if (toks.some(t => /^(전체|all)$/i.test(t))) {   // 영상 전체 = "전체" 하나만 (쇼츠는 앞 58초까지)
    if (toks.length > 1) throw new StepError('"전체"는 혼자만 쓸 수 있어요. 구간과 같이 쓰지 마세요.');
    return [ALL_RANGE];
  }
  return toks.map(t => {
    const m = /^(\d+(?::\d{1,2}){0,2})\s*[-~–]\s*(\d+(?::\d{1,2}){0,2})(?:[x×*@](\d*\.?\d+))?$/i.exec(t);
    if (!m) throw new StepError(`구간 모양이 이상해요: "${t}" (예: 0:30-0:42, 슬로우는 0:30-0:34x0.5)`);
    const a = parseTime(m[1]), b = parseTime(m[2]), sp = m[3] == null ? 1 : +m[3];
    if (!(b > a)) throw new StepError(`구간의 끝이 시작보다 늦어야 해요: ${t}`);
    if (b - a > MAX_RANGE + 0.01) throw new StepError(`한 구간은 ${MAX_RANGE}초까지예요: ${t}`);
    if (!(sp >= 0.25 && sp <= 1)) throw new StepError(`슬로우 배속은 0.25~1 사이예요: ${t} (예: x0.5)`);
    return `${fmtTime(a)}-${fmtTime(b)}${sp < 1 ? 'x' + +sp.toFixed(2) : ''}`;
  });
}
export const rangeSpeed = r => { const m = /x(\d*\.?\d+)$/.exec(String(r)); return m ? +m[1] : 1; };
export const rangeSecs = r => r === ALL_RANGE ? [0, Infinity] : String(r).replace(/x\d*\.?\d+$/, '').split('-').map(parseTime);

export const sanitize = (t, n = 40) =>
  String(t || '').replace(/[\\/:*?"<>|#%&{}$!'`@+=~^;,\[\]()]/g, '').replace(/\s+/g, ' ').trim().slice(0, n).trim();

export const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };

// 외부 프로그램 실행. ctx.log(줄), ctx.setChild(child), ctx.aborted() 를 사용
export function run(cmd, args, ctx = {}, opts = {}) {
  return new Promise((resolve, reject) => {
    if (ctx.aborted?.()) return reject(new StopError('멈췄어요'));
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], cwd: opts.cwd, env: { ...process.env, PATH: `${opts.path ? opts.path + ':' : ''}${path.join(HOME, '.local/bin')}:/usr/bin:/bin:/usr/sbin:/sbin:${process.env.PATH || ''}` } });
    ctx.setChild?.(child);
    let out = '', err = '';
    child.stdout.on('data', d => { opts.onOut?.(d); out += d; if (out.length > 4e6) out = out.slice(-2e6); if (opts.tee) ctx.log?.(String(d).trim().split(/\r?\n/).pop()); });
    child.stderr.on('data', d => { err += d; if (err.length > 4e6) err = err.slice(-2e6); });
    child.on('error', e => reject(new StepError(`프로그램을 못 켰어요(${path.basename(cmd)}): ${e.message}`)));
    child.on('close', (code, sig) => {
      ctx.setChild?.(null);
      if (ctx.aborted?.()) return reject(new StopError('멈췄어요'));
      if (code === 0) return resolve({ out, err });
      const e = new Error(`${path.basename(cmd)} 종료 코드 ${code ?? sig}`);
      e.out = out; e.err = err; e.code = code;
      reject(e);
    });
  });
}
export const lastLines = (s, n = 3) => String(s || '').trim().split(/\r?\n/).filter(Boolean).slice(-n).join(' / ').slice(0, 300);

// ffmpeg -i 의 stderr 에서 길이/영상/오디오 여부를 읽는다 (ffprobe 없음)
export async function probe(file, ctx) {
  let err = '';
  try { await run(FFMPEG, ['-hide_banner', '-nostdin', '-i', file], ctx); } catch (e) { if (e instanceof StopError) throw e; err = e.err || ''; }
  const m = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(err);
  const v = /Stream #[\d:]+.*Video:.*?(\d{2,5})x(\d{2,5})/.exec(err);
  return {
    duration: m ? (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) : null,
    hasVideo: /Video:/.test(err), hasAudio: /Audio:/.test(err),
    width: v ? +v[1] : null, height: v ? +v[2] : null, raw: err,
  };
}

// ctx.onTime(초) 가 있으면 ffmpeg 진행(지금까지 만든 길이)을 알려 줘요 (작업판 퍼센트)
// ctx.liveJpg 가 있으면 만드는 중인 화면을 그 jpg 로 계속 덮어써요 (작업판에서 영상이 만들어지는 걸 실시간으로)
function withLive(args, jpg) {
  const fi = args.indexOf('-filter_complex'), mi = args.indexOf('-map');
  if (fi < 0 || mi < 0 || !/^\[\w+\]$/.test(args[mi + 1] || '')) return args;
  const lab = args[mi + 1].slice(1, -1), out = [...args];
  out[fi + 1] = `${args[fi + 1]};[${lab}]split=2[${lab}_m][${lab}_l];[${lab}_l]fps=3,scale=360:-2[${lab}_j]`;
  out[mi + 1] = `[${lab}_m]`;
  return [...out, '-map', `[${lab}_j]`, '-update', '1', '-q:v', '5', jpg];
}
export const ff = (args, ctx) => {
  if (ctx?.liveJpg) args = withLive(args, ctx.liveJpg);
  if (!ctx?.onTime) return run(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', ...args], ctx);
  const onOut = d => { const all = [...String(d).matchAll(/out_time_(?:us|ms)=(\d+)/g)]; if (all.length) ctx.onTime(+all[all.length - 1][1] / 1e6); };
  return run(FFMPEG, ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error', '-nostats', '-progress', 'pipe:1', ...args], ctx, { onOut });
};

export function isLocalSource(u) { return /^(file:\/\/|\/|~\/)/.test(u); }
export function localPath(u) {
  if (u.startsWith('file://')) return decodeURIComponent(new URL(u).pathname);
  if (u.startsWith('~/')) return path.join(HOME, u.slice(2));
  return u;
}

// ---------- 영어 자막(VTT) 읽기 ----------
export const vttSecs = t => { const p = t.replace(',', '.').split(':').map(Number); return p.reduce((a, n) => a * 60 + n, 0); };
const decodeEnt = s => s.replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
// VTT 글 → [{start,end,text}]. 태그 지우고, 자동자막이 윗줄을 되풀이하는 것은 한 번만 남김
export function parseVtt(text) {
  const out = []; let prev = new Set();
  for (const block of String(text || '').replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n'), ti = lines.findIndex(l => l.includes('-->'));
    if (ti < 0) continue;
    const m = /([\d:.,]+)\s*-->\s*([\d:.,]+)/.exec(lines[ti]); if (!m) continue;
    const start = vttSecs(m[1]), end = vttSecs(m[2]);
    const ls = lines.slice(ti + 1).map(l => decodeEnt(l.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim()).filter(Boolean);
    const fresh = ls.filter(l => !prev.has(l));
    prev = new Set(ls);
    if (fresh.length) out.push({ start, end, text: fresh.join(' ') });
  }
  return out;
}
