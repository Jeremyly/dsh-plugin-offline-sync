#Requires -Version 5.1
<#
.SYNOPSIS
    联网电脑使用：拉取指定版本的 billion-context，产出可直接打包的 payload 目录。
.DESCRIPTION
    dsh-plugin-offline-sync 的 bili 打包侧脚本。不打包 tar.gz，只准备 payload 目录交给插件打包器。
    流程：检查 node>=20/npm -> npm view 解析版本 -> npm install -g --prefix <stage> -> 验证 --version -> 读取 commit -> 输出 stage 路径。
.PARAMETER Version
    要拉取的版本（默认 latest）。
.PARAMETER StageDir
    输出目录。默认 <scriptRoot>\_stage\bili-<version>-<stamp>。
.PARAMETER StageOnly
    仅准备 stage 并输出路径。
#>
[CmdletBinding()]
param(
    [string]$Version = 'latest',
    [string]$StageDir = '',
    [switch]$StageOnly
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch { }

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path

function Die([string]$m) { Write-Error $m; exit 1 }

# 检查 node / npm
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
if (-not $nodeCmd) { Die '找不到 node，请先安装 Node.js >= 20。' }
$nodeVer = (& $nodeCmd.Source --version).Trim()
$nv = ($nodeVer.TrimStart('v') -split '\.')[0]
if ([int]$nv -lt 20) { Die ('需要 Node >= 20，当前是 ' + $nodeVer) }

$npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
if (-not $npmCmd) { $npmCmd = Get-Command npm -ErrorAction SilentlyContinue }
if (-not $npmCmd) { Die '找不到 npm。' }

# 可写的 npm 缓存目录。
$npmCache = Join-Path $env:TEMP ('bili-npm-cache-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $npmCache | Out-Null

# 解析版本：用 cmd /c 包裹，让 npm 的 stderr 在 cmd 层合并，PS 只看到干净 stdout。
Write-Host ('[*] 解析 billion-context@' + $Version + ' ...')
$viewCmd = '"' + $npmCmd.Source + '" view "billion-context@' + $Version + '" version --cache "' + $npmCache + '" 2>&1'
$viewOut = (& cmd /c $viewCmd | Out-String)
$resolved = ''
$noticeRe = [regex]'^npm '
foreach ($line in ($viewOut -split '\r?\n')) {
    $t = $line.Trim()
    if ($t -and -not $noticeRe.IsMatch($t)) { $resolved = $t }
}
if ([string]::IsNullOrWhiteSpace($resolved)) { Die ('无法解析版本 ' + $Version) }
Write-Host ('[+] 版本: ' + $resolved)

# stage 目录
if ([string]::IsNullOrWhiteSpace($StageDir)) {
    $stamp = Get-Date -Format 'yyyyMMddHHmmss'
    $StageDir = Join-Path $scriptRoot ('_stage\bili-' + $resolved + '-' + $stamp)
}
$StageDir = [System.IO.Path]::GetFullPath($StageDir)
if (Test-Path -LiteralPath $StageDir) { Remove-Item -LiteralPath $StageDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $StageDir | Out-Null

# npm install -g --prefix
Write-Host ('[*] npm install -g billion-context@' + $resolved + ' --prefix ' + $StageDir + ' ...')
$installCmd = '"' + $npmCmd.Source + '" install -g "billion-context@' + $resolved + '" --prefix "' + $StageDir + '" --no-audit --no-fund --cache "' + $npmCache + '" 2>&1'
$installOut = (& cmd /c $installCmd | Out-String)
if ($LASTEXITCODE -ne 0) { Die ('npm install 失败: ' + $installOut) }

$pkg = Join-Path $StageDir 'node_modules\billion-context'
$idx = Join-Path $pkg 'dist\index.js'
if (-not (Test-Path -LiteralPath $idx)) { Die ('安装结果缺少 ' + $idx) }

# 验证：优先读 package.json（受限环境下 node 启动可能因 spawn 受限而失败）。
$pkgVer = ''
$pkgPj = Join-Path $pkg 'package.json'
if (Test-Path -LiteralPath $pkgPj) {
    try {
        $pj = [System.IO.File]::ReadAllText($pkgPj)
        $vm = [regex]::Match($pj, '"version"\s*:\s*"([^"]*)"')
        if ($vm.Success) { $pkgVer = $vm.Groups[1].Value }
    } catch { }
}
if ($pkgVer -ne $resolved) {
    Die ('版本验证失败：package.json 为 ' + $pkgVer + '，期望 ' + $resolved)
}
# 额外尝试 --version（某些沙箱里 spawn 会被拦截，失败不致命）。
try {
    $eap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    $v = ((& $nodeCmd.Source $idx --version) 2>&1 | Out-String).Trim()
    $ErrorActionPreference = $eap
    if ($v -and $v -notmatch [regex]::Escape($resolved)) {
        Write-Host ('[!] 警告: --version 输出为 "' + $v + '"，与期望 ' + $resolved + ' 不符，但 package.json 已匹配。')
    }
} catch { }
Write-Host ('[+] 版本验证通过: ' + $pkgVer)

# 读取 commit
$commit = ''
$bi = Join-Path $pkg 'dist\build-info.json'
if (Test-Path -LiteralPath $bi) {
    try {
        $t = [System.IO.File]::ReadAllText($bi)
        $m = [regex]::Match($t, '"commit"\s*:\s*"([^"]*)"')
        if ($m.Success) { $commit = $m.Groups[1].Value }
    } catch { }
}

Write-Host ('[+] 已准备 payload: ' + $StageDir)
Write-Host ('    version: ' + $resolved)
Write-Host ('    commit:  ' + $commit)

# StageOnly：输出 JSON 供 Node 端解析
$out = [ordered]@{
    stageDir = $StageDir
    package  = 'billion-context'
    version  = $resolved
    commit   = $commit
}
Write-Host ('STAGE_JSON=' + ($out | ConvertTo-Json -Compress))
exit 0