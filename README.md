# GodseonPDF

맥 · 윈도우 · 우분투에서 쓰는 가벼운 PDF 편집기입니다. 화면은 **한국어 / English** 를 지원합니다.

- **글자 입력** — 페이지 아무 곳이나 눌러 글상자를 만듭니다. 한글, 글자 크기·색·굵게, 나눔고딕/나눔명조. 입력하는 중에도 테두리나 손잡이를 끌어 옮길 수 있습니다.
  저장한 PDF에서도 글자를 검색·복사할 수 있습니다.
- **글꼴 추가** — 컴퓨터에 있는 글꼴 파일(TTF · OTF · TTC)을 추가해 글상자에 쓸 수 있습니다. 윈도우의 바탕·굴림(.ttc), 맥의 Apple SD Gothic Neo,
  우분투의 Noto CJK 처럼 글꼴 모음(TTC)이면 그 안에서 고릅니다. 추가한 글꼴은 저장해 두었다가 다음에도 씁니다.
- **기존 글자 고치기** — PDF 에 원래 있던 글자를 눌러 그 자리에서 고치거나 지웁니다. 원래 글자는 저장할 때 실제로 지워지고,
  비슷한 글꼴(명조 → 나눔명조, 고딕 → 나눔고딕)·같은 크기·같은 색으로 다시 씁니다.
- **이미지 첨부** — PNG · JPG · GIF · WEBP · BMP (투명 PNG 지원). 끌어서 옮기고 모서리로 크기를 바꿉니다. 파일을 창에 끌어다 놓거나 붙여넣기(⌘/Ctrl+V)도 됩니다.
- **형광펜** — 드래그해서 칠합니다 (Shift: 직선). 색·굵기를 고르고, 지우개로 지웁니다.
- **표** — 행·열 수를 정해 넣고, 칸을 눌러 입력합니다. 칸 너비에 맞춰 자동 줄바꿈되고 행 높이가 늘어납니다. Tab 으로 다음 칸,
  행·열 추가/삭제, 경계선을 끌어 크기 조절, 머리글 행, 가운데 정렬.
- **페이지 삭제** — 왼쪽 페이지 목록의 휴지통 버튼, 또는 여러 장을 고른 뒤(⌘/Ctrl·Shift+클릭) Delete.
- **서명** — 서명 칸에 마우스·펜으로 그리면 여백을 잘라 낸 투명 PNG 로 만들어 오른쪽 **서명 서랍**에 모아 둡니다.
  서랍에서 페이지로 끌어다 놓거나 눌러서 넣고, 다음에 실행해도 그대로 남아 있습니다.
- **이미지로 저장** — 고른 페이지나 전체 페이지를 PNG · JPG 로 내보냅니다 (72 / 150 / 300 dpi). 여러 장이면 ZIP 파일 하나로 묶거나
  폴더에 낱장으로 저장합니다. 넣은 글자·이미지·형광펜·표도 함께 들어갑니다.
