# FIELDNOTE Studio

개인 콘텐츠 기획·작성·검수·발행 요청 스튜디오입니다.

## 배포된 웹 스튜디오

Vercel은 `outputs/fieldnote-studio.html`을 정적 페이지로 제공합니다. 원고·소재·관심 주제는 브라우저 로컬 저장소에 저장되므로, 다른 컴퓨터에서는 **설정·데이터 → JSON 백업/복원**으로 옮깁니다.

## 네이버 블로그 발행

네이버는 `naver-bridge`를 각 컴퓨터에서 직접 실행합니다. 로그인 세션과 브리지 토큰은 저장소에 올리지 않습니다.

```bash
cd naver-bridge
npm install
npx playwright install chromium
npm start
```

그 뒤 Vercel의 FIELDNOTE에서 네이버 발행 브리지 주소로 `http://127.0.0.1:8787/publish/naver`를 설정합니다. 해당 주소는 **현재 사용하는 컴퓨터에서만** 작동합니다.

최종 게시 버튼은 네이버 글쓰기 화면에서 사용자가 직접 누릅니다. 자세한 내용은 [네이버 브리지 안내](naver-bridge/README.md)를 참고하세요.
