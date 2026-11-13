// ===== 공통 원리 맨 위: "오늘 글 하나 쓰기" — 한 번에 한 단계, 단계마다 결과가 남는다 =====
// 큰 글씨·큰 버튼·쉬운 말. 유료 AI 없이 Claude 채팅(구독)에 붙여 넣는 방식.
(() => {
  const SW_KEY = 'fieldnote-steps-v1';
  const CLAUDE_URL = 'https://claude.ai/new';
  const PAGE = 5;
  let sw = { pf: '', ideaId: '', sent: false, postId: '' };
  try { sw = { ...sw, ...JSON.parse(localStorage.getItem(SW_KEY) || '{}') }; } catch (_) {}
  let swAnswer = '', swCustom = '', swPage = 0, swError = '', swCopied = null;
  const save = () => { try { localStorage.setItem(SW_KEY, JSON.stringify(sw)); } catch (_) {} };

  const swIdea = () => db.ideas.find(i => i.id === sw.ideaId) || null;
  const swPost = () => db.posts.find(p => p.id === sw.postId) || null;
  const swIdeas = () => db.ideas.filter(i => ideaPlatform(i) === sw.pf)
    .sort((a, b) => (a.sample === b.sample ? 0 : a.sample ? 1 : -1) || (b.created || 0) - (a.created || 0));

  // 지금 해야 할 단계 (앞 단계 결과가 사라졌으면 그 단계로 돌아감)
  function current() {
    if (!IDEA_PLATFORMS.includes(sw.pf)) return 1;
    if (!swIdea()) return 2;
    if (!sw.sent) return 3;
    if (!swPost()) return 4;
    return 5;
  }
  function resetFrom(n) {
    if (n <= 1) sw.pf = '';
    if (n <= 2) { sw.ideaId = ''; swPage = 0; swCustom = ''; }
    if (n <= 3) { sw.sent = false; swCopied = null; }
    if (n <= 4) { sw.postId = ''; swAnswer = ''; swError = ''; }
    save();
  }

  function askText() {
    const i = swIdea(), c = PF_KEY[sw.pf];
    const tone = c === 'blog' ? (db.profile.blogVoice || db.profile.tone) : db.profile.tone;
    return [
      `${sw.pf}에 올릴 글을 한국어로 써 주세요.`,
      `주제: ${i.title}`,
      i.note ? `메모:\n${i.note}` : '',
      i.sources ? `참고 자료:\n${i.sources}` : '',
      `형식: ${PLATFORM_FORMAT[sw.pf] || ''}`,
      tone ? `말투:\n${tone}` : '',
      '꼭 지켜 주세요:\n' + [
        ...COMMON_RULES,
        '제가 직접 겪은 일은 지어내지 말고 [내 경험: 무엇을 쓸지] 자리로 비워 두세요.',
        '확인하지 못한 숫자·사실·링크는 만들지 말고 [확인 필요]로 표시하세요.',
      ].map(r => '- ' + r).join('\n'),
      '답은 이렇게만 주세요:\n첫 줄에 제목\n한 줄 비우고 본문\n(다른 설명은 붙이지 마세요)',
    ].filter(Boolean).join('\n\n');
  }

  // 답 읽기: 예전 JSON 형식도 받고, "첫 줄 제목 + 본문"도 받는다
  function readAnswer(text) {
    const clean = String(text || '').trim().replace(/^\x60{3}[a-z]*\s*/i, '').replace(/\s*\x60{3}$/, '').trim();
    if (!clean) throw Error('Claude가 쓴 답을 먼저 붙여 넣어 주세요.');
    try {
      const j = JSON.parse(clean);
      if (j && typeof j.title === 'string' && typeof j.body === 'string' && j.title.trim() && j.body.trim()) return { title: j.title.trim(), body: j.body.trim(), sources: typeof j.sources === 'string' ? j.sources : '' };
    } catch (_) {}
    const lines = clean.split(/\r?\n/);
    const at = lines.findIndex(l => l.trim());
    const title = lines[at].trim().replace(/^[#*\s]+|[*\s]+$/g, '').replace(/^제목\s*[:：]\s*/, '').replace(/^[*\s]+/, '').trim();
    const body = lines.slice(at + 1).join('\n').trim();
    if (!body) throw Error('제목 아래에 본문이 없어요. Claude의 답을 처음부터 끝까지 모두 복사해 붙여 넣어 주세요.');
    if (title.length > 200) throw Error('첫 줄이 너무 길어요. 첫 줄에는 제목만 있어야 해요.');
    return { title, body, sources: '' };
  }

  const done = (n, label, value) => `<li class="sw-step sw-done"><span class="sw-n" aria-hidden="true">✓</span><div class="sw-done-text"><span>${n}. ${esc(label)}</span><b>${esc(value)}</b></div><button class="sw-change" data-sw-back="${n}">바꾸기</button></li>`;
  const todo = (n, label) => `<li class="sw-step sw-todo"><span class="sw-n">${n}</span><span>${esc(label)}</span></li>`;
  const now = (n, label, help, inner) => `<li class="sw-step sw-now" id="swNow"><div class="sw-now-head"><span class="sw-n">${n}</span><h3>${esc(label)}</h3></div><p class="sw-help">${help}</p>${inner}</li>`;

  const LABELS = ['어디에 올릴까요?', '무엇에 대해 쓸까요?', 'Claude에게 부탁하기', 'Claude의 답 붙여 넣기'];

  function stepsBlock() {
    const cur = current(), i = swIdea(), p = swPost();
    const rows = [];
    // 1
    if (cur === 1) rows.push(now(1, LABELS[0], '글을 올릴 곳을 하나 누르세요.',
      `<div class="sw-pfs">${IDEA_PLATFORMS.map(x => `<button class="sw-pf" style="--pc:${platformColor(x)}" data-sw-pf="${esc(x)}"><b>${esc(x)}</b><span>${esc(PLATFORM_PLAYBOOK[x]?.role || '')}</span></button>`).join('')}</div>`));
    else rows.push(done(1, LABELS[0], sw.pf));
    // 2
    if (cur === 2) {
      const list = swIdeas(), pages = Math.max(1, Math.ceil(list.length / PAGE)), pg = swPage % pages, shown = list.slice(pg * PAGE, pg * PAGE + PAGE);
      rows.push(now(2, LABELS[1], '아래에서 하나 고르거나, 쓰고 싶은 주제를 직접 적으세요.',
        `${shown.length ? `<div class="sw-topics">${shown.map(t => `<button class="sw-topic" data-sw-idea="${esc(t.id)}">${esc(t.title)}</button>`).join('')}</div>${pages > 1 ? `<button class="sw-more" data-sw-more>다른 주제 보기 (${pg + 1}/${pages})</button>` : ''}` : '<p class="sw-help">이 플랫폼에는 아직 주제가 없어요. 아래에 직접 적어 주세요.</p>'}
        <form class="sw-own" data-sw-own><label for="swCustom">직접 적기</label><div class="sw-own-row"><input id="swCustom" class="sw-input" maxlength="200" placeholder="예) 처음 손절했던 날 배운 것" value="${esc(swCustom)}"><button class="sw-big" type="submit">이 주제로 하기</button></div></form>`));
    } else if (cur > 2) rows.push(done(2, LABELS[1], i.title));
    else rows.push(todo(2, LABELS[1]));
    // 3
    if (cur === 3) rows.push(now(3, LABELS[2], '아래 순서대로 하나씩 누르세요.',
      `<ol class="sw-sub">
        <li><span class="sw-subn">①</span><button class="sw-big primary" data-sw-copy>부탁 글 복사하기</button>${swCopied === true ? '<span class="sw-ok">✓ 복사됐어요</span>' : ''}</li>
        <li><span class="sw-subn">②</span><a class="sw-big" href="${CLAUDE_URL}" target="_blank" rel="noopener noreferrer">Claude 열기 ↗</a><span class="sw-subhelp">새 창 입력칸에 붙여 넣고 보내기 · 맥 <kbd>⌘</kbd>+<kbd>V</kbd> · 윈도우 <kbd>Ctrl</kbd>+<kbd>V</kbd></span></li>
        <li><span class="sw-subn">③</span><button class="sw-big" data-sw-sent>Claude에 보냈어요 →</button></li>
      </ol>
      ${swCopied === false ? '<p class="sw-error" role="alert">복사가 안 됐어요. 아래 글을 마우스로 전부 끌어서 선택한 뒤 복사해 주세요.</p>' : ''}
      <details class="sw-peek" ${swCopied === false ? 'open' : ''}><summary>부탁 글 내용 보기</summary><pre id="swAsk">${esc(askText())}</pre></details>`));
    else if (cur > 3) rows.push(done(3, LABELS[2], 'Claude에 보냄'));
    else rows.push(todo(3, LABELS[2]));
    // 4
    if (cur === 4) rows.push(now(4, LABELS[3], 'Claude가 글을 다 쓰면, 답 아래의 <b>복사</b> 버튼을 누르고 여기에 붙여 넣으세요.',
      `<form data-sw-save><textarea id="swAnswer" class="sw-answer" placeholder="여기에 붙여 넣기" aria-label="Claude의 답">${esc(swAnswer)}</textarea>
        ${swError ? `<p class="sw-error" role="alert">${esc(swError)}</p>` : ''}
        <div class="sw-actions"><button class="sw-big primary" type="submit">원고로 저장하기</button><a class="sw-big ghost" href="${CLAUDE_URL}" target="_blank" rel="noopener noreferrer">Claude 다시 열기 ↗</a></div></form>`));
    else if (cur > 4) rows.push(done(4, LABELS[3], '원고 저장: ' + p.title));
    else rows.push(todo(4, LABELS[3]));

    const finish = cur === 5 ? `<div class="sw-finish" id="swNow"><h3>원고가 만들어졌어요 🎉</h3><p class="sw-help">이제 원고를 열어 <b>[확인 필요]</b>와 <b>[내 경험]</b> 자리를 직접 채우세요. 다 고치면 아래쪽 검수 3가지를 체크합니다.</p>
      <div class="sw-actions"><button class="sw-big primary" data-sw-openpost>원고 열기</button><button class="sw-big ghost" data-sw-restart>새 글 시작하기</button></div></div>` : '';
    const stepNo = Math.min(cur, 4);
    return `<section class="sw" style="--pc:${sw.pf ? platformColor(sw.pf) : 'var(--lime)'}" aria-label="오늘 글 하나 쓰기">
      <div class="sw-top"><h2>오늘 글 하나 쓰기</h2><span class="sw-progress">${cur === 5 ? '4단계 모두 끝' : `${stepNo} / 4 단계`}</span></div>
      <div class="sw-bar" aria-hidden="true"><i style="width:${(Math.min(cur - 1, 4) / 4) * 100}%"></i></div>
      <ol class="sw-steps">${rows.join('')}</ol>${finish}</section>`;
  }

  // 공통 원리 화면 맨 위에 끼워 넣기
  const baseCommonPage = commonPage;
  commonPage = function () {
    const html = baseCommonPage();
    const at = html.indexOf('<div class="cp-pfs">');
    return at < 0 ? stepsBlock() + html : html.slice(0, at) + stepsBlock() + html.slice(at);
  };

  function rerender(focus) {
    render();
    const el = document.getElementById('swNow');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      const f = focus && document.querySelector(focus);
      if (f) setTimeout(() => f.focus({ preventScroll: true }), 300);
    }
  }

  async function copyAsk() {
    const ok = await copyText(askText());
    toast(ok ? '복사했어요. Claude 입력칸에 붙여 넣고 보내세요.' : '복사하지 못했어요. "부탁 글 내용 보기"를 열어 직접 복사해 주세요.');
    return ok;
  }

  document.addEventListener('click', async e => {
    const t = e.target.closest('[data-sw-pf],[data-sw-idea],[data-sw-more],[data-sw-back],[data-sw-copy],[data-sw-sent],[data-sw-openpost],[data-sw-restart]');
    if (!t || !t.closest('.sw')) return;
    if (t.dataset.swPf) { resetFrom(2); sw.pf = t.dataset.swPf; save(); rerender(); return; }
    if (t.dataset.swIdea) { resetFrom(3); sw.ideaId = t.dataset.swIdea; save(); rerender(); return; }
    if (t.hasAttribute('data-sw-more')) { swPage++; rerender(); return; }
    if (t.dataset.swBack) { resetFrom(+t.dataset.swBack); rerender(); return; }
    if (t.hasAttribute('data-sw-copy')) {
      swCopied = await copyAsk();
      if (current() === 3) rerender();
      return;
    }
    if (t.hasAttribute('data-sw-sent')) { sw.sent = true; save(); rerender('#swAnswer'); return; }
    if (t.hasAttribute('data-sw-openpost')) { const p = swPost(); if (!p || !canLeave()) return; editing = p.id; view = p.channel; render(); window.scrollTo(0, 0); return; }
    if (t.hasAttribute('data-sw-restart')) { resetFrom(1); rerender(); }
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'swAnswer') swAnswer = e.target.value;
    if (e.target.id === 'swCustom') swCustom = e.target.value;
  });

  document.addEventListener('submit', e => {
    const own = e.target.closest('[data-sw-own]'), form = e.target.closest('[data-sw-save]');
    if (!own && !form) return;
    e.preventDefault();
    if (own) {
      const title = swCustom.trim();
      if (!title) { toast('주제를 먼저 적어 주세요.'); document.getElementById('swCustom')?.focus(); return; }
      const idea = { id: uid(), title, note: '', sources: '', platform: sw.pf, sample: false, created: Date.now(), ...(sw.pf === '네이버 블로그' ? { preferredChannel: 'blog' } : sw.pf === 'YouTube' ? { preferredChannel: 'youtube' } : {}) };
      db.ideas.unshift(idea);
      log('새 주제: ' + title);
      persist();
      resetFrom(3); sw.ideaId = idea.id; save(); rerender();
      return;
    }
    try {
      const data = readAnswer(swAnswer), idea = swIdea(), channel = PF_KEY[sw.pf];
      const post = newPost(idea, channel, false);
      Object.assign(post, { title: data.title, body: data.body, sources: data.sources || idea.sources || '', status: 'draft', aiDraft: true });
      db.posts.unshift(post);
      log('원고 저장: ' + post.title);
      persist();
      sw.postId = post.id; swAnswer = ''; swError = ''; save();
      toast('원고를 저장했어요.');
      rerender();
    } catch (err) { swError = err.message; rerender('#swAnswer'); }
  });

  const css = document.createElement('style');
  css.textContent = `
.sw{--pc:var(--lime);border:1px solid var(--line);border-top:4px solid var(--pc);background:var(--panel);border-radius:14px;padding:22px 22px 24px;margin:0 0 22px;font-size:18px;line-height:1.6}
.sw-top{display:flex;justify-content:space-between;align-items:baseline;gap:12px;flex-wrap:wrap}
.sw-top h2{font-size:26px;margin:0}
.sw-progress{font-size:17px;color:var(--text);font-weight:700}
.sw-bar{height:8px;border-radius:99px;background:var(--panel2);margin:12px 0 18px;overflow:hidden}
.sw-bar i{display:block;height:100%;background:var(--pc);transition:width .3s}
.sw-steps{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.sw-step{display:flex;gap:14px;align-items:center;border-radius:12px;padding:12px 14px}
.sw-n{flex:none;width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:18px;background:var(--panel2);border:2px solid var(--line);color:var(--muted)}
.sw-done{background:var(--panel2)}
.sw-done .sw-n{background:var(--pc);border-color:var(--pc);color:#111}
.sw-done-text{flex:1;min-width:0;display:flex;flex-direction:column}
.sw-done-text span{font-size:15px;color:#b4bac4}
.sw-done-text b{font-size:18px;overflow-wrap:anywhere}
.sw-change{flex:none;min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--text);font-size:16px}
.sw-change:hover{border-color:var(--pc)}
.sw-todo{color:#9aa1ac;font-size:17px}
.sw-now{display:block;border:2px solid var(--pc);background:#171b21;padding:18px}
.sw-now-head{display:flex;gap:14px;align-items:center}
.sw-now .sw-n{background:var(--pc);border-color:var(--pc);color:#111}
.sw-now h3,.sw-finish h3{font-size:23px;margin:0}
.sw-help{margin:10px 0 14px;font-size:18px;color:#d5d9df}
.sw-pfs{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:10px}
.sw-pf{text-align:left;min-height:84px;padding:14px 16px;border-radius:12px;border:2px solid var(--line);border-left:6px solid var(--pc);background:var(--panel2);color:var(--text);display:flex;flex-direction:column;gap:4px}
.sw-pf b{font-size:20px;color:var(--pc)}
.sw-pf span{font-size:15px;color:#c3c8cf}
.sw-pf:hover,.sw-topic:hover{border-color:var(--pc)}
.sw-topics{display:grid;gap:8px}
.sw-topic{text-align:left;min-height:58px;padding:12px 16px;border-radius:12px;border:2px solid var(--line);background:var(--panel2);color:var(--text);font-size:18px;line-height:1.45}
.sw-more{margin-top:10px;min-height:48px;padding:0 18px;border-radius:10px;border:1px dashed var(--line);background:transparent;color:var(--text);font-size:17px}
.sw-own{margin-top:18px;padding-top:16px;border-top:1px solid var(--line)}
.sw-own label{display:block;font-size:17px;font-weight:700;margin-bottom:8px}
.sw-own-row{display:flex;gap:8px;flex-wrap:wrap}
.sw-input{flex:1 1 260px;min-height:56px;padding:0 16px;font-size:18px;border-radius:10px;border:2px solid var(--line);background:#0f1216;color:var(--text)}
.sw-input:focus,.sw-answer:focus{outline:none;border-color:var(--pc)}
.sw-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px}
.sw-big{min-height:58px;padding:0 24px;border-radius:12px;border:2px solid var(--line);background:var(--panel2);color:var(--text);font-size:19px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;text-decoration:none}
.sw-big.primary{background:var(--lime);border-color:var(--lime);color:#14200e}
.sw-big.ghost{background:transparent}
.sw-big:hover{filter:brightness(1.08)}
.sw-big:focus-visible,.sw-pf:focus-visible,.sw-topic:focus-visible,.sw-change:focus-visible{outline:3px solid var(--pc);outline-offset:2px}
.sw-peek{margin-top:14px}
.sw-peek summary{cursor:pointer;font-size:16px;color:#c3c8cf;min-height:40px;display:flex;align-items:center;list-style:none}
.sw-peek summary::before{content:'▸';margin-right:8px}
.sw-peek[open] summary::before{content:'▾'}
.sw-peek summary::-webkit-details-marker{display:none}
.sw-sub{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.sw-sub li{display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.sw-subn{font-size:22px;font-weight:800;color:var(--pc);width:28px}
.sw-subhelp{font-size:16px;color:#c3c8cf}
.sw-subhelp kbd{border:1px solid var(--line);border-bottom-width:2px;border-radius:5px;padding:1px 7px;font-family:inherit;background:var(--panel2)}
.sw-ok{font-size:18px;font-weight:700;color:var(--green)}
.sw-sub .sw-big{min-width:230px}
.sw-peek pre{white-space:pre-wrap;font-family:inherit;font-size:15px;line-height:1.6;background:#0f1216;border:1px solid var(--line);border-radius:10px;padding:14px;max-height:280px;overflow:auto;margin:6px 0 0}
.sw-tip{font-size:16px;color:#c3c8cf;margin:12px 0 0}
.sw-tip kbd{border:1px solid var(--line);border-bottom-width:2px;border-radius:5px;padding:1px 7px;font-family:inherit;background:var(--panel2)}
.sw-answer{width:100%;min-height:220px;padding:14px 16px;font-size:17px;line-height:1.6;border-radius:12px;border:2px solid var(--line);background:#0f1216;color:var(--text);resize:vertical;font-family:inherit}
.sw-error{color:#ffb4b4;background:#3a1f22;border:1px solid #6b3237;border-radius:10px;padding:10px 14px;margin:10px 0 0;font-size:17px}
.sw-finish{margin-top:12px;border:2px solid var(--pc);border-radius:12px;padding:18px;background:#171b21}
@media (max-width:640px){.sw{padding:16px}.sw-top h2{font-size:22px}.sw-big{width:100%}.sw-change{padding:0 12px}}
`;
  document.head.append(css);
})();