- 실행 취소/다시 실행, 확대/축소, 암호 걸린 PDF 열기, 한글 문서(CMap) 표시.
- **문서 전체 글꼴 바꾸기 (실험 기능)** — 모든 글자를 나눔고딕·나눔명조로 다시 씁니다. 결과는 저장 전에 확인하고 실행 취소할 수 있습니다.

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
| 글자 넣기 | **텍스트**(T) → 페이지 클릭 → 입력 → Esc 로 끝내기. 입력하는 중에도 점선 테두리나 왼쪽 위 손잡이를 끌면 옮겨지고, 놓으면 이어서 입력합니다. 글상자를 다시 누르면 고칩니다 |
| 글꼴 추가 | 텍스트 옵션의 글꼴 목록 › **글꼴 추가…** → TTF·OTF·TTC 파일 선택 (윈도우 `C:\Windows\Fonts`, 맥 `/System/Library/Fonts`·`~/Library/Fonts`, 우분투 `/usr/share/fonts`). 목록에서 지우려면 옆의 휴지통 |
| 원래 글자 고치기 | **글자 고치기**(R) → 마우스를 올리면 고칠 수 있는 글줄이 점선으로 보임 → 눌러서 고치기. 글자를 다 지우면 원래 글자 지우기. **원래대로** 로 되돌리기 |
| 이미지 넣기 | **이미지**(I), 이미지 파일을 페이지에 끌어다 놓기, 또는 붙여넣기 |
| 서명 | **서명**(S) 으로 오른쪽 서랍 열기 → **새 서명 만들기** → 그리기 (색·굵기, 되돌리기 ⌘/Ctrl+Z) → **저장하고 넣기**(지금 보는 페이지에) 또는 **서랍에 저장**. 서랍의 서명은 페이지로 끌어다 놓거나 눌러서 넣고, 모서리로 크기 조절. 휴지통으로 서랍에서 지우기 (알림의 실행 취소로 되살리기) |
| 형광펜 | **형광펜**(H) → 드래그. Shift 를 누르면 직선. **지우개**(E) 로 문질러 지우기 |
| 표 넣기 | **표**(G) → 옵션 막대에서 행·열 수 → 페이지 클릭 → 첫 칸부터 입력, Tab/Shift+Tab 으로 이동 (마지막 칸에서 Tab: 행 추가) |
| 표 고치기 | 표를 누르면 옵션 막대에 행·열 추가/삭제, 정렬, 머리글 행. 선을 끌면 크기 조절, 왼쪽 위 손잡이로 이동 |
| 옮기기·지우기 | **선택**(V) → 끌어서 이동, 방향키(Shift: 10pt), Delete 로 삭제 |
| 페이지 삭제 | 페이지 목록의 휴지통, 또는 **페이지 삭제** 버튼 (선택한 페이지, 없으면 현재 페이지) |
| 저장 | **저장**(⌘/Ctrl+S) 은 원래 파일에 덮어쓰기, **다른 이름으로 저장**(⌘/Ctrl+Shift+S) |
| 이미지로 저장 | 페이지 목록에서 페이지를 고르고(⌘/Ctrl·Shift+클릭) **이미지로 저장** 버튼 또는 **파일 › 이미지로 내보내기…**(⌘/Ctrl+Shift+E). 고른 페이지·현재 페이지·전체·직접 지정(예: `1-3, 5, 8-`) 중에서 고르고, 형식(PNG/JPG)·해상도·저장 방법(ZIP 하나 / 폴더에 낱장)을 정합니다. 파일 이름은 `문서이름_p01.png` 처럼 페이지 번호가 붙습니다 |
| 확대/축소 | ⌘/Ctrl + `=` / `-`, ⌘/Ctrl+0(실제 크기), ⌘/Ctrl+9(폭 맞춤), ⌘/Ctrl+휠·트랙패드 확대 |
| 언어 | 도구 막대 오른쪽 끝 언어 버튼, 또는 **보기 › Language / 언어**. 처음에는 OS 언어를 따릅니다 |

### 저장 방식과 주의할 점

- 넣은 글자·이미지·형광펜·표는 **PDF 페이지 내용에 직접** 들어갑니다. 다른 PDF 프로그램에서도 똑같이 보이고, 글자는 검색·복사됩니다.
- 앱을 켜 둔 동안에는 몇 번을 저장해도 계속 고칠 수 있습니다 (저장할 때마다 처음 연 원본에 편집 내용을 다시 넣습니다).
  하지만 **저장한 파일을 다시 열면** 넣었던 것들은 일반 PDF 내용이 되어 이 앱에서 옮기거나 고칠 수 없습니다. 원본이 필요하면 **다른 이름으로 저장** 하세요.
- **기존 글자 고치기**: PDF 는 글자를 '이 위치에 이 글자를 찍어라' 는 조각으로 저장하고 글꼴도 쓰인 글자만 들어 있어서,
  고친 글줄만 지우고 비슷한 글꼴로 다시 씁니다. 원래 글자를 확실히 지울 수 없는 곳(폭 정보가 없는 글꼴 등)은 배경색으로 덮기만 하며,
  저장할 때 몇 곳인지 알려 줍니다 — 그런 곳은 검색·복사하면 원래 글자가 나올 수 있습니다. 글줄이 길어져도 뒤 글자가 밀리지는 않습니다.
  스캔한 PDF 는 글자가 그림이라 고칠 수 없습니다.
