// 네트워크 없이 한 에피소드를 끝까지 돌려 보는 검사:  node test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { FFMPEG, probe, run } from './util.mjs';
import { parseRanges, rangeSecs, rangeSpeed } from './util.mjs';
import { matItems, splitAnswer, CHANNEL_PROFILES, profileOf, promptFor, parseVtt, transcriptFor, parseScript, parseHook, hookFromTitle, parseLine, parseBanner, bannerFromTitle, bwSpans, buildAss, resolveLook, lookOf, LOOK_CHOICES, lookKeyOf, migrateState, srcCues, translateCues, buildSrcAss, STEP_DEFS } from './steps.mjs';
// 옛 버전과 비교하는 검사: backup-20261118-banner 폴더가 있는 맥에서만 실행 (없으면 건너뜀)
let oldBuildAss = null;
try { ({ buildAss: oldBuildAss } = await import('./backup-20261118-banner/steps.mjs')); } catch {}
const sameAsOld = P => { if (oldBuildAss) assert.equal(buildAss(P), oldBuildAss(P)); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'runner-test-'));
const PORT = +(process.env.FIELDNOTE_TEST_PORT || process.env.TEST_PORT || 4790), B = `http://127.0.0.1:${PORT}`;
const env = { ...process.env, FIELDNOTE_RUNNER_PORT: PORT, FIELDNOTE_RUNNER_DATA: path.join(tmp, 'data'), FIELDNOTE_RUNNER_HOME: path.join(tmp, 'home'), ANTHROPIC_API_KEY: '' };
delete env.ANTHROPIC_API_KEY;

// ---- Codex 그림 테스트용 가짜 환경 ----
const art = path.join(tmp, 'art'), gen = path.join(tmp, 'generated'), fakeLog = path.join(tmp, 'fake-codex.log');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
for (const f of ['otter-couple-assets/C.png', 'otter-couple-assets/A.png', 'instagram-toon/set-demo/01.png', 'instagram-toon/set-demo/02.png', 'instagram-toon/style-previews/A-cute.png']) { fs.mkdirSync(path.dirname(path.join(art, f)), { recursive: true }); fs.writeFileSync(path.join(art, f), PNG); }
fs.mkdirSync(gen, { recursive: true });
const fakeBin = path.join(tmp, 'fake-codex.mjs');
fs.writeFileSync(fakeBin, `#!${process.execPath}
import fs from 'node:fs'; import path from 'node:path';
const a = process.argv.slice(2), prompt = a[1] || '';
fs.appendFileSync(${JSON.stringify(fakeLog)}, JSON.stringify({ t0: Date.now(), args: a }) + '\\n');
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (prompt.includes('FAKE_LOGIN')) { console.error('Error: Not logged in. Run codex login.'); process.exit(1); }
if (prompt.includes('FAKE_FAIL')) { console.error('boom: something broke'); process.exit(2); }
if (prompt.includes('FAKE_NOIMG')) { console.log('{"type":"message"}'); process.exit(0); }
if (prompt.includes('FAKE_SLOW')) { await sleep(60000); }
await sleep(prompt.includes('FAKE_TOUCH') ? 700 : 350);
const d = path.join(${JSON.stringify(gen)}, 'thread-' + process.pid); fs.mkdirSync(d, { recursive: true });
fs.writeFileSync(path.join(d, 'exec-' + Date.now() + '.png'), Buffer.from(${JSON.stringify(PNG.toString('base64'))}, 'base64'));
fs.appendFileSync(${JSON.stringify(fakeLog)}, JSON.stringify({ t1: Date.now() }) + '\\n');
console.log('saved');
`, { mode: 0o755 });
Object.assign(env, { FIELDNOTE_CODEX_BIN: fakeBin, FIELDNOTE_GENERATED_DIR: gen, FIELDNOTE_ART_ROOT: art, FIELDNOTE_STYLES_FILE: path.join(tmp, 'styles.json'), FIELDNOTE_IMG_TIMEOUT_MS: '2500' });
let srv, ok = 0;
const check = (name, fn) => Promise.resolve().then(fn).then(() => { ok++; console.log('  통과 -', name); }, e => { console.error('  실패 -', name, '\n    ', e.message); process.exitCode = 1; throw e; });
const J = async (p, body, init = {}) => { const r = await fetch(B + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...init } : init); const t = await r.text(); let d; try { d = JSON.parse(t); } catch { d = t; } return { r, d }; };
const start = () => new Promise((res, rej) => { srv = spawn(process.execPath, ['server.mjs'], { cwd: path.dirname(fileURLToPath(import.meta.url)), env, stdio: ['ignore', 'pipe', 'inherit'] }); srv.stdout.on('data', d => /실행기 주소/.test(d) && res()); srv.on('error', rej); });
const stop = () => new Promise(r => { srv.once('exit', r); srv.kill('SIGTERM'); });
const ep = async () => (await J('/status')).d.episodes[0];
async function waitIdle(timeout = 120000) {
  const t0 = Date.now();
  for (;;) { await new Promise(r => setTimeout(r, 300)); const e = await ep(); if (!e.running) return e; if (Date.now() - t0 > timeout) throw new Error('시간 초과'); }
}
const step = (e, id) => e.steps.find(s => s.id === id);

