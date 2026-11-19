// AI 편집 (yt-wrestling 작업판): 하이라이트 1차 컷 -> 스타일 입히기 -> 자막. 판단은 이 맥의 Claude Code(claude -p), 그리기는 ffmpeg.
// 단계: aicut(편집/AI컷.json, AI1차컷.mp4) -> aistyle(편집/AI완성.json 제목·라벨·팝업, AI스타일본.mp4) -> aisubs(자막 추가, AI완성.mp4)
// 인트로·아웃트로는 모든 단계에서 후크로 다뤄요: 컷(첫 컷 intro, 마지막 컷 outro) / 스타일(위 제목) / 자막(0초 후크, 마지막 줄 후크).
import fs from 'node:fs';
import path from 'node:path';
import { HOME, FFMPEG, FONT_DIR, FONT_NAME, StepError, StopError, run, ff, probe, lastLines, exists } from './util.mjs';

// 자동실행(launchd)은 PATH 가 짧아서 Claude Code 가 깔리는 곳을 직접 찾아요
const CLAUDE = process.env.FIELDNOTE_CLAUDE || [path.join(HOME, '.local/bin/claude'), path.join(HOME, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(exists) || 'claude';
const FONT = process.env.FIELDNOTE_AI_FONT || FONT_NAME;
const W = 1080, H = 1920, VY = 470, VH = 970;   // 화면 틀: 경기 화면은 y=470 부터 1080x970
export const AI_STYLES = {
  'yt-mat': { name: 'MAT STORY', watermark: ['MAT', 'STORY'], yellow: 'FFD600', red: 'FF3B30', tone: '반말, 짧고 세게. 레슬링을 모르는 사람도 알아듣게. 위 제목 2줄 끝에 "ㄷㄷ" 가능.' },
};
export const AI_OUT = { aicut: ['편집/AI컷.json', '편집/AI1차컷.mp4'], aistyle: ['조사/research.md', '편집/AI완성.json', '편집/AI스타일본.mp4'], aisubs: ['편집/AI완성.mp4'] };

// 맥의 Claude Code 스킬(~/.claude/skills). 단계마다 해당 스킬 규칙을 먼저 읽고 따르게 해요. 없으면 건너뛰어요.
const SKILL_DIR = path.join(HOME, '.claude/skills');
const skills = (ctx, names) => {
  const have = names.filter(n => exists(path.join(SKILL_DIR, n, 'SKILL.md')));
  if (have.length < names.length) ctx.log('  없는 스킬은 건너뛰어요: ' + names.filter(n => !have.includes(n)).join(', '));
  return have.length ? `먼저 Read 도구로 아래 스킬 규칙을 읽고, 이 일에 맞는 규칙을 그대로 따라라 (스킬이 말하는 파일 저장 위치는 무시하고, 아래 지시한 형식으로만 답해라):\n${have.map(n => '- ' + path.join(SKILL_DIR, n, 'SKILL.md')).join('\n')}\n\n` : '';
};
const readJson = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o, null, 1)); };
const r1 = n => Math.round(n * 10) / 10;
const styleOf = E => { const st = AI_STYLES[E.s.look || '']; if (!st) throw new StepError(`AI 편집은 지금 매트 스토리 룩만 돼요. 편집 스타일에서 매트 스토리 룩을 골라 주세요.`); return st; };

