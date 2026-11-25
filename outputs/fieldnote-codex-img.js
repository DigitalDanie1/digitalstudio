// ===== 인스타 그림 만들기 (ChatGPT Codex) — 세 인스타 계정이 같이 쓰는 부품 =====
// 맥 실행기(127.0.0.1:4777)가 이 맥의 Codex 로 그림을 그려 준다. API 키는 쓰지 않는다 (ChatGPT 로그인 그대로).
// 그림체(스타일) = 내가 이미 만든 그림 묶음. 주제(작업)마다 따로 고르고, 계정은 마지막으로 쓴 그림체를 기억한다.
// 이 파일은 화면 조각(panel)과 일 처리(drawAll 등)만 한다. 단계 틀은 fieldnote-pipeline.js 가 만든다.
(() => {
  'use strict';
  const R = () => (typeof RUNNER !== 'undefined' ? RUNNER : 'http://127.0.0.1:4777');
  const LS_STYLES = 'fieldnote-codex-styles-v1';
  const FALLBACK_STYLE = { 'insta-sing': 'otter-c', 'insta-bird': 'saved-bird-싱가포르-하루', 'insta-jury': 'set-carousel-v2', 'insta-krsg': 'set-cute-carousel' };
  // 그림체 → 계정. 여기 없는 그림체는 '<계정 이름> …' 폴더(saved-<계정 이름>-…)면 그 계정 것, 아니면 모든 계정이 같이 써요.
  const STYLE_ACCOUNT = { 'otter-c': 'insta-sing', 'otter-a': 'insta-sing', 'otter-b': 'insta-sing', 'saved-밀키-대만중국어-레퍼런스': 'insta-sing', 'saved-미루-대만생활-레퍼런스': 'insta-sing' };
  const igAccts = () => (typeof IG_ACCOUNTS !== 'undefined' && Array.isArray(IG_ACCOUNTS) ? IG_ACCOUNTS : []);
  const nameSlug = t => String(t).toLowerCase().replace(/[^a-z0-9가-힣]+/g, '-').replace(/^-|-$/g, '');
  function styleAccount(id) {
    if (STYLE_ACCOUNT[id]) return STYLE_ACCOUNT[id];
    const a = igAccts().find(k => k && k.name && String(id).startsWith('saved-' + nameSlug(k.name) + '-'));
    return a ? a.id : '';
  }
  const X = { styles: null, online: null, cached: false, loading: false, jobs: {}, ctx: null, err: '', timer: null, tick: 0, ownUrl: {}, savingStyle: false };
  const e = s => (typeof esc === 'function' ? esc(s) : String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])));
  const emit = () => window.dispatchEvent(new Event('cx-change'));
  const toastMsg = m => { try { toast(m); } catch (_) {} };

  // ----- 실행기 통신 -----
  async function rf(p, body, ms = 6000) {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms);
    try {
      const r = await fetch(R() + p, { signal: ctl.signal, ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || '실행기 오류 ' + r.status), { http: r.status });
      return d;
    } finally { clearTimeout(t); }
  }
  async function loadStyles(force) {
    if (X.loading || (X.styles && X.online && !force)) return;
    X.loading = true;
    try {
      const d = await rf('/img/styles', null, 4000); X.styles = d.styles || []; X.online = true; X.cached = false;
      try { localStorage.setItem(LS_STYLES, JSON.stringify(X.styles)); } catch (_) {}
    } catch (_) {
      X.online = false;
      if (!X.styles) { try { X.styles = JSON.parse(localStorage.getItem(LS_STYLES) || 'null'); X.cached = !!X.styles; } catch (_) { X.styles = null; } }
    } finally { X.loading = false; emit(); }
  }
  async function loadJobs(pid) {
    if (!pid) return;
    try { X.jobs[pid] = (await rf('/img/jobs?projectId=' + encodeURIComponent(pid), null, 4000)).jobs || []; X.online = true; }
    catch (_) { if (!X.jobs[pid]) X.jobs[pid] = []; }
    ensureTimer(); emit();
  }
  const jobsOf = pid => X.jobs[pid] || [];
  const active = pid => jobsOf(pid).some(j => j.status === 'queued' || j.status === 'running');
  function ensureTimer() {
    const pid = X.ctx && X.ctx.projectId;
    if (X.timer || !pid || !active(pid)) return;
    X.timer = setInterval(() => {
      const p = X.ctx && X.ctx.projectId;
      if (!p || !document.getElementById('cxRoot')) { clearInterval(X.timer); X.timer = null; return; }
      if (!active(p)) { clearInterval(X.timer); X.timer = null; loadJobs(p); return; }
      X.tick++;
      if (X.tick % 2 === 0) loadJobs(p); else emit();
    }, 1000);
  }

  // ----- 그림체 -----
  const styleList = account => (X.styles || []).filter(s => { const a = styleAccount(s.id); return !account || !a || a === account; });
  function lastStyleOf(account) { const a = Array.isArray(db.igAccounts) && db.igAccounts.find(k => k && k.id === account); return (a && a.lastStyle) || ''; }
  function styleId(ctx) {
    const list = styleList(ctx.account), ok = id => id && (!list.length || list.some(s => s.id === id));
    const first = [ctx.item.styleId, lastStyleOf(ctx.account), FALLBACK_STYLE[ctx.account]].find(ok);
    return first || (list[0] && list[0].id) || '';
  }
  const styleObj = ctx => styleList(ctx.account).find(s => s.id === styleId(ctx)) || null;
  function setStyle(ctx, id) {
    ctx.item.styleId = id;
    const a = Array.isArray(db.igAccounts) && db.igAccounts.find(k => k && k.id === ctx.account); if (a) a.lastStyle = id;
    ctx.save(); emit();
  }

  // ----- 카드 한 장의 내용 (자동 + 내가 고친 것) -----
  const ov = (ctx, i) => (ctx.item.codexCards && ctx.item.codexCards[i]) || {};
  function cardData(ctx, i) {
    const a = ctx.cards[i] || { scene: '', text: [] }, o = ov(ctx, i);
    const prompt = o.prompt != null ? o.prompt : a.scene;
    const text = o.text != null ? String(o.text).split(/\r?\n/).map(t => t.trim()).filter(Boolean).map(t => ({ role: 'text', text: t })) : (a.text || []).filter(t => t && String(t.text || '').trim());
    return { prompt, text };
  }
  const textLines = (ctx, i) => (ov(ctx, i).text != null ? String(ov(ctx, i).text) : (ctx.cards[i].text || []).map(t => t.text).join('\n'));

  // ----- 그림 고르기/세기 -----
  const cardJobs = (ctx, i) => jobsOf(ctx.projectId).filter(j => j.cardIndex === i);
  const doneJobs = (ctx, i) => cardJobs(ctx, i).filter(j => j.status === 'done' && j.file).sort((a, b) => b.createdAt - a.createdAt);
  const hasOwn = (ctx, i) => !!(ctx.item.codexOwn && ctx.item.codexOwn[i]);
  function chosen(ctx, i) {
    const pick = ctx.item.codexPick && ctx.item.codexPick[i], dj = doneJobs(ctx, i);
    if (pick === 'own' && hasOwn(ctx, i)) return { own: true };
    const byPick = pick && dj.find(j => j.id === pick); if (byPick) return { job: byPick };
    if (dj[0]) return { job: dj[0] };
    return hasOwn(ctx, i) ? { own: true } : null;
  }
  const doneCount = ctx => ctx.cards.reduce((n, _, i) => n + (chosen(ctx, i) ? 1 : 0), 0);
  const imgUrl = (f, thumb) => `${R()}/file?path=${encodeURIComponent(f)}${thumb ? '&thumb=1' : ''}`;
  const latestJob = (ctx, i) => cardJobs(ctx, i).sort((a, b) => b.createdAt - a.createdAt)[0] || null;
  const activeJob = (ctx, i) => cardJobs(ctx, i).find(j => j.status === 'queued' || j.status === 'running') || null;

  // ----- 그리기 -----
  function payload(ctx, i) {
    const d = cardData(ctx, i);
    return { account: ctx.account, projectId: ctx.projectId, cardIndex: i, styleId: styleId(ctx), prompt: d.prompt, text: d.text, lang: ctx.lang, aspect: '4:5' };
  }
  async function generate(ctx, i) {
    if (!styleId(ctx)) { X.err = '먼저 그림체를 골라 주세요.'; emit(); return false; }
    try {
      X.err = ''; setStyle(ctx, styleId(ctx));
      await rf('/img/generate', payload(ctx, i));
      if (ctx.item.codexPick) delete ctx.item.codexPick[i];   // 새로 그리면 새 그림이 자동으로 선택돼요
      return true;
    } catch (err) { X.err = (err.name === 'AbortError' || err.http == null) ? '실행기와 연결이 안 돼요.' : err.message; if (err.http == null) X.online = false; emit(); return false; }
  }
  async function drawAll(ctx) {
    if (!ctx) return;
    const missing = ctx.cards.map((_, i) => i).filter(i => !chosen(ctx, i) && !activeJob(ctx, i));
    let idx = missing;
    if (!missing.length) {
      idx = ctx.cards.map((_, i) => i).filter(i => !activeJob(ctx, i));
      if (!idx.length) return;
      if (!confirm(`이미 그린 그림이 있어요. ${idx.length}장을 전부 새로 그릴까요? (옛 그림은 남아 있어서 다시 고를 수 있어요)`)) return;
    }
    let n = 0; for (const i of idx) { if (await generate(ctx, i)) n++; else break; }
    await loadJobs(ctx.projectId);
    if (n) toastMsg(`Codex에 ${n}장을 맡겼어요. 한 장씩 차례로 그려요 (장당 1~3분).`);
  }
  async function redraw(ctx, i) { if (await generate(ctx, i)) { await loadJobs(ctx.projectId); toastMsg(`${i + 1}번 카드를 다시 맡겼어요.`); } }
  async function cancel(ctx, id) { try { await rf('/img/cancel', { id }); } catch (err) { X.err = err.message; } await loadJobs(ctx.projectId); }

  // ----- 내 그림 올리기 (IndexedDB) -----
  const IDB = 'fieldnote-codex-own';
  const idb = () => new Promise((res, rej) => { const q = indexedDB.open(IDB, 1); q.onupgradeneeded = () => q.result.createObjectStore('own'); q.onsuccess = () => res(q.result); q.onerror = () => rej(q.error); });
  async function idbDo(mode, fn) { const d = await idb(); return new Promise((res, rej) => { const tx = d.transaction('own', mode), r = fn(tx.objectStore('own')); tx.oncomplete = () => res(r ? r.result : undefined); tx.onerror = () => rej(tx.error); }); }
  const ownKey = (ctx, i) => ctx.projectId + ':' + i;
  async function ownBlob(ctx, i) { try { return await idbDo('readonly', s => s.get(ownKey(ctx, i))); } catch (_) { return null; } }
  async function setOwn(ctx, i, file) {
    if (!file || !/^image\//.test(file.type)) { toastMsg('이미지 파일을 골라 주세요.'); return; }
    try {
      await idbDo('readwrite', s => s.put(file, ownKey(ctx, i)));
      const k = ownKey(ctx, i); if (X.ownUrl[k]) URL.revokeObjectURL(X.ownUrl[k]); X.ownUrl[k] = URL.createObjectURL(file);
      ctx.item.codexOwn = { ...(ctx.item.codexOwn || {}), [i]: true }; ctx.item.codexPick = { ...(ctx.item.codexPick || {}), [i]: 'own' };
      ctx.save(); emit(); toastMsg(`${i + 1}번 카드에 내 그림을 넣었어요.`);
    } catch (err) { toastMsg('그림을 저장하지 못했어요: ' + err.message); }
  }
  async function hydrate() {
    const ctx = X.ctx; if (!ctx) return;
    for (const img of document.querySelectorAll('img[data-cx-ownimg]')) {
      const i = +img.dataset.cxOwnimg, k = ownKey(ctx, i);
      if (!X.ownUrl[k]) { const b = await ownBlob(ctx, i); if (b) X.ownUrl[k] = URL.createObjectURL(b); }
      if (X.ownUrl[k]) img.src = X.ownUrl[k];
    }
  }
  // 고른 그림 모음 (PNG 저장·업로드 단계에서 보여 주기)
  function gallery(ctx) {
    X.ctx = ctx; if (!X.jobs[ctx.projectId]) setTimeout(() => loadJobs(ctx.projectId), 0);
    return `<div class="pl-gallery cx-gal">${ctx.cards.map((_, i) => { const c = chosen(ctx, i); return `<figure>${c ? (c.own ? `<img data-cx-ownimg="${i}" alt="${i + 1}번 그림">` : `<img alt="${i + 1}번 그림" src="${e(imgUrl(c.job.file, true))}">`) : '<div class="cx-ph">없음</div>'}<figcaption>${String(i + 1).padStart(2, '0')}</figcaption></figure>`; }).join('')}</div>`;
  }
  // 고른 그림 파일들 (저장·가져오기용)
  async function chosenBlobs(ctx) {
    const out = [];
    for (let i = 0; i < ctx.cards.length; i++) {
      const c = chosen(ctx, i); if (!c) continue;
      let blob = null;
      if (c.own) blob = await ownBlob(ctx, i);
      else { const r = await fetch(imgUrl(c.job.file)); if (r.ok) blob = await r.blob(); }
      if (blob) out.push({ index: i, blob });
    }
    return out;
  }
  const slug = t => String(t || '인스타').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40);
  async function downloadAll(ctx) {
    let items; try { items = await chosenBlobs(ctx); } catch (_) { toastMsg('그림을 가져오지 못했어요. 실행기가 켜져 있나요?'); return 0; }
    for (const it of items) {
      const a = document.createElement('a'), ext = /jpe?g/.test(it.blob.type) ? 'jpg' : /webp/.test(it.blob.type) ? 'webp' : 'png';
      a.href = URL.createObjectURL(it.blob); a.download = `${slug(ctx.title)}-${String(it.index + 1).padStart(2, '0')}.${ext}`;
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      await new Promise(r => setTimeout(r, 350));
    }
    toastMsg(items.length ? `그림 ${items.length}장을 저장했어요.` : '아직 고른 그림이 없어요.');
    return items.length;
  }

  // ----- 새 그림체로 저장 -----
  async function saveAsStyle(ctx, i) {
    const c = chosen(ctx, i); if (!c || !c.job) return;
    const name = (prompt('새 그림체 이름을 정해 주세요', '') || '').trim(); if (!name) return;
    const cur = styleObj(ctx);
    try {
      const d = await rf('/img/styles', { name, desc: cur ? cur.desc : '', refs: [c.job.file, ...(cur ? cur.refs.slice(0, 1) : [])] });
      await loadStyles(true); setStyle(ctx, d.style.id); toastMsg(`"${name}" 그림체로 저장했어요. 다음 주제에서도 고를 수 있어요.`);
    } catch (err) { X.err = '그림체를 저장하지 못했어요: ' + err.message; emit(); }
  }

  // ----- 요청문 (실행기 없이 ChatGPT 앱에서 손으로 할 때) — 실행기 images.mjs 의 buildInstruction 과 같은 문장 -----
  function instruction(ctx, i) {
    const d = cardData(ctx, i), st = styleObj(ctx), ko = ctx.lang !== 'en';
    return [
      'Use your built-in image generation tool exactly ONCE to create ONE image.',
      'The attached reference image(s) define the art style. Match them exactly: the same character designs, line quality, colour palette, shading and lettering style.',
      st && st.desc ? 'Style notes: ' + st.desc : '',
      'Format: portrait 4:5 (Instagram feed, about 1080x1350), full bleed, no watermark, no logo, no signature.',
      'Scene: ' + d.prompt,
      d.text.length ? `Draw ONLY this text in the image, spelled exactly, in ${ko ? 'Korean (Hangul)' : 'English'}, inside speech bubbles / title banners / caption boxes in the same lettering style as the references. Text lines, in order:\n` + d.text.map(t => `- ${t.role}: "${t.text}"`).join('\n') : 'Do not put any text in the image.',
    ].filter(Boolean).join('\n\n');
  }
  function manualText(ctx, i) {
    const st = styleObj(ctx), refs = st ? st.refs : [];
    return `[그림 ${i + 1}/${ctx.cards.length}] ChatGPT 앱의 Codex(또는 새 채팅)에 아래 참고 그림을 첨부하고 붙여 넣으세요.\n참고 그림 파일: ${refs.length ? refs.join(' , ') : '(그림체를 먼저 고르면 파일 이름이 나와요 — 내가 만든 그림 중 같은 그림체 1~3장을 첨부)'}\n\n${instruction(ctx, i)}`;
  }
  async function copyText2(t) { try { await navigator.clipboard.writeText(t); return true; } catch (_) { return typeof copyText === 'function' ? copyText(t) : false; } }
  async function copyOne(ctx, i) { toastMsg((await copyText2(manualText(ctx, i))) ? `${i + 1}번 카드 요청문을 복사했어요.` : '복사가 안 됐어요.'); }
  async function copyEvery(ctx) { toastMsg((await copyText2(ctx.cards.map((_, i) => manualText(ctx, i)).join('\n\n==========\n\n'))) ? '요청문 전체를 복사했어요. 카드 한 장씩 붙여 넣으세요.' : '복사가 안 됐어요.'); }

  // ===== 화면 =====
  const OFF = '<p class="pl-error" role="alert"><b>실행기가 꺼져 있어요.</b> 맥에서 <code>~/Desktop/유투브/실행기/실행기 켜기.command</code> 를 더블클릭하세요. 켜진 창은 닫지 마세요.<br><span class="small">이 맥의 크롬에서만 돼요. "로컬 네트워크 접근"을 물으면 허용을 누르세요. 아래에서 요청문을 복사해 ChatGPT 앱에서 손으로 그려도 돼요.</span></p>';
  const STATUS = { queued: '대기 중', running: '그리는 중', done: '완료', failed: '실패' };
  function statusHtml(ctx, i) {
    const j = activeJob(ctx, i) || latestJob(ctx, i);
    if (!j) return chosen(ctx, i) ? '<span class="cx-st ok">내 그림 사용 중</span>' : '<span class="cx-st">아직 안 그렸어요</span>';
    if (j.status === 'running') return `<span class="cx-st run" data-cx-status="${i}">${STATUS.running} ${Math.max(0, Math.round((Date.now() - j.startedAt) / 1000))}초</span> <button type="button" class="pl-link" data-cx-cancel="${e(j.id)}">멈추기</button>`;
    if (j.status === 'queued') return `<span class="cx-st" data-cx-status="${i}">${STATUS.queued}</span> <button type="button" class="pl-link" data-cx-cancel="${e(j.id)}">빼기</button>`;
    if (j.status === 'failed') return `<span class="cx-st bad" data-cx-status="${i}">실패</span><span class="cx-err">${e(j.error || '')}</span>`;
    return `<span class="cx-st ok" data-cx-status="${i}">완료 ✓</span>`;
  }
  function styleGrid(ctx) {
    const list = styleList(ctx.account), cur = styleId(ctx);
    if (!list.length) return X.online === null ? '<p class="small">그림체를 불러오는 중…</p>' : '<p class="small">그림체 목록을 못 불러왔어요. 실행기를 켜면 내가 만든 그림들이 여기에 나와요.</p>';
    const groups = [...new Set(list.map(s => s.group || '그림체'))];
    const sel = list.find(s => s.id === cur);
    return `<div class="cx-styles" role="radiogroup" aria-label="그림체">${groups.map(g => `<div class="cx-group"><span class="cx-gname">${e(g)}</span><div class="cx-row">${list.filter(s => (s.group || '그림체') === g).map(s => `<button type="button" role="radio" aria-checked="${s.id === cur}" class="cx-style ${s.id === cur ? 'on' : ''}" data-cx-style="${e(s.id)}" title="${e(s.desc || '')}">${X.online && s.refs[0] ? `<img loading="lazy" alt="" src="${e(imgUrl(s.refs[0], true))}">` : '<i class="cx-noimg"></i>'}<span>${e(s.name)}</span></button>`).join('')}</div></div>`).join('')}</div>${sel ? `<p class="small cx-desc"><b>${e(sel.name)}</b> · ${e(sel.desc || '설명 없음')}</p>` : ''}`;
  }
  // 그림 레퍼런스: 이야기·카드가 없어도 인스타 화면 위에 항상 보이는 그림체 모음 (실행기 그림 폴더에서 읽음)
  function refsHtml(account) {
    if (X.styles === null && !X.loading) setTimeout(loadStyles, 0);
    const list = styleList(account), base = lastStyleOf(account) || FALLBACK_STYLE[account] || '';
    const head = `<summary><b>그림 레퍼런스</b> <span class="small">${list.length ? list.length + '개' : ''} · 실행기 그림 폴더(instagram-toon/styles, otter-couple-assets)</span></summary>`;
    let body;
    if (!list.length) body = X.online === null || X.loading ? '<p class="small">그림 레퍼런스를 불러오는 중…</p>' : X.online ? '<p class="small">이 맥 실행기에 그림이 없어요. ~/Documents/Codex/instagram-toon/styles/&lt;이름&gt;/ 폴더에 그림을 넣으면 여기에 나와요.</p>' : '<p class="small">실행기가 꺼져 있어서 그림 레퍼런스를 못 불러왔어요. 맥 실행기를 켜면 나와요.</p>';
    else body = `<div class="cx-refs">${[...list].sort((a, b) => (b.id === base) - (a.id === base)).map(s => { const r = s.refs[0]; return `<figure class="cx-ref ${s.id === base ? 'base' : ''}">${X.online && r ? `<a href="${e(imgUrl(r))}" target="_blank" rel="noopener noreferrer"><img loading="lazy" alt="${e(s.name)}" src="${e(imgUrl(r, true))}"></a>` : '<i class="cx-noimg"></i>'}<figcaption>${s.id === base ? '<em>기본</em> ' : ''}${e(s.name)}${s.refs.length > 1 ? ` <span class="small">· ${s.refs.length}장</span>` : ''}</figcaption></figure>`; }).join('')}</div>${X.online ? '' : '<p class="small">실행기가 꺼져 있어 저장해 둔 목록만 보여요 (그림 미리보기 없음).</p>'}`;
    return `<details class="cx-refbox" open>${head}${body}</details>`;
  }
  function cardHtml(ctx, i) {
    const c = chosen(ctx, i), d = cardData(ctx, i), vers = doneJobs(ctx, i), own = hasOwn(ctx, i), off = X.online === false;
    const preview = c ? (c.own ? `<img data-cx-ownimg="${i}" alt="${i + 1}번 카드 내 그림">` : `<a href="${e(imgUrl(c.job.file))}" target="_blank" rel="noopener noreferrer"><img alt="${i + 1}번 카드 그림" src="${e(imgUrl(c.job.file, true))}"></a>`) : `<div class="cx-ph">${activeJob(ctx, i) ? '…' : '그림 없음'}</div>`;
    const verRow = vers.length + (own ? 1 : 0) > 1 ? `<div class="cx-vers" aria-label="그림 버전">${vers.map((j, k) => `<button type="button" class="cx-ver ${c && c.job && c.job.id === j.id ? 'on' : ''}" data-cx-pick="${i}" data-cx-job="${e(j.id)}" title="${k ? '이전 버전' : '가장 최근'}"><img alt="버전 ${vers.length - k}" src="${e(imgUrl(j.file, true))}"></button>`).join('')}${own ? `<button type="button" class="cx-ver ${c && c.own ? 'on' : ''}" data-cx-pick="${i}" data-cx-job="own"><img data-cx-ownimg="${i}" alt="내 그림"></button>` : ''}</div>` : '';
    return `<article class="cx-card" data-cx-card="${i}">
      <div class="cx-prev">${preview}${verRow}</div>
      <div class="cx-fields">
        <div class="cx-h"><b>${String(i + 1).padStart(2, '0')} / ${ctx.cards.length}</b> <span class="cx-lbl">${e(ctx.cards[i].label || '')}</span> <span class="cx-stwrap">${statusHtml(ctx, i)}</span></div>
        <label class="cx-f"><span>장면 설명 (이대로 Codex에 보내요)</span><textarea data-cx-prompt="${i}" rows="3">${e(d.prompt)}</textarea></label>
        <label class="cx-f"><span>그림 안에 들어갈 글자 (한 줄에 하나)</span><textarea data-cx-text="${i}" rows="2" placeholder="글자 없이 그리려면 비워 두세요">${e(textLines(ctx, i))}</textarea></label>
        <div class="cx-btns"><button type="button" class="pl-nav-btn" data-cx-redraw="${i}" ${off || activeJob(ctx, i) ? 'disabled' : ''}>${c ? '다시 그리기' : '이 카드만 그리기'}</button>
          <label class="pl-nav-btn cx-up">내 그림 올리기<input type="file" accept="image/*" hidden data-cx-file="${i}"></label>
          ${c && c.job ? `<button type="button" class="pl-nav-btn" data-cx-savestyle="${i}" ${X.online ? '' : 'disabled'}>이 그림을 새 스타일로 저장</button>` : ''}
          <button type="button" class="pl-link" data-cx-copy="${i}">요청문 복사</button></div>
      </div></article>`;
  }
  function panel(ctx) {
    if (!ctx) return '<p class="pl-note">먼저 앞 단계를 끝내 주세요.</p>';
    X.ctx = ctx;
    if (X.styles === null && !X.loading) setTimeout(loadStyles, 0);
    if (!X.jobs[ctx.projectId]) setTimeout(() => loadJobs(ctx.projectId), 0); else ensureTimer();
    const off = X.online === false;
    return `<div class="cx" id="cxRoot" data-pid="${e(ctx.projectId)}">
      ${off ? OFF : X.online ? '<p class="small cx-on">✓ 실행기 연결됨 · ChatGPT Codex가 그려요 (API 키 안 써요)</p>' : '<p class="small">실행기 확인 중…</p>'}
      ${X.err ? `<p class="pl-error" role="alert">${e(X.err)}</p>` : ''}
      <h3 class="cx-h3">그림체 · <small>이 주제만의 그림체예요. 마지막으로 쓴 걸 계정이 기억해요.</small></h3>${styleGrid(ctx)}
      <h3 class="cx-h3">카드 ${ctx.cards.length}장</h3><div class="cx-cards">${ctx.cards.map((_, i) => cardHtml(ctx, i)).join('')}</div>
      <details class="pl-peek" ${off ? 'open' : ''}><summary>실행기 없이 손으로 할 때 (ChatGPT 앱)</summary>
        <p class="small">요청문을 복사해 ChatGPT 앱의 Codex(또는 새 채팅)에 붙여 넣고, 같은 그림체의 참고 그림 1~3장을 첨부하세요. 나온 그림은 카드의 "내 그림 올리기"로 넣으면 돼요.${(styleObj(ctx) || {}).refs ? '<br>참고 그림 파일: <code>' + styleObj(ctx).refs.map(e).join('</code> <code>') + '</code>' : ''}</p>
        <button type="button" class="pl-nav-btn" data-cx-copyall>요청문 전체 복사 (카드 ${ctx.cards.length}장)</button></details></div>`;
  }
  function btnLabel(ctx) {
    if (!ctx) return 'Codex로 전체 그리기';
    const n = ctx.cards.length, done = doneCount(ctx), act = ctx.cards.filter((_, i) => activeJob(ctx, i)).length;
    if (act) return `그리는 중… (${done}/${n}장 완료)`;
    if (done >= n) return 'Codex로 전부 다시 그리기';
    return done ? `Codex로 나머지 ${n - done}장 그리기` : 'Codex로 전체 그리기';
  }
  const btnDisabled = ctx => !ctx || X.online === false || !styleId(ctx) || ctx.cards.some((_, i) => activeJob(ctx, i));

  // ===== 이벤트 =====
  let saveT = null;
  document.addEventListener('click', ev => {
    const root = ev.target.closest('#cxRoot'); if (!root || !X.ctx) return;
    const t = ev.target.closest('button'); if (!t) return; const ctx = X.ctx, d = t.dataset;
    if (d.cxStyle) setStyle(ctx, d.cxStyle);
    else if (d.cxRedraw != null && d.cxRedraw !== '') redraw(ctx, +d.cxRedraw);
    else if (d.cxCancel) cancel(ctx, d.cxCancel);
    else if (d.cxPick != null && d.cxPick !== '') { ctx.item.codexPick = { ...(ctx.item.codexPick || {}), [+d.cxPick]: d.cxJob }; ctx.save(); emit(); }
    else if (d.cxSavestyle != null && d.cxSavestyle !== '') saveAsStyle(ctx, +d.cxSavestyle);
    else if (d.cxCopy != null && d.cxCopy !== '') copyOne(ctx, +d.cxCopy);
    else if (t.hasAttribute('data-cx-copyall')) copyEvery(ctx);
  });
  document.addEventListener('input', ev => {
    const t = ev.target; if (!t.closest || !t.closest('#cxRoot') || !X.ctx) return;
    const ctx = X.ctx, k = t.dataset.cxPrompt != null ? ['prompt', +t.dataset.cxPrompt] : t.dataset.cxText != null ? ['text', +t.dataset.cxText] : null; if (!k) return;
    ctx.item.codexCards = ctx.item.codexCards || {}; const o = ctx.item.codexCards[k[1]] = ctx.item.codexCards[k[1]] || {};
    o[k[0]] = t.value; clearTimeout(saveT); saveT = setTimeout(() => ctx.save(), 500);
  });
  document.addEventListener('change', ev => {
    const t = ev.target.closest && ev.target.closest('input[data-cx-file]'); if (t && X.ctx && t.files[0]) setOwn(X.ctx, +t.dataset.cxFile, t.files[0]);
  });
  window.addEventListener('pagehide', () => { if (saveT && X.ctx) X.ctx.save(); });

  // ===== 초안(원고)을 카드로 쪼개기: 인스타 카드뉴스용 =====
  const stripMd = s => String(s || '').replace(/\*\*|__|`/g, '').replace(/^\s*(?:#{1,6}\s+|>\s*|[-*•]\s+)/, '').replace(/\[[^\]]*\]/g, '').trim();
  const CARD_HEAD = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:card|카드|slide|슬라이드)\s*(\d+)\s*(?:\*\*)?\s*(?:[:.)\-–—]\s*)?(?:\*\*)?\s*(.*?)\s*(?:\*\*)?\s*$/i;
  const CAP_HEAD = /^\s*(?:#{1,6}\s*)?(?:\*\*)?\s*(?:caption|캡션|본문 캡션)\s*(?:\*\*)?\s*[:：]?\s*(?:\*\*)?\s*(.*)$/i;
  const TAGS = /^\s*(?:#[^\s#]+\s*){3,}$/;
  function splitDraft(body) {
    const lines = String(body || '').replace(/\r/g, '').split('\n'); const cardsRaw = []; let caption = [], cur = null, inCap = false;
    for (const ln of lines) {
      const cap = CAP_HEAD.exec(ln);
      if (cap && !CARD_HEAD.test(ln)) { inCap = true; if (cap[1]) caption.push(cap[1]); continue; }
      if (inCap) { caption.push(ln); continue; }
      if (TAGS.test(ln)) { caption.push(ln); continue; }
      const h = CARD_HEAD.exec(ln);
      if (h && h[1]) { cur = { n: +h[1], lines: [] }; if (h[2]) cur.lines.push(h[2]); cardsRaw.push(cur); continue; }
      if (cur) cur.lines.push(ln);
    }
    let blocks = cardsRaw.map(c => c.lines.map(stripMd).filter(Boolean));
    if (!blocks.length) { // 카드 표시가 없으면 빈 줄로 나눈 덩어리를 카드로 본다
      const noCap = []; let cp = false;
      for (const ln of lines) { if (cp || (CAP_HEAD.test(ln) && !CARD_HEAD.test(ln))) { cp = true; continue; } if (TAGS.test(ln)) continue; noCap.push(ln); }
      blocks = noCap.join('\n').split(/\n\s*\n/).map(b => b.split('\n').map(stripMd).filter(Boolean)).filter(b => b.length);
    }
    blocks = blocks.filter(b => b.length).slice(0, 12);
    return { cards: blocks.map((b, k) => ({ headline: b[0].slice(0, 90), body: b.slice(1).join(' ').slice(0, 130) })), caption: caption.join('\n').trim() };
  }
  // 계정별 카드 장면 문장 (안전 규칙 포함)
  function postCards(account, lang, title, name, body) {
    const sp = splitDraft(body), N = sp.cards.length;
    const safety = account === 'insta-jury' ? ' Everyone must be anonymous cartoon characters: no real people, no real names, user IDs, usernames or profile photos, no realistic faces, no screenshots of real comments.' : ' Do not depict real, identifiable people or celebrities; use generic illustrated characters.';
    const cards = sp.cards.map((c, k) => ({
      label: c.headline,
      scene: `Card-news slide ${k + 1} of ${N} for the Instagram account "${name}". Whole post topic: ${title}. This slide's message: ${c.headline}${c.body ? ' — ' + c.body : ''}. Illustrate the idea simply and visually in the reference style, leaving clear space for the text.${safety}`,
      text: [{ role: k === 0 ? 'title' : 'headline', text: c.headline }, ...(c.body ? [{ role: 'small body text', text: c.body }] : [])],
    }));
    return { cards, caption: sp.caption };
  }

  const css = document.createElement('style');
  css.textContent = `
.cx{margin:0 0 10px}.cx-on{color:var(--green)}
.cx-h3{font-size:16px;margin:16px 0 8px}.cx-h3 small{font-weight:400;color:var(--muted);font-size:13px}
.cx-refbox{margin:0 0 14px;padding:10px 12px;border:1px solid var(--line);border-radius:12px;background:var(--panel2)}.cx-refbox summary{cursor:pointer;font-size:14px}
.cx-refs{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-top:10px}
.cx-ref{margin:0;display:flex;flex-direction:column;gap:5px;font-size:12px;line-height:1.3}.cx-ref img,.cx-ref .cx-noimg{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px;border:2px solid var(--line);background:#0f1216;display:block}
.cx-ref.base img{border-color:var(--pc)}.cx-ref em{font-style:normal;font-weight:700;color:var(--pc)}.cx-ref figcaption{overflow-wrap:anywhere}
.cx-styles{display:grid;gap:10px;max-height:320px;overflow:auto;padding:4px;border:1px solid var(--line);border-radius:12px;background:var(--panel2)}
.cx-gname{display:block;font-size:12px;color:var(--muted);font-weight:700;margin:2px 2px 6px}
.cx-row{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:8px}
.cx-style{display:flex;flex-direction:column;gap:5px;align-items:stretch;padding:6px;border-radius:10px;border:2px solid var(--line);background:#12151a;color:var(--text);cursor:pointer;text-align:left;font-size:12px;line-height:1.3;min-width:0}
.cx-style img,.cx-noimg{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:6px;background:#0f1216;display:block}
.cx-style span{overflow-wrap:anywhere}.cx-style.on{border-color:var(--pc);background:color-mix(in srgb,var(--pc) 14%,#12151a);font-weight:700}
.cx-style:focus-visible{outline:3px solid var(--pc);outline-offset:2px}
.cx-desc{margin:8px 2px 0;color:#c3c8cf}
.cx-cards{display:grid;gap:12px}.cx-gal img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px;border:1px solid var(--line)}
.cx-card{display:grid;grid-template-columns:150px 1fr;gap:14px;border:1px solid var(--line);border-radius:12px;background:var(--panel2);padding:12px}
.cx-prev img{width:100%;aspect-ratio:4/5;object-fit:cover;border-radius:8px;display:block;background:#0f1216}
.cx-ph{width:100%;aspect-ratio:4/5;border-radius:8px;border:2px dashed var(--line);display:grid;place-items:center;color:var(--muted);font-size:13px}
.cx-vers{display:flex;gap:4px;margin-top:6px;flex-wrap:wrap}.cx-ver{width:34px;padding:0;border:2px solid var(--line);border-radius:6px;background:none;cursor:pointer;overflow:hidden}.cx-ver.on{border-color:var(--pc)}.cx-ver img{aspect-ratio:4/5;border-radius:0}
.cx-h{display:flex;gap:8px;align-items:center;flex-wrap:wrap;font-size:14px;margin-bottom:6px}.cx-lbl{color:var(--muted);flex:1 1 120px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cx-st{font-size:12px;font-weight:700;border:1px solid var(--line);border-radius:99px;padding:2px 9px;color:var(--muted)}.cx-st.run{color:var(--orange);border-color:var(--orange)}.cx-st.ok{color:var(--green);border-color:var(--green)}.cx-st.bad{color:#ffb4b4;border-color:#6b3237}
.cx-err{display:block;font-size:12px;color:#ffb4b4;margin-top:4px;overflow-wrap:anywhere}
.cx-f{display:grid;gap:4px;margin:0 0 8px;font-size:12px;color:var(--muted)}.cx-f textarea{width:100%;font-size:14px;line-height:1.5;border-radius:8px;border:1px solid var(--line);background:#0f1216;color:var(--text);padding:8px 10px;resize:vertical;font-family:inherit}
.cx-btns{display:flex;gap:8px;flex-wrap:wrap;align-items:center}.cx-btns .pl-nav-btn{min-height:38px;padding:0 12px;font-size:14px;display:inline-flex;align-items:center}.cx-up{cursor:pointer}
@media(max-width:620px){.cx-card{grid-template-columns:1fr}.cx-prev{max-width:200px}}`;
  document.head.append(css);

  window.CodexImg = { panel, gallery, refsHtml, btnLabel, btnDisabled, drawAll, doneCount, downloadAll, chosenBlobs, hydrate, splitDraft, postCards, loadStyles, loadJobs, copyEvery, state: X, instruction };
})();
