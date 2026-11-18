(function () {
  'use strict';

  const root = '/outputs/assets/krsg-toon/';
  const newborn = 'https://www.teamblind.com/kr/post/신생아때-남편-새벽-헬스장-jl00x46i';
  const dating = 'https://www.teamblind.com/kr/post/남친이-헤어지자네-m3470epj';
  const groups = [
    { id: 'newborn-muted', title: '01 · 차분한 베이지', type: '신생아 · 최신 3안', count: 6, note: '여백과 세이지 색감으로 감정을 눌러 보여 주는 버전', source: newborn, color: '#a6aa86' },
    { id: 'newborn-pastel', title: '02 · 밝은 파스텔', type: '신생아 · 최신 3안', count: 6, note: '하늘색·분홍색과 댓글 말풍선의 대비', source: newborn, color: '#8fc6ec' },
    { id: 'newborn-red', title: '03 · 강렬한 레드', type: '신생아 · 최신 3안', count: 6, note: '빨강·노랑, 대립을 가장 크게 밀어 올린 버전', source: newborn, color: '#fb5046' },
    { id: 'newborn-story-arc', title: '기승전결 강화안', type: '신생아 · 이전 작업', count: 8, note: '영상처럼 보다가 댓글에서 멈추고 2AM 질문으로 끝나는 구성', source: newborn, color: '#ff5953' },
    { id: 'newborn-signature', title: '고유 색채 실험', type: '신생아 · 이전 작업', count: 7, note: '캐릭터와 색의 반복으로 시리즈 감각을 잡은 안', source: newborn, color: '#78b7ea' },
    { id: 'newborn-video', title: '영상 시청 콘셉트', type: '신생아 · 이전 작업', count: 7, note: '재생·일시정지·댓글을 캐러셀 흐름에 넣은 안', source: newborn, color: '#e9b85b' },
    { id: 'dating-kick', title: '연애 사연 · 킥 강화', type: '연애 사연 · 이전 작업', count: 7, note: '영상 인터페이스와 뒤집히는 댓글로 리듬을 높인 안', source: dating, color: '#fa8f9e' },
    { id: 'dating-pastel', title: '연애 사연 · 파스텔', type: '연애 사연 · 이전 작업', count: 7, note: '밝은 캐릭터와 간결한 장면의 캐러셀', source: dating, color: '#9ecbf1' },
    { id: 'dating-muted', title: '연애 사연 · 차분한 톤', type: '연애 사연 · 이전 작업', count: 7, note: '크림·세이지 톤과 조용한 표정 연출', source: dating, color: '#a6aa86' },
    { id: 'dating-first', title: '연애 사연 · 첫 구성', type: '연애 사연 · 초기안', count: 7, note: '싱가포르 맥락과 A/B 선택 구조의 초기 캐러셀', source: dating, color: '#eecb78' }
  ];
  let active = groups[0].id;
  const asset = (group, n) => root + group.id + '/' + String(n).padStart(2, '0') + '.webp';
  const selected = () => groups.find(group => group.id === active) || groups[0];

  function tile(group) {
    return `<button type="button" class="krsg-ref-tile${group.id === active ? ' is-active' : ''}" data-krsg-set="${group.id}" style="--krsg-color:${group.color}" aria-pressed="${group.id === active}">
      <img src="${asset(group, 1)}" alt="${group.title} 표지" loading="lazy" width="1122" height="1402">
      <span class="krsg-ref-tile-copy"><small>${group.type} · ${group.count}장</small><strong>${group.title}</strong></span>
    </button>`;
  }

  function viewer() {
    const group = selected();
    return `<div class="krsg-ref-viewer" id="krsg-ref-viewer" style="--krsg-color:${group.color}">
      <div class="krsg-ref-viewer-head"><div><span class="krsg-ref-overline">선택한 시안</span><h3>${group.title}</h3><p>${group.note}</p></div><div class="krsg-ref-controls"><span class="krsg-ref-count" id="krsg-ref-count">01 / ${String(group.count).padStart(2, '0')}</span><button type="button" data-krsg-step="-1" aria-label="이전 장">←</button><button type="button" data-krsg-step="1" aria-label="다음 장">→</button></div></div>
      <div class="krsg-ref-track" id="krsg-ref-track" tabindex="0" aria-label="${group.title} 캐러셀. 좌우로 넘겨 보세요.">
        ${Array.from({ length: group.count }, (_, index) => `<figure class="krsg-ref-slide"><a href="${asset(group, index + 1)}" target="_blank" rel="noopener noreferrer" aria-label="${index + 1}번째 장 크게 보기"><img src="${asset(group, index + 1)}" alt="${group.title} ${index + 1}번째 장" loading="${index ? 'lazy' : 'eager'}" width="1122" height="1402"></a><figcaption>${String(index + 1).padStart(2, '0')} / ${String(group.count).padStart(2, '0')}</figcaption></figure>`).join('')}
      </div>
      <div class="krsg-ref-viewer-foot"><span>모바일에서는 옆으로 넘기세요. 그림을 누르면 크게 볼 수 있습니다.</span><a href="${group.source}" target="_blank" rel="noopener noreferrer">원문 사연 ↗</a></div>
    </div>`;
  }

  window.krsgDesignReferences = function () {
    return `<section class="panel krsg-ref" id="krsg-references" aria-labelledby="krsg-ref-title">
      <header class="krsg-ref-intro"><div class="eyebrow">DESIGN LIBRARY · 10 CAROUSELS</div><h2 id="krsg-ref-title">인스타툰 디자인 레퍼런스</h2><p>지금까지 만든 시안을 모았습니다. 같은 사연의 그림체와 장면 전개를 비교하며 다음 편을 만들 수 있습니다.</p></header>
      <div class="krsg-ref-section-head"><strong>최근 작업 · 신생아와 새벽 헬스장</strong><span>세 가지 스타일 · 각 6장</span></div>
      <div class="krsg-ref-grid krsg-ref-featured">${groups.slice(0, 3).map(tile).join('')}</div>
      <details class="krsg-ref-archive"><summary>이전 작업 7개 보기 <span>연애 사연 · 영상 콘셉트 · 기승전결 실험</span></summary><div class="krsg-ref-grid">${groups.slice(3).map(tile).join('')}</div></details>
      ${viewer()}
      <p class="krsg-ref-note">디자인 참고용 시안입니다. 댓글은 이야기 흐름에 맞게 요약·각색했습니다. 새벽 2시의 돌봄은 원문에서 확인되지 않아 질문으로만 표현했습니다.</p>
    </section>`;
  };

  document.addEventListener('click', event => {
    const jump = event.target.closest('[data-krsg-jump]');
    if (jump) { document.getElementById('krsg-references')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const tileButton = event.target.closest('[data-krsg-set]');
    if (tileButton) {
      active = tileButton.dataset.krsgSet;
      document.querySelectorAll('[data-krsg-set]').forEach(button => { const on = button.dataset.krsgSet === active; button.classList.toggle('is-active', on); button.setAttribute('aria-pressed', String(on)); });
      const holder = document.getElementById('krsg-ref-viewer');
      if (holder) { holder.outerHTML = viewer(); document.getElementById('krsg-ref-viewer')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
      return;
    }
    const step = event.target.closest('[data-krsg-step]');
    if (!step) return;
    const track = document.getElementById('krsg-ref-track');
    if (!track) return;
    const slide = track.querySelector('.krsg-ref-slide');
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const stride = slide.getBoundingClientRect().width + gap;
    const next = Math.max(0, Math.min(selected().count - 1, Math.round(track.scrollLeft / stride) + Number(step.dataset.krsgStep)));
    track.scrollTo({ left: next * stride, behavior: 'smooth' });
  });

  document.addEventListener('scroll', event => {
    if (event.target?.id !== 'krsg-ref-track') return;
    const track = event.target, slide = track.querySelector('.krsg-ref-slide');
    if (!slide) return;
    const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
    const position = Math.max(1, Math.min(selected().count, Math.round(track.scrollLeft / (slide.getBoundingClientRect().width + gap)) + 1));
    const count = document.getElementById('krsg-ref-count');
    if (count) count.textContent = `${String(position).padStart(2, '0')} / ${String(selected().count).padStart(2, '0')}`;
  }, true);

  document.addEventListener('keydown', event => {
    if (event.target?.id !== 'krsg-ref-track' || !['ArrowRight', 'ArrowLeft'].includes(event.key)) return;
    event.preventDefault();
    document.querySelector(`[data-krsg-step="${event.key === 'ArrowRight' ? 1 : -1}"]`)?.click();
  });
})();
