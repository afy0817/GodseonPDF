# GodseonPDF

맥 · 윈도우 · 우분투에서 쓰는 가벼운 PDF 편집기입니다.

- **글자 입력** — 페이지 아무 곳이나 눌러 글상자를 만듭니다. 한글, 글자 크기·색·굵게. 저장한 PDF에서도 글자를 검색·복사할 수 있습니다.
- **이미지 첨부** — PNG · JPG · GIF · WEBP · BMP (투명 PNG 지원). 끌어서 옮기고 모서리로 크기를 바꿉니다. 파일을 창에 끌어다 놓거나 붙여넣기(⌘/Ctrl+V)도 됩니다.
- **형광펜** — 드래그해서 칠합니다 (Shift: 직선). 색·굵기를 고르고, 지우개로 지웁니다.
- **표** — 행·열 수를 정해 넣고, 칸을 눌러 입력합니다. 칸 너비에 맞춰 자동 줄바꿈되고 행 높이가 늘어납니다. Tab 으로 다음 칸,
  행·열 추가/삭제, 경계선을 끌어 크기 조절, 머리글 행, 가운데 정렬.
- **페이지 삭제** — 왼쪽 페이지 목록의 휴지통 버튼, 또는 여러 장을 고른 뒤(⌘/Ctrl·Shift+클릭) Delete.
- 실행 취소/다시 실행, 확대/축소, 암호 걸린 PDF 열기, 한글 문서(CMap) 표시.

## 설치

