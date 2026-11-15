// ===== YouTube 작업판: ⚡ 자동 실행 (맥 실행기 http://127.0.0.1:4777 와 연결) =====
// 실행기는 ~/Desktop/유투브/실행기/실행기 켜기.command 로 켠다. 작업판은 버튼만 누르고, 실제 작업은 맥에서 돈다.
const RUNNER = 'http://127.0.0.1:4777';
let runnerData = null, runnerOnline = null, runnerBusy = false, runnerTimer = null, runnerOpenLog = null, runnerSelectedStep = null;
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
  const lost = runnerData.episodes.filter(e => !e.ideaId || !db.ideas.some(i => i.id === e.ideaId));
  if (!lost.length) return;
  runnerSyncing = true;
  try {
    for (const e of lost) {
      const id = e.ideaId && !db.ideas.some(i => i.id === e.ideaId) ? e.ideaId : 'ep-' + e.ep;
      if (!db.ideas.some(i => i.id === id)) db.ideas.unshift({ id, title: e.title, note: e.note || '', sources: e.sources.map(s => s.url).join('\n'),
        preferredChannel: 'youtube', ytChannel: 'yt-wrestling', ytFormat: 'shorts', topicId: 'yt-wrestling-athletes', sample: false, created: Date.now() });
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
  try { runnerData = await runnerFetch('/status'); runnerOnline = true; runnerSyncIdeas(); }
  catch (_) { runnerOnline = false; }
  const live = document.getElementById('ytAutoLive');
  if (live) runnerPaint(live);
  if (runnerOpenLog) runnerShowLog(runnerOpenLog, true);
  const busy = runnerData?.episodes?.some(e => e.running);
  clearTimeout(runnerTimer);
  if (document.getElementById('ytAuto')) runnerTimer = setTimeout(runnerRefresh, busy ? 2000 : 8000);
}
const RUN_LABEL = { done: '완료', running: '진행 중', failed: '실패', todo: '대기' };
function runnerFileLink(ep, p, label) {
  return `<a class="btn ghost ya-file" href="${RUNNER}/file?ep=${encodeURIComponent(ep)}&path=${encodeURIComponent(p)}" target="_blank" rel="noopener noreferrer">${esc(label || p.split('/').pop())} ↗</a>`;
}
function ytAutoLive() {
  if (runnerOnline === null) return '<p class="small">실행기 확인 중…</p>';
  if (!runnerOnline) return `<div class="ya-off"><b>실행기가 꺼져 있어요.</b> 맥에서 <code>~/Desktop/유투브/실행기/실행기 켜기.command</code> 를 더블클릭하면 켜져요. 켜진 창은 닫지 마세요.<br><span class="small">다른 컴퓨터·휴대폰에서는 버튼이 동작하지 않아요(실행기는 이 맥에서만 돕니다). 크롬이 "로컬 네트워크 접근"을 물으면 허용을 누르세요.</span></div>`;
  const cur = runnerEp(), idea = runnerIdea();
  if (!idea) return runnerFlow(1) + '<p class="small">위에서 작업할 주제를 고르세요. 주제가 없으면 AI 주제 발굴이나 소스 탭에서 먼저 등록하세요.</p>';
  if (!cur) return runnerFlow(1) + `<div class="yaw-start"><b>이 주제는 아직 제작 전이에요.</b>
      <p class="small">소스 영상 주소와 구간을 넣고 시작하면 ~/Desktop/유투브 에 이 주제의 폴더가 생기고 ② 제작이 열려요. (한 구간 15초까지, UWW·올림픽·RAF 공식 먼저)</p>
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
  const fin = cur.steps.find(s => s.id === 'mix')?.outputs.find(o => o.exists) || cur.steps.find(s => s.id === 'finish')?.outputs.find(o => o.exists);
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
    <details class="ya-new" data-ya-source-form><summary>＋ 이 에피소드에 소스 추가</summary><div class="ya-form"><input class="input" data-ya-src="url" placeholder="유튜브 주소"><input class="input" data-ya-src="ranges" placeholder="구간: 0:30-0:42, 1:05-1:12 (한 구간 15초까지)"><button class="btn" data-ya-act="addsrc">추가</button></div></details>`;
}
function runnerFlow(at, pct) {
  const step = (n, label, sub, act) => `<li class="${n < at ? 'done' : n === at ? 'now' : ''}"><span>${n}</span><div><b>${label}</b><small>${sub}</small></div>${act || ''}</li>`;
  return `<ol class="ya-flow" aria-label="작업 흐름">${step(1, '주제 발굴', '주제 고르기 · 소스 찾기', '<button class="linkbtn" data-view="youtubePlan">AI 주제 발굴 →</button><button class="linkbtn" data-view="ytSources">소스 탭 →</button>')}
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
        const idea = runnerIdea(); if (!idea) throw new Error('주제를 먼저 고르세요');
        const r = await runnerFetch('/episodes', { title: idea.title, note: idea.note || '', url: v('url'), ranges: v('ranges'), ideaId: idea.id });
        runnerSelectedStep = runnerOpenLog = null;
        toast('에피소드를 만들었어요: ' + r.ep);
      } else if (a === 'addsrc') {
        const v = k => document.querySelector(`[data-ya-src="${k}"]`)?.value || '';
        await runnerFetch('/source', { ep: cur.ep, url: v('url'), ranges: v('ranges') });
        document.querySelectorAll('[data-ya-src]').forEach(input => { input.value = ''; }); toast('소스를 추가했어요.');
      } else if (a === 'runall') { const r = await runnerFetch('/runall', { ep: cur.ep }); runnerOpenLog = r.from || null; toast('처음 안 끝난 단계부터 차례로 돌아요.'); }
      else if (a === 'continue') { const r = await runnerFetch('/continue', { ep: cur.ep }); runnerSelectedStep = runnerOpenLog = r.from || null; toast('편집 단계부터 이어서 돌아요.'); }
      else if (a === 'stop') { await runnerFetch('/stop', { ep: cur.ep }); toast('멈췄어요.'); }
      else if (a === 'open') { await runnerFetch('/open', { ep: cur.ep }); }
    }
  } catch (err) { toast('실행기: ' + err.message); }
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
  if (!L.length) return `<div class="ya-rec"><p class="small">6단계(자막·효과 완성본)가 끝나야 녹음할 줄이 생겨요.</p></div>`;
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