function source(E) {
  let info; try { info = readJson(E.p('소스.json'))[0]; } catch { info = null; }
  if (!info) throw new StepError('소스 확인이 먼저예요.');
  const file = info.local ? info.url.replace(/^file:\/\//, '') : info.full && E.p(info.full);
  if (!file || !exists(file)) throw new StepError('영상을 아직 못 받았어요. 영상 받기를 먼저 해 주세요.');
  return { ...info, file };
}

// Claude Code 에게 묻고 JSON 하나를 받아요. check 가 오류 문장을 돌려주면 그걸 알려 주고 한 번 더 물어요.
async function askClaude(E, ctx, prompt, check) {
  let p = prompt;
  for (let i = 0; i < 2; i++) {
    ctx.log(i ? '  답을 고쳐 달라고 한 번 더 물어요…' : '  Claude 가 영상을 보는 중… (2~5분)');
    let out;
    try { ({ out } = await run(CLAUDE, ['-p', p, '--output-format', 'json', '--allowedTools', 'Read,Write,WebSearch,WebFetch', '--add-dir', E.dir, '--add-dir', SKILL_DIR], ctx)); }
    catch (e) {
      const lim = /hit your limit[^"]*/i.exec(String(e.out || '') + String(e.err || ''));
      if (lim) throw new StepError('Claude 구독 사용 한도에 걸렸어요 (' + lim[0] + '). 풀린 뒤 다시 실행하세요.');
      if (e instanceof StopError || e instanceof StepError) throw e.message.includes('ENOENT') ? new StepError('Claude Code(claude)를 못 찾았어요. 맥에 Claude Code 를 설치하고 로그인해 주세요.') : e;
      throw new StepError('Claude Code 실행 실패: ' + (lastLines(e.err) || lastLines(e.out) || e.message));
    }
    let text = out; try { text = JSON.parse(out).result ?? out; } catch {}
    const s = text.indexOf('{'), e = text.lastIndexOf('}');
    let j = null, err = '';
    if (s < 0 || e < s) err = 'JSON 이 없어요.'; else { try { j = JSON.parse(text.slice(s, e + 1)); } catch (x) { err = 'JSON 모양이 깨졌어요: ' + x.message; } }
    if (!err) err = check(j) || '';
    if (!err) return j;
    ctx.log('  답에 문제가 있어요: ' + err);
    p = prompt + `\n\n방금 네 답의 문제: ${err}\n고쳐서 JSON 하나만 다시 답해라.`;
  }
  throw new StepError('Claude 답을 쓸 수 없었어요. 로그를 보고 다시 실행해 주세요.');
}

function transcript(E, info) {
  const f = info.subFile && E.p(info.subFile);
  if (!f || !exists(f)) return '';
  const lines = []; let t = 0;
  for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) {
    const m = /^(\d+):(\d+):(\d+)\.\d+ -->/.exec(l) || /^(\d+):(\d+)\.\d+ -->/.exec('0:' + l);
    if (m) { t = +m[1] * 3600 + +m[2] * 60 + +m[3]; continue; }
    const txt = l.replace(/<[^>]+>/g, '').trim();
    if (txt && !/^(WEBVTT|Kind:|Language:|\d+$)/.test(txt) && lines[lines.length - 1]?.txt !== txt) lines.push({ t, txt });
  }
  return lines.map(x => `[${x.t}s] ${x.txt}`).join('\n').slice(0, 20000);
}

// 썸네일 시트: a 부터 fps 로 뽑아 cols x rows 로 붙여요
async function sheets(E, ctx, src, name, a, dur, fps, cols, rows, width) {
  const out = E.p('분석'); fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) if (f.startsWith(name + '_')) fs.rmSync(path.join(out, f));
  await ff(['-ss', String(a), '-t', String(dur), '-i', src, '-vf', `fps=${fps},scale=${width}:-2,tile=${cols}x${rows}`, '-q:v', '4', path.join(out, `${name}_%03d.jpg`)], ctx);
  const per = cols * rows, step = 1 / fps;
  return fs.readdirSync(out).filter(f => f.startsWith(name + '_')).sort().map((f, k) => `- ${path.join(out, f)}: 타일 ${cols}x${rows}, 왼쪽 위부터 가로로 읽기. 타일 i 의 원본 시각 = ${r1(a + k * per * step)} + i*${step} 초`).join('\n');
}

