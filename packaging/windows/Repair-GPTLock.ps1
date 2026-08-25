[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [ValidatePattern('^[a-p]{32}$')]
    [string]$ExtensionId = 'bhchcpeodphgjfjoookncemnamdbfcof',

    [Parameter(Mandatory = $false)]
    [ValidateSet('All', 'Chrome', 'Edge')]
    [string]$Browser = 'All'
)

$ErrorActionPreference = 'Stop'
$scriptDirectory = Split-Path -Parent $MyInvocation.MyCommand.Path
$installRoot = Split-Path -Parent $scriptDirectory
$binaryPath = Join-Path $installRoot 'bin\gptlock-core.exe'
$manifestDirectory = Join-Path $installRoot 'native-messaging'

if (-not (Test-Path -LiteralPath $binaryPath -PathType Leaf)) {
    throw "本地核心不存在 / Local Core not found: $binaryPath"
}

New-Item -ItemType Directory -Force -Path $manifestDirectory | Out-Null

function Repair-NativeManifest {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][string]$RegistryPath
    )

    $manifestPath = Join-Path $manifestDirectory "$Name.json"
    $manifest = [ordered]@{
        name = 'com.gptlock.core'
        description = 'GPTLock 本地验证核心 / GPTLock Local Verification Core'
        path = $binaryPath
        type = 'stdio'
        allowed_origins = @("chrome-extension://$ExtensionId/")
    }
    $manifestJson = $manifest | ConvertTo-Json -Depth 4
    $utf8WithoutBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8WithoutBom)
    New-Item -Path $RegistryPath -Force | Out-Null
    Set-Item -Path $RegistryPath -Value $manifestPath

    $registeredPath = (Get-Item -LiteralPath $RegistryPath).GetValue('')
    if ($registeredPath -ne $manifestPath) {
        throw "浏览器注册验证失败 / Browser registration check failed: $RegistryPath"
    }
    $savedManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($savedManifest.path -ne $binaryPath -or $savedManifest.allowed_origins[0] -ne "chrome-extension://$ExtensionId/") {
        throw "Native Messaging 清单验证失败 / Manifest verification failed: $manifestPath"
    }
}

if ($Browser -in @('All', 'Chrome')) {
    Repair-NativeManifest -Name 'chrome' -RegistryPath 'HKCU:\Software\Google\Chrome\NativeMessagingHosts\com.gptlock.core'
}
if ($Browser -in @('All', 'Edge')) {
    Repair-NativeManifest -Name 'edge' -RegistryPath 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts\com.gptlock.core'
}

& $binaryPath doctor | Out-Null
if ($LASTEXITCODE -ne 0) {
    throw "本地核心诊断失败 / Local Core doctor failed with exit code $LASTEXITCODE"
}

Write-Host 'GPTLock 浏览器连接已修复并验证 / browser connection repaired and verified.' -ForegroundColor Green
Write-Host '请完全退出所有 Chrome/Edge 进程后重新打开 / Fully exit and restart every Chrome/Edge process.'
