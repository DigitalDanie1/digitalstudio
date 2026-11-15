// ===== YouTube 작업판: ⚡ 자동 실행 (맥 실행기 http://127.0.0.1:4777 와 연결) =====
// 실행기는 ~/Desktop/유투브/실행기/실행기 켜기.command 로 켠다. 작업판은 버튼만 누르고, 실제 작업은 맥에서 돈다.
const RUNNER = 'http://127.0.0.1:4777';
const RUN_EP_KEY = 'fn_yt_auto_ep';
let runnerData = null, runnerOnline = null, runnerBusy = false, runnerTimer = null, runnerOpenLog = null;
function runnerEp() {
  const eps = runnerData?.episodes || [];
  let id = null; try { id = localStorage.getItem(RUN_EP_KEY); } catch (_) {}
  return eps.find(e => e.ep === id) || eps[eps.length - 1] || null;
}
async function runnerFetch(p, body) {
  const r = await fetch(RUNNER + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const ct = r.headers.get('content-type') || '';
  const data = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(data.error || data || r.status);
  return data;
}
async function runnerRefresh() {
  try { runnerData = await runnerFetch('/status'); runnerOnline = true; }
  catch (_) { runnerOnline = false; }
  const live = document.getElementById('ytAutoLive');
  if (live) live.innerHTML = ytAutoLive();
  if (runnerOpenLog) runnerShowLog(runnerOpenLog, true);
  const busy = runnerData?.episodes?.some(e => e.running);
  clearTimeout(runnerTimer);
  if (document.getElementById('ytAuto')) runnerTimer = setTimeout(runnerRefresh, busy ? 2000 : 8000);
}
const RUN_ICON = { done: '✅', running: '⏳', failed: '❌', todo: '○' };
const RUN_LABEL = { done: '완료', running: '진행 중', failed: '실패', todo: '대기' };
function runnerFileLink(ep, p, label) {
  return `<a class="btn ghost ya-file" href="${RUNNER}/file?ep=${encodeURIComponent(ep)}&path=${encodeURIComponent(p)}" target="_blank" rel="noopener noreferrer">${esc(label || p.split('/').pop())} ↗</a>`;
}
function ytAutoLive() {
  if (runnerOnline === null) return '<p class="small">실행기 확인 중…</p>';
  if (!runnerOnline) return `<div class="ya-off"><b>실행기가 꺼져 있어요.</b> 맥에서 <code>~/Desktop/유투브/실행기/실행기 켜기.command</code> 를 더블클릭하면 켜져요. 켜진 창은 닫지 마세요.<br><span class="small">다른 컴퓨터·휴대폰에서는 버튼이 동작하지 않아요(실행기는 이 맥에서만 돕니다). 크롬이 "로컬 네트워크 접근"을 물으면 허용을 누르세요.</span></div>`;
  const eps = runnerData.episodes || [], cur = runnerEp();
  const pick = `<label class="ya-pick"><span>에피소드</span><select data-ya-ep>${eps.map(e => `<option value="${esc(e.ep)}" ${cur && e.ep === cur.ep ? 'selected' : ''}>${esc(e.ep)}</option>`).join('')}</select></label>`;
  if (!cur) return pick + '<p class="small">아직 에피소드가 없어요. 아래에서 새로 만드세요.</p>';
  const doneN = cur.steps.filter(s => s.status === 'done').length;
  const gate = cur.gate ? `<div class="ya-gate">✋ <b>대본을 확인하세요.</b> 사실·말투를 보고 괜찮으면 계속을 누르면 편집부터 끝까지 이어서 돌아요. 고칠 게 있으면 대본.md를 직접 고친 뒤 계속.
      <div class="ya-row">${runnerFileLink(cur.ep, '편집/대본.md', '📄 대본 보기')}<button class="btn primary" data-ya-act="continue">▶ 계속</button></div></div>` : '';
  const rows = cur.steps.map((s, i) => `<li class="ya-step ${s.status}">
      <span class="ya-n">${String(i + 1).padStart(2, '0')}</span>
      <div class="ya-body"><div class="ya-title"><b>${esc(s.name)}</b><span class="ya-kind">${esc(s.kind)}</span>${s.gate ? '<span class="ya-kind gate">✋ 확인 지점</span>' : ''}</div>
        <div class="ya-row">${s.outputs.filter(o => o.exists).map(o => runnerFileLink(cur.ep, o.path)).join('')}${s.error && s.status === 'failed' ? `<span class="ya-err">${esc(s.error)}</span>` : ''}</div></div>
      <span class="ya-st">${RUN_ICON[s.status]} ${RUN_LABEL[s.status]}</span>
      <div class="ya-acts"><button class="btn ${s.status === 'done' ? 'ghost' : ''}" data-ya-run="${s.id}" ${cur.running ? 'disabled' : ''}>${s.status === 'done' ? '↻ 다시' : '▶ 실행'}</button><button class="btn ghost" data-ya-log="${s.id}">로그</button></div>
      ${runnerOpenLog === s.id ? `<pre class="ya-log" id="yaLog">불러오는 중…</pre>` : ''}</li>`).join('');
  const src = cur.sources.length ? cur.sources.map(s => `${esc(s.url)} · ${esc((s.ranges || []).join(', '))}`).join('<br>') : '<span class="ya-err">소스 URL 없음 — 1단계 전에 아래 "소스 추가"</span>';
  return `${pick}
    <div class="ya-head"><div><b>${esc(cur.title)}</b> <span class="small">${doneN}/${cur.steps.length} 단계 완료${cur.running ? ' · 지금: ' + esc(cur.steps.find(s => s.id === cur.running)?.name || '') : ''}</span><div class="small">소스: ${src}</div></div>
      <div class="ya-row">${cur.running ? '<button class="btn danger" data-ya-act="stop">⏹ 멈춤</button>' : `<button class="btn primary" data-ya-act="runall" ${doneN === cur.steps.length ? 'disabled' : ''}>▶▶ 전부 실행</button>`}<button class="btn ghost" data-ya-act="open">📂 폴더</button></div></div>
    ${gate}<ol class="ya-steps">${rows}</ol>
    <details class="ya-new"><summary>＋ 이 에피소드에 소스 추가</summary><div class="ya-form"><input class="input" data-ya-src="url" placeholder="유튜브 주소"><input class="input" data-ya-src="ranges" placeholder="구간: 0:30-0:42, 1:05-1:12 (한 구간 15초까지)"><button class="btn" data-ya-act="addsrc">추가</button></div></details>`;
}
function ytAutoPanel() {
  const idea = typeof ytPipeIdea === 'function' ? ytPipeIdea() : null;
  setTimeout(runnerRefresh, 0);
  return `<section class="panel ya" id="ytAuto"><div class="sectionhead" style="margin-top:0"><h2>⚡ 자동 실행 <span class="small">버튼을 누르면 이 맥에서 단계별로 돌아요 · 대본 뒤 한 번 멈춤</span></h2></div>
    <div id="ytAutoLive">${ytAutoLive()}</div>
    <details class="ya-new"><summary>＋ 새 에피소드 만들기</summary><div class="ya-form">
      <input class="input" data-ya-new="title" placeholder="주제 제목 (예: 심권호 그레코로만 들어 던지기)" value="${esc(idea?.title || '')}">
      <input class="input" data-ya-new="note" placeholder="주제 메모 (선수·대회·보여 줄 기술)">
      <input class="input" data-ya-new="url" placeholder="소스 유튜브 주소 (UWW·RAF 공식 먼저)" value="${esc(typeof ytPipe === 'object' ? ytPipe.url || '' : '')}">
      <input class="input" data-ya-new="ranges" placeholder="구간: 0:30-0:42 (한 구간 15초까지, 여러 개는 쉼표)" value="${esc(typeof ytPipe === 'object' ? ytPipe.ranges || '' : '')}">
      <button class="btn primary" data-ya-act="create">만들기</button></div>
      <p class="small">폴더는 ~/Desktop/유투브/NN_주제 로 생겨요. 만든 뒤 ▶▶ 전부 실행.</p></details></section>`;
}
async function runnerShowLog(step, quiet) {
  const cur = runnerEp(), el = document.getElementById('yaLog');
  if (!cur || !el) return;
  try { const t = await runnerFetch(`/log?ep=${encodeURIComponent(cur.ep)}&step=${step}&tail=6000`); el.textContent = t || '(로그 없음)'; if (!quiet) el.scrollTop = el.scrollHeight; else el.scrollTop = el.scrollHeight; }
  catch (e) { el.textContent = '로그를 못 읽었어요: ' + e.message; }
}
document.addEventListener('change', e => {
  const s = e.target.closest?.('select[data-ya-ep]'); if (!s) return;
  try { localStorage.setItem(RUN_EP_KEY, s.value); } catch (_) {}
  runnerOpenLog = null; document.getElementById('ytAutoLive').innerHTML = ytAutoLive();
});
document.addEventListener('click', async e => {
  const lg = e.target.closest('button[data-ya-log]');
  if (lg) { runnerOpenLog = runnerOpenLog === lg.dataset.yaLog ? null : lg.dataset.yaLog; document.getElementById('ytAutoLive').innerHTML = ytAutoLive(); if (runnerOpenLog) runnerShowLog(runnerOpenLog); return; }
  const run = e.target.closest('button[data-ya-run]'), act = e.target.closest('button[data-ya-act]');
  if ((!run && !act) || runnerBusy) return;
  const cur = runnerEp();
  runnerBusy = true;
  try {
    if (run) { await runnerFetch('/run', { ep: cur.ep, step: run.dataset.yaRun }); runnerOpenLog = run.dataset.yaRun; toast('실행을 시작했어요.'); }
    else {
      const a = act.dataset.yaAct;
      if (a === 'create') {
        const v = k => document.querySelector(`[data-ya-new="${k}"]`)?.value || '';
        const r = await runnerFetch('/episodes', { title: v('title'), note: v('note'), url: v('url'), ranges: v('ranges') });
        try { localStorage.setItem(RUN_EP_KEY, r.ep); } catch (_) {}
        toast('에피소드를 만들었어요: ' + r.ep);
      } else if (a === 'addsrc') {
        const v = k => document.querySelector(`[data-ya-src="${k}"]`)?.value || '';
        await runnerFetch('/source', { ep: cur.ep, url: v('url'), ranges: v('ranges') }); toast('소스를 추가했어요.');
      } else if (a === 'runall') { const r = await runnerFetch('/runall', { ep: cur.ep }); runnerOpenLog = r.from || null; toast('처음 안 끝난 단계부터 차례로 돌아요.'); }
      else if (a === 'continue') { const r = await runnerFetch('/continue', { ep: cur.ep }); runnerOpenLog = r.from || null; toast('편집 단계부터 이어서 돌아요.'); }
      else if (a === 'stop') { await runnerFetch('/stop', { ep: cur.ep }); toast('멈췄어요.'); }
      else if (a === 'open') { await runnerFetch('/open', { ep: cur.ep }); }
    }
  } catch (err) { toast('실행기: ' + err.message); }
  finally { runnerBusy = false; runnerRefresh(); }
});