// ---------- 2. 하이라이트 1차 컷 ----------
async function aicut(E, ctx) {
  const info = source(E), dur = (await probe(info.file, ctx)).duration;
  if (!dur) throw new StepError('영상 길이를 못 읽었어요.');
  const tr = transcript(E, info), trTxt = tr ? '영어 중계 자막(원본 시각):\n' + tr : '(중계 자막 없음)';
  let win = [0, dur];
  if (dur > 60) {
    ctx.log('전체 영상을 2초 간격으로 훑어봐요…');
    const coarse = await sheets(E, ctx, info.file, 'coarse', 0, dur, 0.5, 6, 5, 320);
    const pick = await askClaude(E, ctx, `너는 레슬링 쇼츠 편집자다. 아래 영상에서 세로 쇼츠 하나로 만들 가장 강한 하이라이트 한 장면을 고른다.
영상: "${info.title}" (${info.channel}), 길이 ${Math.round(dur)}초.
아래 썸네일 시트를 Read 도구로 전부 보고 판단해라:
${coarse}
${trTxt}
고를 기준: 한 번에 보이는 결정적 기술(들어 던지기, 테이크다운, 폴, 역전), 점수판이 크게 바뀌는 순간, 관중/중계가 터지는 순간.
JSON 하나만 답해라: {"a": 시작초, "b": 끝초, "why": "한 줄"}  (b-a 는 15~40초, 결정적 순간 앞 3초 이상 포함)`,
      j => !(j.b > j.a) ? 'b 가 a 보다 커야 해요.' : j.a < 0 || j.b > dur + 1 ? `시각은 0~${Math.round(dur)}초 안이어야 해요.` : j.b - j.a > 60 ? '60초를 넘어요.' : '');
    win = [Math.max(0, +pick.a), Math.min(dur, +pick.b)];
    ctx.log(`  고른 장면: ${r1(win[0])}~${r1(win[1])}초 · ${pick.why || ''}`);
  }
  ctx.log('고른 장면을 0.2초 간격으로 봐요…');
  const fine = await sheets(E, ctx, info.file, 'fine', win[0], win[1] - win[0], 5, 5, 5, 384);
  const plan = await askClaude(E, ctx, `${skills(ctx, ['shorts-blueprint', 'edit-plan-sheet'])}너는 레슬링 쇼츠 편집자다. 아래는 "${info.title}" 의 원본 ${r1(win[0])}~${r1(win[1])}초를 0.2초 간격으로 뽑은 프레임 시트다. Read 도구로 전부 봐라:
${fine}
${trTxt}

할 일: 결정적 기술 하나를 중심으로 세로 쇼츠 1차 컷 편집안을 짠다. 인트로와 아웃트로가 제일 중요하다. 둘 다 후크여야 한다.
1) intro (후크, 1.5~3초): 맥락 설명 없이 제일 충격적인 순간부터. 첫 프레임부터 몸이 움직이고 있어야 한다. 스크롤을 멈추게 하는 장면.
2) 점수판/결과가 보이는 장면이 있으면 짧게 (role score, 1.5~3초)
3) 같은 기술을 슬로우로 다시: 동작을 2~3단계(예: 낮추기 / 허리 감기 / 넘기기)로 나눠 단계마다 컷 하나 (role slow). speed 는 0.15~0.5, 단계 하나가 출력에서 4~7초가 되게.
4) 기술 뒤 반응/세리머니가 있으면 원속도 (role after)
5) outro (후크, 2~4초): 끝나는 순간 다시 보고 싶게. 마지막 프레임이 intro 첫 프레임으로 자연스럽게 이어지는 루프가 기본. 결과가 터지기 직전에서 끊는 것도 가능.
전체 출력 길이(각 컷 (b-a)/speed 의 합)는 30~50초. 첫 컷은 반드시 intro, 마지막 컷은 반드시 outro.
시각은 반드시 프레임에서 직접 확인한 원본 초(소수점 1자리)로 적어라.

JSON 하나만 답해라:
{"moments":[{"t":원본초,"what":"그 순간 화면에 보이는 것"}],
 "cuts":[{"a":원본초,"b":원본초,"speed":1,"role":"intro|score|slow|after|outro","step":"슬로우 단계 이름(slow 일 때만)"}],
 "who":"선수/팀/대회. 누가 어느 쪽인지는 싱글릿 글씨·색·점수판 이름 같은 화면 근거로만 정하고 근거를 괄호로 적어라. 확실하지 않으면 빈칸",
 "crop_bottom": 화면 아래쪽 중계 띠(뉴스 티커·광고 띠 등)가 차지하는 높이 비율 0~0.25 (없으면 0. 경기 장면이 잘리지 않게)}`,
    j => {
      const c = j.cuts;
      if (!Array.isArray(c) || c.length < 3) return 'cuts 가 3개 이상 있어야 해요.';
      if (c[0].role !== 'intro') return '첫 컷 role 이 intro 가 아니에요.';
      if (c[c.length - 1].role !== 'outro') return '마지막 컷 role 이 outro 가 아니에요.';
      for (const [i, x] of c.entries()) {
        if (!(+x.b > +x.a)) return `${i + 1}번째 컷의 b 가 a 보다 커야 해요.`;
        if (x.a < 0 || x.b > dur + 0.5) return `${i + 1}번째 컷이 영상 길이(0~${r1(dur)}초)를 벗어나요.`;
        if (!(+x.speed >= 0.1 && +x.speed <= 1)) return `${i + 1}번째 컷 speed 는 0.1~1 이어야 해요.`;
      }
      if (j.crop_bottom != null && !(+j.crop_bottom >= 0 && +j.crop_bottom <= 0.25)) return 'crop_bottom 은 0~0.25 여야 해요.';
      const total = c.reduce((t, x) => t + (x.b - x.a) / x.speed, 0);
      return total > 58 ? `출력 길이가 ${r1(total)}초예요. 58초 이하로 줄여라.` : total < 15 ? `출력 길이가 ${r1(total)}초예요. 너무 짧아요.` : '';
    });
  writeJson(E.p('편집/AI컷.json'), { window: win, ...plan });
  for (const f of ['편집/AI완성.json', '편집/AI스타일본.mp4', '편집/AI완성.mp4']) fs.rmSync(E.p(f), { force: true });
  for (const id of ['aistyle', 'aisubs']) if (E.s.steps[id]) E.s.steps[id] = { status: 'todo' };
  await renderCut(E, ctx, info);
}

