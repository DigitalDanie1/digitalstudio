import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { buildPostText } from './text.mjs';
import { BadInput, MODEL, hasKey, runGenerate } from './generate.mjs';
import { reachRoute } from './reach.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.FIELDNOTE_BRIDGE_TOKEN || '';
const profileDir = path.join(here, '.naver-profile');
let context;
let lastJob = null;

// Who may talk to the bridge: file:// pages (Origin absent or "null"), any http://localhost:* / http://127.0.0.1:* page,
// and the exact origins listed in FIELDNOTE_ALLOWED_ORIGIN (comma-separated, e.g. https://my-studio.vercel.app).
const EXTRA_ORIGINS = new Set(String(process.env.FIELDNOTE_ALLOWED_ORIGIN || '').split(',').map((o) => o.trim().replace(/\/+$/, '')).filter(Boolean));
function originAllowed(origin) {
  if (origin === undefined || origin === '' || origin === 'null') return true;
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
  return EXTRA_ORIGINS.has(origin);
}

function reply(res, status, data) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Headers': 'Content-Type, X-Fieldnote-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin'
  };
  // Reflect the (already allow-listed) origin; never "*". No Origin header (curl, same-origin) needs no CORS header.
  if (res.fieldnoteOrigin !== undefined) headers['Access-Control-Allow-Origin'] = res.fieldnoteOrigin;
  // Chrome Private Network Access: lets an https page (the Vercel studio) reach this 127.0.0.1 bridge.
  if (res.fieldnotePreflight) headers['Access-Control-Allow-Private-Network'] = 'true';
  res.writeHead(status, headers);
  res.end(status === 204 ? undefined : JSON.stringify(data));
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw new BadInput('요청 본문이 1MB를 넘습니다.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

async function firstVisible(page, selectors) {
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if (await loc.isVisible().catch(() => false)) return loc;
  }
  return null;
}

async function openDraft(post) {
  if (!context) {
    context = await chromium.launchPersistentContext(profileDir, {
      headless: false,
      viewport: { width: 1320, height: 900 }
    });
  }
  const page = await context.newPage();
  await page.goto('https://blog.naver.com/PostWriteForm.naver', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1200);

  const title = await firstVisible(page, [
    'textarea[placeholder*="제목"]',
    'input[placeholder*="제목"]',
    '.se-title-text[contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]'
  ]);
  if (!title) {
    return { state: 'queued', message: '네이버 글쓰기 화면을 열었습니다. 로그인 후 제목·본문을 직접 붙여 넣으세요.', url: page.url() };
  }
  await title.click();
  await title.fill(post.title).catch(async () => page.keyboard.insertText(post.title));

  const editor = await firstVisible(page, [
    '.se-main-container [contenteditable="true"]',
    '.se-component-content [contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]'
  ]);
  if (!editor) {
    return { state: 'queued', message: '제목을 입력했습니다. 본문 편집기를 찾지 못했으니 직접 붙여 넣으세요.', url: page.url() };
  }
  await editor.click();
  await typeText(page, buildPostText(post));

  const category = String(post.naverCategory ?? '').trim().slice(0, 60);
  const finalNote = '최종 발행 버튼은 직접 눌러 주세요.';
  if (!category) {
    return { state: 'queued', message: `네이버 글쓰기 초안을 채웠습니다. 출처·카테고리·공개 설정을 검토하고 ${finalNote}`, url: page.url() };
  }
  const picked = await preselectCategory(page, category);
  if (picked) {
    return { state: 'queued', message: `네이버 글쓰기 초안을 채우고 카테고리 "${category}"를 미리 선택했습니다. 열려 있는 발행 설정을 확인한 뒤 ${finalNote}`, url: page.url() };
  }
  return { state: 'queued', message: `네이버 글쓰기 초안을 채웠습니다. 카테고리 "${category}"는 자동으로 선택하지 못했으니 발행 설정에서 직접 선택하세요. ${finalNote}`, url: page.url() };
}

// SmartEditor turns each Enter into a new paragraph, so type line by line.
async function typeText(page, text) {
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await page.keyboard.insertText(lines[i]);
    if (i < lines.length - 1) await page.keyboard.press('Enter');
  }
}

