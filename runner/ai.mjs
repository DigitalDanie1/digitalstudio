// AI 편집 (yt-wrestling 작업판): 하이라이트 1차 컷 -> 스타일 입히기 -> 자막. 판단은 이 맥의 Claude Code(claude -p), 그리기는 ffmpeg.
// 단계: aicut(편집/AI컷.json, AI1차컷.mp4) -> aistyle(편집/AI완성.json 제목·라벨·팝업, AI스타일본.mp4) -> aisubs(자막 추가, AI완성.mp4)
// 인트로·아웃트로는 모든 단계에서 후크로 다뤄요: 컷(첫 컷 intro, 마지막 컷 outro) / 스타일(위 제목) / 자막(0초 후크, 마지막 줄 후크).
import fs from 'node:fs';
import path from 'node:path';
import { HOME, FFMPEG, YTDLP, FONT_DIR, FONT_NAME, StepError, StopError, run, ff, probe, lastLines, exists, parseVtt } from './util.mjs';

// 자동실행(launchd)은 PATH 가 짧아서 Claude Code 가 깔리는 곳을 직접 찾아요
const CLAUDE = process.env.FIELDNOTE_CLAUDE || [path.join(HOME, '.local/bin/claude'), path.join(HOME, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(exists) || 'claude';
const FONT = process.env.FIELDNOTE_AI_FONT || FONT_NAME;
const W = 1080, H = 1920, VY = 470, VH = 970;   // 화면 틀: 경기 화면은 y=470 부터 1080x970
// 채널마다: 무엇을 하이라이트로 보는지(kind), 말투, 브랜드. 로고·핸들이 없으면 인트로·아웃트로는 글자만 넣어요.
const SPORT = {
  kind: 'sport',
  pick: '한 번에 보이는 결정적 기술(들어 던지기, 테이크다운, 폴, 역전), 점수판이 크게 바뀌는 순간, 관중/중계가 터지는 순간',
  cut: `결정적 기술 하나를 중심으로 짠다.
1) intro (후크, 1.5~3초): 맥락 설명 없이 제일 충격적인 순간부터. 첫 프레임부터 몸이 움직이고 있어야 한다.
2) 점수판/결과가 보이는 장면이 있으면 짧게 (role score, 1.5~3초)
3) 같은 기술을 슬로우로 다시: 동작을 2~3단계(예: 낮추기 / 허리 감기 / 넘기기)로 나눠 단계마다 컷 하나 (role slow, step 에 단계 이름). speed 는 0.15~0.5, 단계 하나가 출력에서 4~7초가 되게.
4) 기술 뒤 반응/세리머니가 있으면 원속도 (role after)
5) outro (후크, 2~4초): 다시 보고 싶게. 마지막 프레임이 intro 첫 프레임으로 이어지는 루프가 기본.
전체 출력 길이는 30~50초.`,
  roles: 'intro|score|slow|after|outro',
  who: '선수/팀/대회. 누가 어느 쪽인지는 싱글릿 글씨·색·점수판 이름 같은 화면 근거로만 정하고 근거를 괄호로 적어라. 확실하지 않으면 빈칸',
  check: '1차 컷의 who 와 moments 의 선수 구분(누가 누구를 넘겼는지, 누가 이겼는지)은 틀릴 수 있다. 조사 결과와 프레임(싱글릿 글씨·색)으로 다시 확인한다.',
  fx: '인트로가 끝난 직후 선수 라벨 하나 (type label, k=이름 (팀/국가), s=대회 · 체급). 점수판 컷에 점수 팝업 (type pop, text=큰 숫자 예 "4 : 0", sub=설명, y 600~700). 커리어 숫자 같은 큰 사실이 확인되면 pop 하나 더.',
  caps: '- slow 컷에는 그 단계 이름을 "① ...", "② ...", "③ ..." 로 그 컷 구간에 정확히 맞춘다.',
  thumbL: '주인공의 결정적 액션 컷', thumbR: '관중/상대/코치의 리액션 컷 (얼굴 표정이 보여야 함)',
};
const TALK = {
  kind: 'talk',
  pick: '가장 논쟁적이거나 감정이 터지는 발언, 청중·상대 반응이 터지는 순간 (중계 자막을 꼭 보고 판단)',
  cut: `화자의 가장 강한 발언 하나를 중심으로 짠다. 모든 컷은 speed 1 (슬로우 없음).
1) intro (후크, 2~4초): 가장 센 한 마디가 나오는 순간. 맥락 설명 없이 바로.
2) main 컷 1~3개: 그 발언의 맥락과 핵심 논지. 문장 중간에서 끊지 마라 (중계 자막 시각으로 문장 경계를 확인).
3) 청중·상대 반응이 있으면 짧게 (role react, 1.5~3초)
4) outro (후크, 2~4초): 결론 한 마디, 또는 반박이 나오기 직전에서 끊기.
전체 출력 길이는 30~55초.`,
  roles: 'intro|main|react|outro',
  who: '화자 이름·직함·자리(토론회, 설교, 인터뷰 등). 화면 이름 자막이나 중계 자막 근거로만 적고 근거를 괄호로. 확실하지 않으면 빈칸',
  check: '1차 컷의 who 와 moments 는 틀릴 수 있다. 조사 결과와 화면 이름 자막·중계 자막으로 다시 확인한다.',
  fx: '인트로가 끝난 직후 화자 라벨 하나 (type label, k=이름, s=직함 · 자리). 확인된 핵심 숫자가 있으면 팝업 하나 (type pop, text=숫자, sub=설명, y 600~700). 없으면 팝업 없음.',
  caps: '- 화자의 영어 발언은 뜻이 바뀌지 않게 한국어로 옮기고, 그 말이 나오는 시각에 맞춘다. 영상에 없는 말을 지어내지 마라.',
  thumbL: '화자가 가장 강한 표정·손짓을 하는 컷', thumbR: '청중/상대의 리액션 컷 (얼굴 표정이 보여야 함)',
};
const TALK_RULES = ['자막과 문장은 모두 한국어로만. 영어 문장을 그대로 두지 않는다.', '화자의 말을 옮길 때 누가 한 말인지 분명히 밝힌다.', '영상에 없는 발언을 지어내지 않는다.'];
export const AI_STYLES = {
  'yt-mat': { ...SPORT, genre: '레슬링', name: 'MAT STORY', handle: '@matstoryhq', logo: '브랜드/matstory_logo.png', watermark: ['MAT', 'STORY'], yellow: 'FFD600', red: 'FF3B30', tone: '반말, 짧고 세게. 레슬링을 모르는 사람도 알아듣게. 위 제목 2줄 끝에 "ㄷㄷ" 가능.' },
  'yt-christian': { ...TALK, genre: '기독교 해설', name: '', handle: '', logo: '브랜드/christian_logo.png', watermark: null, yellow: '3DE0C0', red: 'FFFFFF', cta: '0E1B33', rules: TALK_RULES,
    tone: '존댓말, 차분하지만 단호하게. 성경과 교리는 쉬운 말로. 이단성 주장에는 날카롭게, 교단의 공식 판단과 의견은 나눠서. 사람을 조롱하지 않는다.' },
  'yt-politics': { ...TALK, genre: '보수·기독교 가치 관점의 정치·이민 시사 해설', name: '', handle: '', logo: '브랜드/politics_logo.png', watermark: ['FIELD', 'NOTE'], yellow: 'FFD400', red: 'FF3B30', rules: TALK_RULES,
    tone: '존댓말, 짧고 단단하게. 사실, 추정("~로 알려져 있어요"), 의견("제 생각엔")을 나눠서. 사람을 조롱하지 않는다.' },
};
// 레퍼런스 쇼츠 5개를 본뜬 레슬링 스타일 (스타일 선택 단계에서 고름). lay = 화면 틀, 나머지는 MAT STORY 와 같아요.
const MAT = AI_STYLES['yt-mat'];
const PT = '(type ring 은 x,y = 프레임 시트에서 본 그 부위의 위치, 0=왼쪽/위 1=오른쪽/아래)';
Object.assign(AI_STYLES, {
  'yt-replay': { ...MAT, lay: 'full',
    fx: `결정적 순간에 링 하나 (type ring, x, y) ${PT}. 라벨·팝업은 쓰지 않는다. 깔끔하게.`,
    caps: '- 자막은 짧은 말풍선처럼: 선수·코치·중계가 할 법한 한마디 또는 짧은 상황 설명 (예: "준비됐어?", "끝났다"). 한 줄 10자 안팎.' },
  'yt-breakdown': { ...MAT, lay: 'full', explain: true,
    fx: `슬로우 단계마다 그 단계의 핵심 부위(손·발·허리·머리)에 링 하나 (type ring, x, y) ${PT}, 필요하면 화살표 (type arrow, x, y = 화살표 끝이 가리킬 곳). 인트로 직후 선수 라벨 하나 (type label, k=이름 (팀/국가), s=대회 · 체급).`,
    caps: '- 해설자처럼 기술을 풀어 준다. slow 컷마다 "① ...", "② ...", "③ ..." 로 그 단계에서 무엇을 보는지 정확히 짚는다.' },
  'yt-top5': { ...MAT, lay: 'rank',
    title: '위 제목: l1 = "TOP 3" 처럼 순위 개수 (ranks 개수와 같게), l2 = 주제 키워드 (예: 들어 던지기). 각 10자 이내.',
    extra: 'ranks: 인트로·아웃트로를 뺀 컷들로 순위 목록을 만든다. 큰 숫자부터 1위 순서로 나오게 [[시작, 끝, "순위 이름(12자 이내)"]], 2~5개, 시각은 그 장면이 나오는 구간.',
    extraJson: ',"ranks":[[시작,끝,"이름"]]',
    fx: '팝업·라벨은 쓰지 않는다 (순위 목록이 대신해요). fx 는 빈 배열.',
    caps: '- 자막은 화면 아래에 짧게. 순위가 바뀌는 순간 "3위: ..." 처럼 순위를 말해 준다.' },
  'yt-wordpop': { ...MAT, lay: 'full', words: true,
    fx: `때리는 순간·넘기는 순간마다 화살표 (type arrow, x, y = 화살표 끝이 가리킬 곳) 또는 링 (type ring, x, y) ${PT}. 3~6개.`,
    caps: '- 자막은 한 단어씩 화면 가운데 튀어나와요. 한 자막은 짧은 말(2~5단어), 쉬운 말로 계속 이어지게 말하듯 쓴다.' },
  'yt-post': { ...MAT, lay: 'post', white: true,
    title: '위 제목: 검은 굵은 글씨 2줄 (l1, l2 각 14자 이내). 이것이 인트로 후크다. 예: "외국인들도 충격받는 / 심권호의 레전드 기술".',
    extra: 'note: 영상 아래 카드에 채널이 남기는 한마디 (20자 이내, 시청자인 척하지 말고 채널 말투로. 예: "이 속도가 진짜 말이 안 됨").',
    extraJson: ',"note":""',
    fx: '라벨·팝업은 쓰지 않는다. fx 는 빈 배열.',
    caps: '- 자막은 영상 안 아래쪽에 노란 글씨로 짧게 (예: "(순식간에 뒤집힘)"). 괄호 감탄도 좋다.' },
});
export const AI_OUT = { aicut: ['편집/AI컷.json', '편집/AI1차컷.mp4'], aistyle: ['조사/research.md', '편집/AI완성.json', '편집/AI스타일본.mp4'], aisubs: ['편집/AI완성.mp4'], aibrand: ['편집/AI인트로.mp4', '편집/AI아웃트로.mp4', '편집/AI최종.mp4'], aithumb: ['편집/AI썸네일.jpg', '편집/AI썸네일.json'] };

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
// 채널의 AI 스타일: 고른 룩이 AI 스타일이면 그것, 아니면 채널 기본
const CH_STYLE = { 'yt-wrestling': 'yt-mat', 'yt-christian': 'yt-christian', 'yt-politics': 'yt-politics' };
// 영상 종류 (레슬링): 처음에 고르면 1차 컷·자막·라벨이 그 틀로 짜여요. 없으면 하이라이트.
export const VTYPES = {
  highlight: { vname: '하이라이트' },
  analysis: { vname: '분석',
    pick: '기술 하나가 준비 자세 → 진입 → 마무리까지 깨끗하게 다 보이는 장면',
    cut: `기술 하나를 해부한다 (Fight Lab "A closer look" 방식).
1) intro (1.5~2.5초): 기술이 터지는 결과 장면, 원속도.
2) setup (role setup, 2~4초): 기술 직전 자세, speed 0.5.
3) 기술을 3~4단계로 쪼개 단계마다 컷 하나 (role slow, step 에 단계 이름). speed 0.15~0.35, 단계 하나가 출력에서 5~8초. 손 위치·발 위치·무게중심이 보이는 순간으로.
4) outro (2~4초): 같은 기술을 원속도로 처음부터 끝까지 한 번 더.
전체 출력 길이는 30~55초.`,
    roles: 'intro|setup|slow|outro',
    fx: '인트로가 끝난 직후 선수 라벨 하나 (type label, k=이름 (팀/국가), s=대회 · 체급). 점수 팝업은 꼭 필요할 때만.',
    caps: '- slow 컷마다 "① 단계 이름" 다음 줄에 왜 되는지 한 줄 (손·발·무게중심·타이밍 중 하나). 결과 자랑보다 원리 설명.' },
  top5: { vname: 'TOP 5', multi: true,
    pick: '서로 다른 장면 3~5개: 각각 한 번에 보이는 결정적 기술·역전·명장면. 비슷한 장면 중복 금지',
    cut: `골라 둔 장면들로 카운트다운 랭킹을 만든다.
1) intro (1.5~2.5초): 1위 장면의 가장 센 순간을 먼저 살짝.
2) rank 컷: 낮은 순위부터 1위까지 (장면 5개면 5위→1위, 3개면 3위→1위). 순위마다 원속도 3~8초 (role rank, step 에 "N위 · 기술/선수 이름"). 1위는 슬로우 컷 하나 더 가능 (role slow).
3) outro (2~3초): 1위 장면을 다시.
전체 출력 길이는 30~58초.`,
    roles: 'intro|rank|slow|outro',
    fx: '각 rank 컷 시작에 순위 라벨 (type label, k="N위", s=기술 · 선수 이름). 점수 팝업 없음.',
    caps: '- rank 컷이 시작할 때마다 "N위" + 왜 이 순위인지 한 줄. 순위는 컷 순서와 같게.' },
  info: { vname: '간단 정보',
    pick: '팁 하나·실수 하나·규칙 하나를 보여 주기 좋은 장면 (실수하는 순간, 규칙이 적용되는 순간, 위험한 습관)',
    cut: `정보 한 가지만 전한다 (예: "프로 선수들도 무심코 하는 최악의 습관"). 짧게.
1) intro (1.5~3초): 문제 장면(실수·반칙·위험한 습관)부터.
2) main 1~2컷 (원속도 또는 speed 0.5): 왜 문제인지 보이는 장면.
3) fix 컷이 있으면 (role fix): 올바른 모습.
4) outro (2~3초): 핵심 한 줄로 끝낼 장면.
전체 출력 길이는 15~30초.`,
    roles: 'intro|main|slow|fix|outro',
    fx: '라벨 하나 (type label, k=주제 이름, s=한 줄 설명). 팝업 없음.',
    caps: '- 정보 하나만. 질문 → 이유 → 답 순서. 문장은 짧게.' },
};
// 레퍼런스 쇼츠 룩 (look = "ref-<영상ID>"): 스타일 입히기 때 그 쇼츠를 받아 Claude 가 보고 가장 가까운 틀 + 색·제목·이펙트·자막 규칙을 정해요 (E.s.refStyle)
export const isRefLook = l => /^ref-[\w-]{11}$/.test(l || '');
const REF_BASES = { 'yt-mat': '검은 바탕, 위에 큰 2줄 제목(노랑/빨강), 가운데 경기 화면, 아래 자막, 선수 라벨·점수 팝업', 'yt-replay': '꽉 찬 경기 화면, 짧은 말자막, 결정적 순간 링, 위 제목 없음', 'yt-breakdown': '꽉 찬 화면, 핵심 부위 링·화살표, ①②③ 해설 자막, SLOW 표시', 'yt-top5': '위 "TOP N" + 키워드, 흐린 배경 위 경기 화면, 아래 순위 목록', 'yt-wordpop': '꽉 찬 화면, 가운데 한 단어씩 튀어나오는 자막, 화살표·링', 'yt-post': '흰 바탕 SNS 게시물 모양, 검은 굵은 제목 2줄, 가운데 영상, 아래 채널 한마디 카드' };
const REF_FX = { 'yt-mat': 'label, pop, badge', 'yt-top5': '(없음, 빈 배열)', 'yt-post': '(없음, 빈 배열)' };
const styleOf = E => { const rs = isRefLook(E.s.look) && E.s.refStyle && E.s.refStyle.look === E.s.look ? E.s.refStyle : null;
  const st = rs ? { ...AI_STYLES[rs.base], ...rs.over } : AI_STYLES[E.s.look || ''] || AI_STYLES[CH_STYLE[E.s.channel] || 'yt-mat']; const v = st.kind === 'sport' && VTYPES[E.s.vtype]; return v ? { ...st, ...v } : st; };

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
      if (/authentication_error|Failed to authenticate|Re-authenticate/i.test(String(e.out || '') + String(e.err || ''))) throw new StepError('맥의 Claude Code 로그인이 만료됐어요. 맥 터미널에서 claude 를 실행해 /login 으로 다시 로그인한 뒤 다시 누르세요.');
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

// 원본 영어 자막 -> 완성 영상 시각의 말 덩어리 (컷 순서·자르기 반영). 말 자막 시각은 코드가 정해서 말과 자막이 어긋나지 않게 해요.
// 슬로우 컷은 소리가 없어서 빼요.
export function speechSegs(cues, cuts) {
  const out = [];
  for (const c of cuts) {
    const a = +c.a, b = +c.b, sp = +c.speed || 1, o = +c.out[0];
    if (sp < 1) continue;
    let cur = null;
    for (const q of cues) {
      if (q.end <= a || q.start >= b) continue;
      const s = r1(o + (Math.max(q.start, a) - a) / sp), e = r1(o + (Math.min(q.end, b) - a) / sp);
      if (e - s < 0.25) continue;
      if (cur && s - cur.e < 0.4 && e - cur.s <= 3.2 && (cur.t + ' ' + q.text).split(/\s+/).length <= 14) { cur.e = e; cur.t += ' ' + q.text; }
      else { cur = { s, e, t: q.text }; out.push(cur); }
    }
  }
  return out.map((x, i) => ({ id: i + 1, ...x }));
}
const segsOf = (E, info, plan) => { const f = info.subFile && E.p(info.subFile); return f && exists(f) ? speechSegs(parseVtt(fs.readFileSync(f, 'utf8')), plan.cuts) : []; };
// Claude 답 {lines:[[[S번호..],"한국어"]], captions:[[a,b,"글"]]} -> captions 하나로. lines 의 시각은 S 시각 그대로.
export function mergeCaps(j, segs) {
  const byId = new Map(segs.map(x => [x.id, x])), made = [];
  for (const [i, l] of (j.lines || []).entries()) {
    const ids = (Array.isArray(l[0]) ? l[0] : [l[0]]).map(Number);
    if (!ids.length || ids.some(k => !byId.has(k))) return { err: `lines ${i + 1}번의 S 번호가 없어요.` };
    if (ids.some((k, n) => n && k !== ids[n - 1] + 1)) return { err: `lines ${i + 1}번의 S 번호는 이어져야 해요.` };
    if (!String(l[1] || '').trim()) return { err: `lines ${i + 1}번 한국어가 비었어요.` };
    made.push([byId.get(ids[0]).s, byId.get(ids[ids.length - 1]).e, String(l[1]), true]);
  }
  for (const [i, c] of (j.captions || []).entries()) {
    if (made.some(m => m[3] && c[0] < m[1] - 0.05 && c[1] > m[0] + 0.05)) return { err: `captions ${i + 1}번이 말 자막(lines)과 겹쳐요. 말이 있는 곳은 lines 로만.` };
    made.push([+c[0], +c[1], String(c[2])]);
  }
  made.sort((x, y) => x[0] - y[0]);
  for (const [k, m] of made.entries()) {   // 너무 짧은 말 자막은 다음 자막 전까지 조금 늘려서 읽히게
    const nx = made[k + 1]; if (m[3] && m[1] - m[0] < 1.2) m[1] = r1(Math.min(m[0] + 1.2, nx ? nx[0] : m[0] + 1.2));
  }
  return { captions: made.map(m => [m[0], m[1], m[2]]) };
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
  const st = styleOf(E);
  const info = source(E), dur = (await probe(info.file, ctx)).duration;
  if (!dur) throw new StepError('영상 길이를 못 읽었어요.');
  const tr = transcript(E, info), trTxt = tr ? '영어 중계 자막(원본 시각):\n' + tr : '(중계 자막 없음)';
  let win = [0, dur], picks = null;
  if (dur > 60) {
    ctx.log('전체 영상을 2초 간격으로 훑어봐요…');
    const coarse = await sheets(E, ctx, info.file, 'coarse', 0, dur, 0.5, 6, 5, 320);
    if (st.multi) {
      const pk = await askClaude(E, ctx, `너는 ${st.genre} 쇼츠 편집자다. 아래 영상에서 TOP 랭킹 쇼츠에 넣을 장면을 고른다.
영상: "${info.title}" (${info.channel}), 길이 ${Math.round(dur)}초.
아래 썸네일 시트를 Read 도구로 전부 보고 판단해라:
${coarse}
${trTxt}
고를 기준: ${st.pick}.
JSON 하나만 답해라: {"picks":[{"a": 시작초, "b": 끝초, "why": "한 줄"}]}  (장면 3~5개, 각 b-a 는 4~15초, 결정적 순간 앞 2초 이상 포함)`,
        j => !Array.isArray(j.picks) || j.picks.length < 3 || j.picks.length > 5 ? 'picks 는 3~5개여야 해요.' : j.picks.some(x => !(x.b > x.a) || x.a < 0 || x.b > dur + 1 || x.b - x.a > 20) ? `각 장면은 0~${Math.round(dur)}초 안, 20초 이하.` : '');
      picks = pk.picks.map(x => [Math.max(0, +x.a), Math.min(dur, +x.b)]);
      win = [Math.min(...picks.map(x => x[0])), Math.max(...picks.map(x => x[1]))];
      ctx.log(`  고른 장면 ${picks.length}개: ${picks.map(x => `${r1(x[0])}~${r1(x[1])}`).join(', ')}`);
    } else {
    const pick = await askClaude(E, ctx, `너는 ${st.genre} 쇼츠 편집자다. 아래 영상에서 세로 쇼츠 하나로 만들 가장 강한 하이라이트 한 장면을 고른다.
영상: "${info.title}" (${info.channel}), 길이 ${Math.round(dur)}초.
아래 썸네일 시트를 Read 도구로 전부 보고 판단해라:
${coarse}
${trTxt}
고를 기준: ${st.pick}.
JSON 하나만 답해라: {"a": 시작초, "b": 끝초, "why": "한 줄"}  (b-a 는 15~40초, 결정적 순간 앞 3초 이상 포함)`,
      j => !(j.b > j.a) ? 'b 가 a 보다 커야 해요.' : j.a < 0 || j.b > dur + 1 ? `시각은 0~${Math.round(dur)}초 안이어야 해요.` : j.b - j.a > 60 ? '60초를 넘어요.' : '');
    win = [Math.max(0, +pick.a), Math.min(dur, +pick.b)];
    ctx.log(`  고른 장면: ${r1(win[0])}~${r1(win[1])}초 · ${pick.why || ''}`);
    }
  }
  ctx.log('고른 장면을 0.2초 간격으로 봐요…');
  let fine;
  if (picks) { try { for (const f of fs.readdirSync(E.p('분석'))) if (f.startsWith('fine_')) fs.rmSync(E.p('분석', f)); } catch {} const parts = []; for (const [k, [a, b]] of picks.entries()) parts.push(await sheets(E, ctx, info.file, `fine_${k + 1}`, a, b - a, 5, 5, 5, 384)); fine = parts.join('\n'); }
  else fine = await sheets(E, ctx, info.file, 'fine', win[0], win[1] - win[0], 5, 5, 5, 384);
  const plan = await askClaude(E, ctx, `${skills(ctx, ['shorts-blueprint', 'edit-plan-sheet'])}너는 ${st.genre} 쇼츠 편집자다. 아래는 "${info.title}" 의 ${picks ? `골라 둔 장면 ${picks.length}개(${picks.map(x => `${r1(x[0])}~${r1(x[1])}초`).join(', ')})` : `원본 ${r1(win[0])}~${r1(win[1])}초`}를 0.2초 간격으로 뽑은 프레임 시트다. Read 도구로 전부 봐라:
${fine}
${trTxt}

할 일: 세로 쇼츠 1차 컷 편집안을 짠다. 인트로와 아웃트로가 제일 중요하다. 둘 다 후크여야 한다. 스크롤을 멈추게 하는 장면으로 시작한다.
${st.cut}
각 컷의 출력 길이는 (b-a)/speed. 첫 컷은 반드시 intro, 마지막 컷은 반드시 outro.
시각은 반드시 프레임에서 직접 확인한 원본 초(소수점 1자리)로 적어라.

JSON 하나만 답해라:
{"moments":[{"t":원본초,"what":"그 순간 화면에 보이는 것"}],
 "cuts":[{"a":원본초,"b":원본초,"speed":1,"role":"${st.roles}","step":"슬로우 단계 이름(slow 일 때만)"}],
 "who":"${st.who}",
 "crop_bottom": 화면 아래쪽 중계 띠(뉴스 티커·광고 띠 등)가 차지하는 높이 비율 0~0.25 (없으면 0. 장면이 잘리지 않게)}`,
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
  writeJson(E.p('편집/AI컷.json'), { window: win, vtype: E.s.vtype || 'highlight', sheets: fine, ...plan });
  for (const f of ['편집/AI완성.json', '편집/AI스타일본.mp4', '편집/AI완성.mp4']) fs.rmSync(E.p(f), { force: true });
  for (const id of ['aistyle', 'aisubs', 'aibrand', 'aithumb']) if (E.s.steps[id]) E.s.steps[id] = { status: 'todo' };
  await renderCut(E, ctx, info);
}

// 화면 틀: 영상 칸 y(vy)·높이(vh)·바탕. mat 이 기본 (1차 컷은 늘 이 틀로 만들고, 다른 틀은 스타일을 입힐 때 같은 컷으로 다시 그려요)
const LAY = { mat: { vy: VY, vh: VH, bg: 'black' }, full: { vy: 0, vh: H, bg: 'black' }, rank: { vy: 430, vh: 608, bg: 'blur' }, post: { vy: 500, vh: 866, bg: 'white' } };
const layOf = st => LAY[st.lay] || LAY.mat;
async function renderCut(E, ctx, info, lay = LAY.mat, outRel = '편집/AI1차컷.mp4') {
  const VY = lay.vy, VH = lay.vh;
  const plan = readJson(E.p('편집/AI컷.json')), hasA = (await probe(info.file, ctx)).hasAudio, args = [], fc = [];
  const cb = Math.min(0.25, Math.max(0, +plan.crop_bottom || 0)), crop = cb ? `crop=iw:trunc(ih*${(1 - cb).toFixed(3)}/2)*2:0:0,` : '';
  plan.cuts.forEach((c, i) => {
    const s = Math.min(1, Math.max(0.1, +c.speed || 1));
    args.push('-ss', String(c.a), '-t', String(r1(c.b - c.a + 0.05)), '-i', info.file);
    fc.push(`[${i}:v]${crop}setpts=(PTS-STARTPTS)/${s},scale=${W}:${VH}:force_original_aspect_ratio=increase,crop=${W}:${VH},fps=30,setsar=1,format=yuv420p[v${i}]`);
    const at = []; let x = s; while (x < 0.5) { at.push('atempo=0.5'); x /= 0.5; } if (x < 0.999) at.push(`atempo=${+x.toFixed(3)}`);
    // 슬로우 구간은 배경음 없이 (늘어진 현장음은 지저분해요)
    fc.push(hasA && s >= 1 ? `[${i}:a]asetpts=PTS-STARTPTS${at.length ? ',' + at.join(',') : ''},aresample=48000,aformat=channel_layouts=stereo[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=0:${((c.b - c.a) / s).toFixed(3)}[a${i}]`);
  });
  fc.push(`${plan.cuts.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${plan.cuts.length}:v=1:a=1[cv][ca]`, lay.bg === 'blur'
    ? `[cv]split[cf][cb];[cb]scale=-2:${H},crop=${W}:${H},boxblur=28:2,eq=brightness=-0.3[bb];[bb][cf]overlay=0:${VY}[vo]`
    : `[cv]pad=${W}:${H}:0:${VY}:${lay.bg === 'white' ? 'white' : 'black'}[vo]`);
  ctx.log(outRel === '편집/AI1차컷.mp4' ? '1차 컷 렌더링…' : '고른 스타일의 화면 틀로 컷을 다시 그려요…');
  await ff([...args, '-filter_complex', fc.join(';'), '-map', '[vo]', '-map', '[ca]', '-c:v', 'libx264', '-crf', '20', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', E.p(outRel)], ctx);
  let t = 0; plan.cuts.forEach(c => { const d = (c.b - c.a) / Math.min(1, Math.max(0.1, +c.speed || 1)); c.out = [r1(t), r1(t + d)]; t += d; });
  plan.duration = r1(t); writeJson(E.p('편집/AI컷.json'), plan);
  ctx.log(`1차 컷 완성 (${plan.duration}초) · 인트로 ${plan.cuts[0].out.join('~')}초 · 아웃트로 ${plan.cuts[plan.cuts.length - 1].out.join('~')}초`);
}

// ---------- 4. 스타일 입히기 / 5. 자막: Claude 가 AI완성.json 을 쓰고 그려요 ----------
const fineList = E => { try { return fs.readdirSync(E.p('분석')).filter(f => f.startsWith('fine_')).sort().map(f => E.p('분석', f)).join(', '); } catch { return ''; } };
function checkFinal(plan, needCaps, st = {}) {
  const d = plan.duration, inT = (a, b) => a >= 0 && b > a && b <= d + 0.6, in01 = v => +v >= 0 && +v <= 1;
  return j => {
    if (!needCaps) for (const [i, f] of (j.fx || []).entries()) if (f && f[2] && ['ring', 'arrow'].includes(f[2].type) && !(in01(f[2].x) && in01(f[2].y))) return `fx ${i + 1}번 x, y 는 0~1 이어야 해요.`;
    if (!needCaps && st.lay === 'rank') {
      const r = j.ranks; if (!Array.isArray(r) || r.length < 2 || r.length > 5) return 'ranks 가 2~5개 있어야 해요.';
      for (const [i, x] of r.entries()) { if (!inT(x[0], x[1])) return `ranks ${i + 1}번 시각이 0~${d}초 밖이에요.`; if (!x[2] || String(x[2]).length > 14) return `ranks ${i + 1}번 이름이 없거나 길어요 (12자 이내).`; }
    }
    if (!needCaps && st.lay === 'post' && (!j.note || String(j.note).length > 24)) return 'note 가 없거나 길어요 (20자 이내).';
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
const common = (E, st, info, plan, noTr = false) => `너는 한국어 ${st.genre} 쇼츠 채널${st.name ? ` "${st.name}"` : ''}의 편집 작가다.
원본: "${info.title}" (${info.channel}) ${info.url}
1차 컷 편집안 (cuts 의 out = 완성 영상의 [시작초, 끝초], a/b = 원본 초, moments = 원본 시각에 보이는 것). 완성 영상 길이 ${plan.duration}초:
${JSON.stringify({ moments: plan.moments, cuts: plan.cuts, who: plan.who }, null, 1)}
프레임 시트 (Read 로 확인):
${plan.sheets || `원본 ${r1(plan.window[0])}초부터 0.2초 간격, 5x5 타일: ${fineList(E)}`}
${!noTr && transcript(E, info) ? '영어 중계 자막(원본 시각):\n' + transcript(E, info) : ''}
말투: ${st.tone}
${(st.rules || []).map(r => '- ' + r).join('\n')}
사실은 화면/중계 자막에서 확인된 것, 또는 조사 파일 ${E.p('조사/research.md')} 의 A·B 등급만 쓴다. 확인 못 한 숫자/기록/과장은 쓰지 않는다. 시각은 모두 완성 영상 기준 초.`;

async function refStyle(E, ctx) {
  if (!isRefLook(E.s.look) || (E.s.refStyle && E.s.refStyle.look === E.s.look)) return;
  const id = E.s.look.slice(4), dir = path.join(HOME, 'Desktop/유투브/레퍼런스', id), cache = path.join(dir, 'style.json');
  if (exists(cache)) { try { E.s.refStyle = readJson(cache); if (E.s.refStyle.look === E.s.look) { ctx.log(`레퍼런스 스타일: ${E.s.refStyle.name} (전에 분석한 것)`); return; } } catch {} }
  fs.mkdirSync(dir, { recursive: true });
  const vid = path.join(dir, 'ref.mp4');
  ctx.log('레퍼런스 쇼츠를 받아요…');
  let title = '';
  try { const r = await run(YTDLP, ['--no-playlist', '--no-warnings', '--no-simulate', '-O', 'title', '-f', 'b[height<=720][ext=mp4]/bv*[height<=720]+ba/b', '--merge-output-format', 'mp4', '--force-overwrites', '-o', vid, 'https://www.youtube.com/shorts/' + id], ctx); title = r.out.trim().split('\n')[0] || ''; }
  catch (e) { if (e instanceof StopError) throw e; throw new StepError('레퍼런스 쇼츠를 받지 못했어요: ' + (lastLines(e.err) || e.message)); }
  const dur = (await probe(vid, ctx)).duration || 60, fps = Math.min(2, 40 / dur);
  const out = E.p('분석'); fs.mkdirSync(out, { recursive: true });
  for (const f of fs.readdirSync(out)) if (f.startsWith('ref_')) fs.rmSync(path.join(out, f));
  await ff(['-i', vid, '-vf', `fps=${fps.toFixed(3)},scale=216:-2,tile=5x4`, '-q:v', '4', path.join(out, 'ref_%02d.jpg')], ctx);
  const list = fs.readdirSync(out).filter(f => f.startsWith('ref_')).sort().map(f => '- ' + path.join(out, f)).join('\n');
  // 말하는 채널(기독교·정치)은 채널 스타일(말투·규칙)은 그대로 두고 화면 틀만 고르게 해요
  const chKey = CH_STYLE[E.s.channel] || 'yt-mat', talk = AI_STYLES[chKey].kind !== 'sport';
  const bases = talk ? { mat: '검은 바탕, 위 2줄 제목, 가운데 영상, 아래 자막, 화자 라벨·숫자 팝업', full: '꽉 찬 화면, 자막과 라벨을 영상 위에 얹기, 위 제목 작게', post: '흰 바탕 SNS 게시물 모양, 검은 굵은 제목 2줄, 가운데 영상, 아래 채널 한마디 카드' } : REF_BASES;
  const fxTypes = talk ? 'mat·full 은 label, pop. post 는 없음 (빈 배열)' : 'mat 은 ' + REF_FX['yt-mat'] + ', top5·post 는 없음, 나머지는 ring, arrow, label, pop';
  ctx.log('Claude 가 레퍼런스 쇼츠의 편집 스타일을 봐요…');
  const j = await askClaude(E, ctx, `너는 쇼츠 편집 스타일 분석가다. 아래는 레퍼런스 쇼츠 "${title}" (https://www.youtube.com/shorts/${id}, ${Math.round(dur)}초) 를 ${r1(1 / fps)}초 간격으로 뽑은 프레임 시트다 (5x4 타일, 왼쪽 위부터 가로로). Read 로 모두 본다:
${list}
이 쇼츠의 화면 구성, 제목·자막 위치와 색, 글자 크기, 강조 방식, 이펙트(링·화살표·라벨·숫자 팝업), 말투, 컷 리듬을 본다.
우리 렌더러는 아래 틀 중 하나로만 그릴 수 있다. 가장 가까운 틀 하나를 base 로 고른다:
${Object.entries(bases).map(([k, v]) => `- ${k}: ${v}`).join('\n')}
그 틀 안에서 이 레퍼런스처럼 보이게 하는 규칙을 한국어로 쓴다 (레퍼런스의 문장을 베끼지 말고, 방식만 따른다):
- yellow: 강조색 hex 6자리 (# 없이), red: 두 번째 색 hex 6자리
- title: 위 제목 2줄(l1, l2)을 어떻게 쓰는지 (각 14자 이내). 레퍼런스에 위 제목이 없으면 짧은 후크로 쓰되 그렇게 적는다.
- fx: 어떤 이펙트를 언제 몇 개 쓰는지. 쓸 수 있는 type: ${fxTypes}. ring·arrow 는 x, y (원본 프레임 0~1).
- caps: 자막 규칙 (위치는 틀이 정함. 길이, 말투, 강조, 리듬).
- tone: 말투 한 줄.
- name: 이 스타일 이름 (12자 이내, 예: "스토리텔링 룩"), desc: 한 줄 설명 (40자 이내).
JSON 하나만 답해라: {"base":"${Object.keys(bases)[0]}","name":"","desc":"","yellow":"FFD600","red":"FF3B30","title":"","fx":"","caps":"","tone":""}`,
    x => !bases[x.base] ? 'base 는 ' + Object.keys(bases).join(', ') + ' 중 하나여야 해요.' : !/^[0-9A-Fa-f]{6}$/.test(x.yellow || '') || !/^[0-9A-Fa-f]{6}$/.test(x.red || '') ? 'yellow, red 는 hex 6자리여야 해요.' : !x.name || !x.caps ? 'name, caps 가 있어야 해요.' : '');
  const bk = talk ? chKey : j.base, base = AI_STYLES[bk], over = { yellow: j.yellow.toUpperCase(), red: j.red.toUpperCase(), caps: (talk ? base.caps + '\n' : '') + '- ' + j.caps, tone: base.tone + ' ' + (j.tone || '') };
  const flat = talk ? j.base === 'post' : ['yt-top5', 'yt-post'].includes(j.base);
  if (talk && j.base !== 'mat') { over.lay = j.base; if (j.base === 'post') { const P = AI_STYLES['yt-post']; Object.assign(over, { white: true, extra: P.extra, extraJson: P.extraJson }); } }
  if (j.title && j.base !== 'yt-top5') over.title = '위 제목: ' + j.title + ' l1, l2 각 14자 이내. 이것이 인트로 후크다.';
  if (flat) over.fx = '라벨·팝업은 쓰지 않는다. fx 는 빈 배열.';
  else if (j.fx) over.fx = j.fx + (talk || j.base === 'yt-mat' ? '' : ' ' + PT);
  E.s.refStyle = { look: E.s.look, id, title, base: bk, lay: j.base, name: String(j.name).slice(0, 20), desc: String(j.desc || '').slice(0, 60), over };
  writeJson(cache, E.s.refStyle);
  ctx.log(`레퍼런스 스타일: ${E.s.refStyle.name} (틀: ${j.base}${talk ? ', 말투·규칙은 ' + chKey : ''})`);
}

async function aistyle(E, ctx) {
  await refStyle(E, ctx);
  const st = styleOf(E), info = source(E), plan = readJson(E.p('편집/AI컷.json'));
  ctx.log('Claude 가 사실을 조사하고(source-check-research) 위 제목·선수 라벨·점수 팝업을 정해요…');
  fs.mkdirSync(E.p('조사'), { recursive: true });
  const j = await askClaude(E, ctx, `${skills(ctx, ['source-check-research', 'shorts-blueprint'])}${common(E, st, info, plan)}

주의: ${st.check} 다르면 조사와 화면을 따른다.
먼저 할 일: 이 경기·선수·대회·기록을 source-check-research 방식(한·영 검색, A/B/C 등급, 교차 확인, 확인 못 한 것 표시)으로 조사해서 Write 도구로 ${E.p('조사/research.md')} 에 저장한다.

이번 할 일: 스타일 요소만 정한다 (자막은 다음 단계).
- ${st.title || '위 고정 제목 l1, l2: 각 14자 이내. 이것이 인트로 후크다. 사람+결과+숫자. 설명·인사 금지.'}
- fx: ${st.fx} 남발 금지. 아웃트로에는 fx 를 두지 않는다.${st.extra ? '\n- ' + st.extra : ''}
- credits: [[0, ${plan.duration}, "원본 채널명"]]
JSON 하나만 답해라: {"frame":{"l1":"","l2":""},"fx":[[시작,끝,{"type":"label","k":"","s":""}],[시작,끝,{"type":"pop","text":"","sub":"","y":660}]${st.lay && st.lay !== 'mat' ? ',[시작,끝,{"type":"ring","x":0.5,"y":0.5}],[시작,끝,{"type":"arrow","x":0.5,"y":0.5}]' : ''}]${st.extraJson || ''},"credits":[[0,${plan.duration},"${info.channel || ''}"]],"facts":["쓴 사실과 근거 한 줄씩"]}`, checkFinal(plan, false, st));
  j.captions = [];
  writeJson(E.p('편집/AI완성.json'), j);
  fs.rmSync(E.p('편집/AI완성.mp4'), { force: true });
  for (const id of ['aisubs', 'aibrand']) if (E.s.steps[id]) E.s.steps[id] = { status: 'todo' };
  await render(E, ctx, st, plan, j, '편집/AI스타일본.mp4');
}

async function aisubs(E, ctx) {
  const st = styleOf(E), info = source(E), plan = readJson(E.p('편집/AI컷.json'));
  let base; try { base = readJson(E.p('편집/AI완성.json')); } catch { throw new StepError('스타일 입히기를 먼저 해 주세요.'); }
  const segs = segsOf(E, info, plan), talk = st.kind !== 'sport';
  ctx.log(`Claude 가 자막을 써요 (shorts-blueprint 자막 규칙${segs.length ? ', 말 자막 ' + segs.length + '덩어리는 원본 자막 시각에 맞춰요' : ''})…`);
  const speech = segs.length ? `
말 자막 S (원본 영어 자막을 완성 영상 시각으로 옮긴 것. 시각은 정확하다):
${segs.map(x => `S${x.id} [${x.s}-${x.e}] ${x.t}`).join('\n')}
- 말이 나오는 곳의 자막은 "lines" 로 쓴다: [[S번호들], "한국어"]. S번호는 이어지는 1~3개. 그 S 들에 실제로 있는 말만 옮긴다. 앞뒤 S 의 말을 끌어오거나 요약해서 섞지 마라. 자동자막이라 틀린 단어가 있으면 화면과 앞뒤 뜻으로 바로잡되, 없는 말을 지어내지 마라. 시각은 코드가 S 시각으로 넣는다.
- ${talk ? '화자의 발언은 빠짐없이 lines 로 옮긴다 (짧은 맞장구는 빼도 된다).' : '중계·선수 말을 옮기고 싶을 때만 lines 를 쓴다. 해설 자막은 captions 로.'}
- 말이 없는 곳(인트로·아웃트로 후크, 슬로우, 말 없는 장면)은 "captions" 로 [시작, 끝, "텍스트"]. captions 는 lines 로 쓴 S 구간과 겹치면 안 된다. 인트로 후크를 넣으려면 그 구간의 S 는 lines 로 쓰지 않는다.` : '';
  const j = await askClaude(E, ctx, `${skills(ctx, ['shorts-blueprint'])}${common(E, st, info, plan, segs.length > 0)}
이미 정한 위 제목·라벨·팝업 (바꾸지 말고 그대로 돌려줘라): ${JSON.stringify({ frame: base.frame, fx: base.fx, credits: base.credits, ranks: base.ranks, note: base.note })}

${st.check}
이번 할 일: 자막. 인트로와 아웃트로가 제일 중요하다. 둘 다 후크다.
- 인트로(intro 컷 구간): 0초에 바로 시작. 결과/숫자/반전을 먼저 던진다 (예: "올림픽 5연패\\n시작 15초 만에 들어 던지기"). 인사, 설명, "오늘은" 금지.
- 아웃트로(outro 컷 구간): 영상 끝까지. 다시 보게 만드는 한 줄 (예: "자, 15초 만에 [[한 번 더]].") 또는 댓글을 부르는 질문. 마지막 자막이 인트로로 이어지게.
${st.caps}
- 한 자막 최대 2줄, 줄당 16자 이내, 줄바꿈은 \\n. 강조할 단어 하나만 [[단어]]. 자막끼리 겹치지 않게.${speech}
JSON 하나만 답해라: {"frame":{...그대로},"fx":[...그대로],"credits":[...그대로],${segs.length ? '"lines":[[[1,2],"한국어"]],' : ''}"captions":[[시작,끝,"텍스트"]],"facts":["쓴 사실과 근거 한 줄씩"]}`,
    x => { if (segs.length) { const m = mergeCaps(x, segs); if (m.err) return m.err; x.captions = m.captions; } return checkFinal(plan, true, st)(x); });
  j.frame = base.frame; j.fx = base.fx; j.credits = base.credits; if (base.ranks) j.ranks = base.ranks; if (base.note) j.note = base.note;
  if (E.s.steps.aibrand) E.s.steps.aibrand = { status: 'todo' };
  writeJson(E.p('편집/AI완성.json'), j);
  await render(E, ctx, st, plan, j, '편집/AI완성.mp4');
}

// ---------- 그리기 (ASS) ----------
const bgr = hex => `&H00${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}&`;
const esc = s => String(s ?? '').replace(/\\n/g, '\n').replace(/[{}\\]/g, '').replace(/\r?\n/g, '\\N');
const ts = x => { x = Math.max(0, x); const h = Math.floor(x / 3600), m = Math.floor(x % 3600 / 60), s = x % 60; return `${h}:${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`; };
export function buildAss(fin, plan, st, src) {
  if (st.lay && st.lay !== 'mat') return buildAssLay(fin, plan, st, src || { w: 1920, h: 1080, cb: 0 });
  const Y = bgr(st.yellow), R = bgr(st.red), hi = s => esc(s).replace(/\[\[(.+?)\]\]/g, `{\\c${Y}}$1{\\c&HFFFFFF&}`);
  const end = plan.duration, ev = [];
  const add = (a, b, layer, style, text) => ev.push(`Dialogue: ${layer},${ts(a)},${ts(b)},${style},,0,0,0,,${text}`);
  add(0, end, 5, 'Title', `{\\an5\\pos(540,262)\\c${Y}}${esc(fin.frame?.l1)}`);
  add(0, end, 5, 'Title', `{\\an5\\pos(540,354)\\c${R}}${esc(fin.frame?.l2)}`);
  if (st.watermark) add(0, end, 4, 'Mark', `{\\an3\\pos(1050,1424)}${st.watermark[0]} {\\c${Y}}${st.watermark[1]}`);
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

// 새 틀(full·rank·post)용 ASS. 링·화살표의 x,y(원본 프레임 0~1)는 틀의 영상 칸 좌표로 바꿔요.
function buildAssLay(fin, plan, st, src) {
  const L = layOf(st), Y = bgr(st.yellow), R = bgr(st.red), end = plan.duration, ev = [], white = st.lay === 'post';
  const hi = (s, c = Y, back = '&HFFFFFF&') => esc(s).replace(/\[\[(.+?)\]\]/g, `{\\c${c}}$1{\\c${back}}`);
  const add = (a, b, layer, style, text) => ev.push(`Dialogue: ${layer},${ts(a)},${ts(b)},${style},,0,0,0,,${text}`);
  const sh = src.h * (1 - (src.cb || 0)), sc = Math.max(W / src.w, L.vh / sh), ox = (src.w * sc - W) / 2, oy = (sh * sc - L.vh) / 2;
  const xy = (x, y) => [Math.round(Math.min(W - 60, Math.max(60, x * src.w * sc - ox))), Math.round(Math.min(L.vy + L.vh - 40, Math.max(L.vy + 40, y * src.h * sc - oy + L.vy)))];
  const intro = plan.cuts[0]?.out || [0, 2];
  // 링: 원 테두리 (속은 비움), 톡 커지며 나타나요
  const ring = (a, b, f, col, glow) => { const [X, Yp] = xy(+f.x, +f.y), r = 95, k = Math.round(r * 0.552), d = 2 * r;
    const shape = `m ${r} 0 b ${r + k} 0 ${d} ${r - k} ${d} ${r} b ${d} ${r + k} ${r + k} ${d} ${r} ${d} b ${r - k} ${d} 0 ${r + k} 0 ${r} b 0 ${r - k} ${r - k} 0 ${r} 0`;
    if (glow) add(a, b, 8, 'Draw', `{\\an7\\pos(${X - r},${Yp - r})\\org(${X},${Yp})\\1a&HFF&\\3c${col}\\bord16\\blur10\\3a&H60&\\fscx60\\fscy60\\t(0,180,\\fscx100\\fscy100)\\p1}${shape}`);
    add(a, b, 9, 'Draw', `{\\an7\\pos(${X - r},${Yp - r})\\org(${X},${Yp})\\1a&HFF&\\3c${col}\\bord7\\blur1\\fscx60\\fscy60\\t(0,180,\\fscx100\\fscy100)\\p1}${shape}`); };
  // 화살표: 끝이 (x,y) 를 가리켜요. 오른쪽 위에서 왼쪽 아래로.
  const arrow = (a, b, f, col) => { const [X, Yp] = xy(+f.x, +f.y);
    add(a, b, 9, 'Draw', `{\\an7\\pos(${X - 60},${Yp - 180})\\org(${X},${Yp})\\frz-35\\1c${col}\\3c&H000000&\\bord3\\fscx70\\fscy70\\t(0,160,\\fscx100\\fscy100)\\p1}m 60 180 l 0 105 l 38 105 l 38 0 l 82 0 l 82 105 l 120 105 l 60 180`); };
  const fxs = fin.fx || [];
  for (const [a, b, f] of fxs) {
    if (!f) continue;
    if (f.type === 'ring') ring(a, b, f, st.lay === 'full' && !st.words ? '&HFFFFFF&' : Y, st.lay === 'full' && !st.words);
    else if (f.type === 'arrow') arrow(a, b, f, st.words ? '&H2B2BFF&' : '&HFFFFFF&');
    else if (f.type === 'label') { add(a, b, 6, 'Label', `{\\an7\\pos(44,${L.vy + 60})}${esc(f.k)}`); if (f.s) add(a, b, 6, 'Sub', `{\\an7\\pos(44,${L.vy + 152})}${esc(f.s)}`); }
    else if (f.type === 'pop') { const y = L.vy + Math.round(L.vh * 0.3); add(a, b, 7, 'Pop', `{\\an8\\pos(540,${y})\\frz6\\fscx130\\fscy130\\t(0,160,\\fscx100\\fscy100)\\c${Y}}${esc(f.text)}`); if (f.sub) add(a, b, 7, 'PopSub', `{\\an8\\pos(540,${y + 215})\\frz6}${esc(f.sub)}`); }
  }
  if (st.lay === 'full') for (const c of plan.cuts) if ((+c.speed || 1) < 1) add(c.out[0], c.out[1], 6, 'Badge', `{\\an9\\pos(1040,${st.words ? 150 : 120})}SLOW ${+(+c.speed).toFixed(2)}x`);
  const caps = fin.captions || [];
  if (st.lay === 'rank') {
    add(0, end, 5, 'Title', `{\\an5\\pos(540,120)}${esc(fin.frame?.l1)}`);
    add(0, end, 5, 'Title', `{\\an5\\pos(540,240)\\c${R}\\fs96}"${esc(fin.frame?.l2)}"`);
    const ranks = fin.ranks || [], n = ranks.length;
    ranks.forEach((r, k) => { const no = n - k, y = 1120 + (no - 1) * 84;   // 1위가 맨 위
      add(0, end, 5, 'Rank', `{\\an4\\pos(110,${y})}${no}.`);
      add(r[0], end, 5, 'Rank', `{\\an4\\pos(180,${y})\\fscx120\\fscy120\\t(0,150,\\fscx100\\fscy100)}${esc(r[2])}`); });
    for (const [a, b, t] of caps) add(a, b, 3, 'Cap', `{\\an2\\pos(540,${L.vy + L.vh - 24})}${hi(t)}`);
    for (const [a, b, t] of fin.credits || []) add(a, b, 4, 'Credit', `{\\an2\\pos(540,1880)}영상: ${esc(t)}`);
  } else if (st.lay === 'post') {
    if (st.name) add(0, end, 5, 'Name', `{\\an4\\pos(212,150)}${esc(st.name)}`);
    if (st.handle) add(0, end, 5, 'Name', `{\\an4\\pos(212,212)}${esc(st.handle)}`);
    add(0, end, 5, 'Title', `{\\an5\\pos(540,350)}${esc(fin.frame?.l1)}`);
    add(0, end, 5, 'Title', `{\\an5\\pos(540,445)}${esc(fin.frame?.l2)}`);
    for (const [a, b, t] of caps) add(a, b, 3, 'Cap', `{\\an2\\pos(540,${L.vy + L.vh - 30})}${hi(t, '&HFFFFFF&', Y)}`);
    if (fin.note) {
      add(0, end, 4, 'Draw', `{\\an7\\pos(80,1415)\\1c&HE6E6E6&\\bord0\\p1}m 55 0 b 85 0 110 25 110 55 b 110 85 85 110 55 110 b 25 110 0 85 0 55 b 0 25 25 0 55 0`);
      add(0, end, 5, 'NoteName', `{\\an4\\pos(232,1440)}${esc(st.name || '')}`);
      add(0, end, 5, 'Note', `{\\an4\\pos(232,1500)}${esc(fin.note)}`);
    }
    for (const [a, b, t] of fin.credits || []) add(a, b, 4, 'Credit', `{\\an2\\pos(540,1880)}영상: ${esc(t)}`);
  } else {   // full
    const lines = fin.frame && (fin.frame.l1 || fin.frame.l2);
    if (lines) { add(intro[0], intro[1], 5, 'Title', `{\\an5\\pos(540,300)\\fad(0,200)}${esc(fin.frame.l1)}`); add(intro[0], intro[1], 5, 'Title', `{\\an5\\pos(540,400)\\c${Y}\\fad(0,200)}${esc(fin.frame.l2)}`); }
    if (st.words) {   // 한 단어씩: 자막 시간을 단어 길이대로 나눠요
      for (const [a, b, t] of caps) {
        const words = String(t).replace(/\\n|\n/g, ' ').split(/\s+/).filter(Boolean), tot = words.reduce((x, w) => x + w.replace(/\[\[|\]\]/g, '').length + 1, 0);
        let s0 = a; for (const w of words) { const d = (b - a) * (w.replace(/\[\[|\]\]/g, '').length + 1) / tot, hot = /\[\[/.test(w);
          add(s0, s0 + d, 3, 'Word', `{\\an5\\pos(540,1150)\\fscx125\\fscy125\\t(0,90,\\fscx100\\fscy100)${hot ? `\\c${Y}` : ''}}${esc(w.replace(/\[\[|\]\]/g, ''))}`); s0 += d; }
      }
    } else for (const [a, b, t] of caps) add(a, b, 3, 'Cap', `{\\an2\\pos(540,${st.explain ? 1560 : 1250})}${hi(t, st.explain ? Y : R)}`);
    if (st.name) add(0, end, 4, 'Mark', `{\\an5\\pos(540,1470)}${esc(st.name)}`);
    for (const [a, b, t] of fin.credits || []) add(a, b, 4, 'Credit', `{\\an7\\pos(30,30)}영상: ${esc(t)}`);
  }
  const S = (n, size, col, outline, oc = '&H00000000&', border = 1, back = '&H00000000&', bold = -1) => `Style: ${n},${FONT},${size},${col},&H000000FF&,${oc},${back},${bold},0,0,0,100,100,0,0,${border},${outline},0,5,0,0,0,1`;
  const K = '&H00000000&', Wh = '&H00FFFFFF&';
  const styles = st.lay === 'post'
    ? [S('Title', 86, K, 0), S('Name', 46, K, 0), S('Cap', 62, Y, 5), S('NoteName', 36, '&H00AAAAAA&', 0), S('Note', 50, '&H00222222&', 0, K, 1, K, 0), S('Credit', 30, '&H00888888&', 0), S('Draw', 10, Wh, 0)]
    : st.lay === 'rank'
      ? [S('Title', 110, Wh, 6), S('Rank', 62, Wh, 5), S('Cap', 60, Wh, 5), S('Credit', 30, Wh, 2), S('Draw', 10, Wh, 0)]
      : [S('Title', 84, Wh, 7), S('Cap', st.explain ? 70 : 60, st.explain ? Wh : Y, 6), S('Word', 104, Wh, 9, '&H00FF6B1E&'),
        S('Label', 50, Wh, 14, R, 3, R), S('Sub', 36, Wh, 12, '&H80303030&', 3, '&H80303030&'), S('Pop', 230, Wh, 12), S('PopSub', 62, Wh, 7),
        S('Badge', 44, K, 10, Y, 3, Y), S('Mark', 34, '&H40FFFFFF&', 2, '&H80000000&'), S('Credit', 28, '&H40FFFFFF&', 2), S('Draw', 10, Wh, 0)];
  return `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styles.join('\n')}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${ev.join('\n')}
`;
}

async function render(E, ctx, st, plan, fin, outRel) {
  const info = source(E), lay = layOf(st);
  let base = '편집/AI1차컷.mp4';
  if (lay !== LAY.mat) {   // 다른 틀: 같은 컷을 그 틀로 다시 그려요 (컷이 바뀌었을 때만)
    base = `편집/AI1차컷_${st.lay}.mp4`;
    const t = f => { try { return fs.statSync(E.p(f)).mtimeMs; } catch { return 0; } };
    if (t(base) < t('편집/AI컷.json')) await renderCut(E, ctx, info, lay, base);
  }
  const pr = await probe(info.file, ctx), src = { w: pr.width || 1920, h: pr.height || 1080, cb: Math.min(0.25, Math.max(0, +plan.crop_bottom || 0)) };
  const root = E.homeRoot || path.join(HOME, 'Desktop/유투브'), logoPath = path.join(root, st.logo || ''), logo = st.lay === 'post' && st.logo && exists(logoPath);
  const assF = E.p('편집/AI완성.ass'); fs.writeFileSync(assF, buildAss(fin, plan, st, src));
  const bgmDir = path.join(E.homeRoot || path.join(HOME, 'Desktop/유투브'), '소리/BGM');
  const bgm = exists(bgmDir) ? fs.readdirSync(bgmDir).filter(f => /\.(mp3|m4a|wav|aac)$/i.test(f)).sort()[0] : null;
  const d = plan.duration, q = p => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'");
  const sub = `subtitles=filename='${q(assF)}':fontsdir='${q(process.env.FIELDNOTE_AI_FONT_DIR || FONT_DIR)}'`, li = bgm ? 2 : 1;
  const vf = logo ? `[${li}:v]scale=110:-1,format=rgba[lg];[0:v][lg]overlay=x=70:y=118[vl];[vl]${sub}[vo]` : `[0:v]${sub}[vo]`;
  // BGM 도 슬로우 구간에서는 꺼요
  const slowOff = plan.cuts.filter(c => (+c.speed || 1) < 1 && c.out).map(c => `volume=0:enable='between(t,${c.out[0]},${c.out[1]})'`).join(',');
  const af = bgm ? `;[1:a]volume=0.22,atrim=0:${d},${slowOff ? slowOff + ',' : ''}afade=t=out:st=${Math.max(0, d - 1.5)}:d=1.5[b];[0:a][b]amix=inputs=2:duration=first:normalize=0[ao]` : ';[0:a]anull[ao]';
  ctx.log(`그리는 중 (${st.name}${bgm ? ' · BGM ' + bgm : ' · BGM 없음: ~/Desktop/유투브/소리/BGM 에 넣으면 깔려요'})…`);
  try {
    await ff(['-i', E.p(base), ...(bgm ? ['-stream_loop', '-1', '-i', path.join(bgmDir, bgm)] : []), ...(logo ? ['-i', logoPath] : []), '-filter_complex', vf + af,
      '-map', '[vo]', '-map', '[ao]', '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', '-t', String(d), '-movflags', '+faststart', E.p(outRel)], ctx);
  } catch (e) {
    if (e instanceof StopError) throw e;
    throw new StepError(/No such filter: 'subtitles'|Filter not found/.test(e.err || '') ? 'ffmpeg 에 자막 기능(libass)이 없어요.' : 'ffmpeg 오류: ' + lastLines(e.err));
  }
  ctx.log('완성: ' + outRel);
}

// ---------- 6. 인트로·아웃트로: 채널 로고가 들어간 후크 클립을 만들고 본편 앞뒤에 붙여요 ----------
const IN_D = 2.2, OUT_D = 3.2;
async function aibrand(E, ctx) {
  const st = styleOf(E), info = source(E), plan = readJson(E.p('편집/AI컷.json'));
  if (!exists(E.p('편집/AI완성.mp4'))) throw new StepError('자막까지 끝내고 해 주세요.');
  const root = E.homeRoot || path.join(HOME, 'Desktop/유투브'), logoPath = path.join(root, st.logo), hasLogo = exists(logoPath);
  if (!hasLogo) ctx.log(`  채널 로고가 없어서 글자만 넣어요 (${logoPath} 에 넣으면 들어가요)`);
  const logoIn = d => hasLogo ? ['-loop', '1', '-t', String(d), '-i', logoPath] : ['-f', 'lavfi', '-t', String(d), '-i', 'color=c=black@0.0:s=16x16,format=rgba'];
  const fin = readJson(E.p('편집/AI완성.json'));
  ctx.log('Claude 가 인트로·아웃트로 후크 문장을 써요…');
  const short = (t, n) => String(t || '').replace(/\[\[|\]\]/g, '').length <= n;
  const j = await askClaude(E, ctx, `${skills(ctx, ['shorts-blueprint'])}너는 한국어 ${st.genre} 쇼츠 채널${st.name ? ` "${st.name}"` : ''}${st.handle ? ` (${st.handle})` : ''}의 편집 작가다.
본편 쇼츠 앞에 붙일 인트로(${IN_D}초)와 뒤에 붙일 아웃트로(${OUT_D}초) 문장을 쓴다. 둘 다 무조건 후크다.
본편: 위 제목 ${JSON.stringify(fin.frame)}, 자막 ${JSON.stringify(fin.captions)}
1차 컷 정보: ${JSON.stringify({ moments: plan.moments, who: plan.who })}
사실은 조사 파일 ${E.p('조사/research.md')} 의 A·B 등급만 쓴다 (Read 로 확인). ${st.check}
말투: ${st.tone}
- 인트로: 0.1초 만에 스크롤을 멈추게 하는 한 방. 결과·숫자·반전·질문 중 하나. 인사·채널 소개·"오늘은" 금지. l1 은 짧은 도발(10자 이내), l2 는 핵심 한 방(12자 이내). 강조 단어 하나만 [[단어]].
- 아웃트로: 끝까지 본 사람이 다시 보거나 구독하게 만드는 한 방. l1 은 여운/반전/질문(12자 이내), l2 는 다음 편 예고나 떡밥(12자 이내), cta 는 구독 유도 한 줄(14자 이내, 예: "구독하고 다음 기술 보기").
JSON 하나만 답해라: {"intro":{"l1":"","l2":""},"outro":{"l1":"","l2":"","cta":""}}`,
    x => !x.intro || !x.outro ? 'intro, outro 가 있어야 해요.' : !short(x.intro.l1, 12) || !short(x.intro.l2, 14) ? '인트로 문장이 너무 길어요.' : !short(x.outro.l1, 14) || !short(x.outro.l2, 14) || !short(x.outro.cta, 16) ? '아웃트로 문장이 너무 길어요.' : '');
  writeJson(E.p('편집/AI인트로아웃트로.json'), j);
  const Y = bgr(st.yellow), R = bgr(st.red), hi = t => esc(t).replace(/\[\[(.+?)\]\]/g, `{\\c${Y}}$1{\\c&HFFFFFF&}`);
  const ass = (d, lines) => `[Script Info]\nScriptType: v4.00+\nPlayResX: ${W}\nPlayResY: ${H}\nWrapStyle: 2\nScaledBorderAndShadow: yes\n\n[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Big,${FONT},156,&H00FFFFFF&,&H000000FF&,&H00000000&,&H00000000&,-1,0,0,0,100,100,0,0,1,11,0,5,0,0,0,1
Style: Mid,${FONT},100,&H00FFFFFF&,&H000000FF&,&H00000000&,&H00000000&,-1,0,0,0,100,100,0,0,1,9,0,5,0,0,0,1
Style: Small,${FONT},56,&H00FFFFFF&,&H000000FF&,&H00000000&,&H00000000&,-1,0,0,0,100,100,0,0,1,4,0,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.map(([a, sty, txt]) => `Dialogue: 1,${ts(a)},${ts(d)},${sty},,0,0,0,,${txt}`).join('\n')}
`;
  const q = p => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'"), fd = q(process.env.FIELDNOTE_AI_FONT_DIR || FONT_DIR);
  // 한 줄이 화면 폭(약 960px)을 넘지 않게 글자 크기를 줄여요 (한글 한 글자 ≈ 글자 크기 1칸, 띄어쓰기 ≈ 0.35칸)
  const fit = (t, base) => { const n = [...String(t).replace(/\[\[|\]\]/g, '')].reduce((a, c) => a + (c === ' ' ? 0.35 : /[ -~]/.test(c) ? 0.6 : 1), 0); return Math.min(base, Math.floor(960 / Math.max(1, n))); };
  const pop = (x, y, t, base) => `{\\an5\\pos(${x},${y})\\fs${fit(t, base)}\\fscx130\\fscy130\\t(0,140,\\fscx100\\fscy100)}`;
  const logoF = (size, at) => `scale=w='${size}*min(1\\,0.55+max(0\\,t-${at})*3)':h=-1:eval=frame,format=rgba,fade=in:st=${at}:d=0.15:alpha=1`;
  // 인트로: 본편 인트로 장면을 꽉 채워 살짝 줌인 + 흰 섬광 + 후크 2줄 + 로고
  const inAss = E.p('편집/AI인트로.ass');
  fs.writeFileSync(inAss, ass(IN_D, [[0, 'Mid', pop(540, 460, j.intro.l1, 100) + hi(j.intro.l1)], [0.12, 'Big', pop(540, 640, j.intro.l2, 156) + `{\\c${Y}}` + hi(j.intro.l2)], ...(st.handle ? [[0.5, 'Small', `{\\an5\\pos(540,1570)}${esc(st.handle)}`]] : []), ...(!hasLogo && st.name ? [[0.45, 'Mid', `{\\an5\\pos(540,1290)}${esc(st.name)}`]] : [])]));
  ctx.log('인트로 그리는 중…');
  await ff(['-ss', '0', '-t', String(IN_D), '-i', E.p('편집/AI1차컷.mp4'), ...logoIn(IN_D), '-filter_complex',
    `[0:v]crop=${W}:${VH}:0:${VY},scale=w='${H}*16/9*(1+0.05*t)':h=-2:eval=frame,crop=${W}:${H},eq=brightness=-0.13:saturation=1.25,fade=in:st=0:d=0.18:color=white,fps=30,setsar=1[bg];` +
    `[1:v]${logoF(470, 0.45)}[lg];[bg][lg]overlay=x='(W-w)/2':y='1290-h/2':eval=frame,subtitles=filename='${q(inAss)}':fontsdir='${fd}',format=yuv420p[v];` +
    `[0:a]aresample=48000,aformat=channel_layouts=stereo,afade=t=out:st=${IN_D - 0.3}:d=0.3[a]`,
    '-map', '[v]', '-map', '[a]', '-t', String(IN_D), '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', E.p('편집/AI인트로.mp4')], ctx);
  // 아웃트로: 본편 마지막 장면을 흐리게 멈추고 후크 + 큰 로고 + 구독 유도
  const outAss = E.p('편집/AI아웃트로.ass');
  fs.writeFileSync(outAss, ass(OUT_D, [[0, 'Mid', pop(540, 360, j.outro.l1, 100) + hi(j.outro.l1)], [0.15, 'Mid', pop(540, 470, j.outro.l2, 100) + `{\\c${Y}}` + hi(j.outro.l2)],
    [0.7, 'Mid', `{\\an5\\pos(540,1420)\\3c${st.cta ? bgr(st.cta) : R}\\bord10}` + esc(j.outro.cta)], ...(st.handle ? [[0.7, 'Small', `{\\an5\\pos(540,1540)}${esc(st.handle)}`]] : []), ...(!hasLogo && st.name ? [[0.3, 'Big', `{\\an5\\pos(540,930)}${esc(st.name)}`]] : [])]));
  ctx.log('아웃트로 그리는 중…');
  await ff(['-sseof', '-0.2', '-i', E.p('편집/AI완성.mp4'), ...logoIn(OUT_D), '-f', 'lavfi', '-t', String(OUT_D), '-i', 'anullsrc=r=48000:cl=stereo', '-filter_complex',
    `[0:v]trim=end_frame=1,loop=loop=-1:size=1,trim=duration=${OUT_D},setpts=PTS-STARTPTS,crop=${W}:${layOf(st).vh}:0:${layOf(st).vy},scale=-2:${H},crop=${W}:${H},boxblur=24:2,eq=brightness=-0.32,fps=30,setsar=1[bg];` +
    `[1:v]${logoF(660, 0.3)}[lg];[bg][lg]overlay=x='(W-w)/2':y='930-h/2':eval=frame,subtitles=filename='${q(outAss)}':fontsdir='${fd}',fade=out:st=${OUT_D - 0.25}:d=0.25,format=yuv420p[v]`,
    '-map', '[v]', '-map', '2:a', '-t', String(OUT_D), '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', E.p('편집/AI아웃트로.mp4')], ctx);
  ctx.log('인트로 + 본편 + 아웃트로 붙이는 중…');
  const norm = i => `[${i}:v]fps=30,scale=${W}:${H},setsar=1,format=yuv420p[v${i}];[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`;
  await ff(['-i', E.p('편집/AI인트로.mp4'), '-i', E.p('편집/AI완성.mp4'), '-i', E.p('편집/AI아웃트로.mp4'), '-filter_complex',
    `${norm(0)};${norm(1)};${norm(2)};[v0][a0][v1][a1][v2][a2]concat=n=3:v=1:a=1[v][a]`,
    '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '19', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart', E.p('편집/AI최종.mp4')], ctx);
  ctx.log(`완성: 편집/AI최종.mp4 (인트로 ${IN_D}초 + 본편 ${plan.duration}초 + 아웃트로 ${OUT_D}초)`);
}

// ---------- 7. 썸네일: 예쁘게 말고 3단 원색 대비 (상단 노랑 카피 / 중앙 액션|리액션 2분할 / 하단 빨강·파랑 반전 카피) ----------
const TW = 1280, TH = 720, TOP = 140, BOT = 120;
async function aithumb(E, ctx) {
  const info = source(E), plan = readJson(E.p('편집/AI컷.json')), dur = (await probe(info.file, ctx)).duration;
  let fin = {}; try { fin = readJson(E.p('편집/AI완성.json')); } catch {}
  const sheetsOf = pre => { try { return fs.readdirSync(E.p('분석')).filter(f => f.startsWith(pre + '_')).sort().map(f => E.p('분석', f)); } catch { return []; } };
  const coarse = sheetsOf('coarse'), fine = sheetsOf('fine');
  ctx.log('Claude 가 썸네일 카피와 액션·리액션 장면을 골라요…');
  const nos = t => String(t || '').replace(/\s/g, '').length;
  const st = styleOf(E);
  const j = await askClaude(E, ctx, `${skills(ctx, ['thumbnail-3tier'])}너는 ${st.genre} 쇼츠 썸네일 작가다. 규칙: 예쁘게 말고 3단 원색 대비.
- 상단 카피(노랑, 검정 띠): 결정적 순간 1개만. 공백 빼고 12자 이하.
- 중앙 2분할: 왼쪽 = ${st.thumbL}, 오른쪽 = ${st.thumbR}.
- 하단 카피(흰 글씨, 빨강 또는 파랑 띠): 반전/궁금증. 공백 빼고 16자 이하.
- 내용 설명형 문장 금지 (그리고/그래서/했는데/하면서 금지). 파스텔·분홍 금지.
- 띄어쓰기는 맞춤법대로 한다 (글자 수는 공백을 빼고 센다).
- 오른쪽 리액션 컷은 경기 장면 말고, 사람 얼굴(관중·코치·상대·화자)이 크게 보이는 프레임을 골라라.
원본: "${info.title}" (${info.channel}), 길이 ${Math.round(dur)}초.
본편 제목·자막: ${JSON.stringify({ frame: fin.frame, captions: fin.captions })}
장면 정보: ${JSON.stringify({ moments: plan.moments, who: plan.who })}
사실은 조사 파일 ${E.p('조사/research.md')} 의 A·B 등급만 (Read 로 확인). ${st.check}
프레임 시트를 Read 로 보고 장면을 골라라:
${coarse.length ? `- 전체 영상 2초 간격 6x5 타일: 시트 k(1부터) 타일 i 의 시각 = ((k-1)*30 + i)*2 초\n${coarse.map(f => '  ' + f).join('\n')}\n` : ''}- 고른 구간 0.2초 간격 5x5 타일:
${plan.sheets || `원본 ${r1(plan.window[0])}초부터: 시트 k 타일 i 의 시각 = ${r1(plan.window[0])} + ((k-1)*25 + i)*0.2 초\n${fine.map(f => '  ' + f).join('\n')}`}
x 는 그 프레임에서 인물이 있는 가로 위치(0=왼쪽 끝, 0.5=가운데, 1=오른쪽 끝). 썸네일 칸은 세로로 길어서 x 기준으로 잘라낸다.
JSON 하나만 답해라: {"top":"","bot":"","color":"red|blue","left":{"t":원본초,"x":0.5,"why":""},"right":{"t":원본초,"x":0.5,"why":""}}`,
    x => !x.top || !x.bot ? 'top, bot 이 있어야 해요.' : nos(x.top) > 12 ? `상단 카피가 ${nos(x.top)}자예요 (12자 이하).` : nos(x.bot) > 16 ? `하단 카피가 ${nos(x.bot)}자예요 (16자 이하).`
      : /(그리고|그래서|했는데|하면서)/.test(x.top + x.bot) ? '내용 설명형 단어가 있어요.' : [x.top, x.bot].some(t => nos(t) >= 7 && !/\s/.test(t)) ? '띄어쓰기가 없어요. 맞춤법대로 띄어 써라.' : !['red', 'blue'].includes(x.color) ? 'color 는 red 또는 blue.'
      : ![x.left, x.right].every(f => f && f.t >= 0 && f.t <= dur && f.x >= 0 && f.x <= 1) ? `left/right 의 t 는 0~${Math.round(dur)}, x 는 0~1.` : Math.abs(x.left.t - x.right.t) < 0.5 ? '왼쪽과 오른쪽은 다른 장면이어야 해요.' : '');
  writeJson(E.p('편집/AI썸네일.json'), j);
  const fitT = (t, base, w) => { const n = [...String(t)].reduce((a, c) => a + (c === ' ' ? 0.35 : /[ -~]/.test(c) ? 0.6 : 1), 0); return Math.min(base, Math.floor(w / Math.max(1, n))); };
  const assF = E.p('편집/AI썸네일.ass');
  fs.writeFileSync(assF, `[Script Info]\nScriptType: v4.00+\nPlayResX: ${TW}\nPlayResY: ${TH}\nScaledBorderAndShadow: yes\n\n[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: T,${FONT},96,&H0000E6FF&,&H000000FF&,&H00000000&,&H00000000&,-1,0,0,0,100,100,-2,0,1,4,3,5,0,0,0,1
Style: B,${FONT},84,&H00FFFFFF&,&H000000FF&,&H00000000&,&H00000000&,-1,0,0,0,100,100,-2,0,1,5,3,5,0,0,0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 1,0:00:00.00,0:00:05.00,T,,0,0,0,,{\\an5\\pos(${TW / 2},${TOP / 2 + 2})\\fs${fitT(j.top, 104, 1220)}}${esc(j.top)}
Dialogue: 1,0:00:00.00,0:00:05.00,B,,0,0,0,,{\\an5\\pos(${TW / 2},${TH - BOT / 2 + 2})\\fs${fitT(j.bot, 88, 1220)}}${esc(j.bot)}
`);
  const q = p => p.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "\\'"), MH = TH - TOP - BOT, half = TW / 2;
  const cb = Math.min(0.25, Math.max(0, +plan.crop_bottom || 0));
  const cell = (i, x) => `[${i}:v]trim=end_frame=1,setpts=PTS-STARTPTS,${cb ? `crop=iw:trunc(ih*${(1 - cb).toFixed(3)}/2)*2:0:0,` : ''}scale=w=${half}:h=${MH}:force_original_aspect_ratio=increase,crop=${half}:${MH}:x='(iw-${half})*${(+x).toFixed(3)}':y='(ih-${MH})/2',setsar=1[c${i}]`;
  ctx.log('썸네일 그리는 중…');
  await ff(['-ss', String(j.left.t), '-i', info.file, '-ss', String(j.right.t), '-i', info.file, '-filter_complex',
    `${cell(0, j.left.x)};${cell(1, j.right.x)};color=c=black:s=${TW}x${TH}:d=1[bg];[bg][c0]overlay=0:${TOP}:shortest=1[a];[a][c1]overlay=${half}:${TOP}[b];` +
    `[b]drawbox=x=${half - 3}:y=${TOP}:w=6:h=${MH}:color=0xFFE600:t=fill,drawbox=x=0:y=${TH - BOT}:w=${TW}:h=${BOT}:color=${j.color === 'blue' ? '0x0047FF' : '0xE60012'}:t=fill,` +
    `subtitles=filename='${q(assF)}':fontsdir='${q(process.env.FIELDNOTE_AI_FONT_DIR || FONT_DIR)}'[v]`,
    '-map', '[v]', '-frames:v', '1', '-q:v', '2', E.p('편집/AI썸네일.jpg')], ctx);
  ctx.log(`완성: 편집/AI썸네일.jpg · 상단 "${j.top}" · 하단 "${j.bot}"`);
}

export const AI_FN = { aicut, aistyle, aisubs, aibrand, aithumb };
