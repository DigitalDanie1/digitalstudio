import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 8787);
const TOKEN = process.env.FIELDNOTE_BRIDGE_TOKEN || '';
const profileDir = path.join(here, '.naver-profile');
let context;
let lastJob = null;

function reply(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': process.env.FIELDNOTE_ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type, X-Fieldnote-Token',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
  });
  res.end(JSON.stringify(data));
}

async function body(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1_000_000) throw Error('요청 본문이 1MB를 넘습니다.');
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
  await page.keyboard.insertText(post.body);
  return { state: 'queued', message: '네이버 글쓰기 초안을 채웠습니다. 출처·카테고리·공개 설정을 검토하고 등록 버튼은 직접 누르세요.', url: page.url() };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return reply(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') return reply(res, 200, { ok: true, service: 'fieldnote-naver-bridge', lastJob });
  if (req.method !== 'POST' || req.url !== '/publish/naver') return reply(res, 404, { ok: false, message: '지원하지 않는 경로입니다.' });
  if (TOKEN && req.headers['x-fieldnote-token'] !== TOKEN) return reply(res, 401, { ok: false, message: '브리지 토큰이 일치하지 않습니다.' });
  try {
    const job = await body(req);
    if (job?.action !== 'publish' || job?.channel !== 'blog') throw Error('네이버 블로그 발행 요청 형식이 아닙니다.');
    if (!job?.post?.title?.trim() || !job?.post?.body?.trim()) throw Error('제목과 본문이 필요합니다.');
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
});
