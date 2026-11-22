# FIELDNOTE 작업 규칙 (여러 Claude 세션이 같이 고쳐요)

- 고치기 전에 `git pull --rebase`, 올리기 직전에 다시 `git pull --rebase` 하고 `npm run check` 가 통과해야 push.
  - `npm run check | tail` 처럼 파이프로 이으면 실패해도 통과처럼 보여요. 파이프 없이 돌리거나 `set -o pipefail`.
  - Vercel 도 배포 때 `npm run check` 를 먼저 돌려요 (package.json 의 vercel-build). 걸리면 배포가 멈추고 사이트는 예전 그대로예요.
- `outputs/fieldnote-studio.html` 에 새 `<script>`·`<link>` 파일을 넣으면 `vercel.json` rewrites 에 같은 경로를 꼭 추가 (안 하면 사이트에서 404, 빈 화면).
  - 스크립트를 바꾸면 `?v=` 값을 올려요 (브라우저 캐시).
- 실행기(runner/) 에 새 파일을 만들면 세 군데 목록에 같이 넣어요: `runner/설치·업데이트.command` 의 FILES, `runner/server.mjs` `/update` 의 FILES, (검사가 확인해요).
- 실행기 기능을 바꾸면 `runner/server.mjs` 의 `API_LEVEL` 을 1 올리고 주석 맨 앞에 무엇이 바뀌었는지 써요. 다른 세션이 먼저 올렸으면 rebase 후 번호를 다시 맞춰요.
- 실행기 전체 시험: `npm test` (ffmpeg 필요, 몇 분 걸림). 기능을 바꿔서 시험이 틀리게 되면 시험도 같이 고쳐요.
- 맥에 실행기를 올리는 건 사이트의 '실행기 업데이트' 버튼 (POST /update) 이 GitHub main 을 받아요. 맥마다 한 번 `유튜브 로그인 연결.command` 가 필요해요 (YouTube 봇 확인 차단).
- 사용자 결정 (바꾸지 말 것): 자막 입히기 단계는 꺼 둠, 실행기 AI 는 맥의 Claude Code (API 키 없음).
