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
  {
    id:'coach', name:'레슬링코치', emoji:'🔥', url:'https://www.youtube.com/@Wrestling_coach/shorts',
    role:'멋있는 기술 시범 · 한국어', topics:['yt-wrestling-technique','yt-wrestling-ufc'],
    note:'레슬링 기술 시범 한국어 쇼츠 채널. 태클 카운터(약 1,200만 회), 슬라이드바이 풋스윕(약 100만 회), 안다리 안아던지기(약 58만 회)처럼 기술 하나를 짧게 반복해 보여주는 영상이 잘 됩니다(2026.11.07 확인). 기술 선정·반복 편집 참고용이며, 영상을 쓸 때는 몇 초만 쓰고 채널을 표기하거나 직접 시연으로 다시 찍습니다.',
    candidate:{title:'레슬링 태클 카운터!',url:'https://www.youtube.com/shorts/eNVEKSW8Xgk',topic:'yt-wrestling-technique',angle:'조회수가 가장 높은 기술 쇼츠. 원속도 → 슬로우 → 원속도로 기술을 반복 노출하는 구성을 검토합니다.'},
  },
  {
    id:'wrestletown', name:'WrestleTownUSA', emoji:'🏋️', url:'https://www.youtube.com/@WrestletownUSA/shorts',
    role:'대학 레슬링 훈련·체력·코치 기술', topics:['yt-wrestling-technique','yt-wrestling-athletes'],
    note:'아이오와 대학 레슬링(Hawkeyes) 연습 현장, 선수 체력 서킷, Terry Brands 코치 기술 세션 쇼츠(2026.11.08 확인). 생활체육인용 체력 루틴·기술 교정 주제의 소스로 좋습니다. 영상은 몇 초만 쓰고 채널을 표기합니다.',
    candidate:{title:'Terry Brands Breaks Down How to Improve Your Wrestling',url:'https://www.youtube.com/shorts/kzj3qy5EgyM',topic:'yt-wrestling-technique',angle:'코치가 기술을 교정하는 장면. 생활체육인이 바로 가져갈 교정 포인트 하나로 해설합니다. 체력 서킷 영상(T4_aM6F69I4)은 체력 루틴 주제에 씁니다.'},
  },
];

function wrestlingPromptSources(topicId) {
  return WRESTLING_SOURCES.filter(source=>source.topics.includes(topicId)).map(source=>({
    name:source.name,url:source.wrestlingUrl||source.url,role:source.role,note:source.note,
  }));
}

// 유튜브 3개 채널별 소스 묶음 — 탭으로 골라 박스 그리드로 본다
const YT_SOURCE_CHANNELS = [
  { id:'yt-wrestling', tab:'레슬링 소스 채널', emoji:'🤼', sources:WRESTLING_SOURCES },
  { id:'yt-christian', tab:'기독교 소스 채널', emoji:'🙏', sources:[] },
  { id:'yt-indochina', tab:'중국 및 인도 소스 채널', emoji:'🌏', sources:[] },
];
let ytSrcTab = 'yt-wrestling';

