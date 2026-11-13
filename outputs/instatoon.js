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
    return `싱부부의 외노자 일기 · ${project.title || '이번 편'} · ${index + 1}/${project.cards.length}\n` +
      `정사각형 인스타툰. 첨부한 수달 부부 캐릭터의 형태와 표정을 일관되게 유지. 싱가포르 생활 배경.\n` +
      `장면: ${card.scene || card.top || '(장면을 적어주세요)'}\n` +
      `표정·소품·구도: ${card.artNote || '(그림 메모 없음)'}\n` +
      `텍스트는 그림에 그리지 말고 비워두기. 편집 단계에서 얹을 문구: ${[card.top, card.dialogue, card.bottom].filter(Boolean).join(' / ') || '(없음)'}`;
  }

  function artPage(project) {
    return `${header('art')}
      <div class="it-topline"><h2>${safe(project.title || '이번 편')} · 그림 작업</h2>
      <div class="it-actions"><button type="button" class="it-button it-button-quiet" data-it="edit-cards">카드 수정</button><button type="button" class="it-button it-button-primary" data-it="copy-brief">그림 요청서 복사</button></div></div>
      <div class="it-art-intro"><img src="./assets/singbubu-logo.png" alt="수달 부부 캐릭터 기준 이미지"><div><strong>원고 승인 완료</strong>수달 부부의 표정과 구도를 카드마다 그릴 차례입니다. 아래 지시서는 복사해 그림 작업에 사용하고, 그림 메모는 여기서 계속 고칠 수 있습니다.</div></div>
      <div class="it-art-grid">${project.cards.map((card, index) => `<article class="it-art-card" data-card-id="${safe(card.id)}">
        <h3>${String(index + 1).padStart(2, '0')} / ${project.cards.length}</h3>
        <div class="it-art-preview">그림이 들어갈 자리</div>
        <p><strong>장면</strong> ${safe(card.scene || card.top)}</p><p><strong>대사</strong> ${safe(card.dialogue || '—')}</p>
        <label class="it-field"><span>그림 메모</span><textarea data-it-card="${safe(card.id)}" data-it-field="artNote">${safe(card.artNote)}</textarea></label>
      </article>`).join('')}</div>
      <p class="it-muted">${safe(state.note || '그림은 승인된 원고와 캐릭터 기준 이미지를 바탕으로 제작합니다.')}</p>`;
  }

  function page() {
    const project = current();
    const stage = project?.stage || 'story';
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
      return channel === 'insta' ? page() : originalPlatformPage(channel);
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
    }
  });

  window.addEventListener('pagehide', () => {
    if (state.saveTimer) flush();
  });
})();
