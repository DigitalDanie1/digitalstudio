/* FIELDNOTE - YouTube Stickman 탭 (drop-in). 원본 도구: github.com/kaomei/stickman-video-director (MIT)
   사이드바에 'Youtube - Stickman' 을 붙이고, 누르면 #content 를 이 화면으로 바꿔요. 다른 탭을 누르면 앱이 원래대로 다시 그려요. */
(function(){
  if(window.__stickman)return;window.__stickman=1;
  const PC='#e9e4d8',KEY='fieldnote-stickman-v1',REPO='https://github.com/kaomei/stickman-video-director';
  const CDN='https://cdn.jsdelivr.net/gh/kaomei/stickman-video-director@';

  const STYLES=[
    {id:'A1',e:'A',name:'클래식 흑백',fit:'과학·심리·자기계발·비즈니스 개념을 시각 비유로',gif:'2697fac5e0466f44098148a52c9648697521b3d6/assets/readme/previews/dark-theme-demo.gif'},
    {id:'A2',e:'A',name:'모던 팝',fit:'AI 도구·기술 제품·튜토리얼·모험',gif:'2697fac5e0466f44098148a52c9648697521b3d6/assets/readme/previews/style-2a-demo.gif'},
    {id:'A3',e:'A',name:'선사시대 동굴',fit:'직장 풍자·인간 본성·블랙코미디·우화',gif:'f1e7992ade7de1b31bf520cd264e375334009be9/assets/readme/previews/style-3-demo.gif'},
    {id:'A4',e:'A',name:'따뜻한 일상',fit:'관계·일상 감정·습관·불안과 지침',gif:'2697fac5e0466f44098148a52c9648697521b3d6/assets/readme/previews/style-4-cozy-cafe.gif'},
    {id:'A5',e:'A',name:'역사 카툰',fit:'세계사·문명·역사 인물·역사 단편',gif:'2697fac5e0466f44098148a52c9648697521b3d6/assets/readme/previews/style-5-japan-hero.gif'},
    {id:'A6',e:'A',name:'Amber Noir',fit:'가정형 이야기·현대 우화·심리·반전',gif:'828b865b37cbff61464b9c00e04bce79f79b3b5c/assets/readme/previews/style-6-amber-noir-flow.gif'},
    {id:'A7',e:'A',name:'러버 호스',fit:'부조리 코미디·일상 우화·음악 단편',gif:'4e621f1f91abe012715df94fc44897d5a61777b0/assets/readme/previews/style-7-rubber-hose.gif'},
    {id:'A8',e:'A',name:'지브리풍',fit:'서정적인 이야기·계절·따뜻한 장면',gif:'1aadddbe9ed1c2f3230738dfcb5468f0a91c0687/assets/readme/previews/style-8-graphic-novel.gif'},
    {id:'B1',e:'B',name:'미니멀 라인 아트',fit:'유튜브 해설·교육·심리·직장·제품 소개',gif:'fa0a68d1ccf9fd057230abab2af832f768debe86/assets/readme/previews/b1-minimal-handdrawn.gif'},
    {id:'B2',e:'B',name:'컬러 손그림',fit:'일상 심리·수면·습관·집중력·공감 해설',gif:'eb24085d20aea0efe37c0862cfcd0516b57dadf7/assets/readme/previews/b2-colorful-sleep.gif'},
    {id:'B3',e:'B',name:'레트로 TV',fit:'생활 과학·동물 행동·신기한 사실·미스터리',gif:'eb24085d20aea0efe37c0862cfcd0516b57dadf7/assets/readme/previews/b3-tv-night-signal.gif'},
    {id:'B4',e:'B',name:'서바이벌 스릴러',fit:'생존 규칙·도시 괴담·재난 탈출·서스펜스',gif:'eb24085d20aea0efe37c0862cfcd0516b57dadf7/assets/readme/previews/b4-dispatch.gif'},
    {id:'B5',e:'B',name:'캐릭터 해설',fit:'지식 해설·생활 관찰·대중문화·재치 있는 논평',gif:'e8e3ed7d67b15f2feac4daf021dc17a55af9e606/assets/readme/previews/b5-character-explainer.gif'},
    {id:'B6',e:'B',name:'밈 스토리',fit:'역사의 기이한 사건·사기 이야기·반전 단편',gif:'7d611fb27f103aebc38a656d29edc1b1181cbd62/assets/readme/previews/b6-dynamic-meme-eiffel-16x9.gif'},
    {id:'B7',e:'B',name:'픽셀 시어터',fit:'선택형 이야기·아이러니한 교훈·게임 감성 우화',gif:'d3eab432397d65e7cb72c83f2f35f11216cd5af8/assets/readme/previews/b7-pixel-theater.gif'},
    {id:'B8',e:'B',name:'그리스 신화',fit:'신화·고전 우화·욕심과 대가 이야기',gif:'03c70a26eee910b44eff4c7dc95939a536ce6cf8/assets/readme/previews/b8-midas-approved-r3-v1.gif'}
  ];
  const BY=Object.fromEntries(STYLES.map(s=>[s.id,s]));

  /* 내 채널에 맞춘 추천 — 강도 순 */
  const IDEAS=[
    {ch:'트레이딩 마인드 (Telegram · X)',fit:5,why:'차트로는 지루한 "머릿속 싸움"을 그림으로 보여줄 수 있는 유일한 방법. 내가 실제로 아는 분야라 대본이 진짜임.',
      ex:['손절 못 하는 뇌 — 손실이 새장이 되는 3분','레버리지 50배로 산 하루 (청산가가 따라오는 그림자)','물타기는 왜 멈출 수 없나','FOMO: 남들 수익 인증이 내 계좌에 하는 일'],st:['A1','B1','B5']},
    {ch:'크립토 사기·사건사 (영어 도달용)',fit:5,why:'실제 영상 소스가 없는 과거 사건이라 스틱맨이 최적. 이야기 자체에 반전이 있어 끝까지 봄.',
      ex:['FTX 붕괴 72시간','루나·테라: 이자 20%의 끝','마운트곡스 — 비트코인 85만 개가 사라진 날','러그풀 백서 해부'],st:['B6','A6','B4']},
    {ch:'싱가포르 외노자 일상 (싱달러 부부 · Threads)',fit:4,why:'인스타툰과 같은 세계관을 세로 쇼츠로 넓힘. 얼굴 공개 없이 부부 이야기 가능.',
      ex:['싱가포르 월세 실화 — 방 한 칸이 얼마?','호커센터 첫 주문 실패기','한국 vs 싱가포르 직장인의 하루'],st:['A4','B2']},
    {ch:'레슬링 기술 원리 (MAT STORY 보조)',fit:3,why:'하이라이트는 실사가 이기지만, "왜 이 기술이 먹히나"(지렛대·무게중심)는 선 그림이 더 잘 보임. 본편 사이 짧은 해설용.',
      ex:['싱글레그는 왜 무릎을 노리나','작은 사람이 큰 사람을 넘기는 원리'],st:['B1','A1']},
    {ch:'기독교 채널',fit:3,why:'성경 이야기·비유는 실사 소스가 없음. 역사 카툰·신화 스타일과 결이 맞음.',
      ex:['출애굽 — 바로 왕의 10번의 거절','탕자의 비유 3분 요약'],st:['A5','B8','A8']},
    {ch:'Youtube-Stupid (정책 비판)',fit:2,why:'풍자에 강하지만 위험도 큼. 정책·주장만 그리고, 특정 국적·종교의 사람을 캐릭터로 우스꽝스럽게 그리지 않는다(채널 규칙 그대로).',
      ex:['정책 하나가 통과되기까지 (동굴 풍자)'],st:['A3','B6']}
  ];

  const DEF={style:'B1',topic:'',len:'60초',ratio:'세로 9:16',lang:'한국어'};
  let S;try{S=Object.assign({},DEF,JSON.parse(localStorage.getItem(KEY)||'{}'))}catch(e){S=Object.assign({},DEF)}
  const save=()=>{try{localStorage.setItem(KEY,JSON.stringify(S))}catch(e){}};
  const esc=t=>String(t).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

  const css=`
  .stk{display:grid;gap:18px;margin-top:6px}
  .stk .eyebrow{color:${PC};font-size:12px;font-weight:800;letter-spacing:1.5px}
  .stk h1{margin:2px 0 4px;font-size:26px}
  .stk .sub{color:var(--muted);font-size:14px;margin:0;line-height:1.6}
  .stk-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:18px 20px}
  .stk-card h2{margin:0 0 4px;font-size:18px;display:flex;gap:10px;align-items:center}
  .stk-num{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:${PC};color:#15130f;font-size:12px;font-weight:800;flex:none}
  .stk-card .rule{color:var(--muted);font-size:13px;margin:0 0 14px;line-height:1.6}
  .stk-two{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:16px}
  .stk-two>div{background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:12px 14px;font-size:13.5px;line-height:1.65}
  .stk-two b{display:block;font-size:12px;letter-spacing:.5px;margin-bottom:4px}
  .stk-two .yes b{color:var(--lime)}.stk-two .no b{color:var(--red)}
  .stk-two ul{margin:0;padding-left:18px}
  .stk-ideas{display:grid;gap:8px}
  .stk-idea{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 14px;background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:12px 14px}
  .stk-idea h3{margin:0;font-size:15px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
  .stk-fit{font-size:12px;color:var(--orange);letter-spacing:1px}
  .stk-idea p{grid-column:1/-1;margin:0;color:var(--muted);font-size:13px;line-height:1.6}
  .stk-ex{grid-column:1/-1;display:flex;gap:6px;flex-wrap:wrap}
  .stk-ex button{font:inherit;font-size:12.5px;color:var(--text);background:#0f1217;border:1px dashed var(--line);border-radius:99px;padding:4px 10px;cursor:pointer;text-align:left}
  .stk-ex button:hover{border-color:${PC}}
  .stk-sts{display:flex;gap:4px;align-items:start}
  .stk-chip{font:inherit;font-size:12px;font-weight:800;color:#15130f;background:${PC};border:0;border-radius:6px;padding:3px 7px;cursor:pointer}
  .stk-gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
  .stk-st{font:inherit;color:var(--text);text-align:left;background:var(--panel2);border:1px solid var(--line);border-radius:10px;padding:0;overflow:hidden;cursor:pointer;display:grid}
  .stk-st:hover{border-color:#5b6270}
  .stk-st[aria-pressed="true"]{border-color:${PC};box-shadow:0 0 0 1px ${PC}}
  .stk-st img{width:100%;aspect-ratio:16/9;object-fit:cover;background:#000;display:block}
  .stk-st span{padding:8px 10px 10px;font-size:12.5px;color:var(--muted);line-height:1.5}
  .stk-st b{display:block;color:var(--text);font-size:14px;margin-bottom:2px}
  .stk-st i{font-style:normal;font-size:11px;font-weight:800;margin-right:6px;padding:1px 6px;border-radius:5px;background:#2a2f38;color:var(--text)}
  .stk-filter{display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap}
  .stk-btn{font:inherit;font-size:13px;font-weight:700;color:var(--text);background:var(--panel2);border:1px solid var(--line);border-radius:7px;padding:7px 12px;cursor:pointer;text-decoration:none;display:inline-block}
  .stk-btn:hover,.stk-btn[aria-pressed="true"]{border-color:${PC}}
  .stk-btn.pri{background:${PC};color:#15130f;border-color:${PC}}
  .stk-grid{display:grid;grid-template-columns:minmax(0,.9fr) minmax(0,1.1fr);gap:18px}
  .stk-form{display:grid;gap:10px;align-content:start}
  .stk-form label{display:grid;gap:4px;font-size:12.5px;color:var(--muted)}
  .stk-row3{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
  .stk select,.stk textarea{font:inherit;font-size:14px;color:var(--text);background:#0f1217;border:1px solid var(--line);border-radius:7px;padding:8px 10px}
  .stk textarea{min-height:92px;resize:vertical;line-height:1.55}
  .stk pre{margin:0;white-space:pre-wrap;word-break:break-word;font:13px/1.65 ui-monospace,SFMono-Regular,Menlo,monospace;background:#0f1217;border:1px solid var(--line);border-radius:9px;padding:14px;color:#d9dde4;max-height:340px;overflow:auto}
  .stk-cur{font-size:13px;color:var(--muted)}.stk-cur b{color:var(--text)}
  .stk-steps{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:0;padding:0;list-style:none}
  .stk-steps li{background:var(--panel2);border:1px solid var(--line);border-radius:9px;padding:11px 12px;font-size:13px;line-height:1.55}
  .stk-steps b{display:block;color:${PC};font-size:12px;margin-bottom:3px}
  .stk-note{font-size:13px;color:var(--muted);line-height:1.65;margin:12px 0 0}
  .stk-note b{color:var(--orange)}
  .stk-copyrow{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
  @media(max-width:900px){.stk-grid,.stk-two{grid-template-columns:1fr}.stk-steps{grid-template-columns:1fr 1fr}.stk-idea{grid-template-columns:1fr}}
  @media(max-width:520px){.stk-steps,.stk-row3{grid-template-columns:1fr}.stk-gal{grid-template-columns:1fr 1fr}}
  `;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  const INSTALL=`이 Skill을 설치해 주세요:\n${REPO}\n\n설치 후 SKILL.md를 읽고 준비가 되었다고 알려 주세요.`;
  const KIT=`이 영상의 썸네일 & 게시 키트를 생성해 주세요:\n- 승인된 화풍에 맞는 가로 16:9 썸네일 이미지 1장\n- YouTube 제목 5개\n- 설명, 관련 태그, 근거가 있는 경우 검증된 타임스탬프\n- 고정 댓글에 쓸 참여 유도 질문 1개\n- 미확인 항목을 명시한 게시 전 체크리스트`;

  function prompt(){
    const s=BY[S.style]||BY.B1,topic=S.topic.trim()||'[주제를 입력하거나, 원고를 붙여 넣거나, 아이디어를 직접 설명]';
    const lang=S.lang==='한국어'?'':`, 내레이션·자막 언어 ${S.lang}`;
    if(s.e==='A')return `Model Engine(A 모드)을 사용해 다음 주제/원고를 스틱맨 영상으로 만들어 주세요:\n${topic}\n\n요구 사항: ${S.ratio}, 스타일 ${s.id}「${s.name}」, 우선 ${S.len}${lang}.\n\n먼저 이야기 구성, 사운드 방향, 스토리보드 안을 제시해 주세요.\n제가 승인한 후, 장면별로 독립적으로 사용할 수 있는 영상 생성 프롬프트를 제공해 주세요.`;
    return `Code Engine(B 모드)을 사용해 다음 주제/글을 흥미로운 스틱맨 영상으로 만들어 주세요:\n${topic}\n\n요구 사항: ${S.ratio}, 길이 ${S.len}, 스타일 ${s.id}「${s.name}」, 내레이션·자막·효과음 포함${lang}.\n\n먼저 로컬 이미지 생성 및 합성 환경을 확인하고, 전체 대본과 처음 20초의 사운드 포함 샘플을 제시해 주세요.\n승인 후에는 전체 소재 준비, 코드 작성, 로컬 렌더링을 자동으로 완료해 완성 영상을 전달해 주세요.`;
  }

  function stars(n){return '★'.repeat(n)+'<span style="opacity:.3">'+'★'.repeat(5-n)+'</span>'}
  function opt(list,v){return list.map(x=>`<option${x===v?' selected':''}>${x}</option>`).join('')}
  let galFilter='all';
  function gallery(){
    return STYLES.filter(s=>galFilter==='all'||s.e===galFilter).map(s=>`<button class="stk-st" data-style="${s.id}" aria-pressed="${s.id===S.style}">
      <img loading="lazy" alt="${s.id} ${esc(s.name)} 예시" src="${CDN+s.gif}"><span><b><i>${s.id}</i>${esc(s.name)}</b>${esc(s.fit)}</span></button>`).join('');
  }
  function engineNote(){
    const s=BY[S.style]||BY.B1;
    return s.e==='A'
      ?'<b>A · Model Engine</b> — 장면을 영상 생성 모델(Google Flow 등)로 뽑아요. Flow 크레딧이 들고, 로그인·크레딧이 있는지 먼저 확인.'
      :'<b>B · Code Engine</b> — 그림 소재를 만들고 코드로 움직여 맥에서 렌더링해요. 예시 영상은 전부 <b>Codex</b>(내장 이미지 생성)로 만듦 → Codex에서 돌리는 게 제일 비슷하게 나와요. Claude Code에는 이미지 생성이 없어서 이미지 도구를 따로 연결해야 함.';
  }

  function render(panel){
    const s=BY[S.style]||BY.B1;
    panel.innerHTML=`
    <header><div class="eyebrow">YOUTUBE · STICKMAN</div><h1>스틱맨 영상 제작</h1>
      <p class="sub">동그란 머리와 선 몇 개로 <b>눈에 안 보이는 것</b>(감정·개념·과거 사건)을 보여주는 화풍. 얼굴 공개도, 실사 소스도 필요 없어요. 제작은 오픈소스 스킬 <a href="${REPO}" target="_blank" rel="noopener" style="color:${PC}">stickman-video-director</a> 를 에이전트에 설치해서 해요.</p></header>

    <section class="stk-card"><h2><span class="stk-num">1</span>어떤 내용을 전달하면 좋나</h2>
      <p class="rule">핵심: <b>실사로는 찍을 수 없는 것</b>일수록 스틱맨이 이겨요. 보여줄 진짜 장면이 있으면 실사가 이겨요.</p>
      <div class="stk-two">
        <div class="yes"><b>잘 맞음</b><ul><li>머릿속 싸움 — 불안, 욕심, 손절 못 하는 마음</li><li>추상 개념의 비유 — 레버리지=외줄타기, 번아웃=배터리 1%</li><li>영상이 없는 과거 사건·가정 상황 (“만약 ~라면”)</li><li>반전이 있는 짧은 우화, 코믹한 쉼표</li></ul></div>
        <div class="no"><b>안 맞음</b><ul><li>장면 자체가 볼거리 — 레슬링 하이라이트, 음식, 여행지</li><li>숫자·차트가 주인공인 정보 (그래픽이 더 빠름)</li><li>실존 인물·특정 집단을 우스꽝스럽게 그리는 풍자</li></ul></div>
      </div>
      <div class="stk-ideas">${IDEAS.map((d,i)=>`<div class="stk-idea">
        <h3>${esc(d.ch)} <span class="stk-fit" title="잘 맞는 정도">${stars(d.fit)}</span></h3>
        <div class="stk-sts">${d.st.map(x=>`<button class="stk-chip" data-style="${x}" title="${esc(BY[x].name)} 선택">${x}</button>`).join('')}</div>
        <p>${esc(d.why)}</p>
        <div class="stk-ex">${d.ex.map(x=>`<button data-topic="${esc(x)}" data-st="${d.st[0]}" title="이 주제로 프롬프트 만들기">${esc(x)} →</button>`).join('')}</div></div>`).join('')}</div>
    </section>

    <section class="stk-card"><h2><span class="stk-num">2</span>화풍 고르기 <span style="font-size:13px;color:var(--muted);font-weight:500">16가지</span></h2>
      <p class="rule">A = 영상 생성 모델로 장면을 뽑음 (움직임이 부드러움) · B = 그림 소재를 코드로 움직임 (캐릭터가 안 바뀌고 길게 만들기 좋음)</p>
      <div class="stk-filter">${[['all','전체'],['A','A · Model'],['B','B · Code']].map(([k,l])=>`<button class="stk-btn" data-gf="${k}" aria-pressed="${galFilter===k}">${l}</button>`).join('')}</div>
      <div class="stk-gal" data-gal>${gallery()}</div>
    </section>

    <section class="stk-card"><h2><span class="stk-num">3</span>제작 프롬프트 만들기</h2>
      <p class="rule">고른 화풍과 주제로 프롬프트를 만들어요. 복사해서 Codex나 Claude Code에 붙여 넣으면 대본부터 시작해요.</p>
      <div class="stk-grid">
        <div class="stk-form">
          <div class="stk-cur" data-cur>선택: <b>${s.id} · ${esc(s.name)}</b></div>
          <label>주제·원고·링크<textarea data-s="topic" placeholder="예: 손절 못 하는 뇌 — 손실이 새장이 되는 3분">${esc(S.topic)}</textarea></label>
          <div class="stk-row3">
            <label>길이<select data-s="len">${opt(['30초','60초','3분','8분'],S.len)}</select></label>
            <label>화면<select data-s="ratio">${opt(['세로 9:16','가로 16:9'],S.ratio)}</select></label>
            <label>언어<select data-s="lang">${opt(['한국어','영어'],S.lang)}</select></label>
          </div>
          <p class="stk-note" data-eng>${engineNote()}</p>
        </div>
        <div><pre data-out>${esc(prompt())}</pre>
          <div class="stk-copyrow"><button class="stk-btn pri" data-copy="main">프롬프트 복사</button></div></div>
      </div>
    </section>

    <section class="stk-card"><h2><span class="stk-num">4</span>만드는 순서</h2>
      <ol class="stk-steps">
        <li><b>1 · 스킬 설치 (한 번만)</b>에이전트에 설치 문장을 보내요.<div class="stk-copyrow"><button class="stk-btn" data-copy="install">설치 문장 복사</button></div></li>
        <li><b>2 · 대본 승인</b>위 프롬프트를 보내면 대본 + 처음 20초 소리 포함 샘플(B) 또는 스토리보드(A)가 와요. 여기서 고쳐요.</li>
        <li><b>3 · 렌더링</b>승인하면 소재·애니메이션·자막·효과음까지 만들어 맥에서 영상 파일로 뽑아요. 마음에 안 드는 구간만 다시.</li>
        <li><b>4 · 썸네일·게시 키트</b>썸네일 1장, 제목 5개, 설명·태그, 고정 댓글 질문.<div class="stk-copyrow"><button class="stk-btn" data-copy="kit">키트 요청 복사</button></div></li>
      </ol>
      <p class="stk-note">스킬 자체는 무료(MIT)예요. 돈이 드는 곳은 연결한 도구뿐: A 모드의 Google Flow 크레딧, 이미지·음성 API를 쓰면 그 사용료. 업로드는 직접 해요 (자동 게시 없음).</p>
    </section>`;
  }

  function refresh(panel){
    const s=BY[S.style]||BY.B1;
    panel.querySelector('[data-out]').textContent=prompt();
    panel.querySelector('[data-cur]').innerHTML=`선택: <b>${s.id} · ${esc(s.name)}</b>`;
    panel.querySelector('[data-eng]').innerHTML=engineNote();
    panel.querySelectorAll('.stk-st').forEach(b=>b.setAttribute('aria-pressed',b.dataset.style===S.style));
  }
  function toast(msg){
    const t=document.getElementById('toasts');if(!t)return;
    const d=document.createElement('div');d.className='toast';d.textContent=msg;t.appendChild(d);setTimeout(()=>d.remove(),2200);
  }
  async function copy(txt){try{await navigator.clipboard.writeText(txt);toast('복사했어요')}catch(e){toast('복사 실패 — 직접 선택해 복사하세요')}}

  function wire(panel){
    panel.addEventListener('input',e=>{const k=e.target.dataset.s;if(!k)return;S[k]=e.target.value;save();refresh(panel)});
    panel.addEventListener('change',e=>{const k=e.target.dataset.s;if(!k)return;S[k]=e.target.value;save();refresh(panel)});
    panel.addEventListener('click',e=>{
      const t=e.target.closest('button');if(!t||!panel.contains(t))return;
      if(t.dataset.gf){galFilter=t.dataset.gf;panel.querySelectorAll('[data-gf]').forEach(b=>b.setAttribute('aria-pressed',b===t));panel.querySelector('[data-gal]').innerHTML=gallery();return}
      if(t.dataset.topic){S.topic=t.dataset.topic;S.style=t.dataset.st;save();panel.querySelector('[data-s="topic"]').value=S.topic;refresh(panel);panel.querySelector('[data-out]').scrollIntoView({behavior:'smooth',block:'center'});return}
      if(t.dataset.style){S.style=t.dataset.style;save();refresh(panel);if(t.classList.contains('stk-chip'))panel.querySelector('[data-cur]').scrollIntoView({behavior:'smooth',block:'center'});return}
      if(t.dataset.copy)copy(t.dataset.copy==='install'?INSTALL:t.dataset.copy==='kit'?KIT:prompt());
    });
  }

  function open(){
    const c=document.getElementById('content');if(!c)return;
    document.getElementById('sidebar')?.classList.remove('open');
    document.querySelectorAll('#sidebar .nav').forEach(n=>{n.classList.remove('active');n.removeAttribute('aria-current')});
    const me=document.querySelector('#sidebar [data-stk-side]');if(me){me.classList.add('active');me.setAttribute('aria-current','page')}
    const bc=document.getElementById('breadcrumb');if(bc)bc.textContent='YouTube - Stickman';
    const panel=document.createElement('section');panel.className='stk';wire(panel);render(panel);
    c.replaceChildren(panel);window.scrollTo(0,0);
  }

  function addSide(){
    let me=document.querySelector('#sidebar [data-stk-side]');
    if(me){if(!document.querySelector('#content .stk')&&me.classList.contains('active')){me.classList.remove('active');me.removeAttribute('aria-current')}}
    const ref=document.querySelector('#sidebar [data-ytf-side]')||document.querySelector('#sidebar .nav[data-view="yt-politics"]');
    if(!ref)return;
    if(!me){
      me=document.createElement('button');me.className='nav pf-nav';me.dataset.stkSide='1';me.style.setProperty('--pc',PC);
      me.innerHTML='<span class="navicon"><i class="pf-dot"></i></span>Youtube - Stickman';
      me.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();open()},true);
    }
    if(ref.nextElementSibling!==me)ref.after(me);
  }

  new MutationObserver(addSide).observe(document.body,{childList:true,subtree:true});
  addSide();
})();
