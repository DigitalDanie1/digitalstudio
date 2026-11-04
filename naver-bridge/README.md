# FIELDNOTE 네이버 블로그 브리지

승인된 FIELDNOTE 블로그 원고를 네이버 SmartEditor 글쓰기 화면에 채우는 개인용 로컬 브리지입니다. 최종 등록은 자동화하지 않습니다. 같은 브리지가 Claude로 블로그 주제와 AI 초안도 생성합니다.

## 설치·실행

```bash
cd /Users/daniel/Documents/Codex/2026-10-30/new-chat/naver-bridge
# 저장소 루트에서도 한 번 (AI 생성 로직 ../lib/generate.mjs가 루트의 @anthropic-ai/sdk·zod를 씁니다)
(cd .. && npm install)
npm install
npx playwright install chromium
npm start
```

AI 생성(주제·초안)을 쓰려면 이 폴더의 `.env` 파일에 Anthropic API 키를 한 번 적어 두세요. `npm start`가 `.env`를 자동으로 읽습니다. 키는 브리지 프로세스에서만 읽으며, FIELDNOTE 요청으로는 받지 않습니다. 키가 없어도 브리지는 시작되고 발행은 정상 동작하며, 생성 요청만 401을 반환합니다.

```
ANTHROPIC_API_KEY=sk-ant-...
FIELDNOTE_MODEL=claude-opus-5-5        # 비용을 줄이려면 claude-sonnet-5-5
FIELDNOTE_BRIDGE_TOKEN=                # 선택: 브리지 요청 토큰
```

`.env`는 `.gitignore`에 포함돼 저장소에 올라가지 않습니다. 형식은 `.env.example`을 참고하세요. 일회성으로 바꾸려면 기존처럼 `ANTHROPIC_API_KEY='sk-ant-...' npm start`도 동작합니다(명령줄 값이 `.env`보다 우선).

## FIELDNOTE 연결

1. FIELDNOTE의 **발행 센터 → 네이버 블로그 → 연결하기**를 엽니다.
2. URL에 `http://127.0.0.1:8787/publish/naver`를 입력합니다.
3. 토큰을 설정했다면 동일한 값을 입력합니다.
4. 실제 원고를 검수 승인한 후 **승인 후 올리기**를 누릅니다.
5. 처음 열린 네이버 창에서 직접 로그인합니다. 로그인 상태는 이 폴더의 `.naver-profile`에만 유지됩니다.
6. 제목·본문·출처·카테고리·공개 범위를 확인하고 네이버의 **등록** 버튼을 직접 누릅니다.

## AI 주제·초안 생성

FIELDNOTE의 **네이버 블로그** 화면 위쪽 "블로그 주제 생성기"가 아래 엔드포인트를 호출합니다. 연결 URL은 발행 연결과 같은 값(`http://127.0.0.1:8787/publish/naver`)을 그대로 쓰며, 같은 `X-Fieldnote-Token` 검사를 거칩니다.

| 경로 | 요청 | 응답 |
| --- | --- | --- |
| `POST /generate/topics` | `{version:1, category:{name,parent,note}, blogVoice, existingTitles:[최대 200개], count:5}` | `{ok, model, topics:[{title, angle, hook, outline[3~6], verify[]}]}` |
| `POST /generate/draft` | `{version:1, category:{name,parent,note}, blogVoice, idea:{title,note}}` | `{ok, model, draft:{title, body(Markdown), tags[], sources_to_verify[]}}` |
| `GET /health` | | `{ok, service, generate(키 유무), model, lastJob}` |

