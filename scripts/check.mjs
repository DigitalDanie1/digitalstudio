// 배포 전 자동 검사: node scripts/check.mjs
// Vercel 이 배포할 때마다 먼저 돌려요 (package.json 의 vercel-build). 하나라도 걸리면 배포가 멈추고, 사이트는 예전 버전 그대로예요.
// 1) 모든 js·mjs 문법  2) 사이트가 불러오는 파일이 vercel.json 경로에 다 있는지  3) 실행기 파일 목록(설치·업데이트·사이트 업데이트)에 빠진 게 없는지  4) 실행기가 실제로 켜지는지
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
function finish() { if (bad.length) { console.log(`\n검사 실패 ${bad.length}개. 고친 뒤 다시 올려 주세요.`); process.exit(1); } console.log('\n모든 검사 통과'); process.exit(0); }
const bad = [], ok = msg => console.log('  ok  ' + msg), fail = msg => { bad.push(msg); console.log('  XX  ' + msg); };
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const list = (d, re) => !fs.existsSync(path.join(ROOT, d)) ? [] : fs.readdirSync(path.join(ROOT, d), { withFileTypes: true }).flatMap(e => e.isDirectory() ? list(path.join(d, e.name), re) : re.test(e.name) ? [path.join(d, e.name)] : []);

console.log('1) 문법');
const code = [...list('outputs', /\.js$/), ...list('runner', /\.mjs$/), ...list('api', /\.js$/), ...list('lib', /\.mjs$/), 'middleware.js', 'scripts/check.mjs'].filter(f => fs.existsSync(path.join(ROOT, f)));
for (const f of code) { const r = spawnSync(process.execPath, ['--check', path.join(ROOT, f)], { encoding: 'utf8' }); r.status === 0 ? null : fail(`${f}: ${(r.stderr || '').trim().split('\n').slice(0, 4).join(' / ')}`); }
for (const f of list('runner', /\.command$/)) { const r = spawnSync('bash', ['-n', path.join(ROOT, f)], { encoding: 'utf8' }); if (r.status !== 0) fail(`${f}: ${(r.stderr || '').trim()}`); }
// html 안의 <script> 도 검사 (따옴표 하나로 사이트 전체가 멈출 수 있어요)
for (const f of list('outputs', /\.html$/).concat(['login.html'].filter(f => fs.existsSync(path.join(ROOT, f))))) {
  [...read(f).matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="(?:application\/json|text\/template)")[^>]*>([\s\S]*?)<\/script>/g)].forEach((m, i) => {
    const t = path.join(os.tmpdir(), `fieldnote-inline-${process.pid}-${i}.js`); fs.writeFileSync(t, m[1]);
    const r = spawnSync(process.execPath, ['--check', t], { encoding: 'utf8' }); fs.rmSync(t, { force: true });
    if (r.status !== 0) fail(`${f} 의 ${i + 1}번째 <script>: ${(r.stderr || '').trim().split('\n').filter(l => /SyntaxError|^\s*\^/.test(l) || l.includes(':')).slice(0, 3).join(' / ')}`);
  });
}
ok(`${code.length}개 파일`);

console.log('2) 사이트가 불러오는 파일');
const vj = JSON.parse(read('vercel.json')), srcs = new Set((vj.rewrites || []).map(r => r.source));
const html = read('outputs/fieldnote-studio.html');
const refs = [...html.matchAll(/<(?:script|link)[^>]+(?:src|href)="\.\/([^"?#]+)/g)].map(m => m[1]);
for (const f of refs) {
  if (!srcs.has('/' + f)) fail(`fieldnote-studio.html 이 ./${f} 를 불러오는데 vercel.json rewrites 에 "/${f}" 가 없어요 (사이트에서 404)`);
  else { const r = vj.rewrites.find(x => x.source === '/' + f); if (!fs.existsSync(path.join(ROOT, r.destination))) fail(`vercel.json 의 ${r.destination} 파일이 없어요`); }
}
ok(`${refs.length}개 파일`);

// Vercel 배포에는 실행기(runner/) 가 안 올라가요 (.vercelignore). 거기서는 1·2 만 검사해요.
const HAS_RUNNER = fs.existsSync(path.join(ROOT, 'runner/설치·업데이트.command')) && fs.existsSync(path.join(ROOT, 'runner/server.mjs'));
if (!HAS_RUNNER) { console.log('3·4) 실행기 파일이 없는 곳이라 건너뛰어요 (Vercel 배포)'); finish(); }
console.log('3) 실행기 파일 목록');
const runnerFiles = fs.readdirSync(path.join(ROOT, 'runner')).filter(f => /\.(mjs|command)$/.test(f) && f !== 'test.mjs' && f !== '설치·업데이트.command');
const inst = /^FILES=\((.*)\)$/m.exec(read('runner/설치·업데이트.command'));
const instFiles = inst ? [...inst[1].matchAll(/"([^"]+)"|(\S+)/g)].map(m => m[1] || m[2]) : [];
const upd = /const FILES = \[([^\]]+)\]/.exec(read('runner/server.mjs'));
const updFiles = upd ? [...upd[1].matchAll(/'([^']+)'/g)].map(m => m[1]) : [];
if (!inst) fail('설치·업데이트.command 에서 FILES 목록을 못 찾았어요');
if (!upd) fail('server.mjs 에서 /update 의 FILES 목록을 못 찾았어요');
for (const f of runnerFiles) {
  if (!instFiles.includes(f)) fail(`runner/${f} 가 설치·업데이트.command 의 FILES 에 없어요 (새 맥에 안 깔려요)`);
  if (!updFiles.includes(f)) fail(`runner/${f} 가 server.mjs /update 의 FILES 에 없어요 (사이트 업데이트로 안 들어가요)`);
}
for (const f of [...instFiles, ...updFiles]) if (!fs.existsSync(path.join(ROOT, 'runner', f))) fail(`실행기 목록의 runner/${f} 파일이 없어요`);
ok(`${runnerFiles.length}개 파일`);

console.log('4) 실행기 켜기');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fieldnote-check-')), port = 4700 + Math.floor(Math.random() * 60);
const want = Number((/const API_LEVEL = (\d+)/.exec(read('runner/server.mjs')) || [])[1]);
const child = spawn(process.execPath, [path.join(ROOT, 'runner/server.mjs')], { env: { ...process.env, HOME: tmp, FIELDNOTE_RUNNER_PORT: String(port), FIELDNOTE_RUNNER_DATA: path.join(tmp, 'data'), FIELDNOTE_RUNNER_HOME: path.join(tmp, 'home') }, stdio: ['ignore', 'pipe', 'pipe'] });
let err = ''; child.stderr.on('data', d => { err += d; }); child.stdout.on('data', () => {});
let h = null;
for (let i = 0; i < 40 && !h && child.exitCode === null; i++) { await new Promise(r => setTimeout(r, 250)); try { h = await (await fetch(`http://127.0.0.1:${port}/health`)).json(); } catch {} }
child.kill(); fs.rmSync(tmp, { recursive: true, force: true });
if (!h) fail('실행기가 켜지지 않아요: ' + (err.trim().split('\n').slice(-4).join(' / ') || '응답 없음'));
else if (h.api !== want) fail(`실행기 /health 의 api 가 ${h.api} 인데 API_LEVEL 은 ${want} 예요`);
else ok(`api ${h.api}`);

finish();