- **문서 전체 글꼴 바꾸기**는 실험 기능입니다. 원래 글꼴과 모양이 달라지고 문서에 따라 글자가 깨질 수 있습니다.
  원래 PDF 에서 굵게 보이도록 덧칠만 한 글자는 보통 굵기로 바뀝니다 (필요하면 그 글줄을 눌러 굵게).
- 추가한 글꼴은 쓰인 글자만 PDF 에 들어갑니다. 굵은 글꼴 파일이 따로 없는 글꼴의 **굵게**는 흉내 낸 굵기(글자 외곽선을 같이 칠함)입니다.
  글꼴 라이선스가 문서에 넣는 것(임베딩)을 막고 있으면 추가할 때 알려 줍니다. 오래된 맥 글꼴처럼 화면 엔진이 거부하는 부분이 있는 파일은 추가할 때 그 부분을 손질합니다.
- 글꼴은 나눔고딕·나눔명조와 보조 글꼴(Noto Sans KR 파생: ㈜ ① ✓ 같은 기호, 가나 등)을 씁니다. 이모지처럼 어느 글꼴에도 없는 문자는 PDF 에 나오지 않으며, 저장할 때 알려 줍니다.
- 암호로 열어야 하는 PDF 는 저장한 파일도 같은 암호로 보호됩니다. 인쇄·복사 제한 같은 보안 설정만 있는 PDF 는 저장하면 제한이 풀립니다.
- 디지털 서명이 들어 있는 PDF 는 고쳐서 저장하면 그 서명이 더 이상 유효하지 않습니다.
- **서명** 기능은 손글씨 서명을 그림(PNG)으로 넣는 것으로, 공동인증서 같은 전자서명(디지털 서명)이 아닙니다.
  같은 서명을 여러 곳에 넣어도 PDF 에는 그림이 한 번만 들어갑니다. 서명 서랍은 앱 데이터 폴더의 `signatures` 에 저장됩니다.
- **이미지로 저장**은 저장할 때와 같은 결과(편집 내용 포함, 지운 페이지 제외)를 그립니다. 열린 PDF 파일은 바꾸지 않습니다.
  저장할 곳을 먼저 고른 뒤 한 장씩 그려 바로 쓰므로 큰 문서도 메모리를 많이 쓰지 않고, 진행 중에 **취소** 할 수 있습니다
  (취소하거나 실패하면 쓰다 만 파일은 지웁니다). 아주 큰 페이지(도면·포스터 등)는 한 장이 6천만 픽셀을 넘지 않도록 줄여서 그립니다.

## 개발

Node.js 22.12 이상(24 권장)이 필요합니다.

```bash
npm install
npm run dev          # 개발 모드 (Vite 개발 서버 + Electron)
npm start            # 배포용으로 빌드해서 실행
npm run typecheck
npm run test:unit    # 원래 글자 지우기(내용 스트림 편집)·ZIP 작성·페이지 범위 단위 테스트 — poppler 의 pdftotext, python3 필요
npm run test:e2e     # 실제 앱을 띄워 편집·저장을 끝까지 검사 (npm run build 후, poppler 의 pdftoppm·pdftotext 필요)
```

