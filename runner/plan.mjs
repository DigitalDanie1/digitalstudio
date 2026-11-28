// 인스타 기획: 중심단어 → 기획안 고르기 → 승인하면 1차 가안 (그림툰 컷 대본 · 영상(릴스) 대본)
// + 모든 플랫폼의 'AI 초안 만들기'(postDraft {title, body}) 와 그림툰 '겪은 일 → 컷 대본'(toonDraft) 도 여기로 (유료 API 대신 맥의 Claude Code)
// 부탁 글은 사이트(fieldnote-plan.js)가 만들어요. 실행기가 꺼져 있으면 같은 글을 Claude 채팅에 붙여 넣어 쓰니까, 둘이 같은 글을 쓰게 하려고요.
// 여기서는 맥의 Claude Code 로 그 글을 돌리고, 답(JSON)이 모양에 맞는지 확인해서 돌려줘요. 파일·검색 도구는 쓰지 않아요.
import fs from 'node:fs';
import path from 'node:path';
import { HOME, exists, run, lastLines, StepError } from './util.mjs';

const CLAUDE = process.env.FIELDNOTE_CLAUDE || [path.join(HOME, '.local/bin/claude'), path.join(HOME, '.claude/local/claude'), '/opt/homebrew/bin/claude', '/usr/local/bin/claude'].find(exists) || 'claude';
const NO_TOOLS = 'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task';
const arr = (x, k) => Array.isArray(x && x[k]) ? x[k] : null;

// 답 모양 검사: 문제가 있으면 한국어 한 줄, 괜찮으면 ''
export const PLAN_CHECK = {
  toonPlan: x => { const p = arr(x, 'plans'); if (!p || p.length < 2) return 'plans 를 3개 이상 주세요.'; return p.some(o => !String(o.title || '').trim() || !Array.isArray(o.beats) || o.beats.length < 3) ? '모든 기획안에 title 과 beats(3개 이상)가 있어야 해요.' : ''; },
  reelPlan: x => { const p = arr(x, 'plans'); if (!p || p.length < 2) return 'plans 를 3개 이상 주세요.'; return p.some(o => !String(o.hook || '').trim() || !String(o.situation || '').trim()) ? '모든 기획안에 hook 과 situation 이 있어야 해요.' : ''; },
  toonDraft: x => { const c = arr(x, 'cards'); if (!c || c.length < 4 || c.length > 16) return 'cards 는 4~16장이어야 해요.'; return c.some(k => !['top', 'scene', 'dialogue', 'bottom'].some(f => String(k[f] || '').trim())) ? '빈 카드가 있어요.' : ''; },
  postDraft: x => !String(x && x.title || '').trim() ? 'title 이 없어요.' : String(x.body || '').trim().length < 40 ? 'body(본문)가 비었거나 너무 짧아요.' : '',
  reelDraft: x => { const s = arr(x, 'shots'); if (!s || s.length < 1 || s.length > 6) return 'shots 는 1~6컷이어야 해요.'; if (!String(x.hook || '').trim()) return 'hook 이 없어요.'; return s.some(k => !String(k.see || '').trim() || !String(k.prompt || '').trim()) ? '모든 컷에 see 와 prompt 가 있어야 해요.' : ''; },
};

const TAGGED = { postDraft: true };

export async function planAsk(kind, prompt, ctx = {}) {
  const check = PLAN_CHECK[kind];
  if (!check) throw new StepError('모르는 기획 종류예요: ' + kind);
  const text = String(prompt || '').trim();
  if (text.length < 20 || text.length > 20000) throw new StepError('부탁 글 길이가 이상해요.');
  const dir = path.join(HOME, '.fieldnote', 'plan'); fs.mkdirSync(dir, { recursive: true });
  let p = text;
  for (let i = 0; i < 2; i++) {
    ctx.log?.(i ? '답을 고쳐 달라고 한 번 더 물어요…' : 'Claude 가 기획하는 중… (30초~2분)');
    let out;
    try { ({ out } = await run(CLAUDE, ['-p', p, '--output-format', 'json', '--disallowedTools', NO_TOOLS], ctx, { cwd: dir })); }
    catch (e) {
      const all = String(e.out || '') + String(e.err || '');
      const lim = /hit your limit[^"]*/i.exec(all);
      if (lim) throw new StepError('Claude 구독 사용 한도에 걸렸어요 (' + lim[0] + '). 풀린 뒤 다시 눌러 주세요.');
      if (/authentication_error|Failed to authenticate|Re-authenticate/i.test(all)) throw new StepError('맥의 Claude Code 로그인이 만료됐어요. 맥 터미널에서 claude 를 실행해 /login 으로 다시 로그인해 주세요.');
      if (e instanceof StepError) throw e.message.includes('ENOENT') ? new StepError('Claude Code(claude)를 못 찾았어요. 맥에 Claude Code 를 설치하고 로그인해 주세요.') : e;
      throw new StepError('Claude Code 실행 실패: ' + (lastLines(e.err) || lastLines(e.out) || e.message));
    }
    let res = out;
    try { res = JSON.parse(out).result ?? out; } catch {}
    res = String(res);
    let j = null, err = '';
    const tag = TAGGED[kind] && /<title>([\s\S]*?)<\/title>[\s\S]*?<body>([\s\S]*?)(?:<\/body>|$)/i.exec(res);   // 긴 본문은 JSON 따옴표가 깨지기 쉬워서 태그로 받아요
    if (tag) j = { title: tag[1].trim(), body: tag[2].trim() };
    else {
      const s = res.indexOf('{'), e = res.lastIndexOf('}');
      if (s < 0 || e < s) err = TAGGED[kind] ? '<title>…</title> <body>…</body> 모양이 없어요.' : 'JSON 이 없어요.'; else { try { j = JSON.parse(res.slice(s, e + 1)); } catch (x) { err = 'JSON 모양이 깨졌어요: ' + x.message; } }
    }
    if (!err) err = check(j);
    if (!err) return j;
    ctx.log?.('답에 문제: ' + err);
    p = text + `\n\n방금 네 답의 문제: ${err}\n고쳐서 ${TAGGED[kind] ? '<title> 과 <body> 태그로만' : 'JSON 하나만'} 다시 답해라.`;
  }
  throw new StepError('Claude 답을 쓸 수 없었어요. 한 번 더 눌러 주세요.');
}