try {
  await start();

  // ---- 채널별 설정 (네트워크·ffmpeg 필요 없음) ----
  const fakeE = (channel, extra = {}) => ({ s: { title: '제목', note: '', format: 'shorts', channel, ...extra } });
  const prompt = (E, info = [{ title: 'T', channel: 'C' }]) => promptFor(E, info, [{ duration: 12 }], 12);
  await check('채널 설정: 채널이 없거나 모르면 레슬링', () => {
    assert.equal(profileOf(fakeE(undefined)), CHANNEL_PROFILES['yt-wrestling']);
    assert.equal(profileOf(fakeE('nope')), CHANNEL_PROFILES['yt-wrestling']);
    assert.equal(profileOf({ s: {} }), CHANNEL_PROFILES['yt-wrestling']);
    const p = prompt(fakeE(''));
    assert.match(p, /레슬링·주짓수·MMA/); assert.doesNotMatch(p, /한국어로만|채널 목소리|영상 속 실제 발언/);
    assert.match(p, /5\. 번호, 따옴표, 머리말/);  // 규칙은 예전처럼 5개
  });
  await check('채널 설정: 기독교 프롬프트 = 한국어만 + 충실한 번역 + 목소리', () => {
    const info = [{ title: 'Debate', channel: 'Liberty Hangout', transcript: [{ range: '0:10-0:20', text: 'God is love and truth.' }] }];
    const p = prompt(fakeE('yt-christian', { voice: '차분하고 단단하게' }), info);
    assert.match(p, /기독교 해설/); assert.match(p, /모두 한국어로만/); assert.match(p, /그는 ~라고 말해요/);
    assert.match(p, /영상에 없는 발언을 지어내지 마/); assert.match(p, /교단의 공식 판단과 내 의견/);
    assert.match(p, /25자 이내/); assert.match(p, /채널 목소리: 차분하고 단단하게/);
    assert.match(p, /영상 속 실제 발언 \(영어 자동 자막, 오류가 있을 수 있음\):\n\[소스 1 · 0:10-0:20\] God is love/);
    assert.match(p, /한국어로 충실하게 옮겨/); assert.doesNotMatch(p, /레슬링/);
    assert.doesNotMatch(prompt(fakeE('yt-christian')), /영상 속 실제 발언/);  // 자막이 없으면 블록 없음
  });
  await check('채널 설정: 자막은 약 3000자까지만', () => {
    const info = [{ title: 'T', channel: 'C', transcript: [{ range: '0:00-0:15', text: 'word '.repeat(2000) }] }];
    const p = prompt(fakeE('yt-politics'), info), blk = p.split('오류가 있을 수 있음):\n')[1].split('\n\n규칙')[0];
    assert.ok(blk.length <= 3000, String(blk.length));
  });
  await check('VTT: 구간 글만 뽑고, 자동자막이 되풀이하는 줄은 한 번만', () => {
    const vtt = `WEBVTT\nKind: captions\nLanguage: en\n\n00:00:01.000 --> 00:00:03.000 align:start position:0%\nHello and <00:00:01.500><c>welcome</c><c> everyone</c>\n\n00:00:03.000 --> 00:00:03.010 align:start position:0%\nHello and welcome everyone\n \n\n00:00:03.010 --> 00:00:05.000 align:start position:0%\nHello and welcome everyone\ntoday we talk &amp; pray\n\n00:00:05.000 --> 00:00:05.010 align:start position:0%\ntoday we talk &amp; pray\n \n\n00:00:05.010 --> 00:00:08.000 align:start position:0%\ntoday we talk &amp; pray\nabout grace\n\n00:00:20.000 --> 00:00:22.000\nfar away line\n`;
    const cues = parseVtt(vtt);
    assert.deepEqual(cues.map(c => c.text), ['Hello and welcome everyone', 'today we talk & pray', 'about grace', 'far away line']);
    const tr = transcriptFor(cues, ['0:02-0:05', '0:19-0:21']);
    assert.deepEqual(tr, [{ range: '0:02-0:05', text: 'Hello and welcome everyone today we talk & pray' }, { range: '0:19-0:21', text: 'far away line' }]);
    assert.deepEqual(parseVtt(''), []);
  });
  await check('채널 설정: 채널마다 태그·고지문이 달라요', () => {
    const w = CHANNEL_PROFILES['yt-wrestling'], c = CHANNEL_PROFILES['yt-christian'], pol = CHANNEL_PROFILES['yt-politics'];
    assert.deepEqual(w.tags, ['레슬링', '주짓수', 'MMA']); assert.match(w.disclaimer, /^경기 장면은 해설·분석 목적으로/);
    assert.deepEqual(c.tags, ['기독교', '성경', '신앙', '변증']); assert.match(c.disclaimer, /영어 발언은 한국어로 옮겨/);
    assert.deepEqual(pol.tags, ['정치', '이민', '시사']);
    assert.ok(!w.transcript && c.transcript && pol.transcript);
  });
  // ---- 배너 룩 (네트워크·ffmpeg 필요 없음) ----
  await check('배너 룩: 줄 읽기 (배너·나레이션·영어·강조)', () => {
    const txt = '# 제목\n> 배너: 고통 속의 질문 / 답은 있다\n> 메모: x\n\n나레이션: 미국의 *목사* 팀 켈러예요\nN: 둘째 소개\n1. 고통에도 *의미*가 있어요 | Suffering has *meaning*.\n그냥 한국어만\n';
    assert.deepEqual(parseBanner(txt), { small: '고통 속의 질문', big: '답은 있다', raw: '고통 속의 질문 / 답은 있다' });
    assert.equal(parseBanner('> 배너: 한 줄만').big, '한 줄만'); assert.equal(parseBanner('아무것도 없음'), null);
    const raw = parseScript(txt); assert.equal(raw.length, 4);  // '>' 줄은 대사가 아니에요
    const L = raw.map(parseLine);
    assert.deepEqual(L.map(l => l.narr), [true, true, false, false]);
    assert.equal(L[0].text, '미국의 목사 팀 켈러예요'); assert.equal(L[0].ko, '미국의 *목사* 팀 켈러예요');
    assert.equal(L[2].text, '고통에도 의미가 있어요'); assert.equal(L[2].en, 'Suffering has *meaning*.');
    assert.equal(L[3].text, '그냥 한국어만'); assert.equal(L[3].en, '');
    assert.ok(L.every(l => !l.text.includes('*') && !l.text.includes('|')));
    assert.deepEqual(parseLine('별표 없는 평범한 줄'), { narr: false, ko: '별표 없는 평범한 줄', en: '', text: '별표 없는 평범한 줄' });
    assert.deepEqual(bwSpans([{ narr: true, start: 0, end: 2 }, { narr: true, start: 2, end: 4 }, { narr: false, start: 4, end: 6 }, { narr: true, start: 6, end: 7 }]), [[0, 4], [6, 7]]);
  });
  await check('배너 룩: 제목으로 배너 대신 만들기', () => {
    assert.deepEqual(bannerFromTitle("'신이 있다면 왜 고통이 있나' 캠퍼스에서 들은 한 가지 답"), { small: '신이 있다면 왜 고통이 있나', big: '캠퍼스에서 들은 한 가지 답' });
    assert.deepEqual(bannerFromTitle('한단어'), { small: '', big: '한단어' });
    assert.ok([...bannerFromTitle('가나다 '.repeat(20)).big].length <= 16);
  });
  const plan = look => ({ title: 'T 제목', width: 1080, height: 1920, total: 12, ...(look ? { look: resolveLook(look), banner: { small: '작은 줄', big: '큰 줄' } } : {}),
    lines: [{ i: 0, text: '소개해요', ko: '*소개*해요', en: '', narr: true, start: 0, end: 4, clip: 0 }, { i: 1, text: '고통에도 의미가 있죠', ko: '고통에도 *의미*가 있죠', en: 'Suffering has *meaning*.', narr: false, start: 4, end: 12, clip: 0 }] });
  await check('배너 룩: 크리스천 ASS = 배너·민트·영어 줄·띠', () => {
    const a = buildAss(plan(CHANNEL_PROFILES['yt-christian'].look));
    assert.match(a, /Style: BanB,.*,&H00C0E03D,/); assert.match(a, /Dialogue: 2,[^\n]*,BanS,[^\n]*작은 줄/); assert.match(a, /Dialogue: 2,[^\n]*,BanB,[^\n]*큰 줄/);
    assert.match(a, /,Bar,,0,0,0,,\{\\p1\\pos\(0,0\)\\bord0\\shad0\}m 460 207 l 620 207/);
    assert.match(a, /,Narr,[^\n]*\{\\c&HC0E03D&\}소개\{\\c&HFFFFFF&\}해요/);
    assert.match(a, /,Sub,[^\n]*고통에도 \{\\c&HC0E03D&\}의미\{\\c&HFFFFFF&\}가 있죠\\N\{\\fs52[^\n]*Suffering has \{\\c&HC0E03D&\}meaning\{\\c&HFFFFFF&\}\./);
    assert.ok(!a.includes('*') && !a.includes('Style: Title'));  // 제목 카드 없음
  });
  await check('자막 상자(subBox): 켜면 한국어+영어 한 상자 + 나레이션 상자, 끄면 없음', () => {
    const L0 = CHANNEL_PROFILES['yt-christian'].look, count = a => (a.match(/\\1a&H1A&/g) || []).length;
    const on = buildAss(plan(L0)), off = buildAss(plan({ ...L0, subBox: false }));
    assert.equal(count(on), 2);  // 나레이션 1 + (한국어·영어 묶음) 1
    assert.match(on, /Dialogue: 0,0:00:04\.00,0:00:12\.00,Bar,[^\n]*\\1c&H331B0E&\\1a&H1A&\}m /);   // 남색 #0E1B33, 투명도 20%
    assert.match(on, /Dialogue: 1,0:00:04\.00,0:00:12\.00,Sub,/); assert.match(on, /m 4\d\d \d+ l 6\d\d /);  // 화면 가운데 860px 이상
    assert.equal(count(off), 0); assert.match(off, /Dialogue: 0,0:00:04\.00,0:00:12\.00,Sub,/);
    const pl = P => buildAss({ ...P, hook: { text: '훅', dur: 1 }, bw: [] }), pp = look => plan(look).lines && ({ ...plan(look), lines: plan(look).lines.map(l => ({ ...l, narr: false, punch: false })) });
    const PL = CHANNEL_PROFILES['yt-politics'].look;
    assert.equal(count(pl(pp(PL))), 0); assert.equal(count(pl(pp({ ...PL, subBox: true }))), 2);  // 펀치 룩은 기본 꺼짐, 켤 수도 있어요
  });
  await check('배너 룩: 다른 채널·롱폼·look 없는 계획은 예전과 똑같은 ASS', () => {
    for (const P of [plan(null), { ...plan(null), lines: plan(null).lines.map(({ i, text, start, end, clip }) => ({ i, text, start, end, clip })) }, { ...plan(CHANNEL_PROFILES['yt-christian'].look), width: 1920, height: 1080 }]) sameAsOld(P);
    assert.ok(!CHANNEL_PROFILES['yt-wrestling'].look); assert.equal(CHANNEL_PROFILES['yt-politics'].look.kind, 'punch');
    assert.equal(lookOf(fakeE('yt-wrestling')), null); assert.equal(lookOf(fakeE('yt-politics', { format: 'long' })), null);
    assert.equal(lookOf(fakeE('yt-christian', { format: 'long' })), null); assert.equal(lookOf(fakeE('yt-christian')).accent, '#3DE0C0');
  });
  await check('배너 룩: 크리스천 쇼츠 프롬프트에 형식 안내 (롱폼·다른 채널엔 없음)', () => {
    const p = prompt(fakeE('yt-christian'));
    assert.match(p, /이펙트 단계에서 영상 제목으로/); assert.match(p, /나레이션: /); assert.match(p, /한국어 \| English original/); assert.match(p, /\*별표\*/);
    assert.doesNotMatch(prompt(fakeE('yt-christian', { format: 'long' })), /배너/); assert.doesNotMatch(prompt(fakeE('yt-politics')), /배너/); assert.doesNotMatch(prompt(fakeE('')), /배너/);
  });
  await check('펀치 룩: 훅·! 펀치·강조 읽기 + ASS (영어 줄 없음, 배너 없음)', () => {
    const txt = '> 훅: 런던 거리의 위협\n이 *정책*, 정말 괜찮을까요?\n!그 순간!\n영어 | 줄은 그냥 한국어\n';
    assert.equal(parseHook(txt).text, '런던 거리의 위협'); assert.equal(parseHook('없음'), null);
    assert.equal(hookFromTitle("“If You Blaspheme the Prophet Muhammad, We’ll Beat You Up!”").text, 'If You Blaspheme');
    const L = parseScript(txt).map(l => parseLine(l, 'punch'));
    assert.equal(L.length, 3); assert.deepEqual(L.map(l => l.punch), [false, true, false]);
    assert.equal(L[0].text, '이 정책, 정말 괜찮을까요?'); assert.equal(L[1].text, '그 순간!'); assert.equal(L[2].en, ''); assert.equal(L[2].text, '영어 | 줄은 그냥 한국어');
    const P = { title: 'T', width: 1080, height: 1920, total: 10, look: resolveLook(CHANNEL_PROFILES['yt-politics'].look), hook: { text: '런던 거리의 위협', dur: 1.3 }, bw: [],
      lines: L.map((l, i) => ({ i, text: l.text, ko: l.ko, en: '', narr: false, punch: l.punch, start: i * 3, end: i * 3 + 3, clip: 0 })) };
    const a = buildAss(P);
    assert.match(a, /,Hook,[^\n]*런던 거리의/); assert.match(a, /Style: Hook,.*,&H0000D4FF,/);   // #FFD400 → &HBBGGRR
    assert.match(a, /Dialogue: 0,0:00:01\.30,0:00:03\.00,Cap,[^\n]*이 \{\\c&H00D4FF&\}정책\{\\c&HFFFFFF&\},/);  // 훅 동안은 자막 쉼
    assert.match(a, /,Punch,[^\n]*\\frz-4\\fscx130\\fscy130\\t\(0,120,\\fscx100\\fscy100\)\}그 순간!/);
    assert.match(a, /,WM,[^\n]*\\alpha&H40&\}FIELDNOTE/); assert.ok(!a.includes('Style: Bar') && !a.includes('Style: Title') && !a.includes('*'));
  });
  await check('펀치 룩: 레슬링은 예전과 똑같고, 정치 쇼츠 프롬프트에만 훅 안내', () => {
    const P = { title: 'T', width: 1080, height: 1920, total: 10, lines: [{ i: 0, text: '가나다', start: 0, end: 5, clip: 0 }] };
    sameAsOld(P);
    const p = prompt(fakeE('yt-politics'));
    assert.match(p, /이펙트 단계에서 영상 제목으로/); assert.match(p, /"!" 를 붙여/); assert.match(p, /집단으로 조롱하거나 비하하지 마/); assert.match(p, /모두 한국어로만/); assert.doesNotMatch(p, /English/);
    assert.doesNotMatch(prompt(fakeE('yt-politics', { format: 'long' })), /훅/); assert.doesNotMatch(prompt(fakeE('yt-wrestling')), /훅/);
  });
  // 합성 소스: 10초 가로 영상 + 소리
  const src = path.join(tmp, 'source.mp4');
  await run(FFMPEG, ['-hide_banner', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=10', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=10', '-c:v', 'libx264', '-c:a', 'aac', '-shortest', src]);
  // 소스 옆 자막 파일 (자막 자동화가 읽어요): 소스 2~4초 / 4.5~5초 / 7.5~9초
  fs.writeFileSync(path.join(tmp, 'source.vtt'), 'WEBVTT\n\n00:00:02.000 --> 00:00:04.000\nGod is love\n\n00:00:04.500 --> 00:00:05.000\nTruth\n\n00:00:07.500 --> 00:00:09.000\nBeyond\n\n00:00:09.200 --> 00:00:09.900\n[Music]\n');
  // 합성 음악
  fs.mkdirSync(path.join(tmp, 'home/소리/BGM'), { recursive: true });
  await run(FFMPEG, ['-hide_banner', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=220:duration=5', path.join(tmp, 'home/소리/BGM/test-bgm.mp3')]);

  await check('매트 스토리 룩: 슬로우 구간 x0.5 · [태그]/[점수] 줄 · ASS (제목 2줄·출처·SLOW / 자막·태그·도장)', () => {
    assert.deepEqual(parseRanges('0:30-0:42, 1:05-1:09x0.5 2:00-2:04*0.4'), ['0:30-0:42', '1:05-1:09x0.5', '2:00-2:04x0.4']);
    assert.deepEqual(rangeSecs('1:05-1:09x0.5'), [65, 69]); assert.equal(rangeSpeed('1:05-1:09x0.5'), 0.5); assert.equal(rangeSpeed('0:30-0:42'), 1);
    assert.throws(() => parseRanges('0:30-0:34x2'), /0.25~1/);
    const it = matItems(['[태그] 로페스 (쿠바) / 2016 리우', '첫 *자막*', '[점수] 4 : 0 / 쿠바 4 : 터키 0', '둘째']);
    assert.equal(it.length, 2); assert.deepEqual(it[0].tag, { main: '로페스 (쿠바)', sub: '2016 리우' }); assert.equal(it[0].text, '첫 자막'); assert.equal(it[1].stamp.main, '4 : 0');
    assert.deepEqual(splitAnswer('```\n구간: 0:01-0:05x0.5\n> 배너: a / b\n줄\n```'), { ranges: '0:01-0:05x0.5', text: '> 배너: a / b\n줄' });
    const P = { width: 1080, height: 1920, total: 10, look: resolveLook(CHANNEL_PROFILES['yt-mat'].look), banner: { small: '위 줄', big: '아랫줄 ㄷㄷ' }, credit: 'UWW',
      clips: [{ start: 0, duration: 4 }, { start: 4, duration: 6, speed: 0.5 }], lines: [{ start: 0, end: 5, text: '첫 자막', ko: '첫 *자막*', tag: { main: '로페스', sub: '리우' } }, { start: 5, end: 10, text: '둘째', ko: '둘째', stamp: { main: 'FALL', sub: '폴승' } }] };
    const fx = buildAss(P, 'fx'), ln = buildAss(P, 'lines');
    assert.match(fx, /위 줄/); assert.match(fx, /아랫줄 ㄷㄷ/); assert.match(fx, /영상: /); assert.match(fx, /SLOW 0\.5x/); assert.match(fx, /MAT/); assert.doesNotMatch(fx, /첫 /);
    assert.match(ln, /Cap,,0,0,0,,.*첫 /); assert.match(ln, /Tag,,.*로페스/); assert.match(ln, /Stamp,,.*FALL/); assert.doesNotMatch(ln, /SLOW/);
    assert.match(promptFor({ s: { title: 'T', note: '', format: 'shorts', channel: 'yt-wrestling', look: 'yt-mat' } }, [{ title: 'T', channel: 'C' }], [{ duration: 30 }], 30), /> 배너[\s\S]*\[태그\][\s\S]*\[점수\]/);
  });
  await check('CORS: 허용 사이트 + 사설망 헤더', async () => {
    const r = await fetch(B + '/status', { method: 'OPTIONS', headers: { Origin: 'https://digitalstudio-eight.vercel.app', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Private-Network': 'true' } });
    assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), 'https://digitalstudio-eight.vercel.app'); assert.equal(r.headers.get('access-control-allow-private-network'), 'true');
    const bad = await fetch(B + '/status', { headers: { Origin: 'https://evil.example' } }); assert.equal(bad.status, 403);
    const loc = await fetch(B + '/status', { headers: { Origin: 'http://localhost:5178' } }); assert.equal(loc.headers.get('access-control-allow-origin'), 'http://localhost:5178');
  });
  await check('잘못된 구간(15초 초과)은 거절', async () => { const { r, d } = await J('/episodes', { title: 'x', url: src, ranges: '0:00-0:40' }); assert.equal(r.status, 400); assert.match(d.error, /15초/); });

  let E;
  await check('에피소드 만들기', async () => {
    const { r, d } = await J('/episodes', { title: '테스트: 그레코로만 던지기?', note: '허리 던지기 한 장면\n상대 균형을 먼저 무너뜨린다', url: src, ranges: '0:01-0:07, 0:03-0:08', ideaId: 'idea-1' });
    assert.equal(r.status, 200); E = d.ep; assert.ok(E);
    const e = await ep(); assert.equal(e.ideaId, 'idea-1'); assert.deepEqual(e.sources[0].ranges, ['0:01-0:07', '0:03-0:08']);
    assert.deepEqual(e.steps.map(s => s.id), ['research', 'download', 'clip', 'plan', 'rough', 'subs', 'fx', 'script', 'mix', 'upload']);
    assert.equal(e.look, ''); assert.equal(e.lookUsed, 'yt-wrestling');
    assert.ok(step(e, 'script').gate); assert.equal(e.gate, false);
  });
  await check('/runall: 소스확인 → 받기 → 자르기 → 계획 → 가편집 → 자막 → 이펙트 → 대본(게이트)', async () => {
    const { d } = await J('/runall', { ep: E }); assert.equal(d.from, 'research');
    const e = await waitIdle();
    for (const id of ['research', 'download', 'clip', 'plan', 'rough', 'subs', 'fx', 'script']) assert.equal(step(e, id).status, 'done', id + ' ' + step(e, id).error);
    assert.equal(e.gate, true); assert.equal(step(e, 'mix').status, 'todo');
    assert.equal(step(e, 'clip').outputs.filter(o => o.exists).length, 2);
    assert.ok(step(e, 'subs').outputs[0].exists); assert.ok(step(e, 'fx').outputs[0].exists);
    assert.ok(step(e, 'script').outputs[0].exists);
    assert.ok(fs.existsSync(path.join(tmp, 'data', E, '편집/대본-요청.txt')));
    const pr = await probe(path.join(tmp, 'data', E, '편집/완성본.mp4'));
    assert.equal(pr.width, 1080); assert.equal(pr.height, 1920); assert.ok(pr.hasAudio); assert.ok(Math.abs(pr.duration - 11) < 0.3, '길이 ' + pr.duration);
    const P = JSON.parse(fs.readFileSync(path.join(tmp, 'data', E, '편집/편집계획.json'), 'utf8'));
    assert.deepEqual(P.lines, []); assert.equal(P.clips.length, 2); assert.equal(P.clips[0].range, '0:01-0:07'); assert.equal(P.clips[1].si, 0); assert.equal(P.clips[1].a, 3); assert.equal(P.srcSubs, true);
  });
  await check('자막 자동화: 소스 자막이 편집 시간으로 옮겨져 입혀짐 ([Music] 같은 줄은 뺌)', async () => {
    const P = JSON.parse(fs.readFileSync(path.join(tmp, 'data', E, '편집/편집계획.json'), 'utf8')), info = JSON.parse(fs.readFileSync(path.join(tmp, 'data', E, '소스.json'), 'utf8'));
    const fakeEp = { p: (...a) => path.join(tmp, 'data', E, ...a), s: { sources: [{ url: src, ranges: ['0:01-0:07', '0:03-0:08'] }] } };
    const cues = srcCues(fakeEp, P, info);
    assert.deepEqual(cues.map(c => [c.start, c.end, c.en]), [[1, 3, 'God is love'], [3.5, 4, 'Truth'], [6, 7, 'God is love'], [7.5, 8, 'Truth'], [10.5, 11, 'Beyond']]);
    const ass = fs.readFileSync(path.join(tmp, 'data', E, '편집/원본자막.ass'), 'utf8'); assert.match(ass, /Style: Src,/); assert.match(ass, /Dialogue: 0,0:00:01\.00,0:00:03\.00,Src,,0,0,0,,God is love/); assert.ok(!ass.includes('Music'));
    const log = fs.readFileSync(path.join(tmp, 'data', E, '로그/subs.log'), 'utf8'); assert.match(log, /원본 자막 5줄/);
  });
  await check('/runall, /continue: 게이트 중에는 막고, 빈 양식 대본은 거절', async () => {
    assert.equal((await J('/runall', { ep: E })).r.status, 400);
    const c = await J('/continue', { ep: E }); assert.equal(c.r.status, 400); assert.match(c.d.error, /여기에 대사/);
  });
  await check('GET/POST /script: 요청문 읽기, 번호·따옴표 정리, 빈/양식/너무 긴 대본 거절', async () => {
    const g = await J('/script?ep=' + encodeURIComponent(E)); assert.equal(g.r.status, 200);
    assert.equal(g.d.hasPlaceholder, true); assert.equal(g.d.ai, false); assert.deepEqual(g.d.lines, []); assert.match(g.d.request, /대사/);
    for (const text of ['', '# 제목\n> 메모\n\n', '첫 줄\n[여기에 대사]\n셋째']) { const r = await J('/script', { ep: E, text }); assert.equal(r.r.status, 400, text); }
    assert.match((await J('/script', { ep: E, text: '첫 줄\n[여기에 대사]' })).d.error, /2번째/);
    assert.equal((await J('/script', { ep: E, text: Array(31).fill('가').join('\n') })).r.status, 400);
    assert.equal((await J('/script', { ep: 'nope', text: 'a' })).r.status, 404);
    const f = path.join(tmp, 'data', E, '편집/대본.md'); assert.match(fs.readFileSync(f, 'utf8'), /여기에 대사/);  // 거절하면 파일은 그대로
    const ok = await J('/script', { ep: E, text: '# 무시\n1. 첫 대사예요\n- “둘째 대사예요”\n\n> 무시\n3) 셋째 대사예요\n' });
    assert.equal(ok.r.status, 200); assert.equal(ok.d.lines, 3);
    const t = fs.readFileSync(f, 'utf8'); assert.match(t, /^# 테스트/); assert.ok(!t.includes('여기에 대사')); assert.ok(!t.includes('대본-요청'));
    assert.ok(t.endsWith('첫 대사예요\n둘째 대사예요\n셋째 대사예요\n'), t);
    assert.match(fs.readFileSync(path.join(tmp, 'data', E, '편집/대본.bak.md'), 'utf8'), /여기에 대사/);
    assert.ok(fs.existsSync(path.join(tmp, 'data', E, '편집/대본-요청.txt')));
    const g2 = (await J('/script?ep=' + encodeURIComponent(E))).d; assert.equal(g2.hasPlaceholder, false); assert.equal(g2.lines.length, 3);
    const e = await ep(); assert.equal(e.gate, true); assert.equal(step(e, 'script').status, 'done');
  });
  await check('대본 확인 → 줄마다 시간표 (영상은 다시 안 돌림)', async () => {
    const f = path.join(tmp, 'data', E, '편집/대본.md');
    fs.writeFileSync(f, '# 제목\n> 메모\n허리 던지기, 이렇게 시작해요\n상대의 균형을 먼저 무너뜨려요\n1. 허리를 깊게 넣고 끝까지 돌려요\n마무리는 이렇게!\n');
    const before = fs.statSync(path.join(tmp, 'data', E, '편집/완성본.mp4')).mtimeMs;
    const { r, d } = await J('/continue', { ep: E }); assert.equal(r.status, 200); assert.equal(d.from, 'mix');
    const e = await ep(); assert.ok(!e.running); assert.equal(e.gate, false); assert.equal(step(e, 'mix').status, 'todo');
    assert.equal(fs.statSync(path.join(tmp, 'data', E, '편집/완성본.mp4')).mtimeMs, before);
    const plan = JSON.parse(fs.readFileSync(path.join(tmp, 'data', E, '편집/편집계획.json'), 'utf8')); assert.equal(plan.lines.length, 4);
    assert.equal(plan.lines[0].start, 0); assert.ok(Math.abs(plan.lines[3].end - 11) < 0.02); assert.ok(plan.lines.every((l, i) => i === 0 || Math.abs(l.start - plan.lines[i - 1].end) < 0.02));
  });
  let lines;
  await check('/lines: 줄·길이·음악 목록', async () => {
    const { d } = await J('/lines?ep=' + encodeURIComponent(E)); lines = d.lines;
    assert.equal(lines.length, 4); assert.ok(lines.every(l => l.file === null && l.end > l.start));
    assert.deepEqual(d.assets.bgm, ['test-bgm.mp3']); assert.deepEqual(d.assets.sting, []);
  });
  await check('/voice: webm/opus 업로드 → m4a 변환', async () => {
    const wb = path.join(tmp, 'v.webm');
    await run(FFMPEG, ['-hide_banner', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=2', '-c:a', 'libopus', wb]);
    for (const i of [0, 1, 3]) {
      const r = await fetch(`${B}/voice?ep=${encodeURIComponent(E)}&idx=${i}`, { method: 'POST', headers: { 'Content-Type': 'audio/webm' }, body: fs.readFileSync(wb) });
      assert.equal(r.status, 200, await r.text());
    }
    const { d } = await J('/lines?ep=' + encodeURIComponent(E)); assert.deepEqual(d.lines.map(l => !!l.file), [true, true, false, true]);
    const a = await fetch(`${B}/file?ep=${encodeURIComponent(E)}&path=${encodeURIComponent('편집/녹음/' + d.lines[0].file)}`); assert.equal(a.status, 200);
    assert.equal((await J('/voice?ep=' + encodeURIComponent(E) + '&idx=99', null, { method: 'POST', body: 'x'.repeat(500) })).r.status, 400);
  });
  await check('/mixset 저장 + 없는 파일 거절', async () => {
    assert.equal((await J('/mixset', { ep: E, bgm: 'nope.mp3', sting: '' })).r.status, 400);
    assert.equal((await J('/mixset', { ep: E, bgm: 'test-bgm.mp3', sting: '' })).r.status, 200);
    assert.equal((await J('/lines?ep=' + encodeURIComponent(E))).d.mix.bgm, 'test-bgm.mp3');
  });
  await check('/run mix → 최종본.mp4 (영상+소리, 길이 일치)', async () => {
    assert.equal((await J('/run', { ep: E, step: 'mix' })).r.status, 200);
    const e = await waitIdle(); assert.equal(step(e, 'mix').status, 'done', step(e, 'mix').error);
    const f = path.join(tmp, 'data', E, '편집/최종본.mp4'), pr = await probe(f);
    assert.ok(pr.hasVideo && pr.hasAudio); assert.equal(pr.width, 1080); assert.equal(pr.height, 1920); assert.ok(Math.abs(pr.duration - 11) < 0.4, '길이 ' + pr.duration);
    const vol = await run(FFMPEG, ['-hide_banner', '-nostdin', '-i', f, '-vn', '-af', 'volumedetect', '-f', 'null', '-']).catch(e => e);
    const m = /mean_volume: (-?[\d.]+) dB/.exec((vol.err || '')); assert.ok(m && +m[1] > -60, '무음이에요: ' + (m && m[1]));
    assert.ok(fs.statSync(f).size > 50000);
    assert.ok(fs.existsSync(path.join(tmp, 'data', E, '편집/대본자막.ass')));
    assert.match(fs.readFileSync(path.join(tmp, 'data', E, '로그/mix.log'), 'utf8'), /대본 자막 4줄을 영상에 입혀요/);
    assert.match(fs.readFileSync(path.join(tmp, 'data', E, '편집/대본자막.ass'), 'utf8'), /Dialogue: 0,0:00:00\.00,[^\n]*Cap,[^\n]*허리 던지기/);
  });
  await check('/run upload → 업로드 패키지', async () => {
    await J('/run', { ep: E, step: 'upload' }); const e = await waitIdle(); assert.equal(step(e, 'upload').status, 'done', step(e, 'upload').error);
    const o = step(e, 'upload').outputs; assert.ok(o.every(x => x.exists), JSON.stringify(o));
    const pk = JSON.parse(fs.readFileSync(path.join(tmp, 'data', E, '업로드/업로드.json'), 'utf8')); assert.equal(pk.fromVideo, '편집/최종본.mp4'); assert.match(pk.description, /경기 장면은/);
  });
  await check('결과 파일에 mtime(ms) 이 붙고, 없는 파일에는 안 붙음', async () => {
    const e = await ep(), o = step(e, 'mix').outputs[0], real = fs.statSync(path.join(tmp, 'data', E, '편집/최종본.mp4')).mtimeMs;
    assert.ok(o.exists); assert.ok(Math.abs(o.mtime - real) < 2, `mtime ${o.mtime} vs ${real}`);
    const miss = step(e, 'upload').outputs.concat(step(e, 'download').outputs).filter(x => !x.exists); for (const x of miss) assert.equal(x.mtime, undefined);
  });
  await check('/run steps:[...] 여러 단계를 순서대로 · 잘못된 요청은 거절', async () => {
    assert.equal((await J('/run', { ep: E, steps: [] })).r.status, 400);
    assert.equal((await J('/run', { ep: E, steps: ['plan', 'nope'] })).r.status, 400);
    assert.equal((await J('/run', { ep: E, steps: ['plan', 5] })).r.status, 400);
    assert.equal((await J('/run', { ep: E })).r.status, 400);
    const before = fs.statSync(path.join(tmp, 'data', E, '편집/완성본.mp4')).mtimeMs;
    const { r, d } = await J('/run', { ep: E, steps: ['fx', 'rough', 'fx'] });   // 순서·중복은 서버가 정리
    assert.equal(r.status, 200); assert.deepEqual(d.steps, ['rough', 'fx']);
    assert.equal((await J('/run', { ep: E, steps: ['plan'] })).r.status, 409);   // 도는 중엔 막음
    const e = await waitIdle();
    assert.equal(step(e, 'rough').status, 'done', step(e, 'rough').error); assert.equal(step(e, 'fx').status, 'done', step(e, 'fx').error);
    const after = fs.statSync(path.join(tmp, 'data', E, '편집/완성본.mp4')).mtimeMs; assert.ok(after > before, '완성본이 새로 만들어져야 해요');
    assert.ok(step(e, 'fx').outputs[0].mtime > before - 1);
    const lr = fs.readFileSync(path.join(tmp, 'data', E, '로그/rough.log'), 'utf8'), lf = fs.readFileSync(path.join(tmp, 'data', E, '로그/fx.log'), 'utf8');
    assert.ok(lr && lf);
  });
  await check('/run steps 에 대본이 있으면 게이트가 다시 열리고 거기서 멈춤', async () => {
    const { d } = await J('/run', { ep: E, steps: ['script', 'plan'] }); assert.deepEqual(d.steps, ['plan', 'script']);   // 계획이 대본보다 앞
    const e = await waitIdle(); assert.equal(step(e, 'script').status, 'done', step(e, 'script').error); assert.equal(e.gate, true);
    assert.notEqual(step(e, 'plan').status, 'running');
  });
  await check('/file: Range, 경로 탈출 차단', async () => {
    const p = encodeURIComponent('편집/최종본.mp4');
    const r = await fetch(`${B}/file?ep=${encodeURIComponent(E)}&path=${p}`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(r.status, 206); assert.match(r.headers.get('content-range'), /^bytes 0-99\//); assert.equal((await r.arrayBuffer()).byteLength, 100);
    assert.equal((await fetch(`${B}/file?ep=${encodeURIComponent(E)}&path=${encodeURIComponent('../../../etc/hosts')}`)).status, 403);
    assert.equal((await fetch(`${B}/file?ep=${encodeURIComponent(E)}&path=${encodeURIComponent('/etc/hosts')}`)).status, 403);
    assert.equal((await fetch(`${B}/file?ep=${encodeURIComponent('../data')}&path=state.json`)).status, 404);
  });
  await check('/log, /source, /link', async () => {
    const t = await (await fetch(`${B}/log?ep=${encodeURIComponent(E)}&step=mix&tail=6000`)).text(); assert.match(t, /최종본\.mp4 완성/);
    assert.equal((await J('/source', { ep: E, url: src, ranges: '0:00-0:05' })).r.status, 200); assert.equal((await ep()).sources.length, 2);
    assert.equal((await J('/link', { ep: E, ideaId: 'idea-2' })).r.status, 200);
  });
  await check('실패 사유는 한국어: 없는 파일 소스', async () => {
    await J('/source', { ep: E, url: '/nonexistent/video.mp4', ranges: '0:00-0:05' });
    await J('/run', { ep: E, step: 'research' }); const e = await waitIdle(); assert.equal(step(e, 'research').status, 'failed'); assert.match(step(e, 'research').error, /찾을 수 없어요/);
  });
  await check('/stop: 실행 중 멈춤', async () => {
    // 정상 소스를 다시 만들어 download 를 시작하자마자 멈춘다
    const e0 = await ep(); const s = e0.sources.filter(x => x.url === src);
    assert.ok(s.length);
    const { d } = await J('/episodes', { title: '멈춤 테스트', url: src, ranges: '0:00-0:10' }); const E2 = d.ep;
    await J('/run', { ep: E2, step: 'research' }); await new Promise(r => setTimeout(r, 1500));
    await J('/run', { ep: E2, step: 'download' }); await J('/stop', { ep: E2 });
    for (let i = 0; i < 50; i++) { const e = (await J('/status')).d.episodes.find(x => x.ep === E2); if (!e.running) break; await new Promise(r => setTimeout(r, 200)); }
    const e = (await J('/status')).d.episodes.find(x => x.ep === E2); assert.ok(!e.running);
    assert.ok(['failed', 'done'].includes(step(e, 'download').status));
  });

  // ---------- 새 순서 (링크 → 룩 → 영상 → 컷 → 자막 → 이펙트 → 대본·녹음 → 패키지) ----------
  let L1;
  await check('룩: 편집 레퍼런스 목록 + 기본 = 채널 룩 (영상마다 고를 수 있음)', async () => {
    assert.deepEqual(LOOK_CHOICES.map(l => l.id), ['yt-wrestling', 'yt-christian', 'yt-politics', 'yt-mat']);
    assert.ok(LOOK_CHOICES.every(l => /룩/.test(l.name) && l.desc));
    assert.deepEqual((await J('/status')).d.looks.map(l => l.id), ['yt-wrestling', 'yt-christian', 'yt-politics', 'yt-mat']);
    assert.equal(lookKeyOf(fakeE('yt-politics')), 'yt-politics'); assert.equal(lookKeyOf(fakeE('yt-politics', { look: 'yt-christian' })), 'yt-christian');
    assert.equal(lookKeyOf(fakeE('yt-politics', { look: 'nope' })), 'yt-politics'); assert.equal(lookKeyOf(fakeE('')), 'yt-wrestling');
    assert.equal(lookOf(fakeE('yt-politics', { look: 'yt-christian' })).kind, 'banner'); assert.equal(lookOf(fakeE('yt-christian', { look: 'yt-wrestling' })), null);
    assert.equal(lookOf(fakeE('yt-christian', { look: 'yt-politics', format: 'long' })), null);
  });
  await check('링크 영상 다운 → 구간 없이도 소스 확인·영상 받기가 되고, 자르기는 구간을 요구', async () => {
    const { r, d } = await J('/episodes', { title: '룩 테스트', url: src, deferRanges: true, channel: 'yt-politics' }); assert.equal(r.status, 200); L1 = d.ep;
    const get = async () => (await J('/status')).d.episodes.find(x => x.ep === L1);
    let e = await get(); assert.deepEqual(e.sources[0].ranges, []); assert.equal(e.look, ''); assert.equal(e.lookUsed, 'yt-politics');
    await J('/run', { ep: L1, steps: ['research', 'download'] });
    for (let i = 0; i < 100 && (await get()).running; i++) await new Promise(r => setTimeout(r, 200));
    e = await get(); assert.equal(step(e, 'research').status, 'done', step(e, 'research').error); assert.equal(step(e, 'download').status, 'done', step(e, 'download').error);
    await J('/run', { ep: L1, step: 'clip' });
    for (let i = 0; i < 100 && (await get()).running; i++) await new Promise(r => setTimeout(r, 200));
    e = await get(); assert.equal(step(e, 'clip').status, 'failed'); assert.match(step(e, 'clip').error, /구간이 아직 없어요/);
  });
  await check('/ranges: 15초 규칙·빈 구간 거절, 바뀌면 자르기부터 되돌림', async () => {
    assert.equal((await J('/ranges', { ep: L1, ranges: '0:00-0:20' })).r.status, 400);
    assert.equal((await J('/ranges', { ep: L1, ranges: '' })).r.status, 400);
    assert.equal((await J('/ranges', { ep: 'nope', ranges: '0:00-0:05' })).r.status, 404);
    assert.equal((await J('/ranges', { ep: L1, ranges: '0:01-0:05', source: 3 })).r.status, 400);
    const ok = await J('/ranges', { ep: L1, ranges: '0:01-0:06' }); assert.equal(ok.r.status, 200); assert.deepEqual(ok.d.ranges, ['0:01-0:06']); assert.equal(ok.d.reset, true);
    assert.equal((await J('/ranges', { ep: L1, ranges: '0:01-0:06' })).d.reset, false);
    assert.deepEqual((await J('/status')).d.episodes.find(x => x.ep === L1).sources[0].ranges, ['0:01-0:06']);
  });
  await check('/look: 모르는 룩 거절 · 같은 룩이면 그대로 · 다른 룩이면 영상 단계만 되돌림 (소스·대본은 그대로)', async () => {
    assert.equal((await J('/look', { ep: L1, look: 'nope' })).r.status, 400); assert.equal((await J('/look', { ep: 'nope', look: 'yt-christian' })).r.status, 404);
    const same = await J('/look', { ep: L1, look: 'yt-politics' }); assert.equal(same.d.reset, false); assert.equal((await J('/status')).d.episodes.find(x => x.ep === L1).look, 'yt-politics');
    const ch = await J('/look', { ep: L1, look: 'yt-christian' }); assert.equal(ch.r.status, 200); assert.equal(ch.d.reset, true); assert.equal(ch.d.lookUsed, 'yt-christian');
    // 고른 룩(배너)으로 컷 → 자막 → 이펙트: 채널(정치)이 아니라 고른 룩을 써요
    await J('/run', { ep: L1, steps: ['clip', 'plan', 'rough', 'subs', 'fx'] });
    let e; for (let i = 0; i < 300; i++) { e = (await J('/status')).d.episodes.find(x => x.ep === L1); if (!e.running) break; await new Promise(r => setTimeout(r, 200)); }
    for (const id of ['clip', 'plan', 'rough', 'subs', 'fx']) assert.equal(step(e, id).status, 'done', id + ' ' + step(e, id).error);
    const P = JSON.parse(fs.readFileSync(path.join(tmp, 'data', L1, '편집/편집계획.json'), 'utf8'));
    assert.equal(P.look.kind, 'banner'); assert.equal(P.banner.big.length > 0, true); assert.deepEqual(P.bw, [[0, 1.5]]); assert.ok(!P.hook);   // 5초 영상: 인트로 = 30% = 1.5초
    const pr = await probe(path.join(tmp, 'data', L1, '편집/완성본.mp4')); assert.equal(pr.width, 1080); assert.equal(pr.height, 1920);
    const back = await J('/look', { ep: L1, look: 'yt-wrestling' }); assert.equal(back.d.reset, true);
    e = (await J('/status')).d.episodes.find(x => x.ep === L1);
    for (const id of ['clip', 'plan', 'rough', 'subs', 'fx', 'mix', 'upload']) assert.equal(step(e, id).status, 'todo', id);
    for (const id of ['research', 'download']) assert.equal(step(e, id).status, 'done', id);
  });
  await check('룩: 기본 룩은 look 없는 계획 + 펀치 룩은 훅·워터마크가 이펙트에 (대본 줄은 따로)', async () => {
    await J('/run', { ep: L1, steps: ['clip', 'plan'] });
    let e; for (let i = 0; i < 300; i++) { e = (await J('/status')).d.episodes.find(x => x.ep === L1); if (!e.running) break; await new Promise(r => setTimeout(r, 200)); }
    assert.ok(!JSON.parse(fs.readFileSync(path.join(tmp, 'data', L1, '편집/편집계획.json'), 'utf8')).look);
    const P = { title: 'T', width: 1080, height: 1920, total: 10, look: resolveLook(CHANNEL_PROFILES['yt-politics'].look), hook: { text: '훅 문구', dur: 1.3 }, bw: [],
      lines: [{ i: 0, text: '이 정책', ko: '이 *정책*', en: '', narr: false, punch: false, start: 2, end: 6, clip: 0 }] };
    const fxA = buildAss(P, 'fx'), lnA = buildAss(P, 'lines'), all = buildAss(P);
    assert.match(fxA, /,Hook,[^\n]*훅 문구/); assert.match(fxA, /,WM,/); assert.ok(!/,Cap,/.test(fxA.split('[Events]')[1]));
    assert.match(lnA, /,Cap,[^\n]*이 /); assert.ok(!/,Hook,|,WM,/.test(lnA.split('[Events]')[1]));
    assert.equal(all.split('[Events]')[1].split('\n').filter(l => l.startsWith('Dialogue')).length, fxA.split('[Events]')[1].split('\n').filter(l => l.startsWith('Dialogue')).length + lnA.split('[Events]')[1].split('\n').filter(l => l.startsWith('Dialogue')).length);
    const B = { ...P, look: resolveLook(CHANNEL_PROFILES['yt-christian'].look), banner: { small: '작은', big: '큰' }, lines: [{ i: 0, text: '고통에도 의미가', ko: '고통에도 *의미*가', en: 'Suffering has *meaning*.', narr: false, start: 2, end: 6, clip: 0 }] };
    assert.match(buildAss(B, 'fx'), /,BanB,[^\n]*큰/); assert.ok(!/,Sub,/.test(buildAss(B, 'fx').split('[Events]')[1])); assert.match(buildAss(B, 'lines'), /,Sub,[^\n]*Suffering/);
    assert.ok(!/,BanB,/.test(buildAss(B, 'lines').split('[Events]')[1]));
    assert.ok(!/Suffering/.test(buildAss({ ...B, srcSubs: true }, 'lines')), '원본 자막이 영어 원문을 이미 보여 주면 영어 줄은 빼요');
  });
  await check('자막 자동화: 영어 → 한국어 번역(키 있을 때) · 실패하면 영어 그대로 · 룩별 모양', async () => {
    const cues = [{ start: 0, end: 1, en: 'a' }, { start: 1, end: 2, en: 'b' }, { start: 2, end: 3, en: 'c' }];
    const ok = await translateCues(cues, async () => '여기 JSON: ["에이","비","씨"]'); assert.deepEqual(ok.map(c => c.ko), ['에이', '비', '씨']);
    const bad = await translateCues(cues, async () => '["하나만"]', { log() {} }); assert.ok(bad.every(c => !c.ko));
    const thr = await translateCues(cues, async () => { throw new Error('x'); }, { log() {} }); assert.ok(thr.every(c => c.en));
    const wide = { title: 'T', width: 1080, height: 1920, total: 5, lines: [] };
    assert.match(buildSrcAss(wide, ok), /PlayResY: 1920/); assert.match(buildSrcAss(wide, ok), /Src,,0,0,0,,에이/);
    const ban = { ...wide, look: resolveLook(CHANNEL_PROFILES['yt-christian'].look) };
    assert.match(buildSrcAss(ban, ok), /PlayResY: 1480/); assert.match(buildSrcAss(ban, ok), /Src,,0,0,0,,에이\\N\{\\fs39\\b0\}a/);   // 배너 룩 = 한·영 두 줄, 영상 칸 높이 기준
    assert.match(buildSrcAss({ ...wide, look: resolveLook(CHANNEL_PROFILES['yt-politics'].look) }, ok), /Style: Src,[^,]*,56,&H0000D4FF,/);
    assert.match(buildSrcAss({ ...wide, width: 1920, height: 1080 }, cues), /Style: Src,[^,]*,42,/);
  });
  await check('예전 에피소드(8단계) → 새 단계로 옮기기', async () => {
    const legacy = (channel, st) => ({ ep: 'x', channel, format: 'shorts', sources: [{ url: 'u', ranges: ['0:00-0:15'] }], steps: Object.fromEntries(['research', 'download', 'script', 'plan', 'rough', 'finish', 'mix', 'upload'].map(id => [id, { status: st[id] || 'todo' }])) });
    const a = migrateState(legacy('yt-politics', { research: 'done', download: 'done', script: 'done', plan: 'done', rough: 'done', finish: 'done' }));
    assert.deepEqual(STEP_DEFS.map(d => a.steps[d.id]?.status), ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'todo', 'todo']);
    assert.equal(a.look, 'yt-politics'); assert.equal(a.legacyBurn, true); assert.ok(!a.steps.finish);
    const b = migrateState(legacy('yt-christian', { research: 'done', download: 'todo' })); assert.equal(b.steps.clip.status, 'todo'); assert.equal(b.steps.subs.status, 'todo'); assert.equal(b.steps.fx.status, 'todo'); assert.ok(!b.legacyBurn);
    const c = legacy('', { research: 'done', download: 'done', finish: 'failed' }); c.steps.finish.error = '실패 사유';
    const cm = migrateState(c); assert.equal(cm.steps.fx.status, 'failed'); assert.equal(cm.steps.fx.error, '실패 사유'); assert.equal(cm.steps.subs.status, 'todo'); assert.equal(cm.look, 'yt-wrestling');
    assert.equal(migrateState(structuredClone(a)).legacyBurn, true);   // 두 번 해도 같음
    const fresh = { channel: 'yt-politics', look: '', steps: Object.fromEntries(STEP_DEFS.map(d => [d.id, { status: 'todo' }])) };
    assert.equal(migrateState(fresh).look, '');   // 새 에피소드는 룩을 직접 고를 때까지 비워 둠
    // 실제로 폴더에 놓인 예전 state.json 도 재시작 때 옮겨져요 (아래 '재시작 복구' 에서 확인)
    const dir = path.join(tmp, 'data', 'legacy-ep'); fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...legacy('yt-christian', { research: 'done', download: 'done', script: 'done', plan: 'done', rough: 'done', finish: 'done' }), ep: 'legacy-ep', title: '예전 영상', created: 1, gate: false, mix: {}, voices: {} }));
  });
  await check('예전 에피소드: 대본 자막이 이미 들어 있으면 음악 단계가 자막을 또 입히지 않음', async () => {
    const dir = path.join(tmp, 'data', 'legacy-ep');
    await run(FFMPEG, ['-hide_banner', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=1080x1920:r=30:d=3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest', '-c:a', 'aac', '-t', '3', (fs.mkdirSync(path.join(dir, '편집'), { recursive: true }), path.join(dir, '편집/완성본.mp4'))]).catch(async () => {
      await run(FFMPEG, ['-hide_banner', '-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=1080x1920:r=30:d=3', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', path.join(dir, '편집/완성본.mp4')]);
    });
    fs.writeFileSync(path.join(dir, '편집/편집계획.json'), JSON.stringify({ title: 'x', width: 1080, height: 1920, total: 3, clips: [], lines: [{ i: 0, text: '예전 줄', start: 0, end: 3, clip: 0 }] }));
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8')) }));
  });
  // ---------- Codex 그림 ----------
  const gen1 = b => J('/img/generate', { account: 'insta-sing', projectId: 'p1', styleId: 'otter-c', lang: 'ko', ...b });
  const jobsOf = async pid => (await J('/img/jobs?projectId=' + pid)).d.jobs;
  async function waitJobs(pid, n, timeout = 20000) { const t0 = Date.now(); for (;;) { const js = await jobsOf(pid); if (js.length >= n && js.every(j => j.status === 'done' || j.status === 'failed')) return js; if (Date.now() - t0 > timeout) throw new Error('그림 작업 시간 초과 ' + JSON.stringify(js)); await new Promise(r => setTimeout(r, 150)); } }
  const logLines = () => fs.readFileSync(fakeLog, 'utf8').trim().split('\n').map(l => JSON.parse(l));

  await check('그림체 목록: 폴더·낱장·시안 스캔 + 설명 덮어쓰기', async () => {
    fs.writeFileSync(path.join(tmp, 'styles.json'), JSON.stringify({ 'otter-c': { name: '수달 C', desc: 'otter desc' } }));
    const { d } = await J('/img/styles'); const ids = d.styles.map(s => s.id);
    for (const id of ['otter-a', 'otter-c', 'set-set-demo', 'preview-a-cute']) assert.ok(ids.includes(id), id + ' 없음: ' + ids);
    const c = d.styles.find(s => s.id === 'otter-c'); assert.equal(c.name, '수달 C'); assert.equal(c.desc, 'otter desc'); assert.equal(c.refs.length, 1);
    assert.equal(d.styles.find(s => s.id === 'set-set-demo').refs.length, 2);
  });
  await check('그림체 저장(POST): 새 스타일 추가 + 밖의 파일은 거절', async () => {
    const ref = path.join(art, 'instagram-toon/set-demo/01.png');
    const ok1 = await J('/img/styles', { name: '내 그림체', desc: 'mine', refs: [ref] }); assert.equal(ok1.r.status, 200); assert.equal(ok1.d.style.id, 'my-내-그림체');
    assert.ok((await J('/img/styles')).d.styles.some(s => s.id === 'my-내-그림체'));
    const bad = await J('/img/styles', { name: 'x', refs: ['/etc/hosts'] }); assert.equal(bad.r.status, 400);
  });
  await check('/file: 허용 폴더만 읽기, 밖은 403', async () => {
    const f = path.join(art, 'otter-couple-assets/C.png');
    const r = await fetch(`${B}/file?path=${encodeURIComponent(f)}`); assert.equal(r.status, 200); assert.equal(r.headers.get('content-type'), 'image/png');
    const t = await fetch(`${B}/file?path=${encodeURIComponent(f)}&thumb=1`); assert.equal(t.status, 200);
    assert.equal((await fetch(`${B}/file?path=${encodeURIComponent('/etc/hosts')}`)).status, 403);
    assert.equal((await fetch(`${B}/file?path=${encodeURIComponent(art + '/instagram-toon/../../../etc/hosts')}`)).status, 403);
    assert.equal((await fetch(`${B}/file?path=${encodeURIComponent(path.join(art, 'nope.png'))}`)).status, 404);
    fs.writeFileSync(path.join(tmp, 'secret.txt'), 'x'); fs.symlinkSync(path.join(tmp, 'secret.txt'), path.join(art, 'instagram-toon/link.png'));
    assert.equal((await fetch(`${B}/file?path=${encodeURIComponent(path.join(art, 'instagram-toon/link.png'))}`)).status, 403);
  });
  await check('그림 작업: 입력 검사', async () => {
    assert.equal((await gen1({ prompt: '' })).r.status, 400); assert.equal((await gen1({ prompt: 'a', styleId: 'nope' })).r.status, 400);
    assert.equal((await J('/img/generate', { prompt: 'a', styleId: 'otter-c' })).r.status, 400);
  });
  await check('그림 작업: 대기열은 하나씩, 결과를 폴더에 복사, 옛 버전 유지', async () => {
    fs.writeFileSync(fakeLog, '');
    const a = await gen1({ cardIndex: 0, prompt: 'scene one', text: ['안녕', '반가워'] }), b = await gen1({ cardIndex: 1, prompt: 'scene two FAKE_TOUCH' }), c = await gen1({ cardIndex: 0, prompt: 'scene one again' });
    assert.equal(a.r.status, 200); assert.ok(['queued', 'running'].includes(a.d.job.status));
    const js = await waitJobs('p1', 3); assert.deepEqual(js.map(j => j.status), ['done', 'done', 'done']);
    for (const j of js) { assert.ok(fs.existsSync(j.file)); assert.ok(j.file.includes(path.join('instagram-toon', 'fieldnote', 'insta-sing', 'p1'))); }
    assert.match(path.basename(js[0].file), /^01-\d+\.png$/); assert.match(path.basename(js[1].file), /^02-\d+\.png$/);
    assert.notEqual(js[0].file, js[2].file); assert.ok(fs.existsSync(js[0].file) && fs.existsSync(js[2].file), '옛 버전이 남아야 해요');
    const L = logLines(), starts = L.filter(x => x.t0), ends = L.filter(x => x.t1);
    assert.equal(starts.length, 3); for (let i = 1; i < 3; i++) assert.ok(starts[i].t0 >= ends[i - 1].t1, '두 번째 작업이 첫 작업 끝나기 전에 시작됨');
    const args = starts[0].args; assert.equal(args[0], 'exec'); assert.ok(args.includes('--skip-git-repo-check')); assert.equal(args[args.indexOf('-s') + 1], 'workspace-write');
    assert.ok(args.includes('-C')); assert.ok(args.includes(path.join(art, 'otter-couple-assets/C.png')) && args[args.indexOf('-i') - 0] === '-i');
    assert.match(args[1], /ONCE/); assert.match(args[1], /scene one/); assert.match(args[1], /"안녕"/); assert.match(args[1], /Korean/); assert.match(args[1], /otter desc/);
    assert.equal(starts[0].args.filter(x => x === '-i').length, 1);
    assert.equal(((await J('/img/jobs')).d.jobs).length >= 3, true);
  });
  await check('그림 작업: 그림체 refs 여러 장이면 -i 여러 개', async () => {
    fs.writeFileSync(fakeLog, ''); await J('/img/generate', { account: 'insta-krsg', projectId: 'p2', cardIndex: 4, styleId: 'set-set-demo', prompt: 'x', lang: 'en', text: ['Hello'] });
    const js = await waitJobs('p2', 1); assert.equal(js[0].status, 'done'); assert.match(path.basename(js[0].file), /^05-/);
    const a = logLines().find(x => x.t0).args; assert.equal(a.filter(x => x === '-i').length, 2); assert.match(a[1], /English/);
  });
  await check('그림 작업: 오류 번역 (로그인·일반 실패·그림 없음)', async () => {
    await gen1({ projectId: 'p3', prompt: 'FAKE_LOGIN' }); await gen1({ projectId: 'p3', prompt: 'FAKE_FAIL', cardIndex: 1 }); await gen1({ projectId: 'p3', prompt: 'FAKE_NOIMG', cardIndex: 2 });
    const js = await waitJobs('p3', 3); assert.deepEqual(js.map(j => j.status), ['failed', 'failed', 'failed']);
    assert.match(js[0].error, /ChatGPT 로그인이 필요해요 — ChatGPT 앱에서 Codex를 한 번 열어 주세요/);
    assert.match(js[1].error, /^Codex가 그림을 못 만들었어요: .*boom/); assert.match(js[2].error, /^Codex가 그림을 못 만들었어요: 그림 파일이 생기지 않았어요/);
    assert.equal(js[0].file, '');
  });
  await check('그림 작업: 시간 초과 시 멈추고, 다음 작업은 이어서', async () => {
    await gen1({ projectId: 'p4', prompt: 'FAKE_SLOW' }); await gen1({ projectId: 'p4', prompt: 'after', cardIndex: 1 });
    const t0 = Date.now(), js = await waitJobs('p4', 2, 15000);
    assert.equal(js[0].status, 'failed'); assert.match(js[0].error, /안에 못 끝내서 멈췄어요/); assert.ok(Date.now() - t0 < 12000); assert.equal(js[1].status, 'done');
  });
  await check('그림 작업: 취소 (대기 중 / 실행 중)', async () => {
    const a = await gen1({ projectId: 'p5', prompt: 'FAKE_SLOW' }), b = await gen1({ projectId: 'p5', prompt: 'queued one', cardIndex: 1 });
    await new Promise(r => setTimeout(r, 500));
    assert.equal((await J('/img/cancel', { id: b.d.job.id })).d.job.status, 'failed'); assert.equal((await J('/img/cancel', { id: a.d.job.id })).r.status, 200);
    const js = await waitJobs('p5', 2, 8000); assert.ok(js.every(j => j.status === 'failed')); assert.match(js[1].error, /취소/);
    assert.equal((await J('/img/cancel', { id: 'zzz' })).r.status, 404);
  });
  await check('에피소드 만들기: channel·voice 저장 (거르기·기본값)', async () => {
    const mk = async b => { const { r, d } = await J('/episodes', { title: '채널 테스트', url: src, ranges: '0:01-0:05', ...b }); assert.equal(r.status, 200); return d.ep; };
    const a = await mk({ channel: 'YT-Christian<1>', voice: 'v'.repeat(3000) }), b = await mk({}), c = await mk({ channel: 'a'.repeat(100) });
    const eps = (await J('/status')).d.episodes, f = id => eps.find(x => x.ep === id), st = id => JSON.parse(fs.readFileSync(path.join(tmp, 'data', id, 'state.json'), 'utf8'));
    assert.equal(f(a).channel, 'yt-christian'); assert.equal(f(b).channel, ''); assert.equal(f(c).channel.length, 40);
    assert.equal(st(a).voice.length, 2000); assert.equal(st(b).voice, '');
  });
  await check('/health: 버전(version)과 기능 수준(api = 4)', async () => {
    const { r, d } = await J('/health');
    assert.equal(r.status, 200); assert.equal(d.ok, true);
    assert.equal(d.api, 4);
    assert.equal(typeof d.version, 'string'); assert.ok(d.version.length > 0);
  });
  await check('재시작 복구: running → failed(한국어)', async () => {
    await stop();
    const sf = path.join(tmp, 'data', E, 'state.json'), s = JSON.parse(fs.readFileSync(sf, 'utf8')); s.steps.fx = { status: 'running' }; fs.writeFileSync(sf, JSON.stringify(s));
    await start(); const e = (await J('/status')).d.episodes.find(x => x.ep === E);
    assert.equal(step(e, 'fx').status, 'failed'); assert.match(step(e, 'fx').error, /다시 실행/); assert.ok(step(e, 'mix').outputs[0].exists);
    const lg = (await J('/status')).d.episodes.find(x => x.ep === 'legacy-ep'); assert.ok(lg, '예전 에피소드가 읽혀야 해요');
    assert.deepEqual(lg.steps.map(x => x.id), STEP_DEFS.map(d => d.id)); assert.equal(lg.look, 'yt-christian');
    assert.deepEqual(lg.steps.map(x => x.status), ['done', 'done', 'done', 'done', 'done', 'done', 'done', 'done', 'todo', 'todo']);
    assert.ok(step(lg, 'fx').outputs[0].exists);
    // 예전 방식 완성본에는 대본 자막이 이미 들어 있어서 음악 단계는 자막을 또 입히지 않아요
    await J('/run', { ep: 'legacy-ep', step: 'mix' });
    for (let i = 0; i < 100; i++) { const x = (await J('/status')).d.episodes.find(y => y.ep === 'legacy-ep'); if (!x.running) break; await new Promise(r => setTimeout(r, 200)); }
    const lg2 = (await J('/status')).d.episodes.find(x => x.ep === 'legacy-ep'); assert.equal(step(lg2, 'mix').status, 'done', step(lg2, 'mix').error);
    const mlog = fs.readFileSync(path.join(tmp, 'data', 'legacy-ep', '로그/mix.log'), 'utf8'); assert.ok(!/대본 자막/.test(mlog), mlog);
  });
  console.log(`\n전부 통과 (${ok}개)  · 산출물: ${tmp}`);
} catch (e) { console.error('\n테스트 실패:', e.message); process.exitCode = 1; }
finally { try { await stop(); } catch {} if (process.env.KEEP !== '1' && !process.exitCode) fs.rmSync(tmp, { recursive: true, force: true }); }
