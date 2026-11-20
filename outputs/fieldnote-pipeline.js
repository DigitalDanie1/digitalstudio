// ===== 플랫폼 공통 "한 단계씩" 작업 틀 =====
// 모든 플랫폼 화면이 같은 틀을 쓴다: 위에 단계 막대 → 가운데 지금 단계 카드(큰 버튼 하나) → 결과 상자 → 이전/다음.
// 플랫폼마다 단계 정의 {id,name,title,desc,btn,isDone(item),result(item),run(item)} 만 다르다.
// 기존 기능(원고 만들기·편집기·네이버 복사·브리지·게시 확인·유튜브 실행기·인스타툰)은 그대로 부르고 새로 만들지 않는다.
// 이 파일이 "오늘 글 하나 쓰기"(fieldnote-steps.js)의 흐름도 흡수했다.
(() => {
  const KEY = 'fieldnote-pipeline-v1', OLD_KEY = 'fieldnote-steps-v1';
  const CLAUDE_URL = 'https://claude.ai/new';
  const PAGE = 5;
  const WRITE_URL = { blog: 'https://blog.naver.com/PostWriteForm.naver', x: 'https://x.com/compose/post', telegram: 'https://web.telegram.org/', insta: 'https://www.instagram.com/', threads: 'https://www.threads.com/', youtube: 'https://studio.youtube.com/' };
  const NAME = { blog: '네이버', x: 'X', telegram: 'Telegram', insta: '인스타', threads: 'Threads', youtube: 'YouTube Studio' };

  // ----- 저장되는 상태 (이 브라우저) -----
  let S = { sel: {}, opened: {}, instaMode: 'toon', igSel: {}, igLoaded: 'insta-sing' };
  try { S = { ...S, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch (_) {}
  S.sel = S.sel || {}; S.opened = S.opened || {}; S.igSel = S.igSel || {}; S.fxRefs = S.fxRefs || {};
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (_) {} };
  // 예전 "오늘 글 하나 쓰기"에서 하던 작업 이어받기
  try {
    const old = JSON.parse(localStorage.getItem(OLD_KEY) || '{}'), c = PF_KEY[old.pf];
    if (c && old.postId && !S.sel[c] && !S.migrated) { S.sel[c] = { postId: old.postId }; }
    S.migrated = true; save();
  } catch (_) {}
  // 인스타 계정마다 '작업 중' 선택을 따로 기억한다 (계정을 바꾸면 선택을 맞바꿈)
  const T0 = () => T;
  function igSync() {
    const want = igCur();
    if (!IG_BY_ID[S.igLoaded]) S.igLoaded = 'insta-sing';
    if (want === S.igLoaded) return;
    S.igSel[S.igLoaded] = S.sel.insta; S.sel.insta = S.igSel[want] || {}; S.igLoaded = want;
    for (const k of ['view', 'pick', 'custom', 'page', 'manual', 'err', 'askCopied', 'busy', 'answer', 'url', 'seen', 'link']) { const o = T0()[k]; if (o) delete o.insta; }
    save();
  }
  // 오늘 할 일: 다른 계정·채널의 진행 상황을 잠깐 그쪽 기준으로 계산
  function withRoute(route, fn) {
    const pIg = igLock, pYt = db.profile.ytChannelTab;
    try {
      if (IG_BY_ID[route]) igLock = route;
      else if (route === 'youtube') { if (YT_LOCKS[pYt]) db.profile.ytChannelTab = 'yt-wrestling'; }
      else if (YT_LOCKS[route]) db.profile.ytChannelTab = route;
      return fn();
    } finally { igLock = pIg; db.profile.ytChannelTab = pYt; }
  }
  // ----- 잠깐 쓰는 상태 -----
  const T = { view: {}, manual: {}, busy: {}, err: {}, askCopied: {}, answer: {}, pick: {}, custom: {}, page: {}, url: {}, seen: {}, link: {}, caption: {}, logOpen: null, ytFmt: null, redo1: {} };

  const marksOf = body => {
    const b = String(body || '');
    const mine = (b.match(/\[(?:내|직접) 경험[^\]]*\]/g) || []).length, check = (b.match(/\[확인 필요[^\]]*\]/g) || []).length;
    const other = placeholderLines(b).filter(l => !/^\[(?:내|직접) 경험|^\[확인 필요/.test(l)).length;
    return { mine, check, other, total: mine + check + other };
  };
  const marksText = m => `[내 경험] ${m.mine}곳 · [확인 필요] ${m.check}곳${m.other ? ` · 빈 자리 ${m.other}곳` : ''}`;
  const num = n => Number(n).toLocaleString('ko-KR');
  const isLocalOnly = () => !/^https?:$/.test(location.protocol) || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);

  // ===== 공통 도우미 =====
  const unfinished = c => db.posts.filter(p => p.channel === c && !p.publicationCheck && (c !== 'insta' || igOf(p) === igCur())).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const pfIdeas = pf => db.ideas.filter(i => ideaPlatform(i) === pf && (pf !== 'Instagram' || igOf(i) === igCur()))
    .sort((a, b) => (a.sample === b.sample ? 0 : a.sample ? 1 : -1) || (b.created || 0) - (a.created || 0));
  const sampleTag = p => (p && p.sample ? ' <span class="sampletag">예시</span>' : '');

  function askText(c, idea) {
    const pf = PF_NAME[c], tone = c === 'blog' ? (db.profile.blogVoice || db.profile.tone) : db.profile.tone;
    if (c === 'insta') {
      const a = igOf(idea.igAccount ? idea : { igAccount: igCur() }), en = IG_BY_ID[a].lang === 'en', rules = en ? ['Facts first: keep fact, quote and opinion separate, and name the source.', 'Cross-check key numbers and dates; mark anything unverified as [확인 필요].', 'Never invent prices, dates, quotes or availability.', 'Do not generalise one person or scene to a whole country or group.', 'Use only short, credited quotes and visuals.'] : COMMON_RULES;
      return [
        en ? `Write an Instagram card-news post for the account "${igName(a)}".` : `인스타그램 카드뉴스 원고를 한국어로 써 주세요. 계정: ${igName(a)}.`,
        `${en ? 'Topic' : '주제'}: ${idea.title}`,
        idea.note ? `${en ? 'Notes' : '메모'}:\n${idea.note}` : '',
        idea.sources ? `${en ? 'Sources' : '참고 자료'}:\n${idea.sources}` : '',
        `${en ? 'Account voice' : '계정 소개·말투'}:\n${igVoice(a)}`,
        igDirective(a),
        idea.fromLink ? igLinkDirective(idea) : '',
        (en ? 'Rules:\n' : '꼭 지켜 주세요:\n') + rules.map(r => '- ' + r).join('\n'),
        en ? 'Reply format: first line = title, blank line, then the cards and caption. No other commentary.' : '답은 이렇게만 주세요:\n첫 줄에 제목\n한 줄 비우고 본문\n(다른 설명은 붙이지 마세요)',
      ].filter(Boolean).join('\n\n');
    }
    return [
      `${pf}에 올릴 글을 한국어로 써 주세요.`,
      `주제: ${idea.title}`,
      idea.note ? `메모:\n${idea.note}` : '',
      idea.sources ? `참고 자료:\n${idea.sources}` : '',
      `형식: ${PLATFORM_FORMAT[pf] || ''}`,
      tone ? `말투:\n${tone}` : '',
      '꼭 지켜 주세요:\n' + [...COMMON_RULES,
        '제가 직접 겪은 일은 지어내지 말고 [내 경험: 무엇을 쓸지] 자리로 비워 두세요.',
        '확인하지 못한 숫자·사실·링크는 만들지 말고 [확인 필요]로 표시하세요.'].map(r => '- ' + r).join('\n'),
      '답은 이렇게만 주세요:\n첫 줄에 제목\n한 줄 비우고 본문\n(다른 설명은 붙이지 마세요)',
    ].filter(Boolean).join('\n\n');
  }
  function readAnswer(text) {
    const clean = String(text || '').trim().replace(/^\x60{3}[a-z]*\s*/i, '').replace(/\s*\x60{3}$/, '').trim();
    if (!clean) throw Error('Claude가 쓴 답을 먼저 붙여 넣어 주세요.');
    try {
      const j = JSON.parse(clean);
      if (j && typeof j.title === 'string' && typeof j.body === 'string' && j.title.trim() && j.body.trim()) return { title: j.title.trim(), body: j.body.trim(), sources: typeof j.sources === 'string' ? j.sources : '' };
    } catch (_) {}
    const lines = clean.split(/\r?\n/), at = lines.findIndex(l => l.trim());
    const title = lines[at].trim().replace(/^[#*\s]+|[*\s]+$/g, '').replace(/^제목\s*[:：]\s*/, '').replace(/^[*\s]+/, '').trim();
    const body = lines.slice(at + 1).join('\n').trim();
    if (!body) throw Error('제목 아래에 본문이 없어요. Claude의 답을 처음부터 끝까지 모두 복사해 붙여 넣어 주세요.');
    if (title.length > 200) throw Error('첫 줄이 너무 길어요. 첫 줄에는 제목만 있어야 해요.');
    return { title, body, sources: '' };
  }
  const igCaption = p => { const cap = window.CodexImg && CodexImg.splitDraft(p.body).caption; return cap ? markdownToPlain(cap) : markdownToPlain(p.body); };
  const postText = (c, p) => c === 'blog' ? naverCopyText(p) : c === 'insta' ? igCaption(p) : markdownToPlain(p.body);

  // 올렸는지(복사·열기·브리지 전송을 했는지)
  const uploaded = (key, p) => !!(S.opened[key] || (p && ['queued', 'published'].includes(p.publish?.state)));
  const urlFormHtml = (key, extra = '') => `<form class="pl-url" data-pl-urlform novalidate>
      <label for="plUrl">올린 글 주소 <span class="small">(올린 글 화면 맨 위 주소창을 복사)</span></label>
      <input id="plUrl" class="pl-input" type="url" inputmode="url" placeholder="https://" value="${esc(T.url[key] || '')}" data-pl-urlinput="${esc(key)}">
      <label class="pl-check"><input type="checkbox" data-pl-seen="${esc(key)}" ${T.seen[key] ? 'checked' : ''}><span>올린 글을 열어 제목·내용·공개 상태를 확인했어요</span></label>${extra}</form>`;
  // 주소 남기기: 성공하면 기록 객체를 돌려준다
  function readUrl(key) {
    const raw = String(T.url[key] || '').trim(), url = raw && workflowURL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw);
    if (!url) throw Error('주소는 https:// 로 시작해야 해요. 올린 글을 열고 맨 위 주소창을 복사해 붙여 넣으세요.');
    if (!T.seen[key]) throw Error('올린 글을 열어 확인했는지 체크해 주세요.');
    return { url, note: '', at: Date.now() };
  }
  const doneLink = chk => chk && !chk.url ? '올림 · 비공개 채널이라 글 주소가 없어요' : chk ? `올림 · <a href="${esc(chk.url)}" target="_blank" rel="noopener noreferrer">${esc(chk.url)}</a>` : '';

  // ===== 일반 플랫폼 (블로그·X·Telegram·Threads, 인스타 카드뉴스/릴스) =====
  function gItem(c) {
    const s = S.sel[c] = S.sel[c] || {};
    let post = s.postId && db.posts.find(p => p.id === s.postId && p.channel === c) || null;
    if (!post) s.postId = '';
    if (!post && !s.ideaId && !s.empty) { const u = unfinished(c)[0]; if (u) { post = u; s.postId = u.id; } }
    const idea = post ? (db.ideas.find(i => i.id === post.ideaId) || null) : (s.ideaId ? db.ideas.find(i => i.id === s.ideaId) || null : null);
    return { c, post, idea, key: post ? 'p:' + post.id : idea ? 'i:' + idea.id : '', title: post ? post.title : idea ? idea.title : '' };
  }
  function pickerHtml(c, it) {
    const pf = PF_NAME[c], list = pfIdeas(pf), pages = Math.max(1, Math.ceil(list.length / PAGE)), pg = (T.page[c] || 0) % pages, shown = list.slice(pg * PAGE, pg * PAGE + PAGE);
    const cur = T.pick[c] || (it.idea && it.idea.id) || (shown[0] && shown[0].id) || '';
    T.pick[c] = cur;
    return `<div class="pl-picker">${shown.length ? `<div class="pl-topics" role="radiogroup" aria-label="주제">${shown.map(t => `<button type="button" role="radio" aria-checked="${t.id === cur}" class="pl-topic ${t.id === cur ? 'on' : ''}" data-pl-pick="${esc(t.id)}"><span>${esc(t.title)}</span>${t.sample ? '<em>예시</em>' : ''}</button>`).join('')}</div>${pages > 1 ? `<button type="button" class="pl-link" data-pl-more>다른 주제 보기 (${pg + 1}/${pages})</button>` : ''}` : '<p class="small">이 플랫폼에는 아직 주제가 없어요. 아래에 직접 적어 주세요.</p>'}
      <label class="pl-own"><span>또는 직접 적기</span><input id="plCustom" class="pl-input" maxlength="200" placeholder="예) 처음 손절했던 날 배운 것" value="${esc(T.custom[c] || '')}"></label></div>`;
  }
  function commitTopic(c) {
    const own = String(T.custom[c] || '').trim(), pf = PF_NAME[c];
    let idea;
    if (own) {
      idea = { id: uid(), title: own, note: '', sources: '', platform: pf, sample: false, created: Date.now(), ...(c === 'blog' ? { preferredChannel: 'blog' } : c === 'insta' ? { preferredChannel: 'insta', igAccount: igCur() } : {}) };
      db.ideas.unshift(idea); log('새 주제: ' + own); persist(); T.custom[c] = '';
    } else idea = db.ideas.find(i => i.id === T.pick[c]);
    if (!idea) { toast('주제를 하나 골라 주세요.'); return false; }
    const ex = db.posts.find(p => p.ideaId === idea.id && p.channel === c && !p.publicationCheck);
    S.sel[c] = ex ? { postId: ex.id } : { ideaId: idea.id };
    if (ex) toast('이 주제로 만든 원고가 있어서 이어서 해요.');
    save(); return true;
  }
  async function autoDraft(c, it) {
    if (T.busy[c]) return;
    T.busy[c] = true; T.err[c] = ''; repaint(c);
    try {
      const r = await requestAiDraft(c, it.idea.naverCategory, it.idea);
      const post = newPost(it.idea, c, it.idea.sample);
      Object.assign(post, { title: r.title, body: r.body, memo: [post.memo, r.memo].filter(Boolean).join('\n\n'), aiDraft: true });
      db.posts.unshift(post); log('AI 원고 생성: ' + post.title); persist();
      S.sel[c] = { postId: post.id }; save(); toast('AI 초안을 만들었어요.');
    } catch (e) {
      T.manual[c] = true; T.err[c] = isLocalOnly() ? 'AI 자동 생성은 배포된 사이트에서만 돼요.' : 'AI 자동 생성이 안 됐어요. (' + e.message + ')';
      toast('자동 생성을 못 썼어요. Claude 채팅으로 이어가요.');
    } finally { T.busy[c] = false; repaint(c); }
  }
  function saveManual(c, it) {
    try {
      const d = readAnswer(T.answer[c]);
      const post = newPost(it.idea, c, false);
      Object.assign(post, { title: d.title, body: d.body, sources: d.sources || it.idea.sources || '', status: 'draft', aiDraft: true });
      db.posts.unshift(post); log('원고 저장: ' + post.title); persist();
      S.sel[c] = { postId: post.id }; save(); T.answer[c] = ''; T.err[c] = ''; T.askCopied[c] = false;
      toast('원고를 저장했어요.');
    } catch (e) { T.err[c] = e.message; }
    repaint(c);
  }
  async function manualCopy(c, it) {
    const ok = await copyText(askText(c, it.idea));
    window.open(CLAUDE_URL, '_blank', 'noopener');
    T.askCopied[c] = ok ? true : 'fail';
    toast(ok ? '복사했어요. Claude 입력칸에 붙여 넣고 보내세요.' : '복사하지 못했어요. "부탁 글 보기"를 열어 직접 복사해 주세요.');
    repaint(c);
  }
  function approve(c, it) {
    const p = it.post, m = marksOf(p.body);
    if (m.total) T.err[c] = `아직 빈칸이 ${m.total}개 남았어요. 원고를 열어 먼저 채워 주세요.`;
    else if (!p.checks.every(Boolean)) T.err[c] = '3가지를 모두 체크해야 승인할 수 있어요.';
    else { T.err[c] = ''; p.status = 'approved'; p.updated = Date.now(); log('원고 검수 승인: ' + p.title); persist(); toast('승인했어요. 이제 올릴 차례예요.'); }
    repaint(c);
  }
  function openEditor(it) { if (!it.post || !canLeave()) return; editing = it.post.id; dirty = false; render(); window.scrollTo(0, 0); }
  function copyOpen(c, p) {
    if (p.sample) { toast('예시 원고는 올릴 수 없어요.'); return; }
    if (c === 'blog') { copyToNaver(p.id); S.opened[p.id] = true; save(); setTimeout(() => repaint(c), 400); return; }
    const pending = copyText(postText(c, p)); window.open(WRITE_URL[c], '_blank', 'noopener');
    pending.then(ok => {
      if (!ok) { toast('복사하지 못했어요. 원고를 열어 직접 복사해 주세요.'); return; }
      p.publish = { state: 'queued', requestedAt: Date.now(), url: '', message: '수동 발행 준비' }; S.opened[p.id] = true; save();
      log(CH[c].short + ' 수동 발행 준비: ' + p.title); persist(); toast(`글을 복사했고 ${NAME[c]}를 열었어요. 붙여 넣고 올린 뒤 돌아와 주소를 남기세요.`); repaint(c);
    });
  }
  function recordUrl(c, key, target, label) {
    try {
      target.publicationCheck = readUrl(key); T.err[c] = ''; log('게시물 확인 완료: ' + label); persist(); toast('주소를 남겼어요. 하나 끝냈어요!');
    } catch (e) { T.err[c] = e.message; }
    repaint(c);
  }


  // ===== Telegram 자동 올리기 (서버가 봇으로 채널에 보낸다) =====
  const TG = { info: null, loading: false, sending: {} };   // info: null(모름) | {configured, target}
  function tgLoad() {
    if (TG.info || TG.loading) return;
    if (!/^https?:$/.test(location.protocol)) { TG.info = { configured: false, target: null }; return; }
    TG.loading = true;
    fetch('/api/publish/telegram', { cache: 'no-store', credentials: 'same-origin' }).then(r => r.ok ? r.json() : null).catch(() => null).then(j => {
      TG.loading = false; TG.info = { configured: !!(j && j.ok && j.configured), target: j && j.target || null };
      window.tgInfo = TG.info; repaint('telegram', true);
      if (typeof render === 'function' && typeof view !== 'undefined' && view === 'settings') render();
    });
  }
  window.tgLoad = tgLoad;
  const tgOn = () => !!(TG.info && TG.info.configured);
  const tgText = p => `# ${p.title}\n\n${String(p.body || '').trim()}`;
  function tgConfirm(p, again) {
    if (!p || p.sample || TG.sending[p.id]) return;
    const prev = markdownToPlain(tgText(p)).replace(/\s+/g, ' ').trim().slice(0, 140);
    modal(`<div class="modalhead"><h2 id="modalTitle">${again ? '텔레그램에 다시 올릴까요?' : '텔레그램에 올릴까요?'}</h2><button class="close" data-action="close" aria-label="닫기">×</button></div>
      <p>채널 · <b>${esc(TG.info.target || '')}</b></p><p class="small" style="white-space:pre-wrap">${esc(prev)}…</p>
      <p><b>이 채널에 바로 올라가요. 되돌릴 수 없어요.</b>${again ? ' 이미 올린 글은 그대로 남고, 새 글이 하나 더 올라가요.' : ''}</p>
      <div class="modalfooter"><button type="button" class="btn ghost" data-action="close">취소</button><button type="button" class="btn primary" data-pl-tgyes="${esc(p.id)}" data-again="${again ? 1 : ''}">올리기</button></div>`);
  }
  async function tgSend(id, again) {
    const p = db.posts.find(x => x.id === id);
    if (!p || p.sample || TG.sending[id] || (p.publish?.state === 'published' && !again)) return;
    TG.sending[id] = true; T.err.telegram = ''; repaint('telegram', true);
    try {
      const r = await fetch('/api/publish/telegram', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: tgText(p), postId: p.id, force: !!again }) });
      const j = await r.json().catch(() => null);
      if (!r.ok || !j || !j.ok) throw Error(j && j.message || (r.status === 401 ? '로그인이 필요해요. 다시 로그인하세요.' : '올리지 못했어요. 잠시 뒤에 다시 해 주세요.'));
      const url = j.url || '';
      p.publish = { state: 'published', requestedAt: Date.now(), url, message: '텔레그램 자동 올리기' };
      p.publicationCheck = { url, note: '자동 올리기', at: Date.now(), auto: true };
      p.updated = Date.now(); S.opened[p.id] = true; save();
      log('텔레그램 자동 올리기: ' + p.title); persist(); toast('텔레그램에 올렸어요');
    } catch (e) { T.err.telegram = e.message || '올리지 못했어요.'; }
    delete TG.sending[id]; repaint('telegram', true);
  }
  const tgHelp = () => `<details class="pl-help"><summary>자동 올리기 켜기</summary><ol class="small">
      <li>Telegram에서 <b>@BotFather</b> → <code>/newbot</code> → 토큰을 받아요.</li>
      <li>그 봇을 내 채널 <b>관리자</b>로 추가해요 (글 올리기 권한 켜기).</li>
      <li>Vercel → Settings → Environment Variables에 <code>TELEGRAM_BOT_TOKEN</code>, <code>TELEGRAM_CHAT_ID</code>(<code>@채널아이디</code>)를 넣고 Redeploy 해요.</li></ol></details>`;


  // ===== 링크 → 주제 (링크 먼저 계정: KR Content for SG · 덧글배심원) =====
  const LK = c => T.link[c] || (T.link[c] = { url: '', busy: false, res: null, options: null, answer: '', copied: false, paste: '', pasteOpen: false });
  const normUrl = raw => { const u = String(raw || '').trim(); return u && !/^[a-z][a-z0-9+.-]*:/i.test(u) ? 'https://' + u : u; };
  const hostOf = u => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (_) { return ''; } };
  // 서버가 안 될 때: 링크(와 붙여 넣은 본문)만으로 부탁 글을 브라우저에서 만든다
  function offlineRes(account, url, pasted) {
    const source = { url, finalUrl: url, siteName: hostOf(url), host: hostOf(url), title: '', description: '', image: '', date: '', channel: '', textChars: (pasted || '').length, text: (pasted || '').slice(0, 12000), partial: !pasted, pasted: !!pasted, truncated: false };
    return { ok: true, offline: true, mode: 'manual', source, prompt: FNLink.buildPrompt(account, source) };
  }
  async function linkRead(c, usePaste) {
    const L = LK(c), a = igCur(), url = normUrl(L.url), pasted = usePaste ? String(L.paste || '').trim() : '';
    if (!url) { T.err[c] = '링크를 먼저 붙여 넣어 주세요.'; repaint(c, true); return; }
    try { const u = new URL(url); if (!/^https?:$/.test(u.protocol)) throw 0; } catch (_) { T.err[c] = '링크 형식이 올바르지 않아요. https:// 로 시작하는 주소를 붙여 넣어 주세요.'; repaint(c, true); return; }
    if (usePaste && !pasted) { T.err[c] = '붙여 넣을 본문이나 댓글을 먼저 적어 주세요.'; repaint(c, true); return; }
    L.url = url; L.busy = true; L.options = null; L.answer = ''; L.copied = false; if (!usePaste) L.res = null; T.err[c] = ''; repaint(c, true);
    try {
      let data = null, status = 0;
      try {
        const r = await jfetch('/api/generate/link', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url, account: a, ...(pasted ? { pastedText: pasted.slice(0, 12000) } : {}) }) }, 90000);
        status = r.status; data = await r.json().catch(() => null);
      } catch (_) { data = null; }
      if (!data || (typeof data.ok !== 'boolean')) {
        L.res = offlineRes(a, url, pasted); T.err[c] = '이 화면에서는 서버가 링크를 읽을 수 없어요(서버 연결 없음). 링크만으로 Claude 채팅용 부탁 글을 만들었어요. 본문을 직접 붙여 넣어도 돼요.';
      } else if (!data.ok) {
        L.res = { ok: false, mode: 'manual', source: { ...offlineRes(a, url, pasted).source, ...(data.source || {}) }, prompt: data.prompt || offlineRes(a, url, pasted).prompt, failed: true };
        T.err[c] = status === 401 ? data.message || '로그인이 필요해요. 다시 로그인하세요.' : data.message || '링크를 읽지 못했어요.'; if (status !== 401) L.pasteOpen = true;
      } else {
        L.res = data;
        if (data.mode === 'ai' && Array.isArray(data.options)) L.options = data.options.map(o => ({ title: String(o.title || ''), angle: String(o.angle || ''), cardOutline: o.cardOutline || [], keyFacts: o.keyFacts || [], caution: String(o.caution || '') })).filter(o => o.title);
        if (data.aiError) T.err[c] = data.aiError;
        if (data.source && data.source.partial && !data.source.pasted) L.pasteOpen = true;
      }
    } finally { L.busy = false; repaint(c, true); }
  }
  async function linkCopy(c) {
    const L = LK(c); if (!L.res) return;
    const ok = await copyText(L.res.prompt); window.open(CLAUDE_URL, '_blank', 'noopener');
    L.copied = ok ? true : 'fail';
    toast(ok ? '복사했어요. Claude 입력칸에 붙여 넣고 보내세요.' : '복사하지 못했어요. "부탁 글 보기"를 열어 직접 복사해 주세요.'); repaint(c, true);
  }
  function linkParse(c) {
    const L = LK(c);
    try { L.options = FNLink.parseAnswer(L.answer); T.err[c] = ''; } catch (e) { T.err[c] = e.message; }
    repaint(c, true);
  }
  function linkPick(c, i) {
    const L = LK(c), o = L.options && L.options[i], a = igCur(); if (!o || !L.res) return;
    const day = FNLink.today(), f = FNLink.ideaFields(a, o, L.res.source, day);
    const idea = { id: uid(), title: f.title, note: f.note, sources: f.sources, platform: PF_NAME[c], sample: false, created: Date.now(), preferredChannel: 'insta', igAccount: a, fromLink: { url: L.res.source.url, account: a, checked: day } };
    db.ideas.unshift(idea); log('링크로 만든 주제: ' + idea.title); persist();
    S.sel[c] = { ideaId: idea.id }; save(); T.link[c] = null; T.err[c] = ''; T.view[c] = 1; toast('주제를 정했어요. 이제 초안을 만들어요.'); repaint(c, true);
  }
  function linkBody(c, it, pickerBody) {
    if (it.post) return pickerBody(it);
    const L = LK(c), a = igCur(), cfg = FNLink.ACCOUNTS[a], res = L.res, src = res && res.source;
    const input = `<div class="pl-link-in"><label class="pl-own" for="plLinkUrl"><span class="pl-link-label">${esc(cfg.label)}</span><input id="plLinkUrl" class="pl-input pl-biginput" type="url" inputmode="url" autocomplete="off" placeholder="${esc(cfg.placeholder)}" value="${esc(L.url)}"></label>
      <button type="button" class="pl-primary pl-bigbtn" data-pl-lkread ${L.busy ? 'disabled' : ''}>${L.busy ? '링크 읽는 중…' : '이 링크로 주제 만들기'}</button></div>`;
    let read = '';
    if (src) {
      const thumb = src.image ? `<img class="pl-link-thumb" src="${esc(src.image)}" alt="" referrerpolicy="no-referrer" loading="lazy" onerror="this.remove()">` : '';
      const warn = src.pasted ? '<p class="pl-warn">붙여 넣은 본문·댓글을 기준으로 해요.</p>' : src.partial ? '<p class="pl-warn">일부만 읽혔을 수 있어요. 사이트가 읽기를 막았다면 아래 "본문·댓글 직접 붙여 넣기"를 써 주세요.</p>' : '';
      read = `<div class="pl-link-read">${thumb}<div class="pl-link-meta"><b>${esc(src.title || '(제목을 못 읽었어요)')}</b><span class="small">${esc([src.siteName, src.channel, src.date && String(src.date).slice(0, 10)].filter(Boolean).join(' · '))}</span><span class="small">읽은 내용 ${num(src.textChars || 0)}자${src.truncated ? ' · 너무 커서 앞부분만' : ''}</span></div></div>${warn}`;
    }
    let opts = '';
    if (L.options && L.options.length) opts = `<div class="pl-link-opts" role="group" aria-label="주제 후보"><p class="pl-note">마음에 드는 주제를 누르세요.</p>${L.options.map((o, i) => `<button type="button" class="pl-link-opt" data-pl-lkpick="${i}"><b>${esc(o.title)}</b>${o.angle ? `<span class="pl-link-angle">${esc(o.angle)}</span>` : ''}${o.cardOutline.length ? `<ol class="pl-link-cards">${o.cardOutline.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}${o.caution ? `<span class="pl-warn">확인: ${esc(o.caution)}</span>` : ''}</button>`).join('')}</div>`;
    else if (res) opts = `<div class="pl-manual"><p class="pl-note">Claude 채팅(구독)으로 이어가요. 부탁 글을 복사해 Claude에 붙여 넣고, 받은 답을 아래에 붙여 넣으세요.</p>
        <button type="button" class="pl-primary again" data-pl-lkcopy>Claude 채팅용으로 복사 · 열기</button>
        ${L.copied === 'fail' ? '<p class="pl-error" role="alert">복사가 안 됐어요. 아래 "부탁 글 보기"를 열어 직접 복사해 주세요.</p>' : ''}
        <label class="pl-own" for="plLinkAnswer"><span>Claude 답 붙여 넣기</span><textarea id="plLinkAnswer" class="pl-answer" placeholder="여기에 Claude의 답 붙여 넣기" aria-label="Claude의 답">${esc(L.answer)}</textarea></label>
        <button type="button" class="pl-primary again" data-pl-lkparse>주제 만들기</button>
        <details class="pl-peek"><summary>부탁 글 보기</summary><pre>${esc(res.prompt)}</pre></details></div>`;
    const paste = res ? `<details class="pl-peek pl-paste" ${L.pasteOpen ? 'open' : ''}><summary>본문·댓글 직접 붙여 넣기</summary><p class="small">${esc(cfg.pasteHint)} 붙여 넣은 글이 있으면 사이트에서 읽은 내용 대신 이것을 써요.</p><textarea id="plLinkPaste" class="pl-answer" placeholder="여기에 붙여 넣기" aria-label="본문·댓글">${esc(L.paste)}</textarea><button type="button" class="pl-primary again" data-pl-lkpaste>이 내용으로 다시 만들기</button></details>` : '';
    return input + read + opts + paste + `<details class="pl-peek pl-list"><summary>또는 목록에서 고르기</summary>${pickerBody(it)}<button type="button" class="pl-primary again" data-pl-lkcommit>이 주제로 정하기</button></details>`;
  }
  function linkStep1(c, S1) {
    const S1body = S1.body;
    return {
      title: '링크로 주제 만들기', desc: '글 링크를 붙여 넣으면 주제 3개를 만들어 드려요. 링크가 안 읽히면 본문을 직접 붙여 넣을 수 있어요.',
      noBtn: true, body: it => linkBody(c, it, S1body), run: () => {},
    };
  }

  function genericSteps(c) {
    const pf = PF_NAME[c], blog = c === 'blog', pbook = PLATFORM_PLAYBOOK[pf] || {};
    const S1 = {
      id: 'topic', name: '주제', title: '주제 고르기', desc: `${blog ? '블로그에' : pf + '에'} 쓸 주제를 하나 정하세요. 목록에서 고르거나 직접 적어도 돼요.`,
      btn: '이 주제로 정하기',
      isDone: it => !!(it.post || it.idea),
      hideBtn: it => !!it.post,
      result: it => it.post || it.idea ? `<b>${esc(it.title)}</b>${sampleTag(it.post || it.idea)}` : '',
      body: it => it.post ? '<p class="pl-note">원고가 이미 있어서 주제는 바꿀 수 없어요. 다른 글은 위의 <b>＋ 새 작업</b>으로 시작하세요.</p>' : pickerHtml(c, it),
      run: it => { if (commitTopic(c)) { T.view[c] = 0; repaint(c); } },
    };
    const lf = c === 'insta' && !!IG_BY_ID[igCur()].linkFirst;
    if (lf) Object.assign(S1, linkStep1(c, S1));
    const S2 = {
      id: 'draft', name: '초안', title: blog ? 'AI 초안 만들기' : '초안 만들기',
      desc: 'AI가 첫 초안을 써요. 직접 겪은 일은 [내 경험]으로 비워 두고, 확인 못 한 사실은 [확인 필요]로 표시해요.',
      btn: it => T.busy[c] ? '만드는 중…' : T.manual[c] ? (T.askCopied[c] === true ? '원고로 저장하기' : '부탁 글 복사 · Claude 열기') : 'AI 초안 만들기',
      disabled: it => !!T.busy[c] || !it.idea,
      hideBtn: it => !!it.post,
      isDone: it => !!it.post,
      result: it => { if (!it.post) return ''; const m = marksOf(it.post.body); return `<b>${num(it.post.body.length)}자 초안</b> · ${marksText(m)}`; },
      body: it => {
        if (it.post) return '';
        if (!it.idea) return '<p class="pl-note">먼저 앞 단계에서 주제를 정해 주세요.</p>';
        const copied = T.askCopied[c];
        const manual = T.manual[c] ? `<div class="pl-manual"><p class="pl-note">Claude 채팅(구독)으로 이어가요. 부탁 글을 복사해 Claude에 붙여 넣고, 받은 답을 아래에 붙여 넣으세요.</p>
          ${copied === 'fail' ? '<p class="pl-error" role="alert">복사가 안 됐어요. 아래 "부탁 글 보기"를 열어 직접 복사해 주세요.</p>' : ''}
          ${copied ? `<textarea id="plAnswer" class="pl-answer" placeholder="여기에 Claude의 답 붙여 넣기" aria-label="Claude의 답">${esc(T.answer[c] || '')}</textarea><p class="small"><button type="button" class="pl-link" data-pl-recopy>부탁 글 다시 복사</button> · <button type="button" class="pl-link" data-pl-retryauto>자동 생성 다시 시도</button></p>` : '<p class="small"><button type="button" class="pl-link" data-pl-retryauto>자동 생성 다시 시도</button></p>'}
          <details class="pl-peek"><summary>부탁 글 보기</summary><pre>${esc(askText(c, it.idea))}</pre></details></div>` : '';
        return manual + (!T.manual[c] ? `<p class="pl-note">주제 · <b>${esc(it.idea.title)}</b><br><button type="button" class="pl-link" data-pl-manualmode>Claude 채팅으로 직접 하기</button></p>` : '');
      },
      run: it => {
        if (!T.manual[c]) return autoDraft(c, it);
        if (T.askCopied[c] === true) return saveManual(c, it);
        return manualCopy(c, it);
      },
    };
    const fill = {
      id: 'fill', name: '빈칸', title: '빈칸 채우기', desc: '[내 경험]은 직접 겪은 일로, [확인 필요]는 확인한 사실로 바꿔 넣으세요. 다 채우거나 지우면 다음으로 갈 수 있어요.',
      btn: '원고 열어서 빈칸 채우기', disabled: it => !it.post,
      isDone: it => !!it.post && marksOf(it.post.body).total === 0,
      result: it => { if (!it.post) return ''; const m = marksOf(it.post.body); return m.total ? `남은 빈칸 <b>${m.total}곳</b> · ${marksText(m)}` : '<b>✓ 빈칸 없음</b>'; },
      run: it => openEditor(it),
    };
    const checkBody = it => !it.post ? '' : `<div class="pl-checks">${checks.map((t, k) => `<label class="pl-check"><input type="checkbox" data-pl-check="${k}" ${it.post.checks[k] ? 'checked' : ''}><span>${esc(t)}</span></label>`).join('')}</div>`
      + (it.post.status === 'approved' ? '<p class="small"><button type="button" class="pl-link" data-pl-unapprove>승인 취소하고 다시 고치기</button></p>' : '');
    const review = blog ? {
      id: 'review', name: '검수·승인', title: '검수 3가지 확인', desc: '아래 3가지를 읽고 맞으면 하나씩 체크한 뒤 승인하세요.',
      btn: '승인하기', disabled: it => !it.post, hideBtn: it => it.post && it.post.status === 'approved',
      isDone: it => !!it.post && it.post.status === 'approved',
      result: it => !it.post ? '' : it.post.status === 'approved' ? '<b>✓ 승인 완료</b> · 이제 올릴 수 있어요' : `체크 ${it.post.checks.filter(Boolean).length}/3 · 승인 전`,
      body: checkBody, run: it => approve(c, it),
    } : {
      id: 'review', name: '확인·승인', title: '확인하고 승인하기', desc: '빈칸을 채우고 아래 3가지를 체크한 뒤 승인하세요.',
      btn: it => it.post && marksOf(it.post.body).total ? '원고 열어서 빈칸 채우기' : '승인하기', disabled: it => !it.post,
      hideBtn: it => it.post && it.post.status === 'approved',
      isDone: it => !!it.post && it.post.status === 'approved',
      result: it => { if (!it.post) return ''; if (it.post.status === 'approved') return '<b>✓ 승인 완료</b> · 이제 올릴 수 있어요'; const m = marksOf(it.post.body); return m.total ? `남은 빈칸 <b>${m.total}곳</b> · ${marksText(m)}` : `빈칸 없음 · 체크 ${it.post.checks.filter(Boolean).length}/3`; },
      body: checkBody, run: it => marksOf(it.post.body).total ? openEditor(it) : approve(c, it),
    };
    const bridgeOn = blog && isConnected('blog');
    const tg = c === 'telegram', auto = it => tg && tgOn() && !(it.post && it.post.sample);
    if (tg) tgLoad();
    const upload = {
      id: 'upload', name: '업로드', title: blog ? '네이버 블로그에 올리기' : `${NAME[c]}에 올리기`,
      desc: it => auto(it) ? '버튼을 누르면 확인 창이 떠요. 올리면 채널에 바로 게시돼요.' : blog ? (bridgeOn ? '자동 채우기로 네이버 글쓰기 칸에 넣어요. 올린 뒤 글 주소를 남기세요.' : '본문을 복사하고 네이버 글쓰기를 열어요. 붙여 넣고 올린 뒤 글 주소를 남기세요.')
        : `글을 복사하고 ${NAME[c]}를 열어요. 붙여 넣고 올린 뒤 글 주소를 남기세요.`,
      btn: it => !it.post ? '올리기' : auto(it) && !uploaded(it.post.id, it.post) ? (TG.sending[it.post.id] ? '올리는 중…' : '텔레그램에 올리기') : uploaded(it.post.id, it.post) ? '주소 남기기' : blog ? (bridgeOn ? '네이버 자동 채우기' : '본문 복사 · 네이버 글쓰기 열기') : `글 복사 · ${NAME[c]} 열기`,
      disabled: it => !it.post || it.post.status !== 'approved' || !!it.post.sample || !!TG.sending[it.post.id],
      hideBtn: it => !!(it.post && it.post.publicationCheck),
      isDone: it => !!(it.post && it.post.publicationCheck),
      result: it => it.post && it.post.publicationCheck ? `<b>${doneLink(it.post.publicationCheck)}</b>` : it.post && uploaded(it.post.id, it.post) ? '올리는 중 · 올린 뒤 아래에 글 주소를 남겨 주세요' : '',
      body: it => {
        if (!it.post) return '';
        if (it.post.sample) return '<p class="pl-error">예시 원고는 올릴 수 없어요. 진짜 원고로 만들어 주세요.</p>';
        if (it.post.status !== 'approved') return '<p class="pl-note">먼저 앞 단계에서 승인해 주세요.</p>';
        if (tg && it.post.publicationCheck && it.post.publish?.state === 'published' && auto(it)) return `<p class="small"><button type="button" class="pl-nav-btn" data-pl-tgagain ${TG.sending[it.post.id] ? 'disabled' : ''}>다시 올리기</button></p>`;
        const tgHint = tg && !it.post.publicationCheck ? (auto(it) ? (uploaded(it.post.id, it.post) ? '<p class="small"><button type="button" class="pl-link" data-pl-tgauto>직접 올리기 대신 자동으로 올리기</button></p>' : `<p class="small">올릴 곳 · <b>${esc(TG.info.target || '')}</b></p>`) : TG.info ? tgHelp() : '') : '';
        const fail = it.post.publish?.state === 'failed' ? `<p class="pl-error" role="alert">자동 채우기 실패: ${esc(it.post.publish.message || '')}</p>` : '';
        const alt = bridgeOn && !it.post.publicationCheck ? '<p class="small"><button type="button" class="pl-link" data-pl-copyopen>자동 채우기 대신 복사해서 직접 올리기</button></p>' : '';
        const form = it.post.publicationCheck ? '' : uploaded(it.post.id, it.post) ? urlFormHtml(it.post.id) : '';
        const manualAlt = auto(it) && !it.post.publicationCheck && !uploaded(it.post.id, it.post) ? '<p class="small"><button type="button" class="pl-link" data-pl-copyopen>복사해서 직접 올리기</button></p>' : '';
        return fail + form + tgHint + manualAlt + alt + (blog && it.post.naverCategory ? `<p class="small">네이버 카테고리 · <b>${esc(it.post.naverCategory)}</b></p>` : '');
      },
      run: it => {
        const p = it.post;
        if (p.publicationCheck) return;
        if (auto(it) && !uploaded(p.id, p)) return tgConfirm(p, false);
        if (!uploaded(p.id, p)) {
          if (bridgeOn) { Promise.resolve(sendToBridge(p.id)).then(() => repaint(c)); return; }
          return copyOpen(c, p);
        }
        recordUrl(c, p.id, p, p.title);
      },
    };
    if (c !== 'insta') return blog ? [S1, S2, fill, review, upload] : [S1, S2, review, upload];
    // 인스타(카드뉴스): 확인·승인 뒤에 그림(Codex) 단계, 업로드에서는 캡션 복사 + 그림 파일 저장
    const art = codexArtStep(c, it => postOpts(c, it));
    const b0 = upload.body;
    upload.desc = '캡션을 복사하고 인스타를 열어요. 아래에서 그림을 파일로 저장해 순서대로 올리고, \'AI 정보\' 표시를 켠 뒤 글 주소를 남기세요.';
    upload.btn = it => !it.post ? '올리기' : uploaded(it.post.id, it.post) ? '주소 남기기' : '캡션 복사 · 인스타 열기';
    upload.body = it => {
      const o = postOpts(c, it);
      const imgs = o ? `<div class="pl-imgs"><p class="pl-note"><b>올릴 그림 ${CodexImg.doneCount(o)}/${o.cards.length}장</b> · 인스타에는 아래 순서대로 올리세요.</p>${CodexImg.gallery(o)}<p><button type="button" class="pl-nav-btn" data-pl-cxdl ${CodexImg.doneCount(o) ? '' : 'disabled'}>그림 전부 파일로 저장</button></p></div>` : '';
      return b0(it) + imgs;
    };
    return [S1, S2, review, art, upload];
  }

  // ===== YouTube (맥 실행기 단계를 같은 틀에 그린다) =====
  // 유튜브 작업 순서 (모든 채널·형식 같음, 8칸): 원본 링크 → 편집 스타일 선택 → 최종 결과물 레퍼런스 → 링크 영상 다운 → 1차 편집 → 자막 넣기 → 2차 편집 → 최종 편집안 다운로드
  // 편집 룩 목록: 실행기 /status 의 looks 와 같아요. 실행기가 꺼져 있어도 고를 수 있게 여기에도 둬요.
  const YT_LOOKS = [
    { id: 'yt-wrestling', name: '기본 룩', desc: '흰 자막 + 첫 1.5초 제목 카드 (레슬링 채널 기본)' },
    { id: 'yt-christian', name: '배너 룩', desc: '남색 배너 + 민트 강조 + 흑백 인트로 + 한·영 자막 (기독교 채널 기본)' },
    { id: 'yt-politics', name: '펀치 룩', desc: '첫 1초 훅 제목 + 굵은 자막 + 노란 강조 + 워터마크 (정치 채널 기본)' },
    { id: 'yt-mat', name: '매트 스토리 룩', desc: '검은 바탕 + 위 2줄 제목(노랑·빨강) + 굵은 자막 + 선수 태그·점수 도장·SLOW 표시 + 원본 경기 소리 (레슬링 추천)' },
    { id: 'yt-raw', name: '리얼 룩', desc: '꽉 찬 경기 화면 + 노란 굵은 자막(검은 테두리) + 제목 카드 없음 + 원본 소리 · 참고: Lethal Double Leg 쇼츠 310만 회', pack: 'raw' },
    { id: 'yt-steps', name: '단계 룩', desc: '위에 검은 상자 흰 글씨 제목 + 아래 흰 굵은 자막 + 원본 소리 · 참고: 더블렉 단계 강의 쇼츠 180만 회', pack: 'steps' },
    { id: 'yt-words', name: '말자막 룩', desc: '굵은 기울임 흰 자막(두꺼운 검은 테두리) + 하늘색 강조 단어 + 원본 소리 · 참고: 코치 말자막 강의 쇼츠 71만 회', pack: 'words' },
    { id: 'yt-tags', name: '라벨 룩', desc: '파란 둥근 알약 상자에 흰 굵은 자막 + 아래쪽 배치 + 원본 소리 · 참고: 라벨 태그 기술 쇼츠 150만 회', pack: 'tags' },
  ];
  // 룩 미리보기: 9:16 미니 화면 (HTML/CSS만, 이미지·네트워크 없음). 모르는 id는 빈 문자열 → 칩은 글자만.
  const YT_LOOK_MOCKS = {
    'yt-wrestling': '<i class="lm-v"></i><i class="lm-a lm-w1" style="top:10%;left:0;right:0">오늘의 경기</i><i class="lm-a lm-sub" style="top:68%;left:0;right:0">이 기술 보세요</i>',
    'yt-christian': '<i class="lm-a" style="top:0;left:0;right:0;height:23%;background:#0E1B33"></i><i class="lm-a lm-s" style="top:4%;left:0;right:0">오늘의 말씀</i><i class="lm-a" style="top:11%;left:8%;right:8%;height:1px;background:#3DE0C0"></i><i class="lm-a lm-b" style="top:14%;left:0;right:0;font-size:9px">은혜의 <u>길</u></i><i class="lm-v" style="top:23%;filter:grayscale(1)"></i><i class="lm-a" style="top:60%;left:7%;right:7%;height:8%;border-radius:4px;background:rgba(10,14,24,.78)"></i><i class="lm-a lm-s" style="top:60.6%;left:0;right:0;font-size:5.5px;font-weight:700">빛 가운데 <u>걸으라</u></i><i class="lm-a lm-s" style="top:64.6%;left:0;right:0;font-size:4px;opacity:.85">Walk in the light</i>',
    'yt-politics': '<i class="lm-v" style="left:11%;right:11%;top:11%;bottom:11%"></i><i class="lm-a" style="top:2.5%;left:6%;font-size:4px;font-weight:700;color:#fff;letter-spacing:.3px">FIELDNOTE</i><i class="lm-a lm-p" style="top:59%;left:14%;transform:rotate(-4deg)">폭로!</i><i class="lm-a lm-y" style="top:71%;left:0;right:0">오늘의 핵심</i>',
    'yt-mat': '<i class="lm-a lm-t1" style="top:11.5%;left:0;right:0;font-size:7px;color:#FFE100">레슬링 명승부</i><i class="lm-a lm-t1" style="top:17%;left:0;right:0;font-size:7px;color:#FF2B2B">역전의 순간</i><i class="lm-v" style="top:24%;bottom:25%"></i><i class="lm-a" style="top:25.5%;left:3%;padding:1px 3px;border-radius:6px;background:#F23A3A;color:#fff;font-size:4px;font-weight:800">선수 A</i><i class="lm-a" style="top:25.8%;right:3%;font-size:3.5px;font-weight:800;color:#fff;opacity:.85">SLOW</i><i class="lm-a lm-stamp" style="top:40%;left:50%">+2</i><i class="lm-a lm-sub" style="top:61%;left:0;right:0">이 순간 보세요</i><i class="lm-a" style="top:70%;right:3%;font-size:3px;font-weight:800;color:#fff;opacity:.55">MAT STORY</i>',
  };
  YT_LOOK_MOCKS['yt-raw'] = '<i class="lm-v"></i><i class="lm-a lm-y" style="top:68%;left:0;right:0;font-size:9px">이 한 방!</i>';
  YT_LOOK_MOCKS['yt-steps'] = '<i class="lm-v"></i><i class="lm-a" style="top:6%;left:16%;right:16%;padding:2px 0;background:#000;color:#fff;font-size:5px;font-weight:800">1. 낮추기</i><i class="lm-a lm-sub" style="top:80%;left:0;right:0">낮게 시작해요</i>';
  YT_LOOK_MOCKS['yt-words'] = '<i class="lm-v"></i><i class="lm-a lm-wd" style="top:58%;left:0;right:0">머리를 <u style="color:#3EE6FF">낮추고</u></i>';
  YT_LOOK_MOCKS['yt-tags'] = '<i class="lm-v"></i><i class="lm-a" style="top:70%;left:12%;right:12%;padding:3px 0;border-radius:99px;background:#1E88FF;color:#fff;font-size:5.5px;font-weight:800">이 기술 보세요</i>';
  YT_LOOK_MOCKS['yt-replay'] = '<i class="lm-v"></i><i class="lm-a" style="top:44%;left:42%;width:16px;height:16px;border:1.5px solid #fff;border-radius:50%;box-shadow:0 0 4px #fff"></i><i class="lm-a" style="top:64%;left:0;right:0;font-size:5.5px;font-weight:900;color:#FFD400;text-shadow:-1px 0 #000,1px 0 #000,0 1px #000,0 -1px #000">준비됐어?</i><i class="lm-a" style="top:76%;left:0;right:0;font-size:3.5px;font-weight:800;opacity:.6">MAT STORY</i>';
  YT_LOOK_MOCKS['yt-breakdown'] = '<i class="lm-v"></i><i class="lm-a" style="top:36%;left:30%;width:22px;height:22px;border:1.5px solid #fff;border-radius:50%;box-shadow:0 0 6px #fff"></i><i class="lm-a" style="top:5%;right:4%;padding:1px 2px;background:#FFD600;color:#000;font-size:3.5px;font-weight:800">SLOW</i><i class="lm-a lm-sub" style="top:80%;left:0;right:0">① 낮추기</i>';
  YT_LOOK_MOCKS['yt-top5'] = '<i class="lm-a" style="inset:0;background:#3a3f4a"></i><i class="lm-a" style="top:4%;left:0;right:0;font-size:8px;font-weight:900">TOP 3</i><i class="lm-a" style="top:12%;left:0;right:0;font-size:6px;font-weight:900;color:#FF3B30">"들어 던지기"</i><i class="lm-v" style="top:22%;bottom:46%"></i><i class="lm-a" style="top:58%;left:12%;font-size:5px;font-weight:800;text-align:left;line-height:1.5">1.<br>2. 허리 감기<br>3. 낮추기</i>';
  YT_LOOK_MOCKS['yt-wordpop'] = '<i class="lm-v"></i><i class="lm-a" style="top:28%;left:30%;font-size:12px;color:#FF2B2B;transform:rotate(-35deg)">⬇</i><i class="lm-a" style="top:58%;left:0;right:0;font-size:9px;font-weight:900;color:#fff;text-shadow:-1px 0 #1E6BFF,1px 0 #1E6BFF,0 1px #1E6BFF,0 -1px #1E6BFF">펀치</i>';
  YT_LOOK_MOCKS['yt-post'] = '<i class="lm-a" style="inset:0;background:#fff"></i><i class="lm-a" style="top:5%;left:6%;width:9px;height:9px;border-radius:50%;background:#FF7A1A"></i><i class="lm-a" style="top:5.5%;left:22%;font-size:3.5px;font-weight:800;color:#000;text-align:left">MAT STORY</i><i class="lm-a" style="top:15%;left:0;right:0;font-size:5.5px;font-weight:900;color:#000;line-height:1.3">충격받는<br>레전드 기술</i><i class="lm-v" style="top:26%;bottom:29%"></i><i class="lm-a" style="top:62%;left:0;right:0;font-size:4.5px;font-weight:800;color:#FFD400;text-shadow:-1px 0 #000,1px 0 #000">(순식간에)</i><i class="lm-a" style="top:76%;left:8%;right:8%;font-size:4px;color:#222;text-align:left">● 이 속도가 말이 안 됨</i>';
  const ytLookMock = id => (YT_LOOK_MOCKS[id] ? `<span class="lm" aria-hidden="true">${YT_LOOK_MOCKS[id]}</span>` : '');
  const ytLooks = () => (runnerData && runnerData.looks && runnerData.looks.length ? runnerData.looks : YT_LOOKS);
  const ytLookDefault = ch => (ch === 'yt-wrestling' || !ch ? 'yt-mat' : YT_LOOKS.some(l => l.id === ch) ? ch : 'yt-mat');
  const ytLookPick = (it, ep) => (it.idea && ytPipe.lookIdea === it.idea.id && ytPipe.look) || (ep && ep.look) || ytLookDefault(ytCh(it.idea));

  // 최종 결과물 레퍼런스(이펙트 팩): 실행기 /status 의 fxPacks 와 같아요 (desc 는 " · " 로 효과를 나열). 실행기가 꺼져 있어도 고를 수 있게 여기에도 둬요.
  const YT_FX_PACKS = [
    { id: 'none', name: '이펙트 없음', desc: '지금처럼 그대로 · 줌·흔들림·효과음 없음', ref: '' },
    { id: 'raw', name: '한 방 리얼', desc: '진짜 경기 화면 그대로 · 훅 문구를 영상 내내 고정 · 줌·흔들림 없음 · 끝에 마지막 2초 0.5배 REPLAY', ref: 'https://www.youtube.com/shorts/vvXC-IW5oOE', views: '310만 회' },
    { id: 'steps', name: '단계 강의', desc: '처음 2.5초 제목 상자 · 구간마다 번호 라벨 · 움직임 순간에 잔상 · 마지막은 "다 합치면"', ref: 'https://www.youtube.com/shorts/hML9vjR6wX0', views: '180만 회' },
    { id: 'words', name: '말자막 강의', desc: '말 자막이 2~4단어씩 나타남 · 강조 단어 하늘색 · ✕ ✓ 아이콘 팝 · 컷마다 빠른 줌 · "띵"/"팡"', ref: 'https://www.youtube.com/shorts/mJIVHZUGw40', views: '71만 회' },
    { id: 'tags', name: '라벨 태그', desc: '핵심 순간마다 파란 알약 라벨이 톡 · 슬로우 시작에 흔들림 · 라벨마다 "휙"', ref: 'https://www.youtube.com/shorts/qDD40BckF20', views: '150만 회' },
    { id: 'match', name: '경기 하이라이트', desc: '슬로우 시작에 흰 플래시 + 줌인 유지 · 컷마다 "휙" · 점수 도장·강조에 흔들림 + "쾅"', ref: 'https://www.youtube.com/shorts/H-wcWuDSIvg' },
    { id: 'calm', name: '잔잔', desc: '클립마다 천천히 줌인 · 컷 사이 짧게 어둡다 밝아짐 · 첫 강조점에 부드러운 "띵"', ref: 'https://www.youtube.com/shorts/op51yRlhjjI' },
    { id: 'punch', name: '펀치', desc: '컷마다 빠른 줌 펀치 · 강조 순간 흔들림 + 흰 플래시 · "팡" 효과음 · 강조 단어 팝', ref: 'https://www.youtube.com/shorts/1zpjOi8_LH0' },
  ];  // 이펙트 미리보기: 9:16 미니 화면이 2.4초마다 되풀이 (CSS 애니메이션만). 룩 미리보기(.lm)와 같은 크기·틀.
  // 팩 하나 = 영상 칸에 붙는 움직임(v) + 영상 칸 안의 층(vo: 플래시·어둡게·잔상) + 화면 위에 얹는 글·도장(o) + 따로 볼 때만 쓰는 자막(own) + 룩의 줄 자막을 가리는지(strip).
  // 칩 하나만 볼 때는 회색 영상 칸 + own + o, "이렇게 나와요" 패널에서는 고른 룩의 그림이 바탕이 되고 그 위에 팩의 층이 얹혀요.
  const ytSub = t => `<i class="lm-a lm-sub" style="top:68%;left:0;right:0">${t}</i>`;
  const YT_FX_LAYERS = {
    none: { v: '', vo: '', o: '', own: ytSub('이펙트 없음') },
    calm: { v: 'fxm-kb', vo: '<i class="fxm-dip"></i>', o: '<i class="lm-a fxm-t fxm-ding" style="top:30%;left:0;right:0">띵</i>', own: ytSub('잔잔하게') },
    punch: { v: 'fxm-pz', vo: '<i class="fxm-flash fxm-fl-p"></i>', o: '<i class="lm-a fxm-t fxm-pop" style="top:30%;left:0;right:0">팡!</i>', own: ytSub('오늘의 <u class="fxm-word">핵심</u>') },
    match: { v: 'fxm-mz', vo: '<i class="fxm-flash fxm-fl-m"></i>', o: '<i class="lm-a fxm-slow" style="top:7%;right:5%">SLOW</i><i class="lm-a fxm-t fxm-swish" style="top:36%;left:0;right:0">휙</i>', own: ytSub('역전 순간') },
    raw: { v: '', vo: '', o: '<i class="lm-a lm-y" style="top:68%;left:0;right:0;font-size:9px">이 한 방!</i><i class="lm-a fxm-rep" style="top:6%;right:5%">REPLAY</i>', own: '', strip: true },
    steps: { v: '', vo: '<i class="fxm-ghost"></i>', o: '<i class="lm-a fxm-box fxm-st0" style="top:6%;left:14%;right:14%">더블렉 강의</i><i class="lm-a fxm-box fxm-st1" style="top:6%;left:20%;right:20%">1. 낮추기</i><i class="lm-a fxm-box fxm-st2" style="top:6%;left:20%;right:20%">2. 밀기</i>', own: '' },
    words: { v: 'fxm-wz', vo: '', o: '<i class="lm-a lm-wd fxm-w1" style="top:58%;left:0;right:0">머리를</i><i class="lm-a lm-wd fxm-w2" style="top:58%;left:0;right:0">낮추고 <u style="color:#3EE6FF">밀어요</u></i><i class="lm-a fxm-x" style="top:22%;left:50%">✕</i>', own: '', strip: true },
    tags: { v: '', vo: '', o: '<i class="lm-a fxm-pill" style="top:62%;left:10%;right:10%">레벨 체인지</i>', own: '' },
  };
  // 영상 칸(<i class="lm-v">) 하나를 감싸는 칸으로: 줌·흔들림이 칸 밖으로 번지지 않게 (룩의 검은 띠를 덮지 않도록)
  const YT_VBOX_RE = /<i class="lm-v"(?: style="([^"]*)")?><\/i>/;
  const YT_STRIP_RE = /<i class="lm-a lm-(?:sub|y|wd)"[^>]*>.*?<\/i>/g;
  // 룩(바탕) + 팩(움직임·글) 합친 9:16 미니 화면. lookId 가 없으면 회색 영상 칸 하나 (칩 하나만 볼 때: alone)
  function ytMockHtml(lookId, packId, alone) {
    const L = YT_FX_LAYERS[packId] || YT_FX_LAYERS.none;
    let base = !alone && YT_LOOK_MOCKS[lookId] ? YT_LOOK_MOCKS[lookId] : '<i class="lm-v"></i>';
    if (L.strip && !alone) base = base.replace(YT_STRIP_RE, '');
    base = base.replace(YT_VBOX_RE, (m, st) => `<i class="lm-vw"${st ? ` style="${st}"` : ''}><i class="lm-v fxm-v ${L.v}"></i>${L.vo}</i>`);
    return `<span class="lm fxm fxm-${YT_FX_LAYERS[packId] ? packId : 'none'}" aria-hidden="true">${base}${alone ? L.own : ''}${L.o}</span>`;
  }
  const ytFxMock = id => (YT_FX_LAYERS[id] ? ytMockHtml('', id, true) : '');
  const ytFxPacks = () => (runnerData && runnerData.fxPacks && runnerData.fxPacks.length ? runnerData.fxPacks : YT_FX_PACKS);
  const ytFxDefault = ch => (ch === 'yt-christian' ? 'calm' : ch === 'yt-politics' ? 'punch' : 'match');
  // 짝: 레퍼런스 룩 ↔ 이펙트 팩. 팩을 직접 고르기 전에는 고른 룩의 짝 팩이 미리 골라져 있어요.
  const ytLookPackOf = id => ((ytLooks().find(l => l.id === id) || {}).pack) || '';
  const ytPackLookOf = id => ytLooks().find(l => l.pack === id) || null;
  const ytLesson = it => (it.idea && ytCh(it.idea) === 'yt-wrestling' ? '<p class="small pl-lesson">잘 되는 레슬링 쇼츠: 5~15초 · 한 번에 찍은 장면 · 결정 장면은 맨 끝 · 이펙트는 적게</p>' : '');
  const ytFxPick = (it, ep) => (it.idea && ytPipe.fxIdea === it.idea.id && ytPipe.fxPack) || (ep && ep.fxPack) || ytLookPackOf(ytLookPick(it, ep)) || (ep && ep.fxPackUsed) || ytFxDefault(ytCh(it.idea));
  const ytFxLabels = (it, ep) => (it.idea && ytPipe.fxIdea === it.idea.id && ytPipe.fxLabels != null ? ytPipe.fxLabels : ((ep && ep.fxLabels) || []).join(', '));
  const ytFxTimes = (it, ep) => (it.idea && ytPipe.fxIdea === it.idea.id && ytPipe.fxTimes != null ? ytPipe.fxTimes : (ep && ep.fxTimes) || '');
  const ytFxRef = p => (S.fxRefs && S.fxRefs[p.id]) || p.ref || '';   // 내가 넣은 링크가 먼저
  const ytFxOld = () => typeof runnerApi === 'number' && runnerApi < 5;
  // ===== "이렇게 나와요" 패널: 지금 고른 대로 만들면 최종 영상이 어떻게 나오는지 (모든 유튜브 단계 카드에 붙어요) =====
  // 그림(CSS 움직이는 미니 화면) + 한 줄 요약 + (링크 영상을 받은 뒤) 실행기가 진짜 영상으로 만든 4초 견본. 칩을 누르면 정하기 전에도 바로 바뀌어요.
  const YT_ORIG_AUDIO = new Set(['yt-mat', 'yt-raw', 'yt-steps', 'yt-words', 'yt-tags']);   // 원본 경기 소리를 살리는 룩 (실행기 MAT_DEFAULTS.audio)
  const YT_SFX_PACKS = new Set(['words', 'tags', 'match', 'calm', 'punch']);                // 효과음이 들어가는 팩
  const ytClock = x => String(x).split(':').reduce((a, n) => a * 60 + (+n || 0), 0);
  // "0:30-0:42, 1:05-1:09x0.5" → { n, sec, all }  (슬로우는 길어져요: 0.5배 = 2배 길이)
  function ytRangeInfo(str) {
    const s = String(str || '').trim(); if (!s) return null;
    if (/^(전체|all)$/i.test(s)) return { n: 1, sec: 58, all: true };
    let n = 0, sec = 0;
    for (const t of s.split(/[,\s]+/).filter(Boolean)) {
      const m = /^(\d+(?::\d{1,2}){0,2})\s*[-~–]\s*(\d+(?::\d{1,2}){0,2})(?:[x×*@](\d*\.?\d+))?$/i.exec(t); if (!m) continue;
      const a = ytClock(m[1]), b = ytClock(m[2]), sp = m[3] == null ? 1 : +m[3];
      if (b > a) { n++; sec += (b - a) / (sp >= 0.25 && sp <= 1 ? sp : 1); }
    }
    return n ? { n, sec } : null;
  }
  const ytDlOk = ep => !!ep && ['research', 'download'].every(id => (ep.steps || []).some(x => x.id === id && x.status === 'done'));
  const ytRangesNow = (it, ep) => ytPipe.ranges || ((ep && ep.sources && ep.sources[0] && ep.sources[0].ranges) || []).join(', ');
  function ytOutInfo(it) {
    const ep = it.ep, has = !!it.idea;
    if (!has) return { has: false };
    const look = ytLookPick(it, ep), pack = ytFxPick(it, ep), lk = ytLooks().find(l => l.id === look), pk = ytFxPacks().find(p => p.id === pack);
    const lookSet = (ytPipe.lookIdea === it.idea.id && ytPipe.look) || (ep && ep.look), packSet = (ytPipe.fxIdea === it.idea.id && ytPipe.fxPack) || (ep && ep.fxPack);
    const r = ytRangeInfo(ytRangesNow(it, ep));
    const sec = r ? Math.min(58, Math.round(r.sec + (pack === 'raw' && !r.all && r.sec >= 2 ? 4 : 0))) : 0;   // 한 방 리얼: 끝에 마지막 2초를 0.5배로 한 번 더 (= 4초)
    const orig = YT_ORIG_AUDIO.has(look), sfx = YT_SFX_PACKS.has(pack);
    return { has: true, look, pack, lookName: lk ? lk.name : look, packName: pk ? pk.name : pack, lookSet: !!lookSet, packSet: !!packSet,
      n: r ? (r.all ? '전체' : r.n + '개') : '', sec, sound: (orig ? '원본 경기 소리' : '목소리·배경음악') + (sfx ? ' + 효과음' : '') };
  }
  // 견본 상태 (실행기 api 8 이상). 같은 입력이면 다시 만들지 않고, 바뀌면 600ms 뒤에 요청해요.
  const YP = { key: '', state: 'idle', path: '', msg: '', mode: 'real', seq: 0, timer: 0, cache: new Map(), ms: 0 };
  const ytPrevOn = () => typeof runnerApi === 'number' && runnerApi >= 8 && runnerOnline === true;
  function ytPrevWanted(it) {
    const ep = it.ep; if (!ep || !ytPrevOn() || !ytDlOk(ep)) return null;
    const dl = ((ep.steps || []).find(x => x.id === 'download') || { outputs: [] }).outputs.map(o => o.mtime || 0).join(',');
    const look = ytLookPick(it, ep), pack = ytFxPick(it, ep), times = ytFxTimes(it, ep).trim(), labels = ytFxLabels(it, ep).split(',').map(x => x.trim()).filter(Boolean);
    const first = ((ep.sources && ep.sources[0] && ep.sources[0].ranges) || [])[0] || '';
    return { body: { ep: ep.ep, look, pack, times, labels }, key: JSON.stringify([ep.ep, look, pack, times, labels, first, dl]) };
  }
  const ytPrevMsg = m => { const t = String(m || '').replace(/^Error:\s*/, ''); return /Failed to fetch|NetworkError|Load failed/i.test(t) ? '실행기와 연결이 끊겼어요.' : t.length > 80 ? t.slice(0, 80) + '…' : t || '견본을 만들지 못했어요.'; };
  function ytPrevSync() {
    if (!document.getElementById('plRoot')) return;
    const { it } = evalSteps('youtube'), w = ytPrevWanted(it);
    if (!w) { clearTimeout(YP.timer); YP.seq++; YP.key = ''; YP.state = 'idle'; YP.path = ''; ytOutRefresh(); return; }
    if (w.key === YP.key) return;
    YP.key = w.key; clearTimeout(YP.timer); const seq = ++YP.seq, hit = YP.cache.get(w.key);
    if (hit) { YP.state = 'ok'; YP.path = hit; ytOutRefresh(); return; }
    YP.state = 'wait'; YP.path = ''; YP.msg = ''; ytOutRefresh();
    YP.timer = setTimeout(async () => {
      if (seq !== YP.seq) return;
      YP.state = 'busy'; YP.ms = Date.now(); ytOutRefresh();
      try { const r = await runnerFetch('/preview', w.body); if (seq !== YP.seq) return; YP.cache.set(w.key, r.path); YP.path = r.path; YP.state = 'ok'; }
      catch (e) { if (seq !== YP.seq) return; if (/멈췄어요/.test(e.message)) return; YP.state = 'err'; YP.msg = ytPrevMsg(e.message); }
      ytOutRefresh();
    }, 600);
  }
  // 패널만 다시 그려요 (카드 전체를 다시 그리면 입력 중인 글이 끊겨서). 보던 견본 영상은 그대로 두고요.
  function ytOutRefresh() {
    const el = document.getElementById('plOut'); if (!el) return;
    const { it } = evalSteps('youtube'), tmp = document.createElement('div'); tmp.innerHTML = ytOutHtml(it);
    const nx = tmp.firstElementChild, ov = el.querySelector('#plOutVid'), nv = nx.querySelector('#plOutVid');
    if (ov && nv && ov.getAttribute('src') === nv.getAttribute('src')) nv.replaceWith(ov);
    el.replaceWith(nx);
  }
  const ytOutOpen = () => (T.outOpen != null ? T.outOpen : !(window.matchMedia && matchMedia('(max-width:640px)').matches));
  function ytOutHtml(it) {
    const I = ytOutInfo(it), open = ytOutOpen(), ep = it.ep, real = I.has && YP.state === 'ok' && YP.path && YP.mode === 'real' && ep;
    const can = I.has && !!ytPrevWanted(it);
    const line = I.has
      ? `<span><i>스타일</i> <b>${esc(I.lookName)}</b>${I.lookSet ? '' : ' <small>(자동)</small>'}</span><span><i>레퍼런스</i> <b>${esc(I.packName)}</b>${I.packSet ? '' : ' <small>(자동)</small>'}</span><span><i>구간</i> <b>${I.n ? esc(I.n) : '아직'}</b></span><span><i>예상 길이</i> <b>${I.sec ? '약 ' + I.sec + '초' : '아직'}</b></span><span><i>소리</i> <b>${esc(I.sound)}</b></span>`
      : '<span><i>스타일</i> <b>아직</b></span><span><i>레퍼런스</i> <b>아직</b></span><span><i>구간</i> <b>아직</b></span><span><i>예상 길이</i> <b>아직</b></span><span><i>소리</i> <b>아직</b></span>';
    const pv = real
      ? `<video id="plOutVid" class="pl-out-vid" muted loop playsinline autoplay preload="auto" src="${esc(`${RUNNER}/file?ep=${encodeURIComponent(ep.ep)}&path=${encodeURIComponent(YP.path)}`)}" aria-label="실제 영상으로 만든 견본"></video>`
      : `<span class="pl-out-mock${I.has ? '' : ' dim'}">${ytMockHtml(I.has ? I.look : 'yt-mat', I.has ? I.pack : 'none')}</span>`;
    let st = '';
    if (ytPrevOn() && I.has) {
      if (!ytDlOk(ep)) st = '링크 영상을 받으면 실제 영상으로 견본을 보여 줘요.';
      else if (YP.state === 'wait' || YP.state === 'busy') st = '견본 만드는 중…';
      else if (YP.state === 'err') st = YP.msg;
      else if (YP.state === 'ok' && YP.mode === 'real') st = '실제 영상 4초 견본이에요 (자막은 예시 문구).';
      else if (YP.state === 'ok') st = '움직이는 그림이에요. "실제 견본"을 누르면 진짜 영상으로 봐요.';
    }
    const seg = can ? `<div class="pl-out-seg" role="group" aria-label="보기 방식"><button type="button" data-pl-outmode="mock" aria-pressed="${YP.mode === 'mock'}">그림</button><button type="button" data-pl-outmode="real" aria-pressed="${YP.mode === 'real'}">실제 견본</button></div>` : '';
    const big = real ? `<a class="pl-link" href="${esc(`${RUNNER}/file?ep=${encodeURIComponent(ep.ep)}&path=${encodeURIComponent(YP.path)}`)}" target="_blank" rel="noopener noreferrer">크게 보기 ↗</a>` : '';
    const mini = I.has ? `${esc(I.lookName)}${I.sec ? ' · 약 ' + I.sec + '초' : ''}` : '아직';
    return `<section class="pl-out ${open ? 'open' : ''}" id="plOut" aria-label="이렇게 나와요"><button type="button" class="pl-out-h" data-pl-outtoggle aria-expanded="${open}"><b>이렇게 나와요</b><span class="pl-out-mini">${mini}</span><i class="pl-out-car" aria-hidden="true">▾</i></button>
      <div class="pl-out-b"><div class="pl-out-pv">${pv}</div><div class="pl-out-tx"><p class="pl-out-line">${line}</p>${seg}${st ? `<p class="small pl-out-st ${YP.state === 'err' ? 'err' : ''}" role="status">${esc(st)}</p>` : ''}${big}</div></div></section>`;
  }
  // 칸마다 자기 결과물을 바로 볼 수 있게: 받은 원본 · 편집본 · 최종본·썸네일·업로드 글
  const ytSrc = (ep, p, mt) => `${RUNNER}/file?ep=${encodeURIComponent(ep.ep)}&path=${encodeURIComponent(p)}${mt ? '&t=' + mt : ''}`;
  const ytVideoBox = (id, ep, o, label, preload, poster) => `<figure class="pl-vid"><video id="${id}" controls playsinline preload="${preload || 'metadata'}"${poster ? ` poster="${esc(poster)}"` : ''} src="${esc(ytSrc(ep, o.path, o.mtime))}"></video><figcaption class="small">${esc(label)} · <a class="pl-link" href="${esc(ytSrc(ep, o.path, o.mtime))}" target="_blank" rel="noopener noreferrer">새 창 ↗</a></figcaption></figure>`;
  const ytUpTxt = new Map();   // 업로드 글 (경로+시각 → 글). 칸을 다시 그려도 깜빡이지 않게 모아 둬요
  async function ytUpTextHydrate() {
    for (const el of document.querySelectorAll('#plRoot [data-pl-uptxt]')) {
      const k = el.dataset.plUptxt, [p, mt] = k.split('|'), ep = ytItem().ep; if (!ep) continue;
      const key = ep.ep + '|' + k;
      if (ytUpTxt.has(key)) { el.textContent = ytUpTxt.get(key); continue; }
      try { const r = await fetch(ytSrc(ep, p, mt)); if (!r.ok) throw new Error(r.status); const t = (await r.text()).trim(); ytUpTxt.set(key, t); el.textContent = t || '(비어 있어요)'; }
      catch (_) { el.textContent = '업로드 글을 불러오지 못했어요. 위 "제목·설명·태그" 버튼으로 내려받으세요.'; }
    }
  }
  const YT_GROUPS = [
    { id: 'g-dl', name: '링크 영상 다운', ids: ['research', 'download'], desc: '링크의 영상을 맥에 통째로 받아요. 영어 자막이 있으면 같이 받아요.', go: '영상 받기' },
    { id: 'g-cut', name: '컷 편집', ids: ['clip', 'plan', 'rough'], desc: '쓸 구간을 넣으세요. 한 구간은 3분까지예요. 구간을 잘라 이어 붙여 가편집을 만들어요.', go: '컷 편집 실행' },
    { id: 'g-subs', name: '자막 자동화', ids: ['subs'], desc: '영상 속 말을 자동 자막으로 입혀요. 소스 영상의 자막을 쓰고, AI 키가 있으면 한국어로 옮겨요.', go: '자막 넣기' },
    { id: 'g-fx', name: '이펙트', ids: ['fx'], desc: '고른 룩의 배너·훅 제목·흑백 인트로·워터마크를 입혀요. 끝나면 위에서 바로 볼 수 있어요.', go: '이펙트 넣기' },
    { id: 'g-voice', name: '음악/녹음', ids: ['script', 'mix'], desc: '대본을 만들고 한 번 읽어 본 뒤, 줄마다 내 목소리를 녹음하고 배경음악을 골라 합쳐요. 대본 자막도 이때 영상에 들어가요.', go: '대본 만들기' },
    { id: 'g-upload', name: '업로드 패키지', ids: ['upload'], desc: '제목·설명란·태그·썸네일 문구를 한 파일로 만들어요.', go: '업로드 패키지 만들기' },
  ];
  const YT_STEP_NAME = { research: '소스 확인', download: '영상 받기', clip: '구간 자르기', plan: '편집 계획', rough: '가편집', subs: '자막 자동화', fx: '이펙트', script: '대본', mix: '목소리·음악', upload: '업로드 패키지' };
  const YT_PLACEHOLDER = ['원본 링크', '편집 스타일 선택', '최종 결과물 레퍼런스', '링크 영상 다운', '1차 편집', '자막 넣기', '2차 편집', '최종 편집안 다운로드'];
  // 실행기 단계들을 칸(그룹)으로 묶은 상태
  function ytGroupState(ep, g) {
    const sts = g.ids.map(id => (ep.steps || []).find(x => x.id === id)).filter(Boolean);
    const gate = !!ep.gate && g.ids.includes('script');
    const running = sts.find(x => ep.running === x.id) || null, failed = sts.find(x => x.status === 'failed') || null;
    return { sts, gate, running, failed, done: sts.length === g.ids.length && sts.every(x => x.status === 'done') && !gate };
  }
  const ytVideoRe = /\.(mp4|mov|webm)$/i;
  // 편집 영상: 최종본 > 완성본 > 가편집
  function ytEditVideo(ep) {
    if (!ep) return null;
    for (const [sid, file, label] of [['mix', '편집/최종본.mp4', ep.round >= 2 ? `${ep.round}차 편집본` : ep.round === 1 ? '1차 편집본' : '최종본'], ['fx', '편집/완성본.mp4', '완성본 (목소리 전)'], ['subs', '편집/자막본.mp4', '자막본 (이펙트 전)'], ['rough', '편집/가편집.mp4', '가편집 (자막 전)']]) {
      const o = ((ep.steps || []).find(x => x.id === sid) || { outputs: [] }).outputs.find(x => x.path === file && x.exists);
      if (o) return { path: o.path, label, mtime: o.mtime };
    }
    return null;
  }
  const ytVideoSrc = (ep, v) => `${RUNNER}/file?ep=${encodeURIComponent(ep.ep)}&path=${encodeURIComponent(v.path)}${v.mtime ? '&t=' + v.mtime : ''}`;
  function ytPlayerHtml(it) {
    if (runnerOnline === false || !it.ep) return '';
    const v = ytEditVideo(it.ep); if (!v) return '';
    const src = ytVideoSrc(it.ep, v);
    return `<section class="pl-player" id="ytPlayer" aria-label="편집본"><div class="pl-player-h"><b>편집본</b><span class="pl-player-v">${esc(v.label)}</span><a class="pl-link" href="${esc(src)}" target="_blank" rel="noopener noreferrer">새 창에서 열기 ↗</a></div><video id="ytPlayerVid" controls playsinline preload="metadata" src="${esc(src)}"></video></section>`;
  }
  // ===== 링크 제공 (1단계): 유튜브 링크 → 제목 → 주제 =====
  const YL = { url: '', title: '', view: '', orig: '', author: '', state: '', vid: '', edited: false, timer: 0 };
  const YT_URL_RE = /^https?:\/\/(?:www\.|m\.)?(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|shorts\/)|youtu\.be\/)([\w-]{6,})/;
  const ytVidOf = u => { const m = String(u || '').trim().match(YT_URL_RE); return m ? m[1] : ''; };
  function ytLinkSources(ch) {
    const g = (typeof YT_SOURCE_CHANNELS !== 'undefined' ? YT_SOURCE_CHANNELS : []).find(x => x.id === ch), seen = {};
    return (g ? g.sources : []).filter(s => s.enabled !== false && s.candidate && s.candidate.url && !seen[s.candidate.url] && (seen[s.candidate.url] = 1)).slice(0, 4);
  }
  function ytLinkReset() { Object.assign(YL, { url: '', title: '', view: '', orig: '', author: '', state: '', vid: '', edited: false }); clearTimeout(YL.timer); }
  function ylPaint() {
    const o = document.getElementById('plYlOrig'), t = document.getElementById('plYlTitle'), h = document.getElementById('plYlHint');
    if (o) o.textContent = YL.orig ? `원본: ${YL.orig}${YL.author ? ' · ' + YL.author : ''}` : '';
    if (t && t.value !== YL.title) t.value = YL.title;
    if (t) t.placeholder = YL.state === 'fail' ? '제목을 직접 적어 주세요' : '링크를 넣으면 제목이 들어와요';
    if (h) h.textContent = YL.state === 'fail' ? '제목을 직접 적어 주세요.' : '한국어 제목으로 바꿔도 돼요.';
  }
  function ylFetch() {
    const url = YL.url.trim(), vid = ytVidOf(url);
    if (!vid) { YL.vid = ''; YL.orig = ''; YL.author = ''; YL.state = ''; ylPaint(); return; }
    if (vid !== YL.vid) { YL.vid = vid; YL.orig = ''; YL.author = ''; YL.edited = false; }
    YL.state = 'load'; ylPaint();
    fetch('https://www.youtube.com/oembed?format=json&url=' + encodeURIComponent(url))
      .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
      .then(d => { if (YL.vid !== vid) return; YL.orig = d.title || ''; YL.author = d.author_name || ''; YL.state = YL.orig ? 'ok' : 'fail'; if (!YL.edited && YL.orig) YL.title = YL.orig; ylPaint(); })
      .catch(() => { if (YL.vid !== vid) return; YL.state = 'fail'; ylPaint(); });
  }
  function ylSetUrl(u, now) {
    YL.url = u; const i = document.getElementById('plYlUrl'); if (i && i.value !== u) i.value = u;
    clearTimeout(YL.timer); YL.timer = setTimeout(ylFetch, now ? 0 : 450);
  }
  function ytLinkStart(it) {
    if (it.idea) return;
    const url = YL.url.trim(), vid = ytVidOf(url), title = YL.title.trim();
    if (!vid) { toast('유튜브 영상 링크를 넣어 주세요.'); return; }
    if (!title) { toast('영상 제목을 적어 주세요.'); return; }
    const ch = ytLock || ytTab();
    let idea = db.ideas.find(i => ideaPlatform(i) === 'YouTube' && ytCh(i) === ch && String(i.sources || '').includes(vid));
    if (!idea) {
      const g = (typeof YT_SOURCE_CHANNELS !== 'undefined' ? YT_SOURCE_CHANNELS : []).find(x => x.id === ch);
      const hit = g && g.sources.find(s => s.candidate && ytVidOf(s.candidate.url) === vid);
      const def = typeof ytTabDefs === 'function' ? ytTabDefs(ch)[0] : null;
      const topicId = (hit && hit.candidate.topic) || (def && def.id) || (g && g.sources[0] && g.sources[0].topics[0]) || '';
      const note = [YL.view.trim(), YL.orig ? '원본 영상: ' + YL.orig + (YL.author ? ' · ' + YL.author : '') : ''].filter(Boolean).join('\n\n');
      idea = { id: uid(), title, note, sources: url, preferredChannel: 'youtube', ytChannel: ch, ytFormat: ytPipe.format === 'long' ? 'long' : 'shorts', topicId, sample: false, created: Date.now() };
      db.ideas.unshift(idea);
    }
    if (!idea.ytStarted) idea.ytStarted = Date.now();
    delete idea.ytHidden; persist();
    selectYt(idea.id); ytPipe.url = url; T.view.youtube = null; ytLinkReset();
  }
  function ytCh(i) { return ytValidCh(i.ytChannel) || (typeof ytChannelOfTopic === 'function' && ytChannelOfTopic(i.topicId)) || 'yt-wrestling'; }
  function ytIdeas() { return db.ideas.filter(i => ideaPlatform(i) === 'YouTube' && ytFormatOf(i) === ytPipe.format && ytCh(i) === ytTab()).sort((a, b) => ytRank(a) - ytRank(b) || (b.created || 0) - (a.created || 0)); }
  function ytEp(idea) { return idea && runnerData ? (runnerData.episodes || []).find(e => e.ideaId === idea.id) || null : null; }
  function ytItem() {
    const s = S.sel.youtube = S.sel.youtube || {};
    if (ytPipe.ideaId && ytPipe.ideaId !== s.ideaId && !T.ytSkipAdopt) { s.ideaId = ytPipe.ideaId; s.empty = false; }
    let idea = s.ideaId ? db.ideas.find(i => i.id === s.ideaId) || null : null;
    if (idea && ytCh(idea) !== ytTab()) idea = null; // 다른 채널 주제는 이 채널 화면에 보이지 않음
    if (!idea && !s.empty && runnerData) { const e = (runnerData.episodes || []).find(x => x.ideaId && db.ideas.some(i => i.id === x.ideaId && !i.publicationCheck && ytCh(i) === ytTab())); if (e) { idea = db.ideas.find(i => i.id === e.ideaId); s.ideaId = idea.id; } }
    if (idea && ytPipe.ideaId !== idea.id) ytPick(idea.id);
    return { c: 'youtube', idea, ep: ytEp(idea), key: idea ? 'y:' + idea.id : '', title: idea ? idea.title : '' };
  }
  const ytFileLink = (ep, o) => runnerFileLink(ep, o.path);
  function ytStepsFor(it) {
    const ep = it.ep, off = runnerOnline === false;
    const offMsg = '<p class="pl-error" role="alert"><b>실행기가 꺼져 있어요.</b> 맥에서 <code>~/Desktop/유투브/실행기/실행기 켜기.command</code> 를 더블클릭하세요. 켜진 창은 닫지 마세요.<br><span class="small">이 맥의 크롬에서만 돼요. "로컬 네트워크 접근"을 물으면 허용을 누르세요.</span></p>';
    const topic = {
      id: 'topic', name: '원본 링크', title: '원본 링크', desc: '만들고 싶은 유튜브 영상 링크를 넣으세요. 그 영상으로 주제를 정해요.',
      btn: '이 링크로 시작',
      hideBtn: it => !!it.idea,
      isDone: it => !!it.idea,
      result: it => it.idea ? `<b>${esc(it.idea.title)}</b>${ytFirstUrl(it.idea) ? ` · <a class="pl-link" href="${esc(ytFirstUrl(it.idea))}" target="_blank" rel="noopener noreferrer">원본 링크 ↗</a>` : ''}${it.ep ? '' : ' <button type="button" class="pl-link" data-pl-ytchange>다른 링크로 바꾸기</button>'}` : '',
      body: it => {
        if (it.idea) return '';
        const tabs = ytLock ? '' : `<div class="filters yt-tabs pl-ytabs" role="tablist" aria-label="유튜브 채널">${YT_CHANNELS.filter(y => !YT_LOCKS[y.id]).map(y => `<button class="filter ${ytTab() === y.id ? 'active' : ''}" role="tab" aria-selected="${ytTab() === y.id}" data-yt-tab="${y.id}" title="${esc(ytChName(y.id))}">${esc(y.tab)}</button>`).join('')}</div>`;
        const fmt = f => `<button type="button" class="pl-chip ${ytPipe.format === f ? 'on' : ''}" data-yp-format="${f}" aria-pressed="${ytPipe.format === f}">${f === 'long' ? '🎬 롱폼' : '📱 쇼츠'}</button>`;
        const vids = ytLinkSources(ytLock || ytTab());
        const chips = vids.length ? `<div class="pl-chips" role="group" aria-label="추천 소스 영상">${vids.map(x => `<button type="button" class="pl-chip" data-pl-ylchip="${esc(x.candidate.url)}" title="${esc(x.candidate.title || '')}">${esc(x.name)}</button>`).join('')}</div>` : '';
        const orig = YL.orig ? `원본: ${esc(YL.orig)}${YL.author ? ' · ' + esc(YL.author) : ''}` : '';
        const form = `<div class="pl-yl"><label>유튜브 영상 링크<input class="pl-input pl-yl-url" id="plYlUrl" data-yl="url" placeholder="https://www.youtube.com/watch?v=…" autocomplete="off" value="${esc(YL.url)}"></label>${chips}
          <p class="small pl-yl-orig" id="plYlOrig" aria-live="polite">${orig}</p>
          <label>영상 제목<input class="pl-input" id="plYlTitle" data-yl="title" placeholder="${esc(YL.state === 'fail' ? '제목을 직접 적어 주세요' : '링크를 넣으면 제목이 들어와요')}" value="${esc(YL.title)}"></label>
          <p class="small" id="plYlHint">${esc(YL.state === 'fail' ? '제목을 직접 적어 주세요.' : '한국어 제목으로 바꿔도 돼요.')}</p>
          <label>내 관점 한 줄 (선택)<textarea class="pl-input" rows="2" id="plYlView" data-yl="view" placeholder="이 영상에서 내가 말하고 싶은 것">${esc(YL.view)}</textarea></label></div>`;
        const list = ytIdeas(), pg = (T.page.youtube || 0) % Math.max(1, Math.ceil(list.length / PAGE)), shown = list.slice(pg * PAGE, pg * PAGE + PAGE);
        const saved = list.length ? `<details class="pl-peek"><summary>저장된 주제에서 고르기 (${list.length})</summary><div class="pl-topics" role="radiogroup" aria-label="주제">${shown.map(t => `<button type="button" role="radio" aria-checked="false" class="pl-topic" data-pl-ytpick="${esc(t.id)}"><span>${esc(t.title)}</span></button>`).join('')}</div>${list.length > PAGE ? `<button type="button" class="pl-link" data-pl-more>다른 주제 보기 (${pg + 1}/${Math.ceil(list.length / PAGE)})</button>` : ''}</details>` : '';
        return tabs + `<div class="pl-chips">${fmt('shorts')}${fmt('long')}</div>` + form + saved;
      },
      run: it => ytLinkStart(it),
    };
    const look = {
      id: 'look', name: '편집 스타일 선택', title: '편집 스타일 선택', desc: it => it.idea ? '이 영상에 쓸 편집 스타일을 고르세요. 레슬링은 매트 스토리 룩이 골라져 있어요.' : '앞 단계를 끝내면 열려요.',
      btn: it => (it.ep ? '이 룩으로 바꾸기' : '이 룩으로 정하기'),
      attrs: it => { const pick = ytLookPick(it, it.ep), ch = it.ep && it.ep.look && it.ep.look !== pick, cut = it.ep && (it.ep.steps || []).some(x => x.id === 'clip' && x.status === 'done');
        return `data-ya-act="look" data-ya-look="${esc(pick)}"${ch && cut ? ' data-ya-confirm="룩을 바꾸면 컷 편집부터 다시 해야 해요. 대본과 받은 영상은 그대로예요. 계속할까요?"' : ''}`; },
      disabled: it => !it.idea || off || runnerOnline === null || !!(it.ep && it.ep.running) || !!(it.ep && it.ep.look && it.ep.look === ytLookPick(it, it.ep)),
      isDone: it => !!(it.ep && it.ep.look),
      result: it => it.ep && it.ep.look ? `<b>${esc((ytLooks().find(l => l.id === it.ep.look) || { name: it.ep.look }).name)}</b>로 정했어요 · <span class="small">아래에서 다른 룩을 고르면 바꿀 수 있어요.</span>` : '',
      body: it => {
        if (!it.idea) return '';
        const pick = ytLookPick(it, it.ep), def = ytLookDefault(ytCh(it.idea));
        const chips = `<div class="pl-looks" role="radiogroup" aria-label="편집 룩">${ytLooks().map(l => `<button type="button" role="radio" aria-checked="${pick === l.id}" class="pl-topic ${pick === l.id ? 'on' : ''}" data-ya-lookpick="${esc(l.id)}">${ytLookMock(l.id)}<span class="pl-lk-txt"><b>${esc(l.name)}${l.id === def ? ' · 이 채널 기본' : ''}</b><span class="small">${esc(l.desc)}</span>${l.pack ? `<span class="small pl-pair">짝: ${esc((ytFxPacks().find(p => p.id === l.pack) || { name: l.pack }).name)}</span>` : ''}</span></button>`).join('')}</div>`;
        return (off ? offMsg : runnerOld ? RUNNER_OLD_MSG : '') + ytLesson(it) + chips;
      },
      run: () => {},
    };
    // 최종 결과물 레퍼런스: 룩 = 색·틀·자막 모양 / 이 칸 = 영상 속 강조(줌·흔들림·플래시·효과음·단어 팝). 고른 팩은 실행기가 이펙트·목소리·음악 단계에서 진짜로 입혀요.
    const fxref = {
      id: 'fxref', name: '최종 결과물 레퍼런스', title: '최종 결과물 레퍼런스',
      desc: it => (it.ep ? '영상 속 강조 효과를 고르세요. 편집 스타일은 색과 틀, 이 칸은 움직임과 소리예요.' : '앞 단계를 끝내면 열려요.'),
      btn: it => (it.ep && it.ep.fxPack ? '이 레퍼런스로 바꾸기' : '이 레퍼런스로 정하기'),
      attrs: it => `data-ya-act="fxpack" data-ya-fxpack="${esc(ytFxPick(it, it.ep))}"`,
      disabled: it => !it.ep || off || runnerOnline === null || ytFxOld() || !!it.ep.running || (it.ep.fxPack === ytFxPick(it, it.ep) && ytFxTimes(it, it.ep).trim() === (it.ep.fxTimes || '') && (ytFxPick(it, it.ep) !== 'steps' || ytFxLabels(it, it.ep).trim() === (it.ep.fxLabels || []).join(', '))),
      isDone: it => { const ep = it.ep; if (!ep) return false; if (ytFxOld() || ep.fxPack || (ep.round || 0) >= 1) return true; const ok = id => (ep.steps || []).some(x => x.id === id && x.status === 'done'); return ok('research') && ok('download'); },
      result: it => { const ep = it.ep; if (!ep || ytFxOld()) return '';
        const used = ytFxPacks().find(p => p.id === (ep.fxPack || ep.fxPackUsed)); if (!used) return '';
        return `<b>${esc(used.name)}</b> 이펙트${ep.fxPack ? '로 정했어요' : ytLookPackOf(ep.look) === used.id ? '로 만들어요 (고른 룩과 짝)' : '로 만들어요 (이 채널 기본)'}${ep.fxTimes ? ` · 더 강조할 시간 ${esc(ep.fxTimes)}` : ''} · <span class="small">아래에서 다른 팩을 고르면 바꿀 수 있어요.</span>`; },
      body: it => {
        if (!it.idea || !it.ep) return '';
        if (ytFxOld()) return '<p class="pl-error" role="alert"><b>실행기를 업데이트해야 이 칸을 쓸 수 있어요.</b> 저장소를 <code>git pull</code> 한 뒤 <code>runner/설치·업데이트.command</code> 를 더블클릭하세요. 이 칸은 건너뛰어도 돼요.</p>';
        const pick = ytFxPick(it, it.ep), def = ytFxDefault(ytCh(it.idea)), packs = ytFxPacks(), cur = packs.find(p => p.id === pick) || packs[0];
        const chips = `<div class="pl-looks pl-fxs" role="radiogroup" aria-label="이펙트 팩">${packs.map(p => {
          const on = pick === p.id, ref = ytFxRef(p);
          return `<div class="pl-fxc ${on ? 'on' : ''}"><button type="button" role="radio" aria-checked="${on}" class="pl-fxb" data-ya-fxpick="${esc(p.id)}">${ytFxMock(p.id)}<span class="pl-lk-txt"><b>${esc(p.name)}${p.id === def ? ' · 이 채널 기본' : ''}</b><ul class="pl-fxl">${String(p.desc || '').split(' · ').filter(Boolean).map(x => `<li>${esc(x)}</li>`).join('')}</ul>${p.views ? `<span class="small pl-views">참고 쇼츠 ${esc(p.views)}</span>` : ''}${ytPackLookOf(p.id) ? `<span class="small pl-pair">짝: ${esc(ytPackLookOf(p.id).name)}</span>` : ''}</span></button>${p.id === 'none' ? '' : ref ? `<a class="pl-fxlink" href="${esc(ref)}" target="_blank" rel="noopener noreferrer">레퍼런스 영상 ↗</a>` : '<span class="small pl-fxlink">예시 영상은 아래에서 직접 넣어요</span>'}</div>`;
        }).join('')}</div>`;
        let extra = '';
        if (cur.id !== 'none') {
          const ref = ytFxRef(cur), vid = ytVidOf(ref);
          extra += `<div class="pl-fxsel"><b class="small">${esc(cur.name)} 레퍼런스 영상</b>${vid ? `<div class="pl-fxvidw"><iframe id="plFxVid" class="pl-fxvid" src="https://www.youtube-nocookie.com/embed/${esc(vid)}" title="${esc(cur.name)} 레퍼런스 영상" loading="lazy" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe></div>` : ref ? `<p class="small"><a class="pl-link" href="${esc(ref)}" target="_blank" rel="noopener noreferrer">${esc(ref)} ↗</a></p>` : '<p class="small">아직 예시 영상이 없어요. 아래에 내 레퍼런스 링크를 넣으면 여기서 볼 수 있어요.</p>'}
            <label class="pl-fxown">내 레퍼런스 링크 (선택)<input class="pl-input" data-fx-ref="${esc(cur.id)}" placeholder="https://www.youtube.com/shorts/…" value="${esc((S.fxRefs && S.fxRefs[cur.id]) || '')}" autocomplete="off"></label><p class="small">비워 두면 기본 예시를 써요. 링크는 이 브라우저에만 저장돼요.</p></div>`;
          extra += `<div class="pl-ya-form"><label>더 강조할 시간 (선택, 쉼표로)<input class="pl-input" data-ya-new="fxtimes" placeholder="0:03 벽처럼 서기, 0:06 레벨 체인지" value="${esc(ytFxTimes(it, it.ep))}" autocomplete="off"></label><p class="small">시간만 적어도 돼요 (0:03, 0:07). 시간 뒤에 문구를 적으면 라벨 태그 팩이 그 문구를 알약 라벨로 보여 줘요. 대본의 강조 줄은 자동으로 잡아요.</p></div>`;
          if (cur.id === 'steps') extra += `<div class="pl-ya-form"><label>단계 이름 (쉼표로)<input class="pl-input" data-ya-new="fxlabels" placeholder="낮추기, 밀기, 들기" value="${esc(ytFxLabels(it, it.ep))}" autocomplete="off"></label><p class="small">구간 하나가 한 단계예요. 비워 두면 "1단계", "2단계"로 나와요. 구간이 3개 이상이면 마지막은 "다 합치면"이에요.</p></div>`;
        }
        return (off ? offMsg : runnerOld ? RUNNER_OLD_MSG : '') + ytLesson(it) + chips + extra;
      },
      run: () => {},
    };
    const mid = YT_GROUPS.filter(g => g.id === 'g-dl').map(g => {
      const base = { id: g.id, name: g.name, title: g.name };
      if (!ep) return { ...base, desc: '앞 단계를 끝내면 열려요.', btn: g.go, disabled: () => true, isDone: () => false, result: () => '', run: () => {} };
      const G = ytGroupState(ep, g), isVoice = g.id === 'g-voice', isCut = g.id === 'g-cut', scrPanel = isVoice && ytScriptShow(ep), saveMode = G.gate && scrPanel && ytScrBlocked(ep);
      const stOf = id => ep.steps.find(x => x.id === id), okSt = id => !!stOf(id) && stOf(id).status === 'done';
      const scriptDone = okSt('script') && !ep.gate, mixDone = okSt('mix');
      const todo = G.sts.filter(x => x.status !== 'done').map(x => x.id), all = g.ids.slice();
      const ids = G.done || !todo.length ? all : todo;
      // 앞 칸이 끝나야 열려요: 영상 다운 → 컷 편집 → 자막 → 이펙트 → (음악/녹음, 업로드 패키지)
      const prev = { 'g-dl': null, 'g-cut': ['research', 'download'], 'g-subs': ['clip', 'plan', 'rough'], 'g-fx': ['subs'], 'g-voice': ['fx'], 'g-upload': ['fx'] }[g.id];
      const locked = !!prev && !prev.every(okSt);
      const lockMsg = { 'g-cut': '링크 영상을 먼저 받아 주세요.', 'g-subs': '컷 편집이 끝나면 열려요.', 'g-fx': '자막 자동화가 끝나면 열려요.', 'g-voice': '이펙트가 끝나면 열려요.', 'g-upload': '이펙트가 끝나면 열려요.' }[g.id];
      const desc = G.gate ? '대본이 만들어졌어요. 아래 결과에서 대본을 열어 읽어 보고, 괜찮으면 "대본 확인 완료 · 계속"을 누르세요.'
        : locked ? lockMsg : isVoice && !scriptDone ? '먼저 대본을 만들어요. 다 되면 한 번 읽어 보고 계속 진행하세요.'
        : isVoice ? '대본이 정해졌어요. "녹음·음악 열기"에서 줄마다 녹음하고 배경음악을 골라 "목소리·음악 넣기"를 누르세요.' : g.desc;
      const nameOf = id => (YT_STEP_NAME[id] || id);
      const openRec = isVoice && scriptDone;
      return {
        ...base, desc,
        btn: it => G.gate ? (saveMode ? '대본 저장하고 계속' : '대본 확인 완료 · 계속') : G.running ? '실행 멈춤' : openRec ? (recState.open ? '녹음·음악 닫기' : '녹음·음악 열기') : G.done ? '다시 실행' : G.failed ? '다시 실행' : g.go,
        attrs: it => G.gate ? (saveMode ? 'data-ya-act="scriptsave"' : 'data-ya-act="continue"') : G.running ? 'data-ya-act="stop"' : openRec ? 'data-ya-recopen' : isCut ? 'data-ya-act="cut"' : `data-ya-steps="${esc((isVoice ? ['script'] : ids).join(','))}"`,
        cls: G.running ? 'danger' : '',
        disabled: it => (!!ep.running && !G.running && !G.gate) || (locked && !G.running) || (G.gate && scrPanel && ytScrWaiting(ep)),
        isDone: it => G.done,
        statusLine: () => G.running ? `실행 중… (${esc(nameOf(G.running.id))}) 끝나면 자동으로 바뀌어요.` : G.failed ? '실패했어요. 아래 로그를 보고 다시 실행하세요.' : '',
        result: it => {
          const parts = [];
          if (G.failed && G.failed.error) parts.push(`<p class="pl-error"><b>${esc(G.failed.name)}</b> · ${esc(runnerFriendly(G.failed.error))}${!isVoice && /여기에 대사/.test(G.failed.error) ? ' <button type="button" class="pl-link" data-ya-goscript>대본 단계로 가기</button>' : ''}</p>`);
          if (g.id === 'g-dl') { const dl = G.sts.flatMap(x => x.outputs).find(o => o.exists && ytVideoRe.test(o.path)); if (dl) parts.push(ytVideoBox('plDlVid', ep, dl, '받은 원본 영상')); }
          parts.push(`<p class="small pl-subs">${G.sts.map(x => `${esc(x.name)} ${x.status === 'done' ? '✓' : x.status === 'running' ? '…' : x.status === 'failed' ? '✕' : '·'}`).join(' · ')}</p>`);
          const files = G.sts.flatMap(x => x.outputs.filter(o => o.exists));
          parts.push(files.length ? `<ul class="pl-files">${files.map(o => `<li>${ytFileLink(ep.ep, o)}</li>`).join('')}</ul>` : (G.running ? '' : '<span class="small">아직 결과 파일이 없어요.</span>'));
          if (isVoice && scriptDone && !G.running) parts.push('<p class="small"><button type="button" class="pl-link" data-ya-steps="script" data-ya-confirm="대본을 처음부터 다시 만들어요. 직접 고친 대본은 사라지고, 녹음한 줄은 글이 바뀐 줄만 다시 녹음해야 해요. 계속할까요?">대본 다시 만들기</button></p>');
          parts.push(`<div class="pl-logs">${G.sts.map(x => `<button type="button" class="pl-link" data-pl-log="${esc(x.id)}" aria-expanded="${T.logOpen === x.id}">${esc(x.name)} 로그${T.logOpen === x.id ? ' 닫기' : ''}</button>`).join('')}</div>${G.sts.some(x => x.id === T.logOpen) ? '<pre class="pl-log" id="plLog">불러오는 중…</pre>' : ''}`);
          return parts.join('');
        },
        body: it => {
          let b = '';
          if (isCut && !locked && !G.running) {
            const cur = ((ep.sources && ep.sources[0] && ep.sources[0].ranges) || []).join(', ');
            b += `<div class="pl-ya-form"><label>쓸 구간 (쉼표로 여러 개 · 한 구간은 3분까지)<input class="pl-input" data-ya-new="ranges" placeholder="0:30-0:42, 1:05-1:12" value="${esc(ytPipe.ranges || cur)}"></label></div>`;
          }
          return b + (scrPanel ? ytScriptPanel(ep, saveMode) : '') + (isVoice && recState.open ? `<div id="yaRec">${recPanel()}</div>` : '');
        },
        run: () => {},
      };
    });
    const edits = ytEditCards(it, ep, off);
    const last = {
      id: 'post', name: '올리기', title: 'YouTube에 올리기', desc: '업로드 패키지의 제목·설명란을 복사해 YouTube Studio에 올려요. 올린 뒤 영상 주소를 남기세요.',
      btn: it => it.idea && S.opened[it.key] ? '주소 남기기' : 'YouTube Studio 열기',
      disabled: it => !it.ep,
      hideBtn: it => !!(it.idea && it.idea.publicationCheck),
      isDone: it => !!(it.idea && it.idea.publicationCheck),
      result: it => it.idea && it.idea.publicationCheck ? `<b>${doneLink(it.idea.publicationCheck)}</b>` : '',
      body: it => {
        if (!it.ep) return '';
        const pack = it.ep.steps.find(s => s.id === 'upload')?.outputs.find(o => o.exists);
        return `${pack ? `<p>${ytFileLink(it.ep.ep, pack)}</p>` : ''}${it.idea && S.opened[it.key] && !it.idea.publicationCheck ? urlFormHtml(it.key) : ''}`;
      },
      run: it => {
        if (!S.opened[it.key]) { window.open(WRITE_URL.youtube, '_blank', 'noopener'); S.opened[it.key] = true; save(); repaint('youtube'); return; }
        recordUrl('youtube', it.key, it.idea, it.idea.title);
      },
    };
    if (AI_CH[it.idea ? ytCh(it.idea) : ytTab()]) return [topic, ...ytAiCards(it, ep, off)];
    return [topic, look, fxref, ...mid, ...edits];
  }
  // ===== 레슬링 작업판 (AI 편집, 맥의 Claude Code): 링크 → 하이라이트 1차 컷 → 스타일 선택 → 스타일 입히기 → 자막 → 다운로드 =====
  // 인트로·아웃트로는 모든 단계에서 후크: 1차 컷(첫 컷 intro·마지막 컷 outro) / 스타일(위 제목) / 자막(0초 후크·마지막 줄 후크)
  // AI 편집 작업판을 쓰는 채널 → 그 채널의 AI 편집 스타일(룩). 실행기 runner/ai.mjs 의 CH_STYLE 과 같아요.
  const AI_CH = { 'yt-wrestling': 'yt-mat', 'yt-christian': 'yt-christian', 'yt-politics': 'yt-politics' };
  // 레슬링 AI 편집에서 더 고를 수 있는 쇼츠 스타일 (레퍼런스 쇼츠를 본뜬 틀). 실행기 runner/ai.mjs 의 AI_STYLES 와 같아요.
  const YT_AI_LOOKS = [
    { id: 'yt-replay', name: '리플레이 룩', desc: '꽉 찬 경기 화면 + 짧은 노란 말자막 + 결정적 순간 링 + 제목 없음 · 참고: TAKEDOWN 쇼츠 1,310만 회', ref: 'https://www.youtube.com/shorts/OEZ-90bZ_cI' },
    { id: 'yt-breakdown', name: '기술 분석 룩', desc: '꽉 찬 화면 + 핵심 부위에 빛나는 링·화살표 + ①②③ 해설 자막 + SLOW 표시 · 참고: Fight Lab 브레이크다운 150만 회', ref: 'https://www.youtube.com/shorts/J2pl5sWroxA' },
    { id: 'yt-top5', name: '랭킹 룩', desc: '위 "TOP 3" + 빨간 키워드 + 흐린 배경 위 경기 화면 + 아래 순위 목록이 하나씩 채워짐 · 참고: MMA Hub Top 5 146만 회', ref: 'https://www.youtube.com/shorts/sShsZ2ZUUZM' },
    { id: 'yt-wordpop', name: '한 단어 자막 룩', desc: '꽉 찬 화면 + 가운데 한 단어씩 튀어나오는 흰 자막(파란 테두리) + 빨간 화살표·노란 링 · 참고: USAFightv KO 쇼츠', ref: 'https://www.youtube.com/shorts/VpVzuEsavCQ' },
    { id: 'yt-post', name: '게시물 룩', desc: '흰 바탕 + 로고·채널명 + 검은 굵은 제목 2줄 + 가운데 영상(노란 자막) + 아래 채널 한마디 카드 · 참고: 격랭커 심권호 쇼츠 38만 회', ref: 'https://www.youtube.com/shorts/09-OQisO3Hw' },
  ];
  const AI_LOOKS = [...Object.values(AI_CH), ...YT_AI_LOOKS.map(l => l.id)];
  const isRef = id => /^ref-[\w-]{11}$/.test(id || '');
  const aiLookOk = id => AI_LOOKS.includes(id) || isRef(id);
  const aiLookName = id => isRef(id) ? '레퍼런스 쇼츠 스타일' : (YT_AI_LOOKS.find(l => l.id === id) || ytLooks().find(l => l.id === id) || { name: id }).name;
  // #ytRefs 탭의 쇼츠 (이미 위 스타일의 참고 영상인 것은 빼요)
  const ytRefLooks = ch => (typeof window.ytRefShorts === 'function' ? window.ytRefShorts(ch) : []).filter(r => !YT_AI_LOOKS.some(l => l.ref.includes(r.id))).map(r => ({ id: 'ref-' + r.id, vid: r.id, title: r.title, from: r.from }));
  function ytAiCards(it, ep, off) {
    const names = ['1차 컷 (영상 종류)', '스타일 선택', '스타일 입히기', '자막', '인트로·아웃트로', '썸네일', '다운로드'];
    const chId = it.idea ? ytCh(it.idea) : ytTab(), sport = chId === 'yt-wrestling', myLook = AI_CH[chId] || 'yt-mat';
    const st = id => (ep && (ep.steps || []).find(x => x.id === id)) || { status: 'todo', outputs: [] }, ok = id => st(id).status === 'done';
    const out = (id, p) => (st(id).outputs || []).find(o => o.path === p && o.exists);
    const old = !!ep && !(ep.steps || []).some(x => x.id === 'aicut');
    const oldMsg = '<p class="pl-error" role="alert"><b>맥의 실행기를 업데이트해야 AI 편집을 쓸 수 있어요.</b> 저장소를 <code>git pull</code> 한 뒤 <code>runner/설치·업데이트.command</code> 를 더블클릭하세요.</p>';
    const runIn = ids => !!(ep && ep.running && ids.includes(ep.running));
    const busyElse = ids => !!(ep && ep.running && !ids.includes(ep.running));
    const errOf = ids => { const f = ids.map(st).find(x => x.status === 'failed'); return f && f.error ? `<p class="pl-error"><b>${esc(f.name)}</b> · ${esc(runnerFriendly(f.error))}</p>` : ''; };
    const logs = ids => `<div class="pl-logs">${ids.map(id => `<button type="button" class="pl-link" data-pl-log="${id}" aria-expanded="${T.logOpen === id}">${esc(st(id).name || id)} 로그${T.logOpen === id ? ' 닫기' : ''}</button>`).join('')}</div>${ids.includes(T.logOpen) ? '<pre class="pl-log" id="plLog">불러오는 중…</pre>' : ''}`;
    const vid = (id, p, label) => { const o = out(id, p); return o ? ytVideoBox('plAi' + id, ep, o, label) : ''; };
    const runLine = ids => () => { if (!runIn(ids)) return ''; const pct = Number.isFinite(ep.progress) ? ep.progress : null;
      return `<b>${pct != null ? pct + '%' : '실행 중…'}</b> · ${esc(st(ep.running).name || ep.running)} 하는 중. Claude 가 영상을 보는 단계는 몇 분 걸려요 (%는 지난번 걸린 시간으로 어림). 끝나면 자동으로 바뀌어요.${pct != null ? `<div style="height:8px;border-radius:99px;background:var(--line);margin-top:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent,#ff5b5b);transition:width .6s"></div></div>` : ''}`; };
    const stopOr = (ids, attrs) => () => runIn(ids) ? 'data-ya-act="stop"' : attrs;
    const card = (i, o) => ({ id: 'ai' + i, name: names[i], title: names[i], run: () => {}, ...o });
    const CUT = ['research', 'download', 'aicut'], cutDone = ok('aicut'), lookOk = !!ep && aiLookOk(ep.look);
    // 영상 종류 (레슬링만): 1차 컷을 만들기 전에 고르고, 1차 컷·자막·라벨이 그 틀로 짜여요
    const VT = [
      { id: 'highlight', name: '하이라이트 중심', desc: '결정적 기술 하나 · 원속도 → 단계별 슬로우 → 원속도 (지금까지 만든 것)' },
      { id: 'analysis', name: '분석 중심', desc: '기술 하나를 해부 · 준비 자세 → 3~4단계 슬로우 + 왜 되는지 설명', ref: 'https://www.youtube.com/@officialfightlab/shorts' },
      { id: 'top5', name: 'TOP 5', desc: '서로 다른 장면 3~5개를 낮은 순위부터 1위까지 카운트다운', ref: 'https://www.youtube.com/shorts/sShsZ2ZUUZM' },
      { id: 'info', name: '간단한 정보', desc: '팁·실수·규칙 하나만 · 질문 → 이유 → 답 · 15~30초', ref: 'https://www.youtube.com/shorts/WHy8SK2vi3s' },
    ];
    const vpick = (it.idea && ytPipe.vtypeIdea === it.idea.id && ytPipe.vtype) || (ep && ep.vtype) || 'highlight';
    const vtChips = () => sport ? `<p class="small"><b>어떤 영상을 원하세요?</b> 고른 종류로 1차 컷을 짜요. 바꾸면 "AI 가 다시 자르기"로 다시 짜요.</p><div class="pl-looks" role="radiogroup" aria-label="영상 종류">${VT.map(v => `<button type="button" role="radio" aria-checked="${vpick === v.id}" class="pl-topic ${vpick === v.id ? 'on' : ''}" data-ya-vtype="${v.id}"><span class="pl-lk-txt"><b>${esc(v.name)}</b><span class="small">${esc(v.desc)}</span></span></button>`).join('')}</div><p class="small">레퍼런스: ${VT.filter(v => v.ref).map(v => `<a href="${esc(v.ref)}" target="_blank" rel="noopener">${esc(v.name)}</a>`).join(' · ')}</p>` : '';
    const c1 = card(0, {
      desc: !it.idea ? '앞 단계를 끝내면 열려요.' : (sport ? `먼저 어떤 영상을 원하는지 고르세요. Claude 가 영상을 처음부터 끝까지 보고 그 종류(지금: ${(VT.find(v => v.id === vpick) || VT[0]).name})로 1차 컷을 만들어요. 인트로는 제일 충격적인 순간부터, 아웃트로는 다시 보고 싶게 잘라요.` : 'Claude 가 영상과 영어 자막을 처음부터 끝까지 보고 가장 센 발언을 골라 1차 컷을 만들어요. 인트로는 가장 센 한 마디부터, 문장 중간에서 끊지 않고, 아웃트로는 결론 한 마디나 반박 직전에서 끊어요.'),
      btn: () => runIn(CUT) ? '실행 멈춤' : cutDone ? 'AI 가 다시 자르기' : '1차 컷 만들기',
      attrs: stopOr(CUT, `data-ya-act="aicut"${cutDone ? ' data-ya-confirm="1차 컷을 다시 만들어요. 스타일·자막도 다시 해야 해요. 계속할까요?"' : ''}`),
      cls: runIn(CUT) ? 'danger' : '',
      disabled: () => !it.idea || off || runnerOnline === null || old || busyElse(CUT),
      isDone: () => cutDone,
      statusLine: runLine(CUT),
      result: () => ep ? errOf(CUT) + (cutDone ? `<p><b>1차 컷이 나왔어요.</b> 인트로·아웃트로가 후크인지 보고, 아니면 "AI 가 다시 자르기"를 누르세요.</p>` + vid('aicut', '편집/AI1차컷.mp4', '1차 컷') : '') + logs(CUT) : '',
      body: () => (off ? '<p class="pl-error" role="alert"><b>실행기가 꺼져 있어요.</b></p>' : old ? oldMsg : '') + (it.idea ? vtChips() : ''),
    });
    const refLooks = ytRefLooks(chId), choices = [myLook, ...(sport ? YT_AI_LOOKS.map(l => l.id) : []), ...refLooks.map(r => r.id)];
    const picked = it.idea && ytPipe.lookIdea === it.idea.id && choices.includes(ytPipe.look) ? ytPipe.look : '';
    const pick = picked || (lookOk && choices.includes(ep.look) ? ep.look : myLook), same = lookOk && ep.look === pick;
    const c2 = card(1, {
      peek: sport || refLooks.length > 0,   // 레슬링: 1차 컷 전에도 눌러서 스타일을 미리 볼 수 있어요
      desc: sport || (refLooks.length && !cutDone) ? (cutDone ? '이 쇼츠에 입힐 편집 스타일을 고르세요. 바꾸면 스타일 입히기부터 다시 해요 (1차 컷은 그대로).' : '미리 골라 두세요. 1차 컷이 끝나면 "이 스타일로 정하기"가 열려요.') : !cutDone ? '1차 컷이 끝나면 열려요.' : (refLooks.length ? '이 쇼츠에 입힐 편집 스타일을 고르세요. 기본 스타일 또는 레퍼런스 탭의 쇼츠 중에서 골라요 (말투·사실 규칙은 채널 그대로).' : '이 쇼츠에 입힐 편집 스타일을 고르세요. 레퍼런스 탭에 쇼츠를 넣으면 여기서 고를 수 있어요.'),
      btn: same ? '이 스타일로 정했어요' : lookOk ? '이 스타일로 바꾸기' : '이 스타일로 정하기',
      attrs: () => `data-ya-act="look" data-ya-look="${esc(pick)}"${lookOk && !same && ok('aistyle') ? ' data-ya-confirm="스타일을 바꾸면 스타일 입히기·자막·인트로·아웃트로를 다시 해야 해요. 1차 컷은 그대로예요. 계속할까요?"' : ''}`,
      disabled: () => off || !cutDone || same || !!ep.running,
      isDone: () => cutDone && lookOk,
      result: () => lookOk ? `<b>${esc(isRef(ep.look) && ep.refStyle ? ep.refStyle.name + ' (레퍼런스)' : aiLookName(ep.look))}</b>로 정했어요.${isRef(ep.look) && !ep.refStyle ? ' <span class="small">스타일 입히기 때 이 쇼츠를 받아 보고 스타일을 정해요.</span>' : ''}${choices.length > 1 ? ' <span class="small">다른 스타일을 고르면 바꿀 수 있어요.</span>' : ''}` : '',
      body: () => (cutDone || ((sport || refLooks.length) && it.idea)) ? `<div class="pl-looks" role="radiogroup" aria-label="편집 스타일">${choices.filter(id => !isRef(id)).map(id => { const l = YT_AI_LOOKS.find(x => x.id === id) || ytLooks().find(x => x.id === id) || { name: id, desc: '' }; return `<button type="button" role="radio" aria-checked="${pick === id}" class="pl-topic ${pick === id ? 'on' : ''}"${choices.length > 1 ? ` data-ya-lookpick="${esc(id)}"` : ''}>${ytLookMock(id)}<span class="pl-lk-txt"><b>${esc(l.name)}${id === myLook && choices.length > 1 ? ' · 기본' : ''}</b><span class="small">${esc(l.desc)}</span></span></button>`; }).join('')}</div>${sport ? `<p class="small">레퍼런스 쇼츠: ${YT_AI_LOOKS.map(l => `<a href="${esc(l.ref)}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join(' · ')}</p>` : ''}${refLooks.length ? `<p class="small" style="margin-top:12px"><b>썸네일·편집 레퍼런스 탭의 쇼츠</b> · 고르면 스타일 입히기 때 Claude 가 그 쇼츠를 받아 보고, 가장 가까운 화면 틀에 색·제목·이펙트·자막 방식을 맞춰요. <a href="#ytRefs">레퍼런스 추가하기</a></p><div class="pl-looks" role="radiogroup" aria-label="레퍼런스 쇼츠 스타일">${refLooks.map(r => { const mine = ep && ep.look === r.id && ep.refStyle; return `<div style="display:grid;gap:4px"><button type="button" role="radio" aria-checked="${pick === r.id}" class="pl-topic ${pick === r.id ? 'on' : ''}" data-ya-lookpick="${esc(r.id)}"><span class="lm" aria-hidden="true"><img src="https://i.ytimg.com/vi/${esc(r.vid)}/oar2.jpg" alt="" loading="lazy" style="width:100%;height:100%;object-fit:cover"></span><span class="pl-lk-txt"><b>${esc(mine ? ep.refStyle.name : r.title ? r.title.slice(0, 40) : '레퍼런스 쇼츠')}</b><span class="small">${esc(mine ? ep.refStyle.desc : r.from + ' · 아직 분석 전')}</span></span></button><a class="small" href="https://www.youtube.com/shorts/${esc(r.vid)}" target="_blank" rel="noopener">쇼츠 보기 ↗</a></div>`; }).join('')}</div>` : ''}` : '',
    });
    const ST = ['aistyle'], styDone = ok('aistyle');
    const c3 = card(2, {
      desc: !lookOk ? '스타일을 고르면 열려요.' : (sport ? 'Claude 가 경기·선수·기록을 조사하고(A·B 등급 사실만), 위 2줄 제목(인트로 후크)·선수 라벨·점수 팝업을 정해서 고른 스타일로 입혀요.' : 'Claude 가 화자·발언·배경을 조사하고(A·B 등급 사실만), 위 2줄 제목(인트로 후크)·화자 라벨을 정해서 고른 스타일로 입혀요.'),
      btn: () => runIn(ST) ? '실행 멈춤' : styDone ? '다시 입히기' : '스타일 입히기',
      attrs: stopOr(ST, 'data-ya-steps="aistyle"'), cls: runIn(ST) ? 'danger' : '',
      disabled: () => off || !lookOk || !cutDone || busyElse(ST),
      isDone: () => styDone, statusLine: runLine(ST),
      result: () => ep ? errOf(ST) + (styDone ? vid('aistyle', '편집/AI스타일본.mp4', '스타일본 (자막 전)') + (out('aistyle', '조사/research.md') ? `<p class="small">${ytFileLink(ep.ep, { path: '조사/research.md' })} · 제목·라벨에 쓴 사실의 근거</p>` : '') : '') + logs(ST) : '',
    });
    const SU = ['aisubs'], subDone = ok('aisubs');
    const c4 = card(3, {
      desc: !styDone ? '스타일을 입히면 열려요.' : (sport ? 'Claude 가 한국어 자막을 써요. 0초부터 결과를 먼저 던지는 인트로 후크, 슬로우 구간마다 ①②③ 단계 이름, 다시 보게 만드는 아웃트로 후크까지.' : 'Claude 가 영어 발언을 뜻 그대로 한국어 자막으로 옮겨요. 0초부터 가장 센 한 마디를 던지는 인트로 후크, 다시 보게 만드는 아웃트로 후크까지.'),
      btn: () => runIn(SU) ? '실행 멈춤' : subDone ? '자막 다시 쓰기' : '자막 넣기',
      attrs: stopOr(SU, 'data-ya-steps="aisubs"'), cls: runIn(SU) ? 'danger' : '',
      disabled: () => off || !styDone || busyElse(SU),
      isDone: () => subDone, statusLine: runLine(SU),
      result: () => ep ? errOf(SU) + (subDone ? vid('aisubs', '편집/AI완성.mp4', '완성본') : '') + logs(SU) : '',
    });
    const BR = ['aibrand'], brDone = ok('aibrand');
    const c5 = card(4, {
      desc: !subDone ? '자막까지 끝나면 열려요.' : `채널 로고가 들어간 인트로·아웃트로를 따로 만들어 본편 앞뒤에 붙여요 (로고 파일이 없으면 글자만). 인트로는 스크롤을 멈추게 하는 한 방, 아웃트로는 다시 보게·구독하게 만드는 한 방.`,
      btn: () => runIn(BR) ? '실행 멈춤' : brDone ? '다시 만들기' : '인트로·아웃트로 만들기',
      attrs: stopOr(BR, 'data-ya-steps="aibrand"'), cls: runIn(BR) ? 'danger' : '',
      disabled: () => off || !subDone || busyElse(BR),
      isDone: () => brDone, statusLine: runLine(BR),
      result: () => ep ? errOf(BR) + (brDone ? vid('aibrand', '편집/AI최종.mp4', '최종본 (인트로 + 본편 + 아웃트로)') + `<div class="pl-files">${['편집/AI인트로.mp4', '편집/AI아웃트로.mp4'].filter(p => out('aibrand', p)).map(p => ytFileLink(ep.ep, { path: p })).join(' ')}</div>` : '') + logs(BR) : '',
    });
    const TH = ['aithumb'], thDone = ok('aithumb'), thImg = out('aithumb', '편집/AI썸네일.jpg');
    const c6 = card(5, {
      desc: !cutDone ? '1차 컷이 끝나면 열려요.' : '예쁘게 말고 3단 원색 대비: 위 노랑 후킹 카피(12자 이하) + 가운데 2분할(액션 | 리액션 표정) + 아래 빨강/파랑 반전 카피(16자 이하). Claude 가 카피와 두 장면을 골라 1280x720 으로 만들어요.',
      btn: () => runIn(TH) ? '실행 멈춤' : thDone ? '다시 만들기' : '썸네일 만들기',
      attrs: stopOr(TH, 'data-ya-steps="aithumb"'), cls: runIn(TH) ? 'danger' : '',
      disabled: () => off || !cutDone || busyElse(TH),
      isDone: () => thDone, statusLine: runLine(TH),
      result: () => ep ? errOf(TH) + (thDone && thImg ? `<p><img src="${RUNNER}/file?ep=${encodeURIComponent(ep.ep)}&path=${encodeURIComponent(thImg.path)}&t=${thImg.mtime || ''}" alt="썸네일" style="width:100%;max-width:480px;border-radius:8px;border:1px solid var(--line)"></p>` : '') + logs(TH) : '',
    });
    const dl = p => { const o = out('aibrand', p) || out('aisubs', p) || out('aithumb', p); return o ? `<a class="btn ghost ya-file" href="${RUNNER}/file?ep=${encodeURIComponent(ep.ep)}&path=${encodeURIComponent(o.path)}&dl=1">${esc(p.replace('편집/AI', '').replace(/\.(mp4|jpg)$/, ''))} 내려받기 ⬇</a>` : ''; };
    const fin = out('aibrand', '편집/AI최종.mp4');
    const c7 = card(6, {
      desc: !fin ? '인트로·아웃트로까지 끝나면 열려요.' : '최종본과 썸네일을 내려받아 YouTube Studio 에서 올리세요. 인트로·아웃트로·본편만 따로 받을 수도 있어요.',
      hideBtn: () => true, isDone: () => !!fin,
      result: () => fin ? `<div class="pl-files">${['편집/AI최종.mp4', '편집/AI썸네일.jpg', '편집/AI인트로.mp4', '편집/AI완성.mp4', '편집/AI아웃트로.mp4'].map(dl).join(' ')}</div>` : '',
    });
    return [c1, c2, c3, c4, c5, c6, c7];
  }
  // ===== ④ 1차 편집 · ⑤ 자막 넣기 · ⑥ 2차 편집 · ⑦ 최종 편집안 다운로드 =====
  function ytEditCards(it, ep, off) {
    const names = ['1차 편집', '자막 넣기', '2차 편집', '최종 편집안 다운로드'];
    if (!ep) return names.map((n, i) => ({ id: 'e' + i, name: n, title: n, desc: '앞 단계를 끝내면 열려요.', btn: n, disabled: () => true, isDone: () => false, result: () => '', run: () => {} }));
    const st = id => (ep.steps || []).find(x => x.id === id) || { status: 'todo', outputs: [] }, ok = id => st(id).status === 'done';
    const dlDone = ok('research') && ok('download'), round = ep.round || 0, editing = !!ep.running && ['clip', 'plan', 'rough', 'subs', 'fx', 'script', 'mix'].includes(ep.running);
    const fbNew = (ep.feedbackAt || 0) > (ep.editAt || 0), busyOther = !!ep.running && !editing;
    const EDIT_IDS = ['clip', 'plan', 'rough', 'subs', 'fx', 'mix'];
    const failed = EDIT_IDS.map(st).find(x => x.status === 'failed');
    const pct = Number.isFinite(ep.progress) ? ep.progress : null;
    const runLine = () => editing ? `<b>${pct != null ? pct + '%' : '실행 중…'}</b> · ${esc(YT_STEP_NAME[ep.running] || ep.running)} 하는 중. 끝나면 자동으로 바뀌어요.${pct != null ? `<div style="height:8px;border-radius:99px;background:var(--line);margin-top:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:var(--accent,#ff5b5b);transition:width .6s"></div></div>` : ''}` : '';
    const logs = () => `<div class="pl-logs">${EDIT_IDS.map(id => `<button type="button" class="pl-link" data-pl-log="${id}" aria-expanded="${T.logOpen === id}">${esc(YT_STEP_NAME[id])} 로그${T.logOpen === id ? ' 닫기' : ''}</button>`).join('')}</div>${EDIT_IDS.includes(T.logOpen) ? '<pre class="pl-log" id="plLog">불러오는 중…</pre>' : ''}`;
    const redo = !!(T.redo1 && T.redo1[it.key]) && round >= 1;
    const redoBtn = (hint, cls) => round >= 1 && !editing && !ep.running ? `<p class="${cls || 'small'}"><button type="button" class="pl-nav-btn" data-pl-redo1>↺ 1차 편집 다시</button>${hint ? ' ' + esc(hint) : ''}</p>` : '';
    const editResult = r => () => {
      const parts = [];
      if (failed && failed.error && (ep.editRound || 1) === r) parts.push(`<p class="pl-error"><b>${esc(failed.name)}</b> · ${esc(runnerFriendly(failed.error))}</p>`);
      if (round >= r) { const v = ytEditVideo(ep); parts.push(`<p><b>${r}차 편집본이 나왔어요.</b>${v ? ' 아래에서 바로 볼 수 있어요. ' + ytFileLink(ep.ep, { path: v.path }) : ''}</p>`); if (v) parts.push(ytVideoBox('plEdVid' + r, ep, v, v.label)); if (!ep.hasScript) parts.push('<p class="small">아직 자막이 없어서 자막 없이 만들었어요. 다음 \'자막 넣기\'에서 자막을 넣어요.</p>'); }
      parts.push(logs()); return parts.join('');
    };
    const rangesNow = ((ep.sources && ep.sources[0] && ep.sources[0].ranges) || []).join(', ');
    const e1 = {
      id: 'e1', name: '1차 편집', title: '1차 편집',
      desc: !dlDone ? '링크 영상을 먼저 받아 주세요.' : '쓸 구간을 넣으면 고른 스타일로 1차 편집본을 만들어요. 한 구간은 3분까지, 끝에 x0.5 를 붙이면 0.5배 슬로우예요.',
      btn: () => editing && (ep.editRound || 1) === 1 ? '실행 멈춤' : round >= 1 && !redo ? '1차 편집 다시 만들기' : '1차 편집 만들기',
      attrs: () => editing && (ep.editRound || 1) === 1 ? 'data-ya-act="stop"' : `data-ya-act="edit" data-ya-round="1"${round >= 1 && !redo ? ' data-ya-confirm="1차 편집을 다시 만들어요. 계속할까요?"' : ''}`,
      cls: editing && (ep.editRound || 1) === 1 ? 'danger' : '',
      disabled: () => off || !dlDone || busyOther || (editing && (ep.editRound || 1) !== 1),
      isDone: () => round >= 1,
      statusLine: () => (ep.editRound || 1) === 1 ? runLine() : '',
      result: editResult(1),
      body: () => dlDone && !editing ? `<div class="pl-ya-form"><label>쓸 구간 (쉼표로 여러 개 · 슬로우: 0:30-0:34x0.5)<input class="pl-input" data-ya-new="ranges" placeholder="0:30-0:42, 1:05-1:09x0.5" value="${esc(ytPipe.ranges || rangesNow)}"></label><div class="pl-chips"><button type="button" class="pl-chip ${(ytPipe.ranges || rangesNow) === '전체' ? 'on' : ''}" data-ya-allrange>영상 전체 쓰기</button><span class="small">구간을 고르지 않고 영상 전체를 써요 (쇼츠는 앞 3분까지).</span></div></div>` : '',
      run: () => {},
    };
    const e2 = {
      id: 'e2', name: '자막 넣기', title: '자막 넣기',
      desc: round < 1 ? '1차 편집이 끝나면 열려요.' : '영상에 들어갈 한국어 자막을 넣어요. Claude에게 한 번에 받거나, 한 줄씩 직접 써요.',
      btn: '자막 저장',
      attrs: () => 'data-ya-act="draftsave"',
      disabled: () => off || round < 1 || !!ep.running,
      isDone: () => fbNew || (round >= 2 && !fbNew),
      result: () => fbNew ? '<b>자막을 저장했어요.</b> 2차 편집을 누르면 자막이 들어가요.' : '',
      body: () => round >= 1 ? redoBtn('1차 편집본이 마음에 안 들면 눌러요. 구간·스타일을 바꿔 다시 만들 수 있어요.') + ytSubsPanel(ep) : '',
      run: () => {},
    };
    const e3 = {
      id: 'e3', name: '2차 편집', title: '2차 편집',
      desc: round < 1 ? '1차 편집이 끝나면 열려요.' : fbNew || round < 2 ? '저장한 자막으로 다시 편집해요. 자막·제목·선수 태그·점수 도장·원본 소리·배경음악이 들어가요.' : "다시 고치려면 '자막 넣기'에서 자막을 저장하고 누르세요.",
      btn: () => editing && (ep.editRound || 0) >= 2 ? '실행 멈춤' : round >= 2 ? `${round + 1}차 편집 만들기` : '2차 편집 만들기',
      attrs: () => editing && (ep.editRound || 0) >= 2 ? 'data-ya-act="stop"' : `data-ya-act="edit" data-ya-round="${Math.max(round + 1, 2)}"`,
      cls: editing && (ep.editRound || 0) >= 2 ? 'danger' : '',
      disabled: () => off || round < 1 || busyOther || (editing && (ep.editRound || 0) < 2),
      isDone: () => round >= 2 && !fbNew,
      statusLine: () => (ep.editRound || 0) >= 2 ? runLine() : '',
      result: editResult(Math.max(2, ep.editRound || 2)),
      body: () => round >= 1 ? redoBtn('1차 편집본이 마음에 안 들면 눌러요. 구간·스타일을 바꿔 다시 만들 수 있어요.') : '',
      run: () => {},
    };
    const up = st('upload'), upDone = up.status === 'done', has = p => (up.outputs || []).find(o => o.path === p && o.exists);
    const dlLink = (p, label) => `<a class="btn ghost ya-file" href="${RUNNER}/file?ep=${encodeURIComponent(ep.ep)}&path=${encodeURIComponent(p)}&dl=1">${esc(label)} ⬇</a>`;
    const e4 = {
      id: 'e4', name: '최종 편집안 다운로드', title: '최종 편집안 다운로드',
      desc: round < 1 ? '편집본이 나오면 열려요.' : '마지막 편집본을 영상 파일·썸네일·제목/설명 파일로 내려받아요. 유튜브에는 YouTube Studio 에서 직접 올리세요.',
      btn: () => ep.running === 'upload' ? '만드는 중…' : !upDone ? '최종 편집안 만들기' : it.idea && S.opened[it.key] ? '올린 영상 주소 남기기' : 'YouTube Studio 열기',
      attrs: () => upDone ? '' : 'data-ya-steps="upload"',
      hideBtn: () => !!(upDone && it.idea && it.idea.publicationCheck),
      disabled: () => off || round < 1 || !!ep.running,
      isDone: () => upDone,
      result: () => {
        if (!upDone) return '';
        const vid = has('업로드/영상.mp4'), th = has('업로드/썸네일.jpg'), tx = has('업로드/업로드.txt'), thSrc = th ? ytSrc(ep, th.path, th.mtime) : '', txKey = tx ? `${tx.path}|${tx.mtime || ''}` : '';
        return `<div class="pl-files">${vid ? dlLink('업로드/영상.mp4', '영상 내려받기') : ''} ${th ? dlLink('업로드/썸네일.jpg', '썸네일') : ''} ${tx ? dlLink('업로드/업로드.txt', '제목·설명·태그') : ''}</div>
          <div class="pl-fin">${vid ? ytVideoBox('plFinVid', ep, vid, '최종 영상', 'none', thSrc) : ''}${th ? `<figure class="pl-th"><img src="${esc(thSrc)}" alt="썸네일" loading="lazy"><figcaption class="small">썸네일</figcaption></figure>` : ''}</div>
          ${tx ? `<div class="pl-uptx"><b class="small">올릴 때 쓸 글 (제목·설명·태그)</b><pre class="pl-up" data-pl-uptxt="${esc(txKey)}">${esc(ytUpTxt.get(ep.ep + '|' + txKey) || '불러오는 중…')}</pre></div>` : ''}`;
      },
      body: () => {
        if (!upDone || !it.idea) return '';
        const done = it.idea.publicationCheck;
        return (done ? `<p class="small">올린 영상: ${doneLink(done)}</p>` : S.opened[it.key] ? urlFormHtml(it.key) : '') +
          `<p class="small"><button type="button" class="pl-link" data-ya-steps="upload" ${ep.running ? 'disabled' : ''}>최종 편집안 다시 만들기</button> (편집본을 다시 만들었으면 눌러 주세요)</p>`;
      },
      run: () => {
        if (!upDone || !it.idea) return;
        if (!S.opened[it.key]) { window.open(WRITE_URL.youtube, '_blank', 'noopener'); S.opened[it.key] = true; save(); repaint('youtube'); return; }
        recordUrl('youtube', it.key, it.idea, it.idea.title);
      },
    };
    return [e1, e2, e3, e4];
  }
  // ===== 유튜브 "작업 중" 카드 띠 =====
  const ytThumb = idea => { const v = ytVidOf(ytFirstUrl(idea)); return v ? `https://i.ytimg.com/vi/${v}/mqdefault.jpg` : ''; };
  const ytIsWip = i => !i.publicationCheck && !i.ytHidden && (!!i.ytStarted || !!ytEp(i));
  function ytWipList() { return db.ideas.filter(i => ideaPlatform(i) === 'YouTube' && ytCh(i) === ytTab() && ytIsWip(i)).sort((a, b) => (b.ytStarted || b.created || 0) - (a.ytStarted || a.created || 0)); }
  function ytWipStatus(i) {
    const ep = ytEp(i);
    if (ep) {
      const ok = id => (ep.steps || []).some(x => x.id === id && x.status === 'done'), r = ep.round || 0, fb = (ep.feedbackAt || 0) > (ep.editAt || 0);
      if (AI_CH[ytCh(i)]) {   // AI 작업판 8칸
        const af = [true, ok('aicut'), ok('aicut') && aiLookOk(ep.look), ok('aistyle'), ok('aisubs'), ok('aibrand'), ok('aithumb'), ok('aibrand') && ok('aithumb')], an = af.filter(Boolean).length, ak = af.findIndex(x => !x);
        const AN = ['원본 링크', '1차 컷', '스타일 선택', '스타일 입히기', '자막', '인트로·아웃트로', '썸네일', '다운로드'], ab = [];
        if (ep.running) ab.push('<i class="b run">실행 중</i>');
        if ((ep.steps || []).some(x => ['research', 'download', 'aicut', 'aistyle', 'aisubs', 'aibrand', 'aithumb'].includes(x.id) && x.status === 'failed')) ab.push('<i class="b fail">실패</i>');
        return `${an}/8 단계 · ${esc(ak < 0 ? '끝' : AN[ak])}${ab.length ? `<span class="pl-wbs">${ab.join('')}</span>` : ''}`;
      }
      const flags = [true, !!ep.look, !!(ep.fxPack || (ep.round || 0) >= 1 || (ok('research') && ok('download'))), ok('research') && ok('download'), r >= 1, fb || r >= 2, r >= 2 && !fb, ok('upload')], n = flags.filter(Boolean).length, k = flags.findIndex(x => !x);
      const nx = k < 0 ? null : { g: { name: YT_PLACEHOLDER[k] } };
      const b = [];
      if (ep.running) b.push('<i class="b run">실행 중</i>');

      if ((ep.steps || []).some(x => x.status === 'failed')) b.push('<i class="b fail">실패</i>');
      if (ytEditVideo(ep)) b.push('<i class="b vid">▶ 편집본</i>');
      return `${n}/${flags.length} 단계 · ${esc(nx ? nx.g.name : '끝')}${b.length ? `<span class="pl-wbs">${b.join('')}</span>` : ''}`;
    }
    return runnerOnline === false && !runnerData ? '실행기 꺼짐 · 상태 모름' : AI_CH[ytCh(i)] ? '1차 컷 전' : '편집 스타일 선택 전';
  }
  function ytWipHtml(curId) {
    const list = ytWipList();
    const card = i => { const th = ytThumb(i);
      return `<div class="pl-wc ${i.id === curId ? 'on' : ''}"><button type="button" class="pl-wc-main" data-pl-wip="${esc(i.id)}" ${i.id === curId ? 'aria-current="true"' : ''}>${th ? `<img src="${esc(th)}" alt="" loading="lazy">` : '<span class="pl-wc-ph" aria-hidden="true">🎬</span>'}<span class="pl-wc-t">${esc(i.title)}</span><span class="pl-wc-s">${ytWipStatus(i)}</span></button><button type="button" class="pl-wc-x" data-pl-wiphide="${esc(i.id)}" aria-label="완전히 지우기" title="완전히 지우기">×</button></div>`; };
    const pubs = db.ideas.filter(i => ideaPlatform(i) === 'YouTube' && ytCh(i) === ytTab() && i.publicationCheck);
    const pubHtml = pubs.length ? `<details class="pl-wpub"><summary>올린 영상 ${pubs.length}개</summary><ul>${pubs.map(i => { const u = typeof i.publicationCheck === 'string' ? i.publicationCheck : (i.publicationCheck && i.publicationCheck.url) || ''; return `<li>${/^https?:/.test(u) ? `<a class="pl-link" href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(i.title)} ↗</a>` : esc(i.title)}</li>`; }).join('')}</ul></details>` : '';
    return `<div class="pl-wip" aria-label="작업 중인 영상"><div class="pl-wip-h"><b>작업 중 ${list.length}개</b><button type="button" class="pl-wip-reset" data-pl-ytreset title="유튜브 작업 기록을 모두 지워요 (영상 파일은 휴지통으로)">유튜브 초기화</button>${list.length ? '' : '<span class="small">작업 중인 영상이 없어요. 링크를 넣어 시작하세요.</span>'}</div><div class="pl-wip-row"><button type="button" class="pl-wc pl-wc-new" data-pl-ytchange>＋ 새 링크로 시작</button>${list.map(card).join('')}</div>${pubHtml}</div>`;
  }
  // 이 브라우저의 기록 지우기 (× 와 '유튜브 초기화'가 같이 써요): 주제 + 그 주제의 YouTube 글·초안 + 선택·열림·단계 기록
  function ytCleanLocal(ids) {
    const idset = new Set(ids), keys = new Set(ids.map(id => 'y:' + id));
    const gone = new Set(db.posts.filter(p => idset.has(p.ideaId) && p.channel === 'youtube').map(p => p.id));
    gone.forEach(pid => { try { clearTimeout(draftTimer); draftDel(pid); } catch (_) {} delete S.opened[pid]; });
    db.posts = db.posts.filter(p => !gone.has(p.id));
    db.ideas = db.ideas.filter(x => !idset.has(x.id));
    const sel = S.sel.youtube;
    if (sel && (idset.has(sel.ideaId) || gone.has(sel.postId))) S.sel.youtube = { empty: true };
    keys.forEach(k => { delete S.opened[k]; });
    for (const m of Object.values(T)) if (m && typeof m === 'object' && !Array.isArray(m)) keys.forEach(k => { if (k in m) delete m[k]; });
    if (idset.has(ytPipe.ideaId)) ytPipe.ideaId = '';
    if (idset.has(ytPipe.lookIdea)) { ytPipe.look = ''; ytPipe.lookIdea = ''; }
    if (idset.has(ytPipe.fxIdea)) { ytPipe.fxPack = ''; ytPipe.fxIdea = ''; ytPipe.fxTimes = null; ytPipe.fxLabels = null; }
    if (idset.has(T.ytPick)) T.ytPick = '';
    T.ytSkipAdopt = false;
  }
  // 작업 중 카드의 ×: 실행기의 영상 폴더(휴지통으로) + 이 브라우저의 소재·선택·초안 기록을 모두 지운다
  let ytPurging = false;
  async function ytWipPurge(id) {
    const idea = db.ideas.find(x => x.id === id); if (!idea || ytPurging) return;
    ytPurging = true;
    try {
      let msg = '지웠어요. 영상 파일은 휴지통에 있어요.';
      let eps = null, api = 0;
      try { const h = await runnerFetch('/health'); api = Number.isInteger(h.api) ? h.api : 0; } catch (_) { api = -1; }   // -1 = 실행기 꺼짐
      if (api >= 7) {
        try { eps = ((await runnerFetch('/status')).episodes || []).filter(e => e.ideaId === id); }
        catch (e) { toast('지우지 못했어요: ' + e.message + ' (다시 눌러 보세요)'); return; }
        for (const e of eps) {
          try { await runnerFetch('/episode/delete', { ep: e.ep }); }
          catch (er) { toast('지우지 못했어요: ' + er.message + ' (다시 눌러 보세요)'); return; }
        }
        if (runnerData && runnerData.episodes) runnerData.episodes = runnerData.episodes.filter(e => e.ideaId !== id);
      } else {
        msg = '실행기가 꺼져 있어서 맥의 영상 파일은 그대로예요. 실행기를 켜면 바탕화면 유투브/에피소드 에서 직접 지우세요.';
      }
      ytCleanLocal([id]);
      save(); persist(); render(); toast(msg);
    } finally { ytPurging = false; }
  }
  // '유튜브 초기화': 유튜브 작업 기록 전부(세 채널) — 실행기의 영상·하이라이트 폴더는 휴지통 한 폴더로, 이 브라우저의 기록은 지움. 블로그·인스타 등은 그대로
  async function ytResetAll() {
    if (ytPurging) return;
    const nWip = db.ideas.filter(i => ideaPlatform(i) === 'YouTube' && ytIsWip(i)).length;
    if (!confirm(`유튜브 작업 기록을 모두 지울까요?\n작업 중 영상 ${nWip}개와 하이라이트 찾기 기록이 지워져요. 맥의 영상 파일은 휴지통으로 가요.\n블로그·인스타 등 다른 기록은 그대로예요.`)) return;
    ytPurging = true;
    try {
      const ids = db.ideas.filter(i => ideaPlatform(i) === 'YouTube' && (i.ytStarted || i.ytHidden || i.publicationCheck || ytEp(i)
        || db.posts.some(p => p.ideaId === i.id && p.channel === 'youtube'))).map(i => i.id);
      let msg, api = 0, res = null;
      try { const h = await runnerFetch('/health'); api = Number.isInteger(h.api) ? h.api : 0; } catch (_) { api = -1; }
      if (api >= 9) {
        try { res = await runnerFetch('/reset', { scope: 'youtube' }); }
        catch (e) { toast('초기화하지 못했어요: ' + e.message); return; }   // 409·오류면 여기 기록은 하나도 안 바꿔요
        runnerData = Object.assign({}, runnerData || {}, { episodes: [] });
        msg = res && res.trashed ? `초기화했어요. 영상 파일은 휴지통 '${res.trashed.split('/').pop()}' 폴더에 있어요.` : '초기화했어요. 옮길 영상 파일은 없었어요.';
      } else {
        msg = api === -1 ? '이 화면의 기록만 지웠어요. 실행기가 꺼져 있어서 맥의 영상 파일은 그대로예요. 실행기를 켠 뒤 다시 초기화를 눌러 주세요. 안 그러면 실행기의 영상이 카드로 되살아나요.'
          : '이 화면의 기록만 지웠어요. 실행기가 옛 버전이라 맥의 영상 파일은 그대로예요. 실행기를 새로 켠 뒤 다시 초기화를 눌러 주세요.';
      }
      ytCleanLocal(ids);
      S.sel.youtube = { empty: true }; ytPipe.ideaId = ''; T.view.youtube = null; T.err.youtube = '';
      try { if (typeof window.ytHighlightReset === 'function') window.ytHighlightReset(); } catch (_) {}
      save(); persist(); render(); toast(msg);
    } finally { ytPurging = false; }
  }
  function selectYt(id) { const idea = db.ideas.find(i => i.id === id); if (!idea) return; ytPick(id); S.sel.youtube = { ideaId: id }; T.ytPick = id; save(); }

  // ===== Instagram: 싱부부 인스타툰 단계 =====

  // ===== 인스타 그림 (ChatGPT Codex) — 세 계정 공통 단계 =====
  const CXI = () => window.CodexImg;
  function postOpts(c, it) {
    const p = it.post; if (!p || p.status !== 'approved') return null;
    const a = igOf(p), lang = (IG_BY_ID[a] || {}).lang, pc = CXI().postCards(a, lang, p.title, igName(a), p.body);
    if (!pc.cards.length) return null;
    return { c, account: a, projectId: p.id, lang, title: p.title, item: p, save: () => persist(), cards: pc.cards };
  }
  function toonOpts(pr) {
    if (!pr || !pr.cards || !pr.cards.length) return null;
    return { c: 'insta', account: 'insta-sing', projectId: pr.id, lang: 'ko', title: pr.title || '싱부부', item: pr, save: () => window.InstaToon.flush(),
      cards: pr.cards.map(cd => ({
        label: cd.top || String(cd.scene || '').slice(0, 24),
        scene: [cd.scene || cd.top, cd.artNote ? 'Expression / props / composition: ' + cd.artNote : '', 'Draw this card as ONE full-image scene (a single panel, not a multi-panel page).'].filter(Boolean).join('. '),
        text: [{ role: 'top caption', text: cd.top }, { role: 'speech bubble', text: cd.dialogue }, { role: 'bottom caption', text: cd.bottom }].filter(t => String(t.text || '').trim()),
      })) };
  }
  function codexArtStep(c, getOpts, extra, alsoDone) {
    return {
      id: 'art', name: '그림', title: '그림 만들기 (Codex)',
      desc: 'ChatGPT Codex가 카드마다 그림을 그려요 (말풍선·글자까지). 그림체를 고르고 큰 버튼을 누르세요. 마음에 안 드는 카드만 다시 그릴 수 있어요.',
      btn: it => CXI().btnLabel(getOpts(it)), disabled: it => CXI().btnDisabled(getOpts(it)),
      isDone: it => { const o = getOpts(it); return !!o && o.cards.length > 0 && (CXI().doneCount(o) >= o.cards.length || !!(alsoDone && alsoDone(it, o))); },
      result: it => { const o = getOpts(it); if (!o) return ''; const n = CXI().doneCount(o); return n ? `<b>${n}/${o.cards.length}장</b> 그림 준비됨` : ''; },
      body: it => { const o = getOpts(it); return (o ? CXI().panel(o) : '<p class="pl-note">먼저 앞 단계를 끝내 주세요. (승인된 원고가 있어야 카드가 나뉘어요)</p>') + (extra ? extra(it) : ''); },
      run: it => CXI().drawAll(getOpts(it)),
    };
  }
  window.addEventListener('cx-change', () => repaint());

  function toonItem() {
    const IT = window.InstaToon, pr = IT && IT.current();
    return { c: 'insta', toon: pr, key: pr ? 't:' + pr.id : '', title: pr ? (pr.title || pr.raw.slice(0, 24) || '제목 없는 이야기') : '' };
  }
  const toonCount = p => (p && p.cards ? p.cards.length : 0);
  function toonCaption(p) {
    if (p.caption != null) return p.caption;
    return `${p.title || '이번 편'}\n\n#싱부부의외노자일기 #인스타툰 #싱가포르 #외노자`;
  }
  const pngMode = it => (it.toon && it.toon.pngMode) || 'codex';
  function toonSteps() {
    const IT = window.InstaToon;
    const need = (it, fn) => it.toon ? fn(it.toon) : '';
    return [
      { id: 'story', name: '이야기', title: '이야기 적기', desc: '겪은 일을 순서대로 적으세요. 버튼을 누르면 컷 대본 초안이 나와요.',
        btn: it => IT.state.busy ? '컷 대본 만드는 중…' : it.toon && toonCount(it.toon) ? '컷 대본 다시 만들기' : '컷 대본 만들기', disabled: () => !!IT.state.busy,
        isDone: it => !!(it.toon && toonCount(it.toon)),
        result: it => need(it, p => toonCount(p) ? `<b>컷 ${toonCount(p)}장</b>${p.generation ? ' · ' + esc(p.generation) : ''}` : ''),
        body: it => `<div class="it pl-it"><label class="it-field"><span>제목</span><input id="itTitle" data-it-field="title" maxlength="120" placeholder="예: 퇴근길에 쇼피를 켰다가" value="${IT.safe(it.toon?.title || '')}"></label>
          <label class="it-field"><span>겪은 일을 순서대로 적어주세요</span><textarea id="itStory" data-it-field="raw" maxlength="12000" placeholder="오늘 무슨 일이 있었는지, 누가 무슨 말을 했는지, 마지막에 어떤 기분이 들었는지 편하게 적어주세요.">${IT.safe(it.toon?.raw || '')}</textarea></label></div>`,
        run: () => IT.generateCards() },
      { id: 'cards', name: '컷 대본', title: '컷 대본 다듬기', desc: '컷마다 위 문장·장면·대사·아래 문장을 고치세요. 다 괜찮으면 그림 단계로 가요.',
        btn: '다 오케이, 그림 작업으로', disabled: it => !it.toon || !toonCount(it.toon),
        isDone: it => !!(it.toon && it.toon.approvedAt && it.toon.stage === 'art'),
        result: it => need(it, p => p.approvedAt && p.stage === 'art' ? `<b>✓ 컷 ${toonCount(p)}장 확정</b>` : toonCount(p) ? `컷 ${toonCount(p)}장 · 확정 전` : ''),
        body: it => it.toon && toonCount(it.toon) ? `<div class="it pl-it"><div class="it-board"><div class="it-grid">${it.toon.cards.map(IT.cardMarkup).join('')}</div></div><div class="it-actions"><button type="button" class="it-button it-button-quiet" data-it="add-card">＋ 컷 추가</button></div></div>` : '<p class="pl-note">먼저 이야기 단계에서 컷 대본을 만들어 주세요.</p>',
        run: () => IT.approve() },
      Object.assign(codexArtStep('insta', it => it.toon && it.toon.stage === 'art' ? toonOpts(it.toon) : null,
        it => it.toon && it.toon.stage === 'art' ? `<details class="pl-peek"><summary>예전 방식 · 구글 Flow로 직접 만들 때</summary><p class="small">Flow에서 컷마다 그림을 만들고, 다음 단계의 "말풍선 직접 넣기"에서 카드 칸에 끌어다 놓으면 대사·문장이 글자로 얹혀요.</p><p><a class="it-link" href="./assets/singbubu-logo.png" download="싱부부-기준이미지.png">기준 이미지 저장</a> · <a class="it-link" href="https://labs.google/fx/tools/flow" target="_blank" rel="noopener noreferrer">구글 Flow 열기 ↗</a> · <button type="button" class="pl-link" data-pl-copybrief>그림 요청서 전체 복사</button></p></details>` : '',
        (it, o) => (it.toon.imgDone || 0) >= o.cards.length), { desc: 'ChatGPT Codex가 컷마다 그림을 그려요 — 말풍선과 한국어 대사까지 그림 안에 그려 줘요. 그림체를 고르고 큰 버튼을 누르세요.' }),
      { id: 'png', name: 'PNG 저장', title: it => pngMode(it) === 'bubble' ? 'PNG로 합성해 저장 (말풍선 직접 넣기)' : 'PNG로 모아 저장',
        desc: it => pngMode(it) === 'bubble' ? '그림을 직접 넣으면 대사와 문장이 위에 얹혀요. 버튼을 누르면 컷마다 PNG 파일이 저장돼요.' : 'Codex가 글자까지 그렸어요. 고른 그림을 컷 순서대로 파일로 저장해요.',
        btn: it => pngMode(it) === 'bubble' ? '전체 PNG 저장' : '고른 그림 전체 저장',
        disabled: it => !it.toon || (pngMode(it) === 'bubble' ? !(it.toon.imgDone > 0) : !(toonOpts(it.toon) && CXI().doneCount(toonOpts(it.toon)) > 0)),
        isDone: it => !!(it.toon && it.toon.pngAt),
        result: it => need(it, p => p.pngAt ? `<b>✓ PNG ${p.pngCount || ''}장 저장</b> · ${relative(p.pngAt)}` : ''),
        body: it => {
          if (!it.toon || it.toon.stage !== 'art') return '';
          const m = pngMode(it), chips = `<div class="pl-chips" role="group" aria-label="저장 방식"><button type="button" class="pl-chip ${m === 'codex' ? 'on' : ''}" data-pl-pngmode="codex">Codex 그림 그대로</button><button type="button" class="pl-chip ${m === 'bubble' ? 'on' : ''}" data-pl-pngmode="bubble">말풍선 직접 넣기</button></div>`;
          if (m === 'bubble') return chips + `<p><button type="button" class="pl-nav-btn" data-pl-cx2old>Codex 그림을 아래 칸으로 가져오기</button></p><div class="it pl-it">${IT.artGrid(it.toon)}</div>`;
          const o = toonOpts(it.toon); return chips + (o ? `<p class="pl-note"><b>${CXI().doneCount(o)}/${o.cards.length}장</b> 고름 · 그림 단계에서 카드별로 다른 버전을 고를 수 있어요.</p>${CXI().gallery(o)}` : '');
        },
        run: it => {
          if (pngMode(it) === 'bubble') return IT.saveAll();
          const p = it.toon;
          return CXI().downloadAll(toonOpts(p)).then(n => { if (n) { p.pngAt = Date.now(); p.pngCount = n; IT.flush(); } });
        } },
      { id: 'upload', name: '캡션·업로드', title: '캡션 쓰고 인스타에 올리기', desc: '캡션을 복사하고 인스타를 열어요. 저장한 PNG를 순서대로 올리고, \'AI 정보\' 표시를 켜세요.',
        btn: it => it.toon && uploaded(it.key, null) ? '주소 남기기' : '캡션 복사 · 인스타 열기', disabled: it => !it.toon,
        hideBtn: it => !!(it.toon && it.toon.publicationCheck),
        isDone: it => !!(it.toon && it.toon.publicationCheck),
        result: it => need(it, p => p.publicationCheck ? `<b>${doneLink(p.publicationCheck)}</b>` : uploaded(it.key, null) ? '올리는 중 · 올린 뒤 아래에 주소를 남겨 주세요' : ''),
        body: it => !it.toon ? '' : `<label class="pl-own"><span>캡션</span><textarea class="pl-answer" data-pl-caption rows="5">${esc(toonCaption(it.toon))}</textarea></label>${uploaded(it.key, null) && !it.toon.publicationCheck ? urlFormHtml(it.key) : ''}`,
        run: it => {
          const p = it.toon;
          if (p.publicationCheck) return;
          if (!uploaded(it.key, null)) {
            const pending = copyText(toonCaption(p)); window.open(WRITE_URL.insta, '_blank', 'noopener');
            pending.then(ok => { S.opened[it.key] = true; save(); toast(ok ? '캡션을 복사했고 인스타를 열었어요.' : '복사가 안 됐어요. 캡션 칸을 직접 복사해 주세요.'); repaint('insta'); });
            return;
          }
          try { p.publicationCheck = readUrl(it.key); T.err.insta = ''; log('인스타툰 게시 확인: ' + it.title); IT.flush(); toast('주소를 남겼어요. 한 편 끝!'); } catch (e) { T.err.insta = e.message; }
          repaint('insta');
        } },
    ];
  }

  // ===== 어댑터: 플랫폼마다 "지금 작업", "작업 목록", "단계" =====
  const GENERIC = ['blog', 'x', 'telegram', 'threads'];
  function adapter(c) {
    if (c === 'youtube') return {
      item: ytItem, steps: ytStepsFor,
      list: it => {
        const out = [], seen = new Set();
        const add = i => { if (!i || seen.has(i.id) || i.publicationCheck && !(it.idea && it.idea.id === i.id)) return; seen.add(i.id); out.push({ key: 'y:' + i.id, label: i.title, id: i.id }); };
        (runnerData?.episodes || []).forEach(e => { const i = db.ideas.find(x => x.id === e.ideaId); if (i && ytCh(i) === ytTab()) add(i); });
        add(it.idea); return out;
      },
      select: key => selectYt(key.slice(2)),
      fresh: () => { S.sel.youtube = { empty: true }; ytPipe.ideaId = ''; T.ytSkipAdopt = false; T.ytPick = ''; save(); },
    };
    if (c === 'insta') {
      igSync();
      const toonOn = () => igCur() === 'insta-sing' && S.instaMode !== 'post';
      return {
        item: () => {
          const s = S.sel.insta = S.sel.insta || {};
          if (!toonOn() || s.kind === 'post' || (!s.kind && S.instaMode === 'post')) { const g = gItem('insta'); g.kind = 'post'; return g; }
          const t = toonItem(); t.kind = 'toon'; return t;
        },
        steps: it => it.kind === 'post' ? genericSteps('insta') : toonSteps(),
        list: it => {
          const out = [], IT = window.InstaToon;
          if (igCur() === 'insta-sing') IT.list().filter(p => (p.raw.trim() || toonCount(p)) && (!p.publicationCheck || (it.toon && it.toon.id === p.id))).forEach(p => out.push({ key: 't:' + p.id, label: '🎨 ' + (p.title || p.raw.slice(0, 24) || '제목 없는 이야기') }));
          unfinished('insta').forEach(p => out.push({ key: 'p:' + p.id, label: '🖼 ' + p.title }));
          if (it.kind === 'post' && it.idea && !it.post) out.push({ key: 'i:' + it.idea.id, label: '🖼 ' + it.idea.title });
          return out;
        },
        select: key => {
          const IT = window.InstaToon;
          if (key.startsWith('t:')) { S.sel.insta = { kind: 'toon' }; IT.remember(key.slice(2)); }
          else { S.sel.insta = { kind: 'post', ...(key.startsWith('p:') ? { postId: key.slice(2) } : { ideaId: key.slice(2) }) }; }
          save();
        },
        fresh: () => { window.InstaToon.remember(''); S.sel.insta = { kind: toonOn() ? 'toon' : 'post', empty: true }; save(); },
      };
    }
    return {
      item: () => gItem(c), steps: () => genericSteps(c),
      list: it => {
        const out = unfinished(c).map(p => ({ key: 'p:' + p.id, label: p.title + (p.sample ? ' (예시)' : '') }));
        if (it.post && it.post.publicationCheck) out.unshift({ key: 'p:' + it.post.id, label: '✓ ' + it.post.title });
        if (it.idea && !it.post) out.unshift({ key: 'i:' + it.idea.id, label: it.idea.title });
        return out;
      },
      select: key => { S.sel[c] = key.startsWith('p:') ? { postId: key.slice(2) } : { ideaId: key.slice(2) }; save(); },
      fresh: () => { S.sel[c] = { empty: true }; T.pick[c] = ''; save(); },
    };
  }

  // ===== 그리기 =====
  function evalSteps(c) {
    const A = adapter(c), it = A.item(), steps = A.steps(it), done = steps.map(s => !!s.isDone(it));
    const now = done.indexOf(false), lastIdx = steps.length - 1;
    return { A, it, steps, done, now: now < 0 ? steps.length : now, lastIdx };
  }
  const val = (x, it) => typeof x === 'function' ? x(it) : x;
  function frame(c) {
    const { A, it, steps, done, now, lastIdx } = evalSteps(c);
    const allDone = now >= steps.length;
    let v = T.view[c]; const maxV = Math.min(now, lastIdx);
    if (v == null || (v > maxV && !(steps[v] && steps[v].peek)) || v < 0) v = maxV;
    const s = steps[v], N = steps.length;
    const pc = platformColor(PF_NAME[c]);
    const list = A.list(it), cur = it.key;
    const bar = `<ol class="pl-bar" aria-label="작업 단계">${steps.map((st, k) => {
      const st8 = done[k] ? 'done' : k === now ? 'now' : 'todo', can = k <= now || !!st.peek;
      return `<li class="${st8} ${k === v ? 'view' : ''}"><button type="button" ${can ? `data-pl-go="${k}"` : 'disabled'} ${k === v ? 'aria-current="step"' : ''}><span class="pl-n" aria-hidden="true">${done[k] ? '✓' : k + 1}</span><span class="pl-nm">${esc(st.name)}</span></button></li>`;
    }).join('')}</ol>`;
    const items = c === 'youtube' ? ytWipHtml(it.idea ? it.idea.id : '') : `<div class="pl-items"><label><span>작업 중</span><select data-pl-item aria-label="작업 중인 글">${list.length ? '' : '<option value="">작업 없음</option>'}${list.map(o => `<option value="${esc(o.key)}" ${o.key === cur ? 'selected' : ''}>${esc(o.label.length > 36 ? o.label.slice(0, 36) + '…' : o.label)}</option>`).join('')}</select></label><button type="button" class="pl-newbtn" data-pl-new>＋ 새 작업</button></div>`;
    const insta = c === 'insta' && igCur() === 'insta-sing' ? `<div class="pl-chips pl-instamode" role="group" aria-label="만들 것"><button type="button" class="pl-chip ${(it.kind || 'toon') === 'toon' ? 'on' : ''}" data-pl-instamode="toon">🎨 인스타툰</button><button type="button" class="pl-chip ${it.kind === 'post' ? 'on' : ''}" data-pl-instamode="post">🖼 카드뉴스·릴스</button></div>` : '';
    const dis = !!(s.disabled && s.disabled(it)), hide = !!(s.noBtn || (s.hideBtn && s.hideBtn(it) && done[v]));
    const attrs = s.attrs ? s.attrs(it) : 'data-pl-run';
    const btn = hide ? '' : `<button type="button" class="pl-primary ${done[v] ? 'again' : ''} ${s.cls || ''}" ${attrs} ${dis ? 'disabled' : ''}>${esc(val(s.btn, it))}</button>`;
    const res = s.result ? s.result(it) : '';
    const err = T.err[c] ? `<p class="pl-error" role="alert">${esc(T.err[c])}</p>` : '';
    const statusLine = s.statusLine ? s.statusLine() : '';
    const next = v < lastIdx ? `<button type="button" class="pl-nav-btn ${done[v] ? 'go' : ''}" data-pl-next ${done[v] ? '' : 'disabled'}>다음 단계 →</button>` : '';
    const finish = allDone ? `<div class="pl-finish"><b>🎉 이 작업이 끝났어요.</b> ${esc(PLATFORM_PLAYBOOK[PF_NAME[c]]?.metric ? '올린 뒤 볼 숫자: ' + PLATFORM_PLAYBOOK[PF_NAME[c]].metric : '')}<button type="button" class="pl-primary again" data-pl-new>＋ 새 작업 시작</button></div>` : '';
    const lastLabel = v === lastIdx ? '<span class="pl-tag">마지막 · 업로드</span>' : '';
    const yt = c === 'youtube', doneN = done.filter(Boolean).length;
    const prog = yt && it.idea ? `<div class="pl-prog"><span><b>${doneN}/${N}</b> 단계 끝 · 지금 <b>${esc(steps[Math.min(now, lastIdx)].name)}</b></span><i><i style="width:${Math.round(doneN / N * 100)}%"></i></i></div>` : '';
    const runBox = statusLine ? (yt ? `<div class="pl-run" role="status">${statusLine}</div>` : `<p class="small pl-status">${statusLine}</p>`) : '';
    return `<section class="pl ${c === 'youtube' ? 'pl-yt' : ''}" id="plRoot" data-c="${c}" data-v="${v}" style="--pc:${pc}">${c === 'youtube' ? '<i id="ytAuto" hidden></i>' : ''}
      <div class="pl-top">${items}${insta}</div>${c === 'youtube' ? ytPlayerHtml(it) : ''}${prog}${bar}
      <article class="pl-card" aria-live="polite"><div class="pl-steplabel">${v + 1} / ${N} 단계 ${lastLabel}</div>
        <h2>${esc(val(s.title, it))}</h2><p class="pl-desc">${esc(val(s.desc, it))}</p>${yt ? runBox : ''}
        ${c === 'youtube' && !AI_CH[it.idea ? ytCh(it.idea) : ytTab()] ? ytOutHtml(it) : ''}${val(s.body || '', it) || ''}${err}
        ${btn}${yt ? '' : runBox}
        ${yt && !res ? '' : `<div class="pl-result" aria-label="이 단계의 결과"><div class="pl-result-h">결과</div>${res || '<span class="small">아직 없어요. 위 버튼을 누르면 여기에 나와요.</span>'}</div>`}
        ${finish}
        <div class="pl-nav"><button type="button" class="pl-nav-btn" data-pl-prev ${v > 0 ? '' : 'disabled'}>← 이전</button>${next}</div>
      </article></section>`;
  }
  function pageFor(c) {
    const pf = PF_NAME[c], book = PLATFORM_PLAYBOOK[pf], ig = c === 'insta' ? IG_BY_ID[igCur()] : null, yh = c === 'youtube' ? ytHeader() : null;
    return `<div class="pl-head" style="--pc:${platformColor(pf)}"><div class="eyebrow">${esc(pf)}</div><h1>${esc(yh ? yh.title : ig ? igName(ig.id) : platformLabel(pf))}</h1><p>${esc(yh ? yh.desc : ig ? ig.role : book.role)}</p></div>${frame(c)}`;
  }

  // 다시 그리기 (타이핑 중이면 건드리지 않음)
  function repaint(c, force) {
    const root = document.getElementById('plRoot');
    if (!root || (c && root.dataset.c !== c)) return;
    const a = document.activeElement;
    if (!force && a && root.contains(a) && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName)) return;
    if (typeof recState === 'object' && recState.rec) return;
    const html = frame(root.dataset.c);
    if (!force && root.dataset.sig === html) return;
    const open = [...root.querySelectorAll('details')].map(d => d.open);
    const tmp = document.createElement('div'); tmp.innerHTML = html;
    const next = tmp.firstElementChild; next.dataset.sig = html;
    [...next.querySelectorAll('details')].forEach((d, k) => { if (open[k]) d.open = true; });
    for (const nv of next.querySelectorAll('video[id]')) { const ov = root.querySelector('video[id="' + nv.id + '"]'); if (ov && ov.getAttribute('src') === nv.getAttribute('src')) nv.replaceWith(ov); }   // 보고 있던 영상은 끊지 않는다
    root.replaceWith(next);
    afterPaint(root.dataset.c);
  }
  // 대본 단계로 돌아가기 (빈 대본 오류가 났을 때)
  window.ytGoScript = function () { const { steps } = evalSteps('youtube'), k = steps.findIndex(x => x.id === 'g-voice'); if (k >= 0) { T.view.youtube = k; repaint('youtube', true); } };
  window.ytRepaint = function () { repaint('youtube'); };
  function afterPaint(c) {
    if (c === 'youtube') { setTimeout(ytPrevSync, 0); setTimeout(ytUpTextHydrate, 0); }
    if (window.CodexImg) setTimeout(() => CodexImg.hydrate(), 0);
    if (c === 'insta') setTimeout(() => window.InstaToon && window.InstaToon.hydrateArt(), 0);
    if (c === 'youtube' && T.logOpen) { const el = document.getElementById('plLog'), ep = ytItem().ep; if (el && ep) runnerFetch(`/log?ep=${encodeURIComponent(ep.ep)}&step=${T.logOpen}&tail=6000`).then(t => { el.textContent = t || '(로그 없음)'; el.scrollTop = el.scrollHeight; }).catch(e => { el.textContent = '로그를 못 읽었어요: ' + e.message; }); }
  }
  const origRecPaint = recPaint;
  recPaint = function () { if (document.getElementById('yaRec')) origRecPaint(); else repaint('youtube', true); };
  window.addEventListener('it-art', () => repaint('insta'));
  // 유튜브 실행기 상태가 바뀔 때마다 같이 다시 그린다
  const origRefresh = runnerRefresh;
  runnerRefresh = async function () { await origRefresh(); repaint('youtube'); const h = document.getElementById('plHome'); if (h) h.replaceWith(homeEl()); };

  // ===== 플랫폼 화면 / 오늘 할 일 =====
  const basePlatformPage = platformPage;
  platformPage = function (c) {
    ensurePlatformStarters();
    let base;
    if (c === 'youtube') { const keep = window.ytAutoPanel; window.ytAutoPanel = () => ''; try { base = basePlatformPage(c); } finally { window.ytAutoPanel = keep; } } else base = basePlatformPage(c);
    if (c === 'youtube') setTimeout(runnerRefresh, 0);
    setTimeout(() => afterPaint(c), 0);
    const ref = base;
    return pageFor(c) + `<details class="pl-ref"><summary>참고 · 제작 방법·잘 만드는 법·주제 관리·원고 목록</summary>${ref}</details>`;
  };

  function summary(c) {
    try {
      const { it, steps, done, now } = evalSteps(c), N = steps.length, k = Math.min(now, N - 1);
      return { c, title: it.title || '', has: !!(it.key), done: now >= N, idx: k, N, name: steps[k].name, stepTitle: val(steps[k].title, it) };
    } catch (_) { return { c, title: '', has: false, idx: 0, N: 0, name: '' }; }
  }
  function homeEl() { const d = document.createElement('div'); d.innerHTML = homeHtml(); return d.firstElementChild; }
  function homeHtml() {
    const ents = [];
    for (const pf of IDEA_PLATFORMS) {
      const c = PF_KEY[pf];
      if (c === 'youtube') { ents.push({ pf, c, route: 'youtube', label: platformLabel(pf) }); Object.keys(YT_LOCKS).forEach(id => ents.push({ pf, c, route: id, label: YT_LOCKS[id] })); }
      else if (c === 'insta') IG_ACCOUNTS.forEach(a => ents.push({ pf, c, route: a.id, label: 'Insta - ' + (a.id === 'insta-krsg' ? 'KR Content for SG' : igName(a.id)), role: a.role }));
      else ents.push({ pf, c, route: c, label: platformLabel(pf) });
    }
    const rows = ents.map(e => {
      const { pf, c } = e, s = withRoute(e.route, () => summary(c)), pb = db.posts.filter(p => p.channel === c && p.status === 'review').length;
      const prog = s.has ? `<span class="pl-home-step"><b>${s.idx + 1}/${s.N}</b> ${esc(s.name)}</span>` : '<span class="pl-home-step none">진행 중인 작업 없음</span>';
      const lbl = s.has ? (s.done ? '새 작업 시작' : '이어서 하기 →') : '새 작업 시작 →';
      return `<article class="pl-home-row" style="--pc:${platformColor(pf)}"><div class="pl-home-main"><span class="pl-home-pf">${esc(e.label)}</span><span class="pl-home-title">${esc(s.has ? s.title : (e.role || book(pf)))}</span>${prog}</div>
        <div class="pl-home-bar" aria-hidden="true"><i style="width:${s.has && s.N ? Math.round((s.done ? s.N : s.idx) / s.N * 100) : 0}%"></i></div>
        <button type="button" class="pl-primary ${s.has ? '' : 'again'}" data-pl-goto="${c}" data-pl-route="${e.route}">${lbl}</button></article>`;
    }).join('');
    return `<section class="pl-home" id="plHome">${rows}</section>`;
  }
  const book = pf => (PLATFORM_PLAYBOOK[pf] || {}).role || '';
  const baseCommonPage = commonPage;
  commonPage = function () {
    const html = baseCommonPage(), at = html.indexOf('<div class="cp-pfs">');
    const ref = at < 0 ? html : html.slice(at);
    return head('오늘 할 일', '플랫폼마다 하던 작업이 어디까지 왔는지 보고, 버튼 하나로 그 단계로 가세요.', false)
      + homeHtml() + `<details class="pl-ref"><summary>참고 · 공통 원리·작업 순서·검수 기준·공통 프로그램</summary>${ref}</details>`;
  };

  // ===== 이벤트 =====
  function go(c, v) { T.view[c] = v; repaint(c, true); }
  document.addEventListener('click', e => {
    const home = e.target.closest('[data-pl-goto]');
    if (home) {
      const c = home.dataset.plGoto, route = home.dataset.plRoute || c;
      withRoute(route, () => { const { it, now, steps } = evalSteps(c); if (it.key && now >= steps.length) adapter(c).fresh(); });
      igLock = IG_BY_ID[route] ? route : igLock; T.view[c] = null; navigate(route); return;
    }
    const root = e.target.closest('#plRoot'); if (!root) return;
    const c = root.dataset.c, v = +root.dataset.v, t = e.target.closest('button, a'); if (!t) return;
    const ctx = () => evalSteps(c);
    if (t.hasAttribute('data-pl-lkread')) { linkRead(c, false); return; }
    if (t.hasAttribute('data-pl-lkpaste')) { linkRead(c, true); return; }
    if (t.hasAttribute('data-pl-lkcopy')) { linkCopy(c); return; }
    if (t.hasAttribute('data-pl-lkparse')) { linkParse(c); return; }
    if (t.dataset.plLkpick !== undefined) { linkPick(c, +t.dataset.plLkpick); return; }
    if (t.hasAttribute('data-pl-lkcommit')) { if (commitTopic(c)) { T.view[c] = 1; repaint(c, true); } return; }
    if (t.dataset.plPngmode) { const pr = window.InstaToon.current(); if (pr) { pr.pngMode = t.dataset.plPngmode; window.InstaToon.flush(); } repaint(c, true); return; }
    if (t.hasAttribute('data-pl-copybrief')) { window.InstaToon.copyBrief(); return; }
    if (t.hasAttribute('data-pl-cxdl')) { const { it } = ctx(), o = it.toon ? toonOpts(it.toon) : postOpts(c, it); if (o) CXI().downloadAll(o); return; }
    if (t.hasAttribute('data-pl-cx2old')) {
      const { it } = ctx(), o = toonOpts(it.toon); if (!o) return;
      CXI().chosenBlobs(o).then(async list => { for (const x of list) await window.InstaToon.setCardImage(it.toon.cards[x.index].id, x.blob); toast(list.length ? `그림 ${list.length}장을 가져왔어요.` : '가져올 그림이 없어요.'); }).catch(() => toast('그림을 가져오지 못했어요. 실행기가 켜져 있나요?'));
      return;
    }
    if (t.hasAttribute('data-pl-redo1')) { const { it, steps } = ctx(), k = steps.findIndex(x => x.id === 'e1'); if (k >= 0) { T.redo1[it.key] = true; go(c, k); } return; }
    if (t.hasAttribute('data-pl-go')) { go(c, +t.dataset.plGo); return; }
    if (t.hasAttribute('data-pl-prev')) { go(c, Math.max(0, v - 1)); return; }
    if (t.hasAttribute('data-pl-next')) { go(c, v + 1); return; }
    if (t.hasAttribute('data-pl-new')) { adapter(c).fresh(); T.link[c] = null; T.view[c] = 0; T.err[c] = ''; T.manual[c] = false; T.askCopied[c] = false; repaint(c, true); return; }
    if (t.dataset.plPick) { T.pick[c] = t.dataset.plPick; T.custom[c] = ''; repaint(c, true); return; }
    if (t.hasAttribute('data-pl-more')) { T.page[c] = (T.page[c] || 0) + 1; repaint(c, true); return; }
    if (t.dataset.plWip) { selectYt(t.dataset.plWip); T.view.youtube = null; T.err.youtube = ''; render(); return; }
    if (t.hasAttribute('data-pl-ytreset')) { ytResetAll(); return; }
    if (t.dataset.plWiphide) { ytWipPurge(t.dataset.plWiphide); return; }
    if (t.dataset.plYtpick) { selectYt(t.dataset.plYtpick); T.view.youtube = null; repaint('youtube', true); return; }
    if (t.dataset.plYlchip) { ylSetUrl(t.dataset.plYlchip, true); return; }
    if (t.hasAttribute('data-pl-outtoggle')) { T.outOpen = !ytOutOpen(); ytOutRefresh(); return; }
    if (t.dataset.plOutmode) { YP.mode = t.dataset.plOutmode === 'mock' ? 'mock' : 'real'; ytOutRefresh(); return; }
    if (t.dataset.yaFxpick) { const { it } = ctx(); ytPipe.fxPack = t.dataset.yaFxpick; ytPipe.fxIdea = it.idea ? it.idea.id : ''; repaint('youtube', true); return; }
    if (t.dataset.yaVtype) { const { it } = ctx(); ytPipe.vtype = t.dataset.yaVtype; ytPipe.vtypeIdea = it.idea ? it.idea.id : ''; repaint('youtube', true); return; }
    if (t.dataset.yaLookpick) { const { it } = ctx(); ytPipe.look = t.dataset.yaLookpick; ytPipe.lookIdea = it.idea ? it.idea.id : ''; repaint('youtube', true); return; }
    if (t.hasAttribute('data-pl-ytchange')) { ytLinkReset(); adapter('youtube').fresh(); T.view.youtube = 0; repaint('youtube', true); return; }
    if (t.dataset.plYsrc) { const u = t.dataset.plYsrc, i = document.querySelector('#plRoot [data-ya-new="url"]'); ytPipe.url = u; if (i) i.value = u; return; }
    if (t.dataset.plInstamode) { S.instaMode = t.dataset.plInstamode; save(); adapter('insta').fresh(); T.view.insta = 0; repaint('insta', true); return; }
    if (t.hasAttribute('data-pl-manualmode')) { T.manual[c] = true; T.err[c] = ''; repaint(c, true); return; }
    if (t.hasAttribute('data-pl-retryauto')) { T.manual[c] = false; T.err[c] = ''; T.askCopied[c] = false; repaint(c, true); return; }
    if (t.hasAttribute('data-pl-recopy')) { const { it } = ctx(); manualCopy(c, it); return; }
    if (t.hasAttribute('data-pl-unapprove')) { const { it } = ctx(); if (it.post) { it.post.status = 'review'; it.post.updated = Date.now(); log('승인 취소: ' + it.post.title); persist(); T.view[c] = v; repaint(c, true); } return; }
    if (t.hasAttribute('data-pl-tgagain')) { const { it } = ctx(); tgConfirm(it.post, true); return; }
    if (t.hasAttribute('data-pl-tgauto')) { const { it } = ctx(); tgConfirm(it.post, false); return; }
    if (t.hasAttribute('data-pl-copyopen')) { const { it } = ctx(); if (it.post) copyOpen(c, it.post); return; }
    if (t.dataset.plLog) { T.logOpen = T.logOpen === t.dataset.plLog ? null : t.dataset.plLog; repaint(c, true); return; }
    if (t.hasAttribute('data-pl-run')) {
      const { it, steps } = ctx(); T.view[c] = v;
      const s = steps[v]; if (!s || (s.disabled && s.disabled(it))) return;
      T.err[c] = ''; const r = s.run(it);
      Promise.resolve(r).then(() => { if (!T.busy[c]) repaint(c, true); });
    }
  });
  document.addEventListener('click', e => {
    const y = e.target.closest('button[data-pl-tgyes]'); if (!y) return;
    closeModal(); tgSend(y.dataset.plTgyes, !!y.dataset.again);
  });
  // 유튜브 실행기 버튼(data-ya-*)은 fieldnote-runner.js 가 처리한다. 누르는 순간 보고 있던 단계를 붙잡아 두고, 끝나면 다시 그린다.
  document.addEventListener('click', e => {
    if (e.target.closest('#plRoot [data-yp-format]')) { S.sel.youtube = { empty: true }; save(); return; }
    const b = e.target.closest('#plRoot [data-ya-run], #plRoot [data-ya-steps], #plRoot [data-ya-act], #plRoot [data-ya-recopen]'); if (!b) return;
    const root = b.closest('#plRoot'); T.view.youtube = +root.dataset.v;
    if (b.dataset.yaAct === 'edit') T.redo1 = {};
    setTimeout(() => repaint('youtube', true), 700);
  }, true);
  document.addEventListener('change', e => {
    const fr = e.target.closest('input[data-fx-ref]');
    if (fr) { const id = fr.dataset.fxRef, v = fr.value.trim(); if (v && !/^https?:\/\//i.test(v)) { toast('https:// 로 시작하는 링크를 넣어 주세요.'); return; } if (v) S.fxRefs[id] = v; else delete S.fxRefs[id]; save(); repaint('youtube', true); return; }
    const sel = e.target.closest('select[data-pl-item]');
    if (sel) { const root = sel.closest('#plRoot'), c = root.dataset.c; if (!sel.value) return; adapter(c).select(sel.value); T.view[c] = null; T.err[c] = ''; T.manual[c] = false; T.askCopied[c] = false; if (c === 'youtube' || c === 'insta') render(); else repaint(c, true); return; }
    const ck = e.target.closest('input[data-pl-check]');
    if (ck) { const c = ck.closest('#plRoot').dataset.c, { it } = evalSteps(c); if (it.post) { it.post.checks[+ck.dataset.plCheck] = ck.checked; it.post.updated = Date.now(); persist(); T.err[c] = ''; repaint(c, true); } return; }
    const seen = e.target.closest('input[data-pl-seen]'); if (seen) T.seen[seen.dataset.plSeen] = seen.checked;
  });
  document.addEventListener('input', e => {
    const t = e.target, c = t.closest && t.closest('#plRoot') && t.closest('#plRoot').dataset.c;
    if (!c) return;
    if (t.id === 'plLinkUrl') LK(c).url = t.value;
    else if (t.id === 'plLinkPaste') LK(c).paste = t.value;
    else if (t.id === 'plLinkAnswer') LK(c).answer = t.value;
    else if (t.id === 'plCustom') T.custom[c] = t.value;
    else if (t.id === 'plAnswer') T.answer[c] = t.value;
    else if (t.dataset.plUrlinput) T.url[t.dataset.plUrlinput] = t.value;
    else if (t.hasAttribute('data-pl-caption')) { const p = c === 'insta' && window.InstaToon.current(); if (p) { p.caption = t.value; persist(); } }
    else if (t.dataset.yl) { if (t.dataset.yl === 'url') ylSetUrl(t.value); else if (t.dataset.yl === 'title') { YL.title = t.value; YL.edited = true; } else YL.view = t.value; }
    else if (t.dataset.yaNew === 'fxtimes') { const { it } = evalSteps('youtube'); ytPipe.fxTimes = t.value; ytPipe.fxIdea = it.idea ? it.idea.id : ''; if (!ytPipe.fxPack) ytPipe.fxPack = ytFxPick(it, it.ep); document.querySelector('#plRoot [data-ya-act="fxpack"]')?.removeAttribute('disabled'); ytOutRefresh(); ytPrevSync(); }
    else if (t.dataset.yaNew === 'fxlabels') { const { it } = evalSteps('youtube'); ytPipe.fxLabels = t.value; ytPipe.fxIdea = it.idea ? it.idea.id : ''; if (!ytPipe.fxPack) ytPipe.fxPack = ytFxPick(it, it.ep); document.querySelector('#plRoot [data-ya-act="fxpack"]')?.removeAttribute('disabled'); ytOutRefresh(); ytPrevSync(); }
    else if (t.dataset.yaNew) { if (t.dataset.yaNew === 'url') ytPipe.url = t.value; else { ytPipe.ranges = t.value; ytOutRefresh(); } }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.target.id === 'plLinkUrl') { e.preventDefault(); const c = e.target.closest('#plRoot').dataset.c; linkRead(c, false); } });
  document.addEventListener('submit', e => { const f = e.target.closest('[data-pl-urlform]'); if (f) { e.preventDefault(); f.closest('#plRoot').querySelector('.pl-primary')?.click(); } });

  // ===== 스타일 =====
  const css = document.createElement('style');
  css.textContent = `
.pl-head{margin:0 0 14px;--pc:var(--lime)}
.pl-head .eyebrow{color:var(--pc)}
.pl-head h1{font-size:28px;margin:2px 0 4px}
.pl-head p{margin:0;color:var(--muted);font-size:15px}
.pl{--pc:var(--lime);border:1px solid var(--line);border-top:4px solid var(--pc);background:var(--panel);border-radius:14px;padding:18px 20px 22px;margin:0 0 20px}
.pl-top{display:flex;gap:12px;align-items:center;flex-wrap:wrap;justify-content:space-between;margin-bottom:14px}
.pl-items{display:flex;gap:10px;align-items:center;flex-wrap:wrap;min-width:0;flex:1}
.pl-items label{display:flex;gap:8px;align-items:center;min-width:0;flex:1 1 260px;max-width:520px}
.pl-items label span{font-size:13px;color:var(--muted);flex:none}
.pl-items select{min-width:0;width:100%;min-height:42px;background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:9px;padding:0 10px;font-size:15px}
.pl-newbtn{min-height:42px;padding:0 14px;border-radius:9px;border:1px dashed var(--pc);background:transparent;color:var(--pc);font-weight:700;font-size:15px;cursor:pointer;white-space:nowrap}
.pl-wip{flex:1 1 100%;min-width:0}.pl-wip-h{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:8px}.pl-wip-h b{font-size:16px}.pl-wip-reset{margin-left:auto;font:inherit;font-size:12px;padding:3px 10px;border-radius:999px;border:1px solid #c0392b;background:transparent;color:#c0392b;cursor:pointer}.pl-wip-reset:hover{background:#c0392b;color:#fff}.pl-wip-reset:focus-visible{outline:2px solid #c0392b;outline-offset:2px}
.pl-wip-row{display:flex;gap:10px;overflow-x:auto;padding-bottom:6px;scroll-snap-type:x proximity}
.pl-wc{position:relative;flex:none;width:200px;scroll-snap-align:start;border:2px solid var(--line);border-radius:12px;background:var(--panel2);overflow:hidden}
.pl-wc.on{border-color:var(--pc);box-shadow:0 0 0 1px var(--pc)}
.pl-wc-main{display:flex;flex-direction:column;gap:4px;width:100%;text-align:left;padding:0 0 8px;border:0;background:transparent;color:var(--text);cursor:pointer;font:inherit}
.pl-wc-main img,.pl-wc-ph{display:block;width:100%;aspect-ratio:16/9;object-fit:cover;background:#1b2027}.pl-wc-ph{display:grid;place-items:center;font-size:26px}
.pl-wc-t{padding:0 10px;font-size:14px;font-weight:700;line-height:1.35;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;min-height:2.7em}
.pl-wc-s{padding:0 10px;font-size:12px;color:var(--muted);line-height:1.4}
.pl-wbs{display:flex;gap:4px;flex-wrap:wrap;margin-top:3px}.pl-wbs .b{font-style:normal;font-size:11px;padding:1px 6px;border-radius:999px;border:1px solid var(--line);color:var(--text)}
.pl-wbs .run{border-color:#3ddc84;color:#3ddc84}.pl-wbs .gate{border-color:#f2c94c;color:#f2c94c}.pl-wbs .fail{border-color:#ff6b6b;color:#ff6b6b}.pl-wbs .vid{border-color:var(--pc,#9ad);color:var(--text);background:#1d2630}
.pl-wc-x{position:absolute;top:4px;right:4px;width:28px;height:28px;border-radius:50%;border:0;background:rgba(0,0,0,.65);color:#fff;font-size:16px;line-height:1;cursor:pointer}
.pl-wc-new{display:grid;place-items:center;min-height:120px;border-style:dashed;border-color:var(--pc);background:transparent;color:var(--pc);font-weight:700;font-size:15px;cursor:pointer;padding:0 10px}
.pl-wpub{margin-top:6px;font-size:13px;color:var(--muted)}.pl-wpub ul{margin:6px 0 0;padding-left:18px}
@media(max-width:760px){.pl-wc{width:160px}}
.pl-newbtn:hover{background:color-mix(in srgb,var(--pc) 12%,transparent)}
.pl-chips{display:flex;gap:8px;flex-wrap:wrap;margin:6px 0 10px}
.pl-chip{min-height:38px;padding:0 14px;border-radius:99px;border:1px solid var(--line);background:transparent;color:var(--text);font-size:14px;cursor:pointer}
.pl-chip.on{border-color:var(--pc);background:color-mix(in srgb,var(--pc) 16%,transparent);font-weight:700}
.pl-instamode{margin:0}
.pl-bar{list-style:none;margin:0 0 16px;padding:0;display:flex;gap:6px;flex-wrap:wrap}
.pl-bar li{flex:1 1 0;min-width:96px}
.pl-bar button{width:100%;min-height:46px;display:flex;align-items:center;gap:8px;padding:6px 10px;border-radius:10px;border:1px solid var(--line);background:var(--panel2);color:var(--muted);font-size:14px;text-align:left;cursor:pointer}
.pl-bar button:disabled{cursor:default;opacity:.7}
.pl-n{flex:none;width:26px;height:26px;border-radius:50%;display:grid;place-items:center;font-weight:800;font-size:13px;border:2px solid var(--line);background:transparent}
.pl-nm{min-width:0;font-size:13px;line-height:1.25;font-weight:600;overflow-wrap:anywhere}
.pl-bar .done button{color:var(--text)}
.pl-bar .done .pl-n{background:var(--green);border-color:var(--green);color:#0b1f15}
.pl-bar .now button{border-color:var(--pc);color:var(--text)}
.pl-bar .now .pl-n{background:var(--pc);border-color:var(--pc);color:#111}
.pl-bar .view button{box-shadow:0 0 0 2px color-mix(in srgb,var(--pc) 55%,transparent)}
.pl-card{border:1px solid var(--line);background:#12151a;border-radius:12px;padding:20px}
.pl-steplabel{font-size:13px;color:var(--pc);font-weight:800;letter-spacing:.02em}
.pl-tag{margin-left:8px;color:var(--orange);font-weight:700}
.pl-card h2{font-size:24px;margin:4px 0 6px}
.pl-desc{margin:0 0 16px;font-size:16px;color:#d5d9df}
.pl-note{font-size:15px;color:#c3c8cf;margin:0 0 12px}
.pl-link-in{display:grid;gap:10px;margin:0 0 14px}
.pl-link-label{font-size:16px;font-weight:700;color:var(--text)}
.pl-biginput{min-height:58px;font-size:18px}
.pl-bigbtn{min-height:58px;font-size:19px;width:100%}
.pl-link-read{display:flex;gap:14px;align-items:flex-start;border:1px solid var(--line);background:var(--panel2);border-radius:12px;padding:12px;margin:0 0 10px}
.pl-link-thumb{width:112px;height:76px;object-fit:cover;border-radius:8px;flex:none;background:#0f1216}
.pl-link-meta{display:grid;gap:3px;min-width:0;overflow-wrap:anywhere}
.pl-warn{display:block;color:#ffd58a;background:#33291a;border:1px solid #5c4a24;border-radius:10px;padding:8px 12px;margin:8px 0;font-size:14px}
.pl-link-opts{display:grid;gap:10px;margin:12px 0}
.pl-link-opt{display:grid;gap:6px;text-align:left;padding:14px 16px;border-radius:12px;border:2px solid var(--line);background:var(--panel2);color:var(--text);font-size:16px;line-height:1.45;cursor:pointer}
.pl-link-opt:hover,.pl-link-opt:focus-visible{border-color:var(--pc);outline:none}
.pl-link-angle{font-size:14px;color:#c3c8cf}
.pl-link-cards{margin:0;padding-left:20px;font-size:13px;color:var(--muted)}
.pl-paste,.pl-list{margin-top:12px}
.pl-paste textarea{margin:8px 0}
@media(max-width:560px){.pl-link-read{flex-direction:column}.pl-link-thumb{width:100%;height:150px}}
.pl-primary{display:flex;width:100%;align-items:center;justify-content:center;min-height:64px;padding:0 24px;margin:6px 0 4px;border-radius:14px;border:2px solid var(--lime);background:var(--lime);color:#14200e;font-size:20px;font-weight:800;cursor:pointer;text-align:center;line-height:1.3}
.pl-primary:hover:not(:disabled){filter:brightness(1.07)}
.pl-primary:disabled{opacity:.4;cursor:not-allowed}
.pl-primary.again{background:transparent;color:var(--text);border-color:var(--line)}
.pl-primary.danger{background:#3a1f22;border-color:#6b3237;color:#ffb4b4}
.pl-primary:focus-visible,.pl-nav-btn:focus-visible,.pl-bar button:focus-visible,.pl-topic:focus-visible{outline:3px solid var(--pc);outline-offset:2px}
.pl-status{margin:4px 2px 0}
.pl-result{margin-top:14px;border:1px solid var(--line);border-left:4px solid var(--green);border-radius:10px;background:var(--panel2);padding:12px 14px;font-size:15px;overflow-wrap:anywhere}
.pl-result-h{font-size:12px;color:var(--muted);font-weight:700;margin-bottom:4px}
.pl-result video{width:100%;max-height:420px;border-radius:8px;background:#000;margin-bottom:8px}
.pl-player{margin:0 0 14px;border:1px solid var(--line);border-left:4px solid var(--pc);border-radius:12px;background:var(--panel2);padding:12px 14px}
.pl-player-h{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap;margin-bottom:10px}.pl-player-h b{font-size:17px}.pl-player-v{font-size:13px;color:var(--muted);flex:1}
.pl-player video{display:block;margin:0 auto;max-width:100%;max-height:70vh;width:auto;height:auto;background:#000;border-radius:8px}
.pl-subs{margin:0 0 4px}.pl-logs{display:flex;gap:12px;flex-wrap:wrap;margin-top:4px}
.pl-files{list-style:none;margin:6px 0 0;padding:0;display:flex;gap:8px;flex-wrap:wrap}
.pl-nav{display:flex;justify-content:space-between;gap:10px;margin-top:16px}
.pl-nav-btn{min-height:46px;padding:0 20px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--text);font-size:16px;font-weight:700;cursor:pointer}
.pl-nav-btn:disabled{opacity:.35;cursor:not-allowed}
.pl-nav-btn.go{border-color:var(--lime);color:var(--lime)}
.pl-nav .pl-nav-btn:last-child{margin-left:auto}
.pl-finish{margin-top:14px;border:2px solid var(--pc);border-radius:12px;padding:14px;background:#171b21;font-size:15px}
.pl-picker{margin-bottom:6px}
.pl-empty{padding:4px 0 10px}.pl-topics{display:grid;gap:8px;margin-bottom:8px}
.pl-topic{display:flex;gap:10px;align-items:center;justify-content:space-between;text-align:left;min-height:52px;padding:10px 14px;border-radius:12px;border:2px solid var(--line);background:var(--panel2);color:var(--text);font-size:16px;line-height:1.4;cursor:pointer}
.pl-looks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-bottom:8px}
.pl-looks .pl-topic{justify-content:flex-start;align-items:flex-start;gap:12px}
.pl-lk-txt{display:flex;flex-direction:column;gap:4px;min-width:0;flex:1}
@media (max-width:640px){.pl-looks{grid-template-columns:1fr}}
.pl-out{margin:10px 0 14px;border:1px solid var(--line);border-radius:12px;background:var(--panel2)}
.pl-out-h{display:flex;align-items:center;gap:10px;width:100%;min-height:44px;padding:8px 14px;background:none;border:0;color:var(--text);font-size:15px;text-align:left;cursor:default}
.pl-out-h b{color:var(--pc)}
.pl-out-mini{color:var(--muted);font-size:13px;display:none;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pl-out-car{display:none;margin-left:auto;font-style:normal;color:var(--muted)}
.pl-out-b{display:flex;gap:16px;align-items:flex-start;padding:0 14px 12px}
.pl-out-pv{flex:none;width:120px;height:213px;border-radius:10px;overflow:hidden;background:#000;border:1px solid rgba(255,255,255,.18);position:relative}
.pl-out-mock{display:block;width:120px;height:213px;overflow:hidden}.pl-out-mock.dim{opacity:.45}
.pl-out-mock .lm{transform:scale(1.4286);transform-origin:0 0;border:0;border-radius:0}
.pl-out-vid{display:block;width:120px;height:213px;object-fit:cover;background:#000}
.pl-out-tx{flex:1;min-width:0;display:grid;gap:8px;align-content:start}
.pl-out-line{margin:0;display:flex;flex-wrap:wrap;gap:4px 14px;font-size:14px;line-height:1.5}
.pl-out-line span{white-space:nowrap}.pl-out-line i{font-style:normal;color:var(--muted);font-size:12px;margin-right:2px}.pl-out-line small{color:var(--muted)}
.pl-out-seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden;justify-self:start}
.pl-out-seg button{min-height:40px;padding:0 14px;background:none;border:0;color:var(--text);font-size:14px;cursor:pointer}
.pl-out-seg button[aria-pressed="true"]{background:var(--pc);color:#000;font-weight:700}
.pl-out-st{margin:0;color:var(--muted)}.pl-out-st.err{color:#ff8a80}
.pl-vid{margin:0 0 10px}.pl-vid video{display:block;width:100%;max-width:300px;max-height:420px;aspect-ratio:9/16;border-radius:8px;background:#000;margin-bottom:4px}
.pl-fin{display:flex;gap:14px;flex-wrap:wrap;align-items:flex-start}
.pl-th{margin:0 0 10px}.pl-th img{display:block;max-width:240px;max-height:240px;width:auto;height:auto;border-radius:8px;border:1px solid var(--line)}
.pl-up{margin:4px 0 0;padding:10px 12px;max-height:220px;overflow:auto;white-space:pre-wrap;background:#0f1216;border:1px solid var(--line);border-radius:8px;font-size:13px;line-height:1.5}
.lm .lm-vw{position:absolute;inset:0;overflow:hidden}
@media (max-width:640px){.pl-out-h{cursor:pointer}.pl-out-mini,.pl-out-car{display:block}.pl-out:not(.open) .pl-out-b{display:none}.pl-out.open .pl-out-car{transform:rotate(180deg)}.pl-out-b{flex-direction:column;align-items:center}.pl-out-tx{width:100%}.pl-out-line span{white-space:normal}}
.lm{position:relative;display:block;flex:none;width:84px;height:150px;border-radius:10px;overflow:hidden;background:#000;border:1px solid rgba(255,255,255,.18);pointer-events:none;font-style:normal;color:#fff;font-family:inherit}
.lm i,.lm u{font-style:normal;display:block}.lm u{display:inline;text-decoration:none;color:#3DE0C0}
.lm .lm-a{position:absolute;text-align:center;white-space:nowrap;line-height:1.2}
.lm .lm-v{position:absolute;inset:0;background:radial-gradient(ellipse 22% 30% at 50% 55%,rgba(150,165,190,.45),transparent 70%),linear-gradient(170deg,#6f7f96,#3b4658 55%,#262d3a)}
.lm .lm-w1{font-size:8px;font-weight:800;color:#fff;text-shadow:0 1px 2px #000}
.lm .lm-sub{font-size:6px;font-weight:800;color:#fff;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000}
.lm .lm-s{font-size:4.5px;color:#fff}.lm .lm-b{font-weight:800;color:#fff}
.lm .lm-y{font-size:8px;font-weight:900;color:#FFD400;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000}
.lm .lm-p{font-size:9px;font-weight:900;color:#FFD400;text-shadow:0 1px 2px #000}
.lm .lm-t1{font-weight:900;text-shadow:0 1px 2px #000}
.lm .lm-stamp{font-size:15px;font-weight:900;color:#FF2B2B;border:2px solid #FF2B2B;border-radius:4px;padding:0 3px;transform:translate(-50%,-50%) rotate(-10deg);background:rgba(0,0,0,.25)}
.pl-fxs{align-items:start}
.pl-fxc{border:2px solid var(--line);background:var(--panel2);border-radius:12px;display:flex;flex-direction:column;min-width:0}
.pl-fxc.on{border-color:var(--pc);background:color-mix(in srgb,var(--pc) 12%,var(--panel2))}
.pl-fxb{display:flex;gap:12px;align-items:flex-start;text-align:left;background:none;border:0;color:var(--text);font-size:16px;line-height:1.4;padding:10px 14px 4px;cursor:pointer;border-radius:12px;min-height:52px}
.pl-fxb:focus-visible{outline:3px solid var(--pc);outline-offset:2px}
.pl-fxl{margin:2px 0 0;padding-left:16px;font-size:13px;color:var(--muted);line-height:1.5}
.pl-fxlink{margin:0 14px 10px 110px;font-size:14px;color:var(--pc);align-self:flex-start;min-height:32px;display:inline-flex;align-items:center}
span.pl-fxlink{color:var(--muted)}
.pl-fxsel{margin:6px 0 10px;display:grid;gap:8px}
.pl-fxvidw{width:100%;max-width:260px;aspect-ratio:9/16;border-radius:12px;overflow:hidden;background:#000;border:1px solid var(--line)}
.pl-fxvid{width:100%;height:100%;border:0;display:block}
.pl-fxown{display:grid;gap:6px;font-size:14px;color:#c3c8cf;max-width:520px}
.fxm .fxm-v{transform-origin:50% 50%}
.fxm .fxm-flash{position:absolute;inset:0;background:#fff;opacity:0}
.fxm .fxm-dip{position:absolute;inset:0;background:#000;opacity:0}
.fxm .fxm-t{font-size:14px;font-weight:900;color:#fff;text-shadow:0 1px 3px #000,0 0 6px rgba(0,0,0,.6)}
.fxm .fxm-pop{color:#FFD400;font-size:17px;transform:rotate(-6deg)}
.fxm .fxm-word{color:#FFD400;display:inline-block}
.fxm .fxm-slow{padding:1px 3px;border-radius:3px;background:#FFE100;color:#000;font-size:5px;font-weight:900}
.fxm-calm .fxm-kb{animation:fxm-kb 2.4s linear infinite}
.fxm-calm .fxm-dip{animation:fxm-dip 2.4s linear infinite}
.fxm-calm .fxm-ding{animation:fxm-ding 2.4s linear infinite}
.fxm-punch .fxm-pz{animation:fxm-pz 2.4s linear infinite}
.fxm-punch .fxm-fl-p{animation:fxm-flp 2.4s linear infinite}
.fxm-punch .fxm-pop{animation:fxm-pop 2.4s linear infinite}
.fxm-punch .fxm-word{animation:fxm-word 2.4s linear infinite}
.fxm-match .fxm-mz{animation:fxm-mz 2.4s linear infinite}
.fxm-match .fxm-fl-m{animation:fxm-flm 2.4s linear infinite}
.fxm-match .fxm-slow{animation:fxm-slow 2.4s linear infinite}
.fxm-match .fxm-swish{animation:fxm-swish 2.4s linear infinite}
@keyframes fxm-kb{0%{transform:scale(1)}90%,100%{transform:scale(1.07)}}
@keyframes fxm-dip{0%{opacity:.55}7%{opacity:0}93%{opacity:0}100%{opacity:.55}}
@keyframes fxm-ding{0%,12%{opacity:0;transform:scale(.6)}18%{opacity:1;transform:scale(1.15)}30%{opacity:1;transform:scale(1)}55%,100%{opacity:0}}
@keyframes fxm-pz{0%{transform:scale(1)}7%{transform:scale(1.13)}14%,48%{transform:scale(1)}50%{transform:scale(1.04) translate(-3px,2px)}53%{transform:scale(1.04) translate(3px,-2px)}56%{transform:scale(1.04) translate(-2px,-1px)}59%{transform:scale(1.04) translate(2px,1px)}62%,100%{transform:scale(1)}}
@keyframes fxm-flp{0%,49%{opacity:0}50%{opacity:.85}53%,100%{opacity:0}}
@keyframes fxm-pop{0%,49%{opacity:0;transform:rotate(-6deg) scale(.4)}52%{opacity:1;transform:rotate(-6deg) scale(1.4)}58%,80%{opacity:1;transform:rotate(-6deg) scale(1)}90%,100%{opacity:0;transform:rotate(-6deg) scale(1)}}
@keyframes fxm-word{0%,49%{transform:scale(1)}53%{transform:scale(1.5)}60%,100%{transform:scale(1)}}
@keyframes fxm-mz{0%{transform:scale(1)}5%,60%{transform:scale(1.1)}64%{transform:scale(1.14) translate(-3px,2px)}67%{transform:scale(1.14) translate(3px,-2px)}70%{transform:scale(1.14) translate(-2px,-1px)}73%{transform:scale(1.14) translate(2px,1px)}76%,92%{transform:scale(1.1)}100%{transform:scale(1)}}
@keyframes fxm-flm{0%{opacity:.85}5%,100%{opacity:0}}
@keyframes fxm-slow{0%{opacity:0}4%,92%{opacity:1}100%{opacity:0}}
@keyframes fxm-swish{0%{opacity:0;transform:translateX(-14px)}6%,28%{opacity:1;transform:translateX(0)}40%,100%{opacity:0}}
.lm .lm-wd{font-size:7px;font-weight:900;font-style:italic;color:#fff;text-shadow:-1px -1px 0 #000,1px -1px 0 #000,-1px 1px 0 #000,1px 1px 0 #000}
.fxm .fxm-rep{padding:1px 3px;border-radius:2px;background:#E02020;color:#fff;font-size:4.5px;font-weight:900;opacity:0;animation:fxm-rep 2.4s linear infinite}
.fxm .fxm-box{padding:2px 0;background:#000;color:#fff;font-size:5px;font-weight:800;opacity:0}
.fxm .fxm-st0{animation:fxm-st0 2.4s linear infinite}.fxm .fxm-st1{animation:fxm-st1 2.4s linear infinite}.fxm .fxm-st2{animation:fxm-st2 2.4s linear infinite}
.fxm .fxm-ghost{position:absolute;top:34%;left:30%;width:34%;height:34%;border-radius:40%;background:rgba(255,255,255,.55);filter:blur(4px);opacity:0;animation:fxm-ghost 2.4s linear infinite}
.fxm .fxm-w1,.fxm .fxm-w2{opacity:0}.fxm .fxm-w1{animation:fxm-w1 2.4s linear infinite}.fxm .fxm-w2{animation:fxm-w2 2.4s linear infinite}
.fxm .fxm-wz{animation:fxm-wz 2.4s linear infinite}
.fxm .fxm-x{font-size:20px;font-weight:900;color:#FF2B2B;text-shadow:0 0 2px #000,0 1px 3px #000;transform:translate(-50%,0) scale(0);animation:fxm-x 2.4s linear infinite}
.fxm .fxm-pill{padding:3px 0;border-radius:99px;background:#1E88FF;color:#fff;font-size:5.5px;font-weight:800;opacity:0;animation:fxm-pill 2.4s linear infinite}
@keyframes fxm-rep{0%,68%{opacity:0}72%,80%{opacity:1}84%,92%{opacity:.2}96%,100%{opacity:1}}
@keyframes fxm-st0{0%,2%{opacity:0}4%,24%{opacity:1}28%,100%{opacity:0}}
@keyframes fxm-st1{0%,28%{opacity:0}32%,58%{opacity:1}62%,100%{opacity:0}}
@keyframes fxm-st2{0%,62%{opacity:0}66%,98%{opacity:1}100%{opacity:0}}
@keyframes fxm-ghost{0%,70%{opacity:0;transform:translateX(0)}76%{opacity:.8;transform:translateX(-6px)}90%{opacity:.5;transform:translateX(8px)}100%{opacity:0}}
@keyframes fxm-w1{0%,6%{opacity:0}9%,30%{opacity:1}33%,100%{opacity:0}}
@keyframes fxm-w2{0%,33%{opacity:0}36%,58%{opacity:1}61%,100%{opacity:0}}
@keyframes fxm-wz{0%{transform:scale(1)}4%{transform:scale(1.13)}10%,33%{transform:scale(1)}35%{transform:scale(1.13)}41%,100%{transform:scale(1)}}
@keyframes fxm-x{0%,64%{transform:translate(-50%,0) scale(0)}70%{transform:translate(-50%,0) scale(1.3)}76%,90%{transform:translate(-50%,0) scale(1)}96%,100%{transform:translate(-50%,0) scale(0)}}
@keyframes fxm-pill{0%,20%{opacity:0;transform:scale(.5)}26%{opacity:1;transform:scale(1.12)}32%,62%{opacity:1;transform:scale(1)}70%,100%{opacity:0;transform:scale(1)}}
.pl-pair{color:var(--pc)}.pl-lesson{margin:0 0 8px;color:var(--muted)}.pl-views{color:var(--muted);margin:0 0 0 0}
@media (prefers-reduced-motion:reduce){.fxm *{animation:none!important}}
.pl-topic.on{border-color:var(--pc);background:color-mix(in srgb,var(--pc) 12%,var(--panel2))}
.pl-prog{display:flex;align-items:center;gap:12px;margin:0 0 10px;font-size:13px;color:var(--muted)}.pl-prog b{color:var(--text)}
.pl-prog>i{flex:1;height:6px;border-radius:99px;background:var(--line);overflow:hidden}.pl-prog>i>i{display:block;height:100%;background:var(--pc);border-radius:99px;transition:width .4s}
.pl-yt .pl-bar{flex-wrap:nowrap;gap:0;overflow-x:auto;padding:4px 0 2px;margin-bottom:14px}
.pl-yt .pl-bar li{flex:1 1 0;min-width:72px;position:relative}
.pl-yt .pl-bar li+li::before{content:"";position:absolute;top:19px;left:calc(-50% + 16px);right:calc(50% + 16px);height:2px;background:var(--line)}
.pl-yt .pl-bar li.done+li::before{background:var(--green)}
.pl-yt .pl-bar button{flex-direction:column;justify-content:flex-start;gap:6px;min-height:0;padding:4px 2px;border:0;background:transparent;text-align:center;font-size:12px;border-radius:8px}
.pl-yt .pl-bar .pl-n{width:30px;height:30px;font-size:13px;background:var(--panel2);position:relative;z-index:1}
.pl-yt .pl-bar .done .pl-n{background:var(--green);border-color:var(--green);color:#0b1f15}.pl-yt .pl-bar .now .pl-n{background:var(--pc);border-color:var(--pc);color:#111}
.pl-yt .pl-nm{max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.3}
.pl-yt .pl-bar .view button{box-shadow:none;color:var(--text);font-weight:800}.pl-yt .pl-bar .view .pl-n{box-shadow:0 0 0 4px color-mix(in srgb,var(--pc) 35%,transparent)}
.pl-yt .pl-bar .now button{border:0}
.pl-run{margin:0 0 16px;padding:14px 16px;border-radius:12px;border:1px solid color-mix(in srgb,var(--pc) 55%,var(--line));background:color-mix(in srgb,var(--pc) 9%,var(--panel2));font-size:14px;line-height:1.5}
.pl-run b:first-child{font-size:26px;font-weight:900;color:var(--text);margin-right:4px;vertical-align:-2px}
.pl-run>div{height:10px!important;margin-top:10px!important}
.pl-yt .pl-primary{min-height:56px;font-size:18px}
.pl-yt .pl-looks .pl-topic{position:relative}.pl-yt .pl-looks .pl-topic.on::after{content:"✓";position:absolute;top:8px;right:10px;width:22px;height:22px;border-radius:50%;background:var(--pc);color:#111;font-size:13px;font-weight:900;display:grid;place-items:center}
.pl-yt .pl-looks .pl-lk-txt .small{display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.pl-yt .pl-looks .pl-lk-txt b{padding-right:26px}
.pl-topic em{font-style:normal;font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 6px;flex:none}
.pl-help{margin:10px 0;font-size:14px}.pl-help summary{cursor:pointer;color:var(--pc);min-height:36px;display:flex;align-items:center}.pl-help ol{margin:6px 0 0;padding-left:20px;line-height:1.7}.pl-help code{background:var(--panel2);padding:1px 5px;border-radius:4px}
.pl-link{background:none;border:0;color:var(--pc);text-decoration:underline;cursor:pointer;font-size:14px;padding:6px 0;min-height:36px}
.pl-own{display:grid;gap:6px;margin:10px 0 6px;font-size:14px;color:#c3c8cf}
.pl-input{width:100%;min-height:48px;padding:0 14px;font-size:16px;border-radius:10px;border:2px solid var(--line);background:#0f1216;color:var(--text)}
.pl-input:focus,.pl-answer:focus{outline:none;border-color:var(--pc)}
.pl-answer{width:100%;min-height:180px;padding:12px 14px;font-size:15px;line-height:1.6;border-radius:12px;border:2px solid var(--line);background:#0f1216;color:var(--text);resize:vertical;font-family:inherit}
.pl-error{color:#ffb4b4;background:#3a1f22;border:1px solid #6b3237;border-radius:10px;padding:10px 14px;margin:10px 0;font-size:15px}
.pl-scr{margin:10px 0;display:grid;gap:8px}.pl-scr-l{display:grid;gap:6px;font-weight:600}.pl-scr textarea{width:100%;box-sizing:border-box;font:inherit;line-height:1.5}
.pl-error code{background:#241416;border-radius:4px;padding:1px 5px;overflow-wrap:anywhere}
.pl-checks{display:grid;gap:8px;margin:0 0 10px}
.pl-check{display:flex;gap:12px;align-items:center;min-height:52px;padding:8px 14px;border-radius:12px;border:2px solid var(--line);background:var(--panel2);font-size:15px;cursor:pointer}
.pl-check input{width:24px;height:24px;flex:none;accent-color:var(--pc)}
.pl-check:has(input:checked){border-color:var(--pc)}
.pl-url{display:grid;gap:8px;margin:6px 0 10px}
.pl-url>label:first-child{font-weight:700;font-size:15px}
.pl-peek summary{cursor:pointer;color:#c3c8cf;min-height:38px;display:flex;align-items:center;font-size:14px}
.pl-peek pre{white-space:pre-wrap;font-family:inherit;font-size:14px;line-height:1.6;background:#0f1216;border:1px solid var(--line);border-radius:10px;padding:12px;max-height:260px;overflow:auto;margin:6px 0 0}
.pl-log{white-space:pre-wrap;font-size:12px;background:#0f1216;border:1px solid var(--line);border-radius:8px;padding:10px;max-height:220px;overflow:auto;margin:6px 0 0}
.pl-yl{display:grid;gap:8px;margin:12px 0}
.pl-yl label{display:grid;gap:4px;font-size:13px;color:#c3c8cf}
.pl-yl-url{font-size:16px;padding:12px}
.pl-yl-orig:empty{display:none}
.pl-ya-form{display:grid;gap:10px;grid-template-columns:1fr 1fr;margin:10px 0}
.pl-ya-form label{display:grid;gap:4px;font-size:13px;color:#c3c8cf}
.pl-ytabs{margin:0 0 8px}
.pl-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:10px}
.pl-gallery figure{margin:0}.pl-gallery canvas{width:100%;height:auto;border-radius:8px;border:1px solid var(--line);background:#fff}.pl-gallery figcaption{font-size:12px;color:var(--muted);text-align:center}
.pl-it{margin-bottom:12px}
.pl-it .it-actions{margin-top:8px}
.pl-ref{margin:0 0 20px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}
.pl-ref>summary{cursor:pointer;padding:14px 18px;font-weight:700;color:var(--muted);min-height:48px;display:flex;align-items:center}
.pl-ref[open]>summary{border-bottom:1px solid var(--line);color:var(--text)}
.pl-ref>:not(summary){padding:0 14px}
.pl-home{display:grid;gap:12px;margin:0 0 20px}
.pl-home-row{display:grid;grid-template-columns:1fr minmax(180px,260px);grid-template-areas:'main btn' 'bar btn';gap:6px 18px;align-items:center;border:1px solid var(--line);border-left:5px solid var(--pc);background:var(--panel);border-radius:12px;padding:14px 16px}
.pl-home-main{grid-area:main;display:flex;flex-direction:column;gap:2px;min-width:0}
.pl-home-pf{font-size:13px;font-weight:800;color:var(--pc)}
.pl-home-title{font-size:17px;font-weight:700;overflow-wrap:anywhere}
.pl-home-step{font-size:14px;color:var(--text)}.pl-home-step b{color:var(--pc);margin-right:6px}.pl-home-step.none{color:var(--muted)}
.pl-home-bar{grid-area:bar;height:6px;border-radius:99px;background:var(--panel2);overflow:hidden}
.pl-home-bar i{display:block;height:100%;background:var(--pc)}
.pl-home-row .pl-primary{grid-area:btn;min-height:52px;font-size:17px;margin:0}
@media (max-width:760px){
.pl{padding:14px 12px 18px}.pl-card{padding:14px}.pl-card h2{font-size:21px}
.pl-bar li{flex:0 0 auto;min-width:0}.pl-bar button{padding:6px}.pl-nm{display:none}.pl-bar .view .pl-nm{display:inline;max-width:40vw}
.pl-primary{font-size:18px;min-height:60px}
.pl-ya-form{grid-template-columns:1fr}
.pl-home-row{grid-template-columns:1fr;grid-template-areas:'main' 'bar' 'btn'}
.pl-items label{flex-basis:100%}
}`;
  document.head.append(css);
})();
