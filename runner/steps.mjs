// 10단계 구현. 각 단계는 (E, ctx) 를 받는다.
//  E   = 에피소드 (E.dir, E.s = 저장되는 상태, E.p(...) = 폴더 안 경로)
//  ctx = { log, aborted, setChild }
import fs from 'node:fs';
import path from 'node:path';
import {
  FFMPEG, YTDLP, FONT_DIR, FONT_NAME, StepError, StopError, run, ff, probe, lastLines, exists,
  parseRanges, rangeSecs, rangeSpeed, fmtTime, parseTime, isLocalSource, localPath, MAX_RANGE,
} from './util.mjs';

export const STEP_DEFS = [
  { id: 'research', name: '소스 확인' },
  { id: 'download', name: '영상 받기' },
  { id: 'clip', name: '구간 자르기' },
  { id: 'plan', name: '편집 계획' },
  { id: 'rough', name: '가편집' },
  { id: 'subs', name: '자막 자동화' },
  { id: 'fx', name: '이펙트' },
  { id: 'script', name: '대본', gate: true },
  { id: 'mix', name: '목소리·음악' },
  { id: 'upload', name: '업로드 패키지' },
];
// 스튜디오 카드(9칸) 와 실행기 단계의 짝: 링크·룩 = 실행기 단계 없음 / 영상 다운 = research+download / 컷 편집 = 구간+clip+plan+rough /
// 자막 = subs / 이펙트 = fx / 음악·녹음 = script(대본, 게이트) → 녹음 → mix / 업로드 패키지 = upload / 올리기 = 없음


const SPEC = { shorts: { w: 1080, h: 1920, maxTotal: 58 }, long: { w: 1920, h: 1080, maxTotal: 600 } };
const specOf = E => SPEC[E.s.format] || SPEC.shorts;
const readJson = (f, d = null) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 2)); };
const AUDIO_EXT = /\.(mp3|m4a|wav|aac|ogg|flac|opus|aiff?)$/i;

export const PLACEHOLDER = '[여기에 대사]';

// ---------- 채널별 설정 ----------
// 채널이 없거나 모르는 채널이면 'yt-wrestling' (예전 에피소드는 그대로 동작)
export const CHANNEL_PROFILES = {
  'yt-wrestling': {
    persona: fmt => `레슬링·주짓수·MMA를 취미로 하는 생활체육인(20~40대 직장인)을 위한 유튜브 ${fmt} 해설 작가`,
    rules: [],
    tags: ['레슬링', '주짓수', 'MMA'],
    disclaimer: '경기 장면은 해설·분석 목적으로 일부만 사용했습니다.',
    transcript: false,
  },
  'yt-christian': {
    persona: fmt => `한국 시청자를 위한 기독교 해설 유튜브 ${fmt} 작가`,
    rules: [
      '나레이션과 자막은 모두 한국어로만 써. 영어 문장을 그대로 두지 마.',
      '소스 영상은 영어야. 화자의 말을 옮길 때는 뜻이 바뀌지 않게 한국어로 옮기고, 누가 한 말인지 분명히 밝혀 ("그는 ~라고 말해요").',
      '영상에 없는 발언을 지어내지 마.',
      '성경과 교리는 쉬운 말로 풀어 줘.',
      '이단성 주장에는 날카롭게, 다만 교단의 공식 판단과 내 의견은 나눠서 말해. 사람을 조롱하지 마.',
    ],
    // 영상 모양(배너 룩). 없으면 예전 그대로. 쇼츠에만 적용. 값을 바꾸면 모양이 바뀌어요.
    look: { kind: 'banner', bg: '#0E1B33', accent: '#3DE0C0', bannerH: 440, introBW: true, bilingual: true },
    tags: ['기독교', '성경', '신앙', '변증'],
    disclaimer: '토론·설교 장면은 해설·비평 목적으로 일부만 사용했습니다. 영상 속 영어 발언은 한국어로 옮겨 자막으로 달았습니다.',
    transcript: true,
  },
  'yt-politics': {
    persona: fmt => `한국 시청자를 위한 보수·기독교 가치 관점의 정치·이민 시사 해설 유튜브 ${fmt} 작가`,
    rules: [
      '나레이션과 자막은 모두 한국어로만 써. 영어 문장을 그대로 두지 마.',
      '소스 영상은 영어야. 화자의 말을 옮길 때는 뜻이 바뀌지 않게 한국어로 옮기고, 누가 한 말인지 분명히 밝혀.',
      '영상에 없는 발언을 지어내지 마.',
      '사실, 추정, 의견을 나눠서 말해. ("~로 알려져 있어요" / "~일 수 있어요" / "내 생각엔")',
      '사람을 조롱하지 마.',
    ],
    // 펀치 룩: 훅 제목(처음 잠깐 작은 화면) → 꽉 찬 화면 + 굵은 자막 + 한 단어 강조 + 워터마크
    look: { kind: 'punch', accent: '#FFD400', watermark: 'FIELDNOTE' },
    tags: ['정치', '이민', '시사'],
    disclaimer: '영상 장면은 해설·논평 목적으로 일부만 사용했습니다. 영상 속 영어 발언은 한국어로 옮겨 자막으로 달았습니다.',
    transcript: true,
  },
  // 매트 스토리 룩: 검은 바탕 + 위 2줄 제목(노랑/빨강) + 가운데 경기 화면 + 굵은 자막 + 선수 태그·점수 도장·슬로우 표시 + 원본 경기 소리
  'yt-mat': {
    persona: fmt => `레슬링·주짓수·MMA를 취미로 하는 생활체육인(20~40대 직장인)을 위한 유튜브 ${fmt} 해설 작가`,
    rules: [],
    look: { kind: 'mat' },
    tags: ['레슬링', '주짓수', 'MMA'],
    disclaimer: '경기 장면은 해설·분석 목적으로 일부만 사용했습니다.',
    transcript: false,
  },
};
// 레퍼런스 쇼츠를 본뜬 레슬링 룩 4개 (펀치 룩 틀을 값으로만 바꿔요). 전부 꽉 찬 화면 + 원본 경기 소리. 이펙트 팩과 짝이 있어요.
const wrestlingLook = look => ({ persona: CHANNEL_PROFILES['yt-mat'].persona, rules: [], look: { audio: 'orig', origVol: 1.0, bgmVol: 0.22, hookDur: 0, watermark: '', plain: true, ...look },
  tags: ['레슬링', '주짓수', 'MMA'], disclaimer: '경기 장면은 해설·분석 목적으로 일부만 사용했습니다.', transcript: false });
CHANNEL_PROFILES['yt-raw'] = wrestlingLook({ kind: 'punch', accent: '#FFD400', capColor: '#FFD400', capFs: 84, capY: 0.72, capBord: 10, subBox: false });
CHANNEL_PROFILES['yt-steps'] = wrestlingLook({ kind: 'punch', accent: '#FFD400', capFs: 70, capY: 0.82, capBord: 8, subBox: false,
  hookDur: 2.5, hookScale: 1, hookY: 0.075, hookFs: 66, hookWrap: 14, hookColor: '#FFFFFF', hookBox: true });
CHANNEL_PROFILES['yt-words'] = wrestlingLook({ kind: 'punch', accent: '#3EE6FF', capFs: 88, capY: 0.62, capBord: 11, capItalic: true, subBox: false });
CHANNEL_PROFILES['yt-tags'] = wrestlingLook({ kind: 'punch', accent: '#FFE100', bg: '#1E88FF', capFs: 64, capY: 0.76, capBord: 0, subBox: true, boxAlpha: 0, boxPad: 38, boxMinW: 240, boxMinH: 118, boxR: 59, boxLineH: 1.1 });
export const profileOf = E => CHANNEL_PROFILES[E?.s?.channel] || CHANNEL_PROFILES['yt-wrestling'];
// 편집 룩: 영상마다 고를 수 있어요 (state.look). 비어 있으면 채널 자기 룩. 룩 이름 = 룩을 가진 채널 설정의 이름.
export const LOOK_CHOICES = [
  { id: 'yt-wrestling', name: '기본 룩', desc: '흰 자막 + 첫 1.5초 제목 카드 (레슬링 채널 기본)' },
  { id: 'yt-christian', name: '배너 룩', desc: '남색 배너 + 민트 강조 + 흑백 인트로 + 한·영 자막 (기독교 채널 기본)' },
  { id: 'yt-politics', name: '펀치 룩', desc: '첫 1초 훅 제목 + 굵은 자막 + 노란 강조 + 워터마크 (정치 채널 기본)' },
  { id: 'yt-mat', name: '매트 스토리 룩', desc: '검은 바탕 + 위 2줄 제목(노랑·빨강) + 굵은 자막 + 선수 태그·점수 도장·SLOW 표시 + 원본 경기 소리 (레슬링 추천)' },
  { id: 'yt-raw', name: '리얼 룩', desc: '꽉 찬 경기 화면 + 노란 굵은 자막(검은 테두리) + 제목 카드 없음 + 원본 소리 · 참고: Lethal Double Leg 쇼츠 310만 회', pack: 'raw' },
  { id: 'yt-steps', name: '단계 룩', desc: '위에 검은 상자 흰 글씨 제목 + 아래 흰 굵은 자막 + 원본 소리 · 참고: 더블렉 단계 강의 쇼츠 180만 회', pack: 'steps' },
  { id: 'yt-words', name: '말자막 룩', desc: '굵은 기울임 흰 자막(두꺼운 검은 테두리) + 하늘색 강조 단어 + 원본 소리 · 참고: 코치 말자막 강의 쇼츠 71만 회', pack: 'words' },
  { id: 'yt-tags', name: '라벨 룩', desc: '파란 둥근 알약 상자에 흰 굵은 자막 + 아래쪽 배치 + 원본 소리 · 참고: 라벨 태그 기술 쇼츠 150만 회', pack: 'tags' },
];
// 룩과 짝인 이펙트 팩 (직접 고른 팩이 없을 때만 써요)
export const LOOK_PACK = Object.fromEntries(LOOK_CHOICES.filter(l => l.pack).map(l => [l.id, l.pack]));
export const lookKeyOf = E => (CHANNEL_PROFILES[E?.s?.look] ? E.s.look : CHANNEL_PROFILES[E?.s?.channel] ? E.s.channel : 'yt-wrestling');
// 배너 룩 기본값 (채널의 look 이 덮어써요). 글자 크기는 1080x1920 기준 px.
export const LOOK_DEFAULTS = { kind: 'banner', bg: '#0E1B33', accent: '#3DE0C0', bannerH: 440, introBW: true, bilingual: true,
  smallFs: 74, bigFs: 138, narrFs: 100, koFs: 76, enFs: 52, subTop: 1160,
  subBox: true, boxAlpha: 0x1A, boxPad: 26, boxMinW: 1000, boxMinH: 330, subCy: 1215, boxR: 30, boxLineH: 1.12 };  // subBox: 자막 뒤 어두운 상자 (영상에 박힌 영어 자막 가리기)
// 펀치 룩 기본값: 훅(처음 hookDur초, 화면 hookScale 크기) / 자막 / 펀치 한 단어 / 워터마크
export const PUNCH_DEFAULTS = { kind: 'punch', accent: '#FFD400', hookFs: 140, hookScale: 0.78, hookDur: 1.3, hookY: 0.72, hookBord: 8,
  capFs: 84, capY: 0.68, capBord: 6, punchFs: 160, punchY: 0.60, punchRot: -4, subBox: false, boxAlpha: 0x1A, boxPad: 24, boxMinW: 1000, boxMinH: 260, boxR: 28, boxLineH: 1.12, watermark: 'FIELDNOTE', wmFs: 68, wmX: 60, wmY: 140, font: '', punchFont: '' };
// 매트 스토리 룩 기본값 (1080x1920 기준 px): 제목 두 줄 / 경기 화면 칸(footY~footY+footH) / 자막 / 태그 / 도장 / 출처 / 워터마크 / 소리
export const MAT_DEFAULTS = { kind: 'mat', footY: 470, footH: 970, titleFs: 92, titleY1: 257, titleY2: 355, c1: '#FFE100', c2: '#FF2B2B',
  accent: '#FFE100', capFs: 78, capY: 1172, capBord: 7, capWrap: 15, tagX: 44, tagY: 500, tagH: 84, tagFs: 50, tagBg: '#F23A3A', tagSubFs: 36, tagSubH: 62, tagDur: 5,
  slowFs: 66, slowY: 500, slowH: 91, slowRight: 1040, stampY: 790, stampFs: 220, stampSubFs: 62, stampRot: 4, stampBord: 10,
  creditY: 1486, creditFs: 38, watermark: 'MAT STORY', wmFs: 46, wmX: 1050, wmY: 1420, audio: 'orig', origVol: 1.0, bgmVol: 0.22, font: '' };
const LOOK_BASE = { punch: PUNCH_DEFAULTS, mat: MAT_DEFAULTS };
export const resolveLook = look => (look ? { ...(LOOK_BASE[look.kind] || LOOK_DEFAULTS), ...look } : null);
// 쇼츠일 때만 적용
export const lookOf = E => (E?.s?.format === 'long' ? null : resolveLook(CHANNEL_PROFILES[lookKeyOf(E)].look));
// 원본 영상 소리를 살리는 룩인가 (매트 스토리 룩). 다른 룩은 예전처럼 원본 소리를 빼요.
export const keepsAudio = E => lookOf(E)?.audio === 'orig';