// Best effort: open SmartEditor's publish-settings layer with the top-right "발행" button
// (this only OPENS the layer), pick the category, then STOP.
// SAFETY: this function must never click the confirm/발행 button inside the layer.
async function preselectCategory(page, name) {
  try {
    const opener = page.getByRole('button', { name: '발행', exact: true }).first();
    await opener.click({ timeout: 3000 }); // the only click on a "발행" button; the layer's confirm button is never touched
    await page.waitForTimeout(600);

    const dropdown = await firstVisible(page, [
      '[class*="option_category"] button',
      '[class*="category"] button[aria-haspopup]',
      '[class*="category"] [class*="selectbox_btn"]',
      '[class*="selectbox_btn"]',
      'button[aria-haspopup="listbox"]'
    ]);
    if (!dropdown) return false;
    const before = ((await dropdown.innerText({ timeout: 1500 })) || '').trim();
    if (before === name) return true;
    await dropdown.click({ timeout: 2500 });
    await page.waitForTimeout(300);

    // Only list-like option elements are eligible, never buttons, so the confirm button cannot match.
    const exact = new RegExp(`^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`);
    const option = page.locator('[role="option"], li, label').filter({ hasText: exact }).filter({ visible: true }).first();
    if (!(await option.count())) return false;
    await option.click({ timeout: 2500 });
    await page.waitForTimeout(300);

    const after = ((await dropdown.innerText({ timeout: 1500 })) || '').trim();
    return after.includes(name);
  } catch {
    return false;
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!originAllowed(origin)) return reply(res, 403, { ok: false, message: '허용되지 않은 출처입니다. FIELDNOTE_ALLOWED_ORIGIN에 이 사이트 주소를 추가하세요.' });
  if (origin !== undefined) res.fieldnoteOrigin = origin;
  if (req.method === 'OPTIONS') { res.fieldnotePreflight = true; return reply(res, 204, {}); }
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: true, service: 'fieldnote-naver-bridge', generate: hasKey, model: MODEL, lastJob });
  if (req.method === 'GET' && req.url.startsWith('/reach/')) { // Reach 리서치 (read-only): same origin + token rules as the routes below
    if (TOKEN && req.headers['x-fieldnote-token'] !== TOKEN) return reply(res, 401, { ok: false, message: '브리지 토큰이 일치하지 않습니다.' });
    const r = await reachRoute(new URL(req.url, 'http://127.0.0.1').pathname, new URL(req.url, 'http://127.0.0.1').searchParams);
    return r ? reply(res, r.status, r.body) : reply(res, 404, { ok: false, message: '지원하지 않는 경로입니다.' });
  }
  const generating = req.method === 'POST' && (req.url === '/generate/topics' || req.url === '/generate/draft');
  if (req.method !== 'POST' || (req.url !== '/publish/naver' && !generating)) return reply(res, 404, { ok: false, message: '지원하지 않는 경로입니다.' });
  if (TOKEN && req.headers['x-fieldnote-token'] !== TOKEN) return reply(res, 401, { ok: false, message: '브리지 토큰이 일치하지 않습니다.' });
  if (generating) {
    try {
      const job = await body(req);
      const { status, body: out } = await runGenerate(req.url === '/generate/topics' ? 'topics' : 'draft', job);
      return reply(res, status, out);
    } catch (error) {
      if (error instanceof SyntaxError) return reply(res, 400, { ok: false, message: '요청 본문이 올바른 JSON이 아닙니다.' });
      if (error instanceof BadInput) return reply(res, 400, { ok: false, message: error.message });
      return reply(res, 500, { ok: false, message: error?.message || '생성 중 알 수 없는 오류가 발생했습니다.' });
    }
  }
  try {
    const job = await body(req);
    if (job?.action !== 'publish' || job?.channel !== 'blog') throw Error('네이버 블로그 발행 요청 형식이 아닙니다.');
    if (!job?.post?.title?.trim() || !job?.post?.body?.trim()) throw Error('제목과 본문이 필요합니다.');
    if (job.post.naverCategory != null && typeof job.post.naverCategory !== 'string') throw Error('naverCategory는 문자열이어야 합니다.');
    lastJob = { id: job.post.id, title: job.post.title, at: Date.now(), state: 'opening' };
    const result = await openDraft(job.post);
    lastJob = { ...lastJob, state: result.state, url: result.url };
    return reply(res, 200, { ok: true, ...result });
  } catch (error) {
    return reply(res, 400, { ok: false, message: error.message || '브리지 처리 실패' });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`FIELDNOTE NAVER bridge: http://127.0.0.1:${PORT}`);
  console.log('첫 요청 시 열린 네이버 창에서 직접 로그인하세요. 등록 버튼은 자동으로 누르지 않습니다.');
  if (hasKey) console.log(`AI 생성: 사용 가능 (모델 ${MODEL}) — 생성할 때마다 유료 API 호출이 발생합니다.`);
  else console.warn('경고: ANTHROPIC_API_KEY가 없어 AI 생성은 비활성입니다 (발행 기능은 정상). `ANTHROPIC_API_KEY=... npm start`로 실행하세요.');
});