- `category.name`은 `게임·도박 설계`, `주식 중독`, `코인 중독`, `투자 심리`, `싱가포르 관찰`, `매크로 끄적` 중 하나여야 합니다(그 외 400). 요청 본문은 1MB 이하입니다.
- 모델은 `FIELDNOTE_MODEL`(기본 `claude-opus-5-5`). 주제는 effort `medium`, 초안은 `high`, `max_tokens` 16000. 구조화 출력(Zod 스키마)으로 받습니다.
- 모델이 거절하면 서버 측 폴백(`server-side-fallback-2026-07-01`, `fallbacks: 'default'`)을 먼저 시도하고, 그래도 거절되면 422를 반환합니다.
- 오류: 키 없음/잘못됨 401, 한도 초과 429, Anthropic 연결 실패 502, 기타 API 오류는 해당 상태 코드와 메시지.
- 글 규칙: 통계·연구·인용·사례를 지어내지 않고 `[확인 필요: …]`, 글쓴이의 경험은 `[직접 경험: …]` 자리표시자로 남깁니다. 매수·매도 의견·전망은 쓰지 않으며, 중독 관련 글 끝에는 한국도박문제예방치유원 1336, 정신건강위기상담 109를 넣습니다. FIELDNOTE는 이 표시가 본문에 남아 있으면 승인을 막습니다.
- **비용:** 주제 생성과 초안 생성은 호출마다 유료 Anthropic API 요금이 발생합니다(초안은 effort `high`라 더 비쌉니다). FIELDNOTE는 소재·메모 전체가 아니라 카테고리, 블로그 소개·문체, 기존 제목 목록(최대 200개), 선택한 소재의 제목·메모만 보냅니다. 작업 메모와 토큰은 보내지 않습니다.

## 본문 변환과 출처

브리지는 Markdown 원고를 일반 텍스트로 바꿔 입력합니다. `#` 제목 기호는 제거하고 제목 글은 한 줄로 남기며, `**`·`*`·백틱은 제거, `- ` 목록은 `• `로, `[글](URL)`은 `글 (URL)`로 변환합니다. 원고에 출처가 있으면 본문 끝에 `출처` 문단을 붙입니다. 작업 메모(`memo`)는 FIELDNOTE가 브리지로 보내지 않습니다.

## 카테고리 미리 선택 (선택 사항)

원고에 `naverCategory`가 있으면 제목·본문을 채운 뒤 상단 오른쪽 **발행** 버튼으로 발행 설정 창만 열고, 같은 이름의 카테고리를 골라 봅니다. 설정 창 안의 확인(발행) 버튼은 누르지 않습니다. 선택에 실패해도 초안은 그대로 두며, FIELDNOTE 메시지가 직접 선택할 카테고리 이름을 알려 줍니다. 네이버 화면이 바뀌면 선택자 조정이 필요할 수 있고, 로그인 상태에서만 확인할 수 있습니다.

## 연결 확인

`GET /health`가 `{ "ok": true, "service": "fieldnote-naver-bridge" }`를 반환하면 FIELDNOTE의 **상태 확인**이 성공으로 표시됩니다.

## 범위와 제한

- 본인 소유 계정에서만 사용합니다.
- 캡차, 2단계 인증, 접근 제한을 우회하지 않습니다.
- 네이버 편집기 UI가 바뀌면 입력 선택자를 조정해야 할 수 있습니다.
- 이 브리지는 `127.0.0.1`에서만 수신합니다. 외부에 공개하지 마세요.

## 접근 제한 (Origin 허용 목록)

브리지는 다음 출처의 요청만 받습니다. 그 외는 `403`입니다.

- `file://` 로 연 FIELDNOTE (Origin 없음 또는 `null`)
- `http://localhost:*`, `http://127.0.0.1:*`
- 환경변수 `FIELDNOTE_ALLOWED_ORIGIN`에 적은 출처 (쉼표로 구분, 예: `https://my-studio.vercel.app`)

Vercel에 올린 스튜디오(https)에서 이 컴퓨터의 브리지로 자동 채우기를 쓰려면 `.env`에 `FIELDNOTE_ALLOWED_ORIGIN=https://내-도메인.vercel.app`을 추가하세요. 응답은 허용된 출처만 그대로 돌려주며(`*` 아님), preflight에는 Chrome의 사설망 접근을 위해 `Access-Control-Allow-Private-Network: true`를 답합니다.