// ---------- 최종 결과물 레퍼런스(이펙트 팩) ----------
// 룩 = 색·틀·자막 자리 / 이펙트 팩 = 영상 속 강조: 줌 펀치·흔들림·플래시·슬로우 줌·효과음·단어 팝. 이펙트 단계(영상)와 목소리·음악 단계(효과음)에서 실제로 적용돼요.
// desc 는 " · " 로 효과를 나열해요 (작업판이 목록으로 보여 줘요). ref = 예시 영상 링크 ('' = 없음, 사용자가 직접 넣어요).
export const FX_PACKS = [
  { id: 'none', name: '이펙트 없음', desc: '지금처럼 그대로 · 줌·흔들림·효과음 없음', ref: '' },
  { id: 'raw', name: '한 방 리얼', desc: '진짜 경기 화면 그대로 · 훅 문구를 영상 내내 고정 · 줌·흔들림 없음 · 끝에 마지막 2초 0.5배 REPLAY', ref: 'https://www.youtube.com/shorts/vvXC-IW5oOE', views: '310만 회',
    hookFixed: true, replay: true, hitSrc: [], sfx: {} },
  { id: 'steps', name: '단계 강의', desc: '처음 2.5초 제목 상자 · 구간마다 번호 라벨 · 움직임 순간에 잔상 · 마지막은 "다 합치면"', ref: 'https://www.youtube.com/shorts/hML9vjR6wX0', views: '180만 회',
    steps: true, titleDur: 2.5, ghost: 0.5, hitSrc: [], sfx: {} },
  { id: 'words', name: '말자막 강의', desc: '말 자막이 2~4단어씩 나타남 · 강조 단어 하늘색 · ✕ ✓ 아이콘 팝 · 컷마다 빠른 줌 · "띵"/"팡"', ref: 'https://www.youtube.com/shorts/mJIVHZUGw40', views: '71만 회',
    words: true, punchZoom: 0.15, punchDur: 0.3, hitSrc: [], sfx: { ok: '띵', x: '팡' }, sfxVol: 0.55 },
  { id: 'tags', name: '라벨 태그', desc: '핵심 순간마다 파란 알약 라벨이 톡 · 슬로우 시작에 흔들림 · 라벨마다 "휙"', ref: 'https://www.youtube.com/shorts/qDD40BckF20', views: '150만 회',
    tags: true, pill: 1.2, flash: 0.06, flashAlpha: 0.5, shake: 0.4, shakeAmp: 16, shakeOn: 'slow', hitSrc: ['hl'], maxHits: 4, sfx: { label: '휙' } },
  { id: 'match', name: '경기 하이라이트', desc: '슬로우 시작에 흰 플래시 + 줌인 유지 · 컷마다 "휙" · 점수 도장·강조에 흔들림 + "쾅"', ref: 'https://www.youtube.com/shorts/H-wcWuDSIvg',
    slowZoom: 0.10, flash: 0.08, flashAlpha: 0.8, shake: 0.3, shakeAmp: 18, flashOn: 'slow', hitSrc: ['stamp', 'punch'], maxHits: 8, sfx: { cut: '휙', hit: '쾅' } },
  { id: 'calm', name: '잔잔', desc: '클립마다 천천히 줌인 · 컷 사이 짧게 어둡다 밝아짐 · 첫 강조점에 부드러운 "띵"', ref: 'https://www.youtube.com/shorts/op51yRlhjjI',
    kenburns: 0.06, dip: 0.12, dipDepth: 0.45, hitSrc: ['punch', 'stamp', 'hl'], maxHits: 1, sfx: { hit: '띵' } },
  { id: 'punch', name: '펀치', desc: '컷마다 빠른 줌 펀치 · 강조 순간 흔들림 + 흰 플래시 · "팡" 효과음 · 강조 단어 팝', ref: 'https://www.youtube.com/shorts/1zpjOi8_LH0',
    punchZoom: 0.12, punchDur: 0.35, shake: 0.3, shakeAmp: 18, flash: 0.08, flashAlpha: 0.8, pop: true, hitSrc: ['punch', 'hl'], maxHits: 12, sfx: { hit: '팡' } },
];
export const FX_DEFAULT = { 'yt-christian': 'calm', 'yt-politics': 'punch' };
// 고른 팩 > 룩과 짝인 팩(레퍼런스 룩) > 채널 기본
export const fxPackOf = E => FX_PACKS.find(p => p.id === E?.s?.fxPack) || FX_PACKS.find(p => p.id === LOOK_PACK[E?.s?.look]) || FX_PACKS.find(p => p.id === (FX_DEFAULT[E?.s?.channel] || 'match'));
// "0:03, 0:07.5" 또는 "0:03 벽처럼 서기, 0:06 레벨 체인지" → { text, secs, entries:[{t, text}] } (모양이 이상하면 StepError). 문구는 선택이에요.
export function parseFxTimes(input) {
  const entries = [], raws = [];
  for (const ch of String(input || '').split(/[,;，\n]+/).map(x => x.trim()).filter(Boolean)) {
    const toks = ch.split(/\s+/); let i = 0;
    while (i < toks.length) {
      const t = parseTime(toks[i]);
      if (!Number.isFinite(t)) throw new StepError(`시간 모양이 이상해요: "${toks[i]}" (예: 0:03, 0:07.5, 0:03 문구)`);
      const raw = toks[i++], rest = [];
      while (i < toks.length && !Number.isFinite(parseTime(toks[i]))) rest.push(toks[i++]);
      const text = rest.join(' ').replace(/[{}\\]/g, '').slice(0, 24);
      entries.push({ t, text }); raws.push(text ? raw + ' ' + text : raw);
    }
  }
  if (entries.length > 30) throw new StepError('강조할 시간은 30개까지예요.');
  return { text: raws.join(', '), secs: entries.map(e => e.t), entries };
}
// 줄 앞의 ✕/X (틀린 예) · ✓/O (맞는 예) 표시 → { mark: 'x'|'ok'|'', text }
export function parseMark(raw) {
  const s = String(raw || '');
  let m = /^\s*(?:[✕✗✖×]\s*|X\s+)/.exec(s); if (m) return { mark: 'x', text: s.slice(m[0].length).trim() };
  m = /^\s*(?:[✓✔]\s*|O\s+)/.exec(s); if (m) return { mark: 'ok', text: s.slice(m[0].length).trim() };
  return { mark: '', text: s.trim() };
}
// 말자막: 한 줄을 2~4단어씩 나눠 글자 수에 비례해 줄의 시작~끝에 배분 → [{start,end,words:[{t,hl}]}] (*강조* 표시는 hl)
export function chunkLine(raw, start, end) {
  const toks = []; let hl = false;
  for (const part of String(raw || '').split(/(\*)/)) { if (part === '*') { hl = !hl; continue; } for (const w of part.split(/\s+/).filter(Boolean)) toks.push({ t: w, hl }); }
  if (!toks.length) return [];
  const n = toks.length, k = Math.max(1, Math.round(n / 3)), base = Math.floor(n / k), extra = n % k, groups = [];
  for (let g = 0, i = 0; g < k; g++) { const size = base + (g < extra ? 1 : 0); groups.push(toks.slice(i, i + size)); i += size; }
  const wts = groups.map(g => g.reduce((a, w) => a + [...w.t].length, 0)), sum = wts.reduce((a, b) => a + b, 0), span = end - start;
  let cum = 0;
  return groups.map((g, i) => { const a = start + span * cum / sum; cum += wts[i]; const b = i === groups.length - 1 ? end : start + span * cum / sum; return { start: +a.toFixed(2), end: +b.toFixed(2), words: g }; });
}
// 단계 강의 라벨: 구간 하나 = 단계 하나. 이름이 없으면 "1단계"…, 구간이 3개 이상이면 마지막은 "다 합치면"
export function stepLabels(labels, n) {
  return Array.from({ length: n }, (_, i) => {
    const l = String((labels || [])[i] || '').trim().slice(0, 20);
    if (l) return `${i + 1}. ${l}`;
    return n >= 3 && i === n - 1 ? '다 합치면' : `${i + 1}단계`;
  });
}
// 강조 순간 목록 [{t, kind}] — cut(컷 이음새) / slow(슬로우 구간 시작) / hit(강조·펀치·점수 도장·직접 적은 시간). 0~총길이로 자르고, 같은 종류끼리 0.25초 안은 하나로 합쳐요.
export function buildFxEvents(E, P, pack) {
  const T = P.total, out = [], clips = P.clips || [];
  clips.forEach((c, i) => { if (i > 0 && c.start > 0.05) out.push({ t: c.start, kind: 'cut' }); if (c.speed < 1) out.push({ t: c.start, kind: 'slow' }); });
  const src = pack.hitSrc || [], hits = [];
  const kw = l => (/\*([^*\n]+)\*/.exec(l.ko ?? '') || [])[1] || '';
  const grade = l => (l.punch && src.includes('punch') ? 0 : l.stamp && src.includes('stamp') ? 0 : /\*[^*\n]+\*/.test(l.ko ?? '') && src.includes('hl') ? 1 : -1);
  const cand = (P.lines || []).map(l => ({ t: l.start, g: grade(l), text: pack.tags ? kw(l) : '' })).filter(x => x.g >= 0);
  const manual = parseFxTimes(E.s.fxTimes).entries.map(e => ({ t: e.t, g: -1, text: e.text }));   // 직접 적은 시간은 항상 넣어요
  let picked = pack.maxHits === 1 ? [...cand, ...manual].sort((a, b) => a.t - b.t).slice(0, 1)   // 잔잔: 첫 강조점 하나
    : [...[...cand].sort((a, b) => a.g - b.g || a.t - b.t).slice(0, pack.maxHits || 99), ...manual];
  for (const x of picked) hits.push({ t: x.t, kind: pack.tags && x.text ? 'label' : 'hit', ...(x.text ? { text: x.text } : {}) });
  if (pack.maxHits === 1 && !hits.length) hits.push({ t: Math.min(0.5, T / 2), kind: 'hit' });
  out.push(...hits);
  if (pack.words) for (const l of P.lines || []) { const m = parseMark(l.ko ?? l.text).mark; if (m) out.push({ t: l.start, kind: m }); }   // ✕ ✓ 줄
  const res = [], last = {};
  for (const e of out.map(e => ({ ...e, t: +Math.max(0, Math.min(T, e.t)).toFixed(2) })).sort((a, b) => a.t - b.t)) {
    if (last[e.kind] != null && e.t - last[e.kind] < 0.25) continue;
    last[e.kind] = e.t; res.push(e);
  }
  return res;
}
// 영상 칸(wA x hA)에 입힐 ffmpeg 필터 글. 글자·배너·틀을 입히기 전에 영상 그림에만 적용해서 글자는 흔들리지 않아요. 이펙트 없음 = ''.
// 줌 = scale(eval=frame) 후 가운데 crop / 흔들림 = crop 위치를 sin 으로 / 플래시 = drawbox 흰색 / 어둡게 = eq brightness
export function fxVideoFilter(pack, P, evs, wA, hA) {
  if (!pack || pack.id === 'none') return '';
  const n = x => +(+x).toFixed(3), win = (a, b) => `gte(t,${n(a)})*lt(t,${n(b)})`;
  const clips = (P.clips || []).filter(c => c.duration >= 0.1), cuts = evs.filter(e => e.kind === 'cut'), hits = evs.filter(e => e.kind === 'hit'), slows = evs.filter(e => e.kind === 'slow');
  const z = [], dx = [], dy = [], flash = [];
  if (pack.kenburns) for (const c of clips) z.push(`${win(c.start, c.start + c.duration)}*${pack.kenburns}*(t-${n(c.start)})/${n(c.duration)}`);
  if (pack.punchZoom) for (const e of cuts) z.push(`${win(e.t, e.t + pack.punchDur)}*${pack.punchZoom}*sin(PI*(t-${n(e.t)})/${pack.punchDur})`);
  if (pack.slowZoom) for (const c of clips) if (c.speed < 1) z.push(`${win(c.start, c.start + c.duration)}*${pack.slowZoom}*min(1,(t-${n(c.start)})/0.15)`);
  if (pack.shake) for (const e of (pack.shakeOn === 'slow' ? slows : hits)) {
    const a = e.t, b = e.t + pack.shake, w = `${win(a, b)}*(1-(t-${n(a)})/${pack.shake})`;
    z.push(`${win(a, b)}*0.04`);   // 흔들려도 가장자리가 안 보이게 살짝 키워 둬요
    dx.push(`${w}*${pack.shakeAmp}*sin(t*61)`); dy.push(`${w}*${n(pack.shakeAmp * 0.7)}*cos(t*79)`);
  }
  if (pack.flash) for (const e of (pack.flashOn === 'slow' ? slows : hits)) flash.push(`between(t,${n(e.t)},${n(e.t + pack.flash)})`);
  const f = [];
  if (z.length) {
    const Z = `1+${z.join('+')}`;
    f.push(`scale=w='trunc(${wA}*(${Z})/2)*2':h=-2:eval=frame`);
    f.push(`crop=w=${wA}:h=${hA}:x='max(0,min(in_w-out_w,(in_w-out_w)/2+${dx.length ? dx.join('+') : 0}))':y='max(0,min(in_h-out_h,(in_h-out_h)/2+${dy.length ? dy.join('+') : 0}))'`);
  }
  if (flash.length) f.push(`drawbox=x=0:y=0:w=iw:h=ih:color=white@${pack.flashAlpha}:t=fill:enable='${flash.join('+')}'`);
  if (pack.dip && cuts.length) f.push(`eq=brightness='${cuts.map(e => `-${pack.dipDepth}*max(0,1-abs(t-${n(e.t)})/${n(pack.dip / 2)})`).join('')}':eval=frame`);
  let out = f.join(',');
  if (pack.ghost) {   // 잔상: 구간(단계)마다 가운데 ghost 초 동안 최근 프레임을 겹쳐 흐리게 남겨요 (split → tmix → overlay). 이 필터 뒤에는 ','로 이어 붙일 수 있어요.
    const wins = clips.filter(c => c.duration >= 0.8).map(c => { const m = c.start + c.duration / 2; return `between(t,${n(m - pack.ghost / 2)},${n(m + pack.ghost / 2)})`; });
    if (wins.length) out += (out ? ',' : '') + `split[gha][ghb];[ghb]tmix=frames=9,format=yuva420p,colorchannelmixer=aa=0.7[ghc];[gha][ghc]overlay=0:0:enable='${wins.join('+')}'`;
  }
  return out;
}
// 효과음: 소리/효과음 폴더의 파일(팡·휙·쾅·띵 + 확장자)이 있으면 그걸, 없으면 ffmpeg 로 간단히 만들어요 (lavfi 입력 글)
export const SFX_SYNTH = {
  '팡': { d: 0.4, src: "aevalsrc='0.8*sin(2*PI*(170-220*t)*t)*exp(-10*t)+0.45*(2*random(0)-1)*exp(-45*t)':d=0.4:s=44100" },
  '쾅': { d: 0.8, src: "aevalsrc='0.9*sin(2*PI*(90-80*t)*t)*exp(-5*t)+0.5*(2*random(0)-1)*exp(-25*t)':d=0.8:s=44100" },
  '휙': { d: 0.3, src: 'anoisesrc=d=0.3:c=white:a=0.8:r=44100,bandpass=f=1800:width_type=h:w=1500,volume=3,afade=t=in:st=0:d=0.12,afade=t=out:st=0.14:d=0.16' },
  '띵': { d: 0.7, src: "aevalsrc='0.5*sin(2*PI*880*t)*exp(-5*t)+0.2*sin(2*PI*1760*t)*exp(-8*t)':d=0.7:s=44100" },
};

// ---------- 영어 자막(VTT) 읽기 ----------
const vttSecs = t => { const p = t.replace(',', '.').split(':').map(Number); return p.reduce((a, n) => a * 60 + n, 0); };
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
// 사용한 구간과 겹치는 자막만 모아서 [{range,text}]
export function transcriptFor(cues, ranges) {
  return ranges.map(range => {
    const [a, b] = rangeSecs(range);
    const parts = []; 
    for (const c of cues) if (c.start < b && c.end > a && parts[parts.length - 1] !== c.text) parts.push(c.text);
    return { range, text: parts.join(' ').replace(/\s+/g, ' ').trim() };
  });
}
// 영어 자막(VTT) 받기. 못 받아도 단계는 멈추지 않고 로그만 남겨요 (사용자가 멈춘 경우만 예외). 돌려주는 값 = 에피소드 폴더 안 상대 경로 ('' = 없음)
async function fetchSubs(E, url, id, ctx) {
  const dir = E.p('원본/자막');
  try {
    fs.mkdirSync(dir, { recursive: true });
    // 'en.*' 는 자동 번역 트랙까지 받다가 429 로 끝나기도 해서 en, en-orig 만 받아요. 오류 코드가 나와도 받아진 파일이 있으면 써요.
    try { await run(YTDLP, ['--no-playlist', '--no-warnings', '--skip-download', '--write-subs', '--write-auto-subs', '--sub-langs', 'en,en-orig', '--sub-format', 'vtt', '-o', path.join(dir, '%(id)s'), url], ctx); }
    catch (e) { if (e instanceof StopError) throw e; }
    const files = fs.readdirSync(dir).filter(f => f.startsWith(id + '.') && f.endsWith('.vtt'));
    const pick = files.find(f => f === `${id}.en.vtt`) || files.find(f => /\.en-orig\.vtt$/.test(f)) || files[0];
    if (!pick) throw new Error('자막 파일 없음');
    ctx.log(`  영어 자막을 받았어요: ${pick}`);
    return `원본/자막/${pick}`;
  } catch (e) {
    if (e instanceof StopError) throw e;
    ctx.log('  영어 자막을 못 받았어요 → 자막 자동화는 자막 없이 넘어가요');
    return '';
  }
}
// 내 파일(video.mp4) 옆의 자막 파일: video.vtt / video.en.vtt / video.srt
function sidecarSubs(file) {
  const base = file.replace(/\.[^./]+$/, '');
  return [base + '.vtt', base + '.en.vtt', base + '.srt'].find(exists) || '';
}
// 소스 하나의 영어 자막 줄들 [{start,end,text}] (없으면 [])
export function cuesOf(E, s) {
  const f = s.local ? sidecarSubs(localPath(s.url)) : (s.subFile ? E.p(s.subFile) : '');
  try { return f && exists(f) ? parseVtt(fs.readFileSync(f, 'utf8')) : []; } catch { return []; }
}
// 쓸 구간은 에피소드 상태가 기준 (컷 편집에서 바뀔 수 있어요). 예전 소스.json 의 구간은 대신 쓰는 값.
export const rangesFor = (E, si, s) => (E.s.sources[si]?.ranges?.length ? E.s.sources[si].ranges : (s?.ranges || []));
// 대본 프롬프트용: 쓸 구간의 영어 발언
const withTranscripts = (E, info) => info.map((s, si) => {
  const tr = transcriptFor(cuesOf(E, s), rangesFor(E, si, s)).filter(t => t.text);
  return tr.length ? { ...s, transcript: tr } : s;
});

// ---------- 결과 파일 목록 (client: outputs:[{path,exists}]) ----------
export function outputsFor(id, E) {
  const list = (dir, re) => { try { return fs.readdirSync(E.p(dir)).filter(f => re.test(f)).sort().map(f => `${dir}/${f}`); } catch { return []; } };
  switch (id) {
    case 'research': return ['소스.json'];
    case 'download': return list('원본', /^full_\d+\.[a-z0-9]+$/i);
    case 'clip': return list('클립', /\.mp4$/i);
    case 'script': return ['편집/대본.md', ...(exists(E.p('편집/대본-요청.txt')) ? ['편집/대본-요청.txt'] : [])];
    case 'plan': return ['편집/편집계획.json'];
    case 'rough': return ['편집/가편집.mp4'];
    case 'subs': return ['편집/자막본.mp4', ...(exists(E.p('편집/원본자막.ass')) ? ['편집/원본자막.ass'] : [])];
    case 'fx': return ['편집/완성본.mp4'];
    case 'mix': return ['편집/최종본.mp4'];
    case 'upload': return ['업로드/업로드.txt', '업로드/업로드.json', '업로드/영상.mp4', '업로드/썸네일.jpg'];
    default: return [];
  }
}