async function renderCut(E, ctx, info) {
  const plan = readJson(E.p('편집/AI컷.json')), hasA = (await probe(info.file, ctx)).hasAudio, args = [], fc = [];
  const cb = Math.min(0.25, Math.max(0, +plan.crop_bottom || 0)), crop = cb ? `crop=iw:trunc(ih*${(1 - cb).toFixed(3)}/2)*2:0:0,` : '';
  plan.cuts.forEach((c, i) => {
    const s = Math.min(1, Math.max(0.1, +c.speed || 1));
    args.push('-ss', String(c.a), '-t', String(r1(c.b - c.a + 0.05)), '-i', info.file);
    fc.push(`[${i}:v]${crop}setpts=(PTS-STARTPTS)/${s},scale=${W}:${VH}:force_original_aspect_ratio=increase,crop=${W}:${VH},fps=30,setsar=1,format=yuv420p[v${i}]`);
    const at = []; let x = s; while (x < 0.5) { at.push('atempo=0.5'); x /= 0.5; } if (x < 0.999) at.push(`atempo=${+x.toFixed(3)}`);
    fc.push(hasA ? `[${i}:a]asetpts=PTS-STARTPTS${at.length ? ',' + at.join(',') : ''},aresample=48000,aformat=channel_layouts=stereo[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=0:${((c.b - c.a) / s).toFixed(3)}[a${i}]`);
  });
  fc.push(`${plan.cuts.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${plan.cuts.length}:v=1:a=1[cv][ca]`, `[cv]pad=${W}:${H}:0:${VY}:black[vo]`);
  ctx.log('1차 컷 렌더링…');
  await ff([...args, '-filter_complex', fc.join(';'), '-map', '[vo]', '-map', '[ca]', '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', E.p('편집/AI1차컷.mp4')], ctx);
  let t = 0; plan.cuts.forEach(c => { const d = (c.b - c.a) / Math.min(1, Math.max(0.1, +c.speed || 1)); c.out = [r1(t), r1(t + d)]; t += d; });
  plan.duration = r1(t); writeJson(E.p('편집/AI컷.json'), plan);
  ctx.log(`1차 컷 완성 (${plan.duration}초) · 인트로 ${plan.cuts[0].out.join('~')}초 · 아웃트로 ${plan.cuts[plan.cuts.length - 1].out.join('~')}초`);
}

