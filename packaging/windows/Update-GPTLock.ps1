[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [switch]$Silent
)

$ErrorActionPreference = 'Stop'
$repository = 'b8vipvip/GPTLock'
$headers = @{
    Accept = 'application/vnd.github+json'
    'User-Agent' = 'GPTLock-Updater'
}
$temporaryDirectory = Join-Path $env:TEMP ("GPTLock-Update-" + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temporaryDirectory | Out-Null

try {
    Write-Host '正在检查 GPTLock 更新 / Checking for GPTLock updates…'
    $release = Invoke-RestMethod -Uri "https://api.github.com/repos/$repository/releases/latest" -Headers $headers
    $installerAsset = $release.assets | Where-Object { $_.name -eq 'GPTLockSetup-x64.exe' } | Select-Object -First 1
    $checksumAsset = $release.assets | Where-Object { $_.name -eq 'SHA256SUMS.txt' } | Select-Object -First 1
    if ($null -eq $installerAsset -or $null -eq $checksumAsset) {
        throw '最新版本缺少安装器或校验和 / Latest release is missing the installer or checksums.'
    }

    $installerPath = Join-Path $temporaryDirectory $installerAsset.name
    $checksumPath = Join-Path $temporaryDirectory $checksumAsset.name
    Invoke-WebRequest -Uri $installerAsset.browser_download_url -Headers $headers -OutFile $installerPath
    Invoke-WebRequest -Uri $checksumAsset.browser_download_url -Headers $headers -OutFile $checksumPath

    $escapedName = [Regex]::Escape($installerAsset.name)
    $line = Get-Content -LiteralPath $checksumPath | Where-Object { $_ -match "\s\*?$escapedName$" } | Select-Object -First 1
    if ([string]::IsNullOrWhiteSpace($line)) {
        throw '校验和文件中找不到安装器 / Installer is missing from checksum file.'
    }
    $expected = ($line -split '\s+')[0].ToLowerInvariant()
    $actual = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
        throw 'SHA-256 校验失败，已停止更新 / SHA-256 verification failed; update aborted.'
    }

    Write-Host "正在安装 $($release.tag_name) / Installing $($release.tag_name)…"
    $arguments = @('/SUPPRESSMSGBOXES', '/NORESTART')
    if ($Silent) { $arguments += '/VERYSILENT' }
    $process = Start-Process -FilePath $installerPath -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) {
        throw "安装器返回错误 / Installer failed with exit code $($process.ExitCode)."
    }
    Write-Host '更新完成；请完全重启浏览器 / Update complete; fully restart the browser.' -ForegroundColor Green
}
finally {
    if (Test-Path -LiteralPath $temporaryDirectory) {
        Remove-Item -LiteralPath $temporaryDirectory -Recurse -Force
    }
}
