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
  S.sel = S.sel || {}; S.opened = S.opened || {}; S.igSel = S.igSel || {};
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
  const T = { view: {}, manual: {}, busy: {}, err: {}, askCopied: {}, answer: {}, pick: {}, custom: {}, page: {}, url: {}, seen: {}, link: {}, caption: {}, logOpen: null, ytFmt: null };

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
  const YT_DESC = {
    script: '대본을 만들어요. 다 되면 한 번 읽어 보고 계속 진행하세요.',
    mix: '대본 줄마다 내 목소리를 녹음하고, 배경음악을 골라 합쳐요.',
    finish: '자막과 효과를 얹은 완성본을 만들어요.',
    upload: '제목·설명란·태그·썸네일 문구를 한 파일로 만들어요.',
  };
  const YT_PLACEHOLDER = ['주제 정하기', '소스 전달', '대본', '편집', '녹음·음악', '업로드 패키지'];
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
      id: 'topic', name: '주제 정하기', title: '주제 정하기', desc: '이번에 만들 주제를 하나 고르세요.',
      btn: '이 주제로 정하기',
      hideBtn: it => !!it.idea,
      isDone: it => !!it.idea,
      result: it => it.idea ? `<b>${esc(it.idea.title)}</b>${it.ep ? '' : ' <button type="button" class="pl-link" data-pl-ytchange>주제 바꾸기</button>'}` : '',
      body: it => {
        if (it.idea) return '';
        const tabs = ytLock ? '' : `<div class="filters yt-tabs pl-ytabs" role="tablist" aria-label="유튜브 채널">${YT_CHANNELS.filter(y => !YT_LOCKS[y.id]).map(y => `<button class="filter ${ytTab() === y.id ? 'active' : ''}" role="tab" aria-selected="${ytTab() === y.id}" data-yt-tab="${y.id}" title="${esc(ytChName(y.id))}">${esc(y.tab)}</button>`).join('')}</div>`;
        const fmt = f => `<button type="button" class="pl-chip ${ytPipe.format === f ? 'on' : ''}" data-yp-format="${f}" aria-pressed="${ytPipe.format === f}">${f === 'long' ? '🎬 롱폼' : '📱 쇼츠'}</button>`;
        const list = ytIdeas(), pg = (T.page.youtube || 0) % Math.max(1, Math.ceil(list.length / PAGE)), shown = list.slice(pg * PAGE, pg * PAGE + PAGE);
        const picker = `<div class="pl-topics" role="radiogroup" aria-label="주제">${shown.map(t => `<button type="button" role="radio" aria-checked="false" class="pl-topic" data-pl-ytpick="${esc(t.id)}"><span>${esc(t.title)}</span></button>`).join('') || `<div class="pl-empty"><p class="small"><b>이 채널 주제가 아직 없어요.</b> 아래에서 주제를 찾거나 직접 적어 주세요.</p><div class="pl-chips"><button type="button" class="pl-chip" data-view="${ytRoute('youtubePlan', ytLock)}">AI 주제 발굴</button><button type="button" class="pl-chip" data-action="newIdea">직접 적기</button></div></div>`}</div>${list.length > PAGE ? `<button type="button" class="pl-link" data-pl-more>다른 주제 보기 (${pg + 1}/${Math.ceil(list.length / PAGE)})</button>` : ''}`;
        return tabs + `<div class="pl-chips">${fmt('shorts')}${fmt('long')}</div>` + picker;
      },
      run: it => { const id = T.ytPick || (ytIdeas()[0] || {}).id; if (!it.idea && id) { selectYt(id); T.view.youtube = null; } else if (!it.idea) toast('주제를 하나 골라 주세요.'); },
    };
    const src = {
      id: 'src', name: '소스 전달', title: '소스 전달', desc: it => it.idea ? '소스 영상 주소와 쓸 구간을 넣으세요. 한 구간은 15초까지예요.' : '앞 단계를 끝내면 열려요.',
      btn: '이 소스로 제작 시작',
      attrs: () => 'data-ya-act="create"',
      disabled: it => !it.idea || off || runnerOnline === null,
      hideBtn: it => !!it.ep,
      isDone: it => !!it.ep,
      result: it => it.ep ? `<b>${esc(it.ep.ep)}</b> 폴더 만듦 · 소스 ${it.ep.sources.length}개${it.ep.sources[0] ? ' · ' + esc(it.ep.sources[0].url) : ''}` : '',
      body: it => {
        if (!it.idea || it.ep) return '';
        let chips = '';
        try {
          const vids = (typeof ytPromptSources === 'function' ? ytPromptSources(it.idea.topicId) : []).filter(x => x.video && x.video.url).slice(0, 4);
          if (vids.length) chips = `<div class="pl-chips" role="group" aria-label="추천 소스 영상">${vids.map(x => `<button type="button" class="pl-chip" data-pl-ysrc="${esc(x.video.url)}" title="${esc(x.video.title || '')}">${esc(x.name)}</button>`).join('')}</div>`;
        } catch (e) { chips = ''; }
        const inputs = `<div class="pl-ya-form"><label>소스 영상 주소<input class="pl-input" data-ya-new="url" placeholder="https://www.youtube.com/watch?v=…" value="${esc(ytPipe.url || ytFirstUrl(it.idea))}"></label>${chips}<label>구간 (쉼표로 여러 개)<input class="pl-input" data-ya-new="ranges" placeholder="0:30-0:42, 1:05-1:12" value="${esc(ytPipe.ranges || '')}"></label></div>`;
        return (off ? offMsg : '') + inputs;
      },
      run: () => {},
    };
    let mid;
    if (!ep) mid = YT_PLACEHOLDER.slice(2).map((n, k) => ({ id: 'ph' + k, name: n, title: n, desc: '앞 단계를 끝내면 열려요.', btn: '실행', disabled: () => true, isDone: () => false, result: () => '', run: () => {} }));
    else mid = ep.steps.map(s => {
      const reviewing = ep.gate && s.gate, running = ep.running === s.id, done = s.status === 'done' && !reviewing;
      const files = s.outputs.filter(o => o.exists), vid = files.find(o => /\.(mp4|mov|webm)$/i.test(o.path));
      return {
        id: s.id, name: s.name, title: s.name,
        desc: reviewing ? '대본이 만들어졌어요. 열어서 읽어 보고, 괜찮으면 계속 진행하세요.' : YT_DESC[s.id] || '버튼을 누르면 이 단계가 이 맥에서 실행돼요. 끝나면 결과 파일이 아래에 나와요.',
        btn: it => reviewing ? '대본 확인 완료 · 계속' : running ? '실행 멈춤' : s.id === 'mix' ? '녹음·음악 열기' : done ? '다시 실행' : s.status === 'failed' ? `${s.name} 다시 실행` : `${s.name} 실행`,
        attrs: it => reviewing ? 'data-ya-act="continue"' : running ? 'data-ya-act="stop"' : s.id === 'mix' ? 'data-ya-recopen' : `data-ya-run="${esc(s.id)}"`,
        cls: running ? 'danger' : '',
        disabled: it => !!ep.running && !running && !reviewing,
        isDone: it => done,
        statusLine: () => running ? '실행 중… 끝나면 자동으로 바뀌어요.' : s.status === 'failed' ? '실패했어요. 로그를 보고 다시 실행하세요.' : '',
        result: it => {
          const parts = [];
          if (s.error && s.status === 'failed') parts.push(`<p class="pl-error">${esc(s.error)}</p>`);
          if (vid) parts.push(`<video controls preload="metadata" playsinline src="${RUNNER}/file?ep=${encodeURIComponent(ep.ep)}&path=${encodeURIComponent(vid.path)}"></video>`);
          parts.push(files.length ? `<ul class="pl-files">${files.map(o => `<li>${ytFileLink(ep.ep, o)}</li>`).join('')}</ul>` : (running ? '' : '<span class="small">아직 결과 파일이 없어요.</span>'));
          parts.push(`<button type="button" class="pl-link" data-pl-log="${esc(s.id)}">${T.logOpen === s.id ? '로그 닫기' : '로그 보기'}</button>${T.logOpen === s.id ? '<pre class="pl-log" id="plLog">불러오는 중…</pre>' : ''}`);
          return parts.join('');
        },
        body: it => s.id === 'mix' && recState.open ? `<div id="yaRec">${recPanel()}</div>` : '',
        run: () => {},
      };
    });
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
    return [topic, src, ...mid, last];
  }
  function selectYt(id) { const idea = db.ideas.find(i => i.id === id); if (!idea) return; ytPick(id); S.sel.youtube = { ideaId: id }; T.ytPick = id; save(); }

  // ===== Instagram: 싱부부 인스타툰 단계 =====

  // ===== 인스타 그림 (ChatGPT Codex) — 세 계정 공통 단계 =====
  const CXI = () => window.CodexImg;
  function postOpts(c, it) {
    const p = it.post; if (!p || p.status !== 'approved') return null;
    const a = igOf(p), lang = IG_BY_ID[a].lang, pc = CXI().postCards(a, lang, p.title, igName(a), p.body);
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
    if (v == null || v > maxV || v < 0) v = maxV;
    const s = steps[v], N = steps.length;
    const pc = platformColor(PF_NAME[c]);
    const list = A.list(it), cur = it.key;
    const bar = `<ol class="pl-bar" aria-label="작업 단계">${steps.map((st, k) => {
      const st8 = done[k] ? 'done' : k === now ? 'now' : 'todo', can = k <= now;
      return `<li class="${st8} ${k === v ? 'view' : ''}"><button type="button" ${can ? `data-pl-go="${k}"` : 'disabled'} ${k === v ? 'aria-current="step"' : ''}><span class="pl-n" aria-hidden="true">${done[k] ? '✓' : k + 1}</span><span class="pl-nm">${esc(st.name)}</span></button></li>`;
    }).join('')}</ol>`;
    const items = `<div class="pl-items"><label><span>작업 중</span><select data-pl-item aria-label="작업 중인 글">${list.length ? '' : '<option value="">작업 없음</option>'}${list.map(o => `<option value="${esc(o.key)}" ${o.key === cur ? 'selected' : ''}>${esc(o.label.length > 36 ? o.label.slice(0, 36) + '…' : o.label)}</option>`).join('')}</select></label><button type="button" class="pl-newbtn" data-pl-new>＋ 새 작업</button></div>`;
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
    return `<section class="pl ${c === 'youtube' ? 'pl-yt' : ''}" id="plRoot" data-c="${c}" data-v="${v}" style="--pc:${pc}">${c === 'youtube' ? '<i id="ytAuto" hidden></i>' : ''}
      <div class="pl-top">${items}${insta}</div>${bar}
      <article class="pl-card" aria-live="polite"><div class="pl-steplabel">${v + 1} / ${N} 단계 ${lastLabel}</div>
        <h2>${esc(val(s.title, it))}</h2><p class="pl-desc">${esc(val(s.desc, it))}</p>
        ${val(s.body || '', it) || ''}${err}
        ${btn}${statusLine ? `<p class="small pl-status">${esc(statusLine)}</p>` : ''}
        <div class="pl-result" aria-label="이 단계의 결과"><div class="pl-result-h">결과</div>${res || '<span class="small">아직 없어요. 위 버튼을 누르면 여기에 나와요.</span>'}</div>
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
    root.replaceWith(next);
    afterPaint(root.dataset.c);
  }
  function afterPaint(c) {
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
    if (t.hasAttribute('data-pl-go')) { go(c, +t.dataset.plGo); return; }
    if (t.hasAttribute('data-pl-prev')) { go(c, Math.max(0, v - 1)); return; }
    if (t.hasAttribute('data-pl-next')) { go(c, v + 1); return; }
    if (t.hasAttribute('data-pl-new')) { adapter(c).fresh(); T.link[c] = null; T.view[c] = 0; T.err[c] = ''; T.manual[c] = false; T.askCopied[c] = false; repaint(c, true); return; }
    if (t.dataset.plPick) { T.pick[c] = t.dataset.plPick; T.custom[c] = ''; repaint(c, true); return; }
    if (t.hasAttribute('data-pl-more')) { T.page[c] = (T.page[c] || 0) + 1; repaint(c, true); return; }
    if (t.dataset.plYtpick) { selectYt(t.dataset.plYtpick); T.view.youtube = null; repaint('youtube', true); return; }
    if (t.hasAttribute('data-pl-ytchange')) { adapter('youtube').fresh(); T.view.youtube = 0; repaint('youtube', true); return; }
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
    const b = e.target.closest('#plRoot [data-ya-run], #plRoot [data-ya-act], #plRoot [data-ya-recopen]'); if (!b) return;
    const root = b.closest('#plRoot'); T.view.youtube = +root.dataset.v;
    setTimeout(() => repaint('youtube', true), 700);
  }, true);
  document.addEventListener('change', e => {
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
    else if (t.dataset.yaNew) { if (t.dataset.yaNew === 'url') ytPipe.url = t.value; else ytPipe.ranges = t.value; }
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
.pl-topic.on{border-color:var(--pc);background:color-mix(in srgb,var(--pc) 12%,var(--panel2))}
.pl-topic em{font-style:normal;font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:6px;padding:1px 6px;flex:none}
.pl-help{margin:10px 0;font-size:14px}.pl-help summary{cursor:pointer;color:var(--pc);min-height:36px;display:flex;align-items:center}.pl-help ol{margin:6px 0 0;padding-left:20px;line-height:1.7}.pl-help code{background:var(--panel2);padding:1px 5px;border-radius:4px}
.pl-link{background:none;border:0;color:var(--pc);text-decoration:underline;cursor:pointer;font-size:14px;padding:6px 0;min-height:36px}
.pl-own{display:grid;gap:6px;margin:10px 0 6px;font-size:14px;color:#c3c8cf}
.pl-input{width:100%;min-height:48px;padding:0 14px;font-size:16px;border-radius:10px;border:2px solid var(--line);background:#0f1216;color:var(--text)}
.pl-input:focus,.pl-answer:focus{outline:none;border-color:var(--pc)}
.pl-answer{width:100%;min-height:180px;padding:12px 14px;font-size:15px;line-height:1.6;border-radius:12px;border:2px solid var(--line);background:#0f1216;color:var(--text);resize:vertical;font-family:inherit}
.pl-error{color:#ffb4b4;background:#3a1f22;border:1px solid #6b3237;border-radius:10px;padding:10px 14px;margin:10px 0;font-size:15px}
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