// ---------- 4. 스타일 입히기 / 5. 자막: Claude 가 AI완성.json 을 쓰고 그려요 ----------
const fineList = E => { try { return fs.readdirSync(E.p('분석')).filter(f => f.startsWith('fine_')).sort().map(f => E.p('분석', f)).join(', '); } catch { return ''; } };
function checkFinal(plan, needCaps) {
  const d = plan.duration, inT = (a, b) => a >= 0 && b > a && b <= d + 0.6;
  return j => {
    if (!needCaps) {
      if (!j.frame || !j.frame.l1 || !j.frame.l2) return 'frame.l1, frame.l2 가 있어야 해요.';
      if (j.frame.l1.length > 16 || j.frame.l2.length > 16) return '위 제목 한 줄이 너무 길어요 (14자 안팎).';
    }
    if (!needCaps) for (const [i, f] of (j.fx || []).entries()) if (!inT(f[0], f[1]) || !f[2] || !f[2].type) return `fx ${i + 1}번이 이상해요 (시각 0~${d}초, type 필요).`;
    if (!needCaps) return '';
    const c = j.captions || [];
    if (c.length < 4) return '자막이 너무 적어요.';
    for (const [i, x] of c.entries()) {
      if (!inT(x[0], x[1])) return `자막 ${i + 1}번 시각이 0~${d}초 밖이에요.`;
      if (String(x[2]).split(/\n|\\n/).some(l => l.replace(/\[\[|\]\]/g, '').length > 18)) return `자막 ${i + 1}번 한 줄이 16자를 넘어요.`;
    }
    if (c[0][0] > 0.3) return '첫 자막(인트로 후크)이 0초에 시작해야 해요.';
    if (c[c.length - 1][1] < d - 1.5) return '마지막 자막(아웃트로 후크)이 영상 끝까지 가야 해요.';
    return '';
  };
}
const common = (E, st, info, plan) => `너는 한국어 레슬링 쇼츠 채널 "${st.name}" 의 편집 작가다.
원본: "${info.title}" (${info.channel}) ${info.url}
1차 컷 편집안 (cuts 의 out = 완성 영상의 [시작초, 끝초], a/b = 원본 초, moments = 원본 시각에 보이는 것). 완성 영상 길이 ${plan.duration}초:
${JSON.stringify({ moments: plan.moments, cuts: plan.cuts, who: plan.who }, null, 1)}
프레임 시트(원본 ${r1(plan.window[0])}초부터 0.2초 간격, 5x5 타일, Read 로 확인): ${fineList(E)}
${transcript(E, info) ? '영어 중계 자막(원본 시각):\n' + transcript(E, info) : ''}
말투: ${st.tone}
사실은 화면/중계 자막에서 확인된 것, 또는 조사 파일 ${E.p('조사/research.md')} 의 A·B 등급만 쓴다. 확인 못 한 숫자/기록/과장은 쓰지 않는다. 시각은 모두 완성 영상 기준 초.`;

async function aistyle(E, ctx) {
  const st = styleOf(E), info = source(E), plan = readJson(E.p('편집/AI컷.json'));
  ctx.log('Claude 가 사실을 조사하고(source-check-research) 위 제목·선수 라벨·점수 팝업을 정해요…');
  fs.mkdirSync(E.p('조사'), { recursive: true });
  const j = await askClaude(E, ctx, `${skills(ctx, ['source-check-research', 'shorts-blueprint'])}${common(E, st, info, plan)}

주의: 1차 컷의 who 와 moments 의 선수 구분(누가 누구를 넘겼는지, 누가 이겼는지)은 틀릴 수 있다. 조사 결과와 프레임(싱글릿 글씨·색)으로 다시 확인하고, 다르면 조사와 화면을 따른다.
먼저 할 일: 이 경기·선수·대회·기록을 source-check-research 방식(한·영 검색, A/B/C 등급, 교차 확인, 확인 못 한 것 표시)으로 조사해서 Write 도구로 ${E.p('조사/research.md')} 에 저장한다.

이번 할 일: 스타일 요소만 정한다 (자막은 다음 단계).
- 위 고정 제목 l1(노랑), l2(빨강): 각 14자 이내. 이것이 인트로 후크다. 사람+결과+숫자. 설명·인사 금지.
- fx: 인트로가 끝난 직후 선수 라벨 하나 (type label, k=이름 (팀/국가), s=대회 · 체급). 점수판 컷에 점수 팝업 (type pop, text=큰 숫자 예 "4 : 0", sub=설명, y 600~700). 커리어 숫자 같은 큰 사실이 확인되면 pop 하나 더. 남발 금지. 아웃트로에는 fx 를 두지 않는다.
- credits: [[0, ${plan.duration}, "원본 채널명"]]
JSON 하나만 답해라: {"frame":{"l1":"","l2":""},"fx":[[시작,끝,{"type":"label","k":"","s":""}],[시작,끝,{"type":"pop","text":"","sub":"","y":660}]],"credits":[[0,${plan.duration},"${info.channel || ''}"]],"facts":["쓴 사실과 근거 한 줄씩"]}`, checkFinal(plan, false));
  j.captions = [];
  writeJson(E.p('편집/AI완성.json'), j);
  fs.rmSync(E.p('편집/AI완성.mp4'), { force: true });
  if (E.s.steps.aisubs) E.s.steps.aisubs = { status: 'todo' };
  await render(E, ctx, st, plan, j, '편집/AI스타일본.mp4');
}