macOS 의 개발 모드는 이름·아이콘을 GodseonPDF 로 바꾼 Electron 사본(`node_modules/.cache/godseon-dev`)으로 실행해서 메뉴 막대·Dock 에 "Electron" 대신 GodseonPDF 가 보입니다.

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
electron/main.cjs      창·메뉴·파일 열기/저장·저장 안 한 변경 확인·언어 설정 (app:// 프로토콜로 화면을 띄움)
electron/i18n.cjs      메뉴·대화상자 문구 (한국어/English)
electron/preload.cjs   화면에 노출하는 최소 API
src/main.ts            화면 진입점: 열기·저장·명령·끌어다 놓기
src/lib/i18n.ts        화면 문구 (한국어/English)
src/lib/viewer.ts      pdf.js 페이지 그리기, 배율, 보이는 페이지만 그리기
src/lib/overlay.ts     글상자·이미지·형광펜·표·덮개를 페이지 위에 그리기
src/lib/interactions.ts / editor.ts   마우스 조작, 편집 상태, 실행 취소
src/lib/table.ts / textLayout.ts      표 배치, 글자 폭 측정·줄바꿈 (화면과 저장이 같은 계산)
src/lib/userFonts.ts   사용자가 추가한 글꼴 (화면 표시·저장)
electron/fonts.cjs     추가한 글꼴 저장, TTC 나누기, 화면 엔진용 손질
src/lib/textRuns.ts    PDF 에 원래 있던 글줄 찾기, 배경·글자색 읽기 (기존 글자 고치기)
src/lib/contentEdit.ts 내용 스트림에서 원래 글자 그리기 명령을 찾아 지우기
src/lib/convert.ts     문서 전체 글꼴 바꾸기
src/lib/exporter.ts    pdf-lib 로 원본 PDF 에 편집 내용을 넣어 저장
src/lib/imageExport.ts / exportDialog.ts / zip.ts   이미지로 내보내기 (페이지 그리기, 대화상자, 압축 없는 ZIP 작성)
src/lib/signaturePad.ts / signatures.ts             서명 그리기(여백 자르기·투명 PNG), 서명 서랍(끌어다 놓기)
electron/signatures.cjs  서명 서랍 저장 (앱 데이터 폴더)
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
나눔고딕·나눔명조 (SIL OFL 1.1, `public/fonts/NanumGothic-OFL.txt`, `NanumMyeongjo-OFL.txt`),
Noto Sans KR 파생 보조 글꼴 (SIL OFL 1.1, `public/fonts/GodseonFallback-OFL.txt`).

---

## English

GodseonPDF is a lightweight PDF editor for macOS, Windows and Ubuntu. The interface is available in **Korean and English**
(follows the OS language; switch with the language button at the right end of the toolbar or **View › Language**).

- **Text** anywhere on a page (Korean supported; size, color, bold, sans/serif). Saved text stays searchable.
- **Add your own fonts** (TTF, OTF, TTC — pick one font from a collection such as Windows' Batang/Gulim, macOS' Apple SD Gothic Neo or Ubuntu's Noto CJK). Added fonts are kept for next time.
- **Edit existing text**: click a line that is already in the PDF to change or delete it. When saving, the original glyphs are removed
  and the line is rewritten in a similar font, size and color. Where the original can't be removed safely, it is covered instead (you are told how many places).
- **Images** (PNG/JPG/GIF/WEBP/BMP, transparency): move, resize, drag & drop, paste.
- **Highlighter** (Shift for straight lines) with colors, width and an eraser.
- **Tables**: choose rows/columns, type into cells (auto wrap, Tab to the next cell, Tab on the last cell adds a row),
  add/delete rows and columns, drag borders to resize, header row, center alignment.
- **Delete pages** from the page list. Undo/redo, zoom, password-protected PDFs.
- **Signatures**: draw your signature with a mouse or pen; it is trimmed to a transparent PNG and kept in the **Signatures** drawer on the right,
  from where you drag it onto pages or click to place it. Saved signatures stay for next time (this is a handwritten image, not a digital certificate signature).
- **Save pages as images**: export the selected pages, the current page, all pages or a custom range (e.g. `1-3, 5, 8-`) as PNG or JPG
  at 72/150/300 dpi — as one ZIP file or as separate files in a folder (**File › Export as Images…**, ⌘/Ctrl+Shift+E). Your edits are included.
- **Change all fonts (experimental)**: rewrite every line in Nanum Gothic / Nanum Myeongjo; check the result and undo before saving.

Edits are written into the page content when you save, so they look the same in every PDF viewer. While the app stays open you can keep
editing and re-saving; once a saved file is reopened, earlier edits are regular PDF content. Download from
[Releases](https://github.com/afy0817/GodseonPDF/releases). On macOS, use **System Settings › Privacy & Security › Open Anyway** on first launch;
on Windows, **More info › Run anyway** for releases without a code signature. Nothing is sent over the network — see the [privacy policy](PRIVACY.md).
