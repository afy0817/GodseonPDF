; GodseonPDF 윈도우 설치 파일 (Inno Setup 6)
; 먼저 electron-builder 로 release\win-unpacked 를 만든 뒤 (npm run dist:win):
;   iscc /DAppVersion=1.2.3 packaging\windows\GodseonPDF.iss          (미리 릴리스는 /DAppVersion=1.2.3-beta /DAppNumVersion=1.2.3)
; 관리자 권한 없이 사용자 폴더(%LOCALAPPDATA%\Programs\GodseonPDF)에 설치한다.
;
; /DSignUninstaller: 제거 프로그램을 밖에서 서명한다 (GitHub Actions 의 SignPath 서명). 서명 도구 없이 SignedUninstaller=yes 면
; 처음 컴파일은 build\uninst\uninst-<Inno 버전>-<해시>.e32 를 만들고 '서명 필요' 로 멈춘다 → 그 파일을 서명해 두고 다시 컴파일하면
; Inno Setup 이 서명을 확인해(서명만 빼면 원래와 같은지) 끼워 넣는다. 버전 정보가 바뀌면 해시도 바뀌어 릴리스마다 새로 서명한다.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
; 윈도우 버전 정보는 숫자만 받는다: 태그가 0.2.0-beta 면 /DAppNumVersion=0.2.0 (Actions 가 넘긴다 — exe 의 버전 정보·SignPath 에 넘기는 버전과 같게)
#ifndef AppNumVersion
  #define AppNumVersion AppVersion
#endif
#define AppDir "..\..\release\win-unpacked"

[Setup]
AppId={{0B4FEF73-BBAC-4801-960C-6D927DBADE39}
AppName=GodseonPDF
AppVersion={#AppVersion}
AppVerName=GodseonPDF {#AppVersion}
AppPublisher=afy0817
AppPublisherURL=https://github.com/afy0817/GodseonPDF
AppSupportURL=https://github.com/afy0817/GodseonPDF/issues
DefaultDirName={localappdata}\Programs\GodseonPDF
DisableProgramGroupPage=yes
DisableDirPage=auto
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist
OutputBaseFilename=GodseonPDF-{#AppVersion}-windows-setup
SetupIconFile=..\..\build\icon.ico
UninstallDisplayIcon={app}\GodseonPDF.exe
UninstallDisplayName=GodseonPDF
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ChangesAssociations=yes
; 업데이트 설치 때 실행 중인 GodseonPDF 를 닫는다 (저장하지 않은 문서가 있으면 앱이 저장 여부를 묻는다)
CloseApplications=yes
RestartApplications=no
; 설치 파일·제거 프로그램의 버전 정보 (코드 서명이 제품 이름·버전을 확인한다)
VersionInfoVersion={#AppNumVersion}
VersionInfoTextVersion={#AppNumVersion}
VersionInfoProductName=GodseonPDF
VersionInfoProductVersion={#AppNumVersion}
VersionInfoProductTextVersion={#AppNumVersion}
VersionInfoCompany=afy0817
VersionInfoDescription=GodseonPDF Setup
VersionInfoCopyright=Copyright (c) 2026 afy0817. MIT License.
#ifdef SignUninstaller
SignedUninstaller=yes
SignedUninstallerDir=..\..\build\uninst
#endif

[Languages]
#ifexist AddBackslash(CompilerPath) + "Languages\Korean.isl"
Name: "korean"; MessagesFile: "compiler:Languages\Korean.isl"
#endif
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[InstallDelete]
; 이전 버전의 Electron 파일이 남지 않도록
Type: filesandordirs; Name: "{app}\resources"
Type: filesandordirs; Name: "{app}\locales"

[Files]
Source: "{#AppDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{userprograms}\GodseonPDF"; Filename: "{app}\GodseonPDF.exe"
Name: "{userdesktop}\GodseonPDF"; Filename: "{app}\GodseonPDF.exe"; Tasks: desktopicon

[Registry]
; PDF 의 '연결 프로그램' 목록에 GodseonPDF 를 넣는다 (기본 앱은 바꾸지 않는다 — 사용자가 직접 고른다). 제거할 때 지운다.
Root: HKCU; Subkey: "Software\Classes\GodseonPDF.pdf"; ValueType: string; ValueName: ""; ValueData: "PDF Document"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\GodseonPDF.pdf\DefaultIcon"; ValueType: string; ValueName: ""; ValueData: "{app}\GodseonPDF.exe,0"
Root: HKCU; Subkey: "Software\Classes\GodseonPDF.pdf\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\GodseonPDF.exe"" ""%1"""
Root: HKCU; Subkey: "Software\Classes\.pdf\OpenWithProgids"; ValueType: string; ValueName: "GodseonPDF.pdf"; ValueData: ""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\Applications\GodseonPDF.exe"; ValueType: string; ValueName: "FriendlyAppName"; ValueData: "GodseonPDF"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Applications\GodseonPDF.exe\SupportedTypes"; ValueType: string; ValueName: ".pdf"; ValueData: ""
Root: HKCU; Subkey: "Software\Classes\Applications\GodseonPDF.exe\shell\open\command"; ValueType: string; ValueName: ""; ValueData: """{app}\GodseonPDF.exe"" ""%1"""

[Run]
; 설명 문구는 Inno Setup 기본 번역(LaunchProgram)을 쓴다 — 이 파일은 BOM 없는 UTF-8 이라 한글을 직접 쓰면 깨질 수 있다
Filename: "{app}\GodseonPDF.exe"; Description: "{cm:LaunchProgram,GodseonPDF}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Electron 이 만드는 캐시·설정 폴더 (사용자가 편집한 PDF 는 건드리지 않는다)
Type: filesandordirs; Name: "{userappdata}\GodseonPDF"
