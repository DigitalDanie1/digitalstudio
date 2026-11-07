'use strict';

const FIRST_DEBATE = 'https://www.youtube.com/watch?v=7wR0dnZpMvw';
const SHORTS_PROJECTS = {
  y1: '신앙 · 토론 하이라이트', y2: '지식 한 입', y3: '오늘의 인사이트',
  a1: '브랜드 스토리', a2: '라이프 매거진', a3: '로컬 비즈니스',
  b1: '일상 기록 블로그', b2: '테크 노트', e1: '인터뷰 시리즈',
};
const PUBLICATION_ITEMS = ['제목·썸네일 또는 대표 이미지', '본문·영상·자막', '게시 계정·공개 범위'];

function workflowURL(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function shortsPlanning() {
  const added = db.ideas.some(idea => idea.id === 'shorts-first-debate');
  return `<section class="panel shorts-intake"><div class="eyebrow">SHORTS · 신앙 · 토론 하이라이트</div>
    <h2>쇼츠 작업실</h2><p class="small">토론 원본을 소재로 저장하거나 기존 작업실의 JSON 백업을 가져오세요.</p>
    <div class="actions"><a class="btn" href="${FIRST_DEBATE}" target="_blank" rel="noopener noreferrer">토론 원본 열기 ↗</a>
    <button class="btn" data-workflow="debate" ${added ? 'disabled' : ''}>${added ? '소재함에 저장됨' : '토론을 소재함에 추가'}</button>
    <button class="btn" data-workflow="import">쇼츠 백업 가져오기</button></div></section>`;
}

function shortsBackupEntries(data) {
  if (data?.version === 1 && Array.isArray(data.clips) && Array.isArray(data.sources) && Array.isArray(data.references)) {
    const sources = new Map(data.sources.map(source => [source.id, source]));
    const clips = data.clips.map(clip => {
      const source = sources.get(clip.sourceId);
      return {
        id: 'wordcut-clip-' + clip.id, title: clip.title, channel: 'youtube', project: 'y1',
        ytChannel: 'yt-christian',
        status: clip.stage === '검수' || clip.stage === '완료' ? 'review' : 'draft',
        body: clip.subtitles || clip.translation || '',
        sources: [clip.url, source?.url, clip.evidence].filter(Boolean).join('\n'),
        note: [
          clip.stage && '쇼츠 작업 단계 · ' + clip.stage,
          clip.topic && '주제 · ' + clip.topic, clip.due && '목표일 · ' + clip.due,
          (clip.start || clip.end) && '원본 구간 · ' + [clip.start, clip.end].join(' ~ '),
          clip.notes, clip.rights && '이용 조건 · ' + clip.rights,
          clip.original && '원문\n' + clip.original,
          clip.translation && clip.subtitles && '한국어 번역\n' + clip.translation,
          clip.checks && '기존 확인 기록 · ' + Object.entries(clip.checks).filter(([, checked]) => checked === true).map(([key]) => key).join(', '),
        ].filter(Boolean).join('\n\n'),
      };
    });
    const references = data.references.map(ref => ({
      id: 'wordcut-reference-' + ref.id, title: ref.name, sources: ref.url || '',
      note: [ref.kind, ref.note].filter(Boolean).join('\n\n') || '쇼츠 참고 영상',
    }));
    const channels = data.sources.map(source => ({
      id: 'wordcut-source-' + source.id, title: source.name, sources: source.url || '',
      note: [source.enabled === false ? '보관된 소스 채널' : '쇼츠 소스 채널', source.category, source.notes].filter(Boolean).join('\n\n'),
    }));
    return [...clips, ...references, ...channels];
  }
  if (Array.isArray(data?.tasks) && data.done && Array.isArray(data.devices)) {
    return data.tasks.filter(task => !String(task.id).startsWith('demo-')).map(task => ({
      id: 'autohunt-task-' + task.id, title: task.title, sources: task.url || '',
      project: Object.hasOwn(SHORTS_PROJECTS, task.project) ? task.project : undefined,
      channel: /^[ye]/.test(task.project) ? 'youtube' : 'blog',
      ytChannel: task.project === 'y1' ? 'yt-christian' : undefined,
      status: ['review', 'done'].includes(task.status) ? 'review' : 'draft',
      note: [SHORTS_PROJECTS[task.project], task.notes, '기존 작업 상태 · ' + task.status].filter(Boolean).join('\n\n'),
      created: Date.parse(task.created),
    }));
  }
  throw Error('쇼츠 작업실 또는 자동사냥에서 내보낸 JSON 백업을 선택하세요.');
}

function importShortsBackup(data) {
  const entries = shortsBackupEntries(data);
  if (entries.some(entry => typeof entry.title !== 'string' || !entry.title.trim())) {
    throw Error('제목이 비어 있는 항목이 있습니다.');
  }
  const ids = new Set([...db.posts, ...db.ideas].map(entry => entry.id));
  const ideas = [], posts = [];
  for (const entry of entries) {
    if (ids.has(entry.id)) continue;
    ids.add(entry.id);
    const idea = {
      id: entry.id, title: entry.title, sources: String(entry.sources), note: entry.note || '쇼츠 작업실에서 가져온 작업',
      created: Number.isFinite(entry.created) ? entry.created : Date.now(), sample: false,
      preferredChannel: entry.channel || 'youtube',
    };
    if (entry.channel) {
      const post = newPost(idea, entry.channel, false);
      posts.push({
        ...post, id: idea.id, ideaId: null, body: entry.body || '', memo: idea.note,
        created: idea.created, status: entry.status,
        ...(entry.project ? {shortsProject: entry.project} : {}),
        ...(entry.channel === 'youtube' ? {ytChannel: entry.ytChannel} : {}),
      });
    } else {
      ideas.push(idea);
    }
  }
  if (!posts.length && !ideas.length) return '추가할 새 작업이나 소재가 없습니다.';
  const next = {...db, posts: [...posts, ...db.posts], ideas: [...ideas, ...db.ideas]};
  if (new TextEncoder().encode(JSON.stringify({data: next, baseVersion: 0})).length >= 4 * 1024 * 1024) {
    throw Error('현재 작업과 합친 백업이 클라우드 저장 한도를 초과합니다.');
  }
  db = next;
  const message = `쇼츠 작업 ${posts.length}건과 소재 ${ideas.length}건을 가져왔습니다.`;
  log(message);
  persist();
  render();
  return message;
}

function projectOverview(posts) {
  const groups = new Map(Object.keys(SHORTS_PROJECTS).map(id => [id, []]));
  for (const post of posts) {
    if (post.sample) continue;
    // Recover the project from work imported before the dedicated field was added.
    const legacyProject = post.id.startsWith('wordcut-clip-') ? 'y1'
      : post.id.startsWith('autohunt-task-')
        ? Object.keys(SHORTS_PROJECTS).find(id => SHORTS_PROJECTS[id] === post.memo?.split('\n\n')[0])
        : undefined;
    const project = post.shortsProject || legacyProject || (post.ideaId === 'shorts-first-debate' ? 'y1' : undefined);
    groups.get(project)?.push(post);
  }
  const active = [...groups].filter(([, items]) => items.length);
  return `<div class="sectionhead"><h2>프로젝트별 작업 현황</h2>
    <button class="linkbtn" data-workflow="import">자동사냥 백업 가져오기 ↗</button></div>
    <section class="panel">${active.map(([id, items]) => {
      const count = status => items.filter(post => !post.publicationCheck && post.status === status).length;
      return `<details class="memo-panel"><summary>${esc(SHORTS_PROJECTS[id])}
        <span class="small"> · 작성 ${count('draft')} · 검수 ${count('review')} · 승인 ${count('approved')}
        · 게시 확인 ${items.filter(post => post.publicationCheck).length}</span></summary>
        <div class="inner reviewlist">${reviewRows(items)}</div></details>`;
    }).join('') || '<div class="empty">자동사냥에서 내보낸 백업을 가져오면 프로젝트별 작업이 표시됩니다.</div>'}</section>`;
}

function publicationRows() {
  const posts = db.posts.filter(post => !post.sample &&
    (post.status === 'approved' || post.publicationCheck || post.publish.state !== 'not_requested'));
  posts.sort((a, b) => (b.publicationCheck?.at || b.publish.requestedAt || b.updated) -
    (a.publicationCheck?.at || a.publish.requestedAt || a.updated));
  return `<div class="sectionhead"><div class="left"><h2>게시물 검토</h2><span class="number">${posts.length}</span></div></div>
    <section class="panel">${posts.map(post => {
      const check = post.publicationCheck;
      const url = workflowURL(check?.url || (post.publish.state === 'published' ? post.publish.url : ''));
      const state = check ? '확인 완료' : post.publish.state === 'published' ? '브리지 게시 응답 · 확인 전' : publishState(post);
      return `<div class="queue-row">${icon(post.channel)}<div><h3>${esc(post.title)}</h3>
        <div class="small">${esc(CH[post.channel].name)}${check ? ' · ' + esc(new Date(check.at).toLocaleString('ko-KR')) : ''}</div>
        ${post.publish.message && !check ? `<div class="small">${esc(post.publish.message)}</div>` : ''}</div>
        <span class="statuspill">${state}</span><div class="actions">
        ${url ? `<a class="btn" href="${esc(url)}" target="_blank" rel="noopener noreferrer">게시물 열기 ↗</a>` : ''}
        <button class="btn" data-workflow="verify" data-id="${esc(post.id)}" ${post.publish.state === 'sending' ? 'disabled' : ''}>${check ? '확인 수정' : '게시 확인 기록'}</button></div></div>`;
    }).join('') || '<div class="empty">승인하거나 발행 요청한 원고가 여기에 표시됩니다.</div>'}</section>`;
}

function publicationModal(post) {
  const check = post.publicationCheck;
  const url = workflowURL(check?.url || (post.publish.state === 'published' ? post.publish.url : ''));
  modal(`<div class="modalhead"><h2 id="modalTitle">게시 확인 기록</h2>
    <button class="close" data-action="close" aria-label="닫기">×</button></div>
    <form id="publicationForm" data-id="${esc(post.id)}">
    <p>${esc(post.title)}</p>
    <div class="field"><label for="publicationUrl">실제 게시물 URL</label>
    <input class="input" id="publicationUrl" type="url" name="url" value="${esc(url)}" required></div>
    <div class="actions"><button type="button" class="btn" data-workflow="open-publication">입력한 링크 열기 ↗</button></div>
    <div class="publication-checks">${PUBLICATION_ITEMS.map(item =>
      `<label><input type="checkbox" required> ${item} 확인</label>`).join('')}</div>
    <div class="field"><label for="publicationNote">확인 메모</label>
    <textarea class="input" id="publicationNote" name="note" maxlength="2000">${esc(check?.note || '')}</textarea></div>
    <div class="modalfooter"><button class="btn primary" type="submit">확인 완료 저장</button></div></form>`);
}

document.addEventListener('click', event => {
  const button = event.target.closest('button[data-workflow]');
  if (!button) return;
  switch (button.dataset.workflow) {
    case 'import':
      $('#shortsImportFile').click();
      break;
    case 'debate':
      if (db.ideas.some(idea => idea.id === 'shorts-first-debate')) return;
      db.ideas.unshift({
        id: 'shorts-first-debate', title: 'Christian vs. Muslim Women | The Bridge',
        note: '신앙 · 토론 하이라이트. 예수의 죽음(21:13)과 삼위일체(58:35) 챕터부터 검토. 질문과 답변이 함께 들어가는 30~60초 구간을 원문 확인 후 선정.',
        sources: FIRST_DEBATE, created: Date.now(), preferredChannel: 'youtube', ytChannel: 'yt-christian', sample: false,
      });
      log('쇼츠 토론 원본을 소재함에 추가했습니다.');
      persist();
      render();
      break;
    case 'verify': {
      const post = db.posts.find(item => item.id === button.dataset.id);
      if (editing && dirty) {
        toast('원고를 먼저 저장하세요.');
        return;
      }
      if (post && !post.sample && post.publish.state !== 'sending') publicationModal(post);
      break;
    }
    case 'open-publication': {
      const url = workflowURL($('#publicationUrl').value);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
      else toast('게시물의 HTTP 또는 HTTPS 주소를 입력하세요.');
      break;
    }
  }
});

document.addEventListener('submit', event => {
  const form = event.target;
  if (form.id !== 'publicationForm') return;
  event.preventDefault();
  if (!form.reportValidity()) return;
  const post = db.posts.find(item => item.id === form.dataset.id);
  if (!post || post.sample || post.publish.state === 'sending') return;
  const url = workflowURL(form.elements.url.value);
  if (!url) {
    toast('게시물의 HTTP 또는 HTTPS 주소를 입력하세요.');
    return;
  }
  post.publicationCheck = {url, note: form.elements.note.value.trim(), at: Date.now()};
  log('게시물 확인 완료: ' + post.title);
  persist();
  closeModal();
  render();
  toast('게시 확인 기록을 저장했습니다.');
});

document.querySelector('#shortsImportFile').addEventListener('change', async event => {
  const input = event.target;
  const file = input.files[0];
  if (!file) return;
  try {
    if (file.size > 4 * 1024 * 1024) throw Error('4MB 이하의 백업을 선택하세요.');
    toast(importShortsBackup(JSON.parse(await file.text())));
  } catch (error) {
    toast('가져오기 실패: ' + error.message);
  } finally {
    input.value = '';
  }
});

// Recommended starting formats for one account per platform, not platform upload limits.
const PLATFORM_OPERATING_GUIDE = [
  {
    name: 'YouTube', role: '영상으로 설명하고 새로운 시청자를 만나는 채널',
    write: '30~60초 쇼츠 대본, 제목, 영상 설명, 출처. 한 영상에 질문 하나와 결론 하나를 담습니다.',
    tools: '원고 작성 AI → 직접 촬영 또는 이미지 → 편집 → 한국어 자막 → MP4. 음성이 필요할 때 ElevenLabs, 받아쓰기가 필요할 때 Whisper를 씁니다.',
    publish: 'YouTube Studio에서 영상·제목·설명·썸네일·공개 범위를 확인하고 게시합니다.',
    check: '채널과 공개 상태, 세로 화면 잘림, 자막 싱크, 음량을 확인합니다. 이후 조회수·시청 지속 시간·구독 전환을 기록합니다.',
    example: '제목\n[질문 하나 또는 핵심 결론]\n\n대본\n0~3초 · [시선을 붙잡는 질문]\n3~40초 · [사례와 근거]\n40~60초 · [결론과 다음 질문]\n\n영상 설명\n[요약과 원문 출처]',
    source: 'https://support.google.com/youtube/answer/12779649',
  },
  {
    name: 'X', role: '빠른 관점과 자료를 공유하는 채널',
    write: '첫 글에 핵심 주장 하나, 다음 글에 근거 2~3개, 마지막 글에 출처를 넣습니다. 일반 게시물의 길이에 맞춰 짧게 나눕니다.',
    tools: '원고 작성 AI + 필요할 때 설명 이미지 한 장. 근거 확인에는 원문과 공식 자료를 씁니다.',
    publish: 'X에서 글 순서, 링크 미리보기, 이미지 설명을 확인하고 게시합니다.',
    check: '첫 글과 후속 글의 연결, 깨진 링크, 이미지 가독성을 확인합니다. 이후 노출·답글·북마크·프로필 방문을 봅니다.',
    example: '첫 글\n[오늘의 관점 한 문장]\n[왜 중요한지]\n\n후속 글\n1. [근거]\n2. [사례]\n3. [한계 또는 반론]\n\n마지막 글\n[결론]\n출처 · [원문 URL]',
    source: 'https://help.x.com/en/using-x/create-a-thread',
  },
  {
    name: '네이버 블로그', role: '검색으로 찾아오는 독자를 위한 상세 원문',
    write: '검색 질문이 드러나는 제목, 도입, 소제목 3개, 직접 경험, 근거와 출처, 결론. 시작 분량은 1,200~2,000자 정도로 잡습니다.',
    tools: 'FIELDNOTE 블로그 기획·원고 편집 + 직접 찍은 사진 또는 설명 이미지. 사진이 충분하면 이미지 생성은 생략할 수 있습니다.',
    publish: '네이버 글쓰기에서 제목·본문·사진·카테고리를 배치하고 직접 등록합니다. 기존 FIELDNOTE의 본문 복사 기능을 쓸 수 있습니다.',
    check: '게시 주소, 사진 누락, 모바일 문단, 링크와 카테고리를 확인합니다. 이후 검색 유입어·조회수·반응을 기록합니다.',
    example: '제목\n[독자가 검색할 질문]\n\n도입\n[이 글에서 답할 문제]\n\n1. [배경과 직접 경험]\n2. [핵심 근거와 사례]\n3. [독자가 활용할 방법]\n\n결론\n[짧은 정리]\n\n출처\n[원문 URL와 확인 날짜]',
  },
  {
    name: 'Telegram', role: '구독자에게 요약과 업데이트를 전달하는 채널',
    write: '제목, 핵심 3줄, 내 해석, 원문 링크. 시작 분량은 500~1,000자로 잡고 중요한 변화부터 씁니다.',
    tools: '원고 작성 AI + 선택적으로 요약 이미지. 직접 게시는 Telegram 앱, 반복 발행을 연결할 때는 Bot API를 검토합니다.',
    publish: 'Telegram 채널 한 곳에 공지 형태로 올립니다. 채널명과 링크, 미리보기를 확인합니다.',
    check: '게시 채널, 메시지 잘림, 링크를 확인합니다. 이후 게시물 조회·전달·반응을 기록합니다.',
    example: '[오늘의 주제]\n\n• [핵심 변화 1]\n• [핵심 변화 2]\n• [핵심 변화 3]\n\n내 생각\n[이 변화가 중요한 이유]\n\n원문\n[URL]',
    source: 'https://telegram.org/faq_channels',
  },
  {
    name: 'Instagram', role: '한눈에 이해되는 카드와 짧은 영상으로 저장을 유도하는 채널',
    write: '카드 5~7장의 문구와 캡션, 또는 짧은 릴스 대본. 첫 장은 질문, 중간은 근거, 마지막은 결론과 질문으로 구성합니다.',
    tools: '카드 문구 작성 + 직접 사진, GPT Image 또는 HTML→PNG. 릴스는 세로 영상 편집과 자막을 추가합니다.',
    publish: 'Instagram 앱 또는 연결된 Meta Business Suite에서 순서·표지·캡션·공개 대상을 확인하고 게시합니다.',
    check: '카드 순서와 글자 잘림, 릴스 표지·자막·음량을 확인합니다. 이후 저장·공유·프로필 방문을 기록합니다.',
    example: '1장 · [핵심 질문]\n2장 · [배경]\n3장 · [근거 1]\n4장 · [근거 2]\n5장 · [결론과 질문]\n\n캡션\n[핵심 요약과 내 경험]\n[독자에게 묻는 질문]\n출처 · [자료명]',
  },
  {
    name: 'Threads', role: '개인 경험과 질문으로 대화를 이어가는 채널',
    write: '관찰한 장면, 내 생각, 독자에게 던지는 질문. 첫 글은 200~400자 정도로 시작하고 긴 근거는 답글로 덧붙입니다.',
    tools: '원고 작성 AI로 문장을 다듬고 본인의 실제 경험과 말투를 넣습니다. 필요한 경우 사진 한 장을 더합니다.',
    publish: 'Threads에서 본문·사진·태그와 답글 범위를 확인하고 게시합니다.',
    check: '실제 게시 내용과 답글 설정을 확인합니다. 이후 답글·재게시·프로필 방문을 보고 후속 질문을 남깁니다.',
    example: '[직접 본 장면이나 겪은 일]\n\n처음에는 [이전 생각]이라고 생각했다.\n그런데 [새로 알게 된 점]을 보고 생각이 바뀌었다.\n\n[내 관점 한 문장]\n\n여러분은 [구체적인 질문]?',
    source: 'https://about.fb.com/news/2023/07/introducing-threads-new-app-text-sharing/',
  },
];

// 플랫폼별 글자색: 가이드 카드·운영 순서에서 한눈에 구분되도록.
const PLATFORM_COLORS = { 'YouTube': '#ff6b6b', 'X': '#f2c94c', '네이버 블로그': '#3ddc84', 'Telegram': '#4fb3ff', 'Instagram': '#ff7ac8', 'Threads': '#b9a1f5' };
const platformColor = (name) => PLATFORM_COLORS[name] || 'var(--lime)';
const PLATFORM_EMOJI = {YouTube:'▶️', X:'🐦', '네이버 블로그':'📝', Telegram:'✈️', Instagram:'📸', Threads:'🧵'};
const platformLabel = name => `${PLATFORM_EMOJI[name] || '🌐'} ${name}`;
const platformTag = name => `<b class="pc-tag" style="--pc:${platformColor(name)}">${esc(platformLabel(name))}</b>`;

const OPERATION_STACK = [
  {name:'🌐 운영 플랫폼', tools:['▶️ YouTube', '🐦 X', '📝 네이버 블로그', '✈️ Telegram', '📸 Instagram', '🧵 Threads']},
  {name:'🎼 오케스트레이션', tools:['🧠 Claude Code', '🤝 서브에이전트']},
  {name:'⚙️ 대량 작업', tools:['💻 Codex CLI']},
  {name:'🔎 리서치', tools:['🔭 Grok', '🧪 DeepSeek API', '📥 yt-dlp']},
  {name:'✍️ 원고', tools:['🧠 Claude', '📋 채점 스크립트']},
  {name:'🎨 이미지', tools:['🖌️ GPT Image', '🖼️ HTML → PNG 렌더']},
  {name:'🎬 영상 생성', tools:['🪄 Muse', '🛠️ 이미지 편집', '🎥 Kling i2v']},
  {name:'🎙️ 음성', tools:['🗣️ ElevenLabs PVC', '👂 Whisper']},
  {name:'🎞️ 렌더', tools:['🎭 Playwright', '🎞️ FFmpeg']},
  {name:'✅ 품질 검사', tools:['🔬 프레임 검사', '📐 규격 검사', '🔊 음량 정규화']},
  {name:'🚀 게시', tools:['🌍 브랜드별 Chrome CDP']},
  {name:'📊 지표', tools:['⏰ cron', '🗄️ SQLite']},
  {name:'🧩 기억·규칙', tools:['🔀 git 동기화 메모리', '🪝 훅']},
];

function operationStackTable() {
  return `<section class="operation-stack" aria-labelledby="operationStackTitle">
    <div class="sectionhead"><h2 id="operationStackTitle">🧰 콘텐츠 운영 스택</h2><span class="small">🌐 6개 플랫폼 · 👤 계정 6개</span></div>
    <p class="small">첨부 표의 단계와 도구를 이모티콘으로 구분했습니다. 각 도구는 참고 구성입니다. 현재 작성은 구독·무료 한도와 로컬 제작 도구를 기준으로 준비합니다.</p>
    <div class="stack-table-wrap"><table class="stack-table"><thead><tr><th scope="col">단계</th><th scope="col">도구·작업</th></tr></thead>
    <tbody>${OPERATION_STACK.map(row => `<tr><th scope="row">${esc(row.name)}</th><td><div class="stack-tools">${row.tools.map(tool => `<span class="stack-tool">${esc(tool)}</span>`).join('<span class="stack-separator" aria-hidden="true">·</span>')}</div></td></tr>`).join('')}</tbody></table></div>
    <details class="stack-original"><summary>📎 원본 이미지 보기</summary><a href="/outputs/assets/content-operation-stack.jpg" target="_blank" rel="noopener noreferrer"><img class="operating-image" src="/outputs/assets/content-operation-stack.jpg" width="923" height="559" alt="사용자가 제공한 콘텐츠 운영 스택 원본 표"></a><p class="small">원본의 계정 10개 표기는 현재 운영 기준인 플랫폼당 1개, 총 6개로 정리했습니다.</p></details>
    </section>`;
}

// 플랫폼별 필요한 프로그램 + 구독 준비표. 준비 체크는 이 브라우저에만 저장.
const PREP_TOOLS = {
  ai:        { name:'원고 작성 AI', note:'ChatGPT 또는 Claude 중 하나', use:'모든 채널 원고 초안·대본', price:'부분 유료', links:[['ChatGPT 요금','https://chatgpt.com/pricing'],['Claude 요금','https://claude.ai/upgrade']] },
  capcut:    { name:'캡컷 데스크톱', use:'영상·릴스 편집, 자막 템플릿', price:'부분 유료', links:[['캡컷','https://www.capcut.com/']] },
  vrew:      { name:'Vrew', use:'한국어 음성 인식 자막', price:'부분 유료', links:[['Vrew','https://vrew.ai/']] },
  vizard:    { name:'Vizard', use:'긴 영상 → 쇼츠 자동 자르기', price:'부분 유료', links:[['Vizard','https://vizard.ai/']] },
  opus:      { name:'OpusClip', use:'긴 영상 → 쇼츠 자동 자르기 (더 정교)', price:'부분 유료', links:[['OpusClip','https://www.opus.pro/']] },
  quicktime: { name:'QuickTime', note:'맥 기본 앱', use:'화면 녹화·내 목소리 녹음', price:'무료', links:[] },
  ytstudio:  { name:'YouTube Studio', use:'업로드·제목·썸네일·통계', price:'무료', links:[['YouTube Studio','https://studio.youtube.com/']] },
  eleven:    { name:'ElevenLabs', use:'AI 음성 (내 목소리 대신 쓸 때만)', price:'부분 유료', links:[['ElevenLabs','https://elevenlabs.io/pricing']] },
  canva:     { name:'Canva', use:'카드뉴스·썸네일·설명 이미지', price:'부분 유료', links:[['Canva','https://www.canva.com/ko_kr/pricing/']] },
  xapp:      { name:'X', use:'게시·스레드 작성', price:'무료', links:[['X','https://x.com/']] },
  xpremium:  { name:'X Premium', use:'긴 글·수익화·노출', price:'유료', links:[['X Premium','https://x.com/i/premium_sign_up']] },
  typefully: { name:'Typefully', use:'X·Threads 글 예약 발행', price:'부분 유료', links:[['Typefully','https://typefully.com/pricing']] },
  naver:     { name:'네이버 블로그 에디터', use:'글쓰기·사진 배치·카테고리', price:'무료', links:[['네이버 블로그','https://blog.naver.com/']] },
  telegram:  { name:'Telegram 데스크톱', use:'채널 게시·관리', price:'무료', links:[['Telegram','https://desktop.telegram.org/']] },
  tgbot:     { name:'Telegram Bot API', use:'반복 발행 자동화 (나중에)', price:'무료', links:[['Bot API','https://core.telegram.org/bots']] },
  instagram: { name:'Instagram 앱', use:'카드·릴스 게시', price:'무료', links:[] },
  meta:      { name:'Meta Business Suite', use:'인스타 예약 게시·통계', price:'무료', links:[['Meta Business Suite','https://business.facebook.com/']] },
  threads:   { name:'Threads 앱', use:'게시·답글 관리', price:'무료', links:[['Threads','https://www.threads.com/']] },
};
// 플랫폼별: [도구 id, 필수 여부]
const PLATFORM_TOOLS = {
  'YouTube':      [['ai',1],['capcut',1],['quicktime',1],['ytstudio',1],['vrew',0],['vizard',0],['opus',0],['eleven',0]],
  'X':            [['ai',1],['xapp',1],['canva',0],['typefully',0],['xpremium',0]],
  '네이버 블로그': [['ai',1],['naver',1],['canva',0]],
  'Telegram':     [['ai',1],['telegram',1],['tgbot',0]],
  'Instagram':    [['ai',1],['instagram',1],['canva',1],['capcut',0],['meta',0]],
  'Threads':      [['ai',1],['threads',1],['canva',0],['typefully',0]],
};
const TOOL_READY_KEY = 'fieldnote-tool-ready-v1';
function toolReady() { try { return JSON.parse(localStorage.getItem(TOOL_READY_KEY) || '{}') || {}; } catch (_) { return {}; } }
function priceClass(price) { return price === '무료' ? 'free' : price === '유료' ? 'paid' : 'part'; }

function platformToolChips(platformName) {
  const list = PLATFORM_TOOLS[platformName] || [];
  const chip = ([id, must]) => { const t = PREP_TOOLS[id]; return `<li class="tool-chip ${must ? 'must' : ''}"><span class="tc-name">${esc(t.name)}</span><span class="tc-price ${priceClass(t.price)}">${esc(t.price)}</span><span class="tc-use">${esc(t.use)}</span></li>`; };
  const must = list.filter(x => x[1]), opt = list.filter(x => !x[1]);
  return `<div class="platform-tools"><div class="pt-label">🧩 필요한 프로그램</div>
    <ul class="tool-chips"><li class="tc-group">필수</li>${must.map(chip).join('')}</ul>
    ${opt.length ? `<ul class="tool-chips opt"><li class="tc-group">있으면 좋음</li>${opt.map(chip).join('')}</ul>` : ''}</div>`;
}

// 구독 프로그램 역할: 언제 결제하는지 단계별로.
const SUBSCRIPTION_STAGES = [
  { label:'지금 결제', tone:'now', hint:'이것 하나면 6개 플랫폼 모두 시작', items:[
    { id:'ai', role:'6개 플랫폼 원고·대본·제목을 모두 씁니다. 소재 하나를 블로그 원문, X 글, 인스타 카드 문구로 바꾸고 출처 정리도 맡습니다. 공장 전체의 두뇌입니다.', upgrade:'사용 한도가 크게 늘고 긴 자료를 읽힐 수 있습니다. 매일 쓰면 무료판은 금방 막힙니다.' },
  ]},
  { label:'막히면 결제', tone:'next', hint:'영상·이미지 제작', items:[
    { id:'capcut', role:'쇼츠·릴스의 최종 편집. 컷 편집, 자막, 효과음, 세로 화면을 맞추고 자막 스타일을 템플릿으로 저장해 반복 생산합니다.', upgrade:'고급 자막 스타일, 배경 제거, 일부 효과·내보내기 제한이 풀립니다.' },
    { id:'canva', role:'이미지 제작. 인스타 카드뉴스 5~7장, 블로그·유튜브 썸네일, X 설명 이미지를 만듭니다.', upgrade:'브랜드 키트(내 색·폰트 저장), 배경 제거, 크기 한 번에 바꾸기. 인스타 카드를 매주 만들면 결제할 가치가 있습니다.' },
    { id:'vrew', role:'한국어 자막 전문. 말을 듣고 자막을 자동으로 받아 적고, 대본 글자를 지우면 영상도 같이 잘립니다.', upgrade:'한 달 처리 분량이 늘어납니다. 캡컷 자막이 부정확할 때만 쓰면 됩니다.' },
  ]},
  { label:'쇼츠 공장 본격 가동 때', tone:'later', hint:'해설 영상이 쌓이면', items:[
    { id:'vizard', role:'긴 해설 영상을 넣으면 쇼츠로 자동 분할합니다. 재밌는 구간을 고르고 세로 화면과 자막까지 맞춥니다.', upgrade:'처리 분량이 늘고 워터마크가 사라집니다. 무료판으로 먼저 시험하세요.' },
    { id:'opus', role:'Vizard와 같은 일을 더 정교하게 합니다. 구간마다 바이럴 점수를 매겨 줍니다.', upgrade:'Vizard 결과가 아쉬울 때 갈아타는 용도입니다. 둘 다 결제할 필요는 없습니다.' },
    { id:'eleven', role:'AI 목소리. 대본을 넣으면 사람 같은 음성으로 읽어 줍니다.', upgrade:'내 목소리로 녹음하면 필요 없습니다. 목소리를 안 내고 싶을 때만 쓰세요.' },
  ]},
  { label:'나중에', tone:'last', hint:'X·Threads 운영이 자리 잡으면', items:[
    { id:'typefully', role:'X와 Threads 글을 미리 써 두고 예약 발행합니다. 스레드 순서를 편하게 짤 수 있습니다.', upgrade:'예약 개수와 여러 계정 관리. 매일 직접 올리면 필요 없습니다.' },
    { id:'xpremium', role:'프로그램이 아니라 X 계정 업그레이드입니다. 긴 글 쓰기, 수익 창출, 노출 가산을 줍니다.', upgrade:'팔로워가 어느 정도 생긴 뒤에 결제하세요.' },
  ]},
];

function subscriptionRoles() {
  const pf = id => Object.entries(PLATFORM_TOOLS).filter(([, list]) => list.some(([tid]) => tid === id)).map(([name]) => `<span class="tp-pf" style="--pc:${platformColor(name)}">${esc(name)}</span>`).join('');
  return `<div class="sub-roles"><h3>💳 구독 프로그램 역할 · 결제 순서</h3>
    <p class="small">처음에는 원고 AI 하나만 결제하세요. 인스타 카드를 시작하면 Canva, 쇼츠 편집이 막히면 캡컷, 해설 영상이 쌓이면 Vizard → OpusClip 순서로 추가합니다.</p>
    <ol class="sub-stages">${SUBSCRIPTION_STAGES.map((stage, index) => `<li class="sub-stage ${stage.tone}"><div class="sub-stage-head"><span class="sub-step">${index + 1}</span><strong>${esc(stage.label)}</strong><span class="small">${esc(stage.hint)}</span></div>
      <div class="sub-cards">${stage.items.map(item => { const tool = PREP_TOOLS[item.id]; return `<article class="sub-card"><div class="sub-card-head"><h4>${esc(tool.name)}</h4><span class="tc-price ${priceClass(tool.price)}">${esc(tool.price)}</span></div>
        ${tool.note ? `<p class="small">${esc(tool.note)}</p>` : ''}<p class="sub-role"><b>하는 일</b>${esc(item.role)}</p><p class="sub-up"><b>유료로 바꾸면</b>${esc(item.upgrade)}</p>
        <div class="tp-platforms">${pf(item.id)}</div>${tool.links.length ? `<p class="sub-links">${tool.links.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`).join(' · ')}</p>` : ''}</article>`; }).join('')}</div></li>`).join('')}</ol></div>`;
}

function toolPrepTable() {
  const ready = toolReady();
  const rows = Object.entries(PREP_TOOLS).map(([id, tool]) => {
    const uses = Object.entries(PLATFORM_TOOLS).filter(([, list]) => list.some(([tid]) => tid === id)).map(([name, list]) => ({ name, must: list.find(([tid]) => tid === id)[1] }));
    return { id, tool, uses, must: uses.some(u => u.must) };
  });
  const order = { '유료':0, '부분 유료':1, '무료':2 };
  rows.sort((a, b) => (b.must - a.must) || (order[a.tool.price] - order[b.tool.price]) || (b.uses.length - a.uses.length));
  const paidCount = rows.filter(r => r.tool.price !== '무료').length;
  const done = rows.filter(r => ready[r.id]).length;
  return `<section class="tool-prep" aria-labelledby="toolPrepTitle">
    <div class="sectionhead"><h2 id="toolPrepTitle">🧾 필요한 프로그램 · 구독 준비표</h2><span class="small" id="toolPrepCount">준비 ${done} / ${rows.length}</span></div>
    <p class="tp-lead"><b>최소 시작 구성</b> 원고 작성 AI 1개만 유료로 쓰면 6개 플랫폼 모두 시작할 수 있습니다. 나머지는 무료로 시작하고, 한도가 막힐 때 유료로 올리세요. 결제가 생길 수 있는 프로그램은 ${paidCount}개입니다.</p>
    ${subscriptionRoles()}
    <h3 class="tp-subhead">📋 전체 프로그램 체크리스트</h3>
    <div class="tp-wrap"><table class="tp-table"><thead><tr><th scope="col">준비</th><th scope="col">프로그램</th><th scope="col">어느 플랫폼에</th><th scope="col">용도</th><th scope="col">요금</th><th scope="col">가입·요금 확인</th></tr></thead><tbody>
    ${rows.map(({ id, tool, uses, must }) => `<tr class="${ready[id] ? 'is-ready' : ''}"><td><input type="checkbox" data-tool-ready="${id}" ${ready[id] ? 'checked' : ''} aria-label="${esc(tool.name)} 준비됨"></td>
      <th scope="row">${esc(tool.name)}${must ? '<span class="tp-must">필수</span>' : ''}${tool.note ? `<small>${esc(tool.note)}</small>` : ''}</th>
      <td><div class="tp-platforms">${uses.map(u => `<span class="tp-pf ${u.must ? '' : 'opt'}" style="--pc:${platformColor(u.name)}">${esc(u.name)}</span>`).join('')}</div></td>
      <td>${esc(tool.use)}</td><td><span class="tc-price ${priceClass(tool.price)}">${esc(tool.price)}</span></td>
      <td>${tool.links.length ? tool.links.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`).join('<br>') : '<span class="small">설치되어 있음</span>'}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="small">요금과 무료 범위는 자주 바뀝니다. 결제 전에 링크에서 확인하세요. 플랫폼 이름이 흐리게 보이면 그 플랫폼에서는 선택 사항입니다. 준비 체크는 이 브라우저에만 저장됩니다.</p>
  </section>`;
}

document.addEventListener('change', event => {
  const box = event.target.closest?.('input[data-tool-ready]');
  if (!box) return;
  const ready = toolReady();
  if (box.checked) ready[box.dataset.toolReady] = true; else delete ready[box.dataset.toolReady];
  try { localStorage.setItem(TOOL_READY_KEY, JSON.stringify(ready)); } catch (_) {}
  box.closest('[data-ready-row]')?.classList.toggle('is-ready', box.checked);
  const count = document.getElementById('toolPrepCount');
  if (count) { const paid = SUBSCRIPTION_STAGES.flatMap(st => st.items.map(it => it.id)); count.textContent = `준비 ${paid.filter(id => ready[id]).length} / ${paid.length}`; }
});

function platformOperatingGuide() {
  return `<details class="panel operating-guide" open><summary>🧭 플랫폼 운영 가이드
    <span class="guide-account-count">6개 플랫폼 · 플랫폼당 계정 1개 · 총 6개</span></summary>
    <p class="guide-intro">공통 주제와 조사 메모 하나를 바탕으로 플랫폼별 원고를 만드세요. 아래 분량은 시작용 권장안입니다.</p>
    ${toolPrepTable()}
    ${operationStackTable()}
    <div class="platform-guides">${PLATFORM_OPERATING_GUIDE.map((platform, index) => `<article class="platform-guide" style="--pc:${platformColor(platform.name)}">
      <h3>${esc(platformLabel(platform.name))} <span class="small">👤 계정 1개</span></h3><p class="small">${esc(platform.role)}</p>
      ${platformToolChips(platform.name)}
      <dl><dt>✍️ 내가 작성할 것</dt><dd>${esc(platform.write)}</dd><dt>🧰 사용할 도구</dt><dd>${esc(platform.tools)}</dd>
      <dt>🚀 올리는 곳</dt><dd>${esc(platform.publish)}</dd><dt>✅ 게시 후 확인</dt><dd>${esc(platform.check)}</dd></dl>
      <details><summary>📄 원고 틀 보기</summary><label class="small" for="platform-template-${index}">${esc(platform.name)} 원고 틀</label>
      <textarea id="platform-template-${index}" readonly>${esc(platform.example)}</textarea></details>
      ${platform.source ? `<p class="guide-source"><a href="${esc(platform.source)}" target="_blank" rel="noopener noreferrer">📚 공식 작성·게시 안내 ↗</a></p>` : ''}</article>`).join('')}</div>
    <div class="guide-tools"><h3>🧰 먼저 사용할 공통 도구</h3>
      <p>FIELDNOTE에서 주제·출처·원고를 관리하고, 평소 쓰는 원고 작성 AI 하나로 채널별 초안을 만드세요. 이미지가 필요한 블로그·Instagram에 사진이나 이미지 도구를 쓰고, YouTube·릴스 제작 때 영상 편집·자막 도구를 추가하면 됩니다.</p>
      <p>이미지 속 Grok·DeepSeek·yt-dlp는 조사와 원본 확보, Muse·Kling은 생성 영상, ElevenLabs·Whisper는 음성 작업, Playwright·FFmpeg는 제작 자동화, cron·SQLite는 지표 수집을 맡기는 구성입니다. 필요해진 작업부터 연결하세요.</p>
      <p>🔁 운영 순서 · 💡 공통 소재와 출처 → ${platformTag('네이버 블로그')} 상세 원문 → ${platformTag('Telegram')} 요약 → ${platformTag('X')} 관점과 근거 → ${platformTag('Instagram')} 카드 → ${platformTag('Threads')} 경험과 질문 → ${platformTag('YouTube')} 대본과 영상.</p>
    </div></details>`;
}


// 쇼츠 공장: 남의 경기를 자르는 게 아니라, 내 해설 롱폼 하나를 쇼츠 여러 개로 쪼개는 순서.
const SHORTS_FACTORY_STEPS = [
  { title:'장면 고르기', what:'아래 레슬링 소스 채널에서 기술 하나 또는 선수 한 명을 정하고, 분석할 장면 3~5개의 시간(타임코드)을 적습니다.', tool:'FIELDNOTE 레슬링 소스 · 검토할 영상', out:'장면 목록 + 타임코드' },
  { title:'해설 대본', what:'유튜브 주제 생성기로 대본을 만듭니다. 영상 하나에 질문 하나, 결론 하나. 쇼츠로 잘릴 걸 생각해 30~60초마다 작은 결론을 넣습니다.', tool:'FIELDNOTE 주제 생성기 + AI 채팅', out:'5~10분 분량 대본' },
  { title:'해설 롱폼 녹화', what:'내 목소리로 설명하고, 화면은 멈춤·화살표·느린 재생으로 분석합니다. 원본 장면은 한 번에 몇 초만 씁니다.', tool:'캡컷(녹음·편집) · QuickTime(화면 녹화)', out:'해설 롱폼 1개' },
  { title:'AI로 쇼츠 쪼개기', what:'롱폼을 AI 클리퍼에 넣어 쇼츠 후보를 뽑습니다. 말이 있는 영상이라 구간을 잘 고릅니다.', tool:'Vizard 무료판으로 시작 → 만족하면 OpusClip', out:'쇼츠 후보 5~10개' },
  { title:'다듬기', what:'한국어 자막 스타일, 화살표, 마무리 화면을 템플릿으로 저장해 모든 쇼츠에 똑같이 씌웁니다. 첫 3초 질문을 다시 확인합니다.', tool:'캡컷 데스크톱 · 자막이 많으면 Vrew', out:'업로드용 쇼츠' },
  { title:'검수·게시', what:'아래 확인 목록을 통과한 것만 올리고, 게시 확인 화면에 링크와 조회수·시청 지속 시간을 기록합니다.', tool:'YouTube Studio · FIELDNOTE 게시 확인', out:'게시 + 기록' },
];
const SHORTS_FACTORY_TOOLS = [
  ['Vizard','롱폼 → 쇼츠 자동 자르기','무료로 시작'],
  ['OpusClip','같은 역할, 구간 선택·바이럴 점수가 더 정교','유료 (월 구독)'],
  ['캡컷 데스크톱','자막·템플릿·최종 편집','무료 + 일부 유료'],
  ['Vrew','한국어 음성 인식 자막','무료 + 유료'],
];
const SHORTS_FACTORY_CHECKS = [
  '원본 경기 장면은 한 번에 몇 초만 썼다',
  '영상의 중심이 내 목소리 해설과 분석(멈춤·화살표)이다',
  '설명란에 원본 채널과 경기 출처를 적었다',
  '같은 원본 경기에서 쇼츠를 너무 많이 뽑지 않았다',
  '광고 채널(DopamineO 등)의 홍보 문구를 쓰지 않았다',
  '선수 이름·대회·체급 같은 사실을 원본에서 확인했다',
];

function shortsFactoryGuide() {
  return `<details class="panel shorts-factory" open><summary><span class="sf-title">🏭 쇼츠 공장 · 작업 순서</span><span class="sf-ratio">해설 롱폼 1개 → 쇼츠 5~10개</span></summary>
    <p class="sf-rule"><strong>원칙</strong> 남의 경기를 잘라 올리는 공장이 아니라, <b>내 해설 영상 하나를 쇼츠 여러 개로 쪼개는 공장</b>입니다. 경기 영상을 그대로 자르면 유튜브 ‘재사용 콘텐츠’로 수익이 막히거나 저작권 신고를 받을 수 있습니다.</p>
    <ol class="sf-steps">${SHORTS_FACTORY_STEPS.map((step, index) => `<li class="sf-step"><span class="sf-num">${String(index + 1).padStart(2, '0')}</span><h3>${esc(step.title)}</h3><p>${esc(step.what)}</p>
      <dl><dt>도구</dt><dd>${esc(step.tool)}</dd><dt>결과물</dt><dd>${esc(step.out)}</dd></dl></li>`).join('')}</ol>
    <div class="sf-bottom"><section><h3>쓰는 도구</h3><table class="sf-tools"><thead><tr><th>도구</th><th>역할</th><th>요금</th></tr></thead><tbody>
      ${SHORTS_FACTORY_TOOLS.map(([name, role, price]) => `<tr><td>${esc(name)}</td><td>${esc(role)}</td><td>${esc(price)}</td></tr>`).join('')}</tbody></table>
      <p class="small">요금과 무료 범위는 자주 바뀌니 가입할 때 확인하세요.</p></section>
      <section><h3>올리기 전 확인</h3><ul class="sf-checks">${SHORTS_FACTORY_CHECKS.map(check => `<li>${esc(check)}</li>`).join('')}</ul></section></div>
  </details>`;
}

function wrestlingPlanOverview() {
  const topics = YT_TOPICS.filter(topic => topic.ytChannel === 'yt-wrestling' && !topic.retired);
  if (!topics.some(topic => topic.id === ytTopicId)) ytTopicId = topics[0].id;
  return shortsFactoryGuide() + `<section class="panel wrestling-plan"><div class="sectionhead"><h2>🤼 레슬링 채널 · 다섯 가지 콘텐츠</h2><span class="small">유튜브 계정 1개</span></div>
    <p class="small">분류를 선택해 해당 영상의 주제와 대본을 기획하세요. 보내주시는 소스 채널과 영상도 이 다섯 분류에 맞춰 정리합니다.</p>
    <div class="wrestling-types">${topics.map((topic, index) => `<button class="wrestling-type ${ytTopicId === topic.id ? 'selected' : ''}" data-wrestling-topic="${esc(topic.id)}" aria-pressed="${ytTopicId === topic.id}"><span class="small">0${index + 1}</span><strong>${esc(topic.name)}</strong><span>${esc(topic.note)}</span></button>`).join('')}</div></section>`+wrestlingSourceLibrary();
}

document.addEventListener('click', event => {
  const button = event.target.closest('button[data-wrestling-topic]');
  if (!button || !YT_BY_ID[button.dataset.wrestlingTopic]) return;
  ytTopicId = button.dataset.wrestlingTopic;
  render();
});

const WRESTLING_SOURCES = [
  {
    id:'ncaa', name:'NCAA Championships', emoji:'🎓', url:'https://www.youtube.com/@NCAAChampionships',
    wrestlingUrl:'https://www.youtube.com/@NCAAChampionships/search?query=wrestling',
    role:'공식 대학 경기·선수 자료', topics:['yt-wrestling-highlights','yt-wrestling-athletes','yt-wrestling-technique','yt-wrestling-women'],
    note:'NCAA 공식 종합 스포츠 채널입니다. 채널 내 wrestling 검색에서 남녀 레슬링 결승전 리플레이, 개별 경기와 선수별 우승 경기 모음을 확인했습니다. 수집할 때 종목을 레슬링으로 한정합니다.',
    candidate:{title:'Gable Steveson vs. Wyatt Hendrickson: 2025 NCAA wrestling championship (285 pounds)',url:'https://www.youtube.com/watch?v=IwfUPELy6HA',topic:'yt-wrestling-highlights',angle:'결승전의 점수 흐름과 승부를 가른 교환을 검토한 뒤 하이라이트와 두 선수의 스타일을 설명할 구간을 선정합니다.'},
  },

  {
    id:'flo', name:'FloWrestling', emoji:'🏟️', url:'https://www.youtube.com/@FloWrestling',
    role:'경기·선수 자료', topics:['yt-wrestling-highlights','yt-wrestling-athletes','yt-wrestling-technique'],
    note:'홈 화면에서 대학 레슬링 경기, 축약 리플레이, 훈련, 선수 인터뷰와 다큐멘터리를 확인했습니다.',
    candidate:{title:'141 lbs Bo Bassett, Virginia Tech vs Luke Stanich, Lehigh',url:'https://www.youtube.com/watch?v=R43sT9gCvac',topic:'yt-wrestling-highlights',angle:'두 선수의 경기 흐름과 결정적 교환을 확인하고 해설할 장면을 선정합니다.'},
  },
  {
    id:'uww', name:'United World Wrestling', emoji:'🌍', url:'https://www.youtube.com/@unitedworldwrestling',
    role:'공식 국제 경기 자료', topics:['yt-wrestling-highlights','yt-wrestling-athletes','yt-wrestling-women','yt-wrestling-technique'],
    note:'국제 레슬링 연맹 공식 채널입니다. 세계선수권 경기, 하이라이트와 여자 선수 경기를 확인했습니다.',
    candidate:{title:"Manisha makes Indian women's wrestling history!",url:'https://www.youtube.com/watch?v=1vM189e8Mfk',topic:'yt-wrestling-women',angle:'선수 소개에 필요한 기록과 경기 장면을 대조한 뒤 대표 기술을 선정합니다.'},
  },
  {
    id:'cayden', name:'Cayden Henschel', emoji:'🤼', url:'https://www.youtube.com/@CaydenHenschel',
    role:'기술·입문·선수 경험', topics:['yt-wrestling-technique','yt-wrestling-athletes'],
    note:'입문 가이드, 선수와의 대결, 훈련·레슬링 경험을 다루는 영상을 확인했습니다.',
    candidate:{title:'The ULTIMATE Wrestling Beginner Guide of 2027',url:'https://www.youtube.com/watch?v=pIUdnIvCuQI',topic:'yt-wrestling-technique',angle:'입문 가이드에서 기술 하나를 골라 셋업·진입·마무리를 한국어로 설명할 구간을 검토합니다.'},
  },
  {
    id:'raf', name:'Real American Freestyle Wrestling', emoji:'🥊', url:'https://www.youtube.com/@RAFwrestling',
    role:'레슬링 경기·UFC 출신 선수 배경', topics:['yt-wrestling-highlights','yt-wrestling-athletes','yt-wrestling-ufc'],
    note:'RAF 경기와 UFC 출신 선수들의 레슬링 대결을 확인했습니다. UFC 분류에서는 선수의 레슬링 배경을 비교하는 자료로 사용하고, UFC 실전 분석에는 해당 UFC 경기 장면을 추가합니다.',
    candidate:{title:'Khamzat Chimaev vs Robbie Lawler | FULL MATCH | RAF14',url:'https://www.youtube.com/watch?v=MCgh3uIIPfQ',topic:'yt-wrestling-ufc',angle:'RAF 경기의 레슬링 동작을 먼저 검토합니다. UFC 경기에서 같은 기술을 쓴 장면을 별도로 확보한 뒤 비교 분석합니다.'},
  },
  {
    id:'sweat', name:'땀냄시', emoji:'🇰🇷', url:'https://www.youtube.com/@%EB%95%80%EB%83%84%EC%8B%9C1/shorts',
    role:'한국어 쇼츠 편집 참고', topics:['yt-wrestling-technique','yt-wrestling-women','yt-wrestling-athletes','yt-wrestling-ufc'],
    note:'격투기·레슬링 한국어 쇼츠를 확인했습니다. 제목·도입·자막·편집 구성을 참고하고, 설명할 기술과 경기 사실은 원본 자료에서 확인합니다.',
    candidate:{title:'헤비급 보디빌더에도 괴력을 보여주는 국대 여자 레슬러',url:'https://www.youtube.com/shorts/Nw6XnCZEtfM',topic:'yt-wrestling-women',angle:'여자 레슬러를 소개하는 한국어 쇼츠의 도입과 편집을 검토합니다. 실제 선수 정보와 원본 장면은 추가 확인합니다.'},
  },
  {
    id:'smesh', name:'Smesh Talk', emoji:'🦅', url:'https://www.youtube.com/@smeshtalk/shorts',
    role:'UFC 선수 훈련·스파링·일상 쇼츠', topics:['yt-wrestling-athletes','yt-wrestling-ufc'],
    note:'하빕·이슬람 마카체프·함자트·아르만 차루키안 등 UFC 선수의 훈련·스파링·일상 쇼츠를 확인했습니다(2026.11.07). 선수 캐릭터와 도입 소재로 쓰고, 기술 분석에는 실제 UFC 경기 장면을 따로 확보합니다. 재업로드 성격의 채널이라 원본 출처를 함께 확인합니다.',
    candidate:{title:'Khabib sparring with Abubakar 😳🔥',url:'https://www.youtube.com/shorts/GWSjB7mskzU',topic:'yt-wrestling-ufc',angle:'하빕의 스파링에서 테이크다운·압박 장면을 골라 실제 UFC 경기의 같은 동작과 비교합니다. 원본 영상 출처는 추가 확인합니다.'},
  },
  {
    id:'dps', name:'DPS Breakdowns', emoji:'🔬', url:'https://www.youtube.com/@DPSBreakdowns',
    role:'레슬링·주짓수 기술 분석', topics:['yt-wrestling-technique','yt-wrestling-athletes','yt-wrestling-highlights'],
    note:'레슬링·주짓수 브레이크다운 전문 채널입니다(2026.11.07 확인). NCAA·세계선수권 경기의 기술 장면 분석, 언더훅 머리 위치 같은 기술 해설, 선수별 특기 쇼츠를 확인했습니다. 기술 설명의 근거 자료로 가장 직접적입니다.',
    candidate:{title:"Brock Hardy's Inside Foot Sweep to High C at 2026 NCAAs",url:'https://www.youtube.com/watch?v=2oiEYfCLuPM',topic:'yt-wrestling-technique',angle:'NCAA 실전에서 나온 인사이드 풋 스윕 → 하이 C 연결을 단계별로 나눠 기술 하나를 설명합니다.'},
  },
  {
    id:'grappling-theory', name:'Grappling Theory', emoji:'🧠', url:'https://www.youtube.com/@GrapplingTheoryHQ',
    role:'그래플링 원리 해설', topics:['yt-wrestling-technique','yt-wrestling-ufc'],
    note:'기술 나열이 아니라 포지션이 왜 통하고 왜 무너지는지를 실제 예시로 설명하는 채널입니다(2026.11.07 확인). 테이크다운 규칙·테이크다운 방어 쇼츠가 있어 기술 설명과 MMA 연결에 씁니다. 주짓수 비중이 높으니 레슬링 주제만 골라 씁니다.',
    candidate:{title:'The Takedown Defense Everyone Is Using (And How To Beat It)',url:'https://www.youtube.com/shorts/Ls9C9xk-cOw',topic:'yt-wrestling-ufc',angle:'요즘 많이 쓰는 테이크다운 방어와 그 파훼법을 설명하고, 같은 장면이 나온 UFC 경기를 붙여 비교합니다.'},
  },
  {
    id:'qazsport', name:'QAZSPORT TV', emoji:'🇰🇿', url:'https://www.youtube.com/@QAZSPORTTV',
    wrestlingUrl:'https://www.youtube.com/@QAZSPORTTV/search?query=%D0%BA%D2%AF%D1%80%D0%B5%D1%81',
    role:'카자흐스탄 레슬링 경기 원본', topics:['yt-wrestling-highlights','yt-wrestling-athletes','yt-wrestling-women'],
    note:'카자흐스탄 국영 종합 스포츠 채널입니다(카자흐어·러시아어). 채널 내 "күрес(레슬링)" 검색에서 자유형 세계선수권 결승, 카자흐스탄 선수권·컵 결승, 여자 레슬링 결승 영상을 확인했습니다(2026.11.07). 축구 등 다른 종목이 섞여 있으니 레슬링 검색 화면으로 수집합니다.',
    candidate:{title:'Йошиносуке Аояги - Нұрқожа Қайпанов | Финал | Еркін күрес | 70 келі | Әлем чемпионаты',url:'https://www.youtube.com/watch?v=GoGd0CjOn9U',topic:'yt-wrestling-highlights',angle:'세계선수권 70kg 자유형 결승(일본 아오야기 vs 카자흐 카이파노프)의 결정적 장면을 하이라이트로 정리합니다. 선수 이름 한글 표기는 추가 확인합니다.'},
  },
  {
    id:'dopamineo', name:'DopamineO', emoji:'💪', url:'https://www.youtube.com/@DopamineO/shorts',
    role:'레슬링·유도 보강 훈련 쇼츠', topics:['yt-wrestling-technique','yt-wrestling-athletes'],
    note:'저항 밴드 브랜드 채널로, 레슬러·유도 선수의 밴드 보강 훈련 쇼츠를 올립니다(2026.11.07 확인). 훈련 장면과 도입 소재로 참고하되 제품 홍보 채널이므로 광고 문구는 쓰지 않고, 기술 설명은 다른 원본 자료로 확인합니다.',
    candidate:{title:'Practice ends. The grind doesn’t. 🤼‍♂️ #DopaBands',url:'https://www.youtube.com/shorts/M6hQGpI56fk',topic:'yt-wrestling-athletes',angle:'조회수 100만대 레슬러 훈련 쇼츠의 도입·편집 리듬을 참고합니다. 선수가 누구인지와 원본 출처는 추가 확인합니다.'},
  },
];

function wrestlingPromptSources(topicId) {
  return WRESTLING_SOURCES.filter(source=>source.topics.includes(topicId)).map(source=>({
    name:source.name,url:source.wrestlingUrl||source.url,role:source.role,note:source.note,
  }));
}

function wrestlingSourceLibrary() {
  return `<section class="panel wrestling-sources"><div class="sectionhead"><h2>📚 레슬링 소스 채널</h2><span class="small">${WRESTLING_SOURCES.length}개 채널 · 채널 화면 확인 2026.11.07</span></div>
    <p class="small">채널 설명과 노출된 영상 제목을 바탕으로 분류했습니다. 후보 영상은 원문·구간 확인을 위한 검토 단계입니다.</p>
    ${WRESTLING_SOURCES.map(source=>{
      const registered=db.ideas.some(idea=>idea.id==='wrestling-source-'+source.id);
      return `<article class="wrestling-source"><div class="actions"><h3>${source.emoji} ${esc(source.name)}</h3><span class="statuspill">${esc(source.role)}</span></div>
        <div class="source-topics">${source.topics.map(id=>`<span class="small">${esc(YT_BY_ID[id].name)}</span>`).join('')}</div>
        <p class="small">${esc(source.note)}</p>
        <details><summary>🎬 검토할 영상</summary><p><a href="${esc(source.candidate.url)}" target="_blank" rel="noopener noreferrer">${esc(source.candidate.title)} ↗</a></p><p class="small">${esc(source.candidate.angle)}</p></details>
        <div class="actions"><a class="btn" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">채널 열기 ↗</a>
        ${source.wrestlingUrl?`<a class="btn" href="${esc(source.wrestlingUrl)}" target="_blank" rel="noopener noreferrer">🤼 레슬링 영상만 보기</a>`:''}
        <button class="btn" data-wrestling-source="${source.id}" ${registered?'disabled':''}>${registered?'소재함에 등록됨':'검토 소재로 등록'}</button></div></article>`;
    }).join('')}</section>`;
}

document.addEventListener('click',event=>{
  const button=event.target.closest('button[data-wrestling-source]');
  if(!button)return;
  const source=WRESTLING_SOURCES.find(item=>item.id===button.dataset.wrestlingSource);
  if(!source||db.ideas.some(idea=>idea.id==='wrestling-source-'+source.id))return;
  const video=source.candidate;
  db.ideas.unshift({
    id:'wrestling-source-'+source.id,title:video.title,
    note:`소스 · ${source.name}\n역할 · ${source.role}\n\n기획 방향\n${video.angle}\n\n확인 메모\n${source.note}\n\n검토 단계 · 원문·편집 구간·기술명·선수 정보 확인 전`,
    sources:video.url+'\n'+source.url,preferredChannel:'youtube',ytChannel:'yt-wrestling',topicId:video.topic,
    sample:false,created:Date.now(),
  });
  log('레슬링 검토 소재 등록: '+source.name);
  persist();render();toast('검토 소재를 기획 소재함에 등록했습니다.');
});

// ===== 소재함: 플랫폼별 분류 + 플랫폼 맞춤 시작 소재 =====
const IDEA_PLATFORMS = ['YouTube', '네이버 블로그', 'X', 'Telegram', 'Instagram', 'Threads'];
const PLATFORM_FORMAT = {
  'YouTube':'30~60초 쇼츠 · 0~3초 질문 → 근거 → 결론. 해설 롱폼에서 쪼개는 방식',
  '네이버 블로그':'1,200~2,000자 상세 원문 · 소제목 3개 + 직접 경험 + 출처',
  'X':'스레드 · 첫 글 주장 1개 → 근거 2~3개 → 마지막 글 출처',
  'Telegram':'500~1,000자 · 제목 + 핵심 3줄 + 내 해석 + 원문 링크',
  'Instagram':'카드 5~7장 또는 릴스 · 1장 질문 → 근거 → 결론과 질문',
  'Threads':'200~400자 · 본 장면 → 내 생각 → 독자에게 질문',
};
const HELP_LINE = '도움 받을 곳 안내로 마무리(한국도박문제예방치유원 국번없이 1336, 정신건강위기상담 109)';
const PLATFORM_STARTERS = [
  { sid:'yt-khabib-pressure', platform:'YouTube', yt:'yt-wrestling-ufc', title:'하빕에게 등을 잡히면 왜 못 빠져나갈까', angle:'스파링 장면에서 등 뒤 압박(바디락·체중 싣기)을 멈춤 화면으로 해부하고, 실제 UFC 경기의 같은 장면과 비교한다.', hook:'0~3초 · "UFC 챔피언들도 이 자세에서 못 일어났다"', outline:['훅: 등 뒤를 잡힌 순간 멈춤 화면','근거 1: 손 위치와 체중을 싣는 방향을 화살표로','근거 2: 같은 동작이 나온 UFC 경기 장면 몇 초 [확인 필요: 경기명·라운드]','결론: 빠져나오려면 무엇이 먼저 필요한지 한 문장'], verify:['스파링 영상 원본 출처(Smesh Talk는 재업로드 채널)','UFC 경기 장면 날짜·상대 선수'], sources:'https://www.youtube.com/shorts/GWSjB7mskzU' },
  { sid:'yt-single-leg', platform:'YouTube', yt:'yt-wrestling-technique', title:'싱글렉 테이크다운 1분 정리: NCAA 결승 장면으로 보기', angle:'기술 하나만 다룬다. NCAA 실전 장면을 느린 재생으로 보여주며 진입 → 다리 잡기 → 마무리 3단계로 나눈다.', hook:'0~3초 · "레슬링에서 제일 많이 나오는 기술, 3단계면 끝"', outline:['훅: 결승 장면에서 다리를 잡는 순간','1단계 진입 · 2단계 잡기 · 3단계 마무리를 화면 위 숫자로','자주 하는 실수 하나','결론: 다음 영상 예고(방어법)'], verify:['선수 이름과 대회 연도·체급','기술 명칭 표기(싱글렉/하이 C 등)'], sources:'https://www.youtube.com/@DPSBreakdowns\nhttps://www.youtube.com/@NCAAChampionships' },
  { sid:'yt-worlds-70', platform:'YouTube', yt:'yt-wrestling-highlights', title:'세계선수권 70kg 결승, 승부를 가른 10초', angle:'경기 전체가 아니라 결정적 장면 하나를 골라 왜 점수가 났는지 설명한다.', hook:'0~3초 · "이 10초에 금메달이 갈렸다"', outline:['훅: 득점 직전 멈춤 화면','직전 움직임 두 가지를 화살표로','점수 규칙 한 줄 설명 [확인 필요: 자유형 득점 규정]','결론: 이 선수의 다음 경기 질문'], verify:['선수 이름 한글 표기','경기 연도·라운드·최종 스코어'], sources:'https://www.youtube.com/watch?v=GoGd0CjOn9U' },
  { sid:'x-loss-aversion', platform:'X', title:'손실 회피, 스레드 4개로 정리', angle:'블로그의 손실 회피 글을 짧은 주장과 근거로 쪼갠다.', hook:'첫 글 · "같은 10만 원인데 잃을 때가 두 배쯤 아프다"', outline:['첫 글: 핵심 주장 한 문장','후속 1: 일상 예시','후속 2: 연구 근거 한 줄 [확인 필요: 원 논문과 수치]','마지막 글: 한계 + 출처 링크 + "투자 권유 아님"'], verify:['인용 수치의 원 출처','블로그 원문 링크'] },
  { sid:'x-fomo-proof', platform:'X', title:'수익 인증 타임라인이 착시인 이유 3가지', angle:'생존자 편향을 코인 커뮤니티 장면으로 짧게 설명한다.', hook:'첫 글 · "내 타임라인에 손실 인증이 없는 이유"', outline:['첫 글: 착시라는 주장','후속 1~3: 생존자 편향 · 선택적 공유 · FOMO','마지막 글: 출처 + '+HELP_LINE], verify:['생존자 편향 설명 출처','상담처 운영 정보 최신 여부'] },
  { sid:'x-rate-priced-in', platform:'X', title:'금리 인하 "선반영"을 스레드 3개로', angle:'기대가 먼저 가격에 반영되는 구조를 한 장 이미지와 함께 설명한다.', hook:'첫 글 · "발표 날 시장이 반대로 움직이는 이유"', outline:['첫 글: 선반영 한 문장 정의','후속: 실제 사례 한 개 [확인 필요: 날짜와 수치]','마지막 글: 전망 아님 + 출처'], verify:['사례 날짜·정책 금리·시장 반응 수치'] },
  { sid:'tg-weekly-macro', platform:'Telegram', title:'이번 주 매크로 3줄 요약', angle:'매주 같은 틀로 보내는 정기 요약. 중요한 변화부터.', hook:'제목 · [11월 2주] 이번 주 꼭 알아둘 3가지', outline:['• 핵심 변화 1 (지표·발표 + 날짜)','• 핵심 변화 2','• 핵심 변화 3','내 생각: 왜 중요한지 두 줄','원문 링크 + "투자 권유 아님"'], verify:['모든 수치의 날짜·출처','전망을 단정하지 않았는지'] },
  { sid:'tg-sg-casino-levy', platform:'Telegram', title:'싱가포르 카지노 내국인 입장료, 3줄 정리', angle:'블로그 원문을 구독자용 요약으로 줄인다.', hook:'제목 · 싱가포르 사람은 카지노에 들어갈 때 돈을 낸다', outline:['• 제도 개요 [확인 필요: 현재 금액·대상]','• 도입 목적','• 직접 본 장면 한 줄','블로그 원문 링크'], verify:['입장료 금액과 시행 기관 공식 자료'] },
  { sid:'tg-wrestling-week', platform:'Telegram', title:'이번 주 볼 만한 레슬링·UFC 경기 3개', angle:'레슬링 소스 채널에서 고른 영상 링크 큐레이션. 유튜브 쇼츠로 이어지는 예고편 역할.', hook:'제목 · 이번 주 레슬링 볼거리 3', outline:['• 경기 1 + 한 줄 이유 + 링크','• 경기 2','• 경기 3','다음 쇼츠 예고 한 줄'], verify:['링크가 공식 채널 원본인지','선수·대회 표기'] },
  { sid:'ig-loss-card', platform:'Instagram', title:'같은 10만 원, 잃을 때 더 아픈 이유 (카드 6장)', angle:'손실 회피를 저장하고 싶은 카드로 만든다.', hook:'1장 · "10만 원 얻기 vs 10만 원 잃기, 뭐가 더 셀까?"', outline:['1장 질문','2장 일상 예시','3장 연구 한 줄 [확인 필요: 출처]','4장 투자에서 보이는 행동','5장 한계','6장 질문 + "투자 권유 아님"'], verify:['카드 글자 잘림','출처 표기 위치'] },
  { sid:'ig-app-habit', platform:'Instagram', title:'주식 앱을 끄기 어려운 이유 5가지 (카드 7장)', angle:'실시간 시세·색·알림 같은 화면 요소를 카드 하나씩.', hook:'1장 · "확인만 하려고 연 앱, 오늘 몇 번 열었나요?"', outline:['1장 질문','2~6장 요소 하나씩(시세·색·알림·순위·커뮤니티)','7장 알림 점검 질문 + '+HELP_LINE], verify:['행동 연구 출처','상담처 정보 최신 여부'] },
  { sid:'ig-women-wrestler-reel', platform:'Instagram', title:'여자 레슬러 한 명 30초 소개 (릴스)', angle:'UWW 공식 경기 장면 몇 초 + 내 내레이션으로 선수 한 명의 강점을 소개한다.', hook:'0~3초 · "남자 선수도 피하는 그립"', outline:['훅 장면 몇 초','강점 한 가지와 기록 한 줄 [확인 필요: 메달·대회]','결론 + 다음 선수 질문'], verify:['선수 기록 공식 출처','원본 장면 사용 길이'], sources:'https://www.youtube.com/@unitedworldwrestling' },
  { sid:'th-sg-lunch-money', platform:'Threads', title:'싱가포르 점심시간에 들은 돈 이야기', angle:'직접 들은 대화 한 장면으로 시작하고 일반화하지 않는다.', hook:'"오늘 점심에 동료가 한 말이 계속 생각난다"', outline:['[직접 경험: 들은 말과 장소]','처음 든 생각 → 바뀐 생각','질문: "여러분 회사에서는 돈 얘기 하시나요?"','긴 근거는 답글로'], verify:['개인 경험을 나라 전체로 일반화하지 않았는지'] },
  { sid:'th-break-even', platform:'Threads', title:'"본전만 오면 판다"고 말했던 날', angle:'본전 심리를 내 경험(또는 각색 사례라고 밝힌 이야기)으로 짧게.', hook:'"본전만 오면 판다. 그 말을 몇 번 했더라"', outline:['[직접 경험 또는 각색 사례 — 각색이면 밝히기]','그때 몰랐던 것 한 줄','질문: "여러분은 멈추는 기준이 있나요?"','답글에 '+HELP_LINE], verify:['매매 방법으로 읽히지 않는지','상담처 정보 최신 여부'] },
  { sid:'th-fx-feel', platform:'Threads', title:'해외 살면서 환율 볼 때마다 드는 생각', angle:'같은 월급이 환율에 따라 다르게 느껴지는 체감을 질문으로 연다.', hook:'"월급은 그대로인데 이번 달은 왜 가난한 느낌일까"', outline:['[직접 경험: 환율을 체감한 장면]','내 생각 한 줄','질문: "해외 사는 분들은 어떻게 관리하세요?"'], verify:['환율 수치를 쓰면 날짜·출처'] },
];
const PLATFORM_SEED_VERSION = 1;
let ideaPlatformFilter = 'all';

function platformStarterNote(s) {
  return `[플랫폼 시작 소재 · ${s.platform} · 사실 확인 전 아이디어]\n형식: ${PLATFORM_FORMAT[s.platform]}\n각도: ${s.angle}\n훅: ${s.hook}\n\n구성\n${s.outline.map(x => '- ' + x).join('\n')}\n\n확인할 것\n${s.verify.map(x => '- ' + x).join('\n')}`;
}
function ensurePlatformStarters() {
  if (!db || !Array.isArray(db.ideas) || (db.platformSeedVersion || 0) >= PLATFORM_SEED_VERSION) return;
  const have = new Set(db.ideas.map(i => i && i.id)); const base = Date.now(); let k = 0;
  for (const s of PLATFORM_STARTERS) {
    const id = 'pf-starter-' + s.sid; if (have.has(id)) continue;
    const idea = { id, title:s.title, note:platformStarterNote(s), sources:s.sources || '', platform:s.platform, sample:false, aiGenerated:false, starter:true, created:base - (k++) };
    if (s.platform === 'YouTube') { idea.preferredChannel = 'youtube'; if (s.yt) { idea.ytChannel = 'yt-wrestling'; idea.topicId = s.yt; } }
    if (s.platform === 'Instagram') idea.preferredChannel = 'insta';
    if (s.platform === '네이버 블로그') idea.preferredChannel = 'blog';
    db.ideas.push(idea);
  }
  db.platformSeedVersion = PLATFORM_SEED_VERSION;
  setTimeout(() => { try { persist(); } catch (_) {} }, 0);
}
function ideaPlatform(i) {
  if (i.platform && IDEA_PLATFORMS.includes(i.platform)) return i.platform;
  if (String(i.id || '').startsWith('wrestling-source-') || i.id === 'shorts-first-debate' || i.preferredChannel === 'youtube' || i.ytChannel) return 'YouTube';
  if (i.preferredChannel === 'insta') return 'Instagram';
  if (i.preferredChannel === 'blog' || i.naverCategory) return '네이버 블로그';
  return '미분류';
}
function ideaPlatformColor(i) { const p = ideaPlatform(i); return p === '미분류' ? '#626c78' : platformColor(p); }
function ideaPlatformPicker(i) {
  const cur = ideaPlatform(i);
  return `<label class="idea-pf-pick" style="--pc:${ideaPlatformColor(i)}"><span>플랫폼</span><select data-idea-platform-set="${esc(i.id)}" aria-label="${esc(i.title)} 플랫폼">${[...IDEA_PLATFORMS, '미분류'].map(p => `<option ${p === cur ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select></label>`;
}
function platformIdeaBoard(card) {
  ensurePlatformStarters();
  const groups = [...IDEA_PLATFORMS, '미분류'].map(p => ({ p, list: db.ideas.filter(i => ideaPlatform(i) === p) }));
  const total = db.ideas.length;
  const bar = `<div class="idea-pf-bar" role="tablist" aria-label="플랫폼별 소재"><button class="idea-pf-tab ${ideaPlatformFilter === 'all' ? 'active' : ''}" data-idea-platform="all">전체 <b>${total}</b></button>${groups.filter(g => g.p !== '미분류' || g.list.length).map(g => `<button class="idea-pf-tab ${ideaPlatformFilter === g.p ? 'active' : ''}" style="--pc:${g.p === '미분류' ? '#8b929e' : platformColor(g.p)}" data-idea-platform="${esc(g.p)}">${esc(g.p)} <b>${g.list.length}</b></button>`).join('')}</div>`;
  const shown = groups.filter(g => g.list.length && (ideaPlatformFilter === 'all' || ideaPlatformFilter === g.p));
  if (!total) return bar + '<div class="panel empty">새 소재 버튼으로 첫 경험을 기록하세요.</div>';
  return bar + shown.map(g => `<section class="idea-pf-group" style="--pc:${g.p === '미분류' ? '#8b929e' : platformColor(g.p)}"><div class="idea-pf-head"><h2>${esc(g.p)}</h2><span class="small">${g.list.length}개${PLATFORM_FORMAT[g.p] ? ' · ' + esc(PLATFORM_FORMAT[g.p]) : ''}</span></div><div class="idea-grid">${g.list.map(card).join('')}</div></section>`).join('');
}
document.addEventListener('click', event => {
  const tab = event.target.closest('button[data-idea-platform]');
  if (!tab) return;
  ideaPlatformFilter = tab.dataset.ideaPlatform; render();
});
document.addEventListener('change', event => {
  const sel = event.target.closest?.('select[data-idea-platform-set]');
  if (!sel) return;
  const idea = db.ideas.find(i => i.id === sel.dataset.ideaPlatformSet); if (!idea) return;
  if (sel.value === '미분류') delete idea.platform; else idea.platform = sel.value;
  persist(); render();
});

// ===== 기획 화면 단순화: 플랫폼 하나 = ① 주제 ② 제작 방법 ③ 잘 만드는 법 =====
const PLATFORM_PLAYBOOK = {
  'YouTube': { role:'레슬링 해설 쇼츠', make:['레슬링 소스에서 분석할 장면 3~5개 고르기','🔎 자료조사 프롬프트로 선수·기록·규정 출처 확인','질문 하나·결론 하나로 해설 대본 쓰기','내 목소리로 해설 영상(5~10분) 녹화','Vizard·OpusClip으로 쇼츠 쪼개기 → 캡컷 자막 템플릿','YouTube Studio에 업로드'], good:['첫 3초에 질문이나 결정적 장면','원본 경기는 몇 초만, 중심은 내 해설','자막은 크게, 화면 위쪽 중앙','끝은 다음 영상으로 이어지는 질문'], metric:'시청 지속 시간' },
  '네이버 블로그': { role:'검색으로 찾아오는 상세 원문', make:['독자가 검색할 질문을 제목으로','FIELDNOTE 블로그 원고: 소제목 3개 + 직접 경험 + 출처','직접 찍은 사진 또는 Canva 설명 이미지','네이버 에디터에 붙이고 카테고리 지정'], good:['제목에 검색어를 그대로','첫 문단에 답부터','직접 찍은 사진 1장 이상','출처와 확인 날짜 표기'], metric:'검색 유입어' },
  'X': { role:'관점과 근거를 빠르게', make:['블로그·영상에서 주장 하나 뽑기','첫 글 주장 → 근거 2~3개 → 출처 순 스레드','필요하면 설명 이미지 한 장','X에서 게시'], good:['첫 글만 읽어도 이해되게','글 하나에 생각 하나','숫자와 출처로 신뢰','마지막 글에 블로그 링크'], metric:'북마크·프로필 방문' },
  'Telegram': { role:'구독자용 정기 요약', make:['이번 주 소재 3개 고르기','제목 + 핵심 3줄 + 내 해석 + 원문 링크','Telegram 데스크톱으로 채널 게시'], good:['매주 같은 요일, 같은 틀','중요한 변화부터','링크는 원문으로','길어지면 블로그로 보내기'], metric:'조회·전달 수' },
  'Instagram': { role:'저장하고 싶은 카드·릴스', make:['주제를 질문 하나로 바꾸기','카드 5~7장 문구: 질문 → 근거 → 결론','Canva 템플릿에 얹기 (릴스는 캡컷)','앱 또는 Meta Business Suite로 게시'], good:['1장에 질문을 크게','한 장에 한 문장','같은 템플릿·색으로 통일','마지막 장은 저장을 부르는 질문'], metric:'저장·공유 수' },
  'Threads': { role:'경험과 질문으로 대화', make:['직접 본 장면 하나 고르기','장면 → 내 생각 → 질문, 200~400자','긴 근거는 답글로','Threads에 게시'], good:['1인칭 경험으로 시작','결론보다 질문으로 끝내기','답글에 빨리 답하기','한 사람 경험을 일반화하지 않기'], metric:'답글 수' },
};
let studioPlatform = 'YouTube';

function platformStudio() {
  ensurePlatformStarters();
  const list = p => db.ideas.filter(i => ideaPlatform(i) === p);
  const tabs = [...IDEA_PLATFORMS, ...(list('미분류').length ? ['미분류'] : [])];
  if (!tabs.includes(studioPlatform)) studioPlatform = 'YouTube';
  const p = studioPlatform, pc = p === '미분류' ? '#8b929e' : platformColor(p), book = PLATFORM_PLAYBOOK[p], ideas = list(p);
  const tools = (PLATFORM_TOOLS[p] || []).filter(([, must]) => must).map(([id]) => PREP_TOOLS[id].name);
  const bar = `<div class="ps-tabs" role="tablist" aria-label="플랫폼">${tabs.map(t => `<button role="tab" aria-selected="${t === p}" class="ps-tab ${t === p ? 'active' : ''}" style="--pc:${t === '미분류' ? '#8b929e' : platformColor(t)}" data-studio-platform="${esc(t)}">${esc(t)}<b>${list(t).length}</b></button>`).join('')}</div>`;
  const topic = i => `<li class="ps-topic"><details><summary><span class="ps-topic-title">${esc(i.title)}</span>${i.sample ? '<span class="sampletag">예시</span>' : ''}</summary>
    <p class="ps-note">${esc(i.note)}</p>${ideaPlatformPicker(i)}
    <div class="actions"><button class="btn primary" data-create="${esc(i.id)}">원고 만들기</button><button class="btn ghost" data-idea-edit="${esc(i.id)}">수정</button><button class="btn ghost danger" data-idea-delete="${esc(i.id)}" aria-label="소재 삭제">×</button></div></details></li>`;
  return bar + `<section class="ps-board" style="--pc:${pc}">
    <header class="ps-head"><h2>${esc(p)}</h2>${book ? `<span>${esc(book.role)}</span>` : '<span>플랫폼을 정해 주세요</span>'}</header>
    <div class="ps-cols">
      <div class="ps-col"><h3><span>①</span> 주제 <em>${ideas.length}</em></h3>${ideas.length ? `<ul class="ps-topics">${ideas.map(topic).join('')}</ul>` : '<p class="small">아직 주제가 없습니다. 위의 ＋ 새 소재로 추가하세요.</p>'}</div>
      ${book ? `<div class="ps-col"><h3><span>②</span> 제작 방법</h3><ol class="ps-steps">${book.make.map(s => `<li>${esc(s)}</li>`).join('')}</ol>
        <p class="ps-tools"><b>필요한 프로그램</b>${tools.map(esc).join(' · ')}</p>${(() => { const g = PLATFORM_OPERATING_GUIDE.find(x => x.name === p); return g ? `<details class="ps-template"><summary>📄 원고 틀 보기</summary><textarea readonly aria-label="${esc(p)} 원고 틀">${esc(g.example)}</textarea></details>` : ''; })()}${p === 'YouTube' ? '<button class="btn ghost" data-workflow="import">쇼츠 백업 가져오기</button>' : ''}</div>
      <div class="ps-col"><h3><span>③</span> 잘 만드는 법</h3><ul class="ps-good">${book.good.map(s => `<li>${esc(s)}</li>`).join('')}</ul>
        <p class="ps-metric"><b>올린 뒤 볼 숫자</b>${esc(book.metric)}</p></div>` : ''}
    </div></section>`;
}
document.addEventListener('click', event => {
  const tab = event.target.closest('button[data-studio-platform]');
  if (!tab) return;
  studioPlatform = tab.dataset.studioPlatform; render();
});


// ===== 작업 화면: 프로그램 준비 (구독 순서 + 무료 목록) 한 블록 =====
function programPrep() {
  const ready = toolReady();
  const paid = SUBSCRIPTION_STAGES.flatMap(st => st.items.map(it => it.id));
  const free = Object.entries(PREP_TOOLS).filter(([id, t]) => t.price === '무료').map(([, t]) => t.name);
  const pf = id => Object.entries(PLATFORM_TOOLS).filter(([, list]) => list.some(([tid]) => tid === id)).map(([name]) => `<span class="tp-pf" style="--pc:${platformColor(name)}">${esc(name)}</span>`).join('');
  return `<details class="panel program-prep"><summary><span class="pp-title">🧾 프로그램 준비</span><span class="small" id="toolPrepCount">준비 ${paid.filter(id => ready[id]).length} / ${paid.length}</span><span class="small pp-hint">처음엔 원고 AI 하나만 결제 · 나머지는 막힐 때</span></summary>
    <ol class="sub-stages">${SUBSCRIPTION_STAGES.map((stage, index) => `<li class="sub-stage ${stage.tone}"><div class="sub-stage-head"><span class="sub-step">${index + 1}</span><strong>${esc(stage.label)}</strong><span class="small">${esc(stage.hint)}</span></div>
      <div class="sub-cards">${stage.items.map(item => { const tool = PREP_TOOLS[item.id]; return `<article class="sub-card ${ready[item.id] ? 'is-ready' : ''}" data-ready-row><div class="sub-card-head"><label class="pp-check"><input type="checkbox" data-tool-ready="${item.id}" ${ready[item.id] ? 'checked' : ''}><h4>${esc(tool.name)}</h4></label><span class="tc-price ${priceClass(tool.price)}">${esc(tool.price)}</span></div>
        ${tool.note ? `<p class="small">${esc(tool.note)}</p>` : ''}<p class="sub-role"><b>하는 일</b>${esc(item.role)}</p><p class="sub-up"><b>유료로 바꾸면</b>${esc(item.upgrade)}</p>
        <div class="tp-platforms">${pf(item.id)}</div>${tool.links.length ? `<p class="sub-links">${tool.links.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`).join(' · ')}</p>` : ''}</article>`; }).join('')}</div></li>`).join('')}</ol>
    <p class="pp-free"><b>무료 · 가입만 하면 됨</b>${free.map(esc).join(' · ')}</p>
  </details>`;
}


// ===== 플랫폼 완전 분리: 사이드바 = 공통 원리 1개 + 플랫폼 6개 =====
const PF_KEY = { 'YouTube':'youtube', '네이버 블로그':'blog', 'X':'x', 'Telegram':'telegram', 'Instagram':'insta', 'Threads':'threads' };
const PF_NAME = Object.fromEntries(Object.entries(PF_KEY).map(([n, k]) => [k, n]));
function ideaChannel(i) { return PF_KEY[ideaPlatform(i)] || i.preferredChannel || ''; }
function platformTemplate(c) { const g = PLATFORM_OPERATING_GUIDE.find(x => x.name === PF_NAME[c]); return g ? g.example : ''; }

// 자료조사 스킬(source-check-research, sphereai.work 무료 스킬)을 주제별 프롬프트로
function researchPrompt(i) {
  const today = new Date().toISOString().slice(0, 10);
  return `아래 주제로 유튜브 영상 대본에 쓸 자료조사를 해 줘. 조사 날짜: ${today}

주제: ${i.title}
메모:
${i.note || '-'}
${i.sources ? '\n이미 가진 링크:\n' + i.sources + '\n' : ''}
진행 순서
1. 이 주제를 답할 수 있는 작은 질문 3~6개로 쪼개고, 질문마다 어떤 자료가 답이 되는지(공식 기록, 대회 결과, 규정, 인터뷰) 적기
2. 한국어와 영어로 각각, 검색어를 바꿔 최소 3번 검색. 날짜 없는 글은 오래된 것으로 본다
3. 출처 등급 표시 — A 원자료(공식 기록·연맹 규정·원본 영상) / B 언론·전문 매체 / C 블로그·커뮤니티·SNS(경향만, 수치 인용 금지)
4. 선수 이름·기록·날짜·점수 같은 핵심 사실은 서로 다른 출처 2곳 이상에서 교차 확인. 출처끼리 다르면 둘 다 적기
5. 출처 없는 숫자는 채우지 말고 "확인 못 함"으로 표시. 추측은 "추측"이라고 쓰기

출력 형식
## 결론 (3줄 이내)
## 핵심 사실
| 사실 | 출처 | 등급 |
## 서로 다르게 나온 내용
## 확인 못 한 것 / 더 알아야 할 것
## 영상 대본에 바로 쓸 수 있는 것 (A·B 등급만)
## 조사 방법 (검색어, 날짜 범위)
## 출처 목록`;
}
document.addEventListener('click', async event => {
  const b = event.target.closest('button[data-research-copy]');
  if (!b) return;
  const i = db.ideas.find(x => x.id === b.dataset.researchCopy); if (!i) return;
  const ok = await copyText(researchPrompt(i));
  toast(ok ? '자료조사 프롬프트를 복사했어요. Claude 채팅에 붙여 넣으세요.' : '복사에 실패했어요.');
});
function researchBlock() {
  return `<details class="panel pf-extra pf-research"><summary>🔎 자료조사 방법 <span class="small">출처 확인 자료조사 스킬 · 주제마다 '자료조사 프롬프트' 버튼</span></summary>
    <ol class="pf-research-steps"><li><b>질문 쪼개기</b>주제를 작은 질문 3~6개로</li><li><b>검색</b>한국어·영어, 검색어 바꿔 3번 이상</li><li><b>등급 표시</b>A 원자료 · B 언론 · C 개인 의견</li><li><b>교차 확인</b>핵심 사실은 출처 2곳 이상</li><li><b>모르는 것 표시</b>출처 없으면 "확인 못 함"</li></ol>
    <p class="small">① 주제를 펼쳐 '🔎 자료조사 프롬프트'를 누르면 이 순서와 출력 형식이 담긴 요청문이 복사됩니다. Claude 채팅에 붙여 넣고, 결과의 A·B 등급 사실만 대본에 쓰세요. 스킬 설치됨 — Claude Code: <b>/source-check-research 주제</b> 또는 "○○ 자료조사해줘" · claude.ai: 설정 → 기능 → 스킬에 바탕화면 CLAUDE 폴더의 source-check-research.zip 업로드 (원본: sphereai.work)</p></details>`;
}

function platformPage(c) {
  ensurePlatformStarters();
  const p = PF_NAME[c], pc = platformColor(p), book = PLATFORM_PLAYBOOK[p], guide = PLATFORM_OPERATING_GUIDE.find(x => x.name === p);
  const ideas = db.ideas.filter(i => ideaPlatform(i) === p);
  const posts = db.posts.filter(x => x.channel === c).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const n = st => posts.filter(x => x.status === st).length;
  const ready = toolReady();
  const roleOf = Object.fromEntries(SUBSCRIPTION_STAGES.flatMap(st => st.items.map(it => [it.id, { ...it, stage: st.label }])));
  const tools = (PLATFORM_TOOLS[p] || []).filter(([id]) => id !== 'ai');
  const topic = i => `<li class="ps-topic"><details><summary><span class="ps-topic-title">${esc(i.title)}</span>${i.sample ? '<span class="sampletag">예시</span>' : ''}</summary>
    <p class="ps-note">${esc(i.note)}</p>${ideaPlatformPicker(i)}
    <div class="actions"><button class="btn primary" data-create="${esc(i.id)}">원고 만들기</button>${c === 'youtube' ? `<button class="btn" data-yp-pick="${esc(i.id)}">▶ 제작 라인에서 작업</button>` : ''}<button class="btn ghost" data-idea-edit="${esc(i.id)}">수정</button><button class="btn ghost danger" data-idea-delete="${esc(i.id)}" aria-label="소재 삭제">×</button></div></details></li>`;
  const hero = `<section class="pf-hero" style="--pc:${pc}"><div class="pf-hero-main"><div class="eyebrow">PLATFORM</div><h1>${esc(platformLabel(p))}</h1><p>${esc(book.role)}</p></div>
    <dl class="pf-stats"><div><dt>주제</dt><dd>${ideas.length}</dd></div><div><dt>작성 중</dt><dd>${n('draft')}</dd></div><div><dt>검수 대기</dt><dd class="orange">${n('review')}</dd></div><div><dt>승인</dt><dd class="green">${n('approved')}</dd></div></dl>
    <button class="btn primary" data-action="newIdea">＋ 새 주제</button></section>`;
  const board = `<section class="ps-board" style="--pc:${pc}"><div class="ps-cols">
    <div class="ps-col"><h3><span>①</span> 주제 <em>${ideas.length}</em></h3>${ideas.length ? `<ul class="ps-topics">${ideas.map(topic).join('')}</ul>` : '<p class="small">아직 주제가 없습니다. ＋ 새 주제로 추가하세요.</p>'}</div>
    <div class="ps-col"><h3><span>②</span> 제작 방법</h3><ol class="ps-steps">${book.make.map(x => `<li>${esc(x)}</li>`).join('')}</ol>
      ${guide ? `<details class="ps-template"><summary>📄 원고 틀 보기</summary><textarea readonly aria-label="${esc(p)} 원고 틀">${esc(guide.example)}</textarea></details>` : ''}</div>
    <div class="ps-col"><h3><span>③</span> 잘 만드는 법</h3><ul class="ps-good">${book.good.map(x => `<li>${esc(x)}</li>`).join('')}</ul>
      <p class="ps-metric"><b>올린 뒤 볼 숫자</b>${esc(book.metric)}</p>${guide ? `<p class="ps-metric"><b>올리는 곳</b>${esc(guide.publish)}</p>` : ''}</div>
  </div></section>`;
  const postRows = posts.map(x => `<div class="draftitem">${icon(c)}<div class="grow"><h3>${esc(x.title)}${sample(x)}</h3><div class="small">${c === 'youtube' && ytValidCh(x.ytChannel) ? esc(ytChName(x.ytChannel)) + ' · ' : ''}${x.body.length.toLocaleString()}자 · ${relative(x.updated)} 수정</div></div>${badge(x)}<div class="actions"><button class="btn" data-edit="${esc(x.id)}">원고 열기 ↗</button><button class="btn ghost" data-export="${esc(x.id)}" aria-label="내보내기">↓</button></div></div>`).join('');
  const drafts = `<section class="pf-section"><div class="sectionhead"><div class="left"><h2><span class="pf-num" style="--pc:${pc}">④</span> 원고</h2><span class="number">${posts.length}</span></div><span class="small">주제에서 '원고 만들기'를 누르면 여기에 쌓입니다</span></div>
    <div class="draft-list">${postRows || '<div class="panel empty">아직 원고가 없습니다.</div>'}</div></section>`;
  const toolCards = tools.map(([id, must]) => { const t = PREP_TOOLS[id], r = roleOf[id]; return `<article class="pf-tool ${ready[id] ? 'is-ready' : ''}" data-ready-row>
    <div class="sub-card-head"><label class="pp-check"><input type="checkbox" data-tool-ready="${id}" ${ready[id] ? 'checked' : ''}><h4>${esc(t.name)}</h4></label><span class="tc-price ${priceClass(t.price)}">${esc(t.price)}</span></div>
    <p class="pf-tool-tag ${must ? 'must' : ''}">${must ? '필수' : '있으면 좋음'}${r ? ' · 결제 시점: ' + esc(r.stage) : ''}</p>
    <p>${esc(r ? r.role : t.use)}</p>${t.links.length ? `<p class="sub-links">${t.links.map(([label, url]) => `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)} ↗</a>`).join(' · ')}</p>` : ''}</article>`; }).join('');
  const toolSec = `<section class="pf-section"><div class="sectionhead"><h2><span class="pf-num" style="--pc:${pc}">⑤</span> 이 플랫폼 프로그램</h2><button class="linkbtn" data-view="common">원고 AI 등 공통 프로그램 →</button></div><div class="pf-tools">${toolCards}</div></section>`;
  if (c === 'youtube') {
    const ytBoard = board.replace(/<div class="ps-col"><h3><span>②<\/span> 제작 방법<\/h3>[\s\S]*?<\/div>\s*<div class="ps-col"><h3><span>③/, '<div class="ps-col"><h3><span>③').replace('<div class="ps-cols">', '<div class="ps-cols ps-cols2">');
    const src = `<details class="panel pf-extra" id="ytSources"><summary>📚 레슬링 소스 채널 <span class="small">${WRESTLING_SOURCES.length}곳 · 소스 다운로드 단계에서 씀</span></summary>${wrestlingSourceLibrary()}<div class="actions" style="margin-top:12px"><button class="btn ghost" data-workflow="import">쇼츠 백업 가져오기</button></div></details>`;
    return hero + ytPipeline() + ytBoard + src + drafts + toolSec;
  }
  return hero + board + drafts + toolSec;
}

const COMMON_FLOW = [
  ['주제 기록', '직접 본 장면·경험을 해당 플랫폼 화면의 ① 주제에 적습니다.'],
  ['원고 틀', "주제에서 '원고 만들기' → 그 플랫폼 원고 틀이 자동으로 들어갑니다."],
  ['초안', '원고 작성 AI로 초안. 경험과 해석은 직접 씁니다.'],
  ['검수 · 승인', '아래 검수 3가지를 체크하고 승인합니다.'],
  ['게시', "플랫폼에서 직접 올리고 '게시 확인'에 링크를 남깁니다."],
  ['숫자 기록', "플랫폼마다 정해 둔 '올린 뒤 볼 숫자'를 봅니다."],
];
const COMMON_RULES = [
  '직접 경험이 중심, 외부 자료는 근거로만',
  '사실·인용·내 해석을 구분하고 출처와 확인 날짜를 남긴다',
  '출처 등급: A 원자료 > B 언론·전문 매체 > C 개인 의견(수치 인용 금지)',
  '핵심 숫자·날짜는 출처 2곳 이상 교차 확인, 못 하면 [확인 필요]로 남기고 게시 전 지운다',
  '한 사람·한 장면을 나라나 집단 전체로 일반화하지 않는다',
  '돈·투자 이야기는 "투자 권유 아님", 전망을 단정하지 않는다',
  '도박·손실 이야기는 끝에 도움 받을 곳 안내 (1336 · 109)',
  '남의 영상·사진은 몇 초·한 장만, 원본 출처와 사용 권리 확인',
];
const COMMON_CHAIN = ['네이버 블로그', 'Telegram', 'X', 'Instagram', 'Threads', 'YouTube'];
const COMMON_CHAIN_NOTE = { '네이버 블로그':'상세 원문', 'Telegram':'요약', 'X':'관점과 근거', 'Instagram':'카드', 'Threads':'경험과 질문', 'YouTube':'대본과 영상' };

function commonPage() {
  ensurePlatformStarters();
  const cards = IDEA_PLATFORMS.map(p => { const c = PF_KEY[p], posts = db.posts.filter(x => x.channel === c), rv = posts.filter(x => x.status === 'review').length;
    return `<button class="cp-pf" style="--pc:${platformColor(p)}" data-view="${c}"><span class="cp-pf-name">${esc(platformLabel(p))}</span><span class="cp-pf-role">${esc(PLATFORM_PLAYBOOK[p].role)}</span><span class="cp-pf-nums">주제 ${db.ideas.filter(i => ideaPlatform(i) === p).length} · 원고 ${posts.length}${rv ? ` · <b>검수 대기 ${rv}</b>` : ''}</span></button>`; }).join('');
  const unsorted = db.ideas.filter(i => ideaPlatform(i) === '미분류');
  return head('공통 원리', '모든 플랫폼에 똑같이 적용되는 것만 모았습니다. 플랫폼별 작업은 왼쪽 메뉴에서 하세요.')
    + `<div class="cp-pfs">${cards}</div>`
    + (unsorted.length ? `<details class="panel cp-unsorted"><summary>플랫폼 미지정 주제 ${unsorted.length}개 · 플랫폼을 정해 주세요</summary><ul class="ps-topics">${unsorted.map(i => `<li class="ps-topic cp-unsorted-row"><span class="ps-topic-title">${esc(i.title)}</span>${ideaPlatformPicker(i)}</li>`).join('')}</ul></details>` : '')
    + `<div class="cp-grid">
      <section class="panel cp-block"><h2>작업 순서 <span class="small">모든 플랫폼 동일</span></h2><ol class="cp-flow">${COMMON_FLOW.map(([t, d]) => `<li><b>${esc(t)}</b><span>${esc(d)}</span></li>`).join('')}</ol></section>
      <section class="panel cp-block"><h2>공통 원칙</h2><ul class="cp-rules">${COMMON_RULES.map(r => `<li>${esc(r)}</li>`).join('')}</ul></section>
      <section class="panel cp-block"><h2>발행 전 검수 3가지</h2><ol class="cp-checks">${checks.map(t => `<li>${esc(t)}</li>`).join('')}</ol><p class="small">원고 편집 화면에서 세 개를 모두 체크해야 승인됩니다.</p></section>
      <section class="panel cp-block"><h2>소재 하나 → 여섯 플랫폼</h2><ol class="cp-chain">${COMMON_CHAIN.map(p => `<li style="--pc:${platformColor(p)}"><b>${esc(p)}</b><span>${esc(COMMON_CHAIN_NOTE[p])}</span></li>`).join('')}</ol><p class="small">조사와 출처는 한 번만 하고, 형식만 플랫폼에 맞게 바꿉니다.</p></section>
    </div>`
    + `<section class="pf-section"><div class="sectionhead"><h2>공통 프로그램</h2><span class="small">모든 플랫폼이 같이 쓰는 것</span></div>
      <div class="cp-common-tools"><article class="pf-tool"><div class="sub-card-head"><h4>${esc(PREP_TOOLS.ai.name)}</h4><span class="tc-price part">부분 유료</span></div><p class="pf-tool-tag must">필수 · 지금 결제</p><p>${esc(SUBSCRIPTION_STAGES[0].items[0].role)}</p><p class="sub-links">${PREP_TOOLS.ai.links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(l)} ↗</a>`).join(' · ')}</p></article>
      <article class="pf-tool"><div class="sub-card-head"><h4>FIELDNOTE</h4><span class="tc-price free">무료</span></div><p class="pf-tool-tag must">필수</p><p>주제·원고·검수·게시 기록을 한곳에서 관리합니다. 지금 보고 있는 이 사이트입니다.</p></article></div>
      ${programPrep()}</section>`
    + `<div class="activity-wrap"><div class="sectionhead"><h2>최근 활동</h2><span class="small">이 브라우저의 기록</span></div><div class="panel">${db.activity.slice(0, 3).map(a => `<div class="activity"><span class="dot"></span><span>${esc(a.text)}</span><time>${relative(a.at)}</time></div>`).join('') || '<div class="small">활동이 없습니다.</div>'}</div></div>`;
}


// ===== YouTube 제작 라인: 자료조사 → 소스 다운로드 → 편집 → 업로드 (단계마다 스킬 바로 쓰기) =====
let ytPipe = { ideaId: '', url: '', ranges: '' };
function ytFolder(t) { return String(t || '새 주제').replace(/[\\/:*?"<>|#%&{}$!'`@+=]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || '새 주제'; }
function ytPipeIdea() { const list = db.ideas.filter(i => ideaPlatform(i) === 'YouTube'); return list.find(i => i.id === ytPipe.ideaId) || list[0] || null; }
function ytFirstUrl(i) { const m = String(i?.sources || '').match(/https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w-]+[^\s]*/); return m ? m[0] : ''; }
function ytRanges() { return ytPipe.ranges.split(/[,\s]+/).map(x => x.trim()).filter(x => /^\d{1,2}(:\d{2}){1,2}-\d{1,2}(:\d{2}){1,2}$/.test(x)); }
function ytPipeText(kind) {
  const i = ytPipeIdea(), title = i ? i.title : '주제', dir = ytFolder(title), url = ytPipe.url || '<영상 URL>', rg = ytRanges();
  if (kind === 'research') return `/source-check-research ${title} — 레슬링 해설 쇼츠 대본용. 선수·대회·기록·규정 위주로, 결과를 ~/Movies/FIELDNOTE/${dir}/research.md 로 저장해줘`;
  if (kind === 'research-chat') return i ? researchPrompt(i) : '';
  if (kind === 'download') return `/yt-source-download ${url} ${rg.length ? rg.join(' ') : '<시작-끝 예: 0:30-0:45>'} 주제:${dir}`;
  if (kind === 'download-term') return `mkdir -p ~/Movies/FIELDNOTE/"${dir}"/원본 && yt-dlp -f "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b" --merge-output-format mp4 ${(rg.length ? rg : ['0:00-0:15']).map(r => `--download-sections "*${r}"`).join(' ')} --force-keyframes-at-cuts -o ~/Movies/FIELDNOTE/"${dir}"/원본/"%(channel)s_%(id)s_%(section_start)s.%(ext)s" "${url}"`;
  if (kind === 'edit') return `/shorts-edit-kit ${dir}`;
  if (kind === 'upload') return `/yt-upload-pack ${dir}`;
  return '';
}
const YT_PIPELINE = [
  { kind:'research', title:'자료조사', skill:'source-check-research', what:'선수·대회·기록·규정을 찾아 출처 등급(A 원자료 / B 언론 / C 개인)을 붙이고, 핵심 사실은 2곳 이상에서 교차 확인합니다.', out:'research.md · 근거 표와 확인 못 한 것', tools:[], chat:true },
  { kind:'download', title:'소스 다운로드', skill:'yt-source-download', what:'필요한 장면만 구간으로 받습니다. 한 구간 15초 이하, 출처(채널·제목·URL·구간)는 sources.md에 자동으로 기록됩니다.', out:'원본/ 클립 + sources.md', tools:[['레슬링 소스 채널 11곳', '#ytSources']], inputs:true },
  { kind:'edit', title:'편집', skill:'shorts-edit-kit', what:'60초 대본 · 자막(SRT) · 컷 리스트 · 세로 9:16 러프컷을 자동으로 만들고, 캡컷에서 내 목소리와 화살표·멈춤 화면으로 마무리합니다.', out:'편집/ 대본.md · 자막.srt · 러프컷_세로.mp4', tools:[['캡컷', 'https://www.capcut.com/'], ['Vrew', 'https://vrew.ai/'], ['Vizard', 'https://vizard.ai/'], ['OpusClip', 'https://www.opus.pro/']] },
  { kind:'upload', title:'업로드', skill:'yt-upload-pack', what:'제목 3안 · 설명란(원본 출처 포함) · 해시태그 · 고정 댓글을 만들고, 확인 목록을 통과하면 YouTube Studio에 올린 뒤 게시 확인에 링크를 남깁니다.', out:'업로드/ 업로드팩.md', tools:[['YouTube Studio', 'https://studio.youtube.com/']], publish:true },
];
function ytPipeline() {
  const ideas = db.ideas.filter(i => ideaPlatform(i) === 'YouTube'), cur = ytPipeIdea();
  if (cur && !ytPipe.url) ytPipe.url = ytFirstUrl(cur);
  const sel = `<label class="yp-topic"><span>작업할 주제</span><select data-yp-idea aria-label="작업할 주제">${ideas.map(i => `<option value="${esc(i.id)}" ${cur && i.id === cur.id ? 'selected' : ''}>${esc(i.title)}</option>`).join('')}</select></label><span class="small">폴더 · ~/Movies/FIELDNOTE/<b data-yp-folder>${esc(ytFolder(cur?.title))}</b></span>`;
  const card = (st, idx) => `<li class="yp-stage"><div class="yp-head"><span class="yp-n">${String(idx + 1).padStart(2, '0')}</span><h3>${esc(st.title)}</h3></div>
    <p class="yp-what">${esc(st.what)}</p><p class="yp-out"><b>결과물</b>${esc(st.out)}</p>
    ${st.inputs ? `<div class="yp-inputs"><label>영상 URL<input class="input" data-yp-field="url" value="${esc(ytPipe.url)}" placeholder="https://www.youtube.com/watch?v=…"></label><label>구간 (쉼표로 여러 개)<input class="input" data-yp-field="ranges" value="${esc(ytPipe.ranges)}" placeholder="0:30-0:45, 1:10-1:20"></label></div>` : ''}
    <div class="yp-skill"><span class="yp-skill-name">스킬 · ${esc(st.skill)}</span><code data-yp-cmd="${st.kind}">${esc(ytPipeText(st.kind))}</code>
      <button class="btn primary" data-yp-copy="${st.kind}">Claude Code 명령 복사</button>
      ${st.chat ? '<button class="btn" data-yp-copy="research-chat">claude.ai 채팅용 복사</button>' : ''}
      ${st.inputs ? '<details class="yp-term"><summary>터미널 명령으로 직접</summary><code data-yp-cmd="download-term">' + esc(ytPipeText('download-term')) + '</code><button class="btn ghost" data-yp-copy="download-term">터미널 명령 복사</button></details>' : ''}</div>
    ${st.tools.length || st.publish ? `<div class="yp-tools">${st.tools.map(([l, u]) => u.startsWith('#') ? `<button class="linkbtn" data-yp-jump="${u.slice(1)}">${esc(l)} ↓</button>` : `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(l)} ↗</a>`).join('')}${st.publish ? '<button class="linkbtn" data-view="publish">게시 확인 →</button>' : ''}</div>` : ''}
  </li>`;
  return `<section class="yp" style="--pc:${platformColor('YouTube')}"><div class="yp-top"><h2>제작 라인 <span class="small">자료조사 → 소스 다운로드 → 편집 → 업로드</span></h2>${sel}</div>
    <ol class="yp-stages">${YT_PIPELINE.map(card).join('')}</ol>
    <p class="small yp-foot">명령을 복사해 Claude Code 새 대화에 붙여 넣으면 해당 스킬이 그 단계를 실행합니다. 네 단계가 같은 주제 폴더를 이어 씁니다. 원본 경기 장면은 한 번에 몇 초만, 영상의 중심은 내 해설입니다.</p></section>`;
}
function ytPipeRefresh() { document.querySelectorAll('[data-yp-cmd]').forEach(el => { el.textContent = ytPipeText(el.dataset.ypCmd); }); const f = document.querySelector('[data-yp-folder]'); if (f) f.textContent = ytFolder(ytPipeIdea()?.title); }
document.addEventListener('input', e => { const f = e.target.closest?.('[data-yp-field]'); if (!f) return; ytPipe[f.dataset.ypField] = f.value; ytPipeRefresh(); });
document.addEventListener('change', e => { const s = e.target.closest?.('select[data-yp-idea]'); if (!s) return; ytPipe.ideaId = s.value; ytPipe.url = ytFirstUrl(ytPipeIdea()); ytPipe.ranges = ''; render(); });
document.addEventListener('click', async e => {
  const j = e.target.closest('button[data-yp-jump]'); if (j) { const d = document.getElementById(j.dataset.ypJump); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth' }); } return; }
  const b = e.target.closest('button[data-yp-copy]'); if (!b) return;
  const ok = await copyText(ytPipeText(b.dataset.ypCopy));
  toast(ok ? (b.dataset.ypCopy === 'research-chat' ? 'claude.ai 채팅에 붙여 넣으세요.' : b.dataset.ypCopy === 'download-term' ? '터미널에 붙여 넣으세요.' : 'Claude Code 새 대화에 붙여 넣으세요.') : '복사에 실패했어요.');
});

document.addEventListener('click', e => { const b = e.target.closest('button[data-yp-pick]'); if (!b) return; ytPipe.ideaId = b.dataset.ypPick; ytPipe.url = ytFirstUrl(ytPipeIdea()); ytPipe.ranges = ''; render(); document.querySelector('.yp')?.scrollIntoView({ behavior: 'smooth' }); });
