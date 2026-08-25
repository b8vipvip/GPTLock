[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId = 'bhchcpeodphgjfjoookncemnamdbfcof',

    [Parameter(Mandatory = $false)]
    [string]$BinaryPath = '',

    [Parameter(Mandatory = $false)]
    [ValidateSet('All', 'Chrome', 'Edge')]
    [string]$Browser = 'All'
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$repositoryRoot = (Resolve-Path (Join-Path $scriptDirectory '..\..')).Path

if ([string]::IsNullOrWhiteSpace($BinaryPath)) {
    $BinaryPath = Join-Path $repositoryRoot 'native-core\target\release\gptlock-core.exe'
}
if (-not (Test-Path -LiteralPath $BinaryPath -PathType Leaf)) {
    throw "找不到二进制文件 / Binary not found: $BinaryPath`n请先运行 / Build first: cargo build --release --manifest-path native-core/Cargo.toml"
}

$installDirectory = Join-Path $env:LOCALAPPDATA 'GPTLock\bin'
$manifestDirectory = Join-Path $env:LOCALAPPDATA 'GPTLock\native-messaging'
$extensionDirectory = Join-Path $env:LOCALAPPDATA 'GPTLock\extension'
$extensionSource = Join-Path $repositoryRoot 'extension'
$installedBinary = Join-Path $installDirectory 'gptlock-core.exe'
New-Item -ItemType Directory -Force -Path $installDirectory, $manifestDirectory, $extensionDirectory | Out-Null
Copy-Item -LiteralPath $BinaryPath -Destination $installedBinary -Force
$runtimeFiles = @(
    'background.js', 'content.js', 'guard.js', 'manifest.json', 'network-evidence.js', 'network-monitor.js',
    'options.css', 'options.html', 'options.js', 'policy.js', 'popup.css', 'popup.html', 'popup.js'
)
foreach ($file in $runtimeFiles) {
    Copy-Item -LiteralPath (Join-Path $extensionSource $file) -Destination (Join-Path $extensionDirectory $file) -Force
}

function Install-NativeManifest {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$RegistryPath
    )

    $manifestPath = Join-Path $manifestDirectory "$Name.json"
    $manifest = [ordered]@{
        name = 'com.gptlock.core'
        description = 'GPTLock 本地验证核心 / GPTLock Local Verification Core'
        path = $installedBinary
        type = 'stdio'
        allowed_origins = @("chrome-extension://$ExtensionId/")
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 4
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8WithoutBom)
    New-Item -Path $RegistryPath -Force | Out-Null
    Set-Item -Path $RegistryPath -Value $manifestPath
}

if ($Browser -in @('All', 'Chrome')) {
    Install-NativeManifest -Name 'chrome' -RegistryPath 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.gptlock.core'
}
if ($Browser -in @('All', 'Edge')) {
    Install-NativeManifest -Name 'edge' -RegistryPath 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.gptlock.core'
}

Write-Host 'GPTLock Windows Native Messaging 安装完成 / installation completed.' -ForegroundColor Green
Write-Host '请完全退出并重新启动 Chrome/Edge / Fully restart Chrome or Edge.'
Write-Host "扩展目录 / Extension directory: $extensionDirectory"
Write-Host '本机 API 可按需启动 / Start the optional local API with:'
Write-Host "  `"$installedBinary`" serve"
