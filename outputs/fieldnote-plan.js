// ===== 인스타 기획: 중심단어 → 기획안 고르기 → 승인 → 1차 가안 =====
// 그림툰(toon)과 영상·릴스(reel)를 따로 기획한다. 레퍼런스 형식:
//   그림툰  https://www.instagram.com/p/Dd5BZc9kYf4/  (시리즈 제목 + 큰 회차 제목, 위·아래 내레이션 상자 + 말풍선, 스와이프)
//   영상    https://www.instagram.com/p/Dd3dxczTbR-/  (실사풍 AI 수달 한 상황, 위 고정 POV 자막 "…하는 나" + 영어 한 줄)
// AI 는 맥 실행기(POST /plan, 맥의 Claude Code)로 돌린다. 실행기가 꺼져 있으면 같은 부탁 글을 Claude 채팅에 붙여 넣고 답을 받아 온다.
// 단계 틀(fieldnote-pipeline.js)은 FNPlan.body(kind) 로 기획 화면을 그리고, 승인이 끝나면 FNPlan.onDone(kind) 을 부른다.
(() => {
  const RUN = 'http://127.0.0.1:4777', NEED = 49, CLAUDE_URL = 'https://claude.ai/new', KEY = 'fieldnote-plan-v1', ACC = 'insta-sing';
  const REF = { toon: 'https://www.instagram.com/p/Dd5BZc9kYf4/', reel: 'https://www.instagram.com/p/Dd3dxczTbR-/' };
  const LABEL = { toon: '그림툰', reel: '영상(릴스)' };
  let M = {};
  try { M = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (_) { M = {}; }
  const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(M, (k, v) => k === 'busy' ? undefined : v)); } catch (_) {} };
  const st = k => M[k] || (M[k] = { word: '', note: '', plans: null, pick: 0, err: '', manual: null });
  const changed = () => window.dispatchEvent(new Event('fp-change'));
  const S = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

  // ----- 부탁 글 -----
  const CHAR = '수달 부부 — 남편: 노란 안전모를 쓴 S$ 광부 수달, 아내: 분홍 리본 수달. 싱가포르에서 맞벌이하는 한국인 부부(외노자).';
  function base() {
    const theme = typeof PLATFORM_THEMES === 'object' && PLATFORM_THEMES.Instagram || '';
    return [`계정: 「싱부부의 외노자 일기」 (${igName(ACC)})`, `계정 소개·말투: ${igVoice(ACC)}`, `캐릭터: ${CHAR}`, theme ? `계정 주제: ${theme}` : ''].filter(Boolean).join('\n');
  }
  const RULES = ['실제 있었던 일처럼 가게 이름·가격·숫자·실명을 지어내지 않는다. 꼭 필요하면 [확인 필요] 로 남긴다.',
    '특정 나라·인종·직업 집단을 깎아내리지 않는다. 웃음은 우리 부부 쪽에서 나온다.',
    '파일을 읽거나 검색하지 말고 바로 답한다.'];
  const rules = () => '규칙:\n' + RULES.map(r => '- ' + r).join('\n');
  const memo = s => s.note.trim() ? `내 메모 (꼭 반영): ${s.note.trim()}` : '';
  const TOON_FMT = '레퍼런스 형식 (그림툰): 1장 위에 작은 시리즈 제목(예: "직장에서 만나는 얄미운 동료 유형 ①") + 아주 큰 회차 제목(예: "은근슬쩍 공로 가로채기"). 카드마다 위 내레이션 상자 한 줄 → 그림 + 말풍선 1~3개 → 아래 내레이션 상자 한 줄. 단순한 선화, 글이 한눈에 읽히게. 마지막 장은 공감 한 방이나 독자에게 던지는 질문.';
  const REEL_FMT = '레퍼런스 형식 (영상): 실사풍 AI 수달이 사람들 사이 실제 같은 일상 장면에 있는 한 상황짜리 7~15초 세로 영상. 화면 위 고정 자막 한 줄이 전부를 말한다 — "컴퓨터 고쳐주는 전산팀 구경하는 나" 처럼 "…하는 나" / "…할 때 나" 꼴의 POV 문장, 그 아래 작은 영어 번역. 화면 속 작은 한마디 자막 1~2개. 큰 사건 없이 표정·동작 하나로 웃긴다. 댓글에 "나만 그런 줄", 친구 태그가 달리는 공감.';

  function planPrompt(kind, s) {
    if (kind === 'toon') return [`너는 인스타툰 기획자다.`, base(), '만들 것: 그림툰 (스와이프 카드 6~10장).', TOON_FMT, `중심단어: "${s.word.trim()}"`, memo(s),
      '이번 할 일: 이 중심단어로 서로 각도가 다른 그림툰 기획안 4개. 각도 예: 유형 분류(시리즈물) / 그날 있었던 일 / 한국 vs 싱가포르 비교 / 부부 사이 반전 / 정보+공감.',
      '각 기획안:\n- series: 시리즈 이름 (번호 포함, 20자 이내. 시리즈물이 아니면 빈 문자열)\n- title: 회차 큰 제목 (14자 이내, 한 번에 읽히게)\n- logline: 한 문장 줄거리\n- beats: 카드 흐름 6~9개, 카드마다 한 줄 (무슨 장면에서 누가 무슨 말. "카드 1" 같은 번호 머리말 없이)\n- punch: 마지막 장 한 방 (한 줄)\n- why: 왜 저장·공유·댓글이 나올지 한 줄',
      rules(), 'JSON 하나만 답해라: {"plans":[{"series":"","title":"","logline":"","beats":[""],"punch":"","why":""}]}'].filter(Boolean).join('\n\n');
    return [`너는 인스타그램 릴스 기획자다.`, base(), '만들 것: 영상(릴스) 7~15초, AI 영상.', REEL_FMT, `중심단어: "${s.word.trim()}"`, memo(s),
      '이번 할 일: 이 중심단어로 서로 다른 상황의 영상 기획안 4개. 회사·집·MRT·호커센터·마트처럼 장소와 순간이 서로 겹치지 않게.',
      '각 기획안:\n- hook: 화면 위 고정 자막 (공백 빼고 20자 이내, "…하는 나" / "…할 때 나" 꼴)\n- hookEn: hook 의 자연스러운 영어 한 줄\n- situation: 어떤 장면인지 1~2문장 (장소, 누가, 수달이 무엇을 하는지)\n- shots: 컷 흐름 1~3개, 한 줄씩 ("컷 1" 같은 번호 머리말 없이)\n- line: 화면 속 작은 한마디 자막 (없으면 빈 문자열)\n- why: 왜 공감·태그가 나올지 한 줄',
      rules(), 'JSON 하나만 답해라: {"plans":[{"hook":"","hookEn":"","situation":"","shots":[""],"line":"","why":""}]}'].filter(Boolean).join('\n\n');
  }
  function draftPrompt(kind, s, plan) {
    const head = [kind === 'toon' ? '너는 인스타툰 편집자다.' : '너는 인스타그램 릴스 연출가다.', base(), kind === 'toon' ? TOON_FMT : REEL_FMT, `중심단어: "${s.word.trim()}"`, memo(s), '승인된 기획안:\n' + JSON.stringify(plan, null, 1)];
    if (kind === 'toon') return [...head,
      '이번 할 일: 이 기획안 그대로 그림툰 1차 가안(카드별 대본)을 쓴다. 표지 1장 + beats 마다 1장 안팎, 모두 6~10장. 마지막 카드는 punch.',
      '카드 필드:\n- top: 위 내레이션 상자 (25자 이내. 표지는 series, 없으면 빈 문자열)\n- scene: 그림으로 보여 줄 장면 (누가 어디서 무엇을, 구체적으로. 표지는 회차 제목을 크게 + 두 수달)\n- dialogue: 말풍선. 여러 개면 " / " 로 나누고 "남편: …", "아내: …" 처럼 말한 사람을 앞에 (없으면 빈 문자열)\n- bottom: 아래 내레이션 상자 (짧게, 없으면 빈 문자열)\n- artNote: 표정·소품·구도 메모',
      '- caption: 인스타 캡션 2~4줄 + 해시태그 5~8개 (#싱부부의외노자일기 포함)',
      rules(), 'JSON 하나만 답해라: {"title":"회차 제목","cards":[{"top":"","scene":"","dialogue":"","bottom":"","artNote":""}],"caption":""}'].filter(Boolean).join('\n\n');
    return [...head,
      '이번 할 일: 이 기획안 그대로 영상 1차 가안 — 컷별 대본과 AI 영상 프롬프트.',
      '필드:\n- title: 작업 이름 (짧게)\n- hook, hookEn: 화면 위 고정 자막 한국어·영어 (기획안을 다듬어서)\n- shots: 1~4컷. 컷마다\n  - sec: "0~4초" 같은 구간 (전체 7~15초)\n  - see: 화면에 보이는 것 (한국어, 구체적으로)\n  - sub: 화면 속 작은 자막 (없으면 빈 문자열)\n  - sound: 소리 (현장 소리, 효과음)\n  - prompt: AI 영상 생성용 영어 프롬프트 (구글 Flow·Veo). 세로 9:16, photorealistic 수달, 카메라 위치·움직임, 조명, 동작을 한 문단으로. 영상 안에 글자·자막·로고를 넣지 말라(no text, no captions)고 꼭 쓴다. 남편 수달 = yellow safety helmet, 아내 수달 = pink ribbon (나오는 쪽만).\n- caption: 인스타 캡션 1~3줄 + 해시태그 5~8개',
      rules(), 'JSON 하나만 답해라: {"title":"","hook":"","hookEn":"","shots":[{"sec":"","see":"","sub":"","sound":"","prompt":""}],"caption":""}'].filter(Boolean).join('\n\n');
  }

  // ----- 답 읽기 (실행기 검사와 같은 기준) -----
  const arr = (x, k) => Array.isArray(x && x[k]) ? x[k] : null;
  const CHECK = {
    toonPlan: x => { const p = arr(x, 'plans'); if (!p || p.length < 2) return '기획안이 2개 이상 있어야 해요.'; return p.some(o => !S(o.title, 99) || !Array.isArray(o.beats) || o.beats.length < 3) ? '기획안마다 title 과 beats 가 있어야 해요.' : ''; },
    reelPlan: x => { const p = arr(x, 'plans'); if (!p || p.length < 2) return '기획안이 2개 이상 있어야 해요.'; return p.some(o => !S(o.hook, 99) || !S(o.situation, 99)) ? '기획안마다 hook 과 situation 이 있어야 해요.' : ''; },
    toonDraft: x => { const c = arr(x, 'cards'); if (!c || c.length < 4 || c.length > 16) return '카드가 4~16장이어야 해요.'; return c.some(k => !['top', 'scene', 'dialogue', 'bottom'].some(f => S(k[f], 9))) ? '빈 카드가 있어요.' : ''; },
    reelDraft: x => { const s = arr(x, 'shots'); if (!s || s.length < 1 || s.length > 6) return '컷이 1~6개여야 해요.'; if (!S(x.hook, 99)) return '위 자막(hook)이 없어요.'; return s.some(k => !S(k.see, 9) || !S(k.prompt, 9)) ? '컷마다 see 와 prompt 가 있어야 해요.' : ''; },
  };
  function readJson(kind, text) {
    const t = String(text || ''), a = t.indexOf('{'), b = t.lastIndexOf('}');
    if (a < 0 || b < a) throw Error('답에서 JSON 을 못 찾았어요. Claude 의 답을 처음부터 끝까지 복사해 붙여 넣어 주세요.');
    let j; try { j = JSON.parse(t.slice(a, b + 1)); } catch (_) { throw Error('답의 JSON 모양이 깨졌어요. Claude 에게 "JSON 하나만 다시" 라고 한 번 더 부탁해 주세요.'); }
    const err = CHECK[kind](j); if (err) throw Error(err);
    return j;
  }
  const cleanPlans = (kind, j) => j.plans.slice(0, 6).map(o => kind === 'toon'
    ? { series: S(o.series, 40), title: S(o.title, 60), logline: S(o.logline, 240), beats: (o.beats || []).map(x => S(String(x || '').replace(/^\s*(?:카드\s*)?\d+\s*[.)—:\-–]\s*/, ''), 200)).filter(Boolean).slice(0, 12), punch: S(o.punch, 160), why: S(o.why, 200) }
    : { hook: S(o.hook, 60), hookEn: S(o.hookEn, 120), situation: S(o.situation, 300), shots: (o.shots || []).map(x => S(String(x || '').replace(/^\s*(?:컷\s*)?\d+\s*[.)—:\-–]\s*/, ''), 200)).filter(Boolean).slice(0, 6), line: S(o.line, 80), why: S(o.why, 200) });

  // ----- 실행기 -----
  async function viaRunner(kind, prompt) {
    let h;
    try { h = await fetch(RUN + '/health', { cache: 'no-store' }).then(r => r.json()); }
    catch (_) { const e = Error('맥 실행기가 꺼져 있어요 (또는 이 브라우저에서 실행기에 닿지 않아요).'); e.offline = true; throw e; }
    if (!(Number(h && h.api) >= NEED)) { const e = Error('맥 실행기가 예전 버전이에요. YouTube 작업판의 "실행기 업데이트"를 한 번 눌러 주세요.'); e.offline = true; throw e; }
    const r = await fetch(RUN + '/plan', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, prompt }) });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || !j.ok) throw Error((j && j.error) || '실행기에서 기획을 못 만들었어요.');
    const err = CHECK[kind](j); if (err) throw Error(err);
    return j;
  }
  async function ask(k, what, prompt, apply) {
    const s = st(k), kind = k + what;
    if (s.busy) return;
    s.busy = what; s.err = ''; changed();
    try { apply(await viaRunner(kind, prompt)); s.manual = null; }
    catch (e) {
      if (e.offline) { s.manual = { kind, prompt, copied: false, answer: '', why: e.message }; s.err = ''; }
      else s.err = e.message || String(e);
    } finally { s.busy = ''; keep(); changed(); }
  }

  // ----- 동작 -----
  function makePlans(k) {
    const s = st(k);
    if (!s.word.trim()) { s.err = '중심단어를 먼저 적어 주세요.'; changed(); return; }
    ask(k, 'Plan', planPrompt(k, s), j => { s.plans = cleanPlans(k, j); s.pick = 0; s.forWord = s.word.trim(); });
  }
  function approvePlan(k) {
    const s = st(k), plan = s.plans && s.plans[s.pick];
    if (!plan) { s.err = '기획안을 하나 골라 주세요.'; changed(); return; }
    ask(k, 'Draft', draftPrompt(k, s, plan), j => applyDraft(k, s, plan, j));
  }
  function applyDraft(k, s, plan, j) {
    const word = s.forWord || s.word.trim();
    if (k === 'toon') {
      const IT = window.InstaToon, p = IT.makeProject();
      p.title = S(j.title, 120) || plan.title;
      p.raw = [[plan.series, plan.title].filter(Boolean).join(' · '), plan.logline, ...plan.beats.map((b, i) => `${i + 1}. ${b}`), plan.punch ? '마지막: ' + plan.punch : ''].filter(Boolean).join('\n');
      p.cards = j.cards.slice(0, 16).map(c => ({ id: uid(), top: S(c.top, 180), scene: S(c.scene, 500), dialogue: S(c.dialogue, 180), bottom: S(c.bottom, 180), artNote: S(c.artNote, 500) }));
      p.stage = 'cards'; p.approvedAt = 0; p.generation = `1차 가안 · 중심단어 「${word}」`;
      p.plan = { word, ...plan };
      if (S(j.caption, 2000)) p.caption = S(j.caption, 2000);
      IT.flush(); log('그림툰 1차 가안: ' + p.title);
    } else {
      const r = { id: uid(), title: S(j.title, 80) || plan.hook, word, plan, hook: S(j.hook, 80) || plan.hook, hookEn: S(j.hookEn, 160) || plan.hookEn,
        shots: j.shots.slice(0, 6).map(x => ({ sec: S(x.sec, 20), see: S(x.see, 500), sub: S(x.sub, 80), sound: S(x.sound, 200), prompt: S(x.prompt, 2000) })),
        caption: S(j.caption, 2000), approvedAt: 0, madeAt: 0, created: Date.now(), updated: Date.now() };
      reels().unshift(r); setCur(r.id); persist(); log('영상 1차 가안: ' + r.title);
    }
    toast('1차 가안을 만들었어요. 다듬어 주세요.');
    setTimeout(() => FNPlan.onDone && FNPlan.onDone(k), 0);
  }
  async function copyAsk(k) {
    const s = st(k); if (!s.manual) return;
    const ok = await copyText(s.manual.prompt); window.open(CLAUDE_URL, '_blank', 'noopener');
    s.manual.copied = ok ? true : 'fail'; keep();
    toast(ok ? '복사했어요. Claude 입력칸에 붙여 넣고 보내세요.' : '복사하지 못했어요. "부탁 글 보기"를 열어 직접 복사해 주세요.'); changed();
  }
  function parseAnswer(k) {
    const s = st(k), m = s.manual; if (!m) return;
    try {
      const j = readJson(m.kind, m.answer);
      if (m.kind.endsWith('Plan')) { s.plans = cleanPlans(k, j); s.pick = 0; s.forWord = s.word.trim(); s.manual = null; s.err = ''; keep(); changed(); }
      else { const plan = s.plans && s.plans[s.pick]; s.manual = null; s.err = ''; keep(); applyDraft(k, s, plan, j); changed(); }
    } catch (e) { s.err = e.message; changed(); }
  }

  // ----- 영상(릴스) 작업 저장 -----
  const reels = () => Array.isArray(db.instaReels) ? db.instaReels : (db.instaReels = []);
  const current = () => reels().find(r => r.id === M.reelCur) || null;
  function setCur(id) { M.reelCur = id || ''; keep(); }
  let saveT = null;
  const touch = r => { r.updated = Date.now(); clearTimeout(saveT); saveT = setTimeout(persist, 400); };

  // ----- 그리기 -----
  function planCard(k, o, i, on) {
    const head = k === 'toon'
      ? `${o.series ? `<span class="fp-series">${esc(o.series)}</span>` : ''}<b class="fp-title">${esc(o.title)}</b><span class="pl-link-angle">${esc(o.logline)}</span>`
      : `<b class="fp-title">“${esc(o.hook)}”</b>${o.hookEn ? `<span class="fp-en">${esc(o.hookEn)}</span>` : ''}<span class="pl-link-angle">${esc(o.situation)}</span>`;
    const list = k === 'toon' ? o.beats : o.shots;
    const tail = k === 'toon' ? (o.punch ? `<span class="fp-punch">마지막 장 · ${esc(o.punch)}</span>` : '') : (o.line ? `<span class="fp-punch">화면 속 한마디 · “${esc(o.line)}”</span>` : '');
    return `<button type="button" role="radio" aria-checked="${on}" class="pl-link-opt fp-opt ${on ? 'on' : ''}" data-fp-pick="${i}">
      <span class="fp-no">안 ${i + 1}${on ? ' · 고름' : ''}</span>${head}
      ${on && list.length ? `<ol class="pl-link-cards">${list.map(x => `<li>${esc(x)}</li>`).join('')}</ol>` : ''}${on ? tail : ''}
      ${o.why ? `<span class="small">${esc(o.why)}</span>` : ''}</button>`;
  }
  function manualBox(k, s) {
    const m = s.manual; if (!m) return '';
    const what = m.kind.endsWith('Plan') ? '기획안' : '1차 가안';
    return `<div class="pl-manual fp-manual"><p class="pl-note">${esc(m.why)}<br>대신 Claude 채팅(구독)으로 ${what}을 받아요: 부탁 글을 복사해 Claude 에 보내고, 받은 답을 아래에 붙여 넣으세요.</p>
      <button type="button" class="pl-primary again" data-fp-copy>${m.copied === true ? '부탁 글 다시 복사 · Claude 열기' : 'Claude 채팅용으로 복사 · 열기'}</button>
      ${m.copied === 'fail' ? '<p class="pl-error" role="alert">복사가 안 됐어요. 아래 "부탁 글 보기"를 열어 직접 복사해 주세요.</p>' : ''}
      <label class="pl-own"><span>Claude 답 붙여 넣기</span><textarea class="pl-answer" data-fp-answer placeholder="여기에 Claude 의 답 붙여 넣기" aria-label="Claude 의 답">${esc(m.answer || '')}</textarea></label>
      <button type="button" class="pl-primary" data-fp-parse>${what} 읽어 오기</button>
      <p class="small"><button type="button" class="pl-link" data-fp-retry>실행기로 다시 시도</button></p>
      <details class="pl-peek"><summary>부탁 글 보기</summary><pre>${esc(m.prompt)}</pre></details></div>`;
  }
  function body(k) {
    const s = st(k), busy = s.busy, ph = k === 'toon' ? '예) 회식, 월요병, 첫 월급, 집주인' : '예) 에어컨, 그랩 택시, 퇴근 5분 전, 호커센터';
    const stale = s.plans && s.forWord && s.forWord !== s.word.trim();
    const input = `<div class="pl-link-in fp-in"><label class="pl-own" for="fpWord-${k}"><span class="pl-link-label">중심단어</span>
        <input id="fpWord-${k}" class="pl-input pl-biginput" data-fp-word="${k}" maxlength="60" autocomplete="off" placeholder="${esc(ph)}" value="${esc(s.word)}"></label>
      <details class="pl-peek fp-note" ${s.note ? 'open' : ''}><summary>덧붙일 말 (선택)</summary><textarea class="pl-answer" data-fp-note="${k}" rows="2" maxlength="600" placeholder="예) 남편 시점으로 · 아내가 이기는 결말 · 지난주에 실제로 있었던 일: …">${esc(s.note)}</textarea></details>
      <button type="button" class="pl-primary pl-bigbtn" data-fp-make="${k}" ${busy ? 'disabled' : ''}>${busy === 'Plan' ? '기획안 만드는 중… (30초~2분)' : s.plans ? '기획안 다시 만들기' : '기획안 만들기'}</button>
      <p class="small fp-ref">${LABEL[k]} 레퍼런스 형식 · <a href="${REF[k]}" target="_blank" rel="noopener noreferrer">예시 보기 ↗</a></p></div>`;
    let plans = '';
    if (s.plans && s.plans.length) {
      const pick = Math.min(s.pick || 0, s.plans.length - 1);
      plans = `<div class="pl-link-opts fp-plans" role="radiogroup" aria-label="기획안"><p class="pl-note">「${esc(s.forWord || '')}」 기획안 ${s.plans.length}개 · 마음에 드는 것을 누르고 승인하세요.${stale ? ' <b>중심단어를 바꿨어요. 새로 받으려면 "기획안 다시 만들기".</b>' : ''}</p>
        ${s.plans.map((o, i) => planCard(k, o, i, i === pick)).join('')}</div>
        <button type="button" class="pl-primary pl-bigbtn fp-approve" data-fp-approve="${k}" ${busy ? 'disabled' : ''}>${busy === 'Draft' ? '1차 가안 쓰는 중… (1~2분)' : `안 ${pick + 1} 승인 → 1차 가안 만들기`}</button>`;
    }
    const err = s.err ? `<p class="pl-error" role="alert">${esc(s.err)}</p>` : '';
    return `<div class="fp" data-fp="${k}">${input}${err}${manualBox(k, s)}${plans}</div>`;
  }

  // ----- 이벤트 -----
  const kOf = el => el.closest('[data-fp]') && el.closest('[data-fp]').dataset.fp;
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-fp] button'); if (!t) return;
    const k = kOf(t); if (!k) return;
    if (t.dataset.fpMake) makePlans(k);
    else if (t.dataset.fpApprove) approvePlan(k);
    else if (t.dataset.fpPick !== undefined) { st(k).pick = +t.dataset.fpPick; st(k).err = ''; keep(); changed(); }
    else if (t.hasAttribute('data-fp-copy')) copyAsk(k);
    else if (t.hasAttribute('data-fp-parse')) parseAnswer(k);
    else if (t.hasAttribute('data-fp-retry')) { const m = st(k).manual; st(k).manual = null; keep(); if (m && m.kind.endsWith('Plan')) makePlans(k); else if (m) approvePlan(k); else changed(); }
  });
  document.addEventListener('input', e => {
    const t = e.target, k = t.closest && kOf(t); if (!k) return;
    const s = st(k);
    if (t.dataset.fpWord) s.word = t.value; else if (t.dataset.fpNote) s.note = t.value; else if (t.hasAttribute('data-fp-answer') && s.manual) s.manual.answer = t.value; else return;
    keep();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.isComposing && e.target.dataset && e.target.dataset.fpWord) { e.preventDefault(); makePlans(e.target.dataset.fpWord); } });

  const css = document.createElement('style');
  css.textContent = `
.fp-in{margin-bottom:6px}.fp-note{margin:0}.fp-note textarea{min-height:64px}
.fp-ref{margin:0;color:var(--muted)}.fp-ref a{color:var(--pc)}
.fp-opt{position:relative}.fp-opt.on{border-color:var(--pc);background:color-mix(in srgb,var(--pc) 10%,var(--panel2))}
.fp-no{font-size:12px;font-weight:700;letter-spacing:.04em;color:var(--pc)}
.fp-series{font-size:13px;color:#c3c8cf}.fp-title{font-size:19px;line-height:1.35}
.fp-en{font-size:13px;color:#c3c8cf;font-style:italic}.fp-punch{font-size:14px;color:var(--text)}
.fp-opt .pl-link-cards{font-size:14px;color:#c3c8cf;display:grid;gap:3px}
.fp-approve{margin-top:4px}.fp-manual{margin:10px 0}`;
  document.head.appendChild(css);

  window.FNPlan = { body, st, reels, current, setCur, touch, onDone: null, REF, LABEL };
})();
