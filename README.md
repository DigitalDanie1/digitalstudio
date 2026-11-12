# FIELDNOTE Studio

개인 콘텐츠 기획·작성·검수·발행 요청 스튜디오입니다. Vercel에 배포하면 **어느 컴퓨터에서든 비밀번호만 입력해** 같은 데이터로 쓸 수 있고, AI 주제·초안 생성도 로컬 브리지 없이 서버에서 동작합니다. 본인 외에는 접근할 수 없습니다.

## Vercel 배포

프레임워크 없음(Framework Preset: Other), 빌드 명령 없음. 정적 파일 + `api/` 함수 + `middleware.js`(비밀번호 게이트)로 구성됩니다.

1. GitHub에 저장소를 올리고 Vercel에서 Import합니다 (Hobby 플랜 가능).
2. **Storage → Marketplace → Upstash for Redis**(무료)를 만들어 이 프로젝트에 연결합니다. `KV_REST_API_URL`, `KV_REST_API_TOKEN`이 자동으로 추가됩니다(`UPSTASH_REDIS_REST_URL/TOKEN` 이름도 인식).
3. **Settings → Environment Variables**에 아래 값을 추가합니다.

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `STUDIO_PASSWORD` | 필수 | 로그인 비밀번호. 비어 있으면 사이트 전체가 차단됩니다. 바꾸면 모든 기기가 로그아웃됩니다. |
| `ANTHROPIC_API_KEY` | AI 생성에 필요 | 주제·초안 생성에만 사용합니다. 호출마다 유료 요금이 발생합니다. |
| `FIELDNOTE_PAID_AI_ENABLED` | AI 자동 생성에 필요 | `true`로 설정하면 소재에서 Claude 1차 원고·대본을 바로 생성합니다. 비용 방지를 위해 기본값은 꺼짐입니다. |
| `FIELDNOTE_MODEL` | 선택 | 기본 `claude-opus-5-5`. 비용을 줄이려면 `claude-sonnet-5-5`. |

4. 환경변수를 추가·변경했다면 **Redeploy** 합니다.

동작 방식

- 처음 로그인하면, 그 컴퓨터 브라우저에 있던 데이터가 비어 있는 클라우드에 올라갑니다(JSON 백업 복원도 동일). 이후에는 클라우드가 기준이고 브라우저 저장소는 캐시입니다.
- 저장은 편집 후 약 1.5초 뒤 자동으로 올라가며, 사이드바에 `클라우드 저장됨`/`동기화 중…`/`오프라인`이 표시됩니다. 다른 컴퓨터에서 먼저 저장했다면 "서버 버전 불러오기"·"내 버전으로 덮어쓰기" 중에서 고릅니다.
- 발행 브리지 주소·토큰, 편집 중 임시 원고는 동기화되지 않고 각 컴퓨터에만 남습니다.
- 사이드바 아래 **로그아웃**으로 세션(30일)을 끝냅니다.
- `file://` 로 파일을 직접 열면 예전처럼 브라우저 로컬 저장 + 로컬 브리지로만 동작합니다.

## 네이버 블로그 발행

- **어느 컴퓨터에서나:** 승인된 블로그 원고의 **본문 복사 · 네이버 글쓰기 열기** 버튼이 제목·본문·출처·카테고리를 복사하고 네이버 글쓰기 창을 엽니다. 붙여 넣고 카테고리를 고른 뒤 **등록은 직접** 누릅니다.
- **자동 채우기(선택):** `naver-bridge`는 네이버 자동 채우기에만 필요합니다. 해당 컴퓨터에서 직접 실행하며, 로그인 세션과 토큰은 저장소에 올리지 않습니다.

```bash
npm install            # 저장소 루트 (공유 AI 로직의 SDK)
cd naver-bridge
npm install
npx playwright install chromium
npm start
```

Vercel 스튜디오에서 브리지를 쓰려면 브리지 `.env`에 `FIELDNOTE_ALLOWED_ORIGIN=https://내-도메인.vercel.app`을 넣고 FIELDNOTE의 브리지 주소를 `http://127.0.0.1:8787/publish/naver`로 설정합니다. 자세한 내용은 [네이버 브리지 안내](naver-bridge/README.md)를 참고하세요.

## 로컬 확인

```bash
node work/dev-server.mjs          # http://127.0.0.1:5179 , 비밀번호 test1234, 메모리 저장소, API 키 없음
node work/test-cloud.mjs          # 게이트·동기화·브리지 허용 목록·프런트 클라우드 모드
```