// ---------- 대본 읽기 ----------
export function parseScript(text) {
  return String(text || '').split(/\r?\n/).map(l => l.trim())
    .filter(l => l && !/^(#|>|<!--|---|\/\/)/.test(l))
    .map(l => l.replace(/^(\d+[.)]\s*|[-*•]\s+)/, '').trim()).filter(Boolean);
}
// 배너 줄: "> 배너: 작은 줄 / 큰 줄" → { small, big } (없으면 null)
export function parseBanner(text) {
  const m = /^\s*>\s*배너\s*[:：]\s*(.+?)\s*$/m.exec(String(text || '')); if (!m) return null;
  const i = m[1].indexOf('/'), small = i < 0 ? '' : m[1].slice(0, i).trim(), big = (i < 0 ? m[1] : m[1].slice(i + 1)).trim();
  return { small, big, raw: m[1].trim() };
}
// 제목으로 배너 대신 만들기: 단어 기준으로 반씩 (한 단어면 큰 줄만)
const cutWords = (s, n) => { let o = ''; for (const x of s.split(' ')) { if ([...(o ? o + ' ' + x : x)].length > n) { if (!o) o = [...x].slice(0, n).join(''); break; } o = o ? o + ' ' + x : x; } return o; };
// 훅 줄: "> 훅: 훅 제목" (없으면 null)
export function parseHook(text) { const m = /^\s*>\s*훅\s*[:：]\s*(.+?)\s*$/m.exec(String(text || '')); return m ? { text: m[1].trim(), raw: m[1].trim() } : null; }
// 출처 줄: "> 출처: United World Wrestling" (없으면 소스 채널 이름)
export function parseCredit(text) { const m = /^\s*>\s*출처\s*[:：]\s*(.+?)\s*$/m.exec(String(text || '')); return m ? m[1].trim() : ''; }
// 매트 스토리 룩의 표시 줄: "[태그] 큰 글 / 작은 글", "[점수] 4 : 0 / 쿠바 4 : 터키 0" (바로 다음 자막 줄에 붙어요, 녹음 줄은 아니에요)
export const MAT_DIRECTIVE = /^\[(태그|점수|도장)\]\s*(.*)$/;
const splitSlash = t => { const i = t.indexOf(' / '); return i < 0 ? { main: t.trim(), sub: '' } : { main: t.slice(0, i).trim(), sub: t.slice(i + 3).trim() }; };
export function matItems(lines) {
  const out = []; let pend = {};
  for (const raw of lines) {
    const m = MAT_DIRECTIVE.exec(String(raw).trim());
    if (m) { const v = splitSlash(m[2]); if (!v.main) continue; pend[m[1] === '태그' ? 'tag' : 'stamp'] = v; continue; }
    out.push({ ...parseLine(raw, 'mat'), ...pend }); pend = {};
  }
  if (out.length && (pend.tag || pend.stamp)) Object.assign(out[out.length - 1], pend);  // 끝에 남은 표시 줄은 마지막 자막에
  return out;
}
export const hookFromTitle = title => ({ text: cutWords(String(title || '').replace(/["'“”‘’「」『』]/g, '').replace(/\s+/g, ' ').trim(), 16) });
export function bannerFromTitle(title) {
  const t = String(title || '').replace(/["'“”‘’「」『』]/g, '').replace(/\s+/g, ' ').trim(), w = t.split(' ').filter(Boolean);
  const cut = cutWords;
  if (w.length < 2) return { small: '', big: cut(t, 16) };
  let best = 1, bd = 1e9;
  for (let k = 1; k < w.length; k++) { const d = Math.abs([...w.slice(0, k).join(' ')].length - [...w.slice(k).join(' ')].length); if (d < bd) { bd = d; best = k; } }
  return { small: cut(w.slice(0, best).join(' '), 16), big: cut(w.slice(best).join(' '), 16) };
}
// 대사 한 줄 읽기: "나레이션:"/"N:" 머리말, "한국어 | English", *강조*  (text = 별표 없는 한국어)
const stripHl = s => s.replace(/\*([^*\n]+)\*/g, '$1').replace(/\*/g, '').replace(/\s+/g, ' ').trim();
export function parseLine(raw, kind = 'banner') {
  let s = String(raw || '').trim(), narr = false;
  if (kind === 'mat') return { narr: false, ko: s, en: '', text: stripHl(s) };
  if (kind === 'punch') {  // "!그 순간!" = 펀치 한 단어, 영어 줄 없음
    const punch = s.startsWith('!'); if (punch) s = s.replace(/^!+\s*/, '');
    return { narr: false, punch, ko: s, en: '', text: stripHl(s) };
  }
  const m = /^(나레이션|N)\s*[:：]\s*/i.exec(s); if (m) { narr = true; s = s.slice(m[0].length); }
  const bar = s.search(/[|｜]/), ko = (bar < 0 ? s : s.slice(0, bar)).trim(), en = bar < 0 ? '' : s.slice(bar + 1).trim();
  return { narr, ko, en, text: stripHl(ko) || stripHl(en) };
}
// 붙여 넣은 대사 정리: 번호·글머리·따옴표 떼기 (POST /script 용)
export const SCRIPT_MAX_LINES = 30;
export function cleanPasted(text) {
  return parseScript(text).map(l => l.replace(/^["'“”‘’「『]+/, '').replace(/["'“”‘’」』]+$/, '').trim()).filter(Boolean);
}
export function checkScript(E) {
  const f = E.p('편집/대본.md');
  if (!exists(f)) throw new StepError('대본이 아직 없어요. "대본" 단계를 먼저 실행하세요.');
  const lines = parseScript(fs.readFileSync(f, 'utf8'));
  if (!lines.length) throw new StepError('대본에 대사가 한 줄도 없어요. 편집/대본.md 를 채워 주세요.');
  const bad = lines.findIndex(l => l.includes(PLACEHOLDER));
  if (bad >= 0) throw new StepError(`대본 ${bad + 1}번째 줄에 "${PLACEHOLDER}" 가 남아 있어요. 편집/대본.md 를 고치고 다시 눌러 주세요.`);
  const tag = /^\s*>\s*(배너|훅)\s*[:：].*\[여기에/m.exec(fs.readFileSync(f, 'utf8'));
  if (tag) throw new StepError(`${tag[1]} 줄에 "[여기에 …]" 가 남아 있어요. 편집/대본.md 의 "> ${tag[1]}:" 줄을 고쳐 주세요.`);
  return lines;
}

// ---------- 1. 소스 확인 (스튜디오 ③ 링크 영상 다운) ----------
async function research(E, ctx) {
  const srcs = E.s.sources;
  if (!srcs.length) throw new StepError('등록된 소스가 없어요. "이 에피소드에 소스 추가"로 영상 주소를 넣어 주세요.');
  const out = [];
  for (const [i, src] of srcs.entries()) {
    ctx.log(`소스 ${i + 1}/${srcs.length} 확인 중: ${src.url}`);
    const ranges = src.ranges.length ? parseRanges(src.ranges) : [];   // 구간은 ④ 컷 편집에서 정해요 (아직 없을 수 있어요)
    let info;
    if (isLocalSource(src.url)) {
      const f = localPath(src.url);
      if (!exists(f)) throw new StepError(`파일을 찾을 수 없어요: ${f}`);
      const pr = await probe(f, ctx);
      if (!pr.hasVideo) throw new StepError(`영상 파일이 아니에요: ${path.basename(f)}`);
      info = { url: src.url, local: true, title: path.basename(f), channel: '(내 파일)', duration: pr.duration, id: path.basename(f) };
    } else {
      let r;
      try { r = await run(YTDLP, ['-O', '%(.{id,title,channel,uploader,duration,webpage_url,license})j', '--no-playlist', '--no-warnings', src.url], ctx); }  // --dump-json 은 영상에 따라 10MB를 넘어 잘려요 → 필요한 칸만
      catch (e) { if (e instanceof StopError) throw e; throw new StepError(`yt-dlp가 이 영상을 받지 못했어요: ${lastLines(e.err) || e.message}`); }
      let j; try { j = JSON.parse(r.out.split('\n').filter(Boolean)[0]); } catch { throw new StepError('yt-dlp 응답을 읽지 못했어요.'); }
      info = { url: j.webpage_url || src.url, local: false, title: j.title, channel: j.channel || j.uploader || '', duration: j.duration ?? null, id: j.id, license: j.license || null };
    }
    for (const r of ranges) {
      const [, e] = rangeSecs(r);
      if (isFinite(e) && info.duration && e > info.duration + 0.5) throw new StepError(`구간 ${r} 이(가) 영상 길이(${fmtTime(info.duration)})를 넘어요.`);
    }
    ctx.log(`  제목: ${info.title} · 길이 ${info.duration ? fmtTime(info.duration) : '?'}${ranges.length ? ' · 구간 ' + ranges.join(', ') : ' · 구간은 컷 편집에서 정해요'}`);
    out.push({ ...info, ranges });
  }
  writeJson(E.p('소스.json'), out);
  ctx.log(`소스 ${out.length}개 확인 끝. 소스.json 저장.`);
}

// ---------- 2. 영상 받기: 링크 영상을 통째로 (+ 영어 자막) ----------
const SRC_FORMAT = 'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[ext=mp4]/b';
async function download(E, ctx) {
  const info = readJson(E.p('소스.json'));
  if (!info) throw new StepError('소스 확인이 먼저예요. "소스 확인" 단계를 실행하세요.');
  fs.mkdirSync(E.p('원본'), { recursive: true });
  for (const [si, s] of info.entries()) {
    if (s.local) { ctx.log(`소스 ${si + 1}/${info.length}: 내 파일이라 따로 받지 않아요.`); continue; }
    const prefix = `full_${si + 1}`;
    for (const f of fs.readdirSync(E.p('원본'))) if (f.startsWith(prefix + '.')) fs.rmSync(E.p('원본', f));
    ctx.log(`소스 ${si + 1}/${info.length} 영상 받는 중: ${s.title}${s.duration ? ` (${fmtTime(s.duration)})` : ''}`);
    try {
      await run(YTDLP, ['--no-playlist', '--no-warnings', '--newline', '-f', SRC_FORMAT, '--merge-output-format', 'mp4',
        '--ffmpeg-location', path.dirname(FFMPEG), '-o', E.p('원본', `${prefix}.%(ext)s`), s.url], { ...ctx, log: l => l && /download|Merg|ERROR/i.test(l) && ctx.log('  ' + l) }, { tee: true });
    } catch (e) { if (e instanceof StopError) throw e; throw new StepError(`yt-dlp가 이 영상을 받지 못했어요: ${lastLines(e.err) || e.message}`); }
    const got = fs.readdirSync(E.p('원본')).find(f => f.startsWith(prefix + '.') && !/\.part$|\.ytdl$/.test(f));
    if (!got) throw new StepError('받은 파일을 찾지 못했어요.');
    s.full = `원본/${got}`;
    s.subFile = await fetchSubs(E, s.url, s.id, ctx);
  }
  writeJson(E.p('소스.json'), info);
  ctx.log('영상 받기 끝.');
}

// ---------- 3. 구간 자르기 (스튜디오 ④ 컷 편집의 첫 단계) ----------
function clipFilter(E, speed = 1) {
  const f = clipFilter0(E);
  return speed < 1 ? f.replace(/^\[0:v\]/, `[0:v]setpts=${+(1 / speed).toFixed(4)}*PTS,`) : f;
}
function clipFilter0(E) {
  const { w, h } = specOf(E);
  const look = lookOf(E);
  if (look?.kind === 'mat') return `[0:v]scale=${w}:${look.footH}:force_original_aspect_ratio=increase,crop=${w}:${look.footH},fps=30,format=yuv420p,setsar=1[v]`;
  if (look?.kind === 'punch') return `[0:v]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,format=yuv420p,setsar=1[v]`;
  if (look) return `[0:v]scale=${w}:${h - look.bannerH}:force_original_aspect_ratio=increase,crop=${w}:${h - look.bannerH},fps=30,format=yuv420p,setsar=1[v]`;
  if (E.s.format === 'long') return `[0:v]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,fps=30,format=yuv420p,setsar=1[v]`;
  return `[0:v]split=2[a][b];[a]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},boxblur=40:6,eq=brightness=-0.12[bg];` +
    `[b]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,fps=30,format=yuv420p,setsar=1[v]`;
}
// 클립 번호(clip_NN) 순서 = 소스 순서 × 구간 순서. 이 목록으로 클립이 어느 소스의 어디였는지 알아요.
// 한 방 리얼 팩이면 맨 끝에 "마지막 2초 0.5배" 리플레이 클립을 하나 더 붙여요 (replay:true). 사용자가 적는 구간(E.s.sources)에는 들어가지 않아요.
// info(소스.json)가 있으면 "전체" 구간의 끝도 알아요. 마지막 클립이 2초보다 짧거나 이미 슬로우면 붙이지 않아요.
export const clipMap = (E, info) => {
  const map = E.s.sources.flatMap((s, si) => s.ranges.map(range => { const [a, b] = rangeSecs(range); return { si, range, a, b, speed: rangeSpeed(range) }; }));
  const last = map[map.length - 1];
  if (last && fxPackOf(E).replay && last.speed === 1) {
    const b = isFinite(last.b) ? last.b : Math.min(info?.[last.si]?.duration || 0, specOf(E).maxTotal);
    if (b - last.a >= 2) map.push({ si: last.si, range: `${fmtTime(b - 2)}-${fmtTime(b)}x0.5`, a: b - 2, b, speed: 0.5, replay: true });
  }
  return map;
};
// atempo 는 0.5~2 만 돼서 더 느리면 여러 번 이어요
const atempoChain = sp => { const out = []; let r = sp; while (r < 0.5 - 1e-9) { out.push('atempo=0.5'); r /= 0.5; } if (Math.abs(r - 1) > 1e-6) out.push(`atempo=${+r.toFixed(4)}`); return out.join(','); };
async function clip(E, ctx) {
  const info = readJson(E.p('소스.json'));
  if (!info) throw new StepError('소스 확인이 먼저예요. "소스 확인" 단계를 실행하세요.');
  const map = clipMap(E, info);
  if (!map.length) throw new StepError('구간이 아직 없어요. 컷 편집에서 쓸 구간을 먼저 넣어 주세요. (한 구간은 15초까지)');
  if (info.length !== E.s.sources.length) throw new StepError('소스가 바뀌었어요. 소스 확인부터 다시 실행하세요.');
  fs.mkdirSync(E.p('원본'), { recursive: true });
  fs.mkdirSync(E.p('클립'), { recursive: true });
  for (const f of fs.readdirSync(E.p('클립'))) if (/^clip_\d+\.mp4$/.test(f)) fs.rmSync(E.p('클립', f));
  const total = map.length;
  for (const [n0, m] of map.entries()) {
    const n = n0 + 1, s = info[m.si], a = m.a, b = isFinite(m.b) ? m.b : Math.min(s.duration || specOf(E).maxTotal, specOf(E).maxTotal), d = b - a, clipFile = E.p('클립', `clip_${String(n).padStart(2, '0')}.mp4`);
    if (s.duration && b > s.duration + 0.5) throw new StepError(`구간 ${m.range} 이(가) 영상 길이(${fmtTime(s.duration)})를 넘어요.`);
    ctx.log(`[${n}/${total}] ${s.title} ${m.range} 자르는 중…`);
    let input, offset;
    const fullF = s.local ? localPath(s.url) : (s.full && exists(E.p(s.full)) ? E.p(s.full) : '');
    if (fullF) { input = fullF; offset = a; }
    else {   // 예전 에피소드: 통영상이 없으니 구간 앞뒤 1초만 받아요
      const ps = Math.max(0, a - 1), pe = (s.duration ? Math.min(s.duration, b + 1) : b + 1), prefix = `s${m.si + 1}_${n}`;
      for (const f of fs.readdirSync(E.p('원본'))) if (f.startsWith(prefix + '.')) fs.rmSync(E.p('원본', f));
      ctx.log('  통영상이 없어서 이 구간만 받아요.');
      try {
        await run(YTDLP, ['--no-playlist', '--no-warnings', '--newline', '-f', SRC_FORMAT,
          '--merge-output-format', 'mp4', '--download-sections', `*${ps}-${pe}`, '--force-keyframes-at-cuts',
          '--ffmpeg-location', path.dirname(FFMPEG), '-o', E.p('원본', `${prefix}.%(ext)s`), s.url], { ...ctx, log: l => l && /download|Merg|ERROR/i.test(l) && ctx.log('  ' + l) }, { tee: true });
      } catch (e) { if (e instanceof StopError) throw e; throw new StepError(`yt-dlp가 이 영상을 받지 못했어요: ${lastLines(e.err) || e.message}`); }
      const got = fs.readdirSync(E.p('원본')).find(f => f.startsWith(prefix + '.') && !/\.part$|\.ytdl$/.test(f));
      if (!got) throw new StepError('받은 파일을 찾지 못했어요.');
      input = E.p('원본', got); offset = a - ps;
    }
    const sp = m.speed || 1, outD = d / sp;
    ctx.log(`  자르는 중 → ${path.basename(clipFile)} (${d}초${sp < 1 ? ` → 슬로우 ${sp}배 ${outD.toFixed(1)}초` : ''}, ${E.s.format === 'long' ? '가로' : '세로'})`);
    try {
      let fc = clipFilter(E, sp), aIn = [], aMap = ['-an'];
      if (keepsAudio(E)) {   // 원본 소리 살리기: 소리가 없는 영상이면 무음으로 채워서 클립마다 소리 칸이 꼭 있게 해요 (이어 붙이기 때문)
        const has = (await probe(input, ctx)).hasAudio, at = atempoChain(sp);
        if (has) fc += `;[0:a]aresample=44100,aformat=channel_layouts=stereo${at ? ',' + at : ''},atrim=0:${outD.toFixed(3)},asetpts=PTS-STARTPTS[a]`;
        else { aIn = ['-f', 'lavfi', '-t', outD.toFixed(3), '-i', 'anullsrc=r=44100:cl=stereo']; fc += `;[1:a]anull[a]`; }
        aMap = ['-map', '[a]', '-c:a', 'aac', '-b:a', '160k'];
      }
      await ff(['-ss', String(offset), '-t', String(d), '-i', input, ...aIn, '-filter_complex', fc, '-map', '[v]', ...aMap,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', clipFile], ctx);
    } catch (e) { if (e instanceof StopError) throw e; throw new StepError(`ffmpeg가 영상을 자르지 못했어요: ${lastLines(e.err)}`); }
    if (!exists(clipFile)) throw new StepError('구간을 자르지 못했어요(영상이 짧은가요?).');
  }
  ctx.log(`클립 ${total}개 완성.`);
}

// ---------- 대본 (게이트, 스튜디오 ⑦ 음악/녹음 안) ----------
async function clipDurations(E, ctx) {
  const files = outputsFor('clip', E);
  const out = [];
  for (const f of files) { const pr = await probe(E.p(f), ctx); out.push({ file: f, duration: pr.duration || 0 }); }
  return out;
}
const TRANSCRIPT_CAP = 3000;
export const promptFor = (E, info, clips, T) => {
  const nLines = Math.max(4, Math.min(9, Math.round(T / 5))), P = profileOf(E);
  const rules = [
    `한 줄 = 자막 한 장면. 정확히 ${nLines}줄 안팎, 한 줄은 25자 이내.`,
    '첫 줄은 시청자를 붙잡는 한 문장(질문이나 놀라운 사실).',
    '친구에게 말하듯 쉬운 말. 어려운 용어는 풀어서.',
    '확인되지 않은 기록·숫자는 쓰지 마.',
    ...P.rules,
    '번호, 따옴표, 머리말, 설명 없이 대사 줄만 출력해.',
  ];
  const look = lookOf(E);
  if (look?.kind === 'mat') {
    rules.splice(0, rules.length, ...MAT_RULES(Math.max(6, Math.min(16, Math.round(T / 3.2)))), ...P.rules);
  } else if (look?.kind === 'punch') {
    // 펀치 룩: 한국어 자막만 + "!" 펀치 줄 (훅 제목은 이펙트 단계)
    if (look.plain) rules.splice(0, rules.length, rules[0], rules[1], rules[2], rules[3], ...P.rules,   // 레퍼런스 레슬링 룩: 경기 해설이라 시사 규칙·영어 줄·펀치 줄은 빼요
      '줄마다 핵심 단어 1~2개를 *별표*로 감싸 (강조 색으로 나와요). 한 줄은 두 줄로 나뉘어 보여도 되게 20자 이내.',
      '번호, 따옴표, 머리말, 설명 없이 대사 줄만 출력해.');
    else rules.splice(0, rules.length, rules[0], rules[1], rules[2], rules[3], ...P.rules,
      '정책·주장·행동은 날카롭게 비판해도 되지만, 특정 국적·인종·종교의 사람들을 집단으로 조롱하거나 비하하지 마.',
      '대사 줄은 모두 한국어 자막이야. 영어 줄은 쓰지 마. 한 줄은 두 줄로 나뉘어 보여도 되게 24자 이내.',
      '장면이 확 바뀌는 순간에는 줄 맨 앞에 "!" 를 붙여 한 단어 펀치로 써 (예: "!그 순간!"). 전체에서 1~3개, 6자 이내.',
      '줄마다 핵심 단어 1~2개를 *별표*로 감싸 (노란색으로 강조돼요). 펀치 줄에는 안 써도 돼.',
      '번호, 따옴표, 머리말, 설명 없이 대사 줄만 출력해. (훅 제목은 이펙트 단계에서 영상 제목으로 따로 만들어요)');
  } else if (look) {
    // 배너 룩: 한국어·영어 두 줄 자막 형식으로 받아요
    rules.splice(0, rules.length, rules[0], rules[1], rules[2], rules[3],
      ...P.rules.map(r => (r.startsWith('나레이션과 자막은 모두 한국어로만') ? '나레이션과 한국어 자막은 모두 한국어로만 써. 영어는 "|" 뒤 영어 원문 칸에만 써.' : r)),
      '그다음 "나레이션: " 으로 시작하는 줄 1~2개. 설교자가 누구인지(이름·직함)와 이 영상이 말하는 핵심을 한국어로 소개해.',
      '그다음부터는 "한국어 | English original" 형식. 한국어는 설교자의 말을 뜻이 바뀌지 않게 충실히 옮기고, | 뒤 영어는 영어 원문 자막에 나온 문장 그대로 써. 영어를 지어내지 마. 영어 원문이 없으면 | 와 영어는 빼고 한국어만.',
      '줄마다 핵심 단어 1~2개를 *별표*로 감싸 (한국어·영어 모두).',
      '번호, 따옴표, 머리말, 설명 없이 대사 줄만 출력해. (배너 문구는 이펙트 단계에서 영상 제목으로 따로 만들어요)');
  }
  let said = '';
  if (P.transcript) {
    const parts = [];
    info.forEach((s, i) => (s.transcript || []).forEach(t => t.text && parts.push(`[소스 ${i + 1} · ${t.range}] ${t.text}`)));
    if (parts.length) {
      said = `\n영상 속 실제 발언 (영어 자동 자막, 오류가 있을 수 있음):\n${parts.join('\n').slice(0, TRANSCRIPT_CAP)}\n`;
      rules.splice(rules.length - 1, 0, '위 영상 속 발언을 인용할 때는 뜻이 바뀌지 않게 한국어로 충실하게 옮겨. 자막에 오류가 있어 보이면 단정하지 말고 넘어가.');
    }
  }
  const voice = String(E.s.voice || '').trim();
  return `너는 ${P.persona(E.s.format === 'long' ? '롱폼' : '쇼츠')}야.
아래 영상 클립에 얹을 짧은 나레이션 대본을 써 줘.

- 제목: ${E.s.title}
- 메모: ${E.s.note || '(없음)'}
${voice ? `- 채널 목소리: ${voice}\n` : ''}- 소스 영상: ${info.map(s => `${s.title} (${s.channel})`).join(' / ') || '(없음)'}
- 클립 길이: ${clips.map(c => c.duration.toFixed(1) + '초').join(', ')} (합계 약 ${T.toFixed(0)}초)
${said}
규칙:
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
};
// 매트 스토리 룩 대본 규칙 (대본 요청문·피드백 요청문이 같이 써요)
export const MAT_RULES = n => [
  '맨 첫 줄은 "> 배너: 위 줄 / 아랫줄" 형식의 제목 두 줄. 위 줄(노란 글씨)은 12자 안팎으로 놀라운 사실, 아랫줄(빨간 글씨)은 선수 별명·결과 + " ㄷㄷ". 예: > 배너: 15초 만에 130kg급을 / 들어 던진 5연패 ㄷㄷ',
  `그다음은 자막 줄. 영상 길이에 맞춰 약 ${n}줄, 한 줄 18자 이내. 친구한테 말하듯 반말 해설 ("~했어", "~지?", "~거든").`,
  '첫 자막 줄은 시청자를 붙잡는 한 문장. 마지막 줄은 다시 보고 싶게 ("자, 15초 만에 한 번 더.").',
  '줄마다 핵심 단어 1~2개를 *별표*로 감싸 (노란색으로 강조돼요).',
  '선수·대회를 소개할 자리 바로 앞에 "[태그] 선수 이름 (나라) / 대회 · 체급" 줄 1~2개. 예: [태그] 미하인 로페스 (쿠바) / 2016 리우 결승 · 130kg 그레코로만',
  '점수나 결과가 나오는 순간 바로 앞에 "[점수] 큰 글 / 작은 설명" 줄 1~2개. 예: [점수] 4 : 0 / 쿠바 4 : 터키 0 · 경기 시계 0:20 · 예: [점수] FALL / 1분 11초 폴승',
  '기술 설명은 "① 확 낮추기", "② 허리 감고 들기" 처럼 번호로 끊어도 좋아.',
  '확인되지 않은 기록·숫자는 쓰지 마. 모르면 빼.',
  '번호 매기기, 따옴표, 설명 없이 위 형식의 줄만 출력해.',
];
export async function callClaude(prompt, log) {
  const key = process.env.ANTHROPIC_API_KEY;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', signal: AbortSignal.timeout(60000),
    headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: process.env.FIELDNOTE_SCRIPT_MODEL || 'claude-sonnet-5-5', max_tokens: 1024, messages: [{ role: 'user', content: prompt }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error?.message || `HTTP ${r.status}`);
  return (j.content || []).map(c => c.text || '').join('\n');
}
async function script(E, ctx) {
  const info0 = readJson(E.p('소스.json'), []), info = profileOf(E).transcript ? withTranscripts(E, info0) : info0;
  const clips = exists(E.p('클립')) ? await clipDurations(E, ctx) : [];
  const T = Math.min(clips.reduce((a, c) => a + c.duration, 0) || 30, specOf(E).maxTotal);
  const f = E.p('편집/대본.md');
  fs.mkdirSync(E.p('편집'), { recursive: true });
  if (exists(f)) { fs.copyFileSync(f, E.p('편집/대본.bak.md')); ctx.log('이전 대본은 편집/대본.bak.md 로 백업했어요.'); }
  const prompt = promptFor(E, info, clips, T);
  let lines = null, aiRaw = '';
  if (process.env.ANTHROPIC_API_KEY) {
    ctx.log('Claude에게 대본을 부탁하는 중…');
    try {
      const txt = aiRaw = await callClaude(prompt);
      lines = parseScript(txt.replace(/^["“”]|["“”]$/gm, '')).slice(0, lookOf(E)?.kind === 'mat' ? SCRIPT_MAX_LINES : 14);
      if (!lines.length) throw new Error('빈 응답');
      ctx.log(`대본 ${lines.length}줄을 받았어요.`);
      fs.rmSync(E.p('편집/대본-요청.txt'), { force: true });
    } catch (e) { ctx.log(`Claude 호출 실패(${e.message}) → 빈 대본 양식으로 대신해요.`); lines = null; }
  } else ctx.log('ANTHROPIC_API_KEY 가 없어서 빈 대본 양식을 만들어요.');
  const head = `# ${E.s.title}\n> 한 줄 = 자막 한 장면(25자 안팎). "#"·">" 로 시작하는 줄은 무시돼요.\n` +
    (E.s.note ? E.s.note.split(/\r?\n/).filter(Boolean).map(l => `> 메모: ${l}`).join('\n') + '\n' : '') + '\n';
  const look = lookOf(E);
  if (lines) {
    const ban = look?.kind === 'mat' ? parseBanner(aiRaw) : null;   // 매트 룩: AI가 쓴 "> 배너:" 줄은 머리말에 남겨요
    fs.writeFileSync(f, head + (ban ? `> 배너: ${ban.raw}\n` : '') + lines.join('\n') + '\n');
  }
  else if (look?.kind === 'mat') {
    const n = Math.max(6, Math.min(14, Math.round(T / 3.2)));
    fs.writeFileSync(f, head + '> 아래 형식으로 채우세요. 자막 줄: 반말 해설 한 줄(18자 안팎). 강조할 단어는 *별표*로 감싸요 (노란색).\n' +
      '> [태그] 선수 (나라) / 대회 · 체급  → 왼쪽 위 빨간 이름표.   [점수] 4 : 0 / 쿠바 4 : 터키 0  → 큰 노란 도장. 둘 다 바로 다음 자막 줄에 붙어요.\n' +
      '> 슬로우는 구간 끝에 x0.5 를 붙여요 (예: 0:30-0:34x0.5).\n' +
      `> 배너: [여기에 위 줄] / [여기에 아랫줄] ㄷㄷ\n` + Array(n).fill(PLACEHOLDER).join('\n') + '\n');
    fs.writeFileSync(E.p('편집/대본-요청.txt'), prompt + '\n\n(받은 줄을 편집/대본.md 에 붙여 넣으세요.)\n');
    ctx.log('편집/대본-요청.txt 에 Claude 채팅용 요청문을 적어 뒀어요.');
  }
  else if (look?.kind === 'punch') {
    const n = Math.max(4, Math.min(8, Math.round(T / 4)));
    fs.writeFileSync(f, head + '> 아래 형식으로 채우세요. 자막 줄: 한국어 한 줄(24자 안팎). 강조할 단어는 *별표*로 감싸요 (노란색).\n' +
      '> 펀치 줄: 맨 앞에 !  (예: !그 순간!) → 한 단어를 크게 보여 줘요. 1~3개, 6자 안팎.\n' +
      '> 예시: 이 *정책*, 정말 괜찮을까요?\n> 예시: !그 순간!\n' + Array(n).fill(PLACEHOLDER).join('\n') + '\n');
    fs.writeFileSync(E.p('편집/대본-요청.txt'), prompt + '\n\n(받은 줄을 편집/대본.md 에 붙여 넣으세요.)\n');
    ctx.log('편집/대본-요청.txt 에 Claude 채팅용 요청문을 적어 뒀어요.');
  } else if (look) {
    const n = Math.max(3, Math.min(6, Math.round(T / 4)));
    fs.writeFileSync(f, head + '> 아래 형식으로 채우세요.\n' +
      '> 나레이션 줄: "나레이션: 설교자 소개" (처음 1~2줄, 흑백 화면에 큰 글씨로 나와요)\n' +
      '> 자막 줄: "한국어 | English original" (영어는 영상 속 실제 발언). 강조할 단어는 *별표*로 감싸요.\n' +
      '> 예시: 나레이션: 미국의 *목사* 팀 켈러가 말해요\n> 예시: 고통 속에서도 *하나님*은 함께하세요 | Even in suffering, *God* is with you.\n' +
      '나레이션: ' + PLACEHOLDER + '\n' + Array(n).fill(PLACEHOLDER + ' | [English original]').join('\n') + '\n');
    fs.writeFileSync(E.p('편집/대본-요청.txt'), prompt + '\n\n(받은 줄을 편집/대본.md 에 붙여 넣으세요.)\n');
    ctx.log('편집/대본-요청.txt 에 Claude 채팅용 요청문을 적어 뒀어요.');
  } else {
    const n = Math.max(3, Math.min(8, Math.round(T / 4)));
    fs.writeFileSync(f, head + '> 아래 줄을 지우고 대사로 바꾸세요. 또는 대본-요청.txt 를 Claude 채팅에 붙여 넣어 받은 줄을 여기에 붙이세요.\n' + Array(n).fill(PLACEHOLDER).join('\n') + '\n');
    fs.writeFileSync(E.p('편집/대본-요청.txt'), prompt + '\n\n(받은 대사 줄을 편집/대본.md 에 붙여 넣으세요.)\n');
    ctx.log('편집/대본-요청.txt 에 Claude 채팅용 요청문을 적어 뒀어요.');
  }
  E.s.gate = true;  // 사람이 읽고 /continue 로 넘겨야 함
  ctx.log('대본 확인 대기: 편집/대본.md 를 읽고 고친 뒤 "대본 확인 완료 · 계속"을 누르세요.');
}

// ---------- 피드백 (1차 편집을 보고 고칠 점 → 구간·대본 고치기) ----------
// 지금 대본 글: "> 배너:"·"> 출처:" 줄 + 대사 줄 (설명 머리말은 빼요)
export function draftText(E) {
  let t = ''; try { t = fs.readFileSync(E.p('편집/대본.md'), 'utf8'); } catch { return ''; }
  const keep = t.split(/\r?\n/).map(l => l.trim()).filter(l => /^>\s*(배너|훅|출처)\s*[:：]/.test(l));
  return [...keep, ...parseScript(t)].join('\n');
}
// Claude 답에서 "구간: …" 줄과 대본을 나눠요 (코드 블록 표시는 지워요)
export function splitAnswer(text) {
  let ranges = null; const out = [];
  for (const l of String(text || '').replace(/```[a-z]*\n?/gi, '').split(/\r?\n/)) {
    const m = /^\s*(?:\*\*)?구간(?:\*\*)?\s*[:：]\s*(.+?)\s*$/.exec(l);
    if (m) ranges = m[1]; else out.push(l);
  }
  return { ranges, text: out.join('\n').trim() };
}
export async function feedbackPrompt(E, feedback, ctx = {}) {
  const info = readJson(E.p('소스.json'), []), clips = exists(E.p('클립')) ? await clipDurations(E, ctx) : [];
  const T = Math.min(clips.reduce((a, c) => a + c.duration, 0) || 30, specOf(E).maxTotal), look = lookOf(E), P = profileOf(E);
  const cur = draftText(E), hasPh = !cur || cur.includes(PLACEHOLDER) || /\[여기에/.test(cur);
  const rng = E.s.sources.map((s, i) => `소스 ${i + 1} (${(info[i] && fmtTime(info[i].duration || 0)) || '?'}): ${s.ranges.join(', ') || '(없음)'}`).join('\n');
  const rules = look?.kind === 'mat' ? MAT_RULES(Math.max(6, Math.min(16, Math.round(T / 3.2)))) : ['한 줄 = 자막 한 장면, 25자 이내.', '확인되지 않은 기록·숫자는 쓰지 마.', '친구에게 말하듯 쉬운 말.'];
  return `너는 ${P.persona(E.s.format === 'long' ? '롱폼' : '쇼츠')}야.
1차 편집본을 본 내 피드백을 반영해서, 쓸 구간과 자막 대본을 고쳐 줘.

- 제목: ${E.s.title}
- 메모: ${E.s.note || '(없음)'}
- 소스 영상: ${info.map(s => `${s.title} (${s.channel})`).join(' / ') || '(없음)'}
- 지금 영상 길이: 약 ${T.toFixed(0)}초

지금 쓰는 구간 (한 구간 15초까지, 끝에 x0.5 를 붙이면 0.5배 슬로우):
${rng}

지금 대본:
${hasPh ? '(아직 없음 → 새로 써 줘)' : cur}

내 피드백:
${String(feedback || '').trim() || '(없음 → 더 재밌고 잘 보이게 다듬어 줘)'}

출력 형식 (이 형식 그대로, 다른 설명 없이):
구간: 0:30-0:42, 1:05-1:09x0.5   ← 구간을 안 바꿔도 지금 구간을 그대로 적어 줘. 소스가 여러 개면 첫 소스 구간만.
그다음 줄부터 대본.

대본 규칙:
${rules.map((r, i) => `${i + 1}. ${r}`).join('\n')}`;
}

// ---------- 4. 편집 계획 (대본 없이: 구간·클립만) ----------
// 나레이션 줄이 보이는 구간들 (이어진 줄은 하나로 합쳐요) → [[시작,끝],...]
export function bwSpans(L) {
  const out = [];
  for (const l of L) if (l.narr) { const p = out[out.length - 1]; if (p && Math.abs(p[1] - l.start) < 0.011) p[1] = l.end; else out.push([l.start, l.end]); }
  return out;
}
async function plan(E, ctx) {
  const look = lookOf(E), clips = await clipDurations(E, ctx);
  if (!clips.length) throw new StepError('클립이 없어요. "구간 자르기"를 먼저 실행하세요.');
  const map = clipMap(E, readJson(E.p('소스.json'), [])), max = specOf(E).maxTotal;
  let T = 0; const used = [];
  for (const c of clips) {
    if (T >= max - 0.05) break;
    const d = Math.min(c.duration, max - T); if (d < 0.2) continue;
    const m0 = map[(+/clip_(\d+)/.exec(c.file)?.[1] || 0) - 1], m = m0 && !isFinite(m0.b) ? { ...m0, b: m0.a + c.duration } : m0;   // "전체"는 실제 길이로   // 이 클립이 소스의 어디였는지 (자막 자동화가 써요)
    used.push({ file: c.file, start: +T.toFixed(3), duration: +d.toFixed(3), ...(m ? { si: m.si, range: m.range, a: m.a, b: m.b, ...(m.speed < 1 ? { speed: m.speed } : {}), ...(m.replay ? { replay: true } : {}) } : {}) }); T += d;
  }
  const P = { title: E.s.title, format: E.s.format, width: specOf(E).w, height: specOf(E).h, total: +T.toFixed(2), clips: used, lines: [] };
  if (look) P.look = look;
  writeJson(E.p('편집/편집계획.json'), P);
  for (const u of used) ctx.log(`  ${u.start.toFixed(1)}~${(u.start + u.duration).toFixed(1)}초 · ${path.basename(u.file)}${u.range ? ' · 원본 ' + u.range : ''}`);
  ctx.log(`편집 계획 완성: 클립 ${used.length}개 · 총 ${T.toFixed(1)}초${look ? ' · ' + ({ punch: '펀치 룩', mat: '매트 스토리 룩' }[look.kind] || '배너 룩') : ' · 기본 룩'}`);
  relayout(E, ctx);
}

// ---------- 대본 줄 → 시간표 (대본을 확인한 뒤, 녹음 전에) ----------
const spread = (items, t0, t1) => {   // 글자 수에 비례해 줄마다 시간 배분(최소 1.2초), 마지막 줄은 끝까지
  if (!items.length) return [];
  const weights = items.map(l => Math.max(4, [...l.text].length)), sumW = weights.reduce((a, b) => a + b, 0), span = t1 - t0;
  const minD = Math.min(1.2, span / items.length), spare = Math.max(0, span - minD * items.length);
  let t = t0;
  return items.map((it, i) => { const d = minD + spare * weights[i] / sumW, start = t; t += d; return { start, end: i === items.length - 1 ? t1 : t }; });
};
export function layoutLines(E, ctx) {
  const lines = checkScript(E), look = lookOf(E), P = readJson(E.p('편집/편집계획.json'));
  if (!P) throw new StepError('컷 편집이 먼저예요. "편집 계획"을 만들어 주세요.');
  const items = look?.kind === 'mat' ? matItems(lines) : look ? lines.map(l => parseLine(l, look.kind)) : lines.map(text => ({ text })), T = P.total;
  if (!items.length) throw new StepError('대본에 자막 줄이 없어요. [태그]·[점수] 줄 말고 자막 줄도 넣어 주세요.');
  const intro = look?.kind === 'banner' && P.bw?.[0] ? P.bw[0][1] : 0;   // 이펙트의 흑백 인트로 안에 나레이션 줄을 먼저 보여 줘요
  let lead = 0; if (intro) while (lead < items.length && items[lead].narr) lead++;
  const timed = lead && lead < items.length ? [...spread(items.slice(0, lead), 0, intro), ...spread(items.slice(lead), intro, T)] : spread(items, 0, T);
  P.lines = items.map((it, i) => {
    const { start, end } = timed[i], clipI = P.clips.findIndex(u => start >= u.start - 1e-6 && start < u.start + u.duration - 1e-6);
    const o = { i, text: it.text, start: +start.toFixed(2), end: +end.toFixed(2), clip: Math.max(0, clipI) };
    if (look) Object.assign(o, { ko: it.ko, en: it.en, narr: it.narr, ...(look.kind === 'punch' ? { punch: !!it.punch } : {}), ...(it.tag ? { tag: it.tag } : {}), ...(it.stamp ? { stamp: it.stamp } : {}) });
    return o;
  });
  writeJson(E.p('편집/편집계획.json'), P);
  ctx?.log?.(`대본 ${P.lines.length}줄을 영상(${T.toFixed(1)}초)에 배분했어요.`);
  return P.lines;
}
// 대본이 이미 확인돼 있으면(예전 에피소드·다시 실행) 시간표를 자동으로 다시 짜요
function relayout(E, ctx) {
  if (E.s.steps?.script?.status !== 'done' || E.s.gate) return;
  try { layoutLines(E, ctx); } catch (e) { ctx.log(`  대본 시간표는 나중에 다시 짜요: ${e.message}`); }
}

// ---------- 5. 가편집 ----------
async function rough(E, ctx) {
  const P = readJson(E.p('편집/편집계획.json'));
  if (!P) throw new StepError('편집 계획이 먼저예요.');
  const listFile = E.p('편집/concat.txt');
  fs.writeFileSync(listFile, P.clips.map(c => `file '${E.p(c.file).replace(/'/g, "'\\''")}'\n`).join(''));
  ctx.log(`클립 ${P.clips.length}개를 이어 붙이는 중…`);
  try {
    const aud = keepsAudio(E) ? ['-c:a', 'aac', '-b:a', '160k'] : ['-an'];
    await ff(['-f', 'concat', '-safe', '0', '-i', listFile, '-t', String(P.total), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p', ...aud, '-movflags', '+faststart', E.p('편집/가편집.mp4')], ctx);
  } catch (e) { if (e instanceof StopError) throw e; throw new StepError(`ffmpeg가 이어 붙이지 못했어요: ${lastLines(e.err)}`); }
  fs.rmSync(listFile, { force: true });
  ctx.log('가편집.mp4 완성.');
}

// ---------- 6. 자막·효과 ----------
const assTime = s => { const cs = Math.round(s * 100), h = Math.floor(cs / 360000), m = Math.floor(cs % 360000 / 6000), sec = Math.floor(cs % 6000 / 100); return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };
function wrapKo(text, max) {
  const words = text.split(/\s+/), lines = []; let cur = '';
  for (const w of words) {
    if (!cur) cur = w; else if ([...cur + ' ' + w].length <= max) cur += ' ' + w; else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines.flatMap(l => { const a = [...l], o = []; for (let i = 0; i < a.length; i += max + 2) o.push(a.slice(i, i + max + 2).join('')); return o; });
}
const assEsc = s => s.replace(/[{}\\]/g, '').replace(/\r?\n/g, '\\N');
// 강조(*단어*)를 색으로: 표시를 먼저 글자로 바꿔 두고 줄바꿈한 뒤 ASS 색 코드로
const hexBgr = h => { const x = (/^#?([0-9a-f]{6})$/i.exec(h) || [0, 'FFFFFF'])[1].toUpperCase(); return x.slice(4, 6) + x.slice(2, 4) + x.slice(0, 2); };
function hlText(raw, wrapAt, accent, pop = false, base = 'FFFFFF') {   // pop: 강조 단어가 커졌다 제자리로 (이펙트 팩 '펀치')
  const marked = String(raw || '').replace(/\*([^*\n]+)\*/g, '\u0001$1\u0002').replace(/\*/g, '');
  return assEsc(wrapKo(marked, wrapAt).join('\n')).replace(/\u0001/g, `{\\c&H${hexBgr(accent)}&${pop ? '\\fscx125\\fscy125\\t(0,160,\\fscx100\\fscy100)' : ''}}`).replace(/\u0002/g, `{\\c&H${base}&}`);
}
// 자막 뒤 상자: 글자 폭을 어림해서 크기를 정하고, 둥근 모서리 ASS 도형으로 그려요. 색은 look.bg(또는 검정) + 투명도 boxAlpha
const chW = (c, fs) => (/\s/.test(c) ? 0.3 : c.charCodeAt(0) > 0x2e80 ? 0.95 : /[A-Z]/.test(c) ? 0.68 : 0.58) * fs;
const lineW = (t, fs) => [...t].reduce((a, c) => a + chW(c, fs), 0);
const plainLines = (raw, wrapAt) => wrapKo(String(raw || '').replace(/\*/g, ''), wrapAt);
function boxEv(L, a, e, cx, y0, w, h, color) {
  const x = Math.round(cx - w / 2), y = Math.round(y0), W = Math.round(w), H = Math.round(h), r = Math.min(L.boxR, Math.floor(H / 2));
  const d = `m ${x + r} ${y} l ${x + W - r} ${y} b ${x + W} ${y} ${x + W} ${y} ${x + W} ${y + r} l ${x + W} ${y + H - r} b ${x + W} ${y + H} ${x + W} ${y + H} ${x + W - r} ${y + H} l ${x + r} ${y + H} b ${x} ${y + H} ${x} ${y + H} ${x} ${y + H - r} l ${x} ${y + r} b ${x} ${y} ${x} ${y} ${x + r} ${y}`;
  return `Dialogue: 0,${assTime(a)},${assTime(e)},Bar,,0,0,0,,{\\p1\\pos(0,0)\\bord0\\shad0\\1c&H${hexBgr(color)}&\\1a&H${L.boxAlpha.toString(16).toUpperCase().padStart(2, '0')}&}${d}`;
}
// part: 'all' = 전부(예전과 같음) / 'fx' = 배너·훅·워터마크·제목 카드(이펙트 단계) / 'lines' = 대본 줄 자막(음악·녹음 단계)
function buildBannerAss(P, part = 'all') {
  const L = P.look, W = P.width, H = P.height, BH = L.bannerH, ac = L.accent, midY = Math.round(BH + (H - BH) / 2), C = Math.round(W / 2);
  const fit = (text, fs) => Math.max(36, Math.min(fs, Math.floor((W - 120) / Math.max(1, [...text].length))));
  const ev = [], end = assTime(P.total), b = P.banner || { small: '', big: '' };
  const bar = Math.round(BH * 0.47), fxOn = part !== 'lines', lnOn = part !== 'fx';
  if (fxOn && b.small) ev.push(`Dialogue: 2,${assTime(0)},${end},BanS,,0,0,0,,{\\an5\\pos(${C},${Math.round(BH * 0.30)})\\fs${fit(b.small, L.smallFs)}}${assEsc(b.small)}`);
  if (fxOn) ev.push(`Dialogue: 2,${assTime(0)},${end},Bar,,0,0,0,,{\\p1\\pos(0,0)\\bord0\\shad0}m ${C - 80} ${bar} l ${C + 80} ${bar} l ${C + 80} ${bar + 3} l ${C - 80} ${bar + 3}`);
  if (fxOn && b.big) ev.push(`Dialogue: 2,${assTime(0)},${end},BanB,,0,0,0,,{\\an5\\pos(${C},${Math.round(BH * 0.72)})\\fs${fit(b.big, L.bigFs)}}${assEsc(b.big)}`);
  for (const l of lnOn ? P.lines : []) {
    const ly = L.subBox ? 1 : 0;  // 상자가 있으면 상자는 0층, 글자는 1층
    if (l.narr) {
      if (L.subBox) {
        const ls = plainLines(l.ko ?? l.text, 9), h = Math.max(L.boxMinH, ls.length * L.narrFs * L.boxLineH + 2 * L.boxPad);
        ev.push(boxEv(L, l.start, l.end, C, midY - h / 2, Math.max(L.boxMinW, Math.max(...ls.map(t => lineW(t, L.narrFs))) + 2 * L.boxPad), h, L.bg));
      }
      ev.push(`Dialogue: ${ly},${assTime(l.start)},${assTime(l.end)},Narr,,0,0,0,,{\\an5\\pos(${C},${midY})}${hlText(l.ko ?? l.text, 9, ac, !!P.fxPop)}`);
    } else {
      const showEn = L.bilingual && l.en && !P.srcSubs;
      let at = '';
      const en = showEn ? `\\N{\\fs${L.enFs}\\b0\\bord3\\shad1}${hlText(l.en, 28, ac)}` : '';
      if (L.subBox) {  // 한국어 + 영어를 상자 하나로
        const ks = plainLines(l.ko ?? l.text, 13), es = showEn ? plainLines(l.en, 28) : [];
        const th = (ks.length * L.koFs + es.length * L.enFs) * L.boxLineH, tw = Math.max(...ks.map(t => lineW(t, L.koFs)), ...es.map(t => lineW(t, L.enFs)));
        const h = Math.max(L.boxMinH, th + 2 * L.boxPad);  // 최소 높이: 영상에 박힌 자막 두 줄쯤은 덮어요
        ev.push(boxEv(L, l.start, l.end, C, L.subCy - h / 2, Math.max(L.boxMinW, tw + 2 * L.boxPad), h, L.bg));
        at = `{\\an8\\pos(${C},${Math.round(L.subCy - th / 2)})}`;  // 글자는 상자 안 세로 가운데
      }
      ev.push(`Dialogue: ${ly},${assTime(l.start)},${assTime(l.end)},Sub,,0,0,0,,${at}${hlText(l.ko ?? l.text, 13, ac, !!P.fxPop)}${en}`);
    }
  }
  const sty = (n, fs, col, bold, bord, sh, al, mv) => `Style: ${n},${FONT_NAME},${fs},&H00${col},&H000000FF,&H00000000,&H80000000,${bold},0,0,0,100,100,0,0,1,${bord},${sh},${al},60,60,${mv},1`;
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${sty('Sub', L.koFs, 'FFFFFF', 1, 6, 2, 8, L.subTop)}
${sty('Narr', L.narrFs, 'FFFFFF', 1, 7, 3, 5, 0)}
${sty('BanS', L.smallFs, 'FFFFFF', 0, 0, 0, 5, 0)}
${sty('BanB', L.bigFs, hexBgr(ac), 1, 0, 0, 5, 0)}
${sty('Bar', 20, hexBgr(ac), 0, 0, 0, 7, 0)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join('\n')}
`;
}
function buildPunchAss(P, part = 'all') {
  const L = P.look, W = P.width, H = P.height, C = Math.round(W / 2), ac = L.accent, y = f => Math.round(H * f);
  const font = L.font || FONT_NAME, pfont = L.punchFont || font, end = assTime(P.total), hd = P.hook?.dur || 0;
  const ev = [], fxOn = part !== 'lines', lnOn = part !== 'fx', capCol = hexBgr(L.capColor || '#FFFFFF');
  if (fxOn && P.hook?.text && hd > 0) {
    const hl = wrapKo(P.hook.text, L.hookWrap || 7).slice(0, 2);
    if (L.hookBox) {   // 단계 룩: 검은 상자 위 흰 글씨 (위쪽)
      const bw = Math.min(W - 40, Math.max(...hl.map(t => lineW(t, L.hookFs) * 0.9)) + 70), bh = hl.length * L.hookFs * 1.15 + 44;
      ev.push(boxEv({ ...L, boxAlpha: 0x10 }, 0, hd, C, y(L.hookY) - bh / 2, bw, bh, '#000000'));
    }
    ev.push(`Dialogue: 2,${assTime(0)},${assTime(hd)},Hook,,0,0,0,,{\\an5\\pos(${C},${y(L.hookY)})}${assEsc(hl.join('\n'))}`);
  }
  for (const l of lnOn ? P.lines : []) {
    const a = Math.max(l.start, hd); if (a >= l.end - 0.01) continue;  // 훅이 나오는 동안은 자막을 쉬어요
    if (l.punch) ev.push(`Dialogue: 1,${assTime(a)},${assTime(l.end)},Punch,,0,0,0,,{\\an5\\pos(${C},${y(L.punchY)})\\frz${L.punchRot}\\fscx130\\fscy130\\t(0,120,\\fscx100\\fscy100)}${hlText(l.ko ?? l.text, 6, ac, !!P.fxPop, capCol)}`);
    else {
      if (L.subBox) {
        const ls = plainLines(l.ko ?? l.text, 11), h = Math.max(L.boxMinH, ls.length * L.capFs * L.boxLineH + 2 * L.boxPad);
        ev.push(boxEv(L, a, l.end, C, y(L.capY) - h / 2, Math.max(L.boxMinW, Math.max(...ls.map(t => lineW(t, L.capFs))) + 2 * L.boxPad), h, L.bg || '#000000'));
      }
      ev.push(`Dialogue: ${L.subBox ? 1 : 0},${assTime(a)},${assTime(l.end)},Cap,,0,0,0,,{\\an5\\pos(${C},${y(L.capY)})}${hlText(l.ko ?? l.text, 11, ac, !!P.fxPop, capCol)}`);
    }
  }
  if (fxOn && L.watermark) ev.push(`Dialogue: 3,${assTime(0)},${end},WM,,0,0,0,,{\\an7\\pos(${L.wmX},${L.wmY})\\frz4\\alpha&H40&}${assEsc(L.watermark)}`);
  const sty = (n, f, fs, col, bord, sh, al, it = 0) => `Style: ${n},${f},${fs},&H00${col},&H000000FF,&H00000000,&H96000000,1,${it},0,0,100,100,0,0,1,${bord},${sh},${al},60,60,0,1`;
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${sty('Hook', font, L.hookFs, hexBgr(L.hookColor || ac), L.hookBox ? 0 : L.hookBord, L.hookBox ? 0 : 2, 5)}
${sty('Cap', font, L.capFs, capCol, L.capBord, 3, 5, L.capItalic ? -1 : 0)}
${sty('Punch', pfont, L.punchFs, capCol, L.capBord + 2, 4, 5)}
${sty('WM', font, L.wmFs, 'FFFFFF', 2, 1, 7)}
${L.subBox || L.hookBox ? sty('Bar', font, 20, 'FFFFFF', 0, 0, 7) + '\n' : ''}
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join('\n')}
`;
}
// 매트 스토리 룩. 'fx' = 제목 두 줄·출처·워터마크·SLOW 표시 / 'lines' = 자막·선수 태그·점수 도장
const assAlpha = a => '&H' + a.toString(16).toUpperCase().padStart(2, '0') + '&';
function rectEv(layer, a, e, x, y, w, h, color, alpha = 0, r = 6) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h); r = Math.min(r, Math.floor(h / 2));
  const d = `m ${x + r} ${y} l ${x + w - r} ${y} b ${x + w} ${y} ${x + w} ${y} ${x + w} ${y + r} l ${x + w} ${y + h - r} b ${x + w} ${y + h} ${x + w} ${y + h} ${x + w - r} ${y + h} l ${x + r} ${y + h} b ${x} ${y + h} ${x} ${y + h} ${x} ${y + h - r} l ${x} ${y + r} b ${x} ${y} ${x} ${y} ${x + r} ${y}`;
  return `Dialogue: ${layer},${assTime(a)},${assTime(e)},Box,,0,0,0,,{\\p1\\pos(0,0)\\bord0\\shad0\\1c&H${hexBgr(color)}&\\1a${assAlpha(alpha)}}${d}`;
}
const matW = (t, fs) => lineW(t, fs) * 0.9;   // 굵은 한글 글꼴 폭 어림 (배너 룩보다 조금 좁게)
function buildMatAss(P, part = 'all') {
  const L = P.look, W = P.width, H = P.height, C = Math.round(W / 2), ac = L.accent, font = L.font || FONT_NAME, end = assTime(P.total);
  const ev = [], fxOn = part !== 'lines', lnOn = part !== 'fx', heavy = '\\b800';
  if (fxOn) {
    const b = P.banner || { small: '', big: '' }, rows = [b.small, b.big].filter(Boolean);
    const fit = t => Math.max(40, Math.min(L.titleFs, Math.floor(L.titleFs * (W - 70) / Math.max(1, matW(t, L.titleFs)))));
    const ys = rows.length === 2 ? [L.titleY1, L.titleY2] : [Math.round((L.titleY1 + L.titleY2) / 2)], cols = rows.length === 2 ? [L.c1, L.c2] : [L.c1];
    rows.forEach((t, i) => ev.push(`Dialogue: 2,${assTime(0)},${end},Title,,0,0,0,,{\\an5\\pos(${C},${ys[i]})\\fs${fit(t)}\\1c&H${hexBgr(cols[i])}&${heavy}}${assEsc(t)}`));
    if (P.credit) ev.push(`Dialogue: 2,${assTime(0)},${end},Credit,,0,0,0,,{\\an5\\pos(${C},${L.creditY})}{\\1c&HBBBBBB&\\b0}영상: {\\1c&HFFFFFF&\\b1}${assEsc(P.credit)}`);
    if (L.watermark) { const [w1, ...w2] = String(L.watermark).split(' ');
      ev.push(`Dialogue: 3,${assTime(0)},${end},WM,,0,0,0,,{\\an3\\pos(${L.wmX},${L.wmY})\\fscx78}${assEsc(w1)}${w2.length ? ` {\\1c&H${hexBgr(ac)}&}${assEsc(w2.join(' '))}` : ''}`); }
    for (const c of P.clips || []) {   // 슬로우 구간에는 오른쪽 위에 SLOW 0.5x
      if (!(c.speed < 1) || c.replay) continue;   // 리플레이 클립은 REPLAY 표시가 대신해요
      const a = c.start, e = c.start + c.duration, t = `SLOW ${c.speed}x`, bw = matW(t, L.slowFs) * 0.82 + 44;
      ev.push(rectEv(3, a, e, L.slowRight - bw, L.slowY, bw, L.slowH, ac, 0, 4));
      ev.push(`Dialogue: 4,${assTime(a)},${assTime(e)},Slow,,0,0,0,,{\\an5\\pos(${Math.round(L.slowRight - bw / 2)},${Math.round(L.slowY + L.slowH / 2)})\\fscx82}${assEsc(t)}`);
    }
  }
  if (lnOn) {
    const lines = P.lines || [];
    lines.forEach((l, k) => {
      ev.push(`Dialogue: 1,${assTime(l.start)},${assTime(l.end)},Cap,,0,0,0,,{\\an8\\pos(${C},${L.capY})${heavy}}${hlText(l.ko ?? l.text, L.capWrap, ac, !!P.fxPop)}`);
      if (l.tag) {   // 선수 태그: 다음 태그가 나오거나 tagDur 초가 지날 때까지
        const nx = lines.slice(k + 1).find(x => x.tag), e = Math.min(P.total, Math.max(l.end, Math.min(l.start + L.tagDur, nx ? nx.start : P.total)));
        const w1 = matW(l.tag.main, L.tagFs) + 48;
        ev.push(rectEv(3, l.start, e, L.tagX, L.tagY, w1, L.tagH, L.tagBg, 0, 4));
        ev.push(`Dialogue: 4,${assTime(l.start)},${assTime(e)},Tag,,0,0,0,,{\\an4\\pos(${L.tagX + 24},${Math.round(L.tagY + L.tagH / 2)})}${assEsc(l.tag.main)}`);
        if (l.tag.sub) {
          const y2 = L.tagY + L.tagH + 12, w2 = matW(l.tag.sub, L.tagSubFs) + 36;
          ev.push(rectEv(3, l.start, e, L.tagX, y2, w2, L.tagSubH, '#000000', 0x50, 4));
          ev.push(`Dialogue: 4,${assTime(l.start)},${assTime(e)},TagS,,0,0,0,,{\\an4\\pos(${L.tagX + 18},${Math.round(y2 + L.tagSubH / 2)})}${assEsc(l.tag.sub)}`);
        }
      }
      if (l.stamp) {   // 점수·결과 도장: 크게 튀어나왔다가 제자리
        const fs = Math.max(90, Math.min(L.stampFs, Math.floor(L.stampFs * (W - 140) / Math.max(1, lineW(l.stamp.main, L.stampFs) * 0.8))));
        ev.push(`Dialogue: 5,${assTime(l.start)},${assTime(l.end)},Stamp,,0,0,0,,{\\an2\\pos(${C},${L.stampY})\\fs${fs}\\frz${L.stampRot}\\fscx80\\fscy110\\t(0,140,\\fscx100\\fscy100)${heavy}}${assEsc(l.stamp.main)}`);
        if (l.stamp.sub) ev.push(`Dialogue: 5,${assTime(l.start)},${assTime(l.end)},StampS,,0,0,0,,{\\an8\\pos(${C + 10},${L.stampY + 6})\\frz${L.stampRot}${heavy}}${assEsc(l.stamp.sub)}`);
      }
    });
  }
  const sty = (n, fs, col, bord, sh, al, bold = -1) => `Style: ${n},${font},${fs},&H00${col},&H000000FF,&H00000000,&H96000000,${bold},0,0,0,100,100,0,0,1,${bord},${sh},${al},40,40,0,1`;
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${sty('Title', L.titleFs, hexBgr(L.c1), 0, 0, 5)}
${sty('Credit', L.creditFs, 'FFFFFF', 2, 0, 5)}
${sty('WM', L.wmFs, 'FFFFFF', 3, 1, 3)}
${sty('Slow', L.slowFs, '000000', 0, 0, 5)}
${sty('Box', 20, 'FFFFFF', 0, 0, 7, 0)}
${sty('Cap', L.capFs, 'FFFFFF', L.capBord, 2, 8)}
${sty('Tag', L.tagFs, 'FFFFFF', 0, 0, 4)}
${sty('TagS', L.tagSubFs, 'FFFFFF', 0, 0, 4)}
${sty('Stamp', L.stampFs, hexBgr(L.c1), L.stampBord, 3, 2)}
${sty('StampS', L.stampSubFs, 'FFFFFF', 6, 2, 8)}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join('\n')}
`;
}
// ---------- 이펙트 팩 글자·도형 (룩의 영상 칸 안에, 룩 ASS 위에 얹어요) ----------
// 영상 칸: 기본·펀치 = 전체 / 배너 = 배너 아래 / 매트 = footY~footY+footH
const videoArea = P => { const L = P.look; if (L && P.height > P.width) { if (L.kind === 'mat') return { y0: L.footY, h: L.footH }; if (L.kind === 'banner') return { y0: L.bannerH, h: P.height - L.bannerH }; } return { y0: 0, h: P.height }; };
// 룩의 대본 자막 자리 (말자막이 같은 자리에 나와요): an = ASS 정렬, y = 세로 px
const capPos = P => { const L = P.look, H = P.height; if (L && H > P.width) { if (L.kind === 'mat') return { an: 8, y: L.capY }; if (L.kind === 'banner') return { an: 8, y: L.subTop }; if (L.kind === 'punch') return { an: 5, y: Math.round(H * L.capY) }; } return { an: 2, y: H - 460 }; };
const rrPath = (x, y, w, h, r) => { x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h); r = Math.min(r, Math.floor(h / 2));
  return `m ${x + r} ${y} l ${x + w - r} ${y} b ${x + w} ${y} ${x + w} ${y} ${x + w} ${y + r} l ${x + w} ${y + h - r} b ${x + w} ${y + h} ${x + w} ${y + h} ${x + w - r} ${y + h} l ${x + r} ${y + h} b ${x} ${y + h} ${x} ${y + h} ${x} ${y + h - r} l ${x} ${y + r} b ${x} ${y} ${x} ${y} ${x + r} ${y}`; };
// ✕ / ✓ 아이콘 도형 (가운데 0,0, 반지름 100 × k)
const iconPath = (kind, k) => { const p = kind === 'x' ? [[-55, -100], [0, -45], [55, -100], [100, -55], [45, 0], [100, 55], [55, 100], [0, 45], [-55, 100], [-100, 55], [-45, 0], [-100, -55]]
  : [[-100, 0], [-62, -38], [-30, -6], [60, -96], [98, -58], [-30, 70]]; return 'm ' + p.map(([x, y]) => `${Math.round((x + 100) * k)} ${Math.round((y + 100) * k)}`).join(' l '); };   // libass 는 도형을 (0,0)~오른쪽 아래 칸 기준으로 맞추니, 좌표를 전부 양수로 두어야 \\an5 가 도형 가운데예요
const pst = (n, fs, col, { bold = -1, italic = 0, bord = 0, sh = 0, al = 5, out = '000000' } = {}) => `Style: ${n},${FONT_NAME},${fs},&H00${col},&H000000FF,&H00${out},&H96000000,${bold},${italic},0,0,100,100,0,0,1,${bord},${sh},${al},40,40,0,1`;
// 팩이 얹는 { styles, events } (없으면 null). part: 'fx' = 영상에 들어가는 제목·라벨·REPLAY / 'lines' = 대본 줄 말자막·아이콘
function packAss(P, part) {
  const id = P.fxPack; if (!id || id === 'none' || P.height <= P.width) return null;
  const W = P.width, C = Math.round(W / 2), { y0, h } = videoArea(P), ev = [], st = [], fxOn = part !== 'lines', lnOn = part !== 'fx', end = P.total;
  const box = (layer, a, e, x, y, w, hh, col, r, tags = '') => `Dialogue: ${layer},${assTime(a)},${assTime(e)},FxBox,,0,0,0,,{\\p1\\pos(0,0)\\bord0\\shad0\\1c&H${hexBgr(col)}&${tags}}${rrPath(x, y, w, hh, r)}`;
  st.push(pst('FxBox', 20, 'FFFFFF', { bold: 0, al: 7 }));
  if (fxOn && id === 'raw' && P.fxTitle?.text) {   // 훅 문구를 영상 내내 아래쪽에: 노랑 굵은 글씨 + 검은 테두리
    st.push(pst('FxHook', 84, 'D4FF'.padStart(6, '0'), { bord: 9, sh: 2, al: 2 }));
    ev.push(`Dialogue: 6,${assTime(0)},${assTime(end)},FxHook,,0,0,0,,{\\an2\\pos(${C},${Math.round(y0 + h * 0.88)})}${assEsc(wrapKo(P.fxTitle.text, 11).slice(0, 2).join('\n'))}`);
  }
  if (fxOn && id === 'raw') for (const c of P.clips || []) if (c.replay) {   // 리플레이 표시: 오른쪽 위
    const bw = 300, bh = 84, x = W - 36 - bw, y = y0 + 36;
    st.push(pst('FxBadge', 50, 'FFFFFF', { al: 5 }));
    ev.push(box(6, c.start, c.start + c.duration, x, y, bw, bh, '#E02020', 14));
    ev.push(`Dialogue: 7,${assTime(c.start)},${assTime(c.start + c.duration)},FxBadge,,0,0,0,,{\\an5\\pos(${x + bw / 2},${y + bh / 2})}REPLAY`);
  }
  if (fxOn && id === 'steps') {   // 위쪽: 처음엔 제목 상자, 그다음엔 구간마다 번호 라벨 (검은 상자 + 흰 굵은 글씨)
    st.push(pst('FxStep', 64, 'FFFFFF', { al: 5 }));
    const put = (a, e, text, fs) => {
      const ls = wrapKo(text, 13).slice(0, 2), bw = Math.min(W - 60, Math.max(...ls.map(t => lineW(t, fs) * 0.9)) + 70), bh = ls.length * fs * 1.15 + 40, y = y0 + 44;
      ev.push(box(6, a, e, C - bw / 2, y, bw, bh, '#000000', 10, '\\1a&H10&'));
      ev.push(`Dialogue: 7,${assTime(a)},${assTime(e)},FxStep,,0,0,0,,{\\an5\\pos(${C},${Math.round(y + bh / 2)})\\fs${fs}}${assEsc(ls.join('\n'))}`);
    };
    const td = P.fxTitle ? Math.min(P.fxTitle.dur, end) : 0;
    if (P.fxTitle?.text && td > 0) put(0, td, P.fxTitle.text, 64);
    for (const c of P.fxSteps || []) { const a = Math.max(c.start, td); if (c.end - a >= 0.3) put(a, c.end, c.label, 60); }
  }
  if (fxOn && id === 'tags') for (const e of P.fxEvents || []) if (e.kind === 'label' && e.text) {   // 파란 알약 라벨: 톡 튀어나왔다가 1.2초
    const fs = 56, w = Math.min(W - 80, lineW(e.text, fs) * 0.9 + 90), hh = 100, cy = Math.round(y0 + h * 0.58), b = Math.min(end, e.t + 1.2);
    st.push(pst('FxPill', fs, 'FFFFFF', { al: 5 }));
    const pop = '\\fscx60\\fscy60\\t(0,130,\\fscx108\\fscy108)\\t(130,230,\\fscx100\\fscy100)\\fad(0,160)';
    ev.push(`Dialogue: 6,${assTime(e.t)},${assTime(b)},FxBox,,0,0,0,,{\\p1\\an5\\pos(${C},${cy})\\bord0\\shad0\\1c&H${hexBgr('#1E88FF')}&${pop}}${rrPath(0, 0, w, hh, 50)}`);
    ev.push(`Dialogue: 7,${assTime(e.t)},${assTime(b)},FxPill,,0,0,0,,{\\an5\\pos(${C},${cy})${pop}}${assEsc(e.text)}`);
  }
  if (lnOn && id === 'words') {   // 말 자막: 2~4단어씩, 룩의 자막 자리에. 강조 단어는 하늘색, ✕/✓ 줄은 아이콘이 0.8초 팝
    const cp = capPos(P), fs = 88; st.push(pst('FxWd', fs, 'FFFFFF', { italic: -1, bord: 10, sh: 2, al: cp.an }));
    const cyan = hexBgr('#3EE6FF');
    for (const l of P.lines || []) {
      const { mark, text } = parseMark(l.ko ?? l.text);
      for (const c of chunkLine(text, l.start, l.end)) {
        let lines = [[]], len = 0;
        for (const w of c.words) { const n = [...w.t].length; if (len && len + 1 + n > 11) { lines.push([]); len = 0; } lines[lines.length - 1].push(w); len += (len ? 1 : 0) + n; }
        const txt = lines.map(ws => ws.map(w => (w.hl ? `{\\1c&H${cyan}&}${assEsc(w.t)}{\\1c&HFFFFFF&}` : assEsc(w.t))).join(' ')).join('\\N');
        ev.push(`Dialogue: 5,${assTime(c.start)},${assTime(c.end)},FxWd,,0,0,0,,{\\an${cp.an}\\pos(${C},${cp.y})\\fscx92\\fscy92\\t(0,90,\\fscx100\\fscy100)}${txt}`);
      }
      if (mark) {
        const a = Math.min(l.start + 0.05, end), b = Math.min(end, a + 0.8), cy = Math.round(y0 + h * 0.34), col = mark === 'x' ? '#FF2B2B' : '#2ECC71';
        const pop = '\\fscx40\\fscy40\\t(0,140,\\fscx115\\fscy115)\\t(140,260,\\fscx100\\fscy100)\\fad(0,140)';
        ev.push(`Dialogue: 8,${assTime(a)},${assTime(b)},FxBox,,0,0,0,,{\\p1\\an5\\pos(${C},${cy})\\bord7\\shad0\\1c&H${hexBgr(col)}&\\3c&H000000&${pop}}${iconPath(mark, 1.3)}`);
      }
    }
  }
  return ev.length ? { styles: [...new Set(st)].join('\n'), events: ev } : null;
}
export function buildAss(P, part = 'all') {
  const x = packAss(P, part);
  const base = buildAss0(P.fxPack === 'words' && part !== 'fx' ? { ...P, lines: [] } : P, part);   // 말자막은 룩의 줄 자막을 대신해요
  if (!x) return base;
  return base.replace('\n\n[Events]', '\n' + x.styles + '\n\n[Events]').replace(/\n*$/, '\n') + x.events.join('\n') + '\n';
}
function buildAss0(P, part = 'all') {
  if (P.look?.kind === 'mat' && P.height > P.width) return buildMatAss(P, part);
  if (P.look?.kind === 'punch' && P.height > P.width) return buildPunchAss(P, part);
  if (P.look && P.height > P.width) return buildBannerAss(P, part);
  const W = P.width, H = P.height, short = H > W;
  const fs1 = short ? 84 : 58, marginV = short ? 460 : 70, wrapAt = short ? 12 : 30, tfs = short ? 92 : 64;
  const ev = [];
  if (part !== 'lines') ev.push(`Dialogue: 1,${assTime(0)},${assTime(Math.min(1.5, P.total))},Title,,0,0,0,,{\\fad(150,300)}${assEsc(wrapKo(P.title, short ? 11 : 28).join('\n'))}`);
  for (const l of part === 'fx' ? [] : P.lines) {
    ev.push(`Dialogue: 0,${assTime(l.start)},${assTime(l.end)},Cap,,0,0,0,,${assEsc(wrapKo(l.text, wrapAt).join('\n'))}`);
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Cap,${FONT_NAME},${fs1},&H00FFFFFF,&H000000FF,&H00000000,&H80000000,1,0,0,0,100,100,0,0,1,7,2,2,60,60,${marginV},1
Style: Title,${FONT_NAME},${tfs},&H0000E5FF,&H000000FF,&H00000000,&HB4000000,1,0,0,0,100,100,0,0,3,14,0,8,70,70,${short ? 300 : 120},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join('\n')}
`;
}
const escFilterPath = p => p.replace(/\\/g, '\\\\').replace(/'/g, "\\\\\\'").replace(/:/g, '\\:').replace(/,/g, '\\,').replace(/\[/g, '\\[').replace(/\]/g, '\\]');

// ---------- 6. 자막 자동화: 소스 영상 속 말(영어 자막)을 편집 타임라인에 맞춰 입혀요 ----------
// 클립마다: 소스 구간과 겹치는 자막 줄 → 편집본 시간으로 옮기기
export function srcCues(E, P, info) {
  const out = [], cache = new Map();
  for (const c of P.clips) {
    if (c.si == null || c.a == null || c.replay) continue;   // 리플레이 클립은 같은 장면의 반복이라 원본 자막을 또 넣지 않아요
    if (!cache.has(c.si)) cache.set(c.si, info[c.si] ? cuesOf(E, info[c.si]) : []);
    for (const q of cache.get(c.si)) {
      const t = q.text.replace(/^>>+\s*/, '').trim();
      if (!t || /^[\[(♪].*[\])♪]$/.test(t) || q.start >= c.b || q.end <= c.a) continue;
      const start = c.start + Math.max(q.start, c.a) - c.a, end = Math.min(c.start + Math.min(q.end, c.b) - c.a, c.start + c.duration);
      if (end - start < 0.2) continue;
      out.push({ start: +start.toFixed(2), end: +end.toFixed(2), en: t });
    }
  }
  return out.sort((x, y) => x.start - y.start);
}
// 영어 줄 → 한국어 번역 (키가 있을 때만). call(prompt) → 글. 실패하면 영어만 써요.
export async function translateCues(cues, call, ctx) {
  const out = cues.map(c => ({ ...c })); let done = 0;
  for (let i = 0; i < out.length; i += 40) {
    const chunk = out.slice(i, i + 40);
    const prompt = `아래는 영상 속 영어 자막 ${chunk.length}줄이야. 줄마다 뜻이 바뀌지 않게 쉬운 한국어로 옮겨 줘. 설교·연설 말투는 그대로 두고, 없는 말을 지어내지 마.\n` +
      `JSON 문자열 배열 하나만 출력해. 길이는 정확히 ${chunk.length}.\n\n${JSON.stringify(chunk.map(c => c.en))}`;
    try {
      const txt = await call(prompt), arr = JSON.parse((/\[[\s\S]*\]/.exec(txt) || [''])[0]);
      if (!Array.isArray(arr) || arr.length !== chunk.length) throw new Error('줄 수가 안 맞아요');
      chunk.forEach((c, k) => { if (typeof arr[k] === 'string' && arr[k].trim()) c.ko = arr[k].trim(); }); done += chunk.length;
    } catch (e) { ctx?.log?.(`  번역 실패(${e.message}) → 이 부분은 영어로 둬요`); }
  }
  return out;
}
// 원본 자막 ASS: 룩에 맞는 모양, 화면 아래쪽 (대본 자막은 화면 가운데쪽이라 겹치지 않아요)
export function buildSrcAss(P, cues) {
  const short = P.height > P.width, look = P.look && short ? P.look : null, W = P.width, H = look?.kind === 'banner' ? P.height - look.bannerH : look?.kind === 'mat' ? look.footH : P.height;
  const fs = short ? 56 : 42, mv = short ? 110 : 60, wrap = short ? 18 : 40, bil = look?.kind === 'banner' && look.bilingual;
  const col = look?.kind === 'punch' ? hexBgr(look.accent) : 'FFFFFF', font = look?.font || FONT_NAME;
  const ev = cues.map(c => {
    const main = c.ko || c.en, sub = c.ko && bil ? c.en : '';
    return `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Src,,0,0,0,,${assEsc(wrapKo(main, wrap).join('\n'))}${sub ? `\\N{\\fs${Math.round(fs * 0.7)}\\b0}${assEsc(wrapKo(sub, Math.round(wrap * 1.4)).join('\n'))}` : ''}`;
  });
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Src,${font},${fs},&H00${col},&H000000FF,&H00000000,&H96000000,1,0,0,0,100,100,0,0,1,5,2,2,60,60,${mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join('\n')}
`;
}
async function subs(E, ctx) {
  const P = readJson(E.p('편집/편집계획.json'));
  if (!P) throw new StepError('편집 계획이 먼저예요.');
  if (!exists(E.p('편집/가편집.mp4'))) throw new StepError('가편집이 먼저예요.');
  const info = readJson(E.p('소스.json'), []), out = E.p('편집/자막본.mp4');
  fs.rmSync(E.p('편집/원본자막.ass'), { force: true });
  let cues = srcCues(E, P, info);
  if (cues.length && process.env.ANTHROPIC_API_KEY) { ctx.log(`영어 자막 ${cues.length}줄을 한국어로 옮기는 중…`); cues = await translateCues(cues, callClaude, ctx); }
  else if (cues.length && lookOf(E)?.kind === 'punch') ctx.log('  AI 키가 없어서 한국어로 못 옮겨요 → 영어 자막 그대로 넣어요.');
  P.srcSubs = cues.length > 0; writeJson(E.p('편집/편집계획.json'), P);
  try {
    if (!cues.length) {
      ctx.log('소스 영상에서 쓸 자막을 못 찾았어요. 자막 없이 넘어가요. (내 파일은 같은 이름의 .vtt/.srt 를 옆에 두면 읽어요)');
      await ff(['-i', E.p('편집/가편집.mp4'), '-c', 'copy', ...(keepsAudio(E) ? [] : ['-an']), '-movflags', '+faststart', out], ctx);
    } else {
      const assFile = E.p('편집/원본자막.ass'); fs.writeFileSync(assFile, buildSrcAss(P, cues));
      ctx.log(`원본 자막 ${cues.length}줄을 입혀요${cues.some(c => c.ko) ? ' (한국어)' : ' (영어)'}…`);
      await ff(['-i', E.p('편집/가편집.mp4'), '-vf', `ass='${escFilterPath(assFile)}':fontsdir='${FONT_DIR}'`, ...(keepsAudio(E) ? ['-c:a', 'copy'] : ['-an']), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out], ctx);
    }
  } catch (e) { if (e instanceof StopError) throw e; throw new StepError(`ffmpeg가 자막을 입히지 못했어요: ${lastLines(e.err)}`); }
  ctx.log('자막본.mp4 완성.');
}

// ---------- 7. 이펙트: 룩에 맞는 배너·훅·흑백 인트로·제목 카드·워터마크 ----------
async function fx(E, ctx) {
  let P = readJson(E.p('편집/편집계획.json'));
  if (!P) throw new StepError('편집 계획이 먼저예요.');
  delete P.fxPack; delete P.fxEvents; delete P.fxPop;   // 이펙트 팩 자국은 이 단계가 새로 남겨요 (이펙트 없음 = 예전과 똑같은 계획)
  const base = exists(E.p('편집/자막본.mp4')) ? '편집/자막본.mp4' : exists(E.p('편집/가편집.mp4')) ? '편집/가편집.mp4' : null;
  if (!base) throw new StepError('가편집이 먼저예요.');
  delete E.s.legacyBurn;   // 이 단계가 새 완성본을 만들면 예전 방식(대본 자막 포함)은 끝나요
  const look = P.look && P.height > P.width ? P.look : null, W = P.width, H = P.height;
  // 문구는 영상 제목에서 (대본에 "> 배너:"/"> 훅:" 줄이 있으면 그걸 먼저 써요)
  const txt = exists(E.p('편집/대본.md')) ? fs.readFileSync(E.p('편집/대본.md'), 'utf8') : '';
  if (look?.kind === 'mat') {
    const b = parseBanner(txt) || bannerFromTitle(E.s.title), info = readJson(E.p('소스.json'), []);
    const credit = parseCredit(txt) || [...new Set(info.filter(x => !x.local && x.channel).map(x => x.channel))].join(' · ');
    P.banner = { small: b.small, big: b.big }; P.credit = credit; P.bw = [];
    ctx.log(`  제목: ${b.small || '(없음)'} / ${b.big}${credit ? ' · 출처: ' + credit : ''}`);
  } else if (look?.kind === 'punch') {
    const h = parseHook(txt) || hookFromTitle(E.s.title);
    P.hook = { text: h.text, dur: +Math.min(look.hookDur, P.total * 0.3).toFixed(2) }; P.bw = [];
    ctx.log(`  훅 제목: ${h.text} (처음 ${P.hook.dur}초)`);
  } else if (look) {
    const b = parseBanner(txt) || bannerFromTitle(E.s.title), end = +Math.min(look.introDur ?? 4, P.total * 0.3).toFixed(2);
    P.banner = { small: b.small, big: b.big }; P.bw = look.introBW && end > 0 ? [[0, end]] : [];
    ctx.log(`  배너: ${b.small || '(없음)'} / ${b.big}${P.bw.length ? ` · 흑백 인트로 0~${end}초` : ''}`);
  }
  const pk0 = fxPackOf(E);
  delete P.fxTitle; delete P.fxSteps;
  if (pk0.hookFixed || pk0.steps) {   // 한 방 리얼·단계 강의: 팩이 제목 문구를 직접 보여 줘요 (룩의 훅 칸은 비켜요)
    const h = parseHook(txt) || hookFromTitle(E.s.title);
    P.fxTitle = { text: h.text, dur: pk0.steps ? +Math.min(pk0.titleDur, P.total * 0.3).toFixed(2) : P.total };
    if (P.hook) P.hook.dur = 0;
    ctx.log(`  제목 문구: ${h.text}${pk0.steps ? ` (처음 ${P.fxTitle.dur}초)` : ' (영상 내내)'}`);
  }
  if (pk0.steps) { P.fxSteps = stepLabels(E.s.fxLabels, P.clips.length).map((label, i) => ({ start: P.clips[i].start, end: +(P.clips[i].start + P.clips[i].duration).toFixed(2), label })); ctx.log(`  단계 라벨: ${P.fxSteps.map(x => x.label).join(' / ')}`); }
  writeJson(E.p('편집/편집계획.json'), P);
  // 이펙트 팩(최종 결과물 레퍼런스): 강조 순간을 모아 영상 칸에 줌·흔들림·플래시를 입혀요. 효과음은 목소리·음악 단계가 같은 목록으로 넣어요.
  const pack = fxPackOf(E), area = look?.kind === 'mat' ? [W, look.footH] : look?.kind === 'punch' || !look ? [W, H] : [W, H - look.bannerH];
  let fxv = '';
  if (pack.id !== 'none') {
    relayout(E, ctx);   // 대본이 이미 확인돼 있으면 줄 시간표를 먼저 짜서 강조 순간을 알아요
    P = readJson(E.p('편집/편집계획.json')) || P;
    P.fxPack = pack.id; P.fxPop = !!pack.pop; P.fxEvents = buildFxEvents(E, P, pack);
    writeJson(E.p('편집/편집계획.json'), P);
    fxv = fxVideoFilter(pack, P, P.fxEvents, area[0], area[1]);
    const cnt = k => P.fxEvents.filter(e => e.kind === k).length;
    ctx.log(`이펙트 팩: ${pack.name} · 컷 ${cnt('cut')}곳 · 슬로우 ${cnt('slow')}곳 · 강조 ${cnt('hit')}곳${pack.tags ? ` · 라벨 ${cnt('label')}곳` : ''}${pack.pop ? ' · 강조 단어 팝' : ''}`);
  }
  const assFile = E.p('편집/효과.ass');
  fs.writeFileSync(assFile, buildAss(P, 'fx'));
  let vf = `ass='${escFilterPath(assFile)}':fontsdir='${FONT_DIR}'`, vArgs = ['-vf', vf, '-map', '0:v'];
  let aArgs = ['-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo'], aMap = ['-map', '1:a', '-shortest'];
  if (look?.kind === 'mat') {
    // 경기 화면은 가운데 칸(footY부터 footH 높이), 나머지는 검은 바탕 → 제목·출처·워터마크·SLOW
    vf = `scale=${W}:${look.footH}:force_original_aspect_ratio=increase,crop=${W}:${look.footH},setsar=1,${fxv ? fxv + ',' : ''}pad=${W}:${H}:0:${look.footY}:color=black,` + vf;
    vArgs = ['-vf', vf, '-map', '0:v'];
    if ((await probe(E.p(base), ctx)).hasAudio) { aArgs = []; aMap = ['-map', '0:a']; }
    ctx.log('매트 스토리 틀(제목·출처·워터마크·SLOW)을 입혀요…');
  } else if (look?.kind === 'punch') {
    // 처음 hook.dur초는 화면을 줄여 검은 바탕에 놓고(훅 제목), 그다음은 꽉 찬 화면
    const hd = P.hook?.dur || 0, w2 = 2 * Math.round(W * look.hookScale / 2), h2 = 2 * Math.round(H * look.hookScale / 2);
    const full = `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},setsar=1`;
    const fc = hd > 0
      ? `${full},${fxv ? fxv + ',' : ''}split=2[f][s];[s]scale=${w2}:${h2},pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black[sm];[f][sm]overlay=0:0:enable='lt(t,${hd})',${vf}[v]`
      : `${full},${fxv ? fxv + ',' : ''}${vf}[v]`;
    vArgs = ['-filter_complex', fc, '-map', '[v]'];
    ctx.log(`훅 제목(처음 ${hd}초) + 워터마크를 입혀요…`);
  } else if (look) {
    // 영상은 아래 칸(배너 빼고)에 꽉 차게 → 흑백(인트로) → 위에 배너색 띠 → 글자
    const bw = (P.bw || []).filter(([a, b]) => b > a);
    vf = `scale=${W}:${H - look.bannerH}:force_original_aspect_ratio=increase,crop=${W}:${H - look.bannerH},setsar=1` + (fxv ? ',' + fxv : '') +
      (bw.length ? `,hue=s=0:enable='${bw.map(([a, b]) => `between(t,${a},${b})`).join('+')}'` : '') +
      `,pad=${W}:${H}:0:${look.bannerH}:color=0x${String(look.bg).replace('#', '')},` + vf;
    vArgs = ['-vf', vf, '-map', '0:v'];
    ctx.log(`배너를 입혀요${bw.length ? ' (인트로는 흑백)' : ''}…`);
  } else {
    if (fxv) { vf = fxv + ',' + vf; vArgs = ['-vf', vf, '-map', '0:v']; }
    ctx.log('제목 카드(처음 1.5초)를 입혀요…');
  }
  try {
    await ff(['-i', E.p(base), ...aArgs, ...vArgs,
      ...aMap, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', E.p('편집/완성본.mp4')], ctx);
  } catch (e) { if (e instanceof StopError) throw e; throw new StepError(`ffmpeg가 이펙트를 입히지 못했어요: ${lastLines(e.err)}`); }
  ctx.log('완성본.mp4 완성 (대본 자막·목소리·음악은 다음 단계에서).');
  relayout(E, ctx);
}

// ---------- 9. 목소리·음악 (스튜디오 ⑦ 음악/녹음 의 마지막 단계) ----------
// 대본 줄 자막(배너 룩의 나레이션·한영 자막, 펀치 룩의 굵은 자막 등)은 여기서 영상에 입혀요. 예전 방식(완성본에 이미 들어 있음)이면 건너뛰어요.
export async function mix(E, ctx) {
  const P = readJson(E.p('편집/편집계획.json'));
  if (P) P.lines = P.lines || [];
  if (!P || !exists(E.p('편집/완성본.mp4'))) throw new StepError('이펙트(완성본)가 먼저예요.');
  const T = P.total, inputs = ['-i', E.p('편집/완성본.mp4')], chains = []; let idx = 1;
  const burn = !E.s.legacyBurn && P.lines?.length > 0 && P.fxPack !== 'raw', capAss = E.p('편집/대본자막.ass');
  if (burn) { fs.writeFileSync(capAss, buildAss(P, 'lines')); ctx.log(`대본 자막 ${P.lines.length}줄을 영상에 입혀요.`); }
  else if (P.fxPack === 'raw' && P.lines?.length) ctx.log('한 방 리얼: 훅 문구만 보여 주려고 대본 줄 자막은 영상에 넣지 않아요.');
  else if (!P.lines?.length) ctx.log('대본 줄이 없어서 자막은 넣지 않아요.');
  const capVf = `ass='${escFilterPath(capAss)}':fontsdir='${FONT_DIR}'`;
  const voiceLabels = [];
  for (const l of P.lines) {
    const v = E.s.voices?.[l.i];
    if (!v || v.text !== l.text || !exists(E.p('편집/녹음', v.file))) continue;
    const pr = await probe(E.p('편집/녹음', v.file), ctx);
    const slot = l.end - l.start, dur = pr.duration || slot;
    let f = '';
    if (dur > slot) { const r = Math.min(dur / slot, 1.25); f += `atempo=${r.toFixed(4)},`; ctx.log(`  ${l.i + 1}번째 줄: 칸(${slot.toFixed(1)}초)보다 길어서 ${r.toFixed(2)}배 빠르게`); }
    const maxLen = Math.max(0.3, slot);
    inputs.push('-i', E.p('편집/녹음', v.file));
    chains.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,${f}atrim=0:${maxLen.toFixed(3)},asetpts=PTS-STARTPTS,adelay=${Math.round(l.start * 1000)}:all=1,volume=1.4[v${idx}]`);
    voiceLabels.push(`[v${idx}]`); idx++;
  }
  ctx.log(`녹음된 줄 ${voiceLabels.length}/${P.lines.length}`);
  const bgmFile = E.s.mix?.bgm ? assetPath(E, 'bgm', E.s.mix.bgm) : null, stFile = E.s.mix?.sting ? assetPath(E, 'sting', E.s.mix.sting) : null;
  if (E.s.mix?.bgm && !bgmFile) ctx.log(`  배경음악 "${E.s.mix.bgm}" 파일을 못 찾아서 빼요.`);
  if (E.s.mix?.sting && !stFile) ctx.log(`  시그니처 "${E.s.mix.sting}" 파일을 못 찾아서 빼요.`);
  const mixIn = [], look = P.look && P.height > P.width ? P.look : null;
  if (look?.audio === 'orig' && (await probe(E.p('편집/완성본.mp4'), ctx)).hasAudio) {   // 원본 경기 소리 (목소리가 있으면 조금 낮춰요)
    chains.push(`[0:a]aresample=44100,aformat=channel_layouts=stereo,volume=${voiceLabels.length ? (look.origVol * 0.6).toFixed(2) : look.origVol}[orig]`);
    mixIn.push('[orig]'); ctx.log('  원본 경기 소리를 살려요.');
  }
  if (voiceLabels.length) {
    chains.push(`${voiceLabels.join('')}amix=inputs=${voiceLabels.length}:normalize=0:duration=longest,apad=whole_dur=${T}[voice]`);
    if (bgmFile) chains.push('[voice]asplit=2[voiceA][voiceSC]'); else chains.push('[voice]anull[voiceA]');
    mixIn.push('[voiceA]');
  }
  if (bgmFile) {
    inputs.push('-stream_loop', '-1', '-i', bgmFile);
    chains.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${T},asetpts=PTS-STARTPTS,volume=${look?.bgmVol ?? 0.35},afade=t=out:st=${Math.max(0, T - 1.5)}:d=1.5[bgm]`); idx++;
    if (voiceLabels.length) { chains.push('[bgm][voiceSC]sidechaincompress=threshold=0.02:ratio=10:attack=20:release=500:makeup=1[bgmd]'); mixIn.push('[bgmd]'); }
    else mixIn.push('[bgm]');
    ctx.log(`  배경음악: ${E.s.mix.bgm}${voiceLabels.length ? ' (목소리 나올 때 자동으로 낮춤)' : ''}`);
  }
  if (stFile) {
    const at = P.lines[1] ? P.lines[1].start : 0;
    inputs.push('-i', stFile);
    chains.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:3,adelay=${Math.round(at * 1000)}:all=1,volume=0.9[st]`); idx++;
    mixIn.push('[st]'); ctx.log(`  시그니처 소리: ${E.s.mix.sting} (${at.toFixed(1)}초)`);
  }
  // 이펙트 팩 효과음: 이펙트 단계가 남긴 강조 순간(P.fxEvents)마다. 파일이 없으면 ffmpeg 로 만든 기본 소리
  const fxp = FX_PACKS.find(p => p.id === P.fxPack), said = new Set();
  for (const e of (fxp && P.fxEvents ? P.fxEvents : []).slice(0, 60)) {
    const name = fxp.sfx?.[e.kind]; if (!name) continue;
    const file = findSfx(E, name);
    if (file) inputs.push('-i', file); else inputs.push('-f', 'lavfi', '-t', String(SFX_SYNTH[name].d), '-i', SFX_SYNTH[name].src);
    chains.push(`[${idx}:a]aresample=44100,aformat=channel_layouts=stereo,atrim=0:${file ? 2 : SFX_SYNTH[name].d},asetpts=PTS-STARTPTS,adelay=${Math.round(e.t * 1000)}:all=1,volume=${fxp.sfxVol ?? 0.8}[x${idx}]`);
    mixIn.push(`[x${idx}]`); idx++;
    if (!said.has(name)) { said.add(name); ctx.log(`  효과음 "${name}": ${file ? path.basename(file) : '소리/효과음 폴더에 파일이 없어서 기본 소리로 만들어요'}`); }
    ctx.log(`  효과음 ${name} · ${e.t.toFixed(1)}초 (${{ cut: '컷', slow: '슬로우', hit: '강조', label: '라벨', ok: '✓', x: '✕' }[e.kind]})`);
  }
  let args;
  if (mixIn.length) {
    chains.push(`${mixIn.join('')}amix=inputs=${mixIn.length}:normalize=0:duration=longest,apad=whole_dur=${T},alimiter=limit=0.95[aout]`);
    if (burn) chains.push(`[0:v]${capVf}[vout]`);
    args = [...inputs, '-filter_complex', chains.join(';'), '-map', burn ? '[vout]' : '0:v', '-map', '[aout]'];
  } else {
    ctx.log('  녹음도 음악도 없어서 소리 없는 트랙으로 만들어요.');
    args = [...inputs, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', ...(burn ? ['-vf', capVf] : []), '-map', '0:v', '-map', `${idx}:a`];
  }
  const vcodec = burn ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-pix_fmt', 'yuv420p'] : ['-c:v', 'copy'];
  try {
    await ff([...args, '-t', String(T), ...vcodec, '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', E.p('편집/최종본.mp4')], ctx);
  } catch (e) { if (e instanceof StopError) throw e; throw new StepError(`ffmpeg가 소리를 합치지 못했어요: ${lastLines(e.err)}`); }
  ctx.log('최종본.mp4 완성.');
}
export function assetDirs(E, kind) {
  const R = E.soundRoot;
  return kind === 'bgm' ? [path.join(R, '소리/BGM'), path.join(E.homeRoot, '음악')] : kind === 'sfx' ? [path.join(R, '소리/효과음')] : [path.join(R, '소리/시그니처')];
}
// 효과음 파일 찾기: 소리/효과음/팡.mp3 처럼 이름(확장자 앞)이 같은 파일
function findSfx(E, name) {
  for (const d of assetDirs(E, 'sfx')) { try { const f = fs.readdirSync(d).find(x => AUDIO_EXT.test(x) && !x.startsWith('.') && x.replace(AUDIO_EXT, '') === name); if (f) return path.join(d, f); } catch {} }
  return null;
}
export function listAssets(E, kind) {
  const set = new Set();
  for (const d of assetDirs(E, kind)) { try { for (const f of fs.readdirSync(d)) if (AUDIO_EXT.test(f) && !f.startsWith('.')) set.add(f); } catch {} }
  return [...set].sort();
}
function assetPath(E, kind, name) {
  if (!name || name !== path.basename(name)) return null;
  for (const d of assetDirs(E, kind)) { const p = path.join(d, name); if (exists(p)) return p; }
  return null;
}

// ---------- 10. 업로드 패키지 ----------
async function upload(E, ctx) {
  const P = readJson(E.p('편집/편집계획.json')), info = readJson(E.p('소스.json'), []);
  const video = exists(E.p('편집/최종본.mp4')) ? '편집/최종본.mp4' : exists(E.p('편집/완성본.mp4')) ? '편집/완성본.mp4' : null;
  if (!P || !video) throw new StepError('완성본이 먼저예요. "이펙트" 단계를 끝내세요.');
  fs.mkdirSync(E.p('업로드'), { recursive: true });
  const short = E.s.format !== 'long';
  const title = (E.s.title + (short ? ' #Shorts' : '')).slice(0, 100);
  const credits = info.map((s, si) => `- ${s.channel ? s.channel + ' · ' : ''}${s.title} (${s.local ? '내 파일' : s.url}) · 사용 구간 ${rangesFor(E, si, s).join(', ')}`);
  const music = [E.s.mix?.bgm && `배경음악: ${E.s.mix.bgm}`, E.s.mix?.sting && `효과음: ${E.s.mix.sting}`].filter(Boolean);
  const desc = [E.s.note || (P.lines || []).slice(0, 2).map(l => l.text).join(' ') || E.s.title, '', '[소스]', ...(credits.length ? credits : ['- (없음)']),
    ...(music.length ? ['', '[음악·효과음]', ...music.map(m => '- ' + m)] : []), ...(fxPackOf(E).id !== 'none' ? ['', `[이펙트] ${fxPackOf(E).name}`] : []), '', profileOf(E).disclaimer].join('\n');
  const words = [...new Set(E.s.title.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(w => w.length >= 2))].slice(0, 6);
  const tags = [...words, ...profileOf(E).tags, ...(short ? ['Shorts'] : [])];
  const dest = E.p('업로드/영상.mp4');
  fs.copyFileSync(E.p(video), dest);
  let thumb = null;
  try { await ff(['-ss', '1', '-i', dest, '-frames:v', '1', '-q:v', '2', E.p('업로드/썸네일.jpg')], ctx); thumb = '업로드/썸네일.jpg'; }
  catch (e) { if (e instanceof StopError) throw e; ctx.log('썸네일을 못 뽑았어요: ' + lastLines(e.err)); }
  const pack = { title, description: desc, tags, format: short ? 'shorts' : 'long', video: '업로드/영상.mp4', fromVideo: video, thumbnail: thumb, sources: info.map((s, si) => ({ url: s.url, title: s.title, channel: s.channel, ranges: rangesFor(E, si, s) })), script: (P.lines || []).map(l => l.text), created: new Date().toISOString() };
  writeJson(E.p('업로드/업로드.json'), pack);
  fs.writeFileSync(E.p('업로드/업로드.txt'), `제목\n${title}\n\n설명란\n${desc}\n\n태그\n${tags.join(', ')}\n\n형식: ${short ? '쇼츠' : '롱폼'}\n영상: 업로드/영상.mp4 (${video.includes('최종') ? '최종본' : '완성본 · 목소리·음악 전'})\n썸네일: ${thumb || '(없음)'}\n\n※ 실행기는 유튜브에 직접 올리지 않아요. YouTube Studio에서 위 내용을 복사해 올리세요.\n`);
  ctx.log(`업로드 패키지 완성 (${video.includes('최종') ? '최종본' : '완성본'} 사용).`);
}

// ---------- 예전 에피소드(8단계) → 새 단계로 옮기기 ----------
// download(구간만 받기) → download 그대로 / clip = download 가 끝났으면 끝남 / subs = 예전 finish 가 끝났으면 끝남(대본 자막이 이미 들어 있어서 legacyBurn)
// fx = 예전 finish 의 상태·오류 그대로. 룩은 그때 쓰던 채널 룩을 그대로 못 박아요.
export function migrateState(s) {
  if (!s.steps) s.steps = {};
  if (s.steps.finish || !s.steps.fx) {
    const old = s.steps, fin = old.finish || { status: 'todo' };
    if (!old.clip) old.clip = { status: old.download?.status === 'done' ? 'done' : 'todo' };
    if (!old.subs) old.subs = { status: fin.status === 'done' ? 'done' : 'todo' };
    if (!old.fx) old.fx = { ...fin };
    if (fin.status === 'done') s.legacyBurn = true;
    delete old.finish;
    if (!s.look) s.look = CHANNEL_PROFILES[s.channel] ? s.channel : 'yt-wrestling';
  }
  return s;
}
export const STEP_FN = { research, download, clip, plan, rough, subs, fx, script, mix, upload };
