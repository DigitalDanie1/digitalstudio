// ===== YouTube 작업판: ⚡ 자동 실행 (맥 실행기 http://127.0.0.1:4777 와 연결) =====
// 실행기는 ~/Desktop/유투브/실행기/실행기 켜기.command 로 켠다. 작업판은 버튼만 누르고, 실제 작업은 맥에서 돈다.
const RUNNER = 'http://127.0.0.1:4777';
const RUNNER_API_NEEDED = 4;  // 4 = 7칸 순서(1차 편집·자막 넣기·2차 편집)  // 실행기 /health 의 api 가 이 숫자보다 작으면 예전 버전 안내
const RUNNER_OLD_MSG = '<div class="ya-off pl-error" role="alert"><b>이 맥의 실행기가 예전 버전이에요.</b> 저장소를 <code>git pull</code> 한 뒤 <code>runner/설치·업데이트.command</code> 를 더블클릭하세요.</div>';
let runnerApi = null;  // 실행기 /health 의 api (모르면 null). 5 = 최종 결과물 레퍼런스(/fxpack)
let runnerStale = null;  // 맥에 새 실행기 파일이 있는데 아직 예전 버전으로 켜져 있음 (health.version != health.disk)
let runnerData = null, runnerOnline = null, runnerOld = false, runnerBusy = false, runnerTimer = null, runnerOpenLog = null, runnerSelectedStep = null;
// 주제 = 에피소드: 작업판에서 고른 주제(idea)에 연결된 에피소드만 보여 준다
function runnerIdea() { return typeof ytPipeIdea === 'function' ? ytPipeIdea() : null; }
function runnerEp() {
  const idea = runnerIdea(); if (!idea) return null;
  return (runnerData?.episodes || []).find(e => e.ideaId === idea.id) || null;
}
// 실행기에만 있는 에피소드(주제 없이 만든 것)는 주제로 올려 연결한다
let runnerSyncing = false;
async function runnerSyncIdeas() {
  if (runnerSyncing || !runnerData || typeof db !== 'object') return;
  const epCh = e => (typeof ytValidCh === 'function' && ytValidCh(e.channel)) || '';
  const epTopic = ch => { let t = ''; try { t = (typeof ytTabDefs === 'function' && (ytTabDefs(ch)[0] || {}).id) || ''; } catch (_) {} return t || (ch === 'yt-wrestling' ? 'yt-wrestling-athletes' : ''); };
  // 예전에 레슬링으로 잘못 올라간 연결 주제는 실행기의 채널로 한 번 바로잡는다
  let fixed = false;
  for (const e of runnerData.episodes) {
    const ch = epCh(e); if (!ch || !e.ideaId) continue;
    const idea = db.ideas.find(i => i.id === e.ideaId);
    if (idea && ch !== 'yt-wrestling' && (idea.ytChannel === 'yt-wrestling' || idea.topicId === 'yt-wrestling-athletes')) { idea.ytChannel = ch; idea.topicId = epTopic(ch); fixed = true; }
  }
  const lost = runnerData.episodes.filter(e => !e.ideaId || !db.ideas.some(i => i.id === e.ideaId));
  if (!lost.length) { if (fixed) { persist(); render(); } return; }
  runnerSyncing = true;
  try {
    for (const e of lost) {
      const id = e.ideaId && !db.ideas.some(i => i.id === e.ideaId) ? e.ideaId : 'ep-' + e.ep;
      const ch = epCh(e) || 'yt-wrestling';
      if (!db.ideas.some(i => i.id === id)) db.ideas.unshift({ id, title: e.title, note: e.note || '', sources: e.sources.map(s => s.url).join('\n'),
        preferredChannel: 'youtube', ytChannel: ch, ytFormat: e.format === 'long' ? 'long' : 'shorts', ...(e.resub ? { ytResub: true } : {}), topicId: epTopic(ch), sample: false, created: Date.now() });
      if (e.ideaId !== id) { await runnerFetch('/link', { ep: e.ep, ideaId: id }); e.ideaId = id; }
    }
    persist(); render();
  } catch (_) {} finally { runnerSyncing = false; }
}
async function runnerFetch(p, body) {
  const r = await fetch(RUNNER + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(data.error || data || r.status);
  return data;
}
async function runnerRefresh() {
  // 켜져는 있는데 예전 버전인지 확인 (api 숫자가 없거나 RUNNER_API_NEEDED 보다 작으면 예전 버전)
  try { const h = await runnerFetch('/health'); runnerApi = Number.isInteger(h.api) ? h.api : 0; runnerOld = !(Number.isInteger(h.api) && h.api >= RUNNER_API_NEEDED); runnerStale = h.disk && h.version !== h.disk ? h : null; }
  catch (_) { runnerOld = false; runnerStale = null; }
  try { runnerData = await runnerFetch('/status'); runnerOnline = true; runnerSyncIdeas(); }
  catch (_) { runnerOnline = false; }
  const live = document.getElementById('ytAutoLive');
  if (live) runnerPaint(live);
  if (runnerOpenLog) runnerShowLog(runnerOpenLog, true);
  const busy = runnerData?.episodes?.some(e => e.running);
  clearTimeout(runnerTimer);
  if (document.getElementById('ytAuto')) runnerTimer = setTimeout(runnerRefresh, busy ? 2000 : 8000);
}

// ===== 대본 직접 붙여 넣기 (AI 키 없이): 요청문 복사 → Claude 채팅 → 받은 대사 붙여 넣기 =====
const PH_RE = /여기에 대사/;
const ytScrState = {};  // ep 이름별로 따로 들고 있어서, 다시 그려도 쓰던 글이 남는다
function ytScr(ep) { return ytScrState[ep] = ytScrState[ep] || { loaded: false, loading: false, failed: false, request: '', lines: [], hasPh: null, ai: false, text: null, busy: false }; }
function ytScriptShow(ep) {
  const sc = ep.steps.find(s => s.id === 'script'); if (!sc) return false;
  return sc.status === 'failed' || (ep.gate && !!sc.gate) || ep.steps.some(s => s.status === 'failed' && PH_RE.test(s.error || ''));
}
// 대본 칸이 아직 확인 중이면 계속 버튼을 잠깐 막는다 (빈 양식으로 계속 누르는 일을 막기 위해)
const ytScrWaiting = ep => { const st = ytScr(ep.ep); return !st.loaded && !st.failed; };
const ytScrBlocked = ep => ytScr(ep.ep).hasPh === true;
function runnerFriendly(msg) { return PH_RE.test(msg || '') ? '대본이 아직 비어 있어요. 대본 단계에서 받은 대사를 붙여 넣고 저장하세요.' : msg; }
async function ytScrLoad(ep) {
  const st = ytScr(ep); if (st.loading) return; st.loading = true;
  try {
    const d = await runnerFetch('/script?ep=' + encodeURIComponent(ep));
    Object.assign(st, { request: d.request || '', lines: d.lines || [], hasPh: !!d.hasPlaceholder, ai: !!d.ai, loaded: true, failed: false });
    if (st.text === null) st.text = st.lines.join('\n');
  } catch (_) { st.failed = true; st.loaded = true; }  // 예전 실행기면 이 길이 없음
  st.loading = false;
  if (typeof ytRepaint === 'function') ytRepaint();
}
const ytScrCount = t => String(t || '').split(/\r?\n/).map(l => l.trim()).filter(l => l && !/^[#>]/.test(l)).length;
function ytScriptPanel(ep, mainIsSave) {
  const st = ytScr(ep.ep);
  if (!st.loaded && !st.loading) setTimeout(() => ytScrLoad(ep.ep), 0);
  const text = st.text === null ? '' : st.text, n = ytScrCount(text);
  const hint = st.failed ? '<p class="pl-error" role="alert">실행기가 옛 버전이에요. 실행기를 껐다가 다시 켜면 여기서 대본을 붙여 넣을 수 있어요.</p>'
    : st.hasPh ? '<p class="small">대본에 "[여기에 대사]" 빈칸이 남아 있어요. 대사를 채워 주세요.</p>' : '';
  const copy = !st.ai && st.request ? `<p class="small">AI 키가 없어서 대본을 직접 받아요.</p><button type="button" class="pl-chip" data-ya-scr="copy">① 요청문 복사</button>` : '';
  const form = `<div class="pl-scr">${hint}${copy}
    <label class="pl-scr-l">② 받은 대사 붙여 넣기<textarea class="pl-input" rows="9" data-ya-scr-text placeholder="한 줄 = 자막 한 장면 (25자 안팎)" ${st.failed ? 'disabled' : ''}>${esc(text)}</textarea></label>
    <p class="small"><b id="yaScrN">${n}줄</b> · 최대 30줄</p>
    ${mainIsSave || st.failed ? '' : `<button type="button" class="pl-chip on" data-ya-act="scriptsave" ${st.busy ? 'disabled' : ''}>대본 저장하고 계속</button>`}</div>`;
  return st.hasPh === false && !st.failed ? `<details class="pl-peek"><summary>대본 고쳐서 저장하기</summary>${form}</details>` : form;
}
document.addEventListener('click', e => { if (e.target.closest('[data-ya-goscript]') && typeof ytGoScript === 'function') ytGoScript(); });
document.addEventListener('input', e => {
  const ta = e.target.closest && e.target.closest('textarea[data-ya-scr-text]'); if (!ta) return;
  const cur = runnerEp(); if (!cur) return;
  ytScr(cur.ep).text = ta.value;
  const n = document.getElementById('yaScrN'); if (n) n.textContent = ytScrCount(ta.value) + '줄';
});
document.addEventListener('click', async e => {
  const b = e.target.closest('button[data-ya-scr="copy"]'); if (!b) return;
  const cur = runnerEp(); if (!cur) return;
  try {
    const d = await runnerFetch('/script?ep=' + encodeURIComponent(cur.ep));
    if (!d.request) { toast('요청문이 없어요. 대본 단계를 다시 실행하세요.'); return; }
    if (await copyText(d.request)) toast('Claude 채팅에 붙여 넣으세요.'); else toast('복사가 안 됐어요. 대본-요청.txt 파일을 열어 복사하세요.');
  } catch (err) { toast('실행기: ' + runnerFriendly(err.message)); }
});
// ===== ⑤ 자막 넣기: 한국어 자막 쓰기(Claude 요청문 / AI 바로 반영 / 직접) · 원본 영어 자막 참고 · 고칠 점·구간·배경음악 =====
const ytFbState = {};
function ytFb(ep) { return ytFbState[ep] = ytFbState[ep] || { loaded: false, loading: false, ranges: '', text: '', ranges0: '', text0: '', fb: '', ans: '', ai: false, transcript: [], bgm: [], mix: {}, busy: false }; }
async function ytFbLoad(ep, force) {
  const st = ytFb(ep); if (st.loading || (st.loaded && !force)) return; st.loading = true;
  try {
    const d = await runnerFetch('/draft?ep=' + encodeURIComponent(ep));
    Object.assign(st, { ranges: d.ranges, ranges0: d.ranges, text: d.text, text0: d.text, ai: !!d.ai, transcript: Array.isArray(d.transcript) ? d.transcript : [], loaded: true });
    if (!st.fb) st.fb = d.feedback || '';
    try { const l = await runnerFetch('/lines?ep=' + encodeURIComponent(ep)); st.bgm = (l.assets && l.assets.bgm) || []; st.mix = l.mix || {}; } catch (_) {}
  } catch (_) { st.loaded = true; }
  st.loading = false;
  if (typeof ytRepaint === 'function') ytRepaint();
}
function ytSubsPanel(ep) {
  const st = ytFb(ep.ep);
  if (!st.loaded) { setTimeout(() => ytFbLoad(ep.ep), 0); return '<p class="small">불러오는 중…</p>'; }
  const ph = /여기에 대사|\[여기에/.test(st.text);
  const shown = ph ? st.text.split(/\r?\n/).filter(l => /^>\s*(배너|훅|출처)\s*[:：]/.test(l.trim()) && !/\[여기에/.test(l)).join('\n') : st.text;
  const nLines = shown.split(/\r?\n/).filter(l => l.trim() && !/^>/.test(l.trim())).length;
  const ai = st.ai ? `<div class="pl-chips"><button type="button" class="pl-chip on" data-ya-act="fbai" ${st.busy ? 'disabled' : ''}>AI로 자막 쓰기</button></div>`
    : `<div class="pl-chips"><button type="button" class="pl-chip" data-ya-act="fbcopy">① Claude 요청문 복사</button></div>
       <label class="pl-scr-l">② 받은 답 붙여 넣기 (통째로)<textarea class="pl-input" rows="5" data-ya-fbans placeholder="구간: 0:30-0:42, 1:05-1:09x0.5&#10;> 배너: 위 줄 / 아랫줄 ㄷㄷ&#10;자막 줄…">${esc(st.ans)}</textarea></label>
       <div class="pl-chips"><button type="button" class="pl-chip on" data-ya-act="fbans" ${st.busy ? 'disabled' : ''}>③ 답으로 자막 채우기</button></div>`;
  const opt = (list, v) => `<option value="">없음</option>` + list.map(f => `<option value="${esc(f)}" ${f === v ? 'selected' : ''}>${esc(f)}</option>`).join('');
  const tr = (st.transcript || []).filter(t => t && t.text);
  const trHtml = tr.length ? tr.map(t => `<p class="small"><b>${esc(t.range)}</b><br>${esc(t.text)}</p>`).join('') : '<p class="small">원본 영어 자막이 없어요.</p>';
  return `<div class="pl-scr">
    <label class="pl-scr-l"><span>자막 (한 줄 = 화면 한 장면, 25자 안팎) · <b id="yaSubCount">${nLines}줄</b></span><textarea class="pl-input" rows="10" data-ya-draft="text" placeholder="예:&#10;이 *기술* 보이지?&#10;상대가 균형을 잃는 순간이야&#10;자, 한 번 더 볼까">${esc(shown)}</textarea></label>
    <b class="small">자동으로 받기</b>
    ${ai}
    <p class="small">${st.ai ? '실행기에 AI 키가 있어서 바로 받을 수 있어요.' : '요청문에 원본 영어 자막과 구간이 다 들어가요.'}</p>
    <details class="pl-peek"><summary>원본 영어 자막 (참고)</summary>${trHtml}</details>
    <details class="pl-peek"><summary>더 고치기 (선택)</summary>
      <label class="pl-scr-l">고칠 점<textarea class="pl-input" rows="3" data-ya-fb placeholder="예: 첫 자막 더 세게 / 0:12~0:15 는 슬로우로 / 마지막에 점수 도장 넣어 줘">${esc(st.fb)}</textarea></label>
      <label class="pl-scr-l">쓸 구간 (슬로우: 0:30-0:34x0.5 · 영상 전체: 전체)<input class="pl-input" data-ya-draft="ranges" value="${esc(st.ranges)}"></label>
      <p class="small"><code>&gt; 배너: 위 줄 / 아랫줄 ㄷㄷ</code> 위 2줄 제목 · <code>&gt; 출처: 채널 이름</code> · <code>[태그] 선수 (나라) / 대회 · 체급</code> 빨간 이름표 · <code>[점수] 4 : 0 / 설명</code> 큰 도장 · <code>*단어*</code> 노란 강조. 태그·점수 줄은 바로 다음 자막 줄에 붙어요.</p>
      <div class="ya-mixset"><label>배경음악 <select data-ya-fbbgm>${opt(st.bgm, st.mix.bgm)}</select></label><span class="small">원본 경기 소리 위에 작게 깔려요. <code>~/Desktop/유투브/소리/BGM</code> 에 넣으면 목록에 떠요.</span></div>
      <p class="small"><button type="button" class="pl-link" data-ya-recopen>🎙 내 목소리도 녹음하기 (선택)</button></p>
      <div id="yaRec">${recState.open ? recPanel() : ''}</div>
    </details>
  </div>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('button[data-ya-allrange]'); if (!b) return;
  const i = document.querySelector('[data-ya-new="ranges"]'); if (i) i.value = '전체';
  if (typeof ytPipe === 'object') ytPipe.ranges = '전체';
  b.classList.add('on'); toast('영상 전체를 써요. "1차 편집 만들기"를 누르세요.');
});
document.addEventListener('input', e => {
  const t = e.target; if (!t.closest) return;
  const cur = runnerEp(); if (!cur) return; const st = ytFb(cur.ep);
  if (t.matches('textarea[data-ya-fb]')) st.fb = t.value;
  else if (t.matches('textarea[data-ya-fbans]')) st.ans = t.value;
  else if (t.matches('[data-ya-draft="ranges"]')) st.ranges = t.value;
  else if (t.matches('[data-ya-draft="text"]')) { st.text = t.value; const c = document.getElementById('yaSubCount'); if (c) c.textContent = t.value.split(/\r?\n/).filter(l => l.trim() && !/^>/.test(l.trim())).length + '줄'; }
});
document.addEventListener('change', async e => {
  const sel = e.target.closest && e.target.closest('select[data-ya-fbbgm]'); if (!sel) return;
  const cur = runnerEp(); if (!cur) return; const st = ytFb(cur.ep);
  try { await runnerFetch('/mixset', { ep: cur.ep, bgm: sel.value, sting: st.mix.sting || '' }); st.mix = { ...st.mix, bgm: sel.value }; toast(sel.value ? '배경음악을 정했어요. 다음 편집에 들어가요.' : '배경음악을 뺐어요.'); }
  catch (err) { toast('실행기: ' + err.message); }
});
const RUN_LABEL = { done: '완료', running: '진행 중', failed: '실패', todo: '대기' };
function runnerFileLink(ep, p, label) {
  return `<a class="btn ghost ya-file" href="${RUNNER}/file?ep=${encodeURIComponent(ep)}&path=${encodeURIComponent(p)}" target="_blank" rel="noopener noreferrer">${esc(label || p.split('/').pop())} ↗</a>`;
}
function ytAutoLive() { return (runnerOld && runnerOnline ? RUNNER_OLD_MSG : '') + ytAutoLiveBody(); }
function ytAutoLiveBody() {
  if (runnerOnline === null) return '<p class="small">실행기 확인 중…</p>';
  if (runnerOld && !runnerOnline) return RUNNER_OLD_MSG;
  if (!runnerOnline) return `<div class="ya-off"><b>실행기가 꺼져 있어요.</b> 맥에서 <code>~/Desktop/유투브/실행기/실행기 켜기.command</code> 를 더블클릭하면 켜져요. 켜진 창은 닫지 마세요. 켜져 있는데도 이 글이 보이면 예전 버전일 수 있어요: <code>git pull</code> 후 <code>runner/설치·업데이트.command</code> 를 더블클릭하세요.<br><span class="small">다른 컴퓨터·휴대폰에서는 버튼이 동작하지 않아요(실행기는 이 맥에서만 돕니다). 크롬이 "로컬 네트워크 접근"을 물으면 허용을 누르세요.</span></div>`;
  const cur = runnerEp(), idea = runnerIdea();
  if (!idea) return runnerFlow(1) + '<p class="small">위에서 작업할 주제를 고르세요. 주제가 없으면 AI 주제 발굴이나 소스 탭에서 먼저 등록하세요.</p>';
  if (!cur) return runnerFlow(1) + `<div class="yaw-start"><b>이 주제는 아직 제작 전이에요.</b>
      <p class="small">소스 영상 주소와 구간을 넣고 시작하면 ~/Desktop/유투브 에 이 주제의 폴더가 생기고 ② 제작이 열려요. (한 구간 3분까지, UWW·올림픽·RAF 공식 먼저)</p>
      <div class="ya-form"><input class="input" data-ya-new="url" placeholder="소스 유튜브 주소" value="${esc((typeof ytPipe === 'object' && ytPipe.url) || ytFirstUrl(idea))}">
      <input class="input" data-ya-new="ranges" placeholder="구간: 0:30-0:42, 1:05-1:12" value="${esc((typeof ytPipe === 'object' && ytPipe.ranges) || '')}">
      <button class="btn primary" data-ya-act="create">이 주제로 제작 시작</button></div></div>`;
  const pick = '';
  const doneN = cur.steps.filter(s => s.status === 'done').length;
  const percent = cur.steps.length ? Math.round(doneN / cur.steps.length * 100) : 0;
  const next = cur.steps.find(s => s.id === cur.running) || cur.steps.find(s => s.status !== 'done');
  const selected = cur.steps.find(s => s.id === runnerSelectedStep)
    || (cur.gate && cur.steps.find(s => s.gate)) || next || cur.steps.at(-1);
  const rows = cur.steps.map((s, i) => {
    const count = s.outputs.filter(o => o.exists).length;
    const status = cur.gate && s.gate ? '확인 대기' : RUN_LABEL[s.status];
    return `<li><button type="button" class="ya-stage-pick" data-ya-step="${esc(s.id)}" aria-pressed="${s === selected}">
      <span class="ya-stage-number" aria-hidden="true">${s.status === 'done' && status !== '확인 대기' ? '✓' : i + 1}</span>
      <span><strong>${esc(s.name)}</strong><small>${status} · 결과물 ${count}개</small></span>
    </button></li>`;
  }).join('');
  const files = selected?.outputs.filter(o => o.exists) || [];
  const reviewing = cur.gate && selected?.gate;
  const action = !selected ? '' : reviewing
    ? '<button class="btn primary" data-ya-act="continue">대본 확인 완료 · 계속</button>'
    : cur.running ? (cur.running === selected.id ? '<button class="btn danger" data-ya-act="stop">실행 멈춤</button>' : '')
    : selected.id === 'mix' ? '<button class="btn primary" data-ya-recopen>녹음·음악 열기</button>'
    : `<button class="btn ${selected.status === 'done' ? 'ghost' : 'primary'}" data-ya-run="${esc(selected.id)}">${selected.status === 'done' ? '다시 실행' : esc(selected.name) + ' 실행'}</button>`;
  const panel = selected ? `<section class="ya-stage-detail" aria-label="선택한 단계">
      <div class="small">${reviewing ? '확인 대기' : RUN_LABEL[selected.status]}</div>
      <h3>${esc(selected.name)}</h3>
      ${selected.error && selected.status === 'failed' ? `<p class="ya-err">${esc(selected.error)}</p>` : ''}
      <div class="actions">${action}${selected.id === 'mix' && !cur.running && !reviewing ? `<button class="btn ghost" data-ya-run="${esc(selected.id)}">믹스 실행</button>` : ''}<button class="btn ghost" data-ya-log="${esc(selected.id)}" aria-expanded="${runnerOpenLog === selected.id}">로그</button></div>
      <h4>결과물</h4>
      ${files.length ? `<ul class="ya-artifacts">${files.map(o => `<li>${runnerFileLink(cur.ep, o.path)}</li>`).join('')}</ul>` : '<p class="small">저장된 결과물이 없습니다.</p>'}
      ${runnerOpenLog === selected.id ? '<pre class="ya-log" id="yaLog">불러오는 중…</pre>' : ''}
    </section>` : '';
  const fin = cur.steps.find(s => s.id === 'mix')?.outputs.find(o => o.exists) || cur.steps.find(s => s.id === 'fx')?.outputs.find(o => o.exists);
  const pack = cur.steps.find(s => s.id === 'upload')?.outputs.find(o => o.exists), script = cur.steps.find(s => s.id === 'script')?.outputs.find(o => o.exists);
  const result = `<section class="ya-result"><h3>③ 결과물 확인</h3>${fin ? `<div class="ya-result-grid"><video controls preload="metadata" playsinline src="${RUNNER}/file?ep=${encodeURIComponent(cur.ep)}&path=${encodeURIComponent(fin.path)}"></video>
      <div><p><b>${fin.path.includes('최종') ? '최종본 (목소리·음악 포함)' : '완성본 (목소리·음악 전)'}</b></p><ul class="ya-artifacts"><li>${runnerFileLink(cur.ep, fin.path, '영상 열기')}</li>${pack ? `<li>${runnerFileLink(cur.ep, pack.path, '업로드 패키지')}</li>` : ''}${script ? `<li>${runnerFileLink(cur.ep, script.path, '대본')}</li>` : ''}</ul>
      ${fin.path.includes('최종') ? '' : '<p class="small">8단계에서 녹음하고 음악을 넣으면 최종본이 돼요.</p>'}</div></div>` : '<p class="small">6단계(자막·효과 완성본)가 끝나면 여기서 바로 볼 수 있어요.</p>'}</section>`;
  const src = cur.sources.length ? cur.sources.map(s => `${esc(s.url)} · ${esc((s.ranges || []).join(', '))}`).join('<br>') : '<span class="ya-err">등록된 소스가 없습니다.</span>';
  return `${runnerFlow(fin && fin.path.includes('최종') ? 3 : 2, percent)}
    <h3 class="ya-h">② 제작 진행</h3>
    <div class="ya-progress"><div><strong>제작 진척률</strong><span class="small">${doneN}/${cur.steps.length} 단계 완료 · ${percent}%</span></div>
      <progress value="${percent}" max="100" aria-label="제작 진척률"></progress></div>
    ${cur.gate && !reviewing ? '<button class="btn" data-ya-review>대본 확인 대기 · 대본 보기</button>' : ''}
    <div class="ya-work-grid"><ol class="ya-stage-list" aria-label="제작 단계">${rows}</ol>${panel}</div>
    ${result}
    <details class="ya-new" data-ya-settings><summary>실행 옵션 · 프로젝트 폴더</summary>
      <div class="ya-row">${cur.running ? '<button class="btn danger" data-ya-act="stop">실행 멈춤</button>' : `<button class="btn" data-ya-act="runall" ${cur.gate || doneN === cur.steps.length ? 'disabled' : ''}>남은 단계 이어서 실행</button>`}<button class="btn ghost" data-ya-act="open">폴더 열기</button></div>
      <p class="small ya-source-list">${src}</p></details>
    <details class="ya-new" data-ya-source-form><summary>＋ 이 에피소드에 소스 추가</summary><div class="ya-form"><input class="input" data-ya-src="url" placeholder="유튜브 주소"><input class="input" data-ya-src="ranges" placeholder="구간: 0:30-0:42, 1:05-1:12 (한 구간 3분까지)"><button class="btn" data-ya-act="addsrc">추가</button></div></details>`;
}
function runnerFlow(at, pct) {
  const step = (n, label, sub, act) => `<li class="${n < at ? 'done' : n === at ? 'now' : ''}"><span>${n}</span><div><b>${label}</b><small>${sub}</small></div>${act || ''}</li>`;
  return `<ol class="ya-flow" aria-label="작업 흐름">${step(1, '링크 전달', '유튜브 링크를 넣으세요', '<button class="linkbtn" data-view="youtubePlan">AI 주제 발굴 →</button>')}${step(1.5, '구간 정하기', '쓸 구간 넣기', '<button class="linkbtn" data-view="ytSources">소스 탭 →</button>')}
    ${step(2, '제작 진행', at >= 2 ? `진척률 ${pct ?? 0}%` : '제작 시작 전')}${step(3, '결과물 확인', at >= 3 ? '최종본 완성' : '영상·업로드 패키지')}</ol>`;
}
// Poll without replacing unchanged controls or clearing a source being typed.
function runnerPaint(live, force = false) {
  const html = ytAutoLive();
  if (!force && live.dataset.rendered === html) return;
  if (!force && live.contains(document.activeElement) && document.activeElement.matches('input, select')) return;
  const sourceForm = live.querySelector('[data-ya-source-form]');
  const settingsOpen = live.querySelector('[data-ya-settings]')?.open;
  const episode = runnerOnline ? runnerEp()?.ep : '';
  const typed = [...live.querySelectorAll('input[data-ya-new]')].map(i => [i.dataset.yaNew, i.value]);
  live.innerHTML = html;
  live.dataset.rendered = html;
  for (const [k, v] of typed) { const i = live.querySelector(`input[data-ya-new="${k}"]`); if (i) i.value = v; }
  if (live.dataset.episode === episode) {
    if (sourceForm) live.querySelector('[data-ya-source-form]')?.replaceWith(sourceForm);
    if (settingsOpen) {
      const settings = live.querySelector('[data-ya-settings]');
      if (settings) settings.open = true;
    }
  }
  live.dataset.episode = episode || '';
}
function ytAutoPanel() {
  const idea = typeof ytPipeIdea === 'function' ? ytPipeIdea() : null;
  setTimeout(runnerRefresh, 0);
  if (recState.open && recState.ep !== runnerEp()?.ep) recState.open = false;  // 주제를 바꾸면 녹음 칸 닫기
  return `<section class="panel ya" id="ytAuto"><div class="sectionhead" style="margin-top:0"><h2>이 주제 제작</h2></div>
    <div id="ytAutoLive">${ytAutoLive()}</div><div id="yaRec">${recState.open ? recPanel() : ''}</div>
</section>`;
}
async function runnerShowLog(step, quiet) {
  const cur = runnerEp(), el = document.getElementById('yaLog');
  if (!cur || !el) return;
  try { const t = await runnerFetch(`/log?ep=${encodeURIComponent(cur.ep)}&step=${step}&tail=6000`); el.textContent = t || '(로그 없음)'; if (!quiet) el.scrollTop = el.scrollHeight; else el.scrollTop = el.scrollHeight; }
  catch (e) { el.textContent = '로그를 못 읽었어요: ' + e.message; }
}
document.addEventListener('click', async e => {
  const step = e.target.closest('button[data-ya-step], button[data-ya-review]');
  if (step) {
    runnerSelectedStep = step.dataset.yaStep || runnerEp()?.steps.find(s => s.gate)?.id;
    const live = document.getElementById('ytAutoLive');
    runnerPaint(live, true);
    [...live.querySelectorAll('[data-ya-step]')].find(b => b.dataset.yaStep === runnerSelectedStep)?.focus();
    return;
  }
  const lg = e.target.closest('button[data-ya-log]');
  if (lg) { runnerOpenLog = runnerOpenLog === lg.dataset.yaLog ? null : lg.dataset.yaLog; runnerPaint(document.getElementById('ytAutoLive'), true); document.querySelector('[data-ya-log]')?.focus(); if (runnerOpenLog) runnerShowLog(runnerOpenLog); return; }
  const run = e.target.closest('button[data-ya-run], button[data-ya-steps]'), act = e.target.closest('button[data-ya-act]');
  if ((!run && !act) || runnerBusy) return;
  if (run && run.dataset.yaConfirm && !confirm(run.dataset.yaConfirm)) return;
  const cur = runnerEp();
  runnerBusy = true;
  try {
    if (run && run.dataset.yaSteps) { const ids = run.dataset.yaSteps.split(',').filter(Boolean); await runnerFetch('/run', { ep: cur.ep, steps: ids, ...(typeof window.ytAiExtra === 'function' ? window.ytAiExtra(cur, ids) : {}) }); runnerOpenLog = ids[0]; toast('실행을 시작했어요.'); }
    else if (run) { await runnerFetch('/run', { ep: cur.ep, step: run.dataset.yaRun }); runnerOpenLog = run.dataset.yaRun; toast('실행을 시작했어요.'); }
    else {
      const a = act.dataset.yaAct;
      if (a === 'create') {
        const v = k => document.querySelector(`[data-ya-new="${k}"]`)?.value || '';
        const idea = runnerIdea(); if (!idea) throw new Error('주제를 먼저 고르세요');
        let channel = ''; try { channel = (typeof ytValidCh === 'function' && ytValidCh(idea.ytChannel)) || (typeof ytChannelOfTopic === 'function' && ytChannelOfTopic(idea.topicId)) || (typeof ytTab === 'function' && ytTab()) || ''; } catch (e) { channel = ''; }
        let voice = ''; try { voice = typeof ytChVoice === 'function' && channel ? ytChVoice(channel) : ''; } catch (e) { voice = ''; }
        const r = await runnerFetch('/episodes', { title: idea.title, note: idea.note || '', url: v('url'), ranges: v('ranges'), ideaId: idea.id, channel, voice });
        if (!idea.ytStarted || idea.ytHidden) { idea.ytStarted = idea.ytStarted || Date.now(); delete idea.ytHidden; persist(); }
        runnerSelectedStep = runnerOpenLog = null;
        toast('에피소드를 만들었어요: ' + r.ep);
      } else if (a === 'look') {
        // ② 편집 레퍼런스: 에피소드가 없으면 만들고(구간은 컷 편집에서 정해요), 있으면 룩만 바꿔요
        const look = act.dataset.yaLook || '', idea = runnerIdea(); if (!idea || !look) throw new Error('주제를 먼저 고르세요');
        if (cur) { const r = await runnerFetch('/look', { ep: cur.ep, look }); toast(r.reset ? '룩을 바꿨어요. 컷 편집부터 다시 해 주세요.' : '룩을 정했어요.'); }
        else {
          let channel = ''; try { channel = (typeof ytValidCh === 'function' && ytValidCh(idea.ytChannel)) || (typeof ytChannelOfTopic === 'function' && ytChannelOfTopic(idea.topicId)) || (typeof ytTab === 'function' && ytTab()) || ''; } catch (e) { channel = ''; }
          let voice = ''; try { voice = typeof ytChVoice === 'function' && channel ? ytChVoice(channel) : ''; } catch (e) { voice = ''; }
          const url = (typeof ytPipe === 'object' && ytPipe.url) || ytFirstUrl(idea);
          const r = await runnerFetch('/episodes', { title: idea.title, note: idea.note || '', url, deferRanges: true, ideaId: idea.id, channel, voice, format: idea.ytFormat === 'long' ? 'long' : 'shorts', resub: !!idea.ytResub, look });
          if (!idea.ytStarted || idea.ytHidden) { idea.ytStarted = idea.ytStarted || Date.now(); delete idea.ytHidden; persist(); }
          runnerSelectedStep = runnerOpenLog = null; toast('룩을 정했어요: ' + r.ep);
        }
        if (typeof ytPipe === 'object') { ytPipe.look = ''; ytPipe.lookIdea = ''; }
      } else if (a === 'aicut') {
        // AI 편집 ② (레슬링·기독교·보수/이민): 에피소드가 없으면 만들고(구간은 AI 가 골라요) 소스 확인·영상 받기·AI 하이라이트 1차 컷을 이어서 돌려요
        if (act.dataset.yaConfirm && !confirm(act.dataset.yaConfirm)) return;
        const idea = runnerIdea(); if (!idea) throw new Error('주제를 먼저 고르세요');
        let ep = cur && cur.ep;
        if (!ep) {
          const url = (typeof ytPipe === 'object' && ytPipe.url) || ytFirstUrl(idea);
          let channel = 'yt-wrestling'; try { channel = (typeof ytValidCh === 'function' && ytValidCh(idea.ytChannel)) || (typeof ytChannelOfTopic === 'function' && ytChannelOfTopic(idea.topicId)) || (typeof ytTab === 'function' && ytTab()) || channel; } catch (e) {}
          const r = await runnerFetch('/episodes', { title: idea.title, note: idea.note || '', url, deferRanges: true, ideaId: idea.id, channel, format: 'shorts', resub: !!idea.ytResub });
          ep = r.ep;
          if (!idea.ytStarted || idea.ytHidden) { idea.ytStarted = idea.ytStarted || Date.now(); delete idea.ytHidden; persist(); }
        }
        const done = id => !!cur && (cur.steps || []).some(x => x.id === id && x.status === 'done');
        const steps = [...['research', 'download'].filter(id => !done(id)), 'aicut'];
        const vtype = (typeof ytPipe === 'object' && ytPipe.vtypeIdea === idea.id && ytPipe.vtype) || (cur && cur.vtype) || 'highlight';
        const tg = typeof ytPipe === 'object' && ytPipe.targetIdea === idea.id && ytPipe.target != null ? ytPipe.target : (cur && cur.target) || 0;
        await runnerFetch('/run', { ep, steps, vtype, target: tg }); runnerOpenLog = steps[0]; runnerSelectedStep = null;
        toast('1차 컷을 시작했어요. Claude 가 영상을 보는 데 몇 분 걸려요.');
      } else if (a === 'fxpack') {
        // ③ 최종 결과물 레퍼런스(이펙트 팩): 고른 팩과 더 강조할 시간을 저장. 바뀌면 이펙트부터 다시 만들어요.
        const pack = act.dataset.yaFxpack || '', times0 = (document.querySelector('[data-ya-new="fxtimes"]')?.value ?? ((typeof ytPipe === 'object' && ytPipe.fxTimes != null) ? ytPipe.fxTimes : cur?.fxTimes) ?? '').trim(), times = pack === 'none' ? '' : times0;
        const lab0 = document.querySelector('[data-ya-new="fxlabels"]')?.value ?? ((typeof ytPipe === 'object' && ytPipe.fxLabels != null) ? ytPipe.fxLabels : (cur?.fxLabels || []).join(', ')),
          labels = pack === 'steps' ? String(lab0 || '').split(',').map(x => x.trim()).filter(Boolean) : [];
        if (!cur || !pack) throw new Error('편집 스타일을 먼저 정해 주세요');
        if ((cur.round || 0) >= 1 && (pack !== cur.fxPackUsed || times !== (cur.fxTimes || '') || labels.join('\n') !== (cur.fxLabels || []).join('\n')) && !confirm('레퍼런스를 바꾸면 이펙트부터 다시 만들어요. 계속할까요?')) return;
        const r = await runnerFetch('/fxpack', { ep: cur.ep, pack, times, labels });
        if (typeof ytPipe === 'object') { ytPipe.fxPack = ''; ytPipe.fxIdea = ''; ytPipe.fxTimes = null; ytPipe.fxLabels = null; }
        toast(r.reset ? '레퍼런스를 바꿨어요. 이펙트부터 다시 만들어요.' : '레퍼런스를 정했어요.');
      } else if (a === 'cut') {
        // ④ 컷 편집: 구간 저장 → 자르기·편집 계획·가편집
        const val = (document.querySelector('[data-ya-new="ranges"]')?.value || '').trim();
        if (!val && !(cur.sources[0] && cur.sources[0].ranges.length)) throw new Error('쓸 구간을 넣어 주세요. (예: 0:30-0:42)');
        if (val) await runnerFetch('/ranges', { ep: cur.ep, ranges: val });
        await runnerFetch('/run', { ep: cur.ep, steps: ['clip', 'plan', 'rough'] }); runnerOpenLog = 'clip';
        if (typeof ytPipe === 'object') ytPipe.ranges = '';
        toast('컷 편집을 시작했어요.');
      } else if (a === 'edit') {
        // ④·⑥ 1차·2차 편집 (1차는 구간 칸을 같이 저장)
        const round = +act.dataset.yaRound || 0;
        if (act.dataset.yaConfirm && !confirm(act.dataset.yaConfirm)) return;
        const val = round === 1 ? (document.querySelector('[data-ya-new="ranges"]')?.value || '').trim() : '';
        if (round === 1 && !val && !(cur.sources[0] && cur.sources[0].ranges.length)) throw new Error('쓸 구간을 넣어 주세요. (예: 0:30-0:42, 슬로우는 0:30-0:34x0.5)');
        await runnerFetch('/edit', { ep: cur.ep, round, ranges: val });
        runnerOpenLog = 'clip'; if (typeof ytPipe === 'object') ytPipe.ranges = '';
        ytFb(cur.ep).loaded = false;
        toast(round === 1 ? '1차 편집을 시작했어요. 몇 분 걸려요.' : `${round}차 편집을 시작했어요.`);
      } else if (a === 'draftsave' || a === 'fbans' || a === 'fbai' || a === 'fbcopy') {
        const st = ytFb(cur.ep); st.busy = true;
        try {
          if (a === 'fbcopy') {
            const d = await runnerFetch('/feedback', { ep: cur.ep, feedback: st.fb, copyOnly: true });
            toast((await copyText(d.request)) ? 'Claude 채팅에 붙여 넣고, 받은 답을 ② 칸에 붙여 넣으세요.' : '복사가 안 됐어요.');
          } else if (a === 'fbai') {
            toast('Claude가 자막을 쓰는 중…');
            const d = await runnerFetch('/feedback', { ep: cur.ep, feedback: st.fb });
            st.loaded = false; toast(`반영했어요: 자막 ${d.lines}줄${d.rangesChanged ? ' · 구간 바뀜' : ''}. 2차 편집을 누르세요.`);
          } else if (a === 'fbans') {
            if (!st.ans.trim()) throw new Error('Claude 답을 ② 칸에 붙여 넣어 주세요.');
            const d = await runnerFetch('/draft', { ep: cur.ep, answer: st.ans, feedback: st.fb });
            st.ans = ''; st.loaded = false; toast(`반영했어요: 자막 ${d.lines}줄${d.rangesChanged ? ' · 구간 바뀜' : ''}. 2차 편집을 누르세요.`);
          } else {
            const body = { ep: cur.ep, feedback: st.fb };
            if (st.ranges.trim() !== st.ranges0.trim()) body.ranges = st.ranges;
            if (st.text !== st.text0) body.text = st.text;
            const d = await runnerFetch('/draft', body);
            st.loaded = false; toast(`자막을 저장했어요${d.lines ? ` (${d.lines}줄)` : ''}. 2차 편집을 누르세요.`);
          }
        } finally { st.busy = false; }
      } else if (a === 'addsrc') {
        const v = k => document.querySelector(`[data-ya-src="${k}"]`)?.value || '';
        await runnerFetch('/source', { ep: cur.ep, url: v('url'), ranges: v('ranges') });
        document.querySelectorAll('[data-ya-src]').forEach(input => { input.value = ''; }); toast('소스를 추가했어요.');
      } else if (a === 'runall') { const r = await runnerFetch('/runall', { ep: cur.ep }); runnerOpenLog = r.from || null; toast('처음 안 끝난 단계부터 차례로 돌아요.'); }
      else if (a === 'scriptsave') {
        const st = ytScr(cur.ep), ta = document.querySelector('textarea[data-ya-scr-text]');
        const text = ta ? ta.value : st.text || ''; st.text = text; st.busy = true;
        try {
          await runnerFetch('/script', { ep: cur.ep, text }).catch(e => { e.fromSave = true; throw e; });
          const r = await runnerFetch('/continue', { ep: cur.ep }); runnerSelectedStep = runnerOpenLog = r.from || null;
          st.loaded = false; st.text = null; toast('대본을 저장했어요. 이제 녹음할 수 있어요.');
        } finally { st.busy = false; }
      }
      else if (a === 'continue') { const r = await runnerFetch('/continue', { ep: cur.ep }); runnerSelectedStep = runnerOpenLog = r.from || null; toast('대본을 확인했어요. 이제 녹음할 수 있어요.'); }
      else if (a === 'stop') { await runnerFetch('/stop', { ep: cur.ep }); toast('멈췄어요.'); }
      else if (a === 'open') { await runnerFetch('/open', { ep: cur.ep }); }
    }
  } catch (err) {
    const ph = PH_RE.test(err.message) && !err.fromSave;
    toast(ph ? runnerFriendly(err.message) : '실행기: ' + err.message);
    if (ph) { if (cur) { const st = ytScr(cur.ep); st.loaded = false; st.hasPh = true; } if (typeof ytGoScript === 'function') ytGoScript(); }
  }
  finally { runnerBusy = false; runnerRefresh(); }
});

// ===== 🎙 녹음·음악 (8단계 '내 목소리·음악 넣기' 준비) =====
// 대본 줄마다 녹음 → 실행기로 보냄. 자동 새로고침과 분리된 칸(#yaRec)이라 녹음 중에 화면이 안 바뀐다.
const recState = { open: false, ep: null, lines: [], assets: { bgm: [], sting: [] }, mix: {}, stream: null, rec: null, idx: null, sel: 0, busy: false };
function recPaint() { const el = document.getElementById('yaRec'); if (el) el.innerHTML = recState.open ? recPanel() : ''; }
async function recLoad() {
  const cur = runnerEp(); if (!cur) return;
  const d = await runnerFetch('/lines?ep=' + encodeURIComponent(cur.ep));
  Object.assign(recState, { ep: cur.ep, lines: d.lines, assets: d.assets, mix: d.mix || {} });
  if (recState.sel >= d.lines.length) recState.sel = 0;
  recPaint();
}
function recPanel() {
  const L = recState.lines, done = L.filter(l => l.file).length;
  if (!L.length) return `<div class="ya-rec"><p class="small">대본을 확인하면 녹음할 줄이 생겨요.</p></div>`;
  const opt = (list, v) => `<option value="">없음</option>` + list.map(f => `<option value="${esc(f)}" ${f === v ? 'selected' : ''}>${esc(f)}</option>`).join('');
  return `<div class="ya-rec"><div class="ya-rec-head"><b>🎙 녹음 ${done}/${L.length}줄</b><span class="small">줄을 고르고 <kbd>스페이스</kbd> = 녹음 시작/멈춤 · 멈추면 다음 줄로 넘어가요 · 칸보다 길면 최대 1.25배까지 자동으로 맞춤</span></div>
    <ol class="ya-lines">${L.map((l, i) => { const rec = recState.idx === i; return `<li class="ya-line ${i === recState.sel ? 'sel' : ''} ${rec ? 'rec' : ''}" data-ya-sel="${i}">
      <span class="ya-n">${String(i + 1).padStart(2, '0')}</span><span class="ya-t">${esc(l.text)}</span><span class="small">${(l.end - l.start).toFixed(1)}초</span>
      <span>${l.file ? '✅' : '○'}</span>
      <button class="btn ${rec ? 'danger' : 'primary'}" data-ya-rec="${i}">${rec ? '■ 멈춤' : '● 녹음'}</button>
      ${l.file ? `<audio controls preload="none" src="${RUNNER}/file?ep=${encodeURIComponent(recState.ep)}&path=${encodeURIComponent('편집/녹음/' + l.file)}&t=${Date.now()}"></audio>` : ''}</li>`; }).join('')}</ol>
    <div class="ya-mixset"><label>배경음악 <select data-ya-mix="bgm">${opt(recState.assets.bgm, recState.mix.bgm)}</select></label>
      <label>시그니처 소리 (설명 시작 순간) <select data-ya-mix="sting">${opt(recState.assets.sting, recState.mix.sting)}</select></label>
      <button class="btn" data-ya-mixsave>저장</button><button class="btn primary" data-ya-run="mix" ${done ? '' : 'disabled'}>▶ 목소리·음악 넣기</button></div>
    <p class="small">음악·시그니처 소리는 <a href="https://studio.youtube.com/channel/UC/music" target="_blank" rel="noopener noreferrer">유튜브 스튜디오 → 오디오 보관함</a>에서 받아 <code>~/Desktop/유투브/소리/BGM</code>, <code>~/Desktop/유투브/소리/시그니처</code> 에 넣으면 여기 목록에 떠요. 저작자 표시가 필요 없는 곡만.</p></div>`;
}
async function recStart(i) {
  if (recState.rec) return recStop();
  try {
    if (!recState.stream) recState.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: true, autoGainControl: false } });
  } catch (e) { toast('마이크를 쓸 수 없어요: ' + e.message); return; }
  const type = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : '';
  const rec = new MediaRecorder(recState.stream, type ? { mimeType: type } : {}), chunks = [];
  rec.ondataavailable = e => e.data.size && chunks.push(e.data);
  rec.onstop = async () => {
    const blob = new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), idx = recState.idx;
    recState.rec = null; recState.idx = null;
    try {
      const r = await fetch(`${RUNNER}/voice?ep=${encodeURIComponent(recState.ep)}&idx=${idx}`, { method: 'POST', headers: { 'Content-Type': blob.type.split(';')[0] }, body: blob });
      if (!r.ok) throw new Error((await r.json()).error);
      recState.sel = Math.min(idx + 1, recState.lines.length - 1);
      await recLoad();
    } catch (e) { toast('녹음 저장 실패: ' + e.message); recPaint(); }
  };
  recState.rec = rec; recState.idx = i; recState.sel = i; rec.start(); recPaint();
}
function recStop() { if (recState.rec && recState.rec.state !== 'inactive') recState.rec.stop(); }
document.addEventListener('click', async e => {
  if (e.target.closest('button[data-ya-recopen]')) { recState.open = !recState.open; if (recState.open) await recLoad().catch(err => toast('실행기: ' + err.message)); else recPaint(); return; }
  const r = e.target.closest('button[data-ya-rec]'); if (r) { const i = Number(r.dataset.yaRec); recState.rec ? recStop() : recStart(i); return; }
  if (e.target.closest('button[data-ya-mixsave]')) {
    const v = k => document.querySelector(`[data-ya-mix="${k}"]`)?.value || '';
    try { await runnerFetch('/mixset', { ep: recState.ep, bgm: v('bgm'), sting: v('sting') }); recState.mix = { bgm: v('bgm'), sting: v('sting') }; toast('음악 설정을 저장했어요.'); } catch (err) { toast('실행기: ' + err.message); }
    return;
  }
  const li = e.target.closest('li[data-ya-sel]'); if (li && !e.target.closest('button,audio')) { recState.sel = Number(li.dataset.yaSel); recPaint(); }
});
document.addEventListener('keydown', e => {
  if (!recState.open || e.code !== 'Space' || /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '')) return;
  if (!document.getElementById('yaRec')) return;
  e.preventDefault(); recState.rec ? recStop() : recStart(recState.sel);
});
