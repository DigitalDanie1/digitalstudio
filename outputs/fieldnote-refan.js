/* FIELDNOTE - YouTube "레퍼런스 분석" 탭 (route: ytRefAnalyze).
   레퍼런스 쇼츠의 후크·컷 리듬·이목 순간·강조·이펙트를 맥 실행기(Claude Code)로 뜯어보고 장면 사진과 함께 보여 줘요.
   분석은 ~/Desktop/유투브/레퍼런스/<영상ID>/ 에 저장되고, 작업판의 스타일 선택에서 고르면 그대로 적용돼요.
   분석 화면(window.ytRefA)은 fieldnote-pipeline.js, 레퍼런스 목록(window.ytRefShorts)은 fieldnote-ytrefs.js 가 만들어요. */
(function () {
if (window.__ytRefAnalyze) return; window.__ytRefAnalyze = 1;
const css = `.ra-wrap{display:grid;gap:16px}
.ra-card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px 18px}
.ra-card h2{margin:0 0 4px;font-size:17px}
.ra-form{display:flex;gap:10px;flex-wrap:wrap;align-items:end;margin-top:10px}
.ra-form label{display:grid;gap:4px;font-size:12px;color:var(--muted);flex:1 1 320px}
.ra-form input{font:inherit;color:var(--text);background:#0f1217;border:1px solid var(--line);border-radius:7px;padding:9px 10px;min-width:0}
.ra-bar{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}
.ra-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px}
.ra-item{border:1px solid var(--line);border-radius:10px;padding:8px;display:grid;gap:6px;min-width:0}
.ra-item.on{border-color:var(--accent,#c9f26b);box-shadow:0 0 0 1px var(--accent,#c9f26b)}
.ra-th{display:block;aspect-ratio:9/16;border-radius:8px;overflow:hidden;background:#0f1217}
.ra-th img{width:100%;height:100%;object-fit:cover;display:block}
.ra-t{font-size:12.5px;font-weight:700;line-height:1.35;word-break:break-word}
.ra-s{font-size:11.5px;color:var(--muted);line-height:1.35;word-break:break-word}
.ra-s.ok{color:#7fd1a0}.ra-s.run{color:#f0b35a}.ra-s.bad{color:var(--red,#ff6b6b)}
.ra-acts{display:flex;gap:8px;flex-wrap:wrap}`;
const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
const chId = () => (typeof ytLock === 'string' && ytLock) || ytTab();
let asked = false;

window.ytRefAnalyzePage = function () {
  const ch = chId(), A = window.ytRefA, refs = typeof window.ytRefShorts === 'function' ? window.ytRefShorts(ch) : [];
  const top = head('YouTube 레퍼런스 분석', '레퍼런스 쇼츠가 어떻게 편집됐는지, 무엇으로 눈을 붙잡는지 먼저 뜯어보고 확인한 뒤 내 쇼츠에 적용해요.', false) + (typeof ytTabs === 'function' ? ytTabs() : '');
  if (runnerApi == null && !asked && typeof runnerRefresh === 'function') { asked = true; runnerRefresh().then(() => render(), () => render()); }
  if (!A) return top + '<div class="empty">작업판 스크립트를 불러오지 못했어요. 새로고침해 주세요.</div>';
  if (!(runnerApi >= 17)) return top + `<div class="ra-card"><p class="pl-error"><b>${runnerApi == null ? '맥 실행기에 연결하는 중이에요…' : runnerApi === 0 ? '맥 실행기가 꺼져 있어요.' : '맥 실행기가 예전 버전이에요.'}</b> ${runnerApi ? '작업판의 <b>실행기 업데이트</b> 또는 <b>실행기 다시 켜기</b>를 눌러 주세요.' : ''}</p></div>`;
  A.poll(ch, refs.map(r => r.id));
  const S = A.RA.st, todo = refs.filter(r => !S[r.id] || S[r.id].status === 'none' || S[r.id].status === 'failed');
  const done = refs.filter(r => (S[r.id] || {}).status === 'done').length, busy = refs.filter(r => /^(running|queued)$/.test((S[r.id] || {}).status)).length;
  const card = r => {
    const s = S[r.id] || {}, on = A.RA.open === r.id;
    const line = s.status === 'done' ? `<div class="ra-s ok">분석 끝 · ${esc(s.name)}</div>` : s.status === 'running' ? `<div class="ra-s run">분석 중… ${esc(s.stage || '')}</div>` : s.status === 'queued' ? '<div class="ra-s run">차례를 기다려요</div>' : s.status === 'failed' ? `<div class="ra-s bad">실패: ${esc(s.error || '')}</div>` : '<div class="ra-s">아직 분석 전</div>';
    const acts = s.status === 'done' ? `<button type="button" class="btn ${on ? '' : 'primary'}" data-ra-open="${esc(r.id)}">${on ? '닫기' : '분석 보기'}</button><button type="button" class="pl-link" data-ra-an="${esc(r.id)}" data-ra-again="1">다시 분석</button>` : /^(running|queued)$/.test(s.status) ? '' : `<button type="button" class="btn primary" data-ra-an="${esc(r.id)}">${s.status === 'failed' ? '다시 분석' : '분석하기'}</button>`;
    return `<div class="ra-item ${on ? 'on' : ''}"><a class="ra-th" href="https://www.youtube.com/shorts/${esc(r.id)}" target="_blank" rel="noopener" title="쇼츠 보기"><img loading="lazy" alt="" src="https://i.ytimg.com/vi/${esc(r.id)}/oar2.jpg"></a><div class="ra-t">${esc(s.status === 'done' ? s.name : r.title || '레퍼런스 쇼츠')}</div><div class="ra-s">${esc(r.from)}</div>${line}<div class="ra-acts">${acts}</div></div>`;
  };
  const open = A.RA.open && refs.some(r => r.id === A.RA.open) ? A.panel(A.RA.open, ch, '', true) : '';
  return top + `<div class="ra-wrap">
<section class="ra-card"><h2>쇼츠 링크로 바로 분석</h2><div class="small">넣은 쇼츠는 <b>썸네일 / 편집 레퍼런스</b> 목록과 작업판 스타일 선택에도 같이 들어가요. 하나에 2~5분, 여러 개면 차례대로 돌아요.</div>
<form class="ra-form" data-ra-form autocomplete="off"><label>쇼츠 링크<input name="url" type="text" placeholder="youtube.com/shorts/ID, youtu.be/ID, watch?v=ID" required></label><button class="btn primary" type="submit">추가하고 분석</button></form></section>
<section class="ra-card"><div class="ra-bar"><div><h2>레퍼런스 ${refs.length}개</h2><div class="small">분석 끝 ${done}개${busy ? ` · 도는 중 ${busy}개` : ''}${todo.length ? ` · 남은 것 ${todo.length}개` : ''}</div></div>${todo.length ? `<button type="button" class="btn" data-ra-all>남은 ${todo.length}개 모두 분석</button>` : ''}</div>
${refs.length ? `<div class="ra-grid">${refs.map(card).join('')}</div>` : '<div class="empty">아직 레퍼런스가 없어요. 위에 쇼츠 링크를 넣어 보세요.</div>'}
${open}</section></div>`;
};

document.addEventListener('submit', e => {
  const f = e.target.closest && e.target.closest('form[data-ra-form]'); if (!f) return; e.preventDefault();
  const ch = chId(), r = window.ytRefAddVideo ? window.ytRefAddVideo(ch, f.elements.url.value) : { error: '레퍼런스 스크립트를 불러오지 못했어요.' };
  if (r.error) { toast(r.error); return; }
  f.reset(); window.ytRefA.start(r.videoId, ch).then(() => toast('분석을 시작했어요. 2~5분 걸려요.'), () => {}); render();
});
document.addEventListener('click', e => {
  if (typeof view === 'undefined' || view !== 'ytRefAnalyze') return;
  const t = e.target.closest('button'); if (!t || !window.ytRefA) return;
  const A = window.ytRefA, ch = chId();
  if (t.dataset.raOpen) { A.RA.open = A.RA.open === t.dataset.raOpen ? '' : t.dataset.raOpen; render(); return; }
  if (t.dataset.raAn) { if (t.dataset.raAgain && !confirm('이 레퍼런스를 다시 분석할까요? (2~5분)')) return; A.start(t.dataset.raAn, ch, t).then(() => toast('분석을 시작했어요.'), () => {}); return; }
  if (t.hasAttribute('data-ra-all')) {
    const S = A.RA.st, ids = (window.ytRefShorts(ch) || []).map(r => r.id).filter(id => !S[id] || S[id].status === 'none' || S[id].status === 'failed');
    t.disabled = true; ids.reduce((p, id) => p.then(() => A.start(id, ch).catch(() => {})), Promise.resolve()).then(() => toast(`${ids.length}개를 차례대로 분석해요.`));
  }
});
})();
