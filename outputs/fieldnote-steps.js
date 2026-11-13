// ===== 공통 원리 맨 위: "오늘 글 하나 쓰기" — 한 번에 한 단계, 단계마다 결과가 남는다 =====
// 큰 글씨·큰 버튼·쉬운 말. 유료 AI 없이 Claude 채팅(구독)에 붙여 넣는 방식.
(() => {
  const SW_KEY = 'fieldnote-steps-v1';
  const CLAUDE_URL = 'https://claude.ai/new';
  const PAGE = 5;
  let sw = { pf: '', ideaId: '', sent: false, postId: '' };
  try { sw = { ...sw, ...JSON.parse(localStorage.getItem(SW_KEY) || '{}') }; } catch (_) {}
  let swAnswer = '', swCustom = '', swPage = 0, swError = '', swCopied = null, swPostCopied = null, swUrl = '', swUrlError = '', swSeen = false;
  // 플랫폼 글쓰기 화면
  const WRITE_URL = { blog:'https://blog.naver.com/PostWriteForm.naver', x:'https://x.com/compose/post', telegram:'https://web.telegram.org/', insta:'https://www.instagram.com/', threads:'https://www.threads.com/', youtube:'https://studio.youtube.com/' };
  const TOTAL = 6;
  // 원고 안에 남은 빈칸 표시
  const marks = body => ({ check: (String(body).match(/\[확인 필요[^\]]*\]/g) || []).length, mine: (String(body).match(/\[(?:내|직접) 경험[^\]]*\]/g) || []).length });
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
    const p = swPost();
    if (!p) return 4;
    if (p.status !== 'approved') return 5;
    if (!p.publicationCheck) return 6;
    return 7;
  }
  function resetFrom(n) {
    if (n <= 1) sw.pf = '';
    if (n <= 2) { sw.ideaId = ''; swPage = 0; swCustom = ''; }
    if (n <= 3) { sw.sent = false; swCopied = null; }
    if (n <= 4) { sw.postId = ''; swAnswer = ''; swError = ''; }
    if (n <= 6) { swPostCopied = null; swUrl = ''; swUrlError = ''; swSeen = false; }
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

  const done = (n, label, value, btn = '바꾸기') => `<li class="sw-step sw-done"><span class="sw-n" aria-hidden="true">✓</span><div class="sw-done-text"><span>${n}. ${esc(label)}</span><b>${esc(value)}</b></div>${btn ? `<button class="sw-change" data-sw-back="${n}">${btn}</button>` : ''}</li>`;
  const todo = (n, label) => `<li class="sw-step sw-todo"><span class="sw-n">${n}</span><span>${esc(label)}</span></li>`;
  const now = (n, label, help, inner) => `<li class="sw-step sw-now" id="swNow"><div class="sw-now-head"><span class="sw-n">${n}</span><h3>${esc(label)}</h3></div><p class="sw-help">${help}</p>${inner}</li>`;

  const LABELS = ['어디에 올릴까요?', '무엇에 대해 쓸까요?', 'Claude에게 부탁하기', 'Claude의 답 붙여 넣기', '확인하고 승인하기', '올리고 주소 남기기'];

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

    // 5
    if (cur === 5) {
      const m = marks(p.body), left = m.check + m.mine, all = p.checks.every(Boolean);
      rows.push(now(5, LABELS[4], left ? '원고에 아직 직접 채울 빈칸이 있어요. 원고를 열어 고친 뒤, 왼쪽 메뉴 <b>공통 원리</b>를 눌러 여기로 돌아오세요.' : '빈칸은 다 채웠어요. 아래 3가지를 읽고 맞으면 하나씩 체크하세요.',
        `${left ? `<div class="sw-left"><span>남은 빈칸</span>${m.check ? `<b>[확인 필요] ${m.check}개</b>` : ''}${m.mine ? `<b>[내 경험] ${m.mine}개</b>` : ''}</div>` : '<p class="sw-ok">✓ 빈칸 없음</p>'}
        <div class="sw-actions"><button class="sw-big ${left ? 'primary' : 'ghost'}" data-sw-openpost>원고 열어서 고치기</button></div>
        <div class="sw-checks">${checks.map((c, k) => `<label class="sw-check"><input type="checkbox" data-sw-check="${k}" ${p.checks[k] ? 'checked' : ''}><span>${esc(c)}</span></label>`).join('')}</div>
        ${swError ? `<p class="sw-error" role="alert">${esc(swError)}</p>` : ''}
        <div class="sw-actions"><button class="sw-big primary" data-sw-approve ${all && !left ? '' : 'aria-disabled="true"'}>승인하기</button></div>`));
    } else if (cur > 5) rows.push(done(5, LABELS[4], '승인 완료', '승인 취소'));
    else rows.push(todo(5, LABELS[4]));
    // 6
    if (cur === 6) {
      const c = p.channel, name = (CH[c] && CH[c].name) || sw.pf;
      rows.push(now(6, LABELS[5], `${esc(name)}에 직접 올린 뒤, 올린 글의 주소를 남기세요.`,
        `<ol class="sw-sub">
          <li><span class="sw-subn">①</span><button class="sw-big primary" data-sw-copypost>글 복사하기</button>${swPostCopied === true ? '<span class="sw-ok">✓ 복사됐어요</span>' : swPostCopied === false ? '<span class="sw-error-inline">복사가 안 됐어요. 원고를 열어 직접 복사해 주세요.</span>' : ''}</li>
          <li><span class="sw-subn">②</span><a class="sw-big" href="${WRITE_URL[c] || '#'}" target="_blank" rel="noopener noreferrer">${esc(name)} 열기 ↗</a><span class="sw-subhelp">붙여 넣고 올리기</span></li>
          <li class="sw-sub-wide"><span class="sw-subn">③</span><form class="sw-urlform" data-sw-url novalidate><label for="swUrl">올린 글 주소 <span class="sw-subhelp">(올린 글 화면 맨 위 주소창을 복사)</span></label>
            <input id="swUrl" class="sw-input" type="url" inputmode="url" placeholder="https://" value="${esc(swUrl)}">
            <label class="sw-check"><input type="checkbox" data-sw-seen ${swSeen ? 'checked' : ''}><span>올린 글을 열어 제목·내용·공개 상태를 확인했어요</span></label>
            ${swUrlError ? `<p class="sw-error" role="alert">${esc(swUrlError)}</p>` : ''}
            <button class="sw-big primary" type="submit">기록하기</button></form></li>
        </ol>`));
    } else if (cur > 6) rows.push(done(6, LABELS[5], '올림 · ' + p.publicationCheck.url, ''));
    else rows.push(todo(6, LABELS[5]));

    const finish = cur === 7 ? `<div class="sw-finish" id="swNow"><h3>오늘 글 하나 완성 🎉</h3><p class="sw-help">올린 뒤 볼 숫자: <b>${esc(PLATFORM_PLAYBOOK[sw.pf]?.metric || '반응')}</b>. 며칠 뒤 확인해 보세요.</p>
      <div class="sw-actions"><a class="sw-big ghost" href="${esc(p.publicationCheck.url)}" target="_blank" rel="noopener noreferrer">올린 글 보기 ↗</a><button class="sw-big primary" data-sw-restart>새 글 시작하기</button></div></div>` : '';
    const stepNo = Math.min(cur, TOTAL);
    return `<section class="sw" style="--pc:${sw.pf ? platformColor(sw.pf) : 'var(--lime)'}" aria-label="오늘 글 하나 쓰기">
      <div class="sw-top"><h2>오늘 글 하나 쓰기</h2><span class="sw-progress">${cur > TOTAL ? '모든 단계 끝' : `${stepNo} / ${TOTAL} 단계`}</span></div>
      <div class="sw-bar" aria-hidden="true"><i style="width:${(Math.min(cur - 1, TOTAL) / TOTAL) * 100}%"></i></div>
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
    const t = e.target.closest('[data-sw-pf],[data-sw-idea],[data-sw-more],[data-sw-back],[data-sw-copy],[data-sw-sent],[data-sw-openpost],[data-sw-restart],[data-sw-approve],[data-sw-copypost]');
    if (!t || !t.closest('.sw')) return;
    if (t.dataset.swPf) { resetFrom(2); sw.pf = t.dataset.swPf; save(); rerender(); return; }
    if (t.dataset.swIdea) { resetFrom(3); sw.ideaId = t.dataset.swIdea; save(); rerender(); return; }
    if (t.hasAttribute('data-sw-more')) { swPage++; rerender(); return; }
    if (t.dataset.swBack === '5') { const p = swPost(); if (p) { p.status = 'review'; p.updated = Date.now(); log('승인 취소: ' + p.title); persist(); } rerender(); return; }
    if (t.dataset.swBack) { resetFrom(+t.dataset.swBack); rerender(); return; }
    if (t.hasAttribute('data-sw-approve')) {
      const p = swPost(); if (!p) return;
      const m = marks(p.body);
      if (m.check + m.mine) swError = `아직 빈칸이 ${m.check + m.mine}개 남았어요. 원고를 열어 먼저 채워 주세요.`;
      else if (!p.checks.every(Boolean)) swError = '3가지를 모두 체크해야 승인할 수 있어요.';
      else { swError = ''; p.status = 'approved'; p.updated = Date.now(); log('승인: ' + p.title); persist(); toast('승인했어요. 이제 올릴 차례예요.'); }
      rerender(); return;
    }
    if (t.hasAttribute('data-sw-copypost')) {
      const p = swPost(); if (!p) return;
      swPostCopied = await copyText(p.title + '\n\n' + p.body);
      toast(swPostCopied ? '글을 복사했어요. 올릴 곳에 붙여 넣으세요.' : '복사하지 못했어요.');
      rerender(); return;
    }
    if (t.hasAttribute('data-sw-copy')) {
      swCopied = await copyAsk();
      if (current() === 3) rerender();
      return;
    }
    if (t.hasAttribute('data-sw-sent')) { sw.sent = true; save(); rerender('#swAnswer'); return; }
    if (t.hasAttribute('data-sw-openpost')) { swError = ''; const p = swPost(); if (!p || !canLeave()) return; editing = p.id; view = p.channel; render(); window.scrollTo(0, 0); return; }
    if (t.hasAttribute('data-sw-restart')) { resetFrom(1); rerender(); }
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'swAnswer') swAnswer = e.target.value;
    if (e.target.id === 'swCustom') swCustom = e.target.value;
    if (e.target.id === 'swUrl') swUrl = e.target.value;
  });

  document.addEventListener('change', e => {
    if (!e.target.closest || !e.target.closest('.sw')) return;
    if (e.target.dataset.swCheck !== undefined) {
      const p = swPost(); if (!p) return;
      p.checks[+e.target.dataset.swCheck] = e.target.checked; p.updated = Date.now(); persist();
      swError = ''; rerender();
    }
    if (e.target.hasAttribute('data-sw-seen')) swSeen = e.target.checked;
  });

  document.addEventListener('submit', e => {
    const own = e.target.closest('[data-sw-own]'), form = e.target.closest('[data-sw-save]'), urlForm = e.target.closest('[data-sw-url]');
    if (!own && !form && !urlForm) return;
    e.preventDefault();
    if (urlForm) {
      const raw = swUrl.trim(), p = swPost(), url = raw && workflowURL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
      if (!p) return;
      if (!url) swUrlError = '주소는 https:// 로 시작해야 해요. 올린 글을 열고 맨 위 주소창을 복사해 붙여 넣으세요.';
      else if (!swSeen) swUrlError = '올린 글을 열어 확인했는지 체크해 주세요.';
      else { swUrlError = ''; p.publicationCheck = { url, note: '', at: Date.now() }; log('게시 확인 완료: ' + p.title); persist(); toast('기록했어요. 오늘 글 하나 완성!'); }
      rerender(swUrlError ? '#swUrl' : '');
      return;
    }
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
.sw-left{display:flex;gap:10px;flex-wrap:wrap;align-items:center;font-size:17px;margin:0 0 12px}
.sw-left b{background:#3a2a14;border:1px solid #6b4f22;color:#ffd79a;border-radius:8px;padding:4px 12px}
.sw-checks{display:grid;gap:10px;margin:18px 0 6px}
.sw-check{display:flex;gap:14px;align-items:center;min-height:56px;padding:10px 16px;border-radius:12px;border:2px solid var(--line);background:var(--panel2);font-size:18px;cursor:pointer}
.sw-check input{width:26px;height:26px;flex:none;accent-color:var(--pc)}
.sw-check:has(input:checked){border-color:var(--pc)}
.sw-big[aria-disabled="true"]{opacity:.45}
.sw-sub-wide{align-items:flex-start!important}
.sw-urlform{flex:1 1 280px;display:grid;gap:10px}
.sw-urlform>label{font-size:18px;font-weight:700}
.sw-urlform .sw-big{justify-self:start}
.sw-error-inline{color:#ffb4b4;font-size:16px}
.sw-finish{margin-top:12px;border:2px solid var(--pc);border-radius:12px;padding:18px;background:#171b21}
@media (max-width:640px){.sw{padding:16px}.sw-top h2{font-size:22px}.sw-big{width:100%}.sw-change{padding:0 12px}}
`;
  document.head.append(css);
})();
