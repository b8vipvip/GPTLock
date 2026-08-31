#define MyAppName "GPTLock"
#ifndef MyAppVersion
  #define MyAppVersion "0.4.4"
#endif
#define MyAppPublisher "GPTLock Maintainers"
#define MyAppURL "https://github.com/b8vipvip/GPTLock"
#define ExtensionId "bhchcpeodphgjfjoookncemnamdbfcof"

[Setup]
AppId={{9A784B09-CB5C-4A05-8A29-49F36DA0D6CA}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}/issues
AppUpdatesURL={#MyAppURL}/releases
DefaultDirName={localappdata}\GPTLock
DefaultGroupName=GPTLock
DisableDirPage=no
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputDir=..\..\dist\windows
OutputBaseFilename=GPTLockSetup-x64
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName=GPTLock
VersionInfoVersion={#MyAppVersion}
VersionInfoProductName=GPTLock
VersionInfoDescription=GPTLock Installer

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[InstallDelete]
; Extension UI files are code, not user data. Remove the old snapshot before copying the
; new release so deleted/renamed legacy files can never survive an in-place update.
Type: filesandordirs; Name: "{app}\extension"

[Files]
Source: "..\..\native-core\target\release\gptlock-core.exe"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "..\..\extension\*"; DestDir: "{app}\extension"; Excludes: "tests\*,README.md,package.json"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "Update-GPTLock.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion
Source: "Repair-GPTLock.ps1"; DestDir: "{app}\tools"; Flags: ignoreversion

[Dirs]
Name: "{app}\native-messaging"

[Registry]
Root: HKCU; Subkey: "Software\Google\Chrome\NativeMessagingHosts\com.gptlock.core"; ValueType: string; ValueName: ""; ValueData: "{app}\native-messaging\chrome.json"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Microsoft\Edge\NativeMessagingHosts\com.gptlock.core"; ValueType: string; ValueName: ""; ValueData: "{app}\native-messaging\edge.json"; Flags: uninsdeletekey

[Icons]
Name: "{group}\GPTLock 扩展目录"; Filename: "{sys}\explorer.exe"; Parameters: """{app}\extension"""
Name: "{group}\检查 GPTLock 更新"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\Update-GPTLock.ps1"""; WorkingDir: "{app}\tools"
Name: "{group}\修复 GPTLock 浏览器连接"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\Repair-GPTLock.ps1"""; WorkingDir: "{app}\tools"
Name: "{group}\卸载 GPTLock"; Filename: "{uninstallexe}"

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\tools\Repair-GPTLock.ps1"""; Description: "验证浏览器连接 / Verify browser connection"; Flags: postinstall runhidden waituntilterminated

[Code]
function JsonEscape(Value: String): String;
begin
  Result := Value;
  StringChangeEx(Result, '\', '\\', True);
  StringChangeEx(Result, '"', '\"', True);
end;

function PowerShellSingleQuote(Value: String): String;
begin
  Result := Value;
  StringChangeEx(Result, '''', '''''', True);
end;

function StopInstalledCoreProcesses(): Boolean;
var
  CorePath: String;
  Script: String;
  Params: String;
  ResultCode: Integer;
begin
  CorePath := PowerShellSingleQuote(ExpandConstant('{app}\bin\gptlock-core.exe'));
  Script :=
    '$ErrorActionPreference=''Stop''; ' +
    '$target=[IO.Path]::GetFullPath(''' + CorePath + '''); ' +
    '$deadline=(Get-Date).AddSeconds(8); ' +
    'do { ' +
    '$matches=@(Get-Process -Name ''gptlock-core'' -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and ([IO.Path]::GetFullPath($_.Path) -ieq $target) } catch { $false } }); ' +
    'foreach ($p in $matches) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }; ' +
    'Start-Sleep -Milliseconds 150; ' +
    '$remaining=@(Get-Process -Name ''gptlock-core'' -ErrorAction SilentlyContinue | Where-Object { try { $_.Path -and ([IO.Path]::GetFullPath($_.Path) -ieq $target) } catch { $false } }); ' +
    'if ($remaining.Count -eq 0) { exit 0 } ' +
    '} while ((Get-Date) -lt $deadline); ' +
    'throw ''GPTLock core still running after retry window''';
  Params := '-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "' + Script + '"';
  Result := Exec(
    ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe'),
    Params,
    '',
    SW_HIDE,
    ewWaitUntilTerminated,
    ResultCode
  ) and (ResultCode = 0);
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Result := '';
  if FileExists(ExpandConstant('{app}\bin\gptlock-core.exe')) then
  begin
    if not StopInstalledCoreProcesses() then
      Result := '无法停止正在运行的 GPTLock 本地核心，请完全退出浏览器后重试 / Could not stop the running GPTLock core; fully exit the browser and retry.';
  end;
end;

procedure WriteNativeManifest(FileName: String);
var
  Json: String;
  BinaryPath: String;
begin
  BinaryPath := JsonEscape(ExpandConstant('{app}\bin\gptlock-core.exe'));
  Json := '{' + #13#10 +
    '  "name": "com.gptlock.core",' + #13#10 +
    '  "description": "GPTLock Local Verification Core",' + #13#10 +
    '  "path": "' + BinaryPath + '",' + #13#10 +
    '  "type": "stdio",' + #13#10 +
    '  "allowed_origins": ["chrome-extension://{#ExtensionId}/"]' + #13#10 +
    '}' + #13#10;
  if not SaveStringToFile(FileName, UTF8Encode(Json), False) then
    RaiseException('无法写入 Native Messaging 清单 / Cannot write Native Messaging manifest');
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if CurStep = ssPostInstall then
  begin
    WriteNativeManifest(ExpandConstant('{app}\native-messaging\chrome.json'));
    WriteNativeManifest(ExpandConstant('{app}\native-messaging\edge.json'));
  end;
end;
