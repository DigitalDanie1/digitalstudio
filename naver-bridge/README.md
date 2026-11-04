# FIELDNOTE 네이버 블로그 브리지

승인된 FIELDNOTE 블로그 원고를 네이버 SmartEditor 글쓰기 화면에 채우는 개인용 로컬 브리지입니다. 최종 등록은 자동화하지 않습니다.

## 설치·실행

```bash
cd /Users/daniel/Documents/Codex/2026-10-30/new-chat/naver-bridge
npm install
npx playwright install chromium
npm start
```

선택적으로 브리지 요청 토큰을 설정합니다.

```bash
FIELDNOTE_BRIDGE_TOKEN='새로운-긴-토큰' npm start
```

## FIELDNOTE 연결

1. FIELDNOTE의 **발행 센터 → 네이버 블로그 → 연결하기**를 엽니다.
2. URL에 `http://127.0.0.1:8787/publish/naver`를 입력합니다.
3. 토큰을 설정했다면 동일한 값을 입력합니다.
4. 실제 원고를 검수 승인한 후 **승인 후 올리기**를 누릅니다.
5. 처음 열린 네이버 창에서 직접 로그인합니다. 로그인 상태는 이 폴더의 `.naver-profile`에만 유지됩니다.
6. 제목·본문·출처·카테고리·공개 범위를 확인하고 네이버의 **등록** 버튼을 직접 누릅니다.

## 범위와 제한

- 본인 소유 계정에서만 사용합니다.
- 캡차, 2단계 인증, 접근 제한을 우회하지 않습니다.
- 네이버 편집기 UI가 바뀌면 입력 선택자를 조정해야 할 수 있습니다.
- 이 브리지는 `127.0.0.1`에서만 수신합니다. 외부에 공개하지 마세요.