[Releases](https://github.com/afy0817/GodseonPDF/releases) 에서 내려받습니다.

| OS | 파일 |
| --- | --- |
| macOS | `GodseonPDF-<버전>-mac-arm64.dmg` (Apple 실리콘) / `-mac-x64.dmg` (인텔) |
| Windows | `GodseonPDF-<버전>-windows-setup.exe` (설치) / `-windows-portable.zip` (압축만 풀어서 실행) |
| Ubuntu | `GodseonPDF-<버전>-linux-*.deb` (권장) / `.AppImage` |

- **macOS**: 처음 열 때 "확인되지 않은 개발자" 라고 나오면 **시스템 설정 › 개인정보 보호 및 보안** 에서 **그래도 열기** 를 누릅니다
  (Apple 개발자 인증서 없이 임시(ad-hoc) 서명만 되어 있습니다).
- **Windows**: 코드 서명이 붙기 전 릴리스는 SmartScreen 이 막으면 **추가 정보 › 실행** 을 누릅니다.
  서명이 붙었는지는 `GodseonPDF.exe` 속성 › **디지털 서명** 에 'SignPath Foundation' 이 있는지로 봅니다 ([Code signing policy](#code-signing-policy)).
  설치는 관리자 권한 없이 사용자 폴더(`%LOCALAPPDATA%\Programs\GodseonPDF`)에 되고, PDF 의 '연결 프로그램' 목록에 들어갑니다.
- **Ubuntu**: `sudo apt install ./GodseonPDF-*.deb`. AppImage 는 Ubuntu 24.04 이상에서 보안 설정(AppArmor) 때문에 바로 실행되지 않을 수 있어 deb 를 권합니다.

## 사용법

| 하고 싶은 것 | 방법 |
| --- | --- |
| 열기 | **열기** 버튼, ⌘/Ctrl+O, 또는 PDF 를 창에 끌어다 놓기 |
| 글자 넣기 | **텍스트**(T) → 페이지 클릭 → 입력 → Esc 로 끝내기. 글상자를 다시 누르면 고칩니다 |
| 이미지 넣기 | **이미지**(I), 이미지 파일을 페이지에 끌어다 놓기, 또는 붙여넣기 |
| 형광펜 | **형광펜**(H) → 드래그. Shift 를 누르면 직선. **지우개**(E) 로 문질러 지우기 |
| 표 넣기 | **표**(G) → 옵션 막대에서 행·열 수 → 페이지 클릭 → 첫 칸부터 입력, Tab/Shift+Tab 으로 이동 (마지막 칸에서 Tab: 행 추가) |
| 표 고치기 | 표를 누르면 옵션 막대에 행·열 추가/삭제, 정렬, 머리글 행. 선을 끌면 크기 조절, 왼쪽 위 손잡이로 이동 |
| 옮기기·지우기 | **선택**(V) → 끌어서 이동, 방향키(Shift: 10pt), Delete 로 삭제 |
| 페이지 삭제 | 페이지 목록의 휴지통, 또는 **페이지 삭제** 버튼 (선택한 페이지, 없으면 현재 페이지) |
| 저장 | **저장**(⌘/Ctrl+S) 은 원래 파일에 덮어쓰기, **다른 이름으로 저장**(⌘/Ctrl+Shift+S) |
| 확대/축소 | ⌘/Ctrl + `=` / `-`, ⌘/Ctrl+0(실제 크기), ⌘/Ctrl+9(폭 맞춤), ⌘/Ctrl+휠·트랙패드 확대 |

### 저장 방식과 주의할 점

- 넣은 글자·이미지·형광펜·표는 **PDF 페이지 내용에 직접** 들어갑니다. 다른 PDF 프로그램에서도 똑같이 보이고, 글자는 검색·복사됩니다.
- 앱을 켜 둔 동안에는 몇 번을 저장해도 계속 고칠 수 있습니다 (저장할 때마다 처음 연 원본에 편집 내용을 다시 넣습니다).
  하지만 **저장한 파일을 다시 열면** 넣었던 것들은 일반 PDF 내용이 되어 이 앱에서 옮기거나 고칠 수 없습니다. 원본이 필요하면 **다른 이름으로 저장** 하세요.
- PDF 에 원래 들어 있던 글자를 고치는 기능은 없습니다 (그 위에 글자·표를 얹을 수 있습니다).
- 글꼴은 나눔고딕과 보조 글꼴(Noto Sans KR 파생: ㈜ ① ✓ 같은 기호, 가나 등)을 씁니다. 이모지처럼 두 글꼴에 없는 문자는 PDF 에 나오지 않으며, 저장할 때 알려 줍니다.
- 암호로 열어야 하는 PDF 는 저장한 파일도 같은 암호로 보호됩니다. 인쇄·복사 제한 같은 보안 설정만 있는 PDF 는 저장하면 제한이 풀립니다.
- 디지털 서명이 들어 있는 PDF 는 고쳐서 저장하면 그 서명이 더 이상 유효하지 않습니다.

## 개발

Node.js 22.12 이상(24 권장)이 필요합니다.

```bash
npm install
npm run dev          # 개발 모드 (Vite 개발 서버 + Electron)
npm start            # 배포용으로 빌드해서 실행
npm run typecheck
npm run test:e2e     # 실제 앱을 띄워 편집·저장을 끝까지 검사 (npm run build 후, poppler 의 pdftoppm·pdftotext 필요)
```

배포 파일:

```bash
npm run dist:mac     # release/GodseonPDF-<버전>-mac-<arch>.dmg (ad-hoc 서명)
npm run dist:linux   # release/*.AppImage, *.deb (x64, arm64)
npm run dist:win     # release/win-unpacked → 설치 파일은 Inno Setup 으로:
                     #   iscc /DAppVersion=1.0.0 packaging\windows\GodseonPDF.iss
```

릴리스: 버전 태그를 push 하면 GitHub Actions(`.github/workflows/build.yml`)가 세 OS 를 빌드해 Release 를 만듭니다.

```bash
git tag v1.0.0
git push origin v1.0.0
```

### 윈도우 코드 서명 (SignPath Foundation)

GodseonSync 와 같은 방식입니다. 저장소에 아래 값이 있을 때만 서명하고, 없으면 서명 없이 빌드합니다.

1. [SignPath Foundation](https://signpath.org) 에 GodseonPDF 프로젝트를 등록합니다 (오픈 소스 무료). 프로젝트 slug `GodseonPDF`, 서명 정책 slug `release-signing`.
2. SignPath 프로젝트에 아티팩트 설정 두 개를 만듭니다: `binaries` ← `.signpath/artifact-configurations/binaries.xml`, `installer` ← `installer.xml`.
3. GitHub 저장소 **Settings › Secrets and variables › Actions**: Secret `SIGNPATH_API_TOKEN`, Variable `SIGNPATH_ORGANIZATION_ID`
   (slug 가 다르면 Variable `SIGNPATH_PROJECT_SLUG`, `SIGNPATH_SIGNING_POLICY_SLUG`).
4. 태그를 push 하면 릴리스마다 서명 요청이 두 번 갑니다 — ① `GodseonPDF.exe` + 제거 프로그램 ② 설치 파일. SignPath 에서 승인하면 이어서 진행됩니다.

SignPath 는 실행 파일의 제품 이름(`GodseonPDF`)과 제품 버전(태그의 숫자 부분, 예: `v1.1.0-beta` → `1.1.0`)을 확인합니다.
워크플로가 package.json 의 `shortVersionWindows` 에 그 값을 넣고, `scripts/after-sign.cjs` 가 실행 파일의 ProductVersion 문자열을 맞춥니다.

### 구조

```
electron/main.cjs      창·메뉴·파일 열기/저장·저장 안 한 변경 확인 (app:// 프로토콜로 화면을 띄움)
electron/preload.cjs   화면에 노출하는 최소 API
src/main.ts            화면 진입점: 열기·저장·명령·끌어다 놓기
src/lib/viewer.ts      pdf.js 페이지 그리기, 배율, 보이는 페이지만 그리기
src/lib/overlay.ts     글상자·이미지·형광펜·표를 페이지 위에 그리기
src/lib/interactions.ts / editor.ts   마우스 조작, 편집 상태, 실행 취소
src/lib/table.ts / textLayout.ts      표 배치, 글자 폭 측정·줄바꿈 (화면과 저장이 같은 계산)
src/lib/exporter.ts    pdf-lib 로 원본 PDF 에 편집 내용을 넣어 저장
packaging/windows/     Inno Setup 스크립트
.signpath/             SignPath 아티팩트 설정
```

## Code signing policy

윈도우 배포 파일(`GodseonPDF.exe`, 설치 파일, 제거 프로그램)은 SignPath Foundation 인증서로 코드 서명합니다.
Free code signing provided by [SignPath.io](https://about.signpath.io), certificate by [SignPath Foundation](https://signpath.org).

- 서명하는 파일은 이 저장소의 소스로 GitHub Actions 가 빌드한 것뿐이고, 릴리스마다 승인자가 서명 요청을 직접 승인합니다.
- Committers and reviewers: [afy0817](https://github.com/afy0817)
- Approvers: [afy0817](https://github.com/afy0817)
- 개인정보: GodseonPDF 는 네트워크로 어떤 정보도 보내지 않습니다 — [개인정보처리방침](PRIVACY.md).

## 라이선스

[MIT](LICENSE). 들어 있는 오픈 소스 구성 요소:
[Electron](https://www.electronjs.org) (MIT, Chromium 라이선스는 배포 파일의 `LICENSES.chromium.html`),
[pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0), [@cantoo/pdf-lib](https://github.com/cantoo-scribe/pdf-lib) (MIT),
[@cantoo/fontkit](https://github.com/cantoo-scribe/fontkit) (MIT), [Lucide](https://lucide.dev) 아이콘 (ISC),
나눔고딕 (SIL OFL 1.1, `public/fonts/NanumGothic-OFL.txt`), Noto Sans KR 파생 보조 글꼴 (SIL OFL 1.1, `public/fonts/GodseonFallback-OFL.txt`).

---

## English

GodseonPDF is a lightweight PDF editor for macOS, Windows and Ubuntu.

- **Text** anywhere on a page (Korean supported; size, color, bold). Saved text stays searchable.
- **Images** (PNG/JPG/GIF/WEBP/BMP, transparency): move, resize, drag & drop, paste.
- **Highlighter** (Shift for straight lines) with colors, width and an eraser.
- **Tables**: choose rows/columns, type into cells (auto wrap, Tab to the next cell, Tab on the last cell adds a row),
  add/delete rows and columns, drag borders to resize, header row, center alignment.
- **Delete pages** from the page list. Undo/redo, zoom, password-protected PDFs.

Edits are written into the page content when you save, so they look the same in every PDF viewer. While the app stays open you can keep
editing and re-saving; once a saved file is reopened, earlier edits are regular PDF content. Download from
[Releases](https://github.com/afy0817/GodseonPDF/releases). On macOS, use **System Settings › Privacy & Security › Open Anyway** on first launch;
on Windows, **More info › Run anyway** for releases without a code signature. Nothing is sent over the network — see the [privacy policy](PRIVACY.md).