async function aisubs(E, ctx) {
  const st = styleOf(E), info = source(E), plan = readJson(E.p('편집/AI컷.json'));
  let base; try { base = readJson(E.p('편집/AI완성.json')); } catch { throw new StepError('스타일 입히기를 먼저 해 주세요.'); }
  ctx.log('Claude 가 자막을 써요 (shorts-blueprint 자막 규칙)…');
  const j = await askClaude(E, ctx, `${skills(ctx, ['shorts-blueprint'])}${common(E, st, info, plan)}
이미 정한 위 제목·라벨·팝업 (바꾸지 말고 그대로 돌려줘라): ${JSON.stringify({ frame: base.frame, fx: base.fx, credits: base.credits })}

선수 구분과 승패는 조사 파일과 프레임 기준이다 (1차 컷의 who·moments 가 틀렸을 수 있다).
이번 할 일: 자막. 인트로와 아웃트로가 제일 중요하다. 둘 다 후크다.
- 인트로(intro 컷 구간): 0초에 바로 시작. 결과/숫자/반전을 먼저 던진다 (예: "올림픽 5연패\\n시작 15초 만에 들어 던지기"). 인사, 설명, "오늘은" 금지.
- 아웃트로(outro 컷 구간): 영상 끝까지. 다시 보게 만드는 한 줄 (예: "자, 15초 만에 [[한 번 더]].") 또는 댓글을 부르는 질문. 마지막 자막이 인트로로 이어지게.
- slow 컷에는 그 단계 이름을 "① ...", "② ...", "③ ..." 로 그 컷 구간에 정확히 맞춘다.
- 한 자막 최대 2줄, 줄당 16자 이내, 줄바꿈은 \\n. 강조할 단어 하나만 [[단어]]. 자막끼리 겹치지 않게.
JSON 하나만 답해라: {"frame":{...그대로},"fx":[...그대로],"credits":[...그대로],"captions":[[시작,끝,"텍스트"]],"facts":["쓴 사실과 근거 한 줄씩"]}`, checkFinal(plan, true));
  j.frame = base.frame; j.fx = base.fx; j.credits = base.credits;
  writeJson(E.p('편집/AI완성.json'), j);
  await render(E, ctx, st, plan, j, '편집/AI완성.mp4');
}

