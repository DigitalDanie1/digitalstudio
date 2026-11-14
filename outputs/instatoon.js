(function () {
  'use strict';

  const ACTIVE_KEY = 'fieldnote-insta-toon-active';
  const state = { activeId: '', busy: false, saveTimer: null, note: '' };
  try { state.activeId = localStorage.getItem(ACTIVE_KEY) || ''; } catch (_) {}

  const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));

  function list() {
    if (!Array.isArray(db.instaToons)) db.instaToons = [];
    return db.instaToons;
  }

  function current() {
    return list().find(project => project.id === state.activeId) || null;
  }

  function remember(id) {
    state.activeId = id;
    try { localStorage.setItem(ACTIVE_KEY, id); } catch (_) {}
  }

  function makeProject() {
    const project = {
      id: uid(), title: '', raw: '', stage: 'story', cards: [], generation: '',
      approvedAt: 0, updatedAt: Date.now()
    };
    list().unshift(project);
    remember(project.id);
    return project;
  }

  function flush() {
    clearTimeout(state.saveTimer);
    state.saveTimer = null;
    persist();
    const status = document.querySelector('#itSave');
    if (status) status.textContent = '저장됨';
  }

  function scheduleSave(project) {
    project.updatedAt = Date.now();
    const status = document.querySelector('#itSave');
    if (status) status.textContent = '저장 중…';
    clearTimeout(state.saveTimer);
    state.saveTimer = setTimeout(flush, 500);
  }

  function progress(stage) {
    const steps = [['story', '원본 이야기'], ['cards', '카드 문구'], ['art', '그림 작업']];
    return `<div class="it-progress" aria-label="제작 순서">${steps.map(([key, label]) =>
      key === stage ? `<strong>${label}</strong>` : `<span>${label}</span>`).join('')}</div>`;
  }

  function header(stage) {
    return `<header class="it-head">
      <img class="it-logo" src="./assets/singbubu-logo.png" alt="싱부부의 외노자 일기 수달 부부 로고">
      <div><span class="it-kicker">INSTAGRAM COMIC</span><h1>싱부부의 외노자 일기</h1>
      <p>싱가포르에서 둘이 겪은 일을 한 장면씩.</p></div>${progress(stage)}
    </header>`;
  }

  function history() {
    const projects = list().filter(project => project.raw.trim());
    const posts = db.posts.filter(post => post.channel === 'insta');
    if (!projects.length && !posts.length) return '';
    return `<details class="it-existing"><summary>지난 이야기 ${projects.length + posts.length}개</summary><div class="it-existing-list">
      ${projects.map(project => `<button type="button" data-it="open" data-id="${safe(project.id)}">${safe(project.title || project.raw.slice(0, 38) || '제목 없는 이야기')}<small>${project.stage === 'art' ? '그림 작업' : project.stage === 'cards' ? '카드 문구' : '원본 이야기'}</small></button>`).join('')}
      ${posts.map(post => `<button type="button" data-edit="${safe(post.id)}">${safe(post.title)}<small>기존 인스타 원고</small></button>`).join('')}
    </div></details>`;
  }

  function storyPage(project) {
    return `${header('story')}
      <div class="it-topline"><h2>원본 이야기</h2>${project ? '<button type="button" class="it-button it-button-quiet" data-it="new">새 이야기</button>' : ''}</div>
      <div class="it-story">
        <label class="it-field"><span>제목</span><input id="itTitle" data-it-field="title" maxlength="120" placeholder="예: 퇴근길에 쇼피를 켰다가" value="${safe(project?.title || '')}"></label>
        <label class="it-field"><span>겪은 일을 순서대로 적어주세요</span><textarea id="itStory" data-it-field="raw" maxlength="12000" placeholder="오늘 무슨 일이 있었는지, 누가 무슨 말을 했는지, 마지막에 어떤 기분이 들었는지 편하게 적어주세요.">${safe(project?.raw || '')}</textarea></label>
        <div class="it-story-bottom"><span class="it-status" id="itSave">${safe(state.note || (project?.cards?.length ? '기존 카드는 유지됩니다.' : ''))}</span>
        <div class="it-topline it-actions" style="margin:0">${project?.cards?.length ? '<button type="button" class="it-button it-button-quiet" data-it="existing">기존 카드 보기</button>' : ''}<button type="button" class="it-button it-button-primary" data-it="generate" ${state.busy ? 'disabled' : ''}>${state.busy ? '초안 만드는 중…' : '인스타툰 초안 만들기'}</button></div></div>
      </div>${history()}`;
  }

  function cardMarkup(card, index) {
    const number = String(index + 1).padStart(2, '0');
    return `<article class="it-slide-wrap" data-card-id="${safe(card.id)}">
      <div class="it-slide-meta"><span>PAGE ${number}</span><button type="button" class="it-icon" title="이 카드 삭제" aria-label="${index + 1}번째 카드 삭제" data-it="delete-card" data-id="${safe(card.id)}">×</button></div>
      <div class="it-slide">
        <textarea class="it-slide-top" aria-label="${index + 1}번째 카드 상단 문장" data-it-card="${safe(card.id)}" data-it-field="top" placeholder="상단 문장">${safe(card.top)}</textarea>
        <textarea class="it-slide-scene" aria-label="${index + 1}번째 카드 그림 장면" data-it-card="${safe(card.id)}" data-it-field="scene" placeholder="그림으로 보여줄 장면">${safe(card.scene)}</textarea>
        <textarea class="it-slide-bubble" aria-label="${index + 1}번째 카드 대사" data-it-card="${safe(card.id)}" data-it-field="dialogue" placeholder="말풍선 대사">${safe(card.dialogue)}</textarea>
        <textarea class="it-slide-bottom" aria-label="${index + 1}번째 카드 하단 문장" data-it-card="${safe(card.id)}" data-it-field="bottom" placeholder="하단 문장">${safe(card.bottom)}</textarea>
      </div>
      <textarea class="it-slide-note" aria-label="${index + 1}번째 카드 그림 메모" data-it-card="${safe(card.id)}" data-it-field="artNote" placeholder="그림 메모 · 구도, 소품, 표정">${safe(card.artNote)}</textarea>
    </article>`;
  }

  function cardsPage(project) {
    return `${header('cards')}
      <div class="it-topline"><input class="it-title-input" aria-label="이번 편 제목" data-it-field="title" value="${safe(project.title)}" placeholder="이번 편 제목">
      <div class="it-actions"><button type="button" class="it-button it-button-quiet" data-it="source">원문 수정</button><button type="button" class="it-button it-icon" data-it="add-card" title="카드 추가" aria-label="카드 추가">＋</button><button type="button" class="it-button it-button-primary" data-it="approve">다 오케이, 그림 작업</button></div></div>
      <div class="it-board"><div class="it-grid">${project.cards.map(cardMarkup).join('')}</div></div>
      <p class="it-status" id="itSave">${safe(state.note || project.generation || '')}</p>`;
  }

  function artBrief(project, card, index) {
    return `싱부부의 외노자 일기 · ${project.title || '이번 편'} · ${index + 1}/${project.cards.length}\n` + flowPrompt(card);
  }

  function flowPrompt(card) {
    return [
      '첨부한 기준 이미지의 수달 부부 캐릭터(생김새·색·옷)를 그대로 유지해서 그려줘.',
      '스타일: 귀여운 한국 인스타툰, 부드러운 선, 따뜻한 파스텔 색, 깔끔한 배경. 배경은 싱가포르 생활.',
      '비율: 가로 4:3 한 컷.',
      `장면: ${card.scene || card.top || '(장면을 적어주세요)'}`,
      card.artNote ? `표정·소품·구도: ${card.artNote}` : '',
      card.dialogue ? `상황(이 대사를 하는 순간의 표정으로): "${card.dialogue}"` : '',
      '그림 안에 글자·말풍선·로고·워터마크는 넣지 마. 아래쪽 1/4은 말풍선을 얹을 수 있게 단순하게 비워줘.'
    ].filter(Boolean).join('\n');
  }

  function artPage(project) {
    const done = project.cards.filter(card => imgCache.get(imgKey(project, card))).length;
    return `${header('art')}
      <div class="it-topline"><h2>${safe(project.title || '이번 편')} · 그림 작업</h2>
      <div class="it-actions"><button type="button" class="it-button it-button-quiet" data-it="edit-cards">카드 수정</button><button type="button" class="it-button it-button-quiet" data-it="copy-brief">요청서 전체 복사</button><button type="button" class="it-button it-button-primary" data-it="save-all">전체 PNG 저장</button></div></div>
      <div class="it-free">
        <img src="./assets/singbubu-logo.png" alt="수달 부부 캐릭터 기준 이미지">
        <div><strong>무료로 그림 만들기</strong>
        <ol>
          <li><a class="it-link" href="./assets/singbubu-logo.png" download="싱부부-기준이미지.png">기준 이미지 저장</a> — 매번 같은 수달 부부로 나오게 하는 사진</li>
          <li><a class="it-link" href="${FLOW_URL}" target="_blank" rel="noopener noreferrer">구글 Flow 열기 ↗</a> — 무료 나노바나나. 기준 이미지를 첨부하고, 카드의 <b>Flow 프롬프트 복사</b>를 붙여 넣어 생성</li>
          <li>마음에 드는 그림을 아래 카드 칸에 <b>끌어다 놓기</b> (클릭해서 고르기 · 칸을 누르고 ⌘V 붙여넣기도 됨)</li>
          <li>대사·문장은 자동으로 얹혀요 → <b>PNG 저장</b> → 인스타 업로드 때 'AI 정보' 표시 켜기</li>
        </ol>
        <p class="it-muted">그림은 이 브라우저에만 저장됩니다 · <span id="itArtCount">${done}</span>/${project.cards.length}장 완료</p></div>
      </div>
      <div class="it-art-grid">${project.cards.map((card, index) => `<article class="it-art-card" data-card-id="${safe(card.id)}">
        <h3>${String(index + 1).padStart(2, '0')} / ${project.cards.length}</h3>
        <div class="it-art-drop" data-it-drop="${safe(card.id)}" tabindex="0" role="button" aria-label="${index + 1}번째 카드 그림 올리기">
          <canvas class="it-art-canvas" data-it-canvas="${safe(card.id)}" width="540" height="540"></canvas>
          <span class="it-drop-hint">그림 바꾸기 · 끌어다 놓거나 클릭</span>
          <input type="file" accept="image/*" hidden data-it-file="${safe(card.id)}">
        </div>
        <div class="it-art-buttons"><button type="button" class="it-button" data-it="copy-prompt" data-id="${safe(card.id)}">Flow 프롬프트 복사</button><button type="button" class="it-button" data-it="save-png" data-id="${safe(card.id)}">PNG 저장</button><button type="button" class="it-button it-button-quiet" data-it="remove-img" data-id="${safe(card.id)}">그림 빼기</button></div>
        <p><strong>장면</strong> ${safe(card.scene || card.top)}</p><p><strong>대사</strong> ${safe(card.dialogue || '—')}</p>
        <label class="it-field"><span>그림 메모 (프롬프트에 들어가요)</span><textarea data-it-card="${safe(card.id)}" data-it-field="artNote">${safe(card.artNote)}</textarea></label>
      </article>`).join('')}</div>`;
  }

  // ===== 무료 그림 작업: 그림 보관(IndexedDB) + 글자·말풍선 합성 =====
  const FLOW_URL = 'https://labs.google/fx/tools/flow';
  const IMG_DB = 'fieldnote-instatoon-art', IMG_STORE = 'images';
  const imgCache = new Map();
  const imgKey = (project, card) => project.id + ':' + card.id;
  function idb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IMG_DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(IMG_STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbDo(mode, fn) {
    const store = await idb();
    return new Promise((resolve, reject) => {
      const tx = store.transaction(IMG_STORE, mode), req = fn(tx.objectStore(IMG_STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
    });
  }
  function blobToImage(blob) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(blob), image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => { URL.revokeObjectURL(url); reject(Error('이미지를 읽지 못했습니다.')); };
      image.src = url;
    });
  }
  async function loadImg(key) {
    if (imgCache.has(key)) return imgCache.get(key);
    let image = null;
    try { const blob = await idbDo('readonly', st => st.get(key)); if (blob) image = await blobToImage(blob); } catch (_) {}
    imgCache.set(key, image);
    return image;
  }
  async function shrink(file) {
    const image = await blobToImage(file);
    const scale = Math.min(1, 1800 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.naturalWidth * scale); canvas.height = Math.round(image.naturalHeight * scale);
    canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
    URL.revokeObjectURL(image.src);
    return new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  }
  async function setCardImage(cardId, file) {
    const project = current(), card = project && project.cards.find(item => item.id === cardId);
    if (!card || !file || !/^image\//.test(file.type)) { toast('이미지 파일을 올려주세요.'); return; }
    try {
      const blob = await shrink(file), key = imgKey(project, card);
      await idbDo('readwrite', st => st.put(blob, key));
      const old = imgCache.get(key); if (old) URL.revokeObjectURL(old.src);
      imgCache.set(key, await blobToImage(blob));
      hydrateArt(); toast('그림을 넣었어요.');
    } catch (error) { toast('그림을 저장하지 못했어요: ' + error.message); }
  }
  async function removeCardImage(cardId) {
    const project = current(), card = project && project.cards.find(item => item.id === cardId);
    if (!card) return;
    const key = imgKey(project, card);
    try { await idbDo('readwrite', st => st.delete(key)); } catch (_) {}
    const old = imgCache.get(key); if (old) URL.revokeObjectURL(old.src);
    imgCache.set(key, null); hydrateArt();
  }

  const FONT = '"Pretendard","Apple SD Gothic Neo","Noto Sans KR","Malgun Gothic",sans-serif';
  function wrapLines(ctx, text, maxWidth) {
    const fits = t => ctx.measureText(t).width <= maxWidth, lines = [];
    for (const para of String(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/).filter(Boolean)) {
        const next = line ? line + ' ' + word : word;
        if (fits(next)) { line = next; continue; }
        if (line) lines.push(line);
        line = '';
        if (fits(word)) { line = word; continue; }
        for (const ch of word) { if (line && !fits(line + ch)) { lines.push(line); line = ''; } line += ch; }
      }
      if (line) lines.push(line);
    }
    return lines;
  }
  function fitText(ctx, text, maxWidth, maxHeight, size, weight) {
    for (let px = size; px >= 22; px -= 2) {
      ctx.font = `${weight} ${px}px ${FONT}`;
      const lines = wrapLines(ctx, text, maxWidth), lh = px * 1.32;
      if (lines.length * lh <= maxHeight) return { lines, px, lh };
    }
    ctx.font = `${weight} 22px ${FONT}`;
    return { lines: wrapLines(ctx, text, maxWidth), px: 22, lh: 29 };
  }
  function drawLines(ctx, fit, cx, top, color) {
    ctx.fillStyle = color; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    fit.lines.forEach((line, i) => ctx.fillText(line, cx, top + i * fit.lh));
  }
  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function compose(canvas, card, image) {
    const W = 1080; canvas.width = W; canvas.height = W;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fffdfa'; ctx.fillRect(0, 0, W, W);
    const top = (card.top || '').trim(), bottom = (card.bottom || '').trim(), talk = (card.dialogue || '').trim();
    const fx = 0.06 * W, fw = 0.88 * W, fy = top ? 0.2 * W : 0.06 * W, fb = bottom ? 0.83 * W : 0.94 * W, fh = fb - fy;
    ctx.save(); roundRect(ctx, fx, fy, fw, fh, 26); ctx.clip();
    if (image) {
      const s = Math.max(fw / image.naturalWidth, fh / image.naturalHeight), w = image.naturalWidth * s, h = image.naturalHeight * s;
      ctx.drawImage(image, fx + (fw - w) / 2, fy + (fh - h) / 2, w, h);
    } else {
      ctx.fillStyle = '#f1ece6'; ctx.fillRect(fx, fy, fw, fh);
      ctx.font = `600 40px ${FONT}`; ctx.fillStyle = '#a39a92'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('그림을 끌어다 놓으세요', W / 2, fy + fh / 2);
    }
    ctx.restore();
    ctx.lineWidth = 5; ctx.strokeStyle = '#36312e'; roundRect(ctx, fx, fy, fw, fh, 26); ctx.stroke();
    if (top) { const f = fitText(ctx, top, 0.86 * W, fy - 0.07 * W, 56, 800); drawLines(ctx, f, W / 2, (fy - f.lines.length * f.lh) / 2 + 4, '#26211e'); }
    if (bottom) { const room = W - fb - 0.05 * W, f = fitText(ctx, bottom, 0.86 * W, room, 42, 600); drawLines(ctx, f, W / 2, fb + (W - fb - f.lines.length * f.lh) / 2, '#5f5954'); }
    if (talk) {
      const f = fitText(ctx, talk, 0.64 * W, 0.2 * W, 54, 800);
      const textW = Math.max(...f.lines.map(line => ctx.measureText(line).width));
      const bw = Math.min(0.8 * W, textW + 0.09 * W), bh = f.lines.length * f.lh + 0.06 * W;
      const bx = (W - bw) / 2, by = fb - bh - 0.045 * W, tx = bx + bw * 0.32;
      ctx.fillStyle = '#ffffff'; ctx.strokeStyle = '#36312e'; ctx.lineWidth = 5;
      roundRect(ctx, bx, by, bw, bh, 40); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(tx - 22, by + 3); ctx.lineTo(tx - 6, by - 38); ctx.lineTo(tx + 24, by + 3); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(tx - 22, by + 1); ctx.lineTo(tx - 6, by - 38); ctx.lineTo(tx + 24, by + 1); ctx.stroke();
      drawLines(ctx, f, W / 2, by + 0.03 * W + 2, '#26211e');
    }
  }
  async function hydrateArt() {
    const project = current();
    if (!project || project.stage !== 'art') return;
    let done = 0;
    for (const card of project.cards) {
      const canvas = document.querySelector(`canvas[data-it-canvas="${CSS.escape(card.id)}"]`);
      const image = await loadImg(imgKey(project, card));
      if (image) done++;
      if (!canvas) continue;
      compose(canvas, card, image);
      canvas.closest('.it-art-drop')?.classList.toggle('has-img', !!image);
    }
    const count = document.querySelector('#itArtCount'); if (count) count.textContent = done;
  }
  function slug(text) { return String(text || '이번편').replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 40); }
  async function savePng(card, index) {
    const project = current(), image = await loadImg(imgKey(project, card));
    if (!image) { toast(`${index + 1}번째 카드에 그림이 없어요.`); return false; }
    const canvas = document.createElement('canvas'); compose(canvas, card, image);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
    a.download = `싱부부-${slug(project.title)}-${String(index + 1).padStart(2, '0')}.png`;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return true;
  }
  async function saveAll() {
    const project = current(); let n = 0;
    for (const [index, card] of project.cards.entries()) {
      if (!(await loadImg(imgKey(project, card)))) continue;
      await savePng(card, index); n++; await new Promise(r => setTimeout(r, 350));
    }
    toast(n ? `PNG ${n}장을 저장했어요.` : '아직 그림을 넣은 카드가 없어요.');
  }

  function page() {
    const project = current();
    const stage = project?.stage || 'story';
    if (stage === 'art') setTimeout(hydrateArt, 0);
    return `<section class="it" aria-label="싱부부 인스타툰 작업대">${stage === 'art' ? artPage(project) : stage === 'cards' ? cardsPage(project) : storyPage(project)}</section>`;
  }

  function storyParts(raw) {
    const paragraphs = raw.replace(/\r/g, '').split(/\n+/).map(x => x.trim()).filter(Boolean);
    return paragraphs.flatMap(paragraph => paragraph.split(/(?<=[.!?。！？])\s+/u).map(x => x.trim()).filter(Boolean));
  }

  function localCards(raw, title) {
    const parts = storyParts(raw);
    const count = Math.min(16, Math.max(4, parts.length + 1));
    const buckets = Array.from({ length: count - 1 }, () => []);
    parts.forEach((part, index) => buckets[Math.min(count - 2, Math.floor(index * (count - 1) / parts.length))].push(part));
    return Array.from({ length: count }, (_, index) => ({
      id: uid(), top: index === 0 ? title : '',
      scene: index === 0 ? '' : buckets[index - 1].join(' '),
      dialogue: '', bottom: '', artNote: ''
    }));
  }

  function normalizedCards(cards) {
    if (!Array.isArray(cards) || cards.length < 4 || cards.length > 16) throw Error('카드 수가 맞지 않습니다.');
    return cards.map(card => ({
      id: uid(), top: String(card.top || '').slice(0, 180),
      scene: String(card.scene || '').slice(0, 500),
      dialogue: String(card.dialogue || '').slice(0, 180),
      bottom: String(card.bottom || '').slice(0, 180),
      artNote: String(card.artNote || '').slice(0, 500)
    }));
  }

  async function generateCards() {
    const project = current();
    if (!project || project.raw.trim().length < 12) { toast('이야기를 조금 더 적어주세요.'); return; }
    if (project.cards.length && !confirm('기존 카드 수정 내용이 새 초안으로 바뀝니다. 계속할까요?')) return;
    state.busy = true;
    state.note = '';
    render();
    let cards;
    let generation = 'AI가 다듬은 카드 초안';
    try {
      const response = await fetch('/api/generate/comic', {
        method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: project.title, story: project.raw })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw Error(result.message || 'AI 연결을 확인하지 못했습니다.');
      cards = normalizedCards(result.cards);
      if (result.title && !project.title.trim()) project.title = result.title.slice(0, 120);
    } catch (error) {
      cards = localCards(project.raw, project.title || '우리의 하루');
      generation = 'AI 연결 없이 원문을 나눈 초안 · 문장을 직접 다듬어주세요';
      state.note = generation;
    }
    project.cards = cards;
    project.stage = 'cards';
    project.generation = generation;
    project.approvedAt = 0;
    state.busy = false;
    flush();
    render();
    window.scrollTo(0, 0);
  }

  function approve() {
    const project = current();
    const missing = project.cards.findIndex(card => !card.top.trim() && !card.scene.trim() && !card.dialogue.trim() && !card.bottom.trim());
    if (missing >= 0) { toast(`${missing + 1}번째 카드가 비어 있습니다.`); return; }
    project.stage = 'art';
    project.approvedAt = Date.now();
    state.note = '';
    flush();
    render();
    window.scrollTo(0, 0);
  }

  async function copyBrief() {
    const project = current();
    const brief = project.cards.map((card, index) => artBrief(project, card, index)).join('\n\n');
    try { await navigator.clipboard.writeText(brief); toast('그림 요청서를 복사했습니다.'); }
    catch (_) { toast('복사할 수 없습니다. 브라우저 클립보드 권한을 확인하세요.'); }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const originalPlatformPage = platformPage;
    platformPage = function (channel) {
      if (channel !== 'insta') return originalPlatformPage(channel);
      // 주제 목록(상단 소개 + 주제 보드) → 만화 작업대 → 원고·프로그램
      const base = originalPlatformPage(channel), cut = base.indexOf('<section class="pf-section"');
      return cut < 0 ? base + page() : base.slice(0, cut) + page() + base.slice(cut);
    };
    if (view === 'insta' && !editing) render();
  });

  document.addEventListener('input', event => {
    const target = event.target;
    if (!target.closest('.it')) return;
    const field = target.dataset.itField;
    if (!field) return;
    let project = current();
    if (!project) project = makeProject();
    if (target.dataset.itCard) {
      const card = project.cards.find(item => item.id === target.dataset.itCard);
      if (!card) return;
      card[field] = target.value;
      if (field !== 'artNote') project.approvedAt = 0;
    } else {
      project[field] = target.value;
      if (field === 'raw' && project.cards.length) project.approvedAt = 0;
    }
    scheduleSave(project);
  });

  document.addEventListener('click', event => {
    const button = event.target.closest('.it button[data-it]');
    if (!button) return;
    const project = current();
    switch (button.dataset.it) {
      case 'new': flush(); remember(''); state.note = ''; render(); break;
      case 'open': flush(); remember(button.dataset.id); state.note = ''; render(); break;
      case 'source': project.stage = 'story'; flush(); render(); break;
      case 'existing': project.stage = 'cards'; flush(); render(); break;
      case 'generate': generateCards(); break;
      case 'add-card':
        if (project.cards.length >= 16) { toast('최대 16장까지 만들 수 있습니다.'); break; }
        project.cards.push({ id: uid(), top: '', scene: '', dialogue: '', bottom: '', artNote: '' });
        project.approvedAt = 0; flush(); render(); break;
      case 'delete-card':
        if (project.cards.length <= 1) { toast('카드는 한 장 이상 필요합니다.'); break; }
        project.cards = project.cards.filter(card => card.id !== button.dataset.id);
        project.approvedAt = 0; flush(); render(); break;
      case 'approve': approve(); break;
      case 'edit-cards': project.stage = 'cards'; flush(); render(); break;
      case 'copy-brief': copyBrief(); break;
      case 'copy-prompt': {
        const card = project.cards.find(item => item.id === button.dataset.id);
        navigator.clipboard.writeText(flowPrompt(card)).then(() => toast('Flow 프롬프트를 복사했어요. 기준 이미지와 함께 붙여 넣으세요.'), () => toast('복사하지 못했어요.'));
        break;
      }
      case 'save-png': { const index = project.cards.findIndex(item => item.id === button.dataset.id); savePng(project.cards[index], index); break; }
      case 'save-all': saveAll(); break;
      case 'remove-img': removeCardImage(button.dataset.id); break;
    }
  });

  document.addEventListener('click', event => {
    const drop = event.target.closest('.it-art-drop');
    if (drop && !event.target.closest('input')) drop.querySelector('input[type=file]')?.click();
  });
  document.addEventListener('keydown', event => {
    const drop = event.target.closest && event.target.closest('.it-art-drop');
    if (drop && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); drop.querySelector('input[type=file]')?.click(); }
  });
  document.addEventListener('change', event => {
    const input = event.target.closest('input[data-it-file]');
    if (input && input.files[0]) setCardImage(input.dataset.itFile, input.files[0]);
  });
  document.addEventListener('dragover', event => {
    const drop = event.target.closest && event.target.closest('.it-art-drop');
    if (!drop) return; event.preventDefault(); drop.classList.add('is-over');
  });
  document.addEventListener('dragleave', event => {
    const drop = event.target.closest && event.target.closest('.it-art-drop'); if (drop) drop.classList.remove('is-over');
  });
  document.addEventListener('drop', event => {
    const drop = event.target.closest && event.target.closest('.it-art-drop');
    if (!drop) return; event.preventDefault(); drop.classList.remove('is-over');
    const file = [...(event.dataTransfer?.files || [])].find(f => /^image\//.test(f.type));
    if (file) setCardImage(drop.dataset.itDrop, file); else toast('이미지 파일을 끌어다 놓아 주세요.');
  });
  document.addEventListener('paste', event => {
    const drop = document.activeElement && document.activeElement.closest && document.activeElement.closest('.it-art-drop');
    if (!drop) return;
    const file = [...(event.clipboardData?.files || [])].find(f => /^image\//.test(f.type));
    if (file) { event.preventDefault(); setCardImage(drop.dataset.itDrop, file); }
  });

  window.addEventListener('pagehide', () => {
    if (state.saveTimer) flush();
  });
})();
