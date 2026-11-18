/* FIELDNOTE - YouTube 조회수 공식 탭 (drop-in). index.html 에 <script src="fieldnote-ytformula.js"></script> 추가 */
(function(){
  if(window.__ytFormula)return;window.__ytFormula=1;

  const css=`
  .ytf{display:grid;gap:18px;margin-top:6px}
  .ytf .eyebrow{color:#ff6b6b;font-size:11px;font-weight:800;letter-spacing:1.5px}
  .ytf h1{margin:2px 0 4px;font-size:24px}
  .ytf .sub{color:var(--muted);font-size:13px;margin:0}
  .ytf-topic{display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:12px;color:var(--muted)}
  .ytf select,.ytf input,.ytf textarea{font:inherit;color:var(--text);background:#0f1217;border:1px solid var(--line);border-radius:7px;padding:8px 10px}
  .ytf textarea{width:100%;min-height:64px;resize:vertical}
  .ytf-card{border:1px solid var(--line);border-radius:12px;background:var(--panel);padding:18px 20px}
  .ytf-card h2{margin:0 0 4px;font-size:17px;display:flex;gap:10px;align-items:center}
  .ytf-num{display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:#ff6b6b;color:#1a0d0d;font-size:12px;font-weight:800}
  .ytf-card .rule{color:var(--muted);font-size:12.5px;margin:0 0 14px}
  .ytf-steps{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin:0 0 14px;padding:0;list-style:none}
  .ytf-steps li{background:var(--panel2);border:1px solid var(--line);border-radius:8px;padding:9px 11px;font-size:12px}
  .ytf-steps b{display:block;color:var(--lime);font-size:11px;margin-bottom:2px}
  .ytf-links{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
  .ytf-btn{font:inherit;font-size:12px;font-weight:700;color:var(--text);background:var(--panel2);border:1px solid var(--line);border-radius:7px;padding:7px 11px;cursor:pointer;text-decoration:none}
  .ytf-btn:hover{border-color:#ff6b6b}
  .ytf-btn.pri{background:#ff6b6b;color:#1a0d0d;border-color:#ff6b6b}
  .ytf table{width:100%;border-collapse:collapse;font-size:12.5px}
  .ytf th{color:var(--muted);font-weight:600;text-align:left;padding:6px;border-bottom:1px solid var(--line)}
  .ytf td{padding:5px 6px;border-bottom:1px solid var(--line)}
  .ytf td input{width:100%;padding:6px 8px}
  .ytf td.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .ytf-tag{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;font-weight:800}
  .ytf-tag.hot{background:#ff6b6b;color:#1a0d0d}.ytf-tag.ok{background:var(--orange);color:#1f1606}.ytf-tag.no{background:var(--line);color:var(--muted)}
  .ytf-x{background:none;border:0;color:var(--muted);cursor:pointer;font-size:14px}
  .ytf-grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.1fr);gap:18px}
  @media(max-width:900px){.ytf-grid{grid-template-columns:1fr}}
  .ytf-form{display:grid;gap:10px;align-content:start}
  .ytf-form label{display:grid;gap:4px;align-content:start;font-size:12px;color:var(--muted)}
  .ytf-row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
  .ytf-thumb{position:relative;aspect-ratio:16/9;border-radius:10px;overflow:hidden;background:#000;display:grid;grid-template-rows:auto 1fr auto;border:1px solid var(--line)}
  .ytf-thumb .top,.ytf-thumb .bot{font-weight:900;text-align:center;padding:6px 8px;line-height:1.15;letter-spacing:-.5px;text-shadow:0 2px 0 #000,0 0 6px #000;z-index:1}
  .ytf-thumb .top{background:#000;color:#ffe600;font-size:clamp(18px,3.2vw,34px)}
  .ytf-thumb .bot{font-size:clamp(15px,2.6vw,28px);color:#fff}
  .ytf-thumb .bot.red{background:#e60012}.ytf-thumb .bot.blue{background:#0047ff}
  .ytf-thumb .mid{display:grid;grid-template-columns:1fr 1fr;min-height:0}
  .ytf-thumb .mid div{background:#222 center/cover no-repeat;display:grid;place-items:center;color:#777;font-size:12px;font-weight:700;min-height:0}
  .ytf-thumb .mid div+div{border-left:3px solid #ffe600}
  .ytf-checks{list-style:none;padding:0;margin:12px 0 0;display:grid;gap:5px;font-size:12.5px}
  .ytf-checks li::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:8px;background:var(--green)}
  .ytf-checks li.bad::before{background:var(--red)}
  .ytf-checks li.bad{color:var(--red)}
  .ytf-tpls{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 10px}
  .ytf-meter{height:8px;background:var(--line);border-radius:99px;overflow:hidden;margin:10px 0 4px}
  .ytf-meter i{display:block;height:100%;background:var(--green)}
  .ytf-meter i.over{background:var(--red)}
  .ytf-small{font-size:11.5px;color:var(--muted)}
  `;
  const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

  const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
  const fmt=n=>isFinite(n)?Math.round(n).toLocaleString('ko-KR'):'-';
  const YT='https://www.youtube.com/results?search_query=';
  // sp: CAMSAggD = 이번 주 + 조회수순, CAMSAggE = 이번 달 + 조회수순
  const S={
    topic:'',
    refs:[
      {t:'예시) Lopez 5th Olympic gold reaction',v:2400000,s:85000,d:20},
      {t:'예시) Greco-Roman best throws 2026',v:310000,s:640000,d:12},
      {t:'예시) 레슬링 태클 카운터 모음',v:920000,s:31000,d:9}
    ],
    top:'41살, 올림픽 5연패',bot:'16년 동안 올림픽에서 진 적이 없다',botColor:'red',imgL:'',imgR:'',
    hook:'41살 레슬러가 올림픽 5연패를 했습니다. 레슬링 역사상 처음입니다.'
  };
  const BAN=['안녕하세요','여러분','오늘은','이번 영상','구독','좋아요','반갑습니다','시작하겠습니다'];
  const TPL=[
    ['결론 먼저','{주제}. 그런데 진짜 이유는 따로 있었습니다.'],
    ['숫자 충격','{숫자}. 레슬링 역사상 처음 있는 일입니다.'],
    ['반응 먼저','이 장면에서 경기장 전체가 일어났습니다.'],
    ['반전','모두 끝났다고 생각한 그 순간, 경기가 뒤집혔습니다.']
  ];

  function topics(){
    const sel=document.querySelector('select[data-yp-idea]');
    if(!sel)return [];
    return [...sel.options].map(o=>({v:o.value,t:o.textContent.trim(),sel:o.selected}));
  }

  function refRows(){
    return S.refs.map((r,i)=>{
      const x=r.v/r.s, per=r.v/Math.max(r.d,1);
      const tag=x>=10?'<span class="ytf-tag hot">강력 '+x.toFixed(1)+'x</span>':x>=3?'<span class="ytf-tag ok">후보 '+x.toFixed(1)+'x</span>':'<span class="ytf-tag no">패스 '+(isFinite(x)?x.toFixed(1):'-')+'x</span>';
      return `<tr data-i="${i}">
        <td><input data-k="t" value="${esc(r.t)}"></td>
        <td><input data-k="v" type="number" value="${r.v}"></td>
        <td><input data-k="s" type="number" value="${r.s}"></td>
        <td><input data-k="d" type="number" value="${r.d}" style="width:64px"></td>
        <td class="n">${fmt(per)}</td>
        <td>${tag}</td>
        <td><button class="ytf-x" data-del="${i}" title="삭제">x</button></td></tr>`;
    }).join('');
  }

  function thumbChecks(){
    const c=[];
    const tl=S.top.replace(/\s/g,'').length, bl=S.bot.replace(/\s/g,'').length;
    c.push([tl>0&&tl<=12,`상단 카피 ${tl}자 (12자 이하, 결정적 순간 1개만)`]);
    c.push([bl>0&&bl<=16,`하단 카피 ${bl}자 (16자 이하, 반전/궁금증)`]);
    c.push([!!S.imgL,'왼쪽: 주인공 결정적 액션 컷']);
    c.push([!!S.imgR,'오른쪽: 관중/상대/코치 리액션 컷 (표정 필수)']);
    c.push([!/(그리고|그래서|했는데|하면서)/.test(S.top+S.bot),'내용 설명형 문장 아님 (그리고/그래서/했는데 없음)']);
    return c.map(([ok,t])=>`<li class="${ok?'':'bad'}">${esc(t)}</li>`).join('');
  }

  function hookChecks(){
    const h=S.hook.trim();
    const banHit=BAN.filter(b=>h.includes(b));
    const first=h.split(/[.!?]/)[0]||'';
    const syl=first.replace(/[\s,'"~]/g,'').length;
    const sec=syl/6.5;
    const c=[
      [banHit.length===0, banHit.length?`금지 오프닝: ${banHit.join(', ')}`:'인사/구독 멘트 없음'],
      [sec<=3.2, `첫 문장 약 ${sec.toFixed(1)}초 (${syl}음절, 6.5음절/초 기준, 3초 이내)`],
      [/\d|처음|역대|난리|뒤집|끝났|충격|아무도|단 한/.test(first), '첫 문장에 결론/숫자/반전 신호 있음']
    ];
    return {sec,html:c.map(([ok,t])=>`<li class="${ok?'':'bad'}">${esc(t)}</li>`).join('')};
  }

  function render(panel){
    const tp=topics();
    const cur=tp.find(o=>o.sel);
    if(!S.topic)S.topic=cur?cur.t:'미하인 로페스 그레코로만 5연패';
    const q=encodeURIComponent(S.topic);
    const hk=hookChecks();
    panel.innerHTML=`
    <header><div class="eyebrow">YOUTUBE · 조회수 공식</div><h1>조회수 공식 3단계</h1>
      <p class="sub">주제 발굴 -> 썸네일 -> 첫 3초. 작업판 주제 하나를 골라 순서대로 통과시키기.</p></header>
    <div class="ytf-topic">작업할 주제
      ${tp.length?`<select data-ytf-topic>${tp.map(o=>`<option ${o.t===S.topic?'selected':''}>${esc(o.t)}</option>`).join('')}</select>`:`<input data-ytf-topic value="${esc(S.topic)}" style="min-width:280px">`}
    </div>

    <section class="ytf-card">
      <h2><span class="ytf-num">1</span>주제 발굴: 유튜브 내부 데이터만 본다</h2>
      <p class="rule">네이버/인스타/틱톡/뉴스 화제는 참고만. 기준은 "구독자는 적은데 최근 조회수가 터진 영상" = 수요 검증된 소재.</p>
      <ol class="ytf-steps">
        <li><b>STEP 1</b>주제 키워드 검색 (영어 + 한국어 둘 다)</li>
        <li><b>STEP 2</b>필터: 업로드 날짜 이번 주 / 이번 달</li>
        <li><b>STEP 3</b>정렬: 조회수순</li>
        <li><b>STEP 4</b>채널 구독자 확인 -> 아래 표에 입력</li>
        <li><b>판정</b>조회수/구독자 10x 이상 강력, 3x 이상 후보</li>
      </ol>
      <div class="ytf-links">
        <a class="ytf-btn pri" target="_blank" rel="noopener" href="${YT+q}&sp=CAMSAggD">이번 주 + 조회수순</a>
        <a class="ytf-btn" target="_blank" rel="noopener" href="${YT+q}&sp=CAMSAggE">이번 달 + 조회수순</a>
        <a class="ytf-btn" target="_blank" rel="noopener" href="${YT}wrestling&sp=CAMSAggD">wrestling 이번 주</a>
        <a class="ytf-btn" target="_blank" rel="noopener" href="${YT}greco%20roman&sp=CAMSAggE">greco roman 이번 달</a>
      </div>
      <table><thead><tr><th>레퍼런스 영상</th><th>조회수</th><th>구독자</th><th>업로드(일)</th><th class="n">일평균</th><th>판정</th><th></th></tr></thead>
      <tbody data-ytf-refs>${refRows()}</tbody></table>
      <div style="margin-top:10px"><button class="ytf-btn" data-ytf-add>+ 레퍼런스 추가</button> <span class="ytf-small">예시 행은 가상 숫자. 지우고 실제 값 입력.</span></div>
    </section>

    <section class="ytf-card">
      <h2><span class="ytf-num">2</span>썸네일: 예쁘게 말고 3단 원색 대비</h2>
      <p class="rule">상단 노랑 후킹 카피 + 중앙 2분할(액션 | 리액션) + 하단 빨강/파랑 반전 카피. 파스텔/분홍, 내용 설명, 리액션 표정 누락 금지.</p>
      <div class="ytf-grid">
        <div class="ytf-form">
          <label>상단 카피 (노랑) - 결정적 순간<input data-s="top" value="${esc(S.top)}"></label>
          <div class="ytf-row2">
            <label>왼쪽 이미지 URL - 주인공 액션<input data-s="imgL" value="${esc(S.imgL)}" placeholder="https://..."></label>
            <label>오른쪽 이미지 URL - 리액션<input data-s="imgR" value="${esc(S.imgR)}" placeholder="https://..."></label>
          </div>
          <label>하단 카피 - 반전/궁금증<input data-s="bot" value="${esc(S.bot)}"></label>
          <label>하단 배경<select data-s="botColor"><option value="red" ${S.botColor==='red'?'selected':''}>빨강</option><option value="blue" ${S.botColor==='blue'?'selected':''}>파랑</option></select></label>
        </div>
        <div>
          <div class="ytf-thumb">
            <div class="top" data-p="top">${esc(S.top)}</div>
            <div class="mid"><div data-p="imgL" style="${S.imgL?`background-image:url('${esc(S.imgL)}')`:''}">${S.imgL?'':'액션 컷'}</div><div data-p="imgR" style="${S.imgR?`background-image:url('${esc(S.imgR)}')`:''}">${S.imgR?'':'리액션 컷'}</div></div>
            <div class="bot ${S.botColor}" data-p="bot">${esc(S.bot)}</div>
          </div>
          <ul class="ytf-checks" data-ytf-tc>${thumbChecks()}</ul>
        </div>
      </div>
    </section>

    <section class="ytf-card">
      <h2><span class="ytf-num">3</span>첫 3초: 인사 삭제, 결론/반전부터</h2>
      <p class="rule">썸네일 클릭 후 3초 안에 이탈 방어. 첫 문장은 결론이나 반전, 첫 화면은 가장 강한 하이라이트 장면.</p>
      <div class="ytf-tpls">${TPL.map((t,i)=>`<button class="ytf-btn" data-tpl="${i}">${esc(t[0])}</button>`).join('')}</div>
      <textarea data-s="hook">${esc(S.hook)}</textarea>
      <div class="ytf-meter"><i data-ytf-meter class="${hk.sec>3.2?'over':''}" style="width:${Math.min(100,hk.sec/3.2*100)}%"></i></div>
      <div class="ytf-small">막대 = 첫 문장 길이 (끝 = 3초)</div>
      <ul class="ytf-checks" data-ytf-hc>${hk.html}</ul>
      <ul class="ytf-checks"><li class="bad" style="color:var(--muted)">편집 체크: 0초 화면 = 썸네일과 같은 결정적 장면 (수동 확인)</li></ul>
    </section>`;
  }

  function refreshLive(panel){
    panel.querySelector('[data-p="top"]').textContent=S.top;
    const b=panel.querySelector('[data-p="bot"]');b.textContent=S.bot;b.className='bot '+S.botColor;
    ['imgL','imgR'].forEach(k=>{const d=panel.querySelector(`[data-p="${k}"]`);d.style.backgroundImage=S[k]?`url('${S[k].replace(/'/g,'%27')}')`:'';d.textContent=S[k]?'':(k==='imgL'?'액션 컷':'리액션 컷')});
    panel.querySelector('[data-ytf-tc]').innerHTML=thumbChecks();
    const hk=hookChecks();
    panel.querySelector('[data-ytf-hc]').innerHTML=hk.html;
    const m=panel.querySelector('[data-ytf-meter]');m.style.width=Math.min(100,hk.sec/3.2*100)+'%';m.className=hk.sec>3.2?'over':'';
  }

  function wire(panel){
    panel.addEventListener('input',e=>{
      const t=e.target;
      if(t.dataset.s){S[t.dataset.s]=t.value;refreshLive(panel);return}
      const tr=t.closest('tr[data-i]');
      if(tr&&t.dataset.k){const r=S.refs[+tr.dataset.i];r[t.dataset.k]=t.dataset.k==='t'?t.value:+t.value;
        const x=r.v/r.s,per=r.v/Math.max(r.d,1);
        tr.children[4].textContent=fmt(per);
        tr.children[5].innerHTML=x>=10?'<span class="ytf-tag hot">강력 '+x.toFixed(1)+'x</span>':x>=3?'<span class="ytf-tag ok">후보 '+x.toFixed(1)+'x</span>':'<span class="ytf-tag no">패스 '+(isFinite(x)?x.toFixed(1):'-')+'x</span>';}
    });
    panel.addEventListener('change',e=>{
      if(e.target.matches('[data-ytf-topic]')){S.topic=e.target.value;render(panel)}
      if(e.target.dataset.s==='botColor'){S.botColor=e.target.value;refreshLive(panel)}
    });
    panel.addEventListener('click',e=>{
      const t=e.target;
      if(t.matches('[data-ytf-add]')){S.refs.push({t:'',v:0,s:1,d:1});panel.querySelector('[data-ytf-refs]').innerHTML=refRows()}
      if(t.dataset.del!==undefined){S.refs.splice(+t.dataset.del,1);panel.querySelector('[data-ytf-refs]').innerHTML=refRows()}
      if(t.dataset.tpl!==undefined){S.hook=TPL[+t.dataset.tpl][1].replace('{주제}',S.topic);const ta=panel.querySelector('[data-s="hook"]');ta.value=S.hook;ta.focus();refreshLive(panel)}
    });
  }

  function open(){
    const c=document.getElementById('content'),nav=c&&c.querySelector('nav.workspace-nav');
    if(!nav)return;
    [...c.children].forEach(k=>{if(k!==nav&&!k.matches('footer'))k.style.display='none'});
    nav.querySelectorAll('.filter').forEach(b=>{b.classList.remove('active');b.removeAttribute('aria-current')});
    const me=nav.querySelector('[data-ytf]');me.classList.add('active');me.setAttribute('aria-current','page');
    let panel=c.querySelector('.ytf');
    if(!panel){panel=document.createElement('section');panel.className='ytf';nav.after(panel);wire(panel)}
    render(panel);
    document.querySelectorAll('#sidebar .nav').forEach(n=>{n.classList.remove('active');n.removeAttribute('aria-current')});
    const side=document.querySelector('#sidebar [data-ytf-side]');
    if(side){side.classList.add('active');side.setAttribute('aria-current','page')}
  }

  function openFromSide(){
    if(document.querySelector('#content nav.workspace-nav[aria-label="유튜브 메뉴"]')){addBtn();open();return}
    document.querySelector('#sidebar .nav[data-view="youtube"]').click();
    let n=0;const t=setInterval(()=>{if(document.querySelector('#content nav.workspace-nav[aria-label="유튜브 메뉴"]')||++n>20){clearInterval(t);addBtn();open()}},50);
  }

  function addSide(){
    const side=document.querySelector('#sidebar [data-ytf-side]');
    if(side){if(!document.querySelector('.ytf')){side.classList.remove('active');side.removeAttribute('aria-current')}return}
    const ref=document.querySelector('#sidebar .nav[data-view="yt-politics"]');
    if(!ref)return;
    const b=document.createElement('button');b.className='nav pf-nav';b.dataset.ytfSide='1';b.style.setProperty('--pc','#ffd400');
    b.innerHTML='<span class="navicon"><i class="pf-dot"></i></span>Youtube 조회수 공식';
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();openFromSide()},true);
    ref.after(b);
  }

  function addBtn(){
    const nav=document.querySelector('#content nav.workspace-nav[aria-label="유튜브 메뉴"]');
    if(!nav||nav.querySelector('[data-ytf]'))return;
    const b=document.createElement('button');b.className='filter';b.dataset.ytf='1';b.textContent='Youtube 조회수 공식';
    b.addEventListener('click',e=>{e.preventDefault();e.stopPropagation();open()},true);
    nav.appendChild(b);
  }

  new MutationObserver(()=>{addBtn();addSide()}).observe(document.body,{childList:true,subtree:true});
  addBtn();addSide();
})();
