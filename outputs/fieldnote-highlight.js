/* FIELDNOTE - YouTube "하이라이트 찾기" 탭 (route: ytHighlight). 작업판 8칸 카드가 아닌 따로 쓰는 도구예요.
   긴 경기 영상 하나 → 움직임·소리로 볼 만한 장면 후보를 골라 주고(AI 키 없이), 체크한 것을 쇼츠 에피소드로 만들어요.
   맥 실행기(/hl/*, api 6 이상)가 일해요. Loaded before the inline app script; globals (esc, toast, head, ytTabs, ...) are read at call time. */
(function () {
if (window.__ytHighlight) return; window.__ytHighlight = 1;
const NEED_API = 6;   // RUNNER_API_NEEDED(작업판) 와는 따로: 이 도구만 api 6 을 요구해요
const css = `.hl-wrap{display:grid;gap:16px}
.hl-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.hl-card h2{margin:0 0 4px;font-size:17px}.hl-card h3{margin:0;font-size:15px}
.hl-sub{color:var(--muted);font-size:13px;margin:0 0 12px}
.hl-row{display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end}
.hl-f{display:grid;gap:4px;font-size:12.5px;color:var(--muted);min-width:0}
.hl-f input[type=text],.hl-f input[type=number],.hl-f select{font:inherit;font-size:15px;color:var(--text);background:#0f1217;border:1px solid var(--line);border-radius:8px;padding:9px 11px;min-width:0}
.hl-f input[type=range]{width:100%;min-width:140px;accent-color:var(--lime)}
.hl-grow{flex:1 1 280px}
.hl-or{color:var(--muted);font-size:12.5px;align-self:center;padding-bottom:6px}
.hl-bar{height:10px;border-radius:99px;background:#242930;overflow:hidden}.hl-bar i{display:block;height:100%;background:var(--lime);border-radius:99px;transition:width .4s}
.hl-stage{display:flex;justify-content:space-between;gap:10px;font-size:14px;margin:0 0 8px;flex-wrap:wrap}
.hl-log{margin:10px 0 0;max-height:180px;overflow:auto;white-space:pre-wrap;font-size:12px;color:var(--muted);background:#0f1217;border:1px solid var(--line);border-radius:8px;padding:8px 10px}
.hl-jobs{display:grid;gap:8px}
.hl-job{display:flex;gap:10px;align-items:center;justify-content:space-between;border:1px solid var(--line);border-radius:10px;padding:10px 12px;background:var(--panel2)}
.hl-job.on{border-color:var(--lime)}
.hl-job b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:46ch}
.hl-job .small{display:block}
.hl-tag{font-size:12px;border:1px solid var(--line);border-radius:99px;padding:1px 8px;color:var(--muted);white-space:nowrap}
.hl-tag.ok{color:var(--green);border-color:#2f6b52}.hl-tag.bad{color:var(--red);border-color:#6b3237}.hl-tag.run{color:var(--orange);border-color:#6b5230}
.hl-tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:12px}
.hl-tools .sp{flex:1}
.hl-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}
@media(max-width:640px){.hl-grid{grid-template-columns:1fr}.hl-card{padding:14px 14px}.hl-job b{max-width:26ch}}
.hl-c{border:1px solid var(--line);border-radius:12px;background:var(--panel2);padding:12px;display:grid;gap:10px;min-width:0}
.hl-c.sel{border-color:var(--lime)}
.hl-ch{display:flex;gap:10px;align-items:center}
.hl-ch input{width:22px;height:22px;accent-color:var(--lime);flex:none}
.hl-rank{font-weight:800;font-size:18px;min-width:34px}
.hl-time{font-size:17px;font-variant-numeric:tabular-nums;font-weight:700}
.hl-len{color:var(--muted);font-size:13px;margin-left:6px;font-weight:400}
.hl-th{display:grid;grid-template-columns:repeat(3,1fr);gap:4px}
.hl-th img{width:100%;aspect-ratio:16/9;object-fit:cover;border-radius:6px;background:#0f1217;display:block}
.hl-sc{display:grid;gap:5px;font-size:12.5px;color:var(--muted)}
.hl-sc div{display:grid;grid-template-columns:48px 1fr 32px;gap:8px;align-items:center}
.hl-sc .hl-bar{height:7px}.hl-sc .hl-bar i{background:#6f7886}.hl-sc .a i{background:var(--orange)}.hl-sc .m i{background:var(--green)}
.hl-c video{width:100%;border-radius:8px;background:#000;max-height:260px}
.hl-nudge{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.hl-nudge div{display:flex;align-items:center;gap:6px;justify-content:space-between;border:1px solid var(--line);border-radius:8px;padding:5px 8px;font-size:13px}
.hl-nudge b{font-variant-numeric:tabular-nums;font-weight:600}
.hl-nudge button{min-width:40px;min-height:36px;border-radius:8px;border:1px solid var(--line);background:transparent;color:var(--text);font-size:14px;cursor:pointer}
.hl-nudge button:hover{border-color:var(--lime)}
.hl-nudge span.l{color:var(--muted);font-size:12px}
.hl-act{position:sticky;bottom:0;z-index:5;background:linear-gradient(transparent,var(--bg) 24%);padding:18px 0 10px;display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.hl-act .btn{min-height:44px}
.hl-note{font-size:13px;color:var(--muted)}
.hl-made{border:1px solid #2f6b52;background:#10231b;border-radius:10px;padding:10px 14px;font-size:14px}
.hl-made ul{margin:6px 0 0;padding-left:18px}`;
const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);

const base = () => (typeof RUNNER === 'string' ? RUNNER : 'http://127.0.0.1:4777');
const e_ = v => (typeof esc === 'function' ? esc(v) : String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
const say = m => { try { toast(m); } catch (_) {} };
async function rf(p, body) {
  const r = await fetch(base() + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const ct = r.headers.get('content-type') || '', d = ct.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error((d && d.error) || d || r.status);
  return d;
}
const fmt = s => { s = Math.max(0, Math.round(s)); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };
const media = (id, rel) => `${base()}/hl/${encodeURIComponent(id)}/file?path=${encodeURIComponent(rel)}`;
const chanId = () => { let c = ''; try { c = (typeof ytLock === 'string' && ytLock) || (typeof ytTab === 'function' && ytTab()) || ''; } catch (_) {} return c || 'yt-wrestling'; };
const chanName = c => { try { return (typeof ytChName === 'function' && ytChName(c)) || c; } catch (_) { return c; } };

// ---------- 상태 (다시 그려도 남아요) ----------
const S = { online: null, api: null, jobs: [], eps: [], cur: null, curId: '', url: '', ep: '', count: 8, len: 10, sort: 'score', checked: {}, edit: {}, busy: false, showLog: false, made: null, err: '', timer: null, loaded: false };
const key = c => c.a + '-' + c.b;                              // 후보의 처음 구간이 열쇠 (옮겨도 열쇠는 그대로)
const ed = c => (S.edit[key(c)] ||= { a: c.a, b: c.b });
const running = j => j && ['queued', 'downloading', 'analyzing', 'rendering'].includes(j.status);
const dead = () => S.online === false || (S.online && S.api < NEED_API);

async function loadAll(quiet) {
  try {
    const h = await rf('/health'); S.online = true; S.api = Number.isInteger(h.api) ? h.api : 0;
    if (S.api >= NEED_API) {
      const l = await rf('/hl/list'); S.jobs = l.jobs || [];
      try { const st = await rf('/status'); S.eps = (st.episodes || []).filter(e => (e.steps || []).some(s => s.id === 'download' && s.status === 'done')); } catch (_) { S.eps = []; }
      if (S.curId) { try { S.cur = await rf('/hl/' + encodeURIComponent(S.curId)); } catch (_) {} }
    }
  } catch (_) { S.online = false; }
  S.loaded = true;
  if (!quiet) paint();
}
function schedule() {
  clearTimeout(S.timer);
  if (!document.getElementById('hlRoot')) return;
  const live = (S.cur && running(S.cur)) || S.jobs.some(running);
  S.timer = setTimeout(async () => {
    if (!document.getElementById('hlRoot')) return;
    const was = S.cur && running(S.cur);
    await loadAll(true);
    if (was && S.cur && !running(S.cur)) { prepare(); paint(); }
    else if (S.cur && running(S.cur)) paintProgress();
    else paintJobsOnly();
    schedule();
  }, live ? 1500 : 6000);
}
function prepare() {   // 새로 불러온 결과에서 쓸 값 정리
  if (!S.cur) return;
  const keep = {}, ed2 = {};
  for (const c of S.cur.candidates || []) { keep[key(c)] = S.checked[key(c)] ?? true; ed2[key(c)] = S.edit[key(c)] || { a: c.a, b: c.b }; }
  S.checked = keep; S.edit = ed2;
}

// ---------- 그리기 ----------
const statusTag = j => j.status === 'done' ? `<span class="hl-tag ok">후보 ${j.found}개</span>` : running(j) ? `<span class="hl-tag run">${e_(j.stage || '돌아가는 중')}</span>` : j.status === 'stopped' ? '<span class="hl-tag">멈춤</span>' : `<span class="hl-tag bad">실패</span>`;
function startCard() {
  const eps = S.eps.map(e => `<option value="${e_(e.ep)}" ${S.ep === e.ep ? 'selected' : ''}>${e_(e.title)}</option>`).join('');
  const busy = S.busy || (S.cur && running(S.cur));
  return `<section class="hl-card"><h2>① 긴 영상 넣기</h2><p class="hl-sub">긴 경기 영상을 한 번 받아서, 움직임이 크고 관중 소리가 커지는 장면을 골라 줘요. (AI 필요 없어요)</p>
  <div class="hl-row"><label class="hl-f hl-grow">유튜브 주소<input type="text" data-hl-url value="${e_(S.url)}" placeholder="https://www.youtube.com/watch?v=..." autocomplete="off" inputmode="url"></label>
  ${S.eps.length ? `<span class="hl-or">또는</span><label class="hl-f hl-grow">이미 받은 영상 (작업판의 에피소드)<select data-hl-ep><option value="">고르지 않음</option>${eps}</select></label>` : ''}</div>
  <div class="hl-row" style="margin-top:12px"><label class="hl-f" style="width:110px">몇 개 찾을까요<input type="number" min="1" max="30" step="1" data-hl-count value="${S.count}"></label>
  <label class="hl-f" style="width:200px">길이 <b data-hl-lenv style="color:var(--text)">${S.len}초</b><input type="range" min="5" max="15" step="1" data-hl-len value="${S.len}"></label>
  <button type="button" class="btn primary" data-hl-act="start" ${busy ? 'disabled' : ''}>${busy ? '돌아가는 중…' : '하이라이트 찾기'}</button></div>
  ${S.err ? `<div class="pl-error" role="alert">${e_(S.err)}</div>` : ''}</section>`;
}
function jobsCard() {
  if (!S.jobs.length) return '';
  return `<section class="hl-card"><h2>지난 작업</h2><p class="hl-sub">누르면 바로 열려요. 이미 분석한 영상은 다시 분석하지 않아요.</p><div class="hl-jobs" data-hl-jobs>${S.jobs.map(j => `<div class="hl-job ${S.curId === j.id ? 'on' : ''}"><div style="min-width:0"><b title="${e_(j.title)}">${e_(j.title)}</b><span class="small">${j.duration ? fmt(j.duration) + ' · ' : ''}${new Date(j.created).toLocaleDateString('ko-KR')}</span></div><div class="hl-row" style="align-items:center">${statusTag(j)}<button type="button" class="btn ghost" data-hl-open="${e_(j.id)}">열기</button></div></div>`).join('')}</div></section>`;
}
function progressCard() {
  const j = S.cur; if (!j || !running(j)) return '';
  return `<section class="hl-card" data-hl-progress><h2>${e_(j.title)}</h2><div class="hl-stage"><span data-hl-stage>${e_(j.stage || '준비 중')}</span><b data-hl-pct>${Math.round((j.progress || 0) * 100)}%</b></div><div class="hl-bar"><i data-hl-fill style="width:${Math.round((j.progress || 0) * 100)}%"></i></div>
  <div class="hl-row" style="margin-top:12px"><button type="button" class="btn" data-hl-act="stop">멈추기</button><button type="button" class="btn ghost" data-hl-act="log">${S.showLog ? '기록 닫기' : '기록 보기'}</button></div>${S.showLog ? `<pre class="hl-log" data-hl-logbox>${e_(j.log || '')}</pre>` : ''}</section>`;
}
function candCard(c) {
  const v = ed(c), j = S.cur, on = !!S.checked[key(c)], pv = c.pv || { a: Math.max(0, c.a - 2) };
  return `<article class="hl-c ${on ? 'sel' : ''}" data-hl-card="${e_(key(c))}">
  <div class="hl-ch"><input type="checkbox" data-hl-check="${e_(key(c))}" ${on ? 'checked' : ''} aria-label="${c.rank}위 고르기"><span class="hl-rank">#${c.rank}</span><span class="hl-time"><span data-hl-range>${fmt(v.a)}–${fmt(v.b)}</span><span class="hl-len" data-hl-lenlab>${v.b - v.a}초</span></span></div>
  <div class="hl-th">${(c.thumbs || []).map(t => `<img loading="lazy" src="${e_(media(j.id, t))}" alt="">`).join('')}</div>
  <div class="hl-sc"><div class="m"><span>움직임</span><span class="hl-bar"><i style="width:${c.motion}%"></i></span><b>${c.motion}</b></div><div class="a"><span>소리</span><span class="hl-bar"><i style="width:${c.audio}%"></i></span><b>${c.audio}</b></div></div>
  ${c.preview ? `<video controls preload="none" playsinline poster="${e_(media(j.id, (c.thumbs||[])[1] || (c.thumbs||[])[0] || ""))}" data-hl-video="${e_(key(c))}" data-pv="${pv.a}" src="${e_(media(j.id, c.preview))}"></video>` : '<p class="hl-note">미리보기를 못 만들었어요.</p>'}
  <div class="hl-nudge"><div><span class="l">시작</span><button type="button" data-hl-nudge="${e_(key(c))}" data-w="a" data-d="-1" aria-label="시작 1초 앞으로">−1</button><b data-hl-a>${fmt(v.a)}</b><button type="button" data-hl-nudge="${e_(key(c))}" data-w="a" data-d="1" aria-label="시작 1초 뒤로">+1</button></div>
  <div><span class="l">끝</span><button type="button" data-hl-nudge="${e_(key(c))}" data-w="b" data-d="-1" aria-label="끝 1초 앞으로">−1</button><b data-hl-b>${fmt(v.b)}</b><button type="button" data-hl-nudge="${e_(key(c))}" data-w="b" data-d="1" aria-label="끝 1초 뒤로">+1</button></div></div></article>`;
}
function resultCard() {
  const j = S.cur; if (!j || running(j)) return '';
  if (j.status !== 'done') return `<section class="hl-card"><h2>${e_(j.title)}</h2><div class="pl-error" role="alert">${e_(j.error || '끝내지 못했어요.')}</div><div class="hl-row"><button type="button" class="btn primary" data-hl-act="retry">다시 하기</button><button type="button" class="btn ghost" data-hl-act="log">${S.showLog ? '기록 닫기' : '기록 보기'}</button></div>${S.showLog ? `<pre class="hl-log">${e_(j.log || '')}</pre>` : ''}</section>`;
  const list = [...(j.candidates || [])].sort((x, y) => S.sort === 'time' ? x.a - y.a : x.rank - y.rank);
  return `<section class="hl-card"><h2>② 후보 ${list.length}개 <span class="hl-len">${e_(j.title)} · ${fmt(j.duration || 0)}</span></h2>
  <p class="hl-sub">정점이 구간 끝쪽에 오도록 맞췄어요. 영상을 눌러 보고, 시작·끝은 1초씩 옮길 수 있어요. 미리보기에는 앞뒤 2초가 더 들어 있어요.</p>
  ${list.length ? '' : '<p class="hl-note">뚜렷한 장면을 못 찾았어요. 길이나 개수를 바꿔서 다시 찾아 보세요.</p>'}
  <div class="hl-tools"><button type="button" class="filter ${S.sort === 'score' ? 'active' : ''}" data-hl-sort="score">점수 높은 순</button><button type="button" class="filter ${S.sort === 'time' ? 'active' : ''}" data-hl-sort="time">시간 순서</button><span class="sp"></span>
  <button type="button" class="btn ghost" data-hl-act="all">전체 선택</button><button type="button" class="btn ghost" data-hl-act="none">선택 해제</button><button type="button" class="btn ghost" data-hl-act="repick" title="위의 개수·길이로 다시 고르기 (분석은 그대로)">개수·길이 바꿔 다시 고르기</button></div>
  <div class="hl-grid">${list.map(candCard).join('')}</div>
  <div class="hl-act"><button type="button" class="btn primary" data-hl-act="each" data-hl-needs>체크한 것 각각 쇼츠로</button><button type="button" class="btn" data-hl-act="merge" data-hl-needs>체크한 것 하나로 합치기</button><span class="hl-note" data-hl-count>${chosenText()}</span></div>
  ${madeBox()}</section>`;
}
const chosen = () => (S.cur?.candidates || []).filter(c => S.checked[key(c)]);
const chosenText = () => { const n = chosen().length, ch = chanName(chanId()); return `${n}개 골랐어요 · 채널: ${ch}`; };
function madeBox() {
  const m = S.made; if (!m) return '';
  return `<div class="hl-made" role="status">에피소드 ${m.episodes.length}개를 만들었어요. 작업판에서 편집 스타일부터 이어 가세요.<ul>${m.episodes.map(x => `<li>${e_(x.title)} <span class="small">(${e_(x.ranges.join(', '))})</span></li>`).join('')}</ul>${(m.warnings || []).map(w => `<p class="hl-note">${e_(w)}</p>`).join('')}<div class="hl-row" style="margin-top:8px"><button type="button" class="btn primary" data-hl-act="board">작업판으로 가기</button></div></div>`;
}
function offlineCard() {
  if (S.online === null) return '<section class="hl-card"><p class="hl-note">실행기를 확인하는 중…</p></section>';
  if (S.online === false) return '<div class="ya-off pl-error" role="alert"><b>실행기가 꺼져 있어요.</b> 바탕화면 <code>유투브/실행기/실행기 켜기.command</code> 를 더블클릭한 뒤 다시 열어 주세요.</div>';
  if (S.api < NEED_API) return '<div class="ya-off pl-error" role="alert"><b>실행기를 업데이트해야 써요.</b> 저장소를 <code>git pull</code> 한 뒤 <code>runner/설치·업데이트.command</code> 를 더블클릭하세요.</div>';
  return '';
}
function html() { return dead() || S.online === null ? offlineCard() : `<div class="hl-wrap">${startCard()}${progressCard()}${resultCard()}${jobsCard()}</div>`; }
function paint() { const r = document.getElementById('hlRoot'); if (r) r.innerHTML = html(); }
function paintProgress() {
  const j = S.cur, r = document.getElementById('hlRoot'); if (!r || !j) return;
  const q = s => r.querySelector(s), p = Math.round((j.progress || 0) * 100);
  if (!q('[data-hl-progress]')) { paint(); return; }
  q('[data-hl-stage]').textContent = j.stage || '준비 중'; q('[data-hl-pct]').textContent = p + '%'; q('[data-hl-fill]').style.width = p + '%';
  const lb = q('[data-hl-logbox]'); if (lb) { lb.textContent = j.log || ''; lb.scrollTop = lb.scrollHeight; }
}
function paintJobsOnly() { const box = document.querySelector('[data-hl-jobs]'); if (box && !S.busy) { const t = document.createElement('div'); t.innerHTML = jobsCard(); const n = t.querySelector('[data-hl-jobs]'); if (n) box.innerHTML = n.innerHTML; } }

window.ytHighlightPage = function () {
  setTimeout(() => { if (document.getElementById('hlRoot')) { loadAll().then(() => { if (S.cur) prepare(); paint(); schedule(); }); } }, 0);
  return head('하이라이트 찾기', '긴 경기 영상에서 볼 만한 장면을 자동으로 골라, 쇼츠 에피소드로 만들어요.', false)
    + (typeof ytTabs === 'function' ? ytTabs() : '') + `<div id="hlRoot">${html()}</div>`;
};

// ---------- 동작 ----------
async function act(name, el) {
  if (S.busy && name !== 'stop') return;
  const j = S.cur;
  try {
    if (name === 'start' || name === 'retry' || name === 'repick') {
      if (name === 'retry' || (name === 'repick' && j)) {
        S.busy = true; S.err = '';
        await rf(name === 'repick' ? `/hl/${encodeURIComponent(j.id)}/pick` : '/hl/start', name === 'repick' ? { count: S.count, len: S.len } : { url: j.url.startsWith('http') ? j.url : undefined, episode: j.fromEpisode || undefined, count: S.count, len: S.len });
        S.made = null; await loadAll(true);
      } else {
        S.err = ''; if (!S.url.trim() && !S.ep) { S.err = '유튜브 주소를 넣거나, 이미 받은 영상을 골라 주세요.'; paint(); return; }
        S.busy = true; paint(); S.made = null;
        const r = await rf('/hl/start', S.ep && !S.url.trim() ? { episode: S.ep, count: S.count, len: S.len } : { url: S.url.trim(), count: S.count, len: S.len });
        S.curId = r.id; await loadAll(true);
      }
      S.busy = false; if (S.cur) { S.cur.candidates = running(S.cur) ? [] : S.cur.candidates; } prepare(); paint(); schedule();
    } else if (name === 'stop') { if (j) { await rf(`/hl/${encodeURIComponent(j.id)}/stop`, {}); say('멈추는 중이에요.'); } }
    else if (name === 'log') { S.showLog = !S.showLog; paint(); }
    else if (name === 'all' || name === 'none') { for (const c of j.candidates || []) S.checked[key(c)] = name === 'all'; paint(); }
    else if (name === 'each' || name === 'merge') {
      const picks = chosen().map(c => ({ a: ed(c).a, b: ed(c).b, rank: c.rank })); if (!picks.length) { say('먼저 후보를 체크해 주세요.'); return; }
      if (name === 'merge' && picks.length < 2 && !confirm('하나만 체크했어요. 그래도 만들까요?')) return;
      S.busy = true; el && (el.disabled = true);
      const r = await rf(`/hl/${encodeURIComponent(j.id)}/make`, { picks, mode: name, channel: chanId() });
      S.made = r; say(`에피소드 ${r.episodes.length}개를 만들었어요.`); S.busy = false; paint();
      document.querySelector('.hl-made')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
    else if (name === 'board') { if (typeof navigate === 'function') navigate(typeof ytLock === 'string' && ytLock ? ytLock : 'youtube'); }
  } catch (err) { S.busy = false; S.err = err.message; say('하이라이트: ' + err.message); paint(); }
}
document.addEventListener('click', async e => {
  const t = e.target; if (!t.closest) return;
  const a = t.closest('[data-hl-act]'); if (a && document.getElementById('hlRoot')) { act(a.dataset.hlAct, a); return; }
  const o = t.closest('[data-hl-open]'); if (o) { S.curId = o.dataset.hlOpen; S.made = null; S.showLog = false; S.checked = {}; S.edit = {}; S.cur = null; await loadAll(true); prepare(); if (S.cur) { S.count = S.cur.count || S.count; S.len = S.cur.len || S.len; } paint(); schedule(); document.getElementById('hlRoot')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const so = t.closest('[data-hl-sort]'); if (so) { S.sort = so.dataset.hlSort; paint(); return; }
  const n = t.closest('[data-hl-nudge]');
  if (n && S.cur) {
    const c = (S.cur.candidates || []).find(x => key(x) === n.dataset.hlNudge); if (!c) return;
    const v = ed(c), w = n.dataset.w, d = +n.dataset.d, dur = S.cur.duration || 1e9;
    const na = w === 'a' ? v.a + d : v.a, nb = w === 'b' ? v.b + d : v.b;
    if (na < 0 || nb > dur || nb - na < 2) { say('더 못 옮겨요. (최소 2초, 최대 15초)'); return; }
    if (nb - na > 15) { say('한 구간은 15초까지예요.'); return; }
    v.a = na; v.b = nb;
    const card = n.closest('[data-hl-card]');
    card.querySelector('[data-hl-a]').textContent = fmt(v.a); card.querySelector('[data-hl-b]').textContent = fmt(v.b);
    card.querySelector('[data-hl-range]').textContent = `${fmt(v.a)}–${fmt(v.b)}`; card.querySelector('[data-hl-lenlab]').textContent = `${v.b - v.a}초`;
    const vid = card.querySelector('video'); if (vid) { try { vid.currentTime = Math.max(0, (w === 'a' ? v.a : Math.max(v.a, v.b - 3)) - (+vid.dataset.pv || 0)); } catch (_) {} }
  }
});
document.addEventListener('change', e => {
  const t = e.target; if (!t.matches) return;
  if (t.matches('[data-hl-check]')) {
    S.checked[t.dataset.hlCheck] = t.checked; t.closest('[data-hl-card]')?.classList.toggle('sel', t.checked);
    const cnt = document.querySelector('[data-hl-count]'); if (cnt) cnt.textContent = chosenText();
  } else if (t.matches('[data-hl-ep]')) { S.ep = t.value; if (S.ep) { S.url = ''; const u = document.querySelector('[data-hl-url]'); if (u) u.value = ''; } }
});
document.addEventListener('input', e => {
  const t = e.target; if (!t.matches) return;
  if (t.matches('[data-hl-url]')) { S.url = t.value; if (t.value.trim() && S.ep) { S.ep = ''; const s = document.querySelector('[data-hl-ep]'); if (s) s.value = ''; } }
  else if (t.matches('[data-hl-count]')) S.count = Math.max(1, Math.min(30, Math.round(+t.value) || 8));
  else if (t.matches('[data-hl-len]')) { S.len = Math.max(5, Math.min(15, Math.round(+t.value) || 10)); const l = document.querySelector('[data-hl-lenv]'); if (l) l.textContent = S.len + '초'; }
});
// 미리보기: 처음 시작 위치(앞 2초 여유)로 맞추고, 끝에 닿으면 멈춰요
document.addEventListener('play', e => {
  const v = e.target; if (!v.matches || !v.matches('video[data-hl-video]') || !S.cur) return;
  const c = (S.cur.candidates || []).find(x => key(x) === v.dataset.hlVideo); if (!c) return; const w = ed(c), pv = +v.dataset.pv || 0;
  if (v.currentTime < w.a - pv - 0.2 || v.currentTime > w.b - pv) v.currentTime = Math.max(0, w.a - pv);
}, true);
document.addEventListener('timeupdate', e => {
  const v = e.target; if (!v.matches || !v.matches('video[data-hl-video]') || !S.cur) return;
  const c = (S.cur.candidates || []).find(x => key(x) === v.dataset.hlVideo); if (!c) return; const w = ed(c), pv = +v.dataset.pv || 0;
  if (!v.paused && v.currentTime >= w.b - pv) { v.pause(); }
}, true);
})();