function wrestlingSourceLibrary(list) {
  list = list || WRESTLING_SOURCES;
  const btn = 'padding:5px 9px;font-size:11px';
  return `<div class="source-box-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">${list.map(source=>{
    const registered=db.ideas.some(idea=>idea.id==='wrestling-source-'+source.id);
    return `<article class="source-box" style="border:1px solid var(--line);background:var(--panel);border-radius:10px;padding:12px 13px;display:flex;flex-direction:column;gap:7px;min-width:0">
      <div style="display:flex;align-items:center;gap:8px;min-width:0"><span style="font-size:20px;line-height:1">${source.emoji}</span><h3 style="font-size:14px;margin:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(source.name)}</h3></div>
      <span class="statuspill" style="align-self:flex-start;font-size:10px">${esc(source.role)}</span>
      <div style="display:flex;flex-wrap:wrap;gap:4px">${source.topics.map(id=>`<span style="font-size:10px;color:var(--muted);border:1px solid var(--line);border-radius:5px;padding:1px 6px">${esc(YT_BY_ID[id]?.name||id)}</span>`).join('')}</div>
      <p class="small" title="${esc(source.note)}" style="margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(source.note)}</p>
      <details style="font-size:11px"><summary>🎬 검토할 영상</summary><p style="margin:6px 0 2px"><a href="${esc(source.candidate.url)}" target="_blank" rel="noopener noreferrer">${esc(source.candidate.title)} ↗</a></p><p class="small" style="margin:0">${esc(source.candidate.angle)}</p></details>
      <div style="display:flex;flex-wrap:wrap;gap:5px;margin-top:auto"><a class="btn" style="${btn}" href="${esc(source.url)}" target="_blank" rel="noopener noreferrer">채널 ↗</a>
      ${source.wrestlingUrl?`<a class="btn" style="${btn}" href="${esc(source.wrestlingUrl)}" target="_blank" rel="noopener noreferrer">🤼 레슬링만</a>`:''}
      <button class="btn primary" style="${btn}" data-yp-src="${esc(source.candidate.url)}">⬇ 제작 라인</button>
      <button class="btn" style="${btn}" data-wrestling-source="${source.id}" ${registered?'disabled':''}>${registered?'등록됨':'소재 등록'}</button></div></article>`;
  }).join('')}</div>`;
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
const YT_MORE_STARTERS = [
  // 쇼츠 — 생활체육인(레슬링·주짓수·MMA 취미 20~40대 직장인)이 저장·공유하는 주제
  { sid:'gs-first-month', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-athletes', title:'직장인이 레슬링 한 달 하면 몸에 생기는 일', angle:'첫 달에 실제로 겪은 변화(근육통 부위, 목·승모, 체력, 수면)를 순서대로. 과장 없이 내 경험만.', hook:'0~1.5초 · "첫 주에 목이 안 돌아갔다"', outline:['훅: 첫 주 근육통 부위','2주차 [직접 경험]','4주차 [직접 경험]','마무리: "당신은 몇 주차?"'], verify:['개인 경험임을 밝히기','건강 효과를 단정하지 않기'], sources:'' },
  { sid:'gs-20kg', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'체급 20kg 차이, 기술로 이길 수 있을까', angle:'동호인 스파링에서 가벼운 사람이 버티는 법 하나와 현실적인 한계를 같이 보여준다.', hook:'0~1.5초 · "20kg 무거운 사람한테 깔리면"', outline:['훅: 깔린 장면','버티는 법 1개','현실: 체급이 있는 이유','마무리 질문'], verify:['촬영 대상 동의','장면 출처'], sources:'' },
  { sid:'gs-gym-vs-wrestling', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-athletes', title:'헬스 3년 vs 레슬링 3개월, 스파링하면?', angle:'근력과 기술 감각의 차이를 짧은 스파링 한 판으로. 결과보다 "왜 그런지" 한 줄.', hook:'0~1.5초 · "벤치 100kg인데 1분 만에 깔렸다"', outline:['훅: 결과 장면','이유: 균형·자세','헬스가 도움 되는 부분','마무리'], verify:['출연자 동의','수치는 실제 기록만'], sources:'' },
  { sid:'gs-ears', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-athletes', title:'레슬링 하면 진짜 만두귀 될까', angle:'귀가 붓는 이유와 동호인이 쓰는 예방법(헤드기어 등)을 짧게.', hook:'0~1.5초 · "이 귀, 하루 만에 생겼다"', outline:['훅: 귀 사진','왜 생기나 [확인 필요: 의학 출처]','예방법','마무리: "헤드기어 쓰세요?"'], verify:['의학 설명은 의료 기관 출처로','치료는 병원 안내'], sources:'' },
  { sid:'gs-beginner-top3', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'초보가 스파링에서 제일 많이 당하는 기술 TOP 3', angle:'체육관에서 초보가 반복해서 당하는 장면 3개와 한 줄 대처.', hook:'0~1.5초 · "이거 당해본 사람 손"', outline:['3위','2위','1위 + 대처 한 줄','마무리'], verify:['순위는 내 체육관 경험 기준이라고 밝히기'], sources:'https://www.youtube.com/@%EB%95%80%EB%83%84%EC%8B%9C1/shorts' },
  { sid:'gs-one-takedown', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'오늘 밤 스파링에서 바로 써먹는 테이크다운 1개', angle:'초보도 성공률이 높은 기술 하나를 3동작으로.', hook:'0~1.5초 · "이거 하나로 첫 테이크다운 땄다"', outline:['훅: 성공 장면','동작 1·2·3','흔한 실수','마무리'], verify:['기술 명칭','안전 주의'], sources:'https://www.youtube.com/@DPSBreakdowns' },
  { sid:'gs-falling', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'다치지 않고 넘어지는 법 15초', angle:'낙법 하나. 생활체육인의 첫 부상 예방.', hook:'0~1.5초 · "이렇게 넘어지면 손목 나간다"', outline:['훅: 잘못된 낙법','올바른 낙법','연습법','마무리'], verify:['코치·지도자 감수 권장'], sources:'' },
  { sid:'gs-etiquette', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-athletes', title:'체육관 첫날 이것만 지키면 사랑받는다', angle:'위생·손톱·탭 존중 등 동호인 체육관 매너 5가지.', hook:'0~1.5초 · "첫날 이거 하면 다들 피한다"', outline:['매너 1~5 한 컷씩','마무리: "추가할 매너는?"'], verify:['체육관마다 다를 수 있음 표시'], sources:'' },
  { sid:'gs-home-conditioning', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'퇴근 후 집에서 하는 레슬링 체력 3가지', angle:'스프롤 버피, 브릿지, 슈팅 드릴을 좁은 방에서.', hook:'0~1.5초 · "원룸에서도 된다"', outline:['드릴 1','드릴 2','드릴 3','마무리: 횟수 제안'], verify:['무리하지 말라는 안내'], sources:'https://www.youtube.com/@CaydenHenschel' },
  { sid:'gs-40s', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-athletes', title:'40대에 레슬링 시작해도 될까', angle:'늦게 시작한 동호인 사례와 주의할 점(회복·부상).', hook:'0~1.5초 · "마흔셋에 처음 매트에 섰다"', outline:['훅: 사례','좋은 점','주의할 점','마무리 질문'], verify:['사례 당사자 동의','건강 관련은 단정 금지'], sources:'' },
  { sid:'gs-first-comp', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-highlights', title:'동호인 대회 처음 나가면 벌어지는 일', angle:'계체·대기·긴장·1분의 체감을 순서대로.', hook:'0~1.5초 · "1분이 10분 같았다"', outline:['계체','대기실','경기 1분','끝나고 든 생각'], verify:['대회명·규정 [확인 필요]'], sources:'' },
  { sid:'gs-strength-mistake', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'힘으로 밀어붙이는 상대, 초보가 하는 실수', angle:'버티다 체력 다 쓰는 장면 → 각도 바꾸기 하나.', hook:'0~1.5초 · "힘싸움하면 3분 만에 끝난다"', outline:['훅: 버티는 장면','실수 이유','대처 1개','마무리'], verify:['장면 출처'], sources:'' },
  { sid:'gs-ufc-in-sparring', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-ufc', title:'UFC 기술, 동호인 스파링에서 진짜 통할까', angle:'프로 장면 하나를 동호인이 따라 했을 때 되는 것과 안 되는 것.', hook:'0~1.5초 · "하빕 따라 했다가 생긴 일"', outline:['훅: 프로 장면 몇 초','동호인 시도 [직접 경험]','되는 부분·안 되는 부분','마무리'], verify:['원본 출처','따라 하기 안전 주의'], sources:'https://www.youtube.com/@smeshtalk/shorts' },
  // 롱폼 — 생활체육인 입문·성장 가이드
  { sid:'gl-starter-guide', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-technique', title:'성인 초보 레슬링 입문 완전 가이드: 체육관 고르기부터 첫 스파링까지', angle:'처음 시작하는 직장인이 묻는 것들을 순서대로 답한다.', hook:'0~15초 · "레슬링 배우고 싶은데 어디서부터?" 질문 + 첫 수업 장면', outline:['약속: 10분이면 시작 준비 끝','파트1 체육관 고르기','파트2 준비물·비용 [확인 필요]','파트3 첫 수업 흐름','파트4 첫 스파링 마음가짐','정리 + 다음 영상'], verify:['비용은 실제 확인한 곳 기준','지역 정보 날짜'], sources:'https://www.youtube.com/@%EB%95%80%EB%83%84%EC%8B%9C1/shorts' },
  { sid:'gl-3months', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-athletes', title:'레슬링 3개월 해보니 달라진 것: 몸·체력·멘탈', angle:'직접 기록한 3개월(체중, 출석, 첫 테이크다운)을 그대로 보여준다.', hook:'0~15초 · 첫날과 90일째 비교 장면', outline:['약속','파트1 몸','파트2 체력','파트3 멘탈·생활','정리'], verify:['개인 기록임을 밝히기','건강 효과 일반화 금지'], sources:'' },
  { sid:'gl-roadmap', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-technique', title:'생활체육인을 위한 테이크다운 로드맵: 처음 배울 5가지 순서', angle:'왜 이 순서인지 이유와 함께. 프로 장면은 몇 초씩만.', hook:'0~15초 · "기술 50개 말고 이 5개만"', outline:['약속','1~5단계 기술','단계마다 드릴 하나','정리 표'], verify:['기술 명칭','코치 감수 권장'], sources:'https://www.youtube.com/@DPSBreakdowns\nhttps://www.youtube.com/@GrapplingTheoryHQ' },
  { sid:'gl-injury', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-athletes', title:'동호인이 제일 많이 다치는 부위 5곳과 오래 하는 법', angle:'목·어깨·무릎·손가락·귀. 예방은 확인된 자료와 지도자 조언으로만.', hook:'0~15초 · "레슬링 그만두는 이유 1위는 실력이 아니라 부상"', outline:['약속','부위별 원인과 예방 [확인 필요: 의학·스포츠의학 출처]','회복 루틴','정리'], verify:['의학 정보는 의료기관·논문 출처','치료 조언 단정 금지'], sources:'' },
  { sid:'gl-which-grappling', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-athletes', title:'레슬링 vs 주짓수 vs 유도: 직장인에게 맞는 그래플링은?', angle:'체력 부담, 부상, 비용, 대회, 실전성을 같은 기준으로 비교.', hook:'0~15초 · 세 종목 장면 연달아 + "당신 성격엔 뭐가 맞을까"', outline:['약속','비교 기준 5개','종목별','성향별 추천','정리'], verify:['비용·체육관 수 [확인 필요]','편향 없이'], sources:'' },
  { sid:'gl-amateur-comp', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-highlights', title:'생활체육 레슬링 대회 출전 A to Z', angle:'신청·체급·계체·규칙·당일 흐름을 처음 나가는 사람 눈높이로.', hook:'0~15초 · 대회장 입장 장면', outline:['약속','파트1 대회 찾기·신청 [확인 필요: 협회 공지]','파트2 체급·계체','파트3 당일','파트4 끝나고','정리'], verify:['대회 규정은 주최 측 공지 원문','날짜'], sources:'' },
  { sid:'gl-conditioning', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-technique', title:'주 3회 직장인 레슬링 체력 루틴', angle:'퇴근 후 시간·회복을 고려한 현실 루틴. 따라 하기 화면 위주.', hook:'0~15초 · "스파링 2분 만에 숨이 찬다면"', outline:['약속','월·수·금 루틴','강도 조절법','정리'], verify:['무리 금지 안내','지도자 감수 권장'], sources:'https://www.youtube.com/@CaydenHenschel' },
  { sid:'gl-pro-for-amateurs', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-ufc', title:'프로 경기 장면으로 배우는 동호인 스파링 전략', angle:'UFC·NCAA 장면 몇 초씩 → 동호인이 가져갈 원리 하나씩.', hook:'0~15초 · 프로 장면과 동호인 장면 나란히', outline:['약속','원리 1 거리','원리 2 자세','원리 3 체력 배분','정리'], verify:['원본 출처·사용 길이','경기 정보'], sources:'https://www.youtube.com/@NCAAChampionships\nhttps://www.youtube.com/@smeshtalk/shorts' },
];
// 프로 경기 해설 주제 23개 (생활체육인 주제와 함께 유지)
const YT_PRO_STARTERS = [
  // 쇼츠 (15~60초)
  { sid:'yt-s-double-vs-single', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'더블렉 vs 싱글렉, 언제 뭘 쓸까', angle:'두 기술의 진입 장면을 나란히 놓고 상대 자세에 따라 고르는 기준 하나만 보여준다.', hook:'0~1.5초 · "상대가 이렇게 서 있으면 더블렉은 막힌다"', outline:['훅: 두 진입 장면 분할 화면','기준 1: 상대 무게중심','기준 2: 거리','결론 + 첫 장면으로 돌아가는 마무리 한 줄'], verify:['기술 명칭 표기','장면 출처 선수·대회'], sources:'https://www.youtube.com/@DPSBreakdowns' },
  { sid:'yt-s-sprawl', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'스프롤: 테이크다운을 막는 1초', angle:'다리를 잡히기 직전 엉덩이를 뒤로 빼는 순간을 멈춤 화면으로 해부한다.', hook:'0~1.5초 · "다리를 잡혀도 넘어가지 않는 방법"', outline:['훅: 잡히는 순간 멈춤','엉덩이·체중 화살표','실패 장면과 비교','마무리'], verify:['장면 출처','동작 설명이 원본 해설과 맞는지'], sources:'https://www.youtube.com/@GrapplingTheoryHQ' },
  { sid:'yt-s-cage-wall', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-ufc', title:'UFC 레슬러는 왜 상대를 철장에 붙일까', angle:'케이지 벽을 이용한 압박이 일반 레슬링 매트와 다른 점 하나를 보여준다.', hook:'0~1.5초 · "철장이 레슬러의 세 번째 팔이다"', outline:['훅: 벽에 붙는 장면','벽이 막아주는 방향 화살표','테이크다운으로 이어지는 순간','마무리'], verify:['경기명·선수·라운드 [확인 필요]'], sources:'https://www.youtube.com/@smeshtalk/shorts' },
  { sid:'yt-s-greco-legs', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-highlights', title:'그레코로만은 왜 다리를 못 잡을까', angle:'규칙 한 줄 + 그 규칙 때문에 생긴 화려한 메치기 장면.', hook:'0~1.5초 · "다리를 잡으면 반칙인 레슬링"', outline:['훅: 큰 메치기 장면','규칙 한 줄 [확인 필요: UWW 규정 원문]','그래서 상체 싸움이 된다','마무리'], verify:['UWW 그레코로만 규정 원문'], sources:'https://www.youtube.com/@unitedworldwrestling' },
  { sid:'yt-s-scoring', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-highlights', title:'레슬링 점수 30초 정리', angle:'테이크다운·노출·밀어내기 점수를 실제 장면 하나씩으로 설명한다.', hook:'0~1.5초 · "이 장면은 몇 점일까?"', outline:['훅: 점수 퀴즈 장면','점수 종류 3개를 장면과 함께 [확인 필요: 현행 점수]','정답 공개','마무리: 다시 첫 장면 질문'], verify:['UWW 현행 점수 규정과 개정 연도'], sources:'https://www.youtube.com/@unitedworldwrestling' },
  { sid:'yt-s-ncaa-last10', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-highlights', title:'NCAA 결승, 마지막 10초에 뒤집혔다', angle:'종료 직전 역전 장면 하나와 그 직전 선택을 해설한다.', hook:'0~1.5초 · "남은 시간 10초, 2점 뒤진 상황"', outline:['훅: 시계와 점수','역전 직전 움직임','점수 나는 순간 슬로우','마무리'], verify:['선수·연도·체급·최종 스코어'], sources:'https://www.youtube.com/@NCAAChampionships' },
  { sid:'yt-s-kures', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-athletes', title:'카자흐 전통 씨름 쿠레스, 처음 보면 놀라는 것', angle:'한국 씨름과 닮은 점·다른 점 하나씩.', hook:'0~1.5초 · "한국 씨름이랑 뭐가 다를까?"', outline:['훅: 쿠레스 경기 장면','닮은 점','다른 점','마무리 질문'], verify:['쿠레스 규칙 출처 [확인 필요]','영상 원본 출처'], sources:'https://www.youtube.com/@QAZSPORTTV' },
  { sid:'yt-s-women-grip', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-women', title:'여자 레슬러의 그립 싸움 15초', angle:'손목 컨트롤 하나로 경기를 가져가는 장면.', hook:'0~1.5초 · "손목만 잡았는데 끝났다"', outline:['훅: 손목 잡는 순간','그다음 연결 동작','결과','마무리'], verify:['선수 이름·대회 공식 표기'], sources:'https://www.youtube.com/@unitedworldwrestling' },
  { sid:'yt-s-korea-gym', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-athletes', title:'한국 레슬링 체육관 하루 30초', angle:'국내 체육관 훈련 장면을 내 해설로 소개한다(원 채널 허락·출처 표기).', hook:'0~1.5초 · "한국에도 이런 레슬링 체육관이 있다"', outline:['훅: 훈련 장면','훈련 순서 3컷','내 한 줄 소감','마무리'], verify:['원 채널 사용 허락 여부','체육관 이름 표기'], sources:'https://www.youtube.com/@%EB%95%80%EB%83%84%EC%8B%9C1/shorts' },
  { sid:'yt-s-ankle-pick', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'앵클픽: 가장 빠른 테이크다운', angle:'머리로 밀고 발목을 줍는 두 동작을 화살표로.', hook:'0~1.5초 · "0.5초 만에 넘어갔다"', outline:['훅: 넘어가는 장면','동작 1 머리','동작 2 발목','마무리'], verify:['장면 출처'], sources:'https://www.youtube.com/@FloWrestling' },
  { sid:'yt-s-raf', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-highlights', title:'RAF 프리스타일, 일반 레슬링과 뭐가 다를까', angle:'규칙·무대 차이 하나를 장면으로.', hook:'0~1.5초 · "이건 올림픽 레슬링이 아니다"', outline:['훅: RAF 장면','다른 점 하나 [확인 필요: RAF 규칙]','마무리'], verify:['RAF 공식 규칙'], sources:'https://www.youtube.com/@RAFwrestling' },
  { sid:'yt-s-head-position', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'테이크다운 마무리 실수 1위: 머리 위치', angle:'같은 기술의 성공·실패 장면을 머리 위치로 비교.', hook:'0~1.5초 · "다리를 잡고도 지는 이유"', outline:['훅: 실패 장면','머리 위치 비교','성공 장면','마무리'], verify:['장면 출처','해설이 원본 분석과 맞는지'], sources:'https://www.youtube.com/@DPSBreakdowns' },
  { sid:'yt-s-cayden-drill', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-athletes', title:'선수 훈련 루틴에서 따라 할 1가지', angle:'한 선수의 훈련 영상에서 입문자가 따라 할 드릴 하나만 고른다.', hook:'0~1.5초 · "집에서도 되는 레슬링 훈련"', outline:['훅: 드릴 장면','방법 2컷','주의점','마무리'], verify:['선수 표기','부상 위험 안내'], sources:'https://www.youtube.com/@CaydenHenschel' },
  // 롱폼 (8~12분)
  { sid:'yt-l-khabib', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-ufc', title:'하빕 누르마고메도프의 레슬링 완전 해부', angle:'압박 → 케이지 → 바닥 컨트롤 세 단계로 하빕 스타일을 해설한다.', hook:'0~15초 · 상대가 일어나지 못하는 장면 + "왜 아무도 못 빠져나왔을까"', outline:['약속: 하빕 레슬링의 3단계','파트1 압박과 진입','파트2 케이지 활용','파트3 바닥 컨트롤','정리 3줄 + 다음 영상'], verify:['전적·경기 날짜','인용 발언 원문'], sources:'https://www.youtube.com/@smeshtalk/shorts' },
  { sid:'yt-l-rules', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-highlights', title:'레슬링 입문 총정리: 자유형·그레코로만·포크스타일', angle:'세 종류의 규칙과 보는 재미를 실제 장면으로 비교.', hook:'0~15초 · 세 경기 장면을 연달아 + "다 같은 레슬링이 아니다"', outline:['약속','파트1 자유형','파트2 그레코로만','파트3 미국 포크스타일','정리'], verify:['UWW·NCAA 규정 원문'], sources:'https://www.youtube.com/@unitedworldwrestling\nhttps://www.youtube.com/@NCAAChampionships' },
  { sid:'yt-l-ncaa-ufc', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-ufc', title:'미국 대학 레슬링은 어떻게 UFC 챔피언을 만들까', angle:'NCAA 레슬링 출신 선수들의 공통 기술을 장면으로 짚는다.', hook:'0~15초 · 대학 결승 장면 → 같은 선수의 UFC 장면', outline:['약속','파트1 NCAA 레슬링의 특징','파트2 UFC에서 살아남는 기술','파트3 한계','정리'], verify:['선수 경력 [확인 필요]','과장 없는지'], sources:'https://www.youtube.com/@NCAAChampionships' },
  { sid:'yt-l-takedowns5', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-technique', title:'테이크다운 5가지 한 번에: 싱글·더블·하이크로치·앵클픽·바디락', angle:'기술마다 완성 장면 → 셋업 → 흔한 실수.', hook:'0~15초 · 다섯 기술 몽타주 + "오늘 다 구분하게 된다"', outline:['약속','파트1~5 기술별','정리 표'], verify:['기술 명칭','장면 출처'], sources:'https://www.youtube.com/@DPSBreakdowns\nhttps://www.youtube.com/@FloWrestling' },
  { sid:'yt-l-tdd', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-ufc', title:'타격가는 레슬러를 어떻게 막을까: 테이크다운 방어의 모든 것', angle:'스프롤·언더훅·케이지 일어서기를 UFC 장면으로.', hook:'0~15초 · 테이크다운을 막고 KO로 이어진 장면', outline:['약속','파트1 거리','파트2 스프롤','파트3 일어서기','정리'], verify:['경기·선수 [확인 필요]'], sources:'https://www.youtube.com/@GrapplingTheoryHQ' },
  { sid:'yt-l-worlds-final', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-highlights', title:'세계선수권 결승 한 경기 풀 해설', angle:'경기 흐름을 1·2피리어드로 나눠 전환점마다 멈춘다.', hook:'0~15초 · 결정적 장면 + "이 10초 전에 이미 승부가 났다"', outline:['약속','선수 소개','1피리어드','2피리어드','승부를 가른 이유','정리'], verify:['연도·체급·스코어','선수 한글 표기'], sources:'https://www.youtube.com/@unitedworldwrestling' },
  { sid:'yt-l-women5', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-women', title:'지금 가장 강한 여자 레슬러 5명', angle:'선수마다 강점 하나와 대표 장면 하나.', hook:'0~15초 · 다섯 장면 몽타주', outline:['약속','선수 1~5','정리'], verify:['메달·대회 기록 공식 출처'], sources:'https://www.youtube.com/@unitedworldwrestling' },
  { sid:'yt-l-dagestan', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-athletes', title:'다게스탄은 왜 레슬링 강국이 됐을까', angle:'문화·훈련·선수 계보를 확인된 자료로만 설명한다.', hook:'0~15초 · 작은 지역 지도 + 선수 장면', outline:['약속','파트1 지역 소개','파트2 훈련 문화','파트3 대표 선수','정리'], verify:['인구·메달 수치 [확인 필요]','일반화 표현 없는지'], sources:'https://www.youtube.com/@smeshtalk/shorts' },
  { sid:'yt-l-korea-now', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-athletes', title:'한국 레슬링은 지금 어디쯤 와 있나', angle:'국내 체육관 장면과 국제 대회 결과를 함께 본다.', hook:'0~15초 · 체육관 훈련 장면 + 질문', outline:['약속','파트1 체육관','파트2 국제 대회 성적 [확인 필요]','파트3 내가 본 것','정리'], verify:['대회 성적 공식 출처','원 채널 허락'], sources:'https://www.youtube.com/@%EB%95%80%EB%83%84%EC%8B%9C1/shorts' },
  { sid:'yt-l-kazakh', platform:'YouTube', ytFormat:'long', yt:'yt-wrestling-athletes', title:'카자흐스탄 레슬링과 전통 씨름 쿠레스', angle:'올림픽 레슬링과 전통 씨름이 어떻게 이어지는지.', hook:'0~15초 · 쿠레스 장면 → 국제 대회 장면', outline:['약속','파트1 쿠레스','파트2 카자흐 레슬링','파트3 한국 씨름과 비교','정리'], verify:['규칙·역사 출처 [확인 필요]'], sources:'https://www.youtube.com/@QAZSPORTTV' },
];
PLATFORM_STARTERS.push(...YT_PRO_STARTERS);
// 🔥 멋있는 기술 시리즈 (쇼츠, 기술 3번 반복)
const YT_MOVE_STARTERS = [
  { sid:'gt-tackle-counter', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'1,200만 명이 본 태클 카운터, 3번 보면 보인다', angle:'🔥 멋있는 기술 시리즈 · 태클 카운터를 3번 반복해서 보여준다: 원속도 → 슬로우+화살표 → 원속도.', hook:'0~2초 · 태클 카운터 원속도 장면 (설명 없이 기술부터)', outline:['① 0~2초 원속도: 태클 카운터 성공 장면','② 슬로우 0.5배 + 화살표: 상대 머리 위치와 내 엉덩이 빼기','② 슬로우 계속: 눌러서 뒤로 도는 방향','③ 원속도 한 번 더 → 마지막 프레임이 첫 장면으로 이어지게','자막 한 줄: 기술 이름 + "생활체육 스파링에서 쓸 때 주의"'], verify:['기술 정식 명칭','원 채널 표기 또는 직접 시연 재촬영','위험 기술이면 안전 경고 자막'], sources:'https://www.youtube.com/shorts/eNVEKSW8Xgk\nhttps://www.youtube.com/@Wrestling_coach/shorts' },
  { sid:'gt-slide-foot-sweep', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'슬라이드바이에서 풋스윕까지 한 번에', angle:'🔥 멋있는 기술 시리즈 · 슬라이드바이 → 풋스윕 연결를 3번 반복해서 보여준다: 원속도 → 슬로우+화살표 → 원속도.', hook:'0~2초 · 슬라이드바이 → 풋스윕 연결 원속도 장면 (설명 없이 기술부터)', outline:['① 0~2초 원속도: 슬라이드바이 → 풋스윕 연결 성공 장면','② 슬로우 0.5배 + 화살표: 팔을 끌어 옆으로 빠지는 순간','② 슬로우 계속: 발목을 쓸어내는 타이밍','③ 원속도 한 번 더 → 마지막 프레임이 첫 장면으로 이어지게','자막 한 줄: 기술 이름 + "생활체육 스파링에서 쓸 때 주의"'], verify:['기술 정식 명칭','원 채널 표기 또는 직접 시연 재촬영','위험 기술이면 안전 경고 자막'], sources:'https://www.youtube.com/shorts/w4shWBS1-RM\nhttps://www.youtube.com/@Wrestling_coach/shorts' },
  { sid:'gt-inner-trip-throw', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'안다리 걸고 안아던지기', angle:'🔥 멋있는 기술 시리즈 · 안다리 안아던지기를 3번 반복해서 보여준다: 원속도 → 슬로우+화살표 → 원속도.', hook:'0~2초 · 안다리 안아던지기 원속도 장면 (설명 없이 기술부터)', outline:['① 0~2초 원속도: 안다리 안아던지기 성공 장면','② 슬로우 0.5배 + 화살표: 다리를 거는 위치','② 슬로우 계속: 허리를 붙이고 넘기는 방향','③ 원속도 한 번 더 → 마지막 프레임이 첫 장면으로 이어지게','자막 한 줄: 기술 이름 + "생활체육 스파링에서 쓸 때 주의"'], verify:['기술 정식 명칭','원 채널 표기 또는 직접 시연 재촬영','위험 기술이면 안전 경고 자막'], sources:'https://www.youtube.com/shorts/d01kOBXyEPQ\nhttps://www.youtube.com/@Wrestling_coach/shorts' },
  { sid:'gt-makhachev-hip', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-ufc', title:'마카체프가 쓰는 엉치걸이', angle:'🔥 멋있는 기술 시리즈 · 엉치걸이를 3번 반복해서 보여준다: 원속도 → 슬로우+화살표 → 원속도. UFC 장면은 몇 초만, 경기 정보 확인.', hook:'0~2초 · 엉치걸이 원속도 장면 (설명 없이 기술부터)', outline:['① 0~2초 원속도: 엉치걸이 성공 장면','② 슬로우 0.5배 + 화살표: 다리를 거는 각도','② 슬로우 계속: 체중을 싣는 방향','③ 원속도 한 번 더 → 마지막 프레임이 첫 장면으로 이어지게','자막 한 줄: 기술 이름 + "생활체육 스파링에서 쓸 때 주의"'], verify:['기술 정식 명칭','원 채널 표기 또는 직접 시연 재촬영','위험 기술이면 안전 경고 자막'], sources:'https://www.youtube.com/shorts/7iHEi0Jszu8\nhttps://www.youtube.com/@Wrestling_coach/shorts' },
  { sid:'gt-lateral-drop', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'태클 막고 바로 레터럴 드랍', angle:'🔥 멋있는 기술 시리즈 · 태클 방어 후 레터럴 드랍를 3번 반복해서 보여준다: 원속도 → 슬로우+화살표 → 원속도.', hook:'0~2초 · 태클 방어 후 레터럴 드랍 원속도 장면 (설명 없이 기술부터)', outline:['① 0~2초 원속도: 태클 방어 후 레터럴 드랍 성공 장면','② 슬로우 0.5배 + 화살표: 언더훅·오버훅 잡는 손','② 슬로우 계속: 옆으로 떨어지는 축','③ 원속도 한 번 더 → 마지막 프레임이 첫 장면으로 이어지게','자막 한 줄: 기술 이름 + "생활체육 스파링에서 쓸 때 주의"'], verify:['기술 정식 명칭','원 채널 표기 또는 직접 시연 재촬영','위험 기술이면 안전 경고 자막'], sources:'https://www.youtube.com/shorts/UIvnJmrgBnw\nhttps://www.youtube.com/@Wrestling_coach/shorts' },
  { sid:'gt-neck-escape', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'목 잡혔을 때 바로 쓰는 반격', angle:'🔥 멋있는 기술 시리즈 · 목 잡혔을 때 반격를 3번 반복해서 보여준다: 원속도 → 슬로우+화살표 → 원속도.', hook:'0~2초 · 목 잡혔을 때 반격 원속도 장면 (설명 없이 기술부터)', outline:['① 0~2초 원속도: 목 잡혔을 때 반격 성공 장면','② 슬로우 0.5배 + 화살표: 손을 떼어내는 방향','② 슬로우 계속: 자세를 뒤집는 순간','③ 원속도 한 번 더 → 마지막 프레임이 첫 장면으로 이어지게','자막 한 줄: 기술 이름 + "생활체육 스파링에서 쓸 때 주의"'], verify:['기술 정식 명칭','원 채널 표기 또는 직접 시연 재촬영','위험 기술이면 안전 경고 자막'], sources:'https://www.youtube.com/shorts/dRi-lzrOkx0\nhttps://www.youtube.com/@Wrestling_coach/shorts' },
  { sid:'gt-blast-double', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'블라스트 더블렉: 폭발하듯 들어가기', angle:'🔥 멋있는 기술 시리즈 · 블라스트 더블렉를 3번 반복해서 보여준다: 원속도 → 슬로우+화살표 → 원속도.', hook:'0~2초 · 블라스트 더블렉 원속도 장면 (설명 없이 기술부터)', outline:['① 0~2초 원속도: 블라스트 더블렉 성공 장면','② 슬로우 0.5배 + 화살표: 무릎을 내리는 깊이','② 슬로우 계속: 머리와 어깨로 미는 방향','③ 원속도 한 번 더 → 마지막 프레임이 첫 장면으로 이어지게','자막 한 줄: 기술 이름 + "생활체육 스파링에서 쓸 때 주의"'], verify:['기술 정식 명칭','원 채널 표기 또는 직접 시연 재촬영','위험 기술이면 안전 경고 자막'], sources:'https://www.youtube.com/shorts/Fn1HMRQEg6w\nhttps://www.youtube.com/@Wrestling_coach/shorts' },
  { sid:'gt-seoi-nage', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-athletes', title:'피지컬100 선수의 업어치기', angle:'🔥 멋있는 기술 시리즈 · 업어치기를 3번 반복해서 보여준다: 원속도 → 슬로우+화살표 → 원속도. 출연 선수 이름은 원 영상 기준으로 확인.', hook:'0~2초 · 업어치기 원속도 장면 (설명 없이 기술부터)', outline:['① 0~2초 원속도: 업어치기 성공 장면','② 슬로우 0.5배 + 화살표: 등을 돌려 들어가는 발','② 슬로우 계속: 허리로 띄우는 순간','③ 원속도 한 번 더 → 마지막 프레임이 첫 장면으로 이어지게','자막 한 줄: 기술 이름 + "생활체육 스파링에서 쓸 때 주의"'], verify:['기술 정식 명칭','원 채널 표기 또는 직접 시연 재촬영','위험 기술이면 안전 경고 자막'], sources:'https://www.youtube.com/shorts/ZDIheMXqf6c\nhttps://www.youtube.com/@Wrestling_coach/shorts' },
  { sid:'gt-hip-toss', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-technique', title:'레슬링 허리후리기', angle:'🔥 멋있는 기술 시리즈 · 허리후리기를 3번 반복해서 보여준다: 원속도 → 슬로우+화살표 → 원속도.', hook:'0~2초 · 허리후리기 원속도 장면 (설명 없이 기술부터)', outline:['① 0~2초 원속도: 허리후리기 성공 장면','② 슬로우 0.5배 + 화살표: 허리를 붙이는 위치','② 슬로우 계속: 돌리는 축','③ 원속도 한 번 더 → 마지막 프레임이 첫 장면으로 이어지게','자막 한 줄: 기술 이름 + "생활체육 스파링에서 쓸 때 주의"'], verify:['기술 정식 명칭','원 채널 표기 또는 직접 시연 재촬영','위험 기술이면 안전 경고 자막'], sources:'https://www.youtube.com/shorts/jV4Ht8r8ywc\nhttps://www.youtube.com/@Wrestling_coach/shorts' },
  { sid:'gt-greco-suplex', platform:'YouTube', ytFormat:'shorts', yt:'yt-wrestling-highlights', title:'그레코로만 수플렉스: 사람을 뒤로 던지는 기술', angle:'🔥 멋있는 기술 시리즈 · 그레코로만 수플렉스를 3번 반복해서 보여준다: 원속도 → 슬로우+화살표 → 원속도. 공식 대회 장면(UWW) 우선, 위험 기술이라 따라 하지 말라는 자막.', hook:'0~2초 · 그레코로만 수플렉스 원속도 장면 (설명 없이 기술부터)', outline:['① 0~2초 원속도: 그레코로만 수플렉스 성공 장면','② 슬로우 0.5배 + 화살표: 허리를 감는 손','② 슬로우 계속: 뒤로 아치를 그리는 몸','③ 원속도 한 번 더 → 마지막 프레임이 첫 장면으로 이어지게','자막 한 줄: 기술 이름 + "생활체육 스파링에서 쓸 때 주의"'], verify:['기술 정식 명칭','원 채널 표기 또는 직접 시연 재촬영','위험 기술이면 안전 경고 자막'], sources:'https://www.youtube.com/@unitedworldwrestling' },
];
PLATFORM_STARTERS.push(...YT_MOVE_STARTERS);
PLATFORM_STARTERS.push(...YT_MORE_STARTERS);
const YT_REPEAT = '멋있는 기술 장면은 3번: ① 0~2초 원속도로 먼저 → ② 설명하며 0.5배 슬로우+화살표 → ③ 끝에 원속도로 한 번 더, 마지막 프레임이 첫 장면으로 이어져 다시 보게';
const YT_FORMAT_TEXT = { shorts:'쇼츠 15~60초 · 멋있는 기술 3번 반복(원속도 → 슬로우+화살표 → 원속도) · 끝이 첫 장면으로 이어지게', long:'롱폼 8~12분 · 15초 훅 → 약속 → 열린 고리 있는 파트 3~5개 → 정리' };
function ytFormatOf(i) { return i && i.ytFormat === 'long' ? 'long' : 'shorts'; }
const PLATFORM_SEED_VERSION = 5;
let ideaPlatformFilter = 'all';

function platformStarterNote(s) {
  return `${s.sid && s.sid.startsWith('gt-') ? '[🔥 멋있는 기술 시리즈 · ' + YT_REPEAT + ']\n' : ''}[플랫폼 시작 소재 · ${s.platform}${s.ytFormat ? (s.ytFormat === 'long' ? ' 롱폼' : ' 쇼츠') : ''} · 사실 확인 전 아이디어]\n형식: ${s.ytFormat ? YT_FORMAT_TEXT[s.ytFormat] : PLATFORM_FORMAT[s.platform]}\n각도: ${s.angle}\n훅: ${s.hook}\n\n구성\n${s.outline.map(x => '- ' + x).join('\n')}\n\n확인할 것\n${s.verify.map(x => '- ' + x).join('\n')}`;
}
function ensurePlatformStarters() {
  if (!db || !Array.isArray(db.ideas) || (db.platformSeedVersion || 0) >= PLATFORM_SEED_VERSION) return;
  const have = new Set(db.ideas.map(i => i && i.id)); const base = Date.now(); let k = 0;
  for (const s of PLATFORM_STARTERS) {
    const id = 'pf-starter-' + s.sid; if (have.has(id)) continue;
    const idea = { id, title:s.title, note:platformStarterNote(s), sources:s.sources || '', platform:s.platform, sample:false, aiGenerated:false, starter:true, created:base - (k++) };
    if (s.platform === 'YouTube') { idea.preferredChannel = 'youtube'; idea.ytFormat = s.ytFormat || 'shorts'; if (s.yt) { idea.ytChannel = 'yt-wrestling'; idea.topicId = s.yt; } }
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
  'YouTube': { role:'생활체육인을 위한 레슬링 쇼츠·롱폼', make:['레슬링 소스에서 분석할 장면 3~5개 고르기','🔎 자료조사 프롬프트로 선수·기록·규정 출처 확인','질문 하나·결론 하나로 해설 대본 쓰기','내 목소리로 해설 영상(5~10분) 녹화','Vizard·OpusClip으로 쇼츠 쪼개기 → 캡컷 자막 템플릿','YouTube Studio에 업로드'], good:['멋있는 기술은 3번 반복: 원속도 → 슬로우+화살표 → 원속도','첫 3초에 질문이나 결정적 장면','원본 경기는 몇 초만, 중심은 내 해설','자막은 크게, 화면 위쪽 중앙','끝은 다음 영상으로 이어지는 질문'], metric:'시청 지속 시간' },
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
    <dl class="pf-stats">${c === 'youtube' ? `<div><dt>쇼츠</dt><dd>${ideas.filter(i => ytFormatOf(i) === 'shorts').length}</dd></div><div><dt>롱폼</dt><dd>${ideas.filter(i => ytFormatOf(i) === 'long').length}</dd></div>` : `<div><dt>주제</dt><dd>${ideas.length}</dd></div>`}<div><dt>작성 중</dt><dd>${n('draft')}</dd></div><div><dt>검수 대기</dt><dd class="orange">${n('review')}</dd></div><div><dt>승인</dt><dd class="green">${n('approved')}</dd></div></dl>
    <button class="btn primary" data-action="newIdea">＋ 새 주제</button></section>`;
  let board = `<section class="ps-board" style="--pc:${pc}"><div class="ps-cols">
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
    const fmtPick = i => `<label class="idea-pf-pick yt-fmt-pick"><span>형식</span><select data-yt-format-set="${esc(i.id)}"><option value="shorts" ${ytFormatOf(i) === 'shorts' ? 'selected' : ''}>쇼츠</option><option value="long" ${ytFormatOf(i) === 'long' ? 'selected' : ''}>롱폼</option></select></label>`;
    const ytTopic = i => topic(i).replace(ideaPlatformPicker(i), ideaPlatformPicker(i) + fmtPick(i));
    const group = f => { const l = ytFmtIdeas(f); return `<div class="yt-fmt-group ${f}"><h4>${f === 'long' ? '🎬 롱폼' : '📱 쇼츠'} <em>${l.length}</em><span>${esc(YT_FORMAT_TEXT[f])}</span></h4>${l.length ? `<ul class="ps-topics">${l.map(ytTopic).join('')}</ul>` : '<p class="small">아직 없습니다.</p>'}</div>`; };
    board = board.replace(/<div class="ps-col"><h3><span>①<\/span> 주제 <em>\d+<\/em><\/h3>[\s\S]*?<\/div>\s*<div class="ps-col"><h3><span>②/, `<div class="ps-col"><h3><span>①</span> 주제 <em>${ideas.length}</em></h3><div class="yt-fmt-groups">${group('shorts')}${group('long')}</div></div>\n    <div class="ps-col"><h3><span>②`);
    const ytBoard = board.replace(/<div class="ps-col"><h3><span>②<\/span> 제작 방법<\/h3>[\s\S]*?<\/div>\s*<div class="ps-col"><h3><span>③/, '<div class="ps-col"><h3><span>③').replace('<div class="ps-cols">', '<div class="ps-cols ps-cols2">');
    return hero + ytPipeline() + ytAudioGuide() + ytBoard + drafts + toolSec;
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


// ===== YouTube 제작 라인: 자료조사 → 소스 다운로드 → 편집 → 업로드 (쇼츠/롱폼, 단계마다 스킬 바로 쓰기) =====
let ytPipe = { ideaId: '', url: '', ranges: '', format: 'shorts' };
const YT_AUDIENCE = '레슬링·주짓수·MMA를 취미로 하는 생활체육인(20~40대 직장인, 입문~중급)';
function ytFolder(t) { return String(t || '새 주제').replace(/[\\/:*?"<>|#%&{}$!'`@+=]/g, '').replace(/\s+/g, ' ').trim().slice(0, 40) || '새 주제'; }
function ytFmtIdeas(f) { return db.ideas.filter(i => ideaPlatform(i) === 'YouTube' && (!f || ytFormatOf(i) === f)).sort((a, b) => ytRank(a) - ytRank(b) || (b.created || 0) - (a.created || 0)); }
// 순서: 직접 만든 주제 → 🔥 멋있는 기술 → 생활체육인 → 프로 경기
function ytRank(i) { const id = String(i.id); return !id.startsWith('pf-starter-') ? 0 : /^pf-starter-gt-/.test(id) ? 1 : /^pf-starter-g[sl]-/.test(id) ? 2 : 3; }
function ytPipeIdea() { const list = ytFmtIdeas(ytPipe.format); return list.find(i => i.id === ytPipe.ideaId) || list[0] || null; }
function ytFirstUrl(i) { const m = String(i?.sources || '').match(/https?:\/\/(?:www\.)?(?:youtube\.com\/(?:watch\?v=|shorts\/)|youtu\.be\/)[\w-]+[^\s]*/); return m ? m[0] : ''; }
function ytRanges() { return ytPipe.ranges.split(/[,\s]+/).map(x => x.trim()).filter(x => /^\d{1,2}(:\d{2}){1,2}-\d{1,2}(:\d{2}){1,2}$/.test(x)); }
function ytPipeText(kind) {
  const i = ytPipeIdea(), title = i ? i.title : '주제', dir = ytFolder(title), D = `~/Movies/FIELDNOTE/${dir}`, url = ytPipe.url || '<영상 URL>', rg = ytRanges(), sh = ytPipe.format !== 'long';
  switch (kind) {
    case 'research': return `/source-check-research ${title} — 레슬링 해설 ${sh ? '쇼츠' : '롱폼'} 대본용. 쓰임새: 영상 대본, 범위: 최근 기록 우선·한국어와 영어. 선수·대회·기록·규정 위주로 조사하고 결과를 ${D}/research.md 로 저장해줘`;
    case 'research-chat': return i ? researchPrompt(i) : '';
    case 'download': return `/yt-source-download ${url} ${rg.length ? rg.join(' ') : '<시작-끝 예: 0:30-0:45>'} 주제:${dir}`;
    case 'download-term': return `mkdir -p ${D.replace(dir, `"${dir}"`)}/원본 && yt-dlp -f "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[ext=mp4]/b" --merge-output-format mp4 ${(rg.length ? rg : ['0:00-0:15']).map(r => `--download-sections "*${r}"`).join(' ')} --force-keyframes-at-cuts -o ${D.replace(dir, `"${dir}"`)}/원본/"%(channel)s_%(id)s_%(section_start)s.%(ext)s" "${url}"`;
    case 'script': return sh
      ? `/shorts-blueprint ${title} — 길이 45초, 소스: ${D}/원본/ 클립에서 뽑기(sources.md 참고), 시청자: ${YT_AUDIENCE}, 말투: 친구에게 말하듯. 반복 구조 필수 — ${YT_REPEAT}. 사실은 ${D}/research.md 의 A·B 등급만 쓰고, 결과를 ${D}/편집/대본.md 로 저장해줘`
      : `/hook-first-script ${title} — 길이 8~12분, 시청자: ${YT_AUDIENCE}, 말투: 친구에게 말하듯, 자료: ${D}/research.md (A·B 등급만, 나머지는 자료 확인 필요 목록으로). 원본 경기 장면은 몇 초씩만 쓰는 해설 영상이야. 결과를 ${D}/편집/대본.md 로 저장해줘`;
    case 'plan': return `/edit-plan-sheet ${D} — 대본: 편집/대본.md, 클립: 원본/ (sources.md 참고), 형식: ${sh ? '세로 쇼츠 45초' : '가로 롱폼 10분'}, 분위기: ${sh ? '빠름' : '다큐'}. 소리: 나레이션은 내 목소리(Adobe Podcast로 잡음 정리), BGM·효과음은 YouTube 오디오 보관함·캡컷 상업용만, 원본 경기 소리는 끔, BGM은 나레이션보다 15~20dB 낮게.${sh ? ' 기술 반복 소리: 원속도 구간에 임팩트 효과음, 슬로우 구간은 BGM 낮추고 해설.' : ''}${sh ? ' 컷 리스트에 기술 반복 3구간(원속도 → 0.5배 슬로우+화살표 → 원속도)을 표시하고 마지막 컷이 첫 컷으로 이어지게.' : ''} 결과를 ${D}/편집/편집계획표.md 로 저장해줘`;
    case 'rough': return `/rough-cut ${dir} 형식:${sh ? '세로 반복:3' : '가로'}`;
    case 'upload': return `/upload-pack-maker ${dir} — ${sh ? '쇼츠' : '롱폼'}. 대본: ${D}/편집/대본.md, 시청자: ${YT_AUDIENCE}. 설명란에 ${D}/sources.md 의 원본 채널·영상 제목·URL·사용 구간, 사용한 음악·효과음 출처, "경기 장면은 해설·분석 목적으로 일부만 사용했습니다"를 넣고, 결과를 ${D}/업로드/업로드팩.md 로 저장해줘`;
  }
  return '';
}
// 설치된 스킬 (~/.claude/skills)
const YT_SKILLS = [
  { id:'source-check-research', stage:'01 자료조사', by:'sphereai.work', does:'질문 쪼개기 → 한·영 검색 → 출처 등급(A/B/C) → 교차 확인 → 확인 못 한 것 표시', out:'research.md · 결론, 근거 표, 확인 못 한 것', kind:'research', zip:true },
  { id:'yt-source-download', stage:'02 소스 다운로드', by:'FIELDNOTE', does:'필요한 구간만 yt-dlp로 받고 출처(채널·제목·URL·구간)를 자동 기록', out:'원본/ 클립 + sources.md', kind:'download' },
  { id:'shorts-blueprint', stage:'03 편집 · 대본(쇼츠)', by:'sphereai.work', does:'15~60초 쇼츠: 1.5초 훅, 컷 하나에 정보 하나, 반복 시청 구조, 세로 안전 영역, 자막 규칙', out:'편집/대본.md · 훅 3안 + 컷 리스트', kind:'script', fmt:'shorts', zip:true },
  { id:'hook-first-script', stage:'03 편집 · 대본(롱폼)', by:'sphereai.work', does:'3~20분 롱폼: 15초 훅, 약속, 열린 고리 있는 파트, 정리, 컷 메모', out:'편집/대본.md · 제목 3안 + 훅 3안', kind:'script', fmt:'long', zip:true },
  { id:'edit-plan-sheet', stage:'03 편집 · 계획표', by:'sphereai.work', does:'컷 리스트, 리듬, 자막 규칙, 나레이션·BGM·효과음 계획, 최종 점검표', out:'편집/편집계획표.md', kind:'plan', zip:true },
  { id:'rough-cut', stage:'03 편집 · 러프컷', by:'FIELDNOTE', does:'계획표대로 원본을 잘라 이어 붙이고 세로(1080×1920)·가로(1920×1080) 러프컷 + 자막 SRT', out:'편집/러프컷_세로|가로.mp4 + 자막.srt', kind:'rough' },
  { id:'upload-pack-maker', stage:'04 업로드', by:'sphereai.work', does:'제목 후보 10 → 추천 3, 설명란(첫 두 줄·챕터·출처), 태그, 썸네일 3안 + 구글 Flow 썸네일 이미지 절차', out:'업로드/업로드팩.md', kind:'upload', zip:true },
];
const YT_PIPELINE = [
  { title:'자료조사', what:'선수·대회·기록·규정을 찾아 출처 등급을 붙이고, 핵심 사실은 2곳 이상에서 교차 확인합니다.', out:'research.md', skills:[['자료조사', 'research']], chat:true },
  { title:'소스 다운로드', what:'필요한 장면만 구간으로 받습니다. 한 구간 15초 이하, 출처는 sources.md에 자동 기록됩니다.', out:'원본/ 클립 + sources.md', skills:[['구간 다운로드', 'download']], inputs:true, links:[['레슬링 소스 ' + WRESTLING_SOURCES.length + '곳', '@ytSources']] },
  { title:'편집', what:'대본 → 편집 계획표 → 러프컷 순서. 마지막에 캡컷에서 내 목소리 해설과 화살표·멈춤 화면을 얹습니다.', out:'대본.md · 편집계획표.md · 러프컷 · 자막.srt', skills:[['① 대본', 'script'], ['② 편집 계획표', 'plan'], ['③ 러프컷', 'rough']], links:[['🎧 음악·음성 고르기', '#ytAudio'], ['캡컷', 'https://www.capcut.com/'], ['Vrew', 'https://vrew.ai/'], ['Vizard', 'https://vizard.ai/', 'long'], ['OpusClip', 'https://www.opus.pro/', 'long']] },
  { title:'업로드', what:'제목·설명란(출처 포함)·태그·썸네일을 만들고, 확인 후 YouTube Studio에 올린 뒤 게시 확인에 링크를 남깁니다.', out:'업로드팩.md', skills:[['업로드 패키지', 'upload']], links:[['YouTube Studio', 'https://studio.youtube.com/'], ['구글 Flow (썸네일)', 'https://labs.google/fx/tools/flow', 'long']], publish:true },
];
function ytSkillOf(kind) { return YT_SKILLS.find(s => s.kind === kind && (!s.fmt || s.fmt === ytPipe.format)); }
function ytPipeline() {
  const cur = ytPipeIdea(), sh = ytPipe.format !== 'long';
  if (cur && !ytPipe.url) ytPipe.url = ytFirstUrl(cur);
  const fmtBtn = f => `<button class="yp-fmt ${ytPipe.format === f ? 'active' : ''}" data-yp-format="${f}" aria-pressed="${ytPipe.format === f}">${f === 'long' ? '🎬 롱폼' : '📱 쇼츠'} <b>${ytFmtIdeas(f).length}</b></button>`;
  const sel = `<div class="yp-fmts">${fmtBtn('shorts')}${fmtBtn('long')}</div><label class="yp-topic"><span>작업할 주제</span><select data-yp-idea aria-label="작업할 주제">${ytFmtIdeas(ytPipe.format).map(i => `<option value="${esc(i.id)}" ${cur && i.id === cur.id ? 'selected' : ''}>${esc(i.title)}</option>`).join('')}</select></label><span class="small">폴더 · ~/Movies/FIELDNOTE/<b data-yp-folder>${esc(ytFolder(cur?.title))}</b></span>`;
  const skillRow = ([label, kind]) => { const sk = ytSkillOf(kind); return `<div class="yp-skill"><span class="yp-skill-name">${esc(label)} · <button class="linkbtn" data-view="ytSkills">/${esc(sk.id)}</button></span><code data-yp-cmd="${kind}">${esc(ytPipeText(kind))}</code><button class="btn primary" data-yp-copy="${kind}">명령 복사</button></div>`; };
  const card = (st, idx) => `<li class="yp-stage"><div class="yp-head"><span class="yp-n">${String(idx + 1).padStart(2, '0')}</span><h3>${esc(st.title)}</h3></div>
    <p class="yp-what">${esc(st.what)}</p>${ytStageTools(idx)}<p class="yp-out"><b>결과물</b>${esc(st.out)}</p>
    ${st.inputs ? `<div class="yp-inputs"><label>영상 URL<input class="input" data-yp-field="url" value="${esc(ytPipe.url)}" placeholder="https://www.youtube.com/watch?v=…"></label><label>구간 (쉼표로 여러 개)<input class="input" data-yp-field="ranges" value="${esc(ytPipe.ranges)}" placeholder="0:30-0:45, 1:10-1:20"></label></div>` : ''}
    <div class="yp-skills">${st.skills.map(skillRow).join('')}
      ${st.chat ? '<button class="btn ghost" data-yp-copy="research-chat">claude.ai 채팅용으로 복사</button>' : ''}
      ${st.inputs ? '<details class="yp-term"><summary>터미널 명령으로 직접</summary><code data-yp-cmd="download-term">' + esc(ytPipeText('download-term')) + '</code><button class="btn ghost" data-yp-copy="download-term">터미널 명령 복사</button></details>' : ''}</div>
    <div class="yp-tools">${(st.links || []).filter(l => !l[2] || l[2] === ytPipe.format).map(([l, u]) => u.startsWith('@') ? `<button class="linkbtn" data-view="${u.slice(1)}">${esc(l)} →</button>` : u.startsWith('#') ? `<button class="linkbtn" data-yp-jump="${u.slice(1)}">${esc(l)} ↓</button>` : `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(l)} ↗</a>`).join('')}${st.publish ? '<button class="linkbtn" data-view="publish">게시 확인 →</button>' : ''}</div>
  </li>`;
  return `<section class="yp" style="--pc:${platformColor('YouTube')}"><div class="yp-top"><h2>제작 라인 <span class="small">자료조사 → 소스 다운로드 → 편집 → 업로드 · ${sh ? '쇼츠 15~60초 세로' : '롱폼 8~12분 가로'}</span></h2>${sel}</div>
    ${ytOrchestration()}<ol class="yp-stages">${YT_PIPELINE.map(card).join('')}</ol>
    <p class="small yp-foot">'명령 복사' → Claude Code 새 대화에 붙여 넣기 → 그 단계 스킬이 실행됩니다. 모든 단계가 같은 주제 폴더를 이어 씁니다. 원본 경기 장면은 한 번에 몇 초만, 중심은 내 해설입니다.</p></section>`;
}
function ytSkillsPage() {
  if (!ytPipeIdea()) ytPipe.format = ytFmtIdeas('shorts').length ? 'shorts' : 'long';
  const cur = ytPipeIdea();
  const card = s => { const ex = s.fmt && s.fmt !== ytPipe.format ? null : ytPipeText(s.kind); return `<article class="sk-card"><div class="sk-head"><span class="sk-stage">${esc(s.stage)}</span><span class="sk-by ${s.by === 'FIELDNOTE' ? 'own' : ''}">${esc(s.by)}</span></div>
    <h3>/${esc(s.id)}</h3><p>${esc(s.does)}</p><p class="yp-out"><b>결과물</b>${esc(s.out)}</p>
    <p class="sk-where">✅ 설치됨 · ~/.claude/skills/${esc(s.id)}${s.zip ? ' · claude.ai용 ZIP 있음' : ' · Claude Code 전용(내 컴퓨터에서 실행)'}</p>
    ${ex ? `<code>${esc(ex)}</code><button class="btn primary" data-yp-copy="${s.kind}">이 주제로 명령 복사</button>` : `<p class="small">${s.fmt === 'long' ? '롱폼' : '쇼츠'} 주제를 고르면 명령이 만들어집니다.</p>`}</article>`; };
  return head('YouTube 스킬', `설치된 스킬 ${YT_SKILLS.length}개 · 제작 라인 단계 순서`, false)
    + `<div class="sk-top"><span>예시 명령에 쓰는 주제</span><strong>${esc(cur ? cur.title : '없음')}</strong><span class="small">${ytPipe.format === 'long' ? '롱폼' : '쇼츠'} · 작업판에서 바꿀 수 있습니다</span></div>`
    + `<div class="sk-grid">${YT_SKILLS.map(card).join('')}</div>`
    + `<section class="panel sk-how"><h2>쓰는 법</h2><ol><li><b>Claude Code</b>: '명령 복사' → 새 대화에 붙여 넣기. 또는 그냥 "하빕 주제 자료조사해줘"처럼 말해도 맞는 스킬이 실행됩니다.</li><li><b>claude.ai / 데스크톱 채팅</b>: 바탕화면 CLAUDE 폴더의 fieldnote-youtube-skills.zip을 풀어 각 폴더를 ZIP으로 설정 → 기능 → 스킬에 업로드. 다운로드·러프컷은 내 컴퓨터 파일을 다뤄서 Claude Code에서만 됩니다.</li><li>스킬 원본: sphereai.work 무료 스킬 5개 + FIELDNOTE용 2개(소스 다운로드, 러프컷).</li></ol></section>`;
}
function ytPipeRefresh() { document.querySelectorAll('[data-yp-cmd]').forEach(el => { el.textContent = ytPipeText(el.dataset.ypCmd); }); const f = document.querySelector('[data-yp-folder]'); if (f) f.textContent = ytFolder(ytPipeIdea()?.title); }
function ytPick(id) { const i = db.ideas.find(x => x.id === id); if (!i) return; ytPipe.format = ytFormatOf(i); ytPipe.ideaId = id; ytPipe.url = ytFirstUrl(i); ytPipe.ranges = ''; }
document.addEventListener('input', e => { const f = e.target.closest?.('[data-yp-field]'); if (!f) return; ytPipe[f.dataset.ypField] = f.value; ytPipeRefresh(); });
document.addEventListener('change', e => {
  const s = e.target.closest?.('select[data-yp-idea]'); if (s) { ytPick(s.value); render(); return; }
  const f = e.target.closest?.('select[data-yt-format-set]'); if (f) { const i = db.ideas.find(x => x.id === f.dataset.ytFormatSet); if (i) { i.ytFormat = f.value; persist(); render(); } }
});
document.addEventListener('click', async e => {
  const fm = e.target.closest('button[data-yp-format]'); if (fm) { ytPipe.format = fm.dataset.ypFormat; ytPipe.ideaId = ''; ytPipe.url = ''; ytPipe.ranges = ''; render(); return; }
  const pk = e.target.closest('button[data-yp-pick]'); if (pk) { ytPick(pk.dataset.ypPick); render(); document.querySelector('.yp')?.scrollIntoView({ behavior: 'smooth' }); return; }
  const j = e.target.closest('button[data-yp-jump]'); if (j) { const d = document.getElementById(j.dataset.ypJump); if (d) { d.open = true; d.scrollIntoView({ behavior: 'smooth' }); } return; }
  const b = e.target.closest('button[data-yp-copy]'); if (!b) return;
  const ok = await copyText(ytPipeText(b.dataset.ypCopy));
  toast(ok ? (b.dataset.ypCopy === 'research-chat' ? 'claude.ai 채팅에 붙여 넣으세요.' : b.dataset.ypCopy === 'download-term' ? '터미널에 붙여 넣으세요.' : 'Claude Code 새 대화에 붙여 넣으세요.') : '복사에 실패했어요.');
});

// ===== YouTube '소스' 탭: 내가 준 레슬링 소스 채널 전부 =====
function ytSourcesPage() {
  const cur = YT_SOURCE_CHANNELS.find(c => c.id === ytSrcTab) || YT_SOURCE_CHANNELS[0];
  const total = YT_SOURCE_CHANNELS.reduce((n, c) => n + c.sources.length, 0);
  const tabs = `<div class="yp-fmts" style="margin-bottom:14px">${YT_SOURCE_CHANNELS.map(c => `<button class="yp-fmt ${c.id === cur.id ? 'active' : ''}" data-src-ch="${c.id}" aria-pressed="${c.id === cur.id}">${c.emoji} ${esc(c.tab)} <b>${c.sources.length}</b></button>`).join('')}</div>`;
  const body = cur.sources.length
    ? wrestlingSourceLibrary(cur.sources)
    : `<div class="empty" style="border:1px dashed var(--line);border-radius:10px">${cur.emoji} <b>${esc(cur.tab)}</b>가 아직 비어 있습니다.<br><span class="small">참고할 유튜브 채널을 알려주면 이 탭에 박스로 추가됩니다.</span></div>`;
  return head('YouTube 소스', `3개 채널 · 소스 ${total}곳 · 탭으로 채널을 고르세요. '⬇ 제작 라인'을 누르면 그 영상이 소스 다운로드 칸에 들어갑니다`, false)
    + tabs
    + `<section class="panel"><div class="sectionhead" style="margin-top:0"><h2>${cur.emoji} ${esc(cur.tab)}</h2><span class="small">${cur.sources.length}개 채널</span></div>${body}</section>`
    + `<div class="actions" style="margin-top:14px"><button class="btn ghost" data-workflow="import">쇼츠 백업 가져오기</button></div>`;
}
document.addEventListener('click', e => {
  const t = e.target.closest('button[data-src-ch]'); if (!t) return;
  ytSrcTab = t.dataset.srcCh; render();
});
document.addEventListener('click', e => {
  const b = e.target.closest('button[data-yp-src]'); if (!b) return;
  ytPipe.url = b.dataset.ypSrc; ytPipe.ranges = '';
  navigate('youtube');
  setTimeout(() => { document.querySelector('[data-yp-field="ranges"]')?.focus(); document.querySelectorAll('.yp-stage')[1]?.scrollIntoView({ behavior: 'smooth', block: 'center' }); toast('소스 다운로드 칸에 영상을 넣었어요. 구간을 적고 명령을 복사하세요.'); }, 50);
});

// ===== YouTube 음악 · 음성 가이드 =====
const YT_AUDIO = [
  { key:'voice', icon:'🎙', title:'음성 (나레이션)', lead:'기본은 내 목소리. 채널의 얼굴이 되고, 재사용 콘텐츠 판정도 피합니다.', items:[
    ['내 목소리 녹음', 'QuickTime 또는 캡컷 녹음. 조용한 방, 입과 마이크 한 뼘. 이어폰 마이크로 시작해도 됩니다.', '무료', ''],
    ['Adobe Podcast Enhance', '녹음 파일의 잡음·울림을 지워 스튜디오처럼 만들어 줍니다.', '무료(한도)', 'https://podcast.adobe.com/enhance'],
    ['캡컷 음성 향상·노이즈 감소', '편집하면서 바로 잡음 정리.', '부분 유료', 'https://www.capcut.com/'],
    ['ElevenLabs', '목소리를 안 낼 때만. 한국어 AI 목소리가 가장 자연스러운 편. 상업 이용은 유료 플랜 조건 확인.', '부분 유료', 'https://elevenlabs.io/text-to-speech'],
    ['Vrew AI 목소리 · 클로바더빙', '한국어 TTS 대안. 수익 채널에 쓰기 전 상업 이용 조건 확인.', '부분 유료', 'https://clovadubbing.naver.com/'],
  ]},
  { key:'music', icon:'🎵', title:'배경음악 (BGM)', lead:'수익 창출 채널은 저작권이 깨끗한 곳에서만 고릅니다.', items:[
    ['YouTube 오디오 보관함', '1순위. 무료이고 유튜브 수익화에 안전. Studio → 오디오 보관함에서 장르·분위기로 검색.', '무료', 'https://www.youtube.com/audiolibrary'],
    ['Epidemic Sound', '곡이 많고 운동·격투 분위기 곡이 풍부. 채널을 등록하면 저작권 클레임이 해제됩니다.', '유료 구독', 'https://www.epidemicsound.com/'],
    ['Artlist', 'Epidemic 대안. 둘 중 하나만.', '유료 구독', 'https://artlist.io/'],
    ['캡컷 음악', "'상업용' 표시된 곡만. 표시 없는 인기곡은 유튜브에서 클레임이 걸릴 수 있습니다.", '부분 유료', 'https://www.capcut.com/'],
    ['Pixabay 음악', '무료 대안. 가끔 클레임이 오니 이의 제기용으로 다운로드 페이지를 저장해 둡니다.', '무료', 'https://pixabay.com/music/'],
  ]},
  { key:'sfx', icon:'💥', title:'효과음', lead:'기술이 들어가는 순간에만. 이유 없는 효과음은 빼기.', items:[
    ['캡컷 효과음', '임팩트(쿵)·휙(whoosh)·슬로우모션 효과음을 바로 끌어다 씁니다.', '부분 유료', 'https://www.capcut.com/'],
    ['YouTube 오디오 보관함 효과음', '무료, 수익화 안전.', '무료', 'https://www.youtube.com/audiolibrary'],
    ['Pixabay 효과음', '무료 효과음 대안.', '무료', 'https://pixabay.com/sound-effects/'],
  ]},
];
const YT_AUDIO_SHORTS = [
  ['① 원속도', '기술 들어가는 순간 임팩트(쿵) 효과음 + 빠른 비트 BGM'],
  ['② 슬로우', 'BGM을 15~20dB 낮추고 슬로우 효과음(우웅) + 내 해설'],
  ['③ 원속도', '같은 임팩트 효과음 + BGM 다시 크게 → 첫 장면으로 이어짐'],
];
const YT_AUDIO_LONG = [
  ['해설 구간', '차분한 BGM을 아주 낮게, 또는 BGM 없이'],
  ['파트 전환', '짧은 휙 효과음 하나'],
  ['경기 장면 강조', '그 몇 초만 효과음, 해설은 장면이 끝난 뒤'],
];
const YT_AUDIO_RULES = [
  '원본 경기 영상의 소리(중계 해설·경기장 음악)는 끕니다. 저작권 클레임 원인 1순위입니다.',
  '인기곡·K-pop은 쓰지 않습니다. 수익이 원곡자에게 가거나 영상이 막힐 수 있습니다.',
  '나레이션이 주인공. BGM은 나레이션보다 15~20dB 낮게 시작해 귀로 맞춥니다.',
  '쓴 음악·효과음의 출처(사이트·곡 이름)를 sources.md에 함께 적어 둡니다.',
  'AI 목소리를 쓰면 각 서비스의 상업 이용 조건과 유튜브 표기 정책을 확인합니다.',
];
function ytAudioGuide() {
  const sh = ytPipe.format !== 'long';
  const col = g => `<div class="ya-col"><h3>${g.icon} ${esc(g.title)}</h3><p class="small">${esc(g.lead)}</p><ul>${g.items.map(([n, d, price, url], k) => `<li class="${k === 0 ? 'ya-top' : ''}"><div class="ya-name">${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(n)} ↗</a>` : `<b>${esc(n)}</b>`}<span class="tc-price ${priceClass(price.startsWith('무료') ? '무료' : price === '유료 구독' ? '유료' : '부분 유료')}">${esc(price)}</span></div><p>${esc(d)}</p></li>`).join('')}</ul></div>`;
  const tl = (sh ? YT_AUDIO_SHORTS : YT_AUDIO_LONG).map(([a, b]) => `<li><b>${esc(a)}</b><span>${esc(b)}</span></li>`).join('');
  return `<section class="panel ya" id="ytAudio" style="--pc:${platformColor('YouTube')}"><div class="sectionhead" style="margin-top:0"><h2>🎧 음악 · 음성</h2><span class="small">무엇을 쓰고, 어디에 붙이는지 · 지금 ${sh ? '쇼츠' : '롱폼'} 기준</span></div>
    <div class="ya-start"><b>처음 구성</b>내 목소리 + Adobe Podcast로 잡음 정리 · BGM과 효과음은 YouTube 오디오 보관함 + 캡컷 효과음 → 전부 무료. 영상이 쌓이면 Epidemic Sound 하나만 추가.</div>
    <div class="ya-cols">${YT_AUDIO.map(col).join('')}</div>
    <div class="ya-bottom"><div><h3>${sh ? '쇼츠 · 기술 3번 반복에 소리 붙이기' : '롱폼 · 소리 배치'}</h3><ol class="ya-tl">${tl}</ol></div>
    <div><h3>지킬 것</h3><ul class="ya-rules">${YT_AUDIO_RULES.map(r => `<li>${esc(r)}</li>`).join('')}</ul></div></div></section>`;
}

// ===== 도구 로고 배지 (스택 표 기준) — 대표색 + 이니셜로 직접 만든 배지 =====
const TOOL_LOGOS = {
  claudecode: { name:'Claude Code', bg:'#2a1a14', fg:'#e8875f', mark:'>_' },
  codex:      { name:'Codex CLI', bg:'#0d2a22', fg:'#3fd1a0', mark:'Cx' },
  grok:       { name:'Grok', bg:'#0b0b0b', fg:'#f2f2f2', mark:'G', ring:'#f2f2f2' },
  deepseek:   { name:'DeepSeek API', bg:'#1b2a6b', fg:'#9db1ff', mark:'DS' },
  claude:     { name:'Claude', bg:'#d97757', fg:'#fff4ec', mark:'C' },
  ytdlp:      { name:'yt-dlp', bg:'#3a0d0d', fg:'#ff5a5a', mark:'↓' },
  score:      { name:'채점 스크립트', bg:'#2a3a12', fg:'#c4f27b', mark:'✓' },
  gptimage:   { name:'GPT Image', bg:'#10372c', fg:'#7ee0bd', mark:'GI' },
  html2png:   { name:'HTML→PNG', bg:'#3d1a10', fg:'#ff8a5c', mark:'</>' },
  muse:       { name:'Muse', bg:'#2c1650', fg:'#c5a3ff', mark:'M' },
  kling:      { name:'Kling i2v', bg:'#0f2f2b', fg:'#5ef0d0', mark:'K' },
  eleven:     { name:'ElevenLabs PVC', bg:'#121212', fg:'#ffffff', mark:'II' },
  whisper:    { name:'Whisper', bg:'#13302a', fg:'#8ce3c6', mark:'W' },
  playwright: { name:'Playwright', bg:'#123a1a', fg:'#6fd47b', mark:'PW' },
  ffmpeg:     { name:'FFmpeg', bg:'#0c2a0c', fg:'#4cc94c', mark:'FF' },
  frame:      { name:'프레임 감사', bg:'#2a2a12', fg:'#f2c94c', mark:'▦' },
  spec:       { name:'규격 검사', bg:'#2a2412', fg:'#f5b560', mark:'⛶' },
  lufs:       { name:'음량 정규화', bg:'#2a1a12', fg:'#ffa26b', mark:'dB' },
  cdp:        { name:'Chrome CDP', bg:'#102545', fg:'#7fb0ff', mark:'CDP' },
  ytstudio:   { name:'YouTube Studio', bg:'#3a0d0d', fg:'#ff6b6b', mark:'▶' },
  cron:       { name:'cron', bg:'#2d2410', fg:'#f5c46a', mark:'⏱' },
  sqlite:     { name:'SQLite', bg:'#0e2a3d', fg:'#6cc3f5', mark:'SQ' },
  capcut:     { name:'캡컷', bg:'#f2f2f2', fg:'#111111', mark:'CC' },
};
function toolLogoSvg(id, size = 26) {
  const t = TOOL_LOGOS[id]; if (!t) return '';
  const fs = t.mark.length >= 3 ? 8.5 : t.mark.length === 2 ? 10.5 : 14;
  return `<svg class="tl-svg" width="${size}" height="${size}" viewBox="0 0 26 26" aria-hidden="true"><rect x="0.5" y="0.5" width="25" height="25" rx="7" fill="${t.bg}" stroke="${t.ring || 'rgba(255,255,255,.14)'}"/><text x="13" y="13.5" text-anchor="middle" dominant-baseline="central" font-family="ui-monospace,Menlo,monospace" font-weight="800" font-size="${fs}" fill="${t.fg}">${esc(t.mark)}</text></svg>`;
}
function toolLogo(id) { const t = TOOL_LOGOS[id]; return t ? `<span class="tlg" title="${esc(t.name)}">${toolLogoSvg(id, 22)}<span>${esc(t.name)}</span></span>` : ''; }
function toolLayer(label, ids, joiner = '') { return `<div class="tl-layer"><span class="tl-label">${esc(label)}</span><span class="tl-row">${ids.map(toolLogo).join(joiner ? `<span class="tl-join">${joiner}</span>` : '')}</span></div>`; }
const YT_STAGE_TOOLS = [
  [['리서치', ['grok', 'deepseek']], ['정리·출처', ['claude']]],
  [['리서치', ['ytdlp']]],
  [['원고', ['claude', 'score'], '+'], ['이미지', ['gptimage', 'html2png']], ['영상 생성', ['muse', 'kling'], '→'], ['음성', ['eleven', 'whisper']], ['렌더', ['playwright', 'ffmpeg'], '+'], ['품질 검사', ['frame', 'spec', 'lufs']], ['마무리 편집', ['capcut']]],
  [['게시', ['cdp', 'ytstudio']], ['지표', ['cron', 'sqlite'], '+']],
];
function ytStageTools(idx) { return `<div class="tl-stage">${(YT_STAGE_TOOLS[idx] || []).map(([l, ids, j]) => toolLayer(l, ids, j)).join('')}</div>`; }
function ytOrchestration() { return `<div class="tl-orch">${toolLayer('오케스트레이션', ['claudecode'])}${toolLayer('대량 작업', ['codex'])}<span class="small">모든 단계를 지휘하고 반복 작업을 돌립니다</span></div>`; }

// ===== YouTube 'GitHub 모음집' 탭 (별 수는 2026.11.08 GitHub API 기준) =====
const GH_GROUPS = [
  { icon:'🔍', title:'소재·트렌드 찾기', stage:'01 자료조사', color:'#4fb3ff', items:[
    { star:true, name:'Agent-Reach', repo:'Panniantong/Agent-Reach', stars:110055, desc:'레딧·유튜브·X 글을 AI가 모아 정리. "요즘 이 주제로 뭐가 뜨냐"를 실제 글로 확인할 때 가장 많이 씀.', tip:'한 번에 너무 많이 긁으면 IP가 막힘(1시간 차단 경험). 조금씩.' },
    { star:true, name:'agbrowse', repo:'lidge-jun/agbrowse', stars:233, desc:'AI가 로그인해 둔 크롬을 직접 조작. 일반 수집이 안 되는 사이트 글 읽기, 웹 ChatGPT로 이미지 뽑기·질문(토큰 절약).' },
  ]},
  { icon:'✍️', title:'대본·윤문', stage:'03 편집 · 대본', color:'#c4f27b', items:[
    { star:false, name:'휴먼라이즈 코리안 (im-not-ai)', repo:'epoko77-ai/im-not-ai', stars:6443, desc:'AI 글 특유의 번역투·딱딱한 나열을 한국인 말투로. 내용은 그대로, 말투만.', tip:'대본 쓸 때 "조사한 내용(Agent-Reach 결과)에 있는 것만 써"라고 박아 두면 헛소리가 확 줄어듦. 윤문 후 디테일은 직접.' },
  ]},
  { icon:'🎙', title:'목소리', stage:'03 편집 · 음성', color:'#ff7ac8', items:[
    { star:true, name:'Voicebox', repo:'jamiepine/voicebox', stars:60023, desc:'내 목소리 몇 개 녹음 → 클로닝하는 AI 보이스 스튜디오. 내 컴퓨터에서 돌아가 무료·무제한, API로 문장마다 자동 생성.', tip:'시드 고정 + "숨소리 없이 첫 음절부터 바로" 지시를 넣으면 톤이 일정해짐.' },
    { star:false, name:'Qwen3-TTS', repo:'QwenLM/Qwen3-TTS', stars:14279, desc:'Voicebox 안에서 실제로 목소리를 만드는 모델. 원리가 궁금할 때.' },
    { star:false, name:'edge-tts', repo:'rany2/edge-tts', stars:12484, desc:'API 키 없는 무료 TTS. 영어 원문·댓글을 다른 목소리로 구분해 읽힐 때.' },
  ]},
  { icon:'🖼', title:'영상 소스·이미지', stage:'02 소스 다운로드', color:'#ff6b6b', items:[
    { star:true, name:'yt-dlp', repo:'yt-dlp/yt-dlp', stars:206063, desc:'원하는 구간만 잘라 받기. 공식 클립에서 몇 초만 따올 때. 이 컴퓨터에 설치됨, /yt-source-download 스킬이 사용.' },
  ]},
  { icon:'🎬', title:'편집·렌더', stage:'03 편집 · 렌더', color:'#b9a1f5', items:[
    { star:true, name:'Remotion', repo:'remotion-dev/remotion', stars:71554, desc:'코드로 영상 만들기. 자막·레이아웃 템플릿을 한 번 만들면 대본·목소리·이미지만 갈아 끼워 계속 렌더.', tip:'AI가 Remotion을 잘 다루게 하는 공식 스킬: remotion-dev/skills', extra:['Remotion 공식 스킬', 'remotion-dev/skills'] },
    { star:false, name:'HyperFrames', repo:'heygen-com/hyperframes', stars:80666, desc:'HTML로 모션그래픽. 인트로·타이틀 같은 짧은 장면. Claude Code에 스킬로 설치되어 있음.' },
    { star:false, name:'video-use', repo:'browser-use/video-use', stars:30713, desc:'"앞부분 자르고 자막 넣어 줘"처럼 말로 시키는 편집 스킬. 찍어 둔 영상 다듬기.' },
  ]},
  { icon:'✅', title:'검수', stage:'03 편집 · 품질 검사', color:'#f5b560', items:[
    { star:false, name:'mlx-whisper', repo:'ml-explore/mlx-examples', path:'/tree/main/whisper', stars:9059, desc:'맥에서 돌아가는 받아쓰기. 만든 목소리를 다시 받아써 대본과 비교 → 발음이 이상하면 다시 생성. 일일이 안 들어도 됨.' },
    { star:false, name:'watch (claude-video)', repo:'bradautomates/claude-video', stars:20168, desc:'AI가 영상을 직접 보게 하는 스킬. 잘되는 채널 영상 분석, 완성본 최종 확인.' },
  ]},
  { icon:'🧰', title:'올인원·작업 보조', stage:'전체', color:'#8b929e', items:[
    { star:false, name:'OpenMontage', repo:'OpenMontageInc/OpenMontage', stars:78368, desc:'조사→대본→목소리→편집을 한 번에 하는 영상 제작 에이전트. 바로 쓰기보다 구조 참고용.' },
    { star:false, name:'caveman', repo:'JuliusBrussee/caveman', stars:118197, desc:'AI 답변을 짧게 핵심만. 작업이 길어질수록 토큰 차이가 큼.' },
  ]},
];
function ghStars(n) { return n >= 1000 ? (n / 1000).toFixed(n >= 10000 ? 0 : 1) + 'k' : String(n); }
function ghBadge(name, color) { const m = name.replace(/[^A-Za-z가-힣0-9]/g, '').slice(0, 2); return `<svg class="tl-svg" width="34" height="34" viewBox="0 0 26 26" aria-hidden="true"><rect x="0.5" y="0.5" width="25" height="25" rx="7" fill="#0f1216" stroke="${color}"/><text x="13" y="13.5" text-anchor="middle" dominant-baseline="central" font-family="ui-monospace,Menlo,monospace" font-weight="800" font-size="10" fill="${color}">${esc(m)}</text></svg>`; }
function ytGithubPage() {
  const total = GH_GROUPS.reduce((a, g) => a + g.items.length, 0);
  const card = (g, it) => { const url = `https://github.com/${it.repo}${it.path || ''}`; return `<article class="gh-card" style="--gc:${g.color}">
    <div class="gh-head">${ghBadge(it.name, g.color)}<div><h3>${it.star ? '⭐️ ' : '➕ '}${esc(it.name)}</h3><a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(it.repo)} ↗</a></div><span class="gh-stars">★ ${ghStars(it.stars)}</span></div>
    <p>${esc(it.desc)}</p>${it.tip ? `<p class="gh-tip">💡 ${esc(it.tip)}</p>` : ''}
    ${it.extra ? `<a class="gh-extra" href="https://github.com/${esc(it.extra[1])}" target="_blank" rel="noopener noreferrer">${esc(it.extra[0])} ↗</a>` : ''}
    <button class="btn ghost gh-copy" data-gh-copy="https://github.com/${esc(it.repo)}.git">git clone 주소 복사</button></article>`; };
  return head('GitHub 모음집', `영상 제작에 쓰는 오픈소스 ${total}개 · ⭐️ 주력 / ➕ 보조 · 제작 라인 단계 순서`, false)
    + `<nav class="gh-jump">${GH_GROUPS.map((g, i) => `<button class="filter" style="--gc:${g.color}" data-yp-jump="gh-${i}">${g.icon} ${esc(g.title)} <b>${g.items.length}</b></button>`).join('')}</nav>`
    + GH_GROUPS.map((g, i) => `<section class="gh-group" id="gh-${i}" style="--gc:${g.color}"><div class="gh-group-head"><h2>${g.icon} ${i + 1}. ${esc(g.title)}</h2><span class="gh-stage">제작 라인 · ${esc(g.stage)}</span></div><div class="gh-grid">${g.items.map(it => card(g, it)).join('')}</div></section>`).join('')
    + `<p class="small" style="margin-top:16px">별 수는 2026년 11월 8일 GitHub 기준입니다. 설치 전 각 저장소의 README와 라이선스를 확인하세요.</p>`;
}
document.addEventListener('click', async e => { const b = e.target.closest('button[data-gh-copy]'); if (!b) return; const ok = await copyText('git clone ' + b.dataset.ghCopy); toast(ok ? 'git clone 명령을 복사했어요.' : '복사에 실패했어요.'); });