// ---------- 그리기 (ASS) ----------
const bgr = hex => `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}&`;
const esc = s => String(s ?? '').replace(/\\n/g, '\n').replace(/[{}\\]/g, '').replace(/\r?\n/g, '\\N');
const ts = x => { x = Math.max(0, x); const h = Math.floor(x / 3600), m = Math.floor(x % 3600 / 60), s = x % 60; return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
export function buildAss(fin, plan, st) {
  const Y = bgr(st.yellow), R = bgr(st.red), hi = s => esc(s).replace(/\[\[(.+?)\]\]/g, `{\\c${Y}}$1{\\c&HFFFFFF&}`);
  const end = plan.duration, ev = [];
  const add = (a, b, layer, style, text) => ev.push(`Dialogue: ${layer},${ts(a)},${ts(b)},${style},,0,0,0,,${text}`);
  add(0, end, 5, 'Title', `{\\an5\\pos(540,262)\\c${Y}}${esc(fin.frame?.l1)}`);
  add(0, end, 5, 'Title', `{\\an5\\pos(540,354)\\c${R}}${esc(fin.frame?.l2)}`);
  add(0, end, 4, 'Mark', `{\\an3\\pos(1050,1424)}${st.watermark[0]} {\\c${Y}}${st.watermark[1]}`);
  for (const [a, b, t] of fin.credits || []) add(a, b, 4, 'Credit', `{\\an8\\pos(540,1466)}영상: ${esc(t)}`);
  for (const [a, b, t] of fin.captions || []) add(a, b, 3, 'Cap', `{\\an2\\pos(540,1345)}${hi(t)}`);
  for (const [a, b, f] of fin.fx || []) {
    if (f.type === 'label') { add(a, b, 6, 'Label', `{\\an7\\pos(44,505)}${esc(f.k)}`); if (f.s) add(a, b, 6, 'Sub', `{\\an7\\pos(44,598)}${esc(f.s)}`); }
    else if (f.type === 'pop') {
      const y = +f.y || 660;
      add(a, b, 7, 'Pop', `{\\an8\\pos(540,${y})\\frz6\\fscx130\\fscy130\\t(0,160,\\fscx100\\fscy100)\\c${Y}}${esc(f.text)}`);
      if (f.sub) add(a, b, 7, 'PopSub', `{\\an8\\pos(540,${y + 215})\\frz6}${esc(f.sub)}`);
    } else if (f.type === 'badge') add(a, b, 6, 'Badge', `{\\an9\\pos(1040,500)}${esc(f.text)}`);
  }
  if (!(fin.fx || []).some(([, , f]) => f.type === 'badge'))   // 슬로우 컷에는 SLOW 배지 자동
    for (const c of plan.cuts) if ((+c.speed || 1) < 1) add(c.out[0], c.out[1], 6, 'Badge', `{\\an9\\pos(1040,500)}SLOW ${+(+c.speed).toFixed(2)}x`);
  const S = (n, size, col, outline, border = 1, back = '&H00000000&') => `Style: ${n},${FONT},${size},${col},&H000000FF&,${border === 3 ? back : '&H00000000&'},${back},-1,0,0,0,100,100,0,0,${border},${outline},0,5,0,0,0,1`;
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${[S('Title', 84, '&H00FFFFFF&', 0), S('Cap', 74, '&H00FFFFFF&', 7), S('Label', 50, '&H00FFFFFF&', 14, 3, R), S('Sub', 36, '&H00FFFFFF&', 12, 3, '&H80303030&'),
    S('Pop', 230, '&H00FFFFFF&', 12), S('PopSub', 62, '&H00FFFFFF&', 7), S('Badge', 44, '&H00000000&', 10, 3, Y), S('Mark', 46, '&H00FFFFFF&', 3), S('Credit', 34, '&H00FFFFFF&', 0)].join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join('\n')}
`;
}

async function render(E, ctx, st, plan, fin, outRel) {
  const assF = E.p('편집/AI완성.ass'); fs.writeFileSync(assF, buildAss(fin, plan, st));
  const bgmDir = path.join(E.homeRoot || path.join(HOME, 'Desktop/유투브'), '소리/BGM');
  const bgm = exists(bgmDir) ? fs.readdirSync(bgmDir).filter(f => /\.(mp3|m4a|wav|aac)$/i.test(f)).sort()[0] : null;
  const d = plan.duration, q = p => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const vf = `[0:v]subtitles=filename='${q(assF)}':fontsdir='${q(process.env.FIELDNOTE_AI_FONT_DIR || FONT_DIR)}'[vo]`;
  const af = bgm ? `;[1:a]volume=0.22,atrim=0:${d},afade=t=out:st=${Math.max(0, d - 1.5)}:d=1.5[b];[0:a][b]amix=inputs=2:duration=first:normalize=0[ao]` : ';[0:a]anull[ao]';
  ctx.log(`그리는 중 (${st.name}${bgm ? ' · BGM ' + bgm : ' · BGM 없음: ~/Desktop/유투브/소리/BGM 에 넣으면 깔려요'})…`);
  try {
    await ff(['-i', E.p('편집/AI1차컷.mp4'), ...(bgm ? ['-stream_loop', '-1', '-i', path.join(bgmDir, bgm)] : []), '-filter_complex', vf + af,
      '-map', '[vo]', '-map', '[ao]', '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', '-t', String(d), '-movflags', '+faststart', E.p(outRel)], ctx);
  } catch (e) {
    if (e instanceof StopError) throw e;
    throw new StepError(/No such filter: 'subtitles'|Filter not found/.test(e.err || '') ? 'ffmpeg 에 자막 기능(libass)이 없어요.' : 'ffmpeg 오류: ' + lastLines(e.err));
  }
  ctx.log('완성: ' + outRel);
}

export const AI_FN = { aicut, aistyle, aisubs };
