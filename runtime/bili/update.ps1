#Requires -Version 5.1
<#
.SYNOPSIS
    局域网(离线)电脑使用：一键把 bili (billion-context) 更新到离线包携带的版本。
.DESCRIPTION
    这是 dsh-plugin-offline-sync 针对 billion-context 优化的本地可运行程序更新器。
    两种调用方式：
      1) 独立离线包：.\update.ps1 -Bundle bili-offline-<ver>.tar.gz
         —— 校验 SHA256 → 解包 → 备份替换 → 重写垫片 → 验证 → 健康检查 → 同步 dsh 副本
      2) 快速通道（由 install.cjs 调用）：.\update.ps1 -PayloadDir <解包后的 payload 目录>
         —— 跳过解包/SHA，直接用已就绪的 payload，其余流程相同。
    任何一步失败自动回滚到原版本。
.PARAMETER Bundle
    离线包路径 (.tar.gz 或 .zip)。与 -PayloadDir 二选一。
.PARAMETER PayloadDir
    已解包的 payload 目录（含 node_modules\billion-context 和 bili/bili-proxy 启动垫片）。
    由 install.cjs 解压 ZIP 后直接传入，跳过解包和 SHA 校验。
.PARAMETER Target
    npm 全局目录（bili/bili-proxy 垫片所在目录）。默认自动探测。
.PARAMETER StopRunning
    直接结束正在运行的 bili 进程。不指定且检测到进程时会提示。
.PARAMETER Force
    同版本强制重装 / 允许降级。
.PARAMETER SkipVerify
    跳过 SHA256 校验（仅 -Bundle 模式有效）。
.PARAMETER NoSmokeTest
    跳过 /__bili/health 健康检查。
.PARAMETER NoPrune
    不清理旧备份。
.PARAMETER SkipDshProfiles
    不同步 ~/.dsh/profiles/*/node_modules/billion-context 副本。
.PARAMETER SkipShims
    不重写 bili / bili-proxy 启动垫片（用户自行管理时用）。
.PARAMETER SkipPrompt
    完全非交互：不提示、不 pause。stdin 被重定向时自动启用。
.PARAMETER DryRun
    只显示会做什么，不动真格。
.EXAMPLE
    .\update.ps1
    .\update.ps1 -Bundle D:\in\bili-offline-0.1.215.tar.gz
    .\update.ps1 -PayloadDir .\runtime\billion-context\payload -SkipPrompt
    .\update.ps1 -DryRun
#>
[CmdletBinding()]
param(
    [string]$Bundle = '',
    [string]$PayloadDir = '',
    [string]$Target = '',
    [switch]$StopRunning,
    [switch]$Force,
    [switch]$SkipVerify,
    [switch]$NoSmokeTest,
    [switch]$NoPrune,
    [switch]$SkipDshProfiles,
    [switch]$SkipShims,
    [switch]$SkipPrompt,
    [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    [Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
    $OutputEncoding = New-Object System.Text.UTF8Encoding($false)
} catch { }

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$BakPrefix = '.billion-context.bak-'

# 非交互自动检测：stdin 被重定向（管道/子进程调用）时不提示、不 pause。
$NonInteractive = [bool]$SkipPrompt
if (-not $NonInteractive) {
    try { $NonInteractive = [Console]::IsInputRedirected } catch { $NonInteractive = $false }
}

function Log([string]$m) { if (-not $NonInteractive) { Write-Host ("[*] " + $m) -ForegroundColor Cyan } }
function Ok([string]$m) { if (-not $NonInteractive) { Write-Host ("[+] " + $m) -ForegroundColor Green } }
function Warn([string]$m) { if (-not $NonInteractive) { Write-Host ("[!] " + $m) -ForegroundColor Yellow } }
function Die([string]$m) {
    if ($NonInteractive) { Write-Error $m } else { Write-Host ("[x] " + $m) -ForegroundColor Red }
    exit 1
}

# ---------------- 不依赖 PS 模块的基础函数 ----------------

function Get-Sha256Hex([string]$path) {
    $sha = [System.Security.Cryptography.SHA256]::Create()
    $fs = [System.IO.File]::OpenRead($path)
    try { return (([System.BitConverter]::ToString($sha.ComputeHash($fs))) -replace '-', '').ToLower() }
    finally { $fs.Dispose(); $sha.Dispose() }
}

function Get-JsonStringField([string]$path, [string]$field) {
    if (-not (Test-Path -LiteralPath $path)) { return '' }
    try {
        $t = [System.IO.File]::ReadAllText($path)
        $pat = '"' + [regex]::Escape($field) + '"\s*:\s*"([^"]*)"'
        $m = [regex]::Match($t, $pat)
        if ($m.Success) { return $m.Groups[1].Value }
    } catch { }
    return ''
}

function Expand-ZipArchive([string]$zip, [string]$dest) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem -ErrorAction SilentlyContinue
    [System.IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest)
}

function Get-BiliPids() {
    $ids = New-Object System.Collections.ArrayList
    try {
        Add-Type -AssemblyName System.Management -ErrorAction SilentlyContinue
        $q = New-Object System.Management.ManagementObjectSearcher("SELECT ProcessId, CommandLine FROM Win32_Process WHERE Name='node.exe'")
        foreach ($o in $q.Get()) {
            $cl = [string]$o['CommandLine']
            if ($cl -match 'billion-context[\\/]+dist[\\/]+index\.js') { [void]$ids.Add([int]$o['ProcessId']) }
        }
        return $ids
    } catch {
        try {
            foreach ($p in (Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop)) {
                if ($p.CommandLine -and $p.CommandLine -match 'billion-context[\\/]+dist[\\/]+index\.js') { [void]$ids.Add([int]$p.ProcessId) }
            }
        } catch { }
        return $ids
    }
}

function Get-WinTar() {
    $sys = Join-Path $env:SystemRoot 'System32\tar.exe'
    if (Test-Path -LiteralPath $sys) { return $sys }
    $c = Get-Command tar.exe -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    return ''
}

function Test-HttpOk([string]$url, [int]$timeoutMs) {
    try {
        $req = [System.Net.WebRequest]::Create($url)
        $req.Timeout = $timeoutMs
        $req.Method = 'GET'
        $resp = $req.GetResponse()
        try { return ([int]$resp.StatusCode -eq 200) } finally { $resp.Close() }
    } catch { return $false }
}

# ---------------- dsh / DeepSeek Harness 副本 ----------------

function Set-ManifestDepSpec([string]$manifestPath, [string]$targetVer) {
    if (-not (Test-Path -LiteralPath $manifestPath)) { return $false }
    $raw = [System.IO.File]::ReadAllText($manifestPath)
    $m = [regex]::Match($raw, '\"billion-context\"\\s*:\\s*\"([^\"]*)\"')
    if (-not $m.Success) { return $false }
    $spec = $m.Groups[1].Value
    if ($spec -notmatch '^\^?\d+\.\d+\.\d+') { return $false }
    $next = $targetVer
    if ($spec.StartsWith('^')) { $next = '^' + $targetVer }
    if ($next -eq $spec) { return $false }
    $out = $raw.Substring(0, $m.Groups[1].Index) + $next + $raw.Substring($m.Groups[1].Index + $spec.Length)
    [System.IO.File]::WriteAllText($manifestPath, $out, (New-Object System.Text.UTF8Encoding($false)))
    return $true
}

function Set-PnpmLockVersion([string]$lockPath, [string]$targetVer) {
    if (-not (Test-Path -LiteralPath $lockPath)) { return $false }
    $raw = [System.IO.File]::ReadAllText($lockPath)
    $m = [regex]::Match($raw, '(?m)^([ \t]+)billion-context:[ \t]*\r?\n\1[ \t]+specifier:[ \t]*([^\r\n]*)\r?\n(\1[ \t]+version:[ \t]*)([^\r\n]*)')
    if (-not $m.Success) { return $false }
    $spec = $m.Groups[2].Value.Trim()
    $verRaw = $m.Groups[4].Value.Trim()
    $newSpec = $targetVer
    if ($spec.StartsWith('^')) { $newSpec = '^' + $targetVer }
    $suffix = ''
    $p = $verRaw.IndexOf('(')
    if ($p -ge 0) { $suffix = $verRaw.Substring($p) }
    $newVer = $targetVer + $suffix
    $head = $raw.Substring(0, $m.Groups[2].Index)
    $mid = $raw.Substring($m.Groups[2].Index + $m.Groups[2].Length, $m.Groups[4].Index - ($m.Groups[2].Index + $m.Groups[2].Length))
    $tail = $raw.Substring($m.Groups[4].Index + $m.Groups[4].Length)
    [System.IO.File]::WriteAllText($lockPath, ($head + $newSpec + $mid + $newVer + $tail), (New-Object System.Text.UTF8Encoding($false)))
    return $true
}

function Sync-DshProfiles([string]$payloadPkg, [string]$targetVer) {
    $dshHome = $env:DSH_HOME
    if ([string]::IsNullOrWhiteSpace($dshHome)) { $dshHome = Join-Path $env:USERPROFILE '.dsh' }
    $profilesDir = Join-Path $dshHome 'profiles'
    if (-not (Test-Path -LiteralPath $profilesDir)) { return }
    $found = $false
    foreach ($prof in [System.IO.Directory]::GetDirectories($profilesDir)) {
        $name = [System.IO.Path]::GetFileName($prof)
        $copy = Join-Path $prof 'node_modules\billion-context'
        if (-not (Test-Path -LiteralPath (Join-Path $copy 'package.json'))) { continue }
        $found = $true
        $cur = Get-JsonStringField (Join-Path $copy 'package.json') 'version'
        Log ('dsh 副本 [' + $name + ']: ' + $cur + ' -> ' + $targetVer)
        if ($cur -eq $targetVer -and -not $Force) {
            Ok ('    [' + $name + '] 已是 ' + $cur + '，跳过')
            continue
        }
        $bak = Join-Path $prof ('node_modules\' + $BakPrefix + $cur + '-' + (Get-Date -Format 'yyyyMMddHHmmss'))
        $ledgerBak = Join-Path $bak '_ledger'
        try {
            if ($DryRun) {
                Write-Host ('    [DryRun] 备份 ' + $copy + ' -> ' + $bak)
                continue
            }
            Move-Item -LiteralPath $copy -Destination $bak -Force
            New-Item -ItemType Directory -Force -Path $copy | Out-Null
            $robo2 = Get-Command robocopy.exe -ErrorAction SilentlyContinue
            if ($robo2) {
                & $robo2.Source $payloadPkg $copy /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
                if ($LASTEXITCODE -ge 8) { throw ('robocopy 失败，exit ' + $LASTEXITCODE) }
            } else {
                Copy-Item -Path (Join-Path $payloadPkg '*') -Destination $copy -Recurse -Force
            }

            $nodeExe2 = Get-Command node.exe -ErrorAction SilentlyContinue
            if (-not $nodeExe2) { $nodeExe2 = Get-Command node -ErrorAction SilentlyContinue }
            $v2 = ((& $nodeExe2.Source (Join-Path $copy 'dist\index.js') --version) 2>&1 | Out-String).Trim()
            if ($v2 -notmatch [regex]::Escape($targetVer)) { throw ('副本无法启动: ' + $v2) }

            New-Item -ItemType Directory -Force -Path $ledgerBak | Out-Null
            foreach ($lf in @('package.json', 'pnpm-lock.yaml', 'package-lock.json')) {
                $lp = Join-Path $prof $lf
                if (Test-Path -LiteralPath $lp) { Copy-Item -LiteralPath $lp -Destination $ledgerBak -Force }
            }
            $specChanged = Set-ManifestDepSpec (Join-Path $prof 'package.json') $targetVer
            $lockChanged = Set-PnpmLockVersion (Join-Path $prof 'pnpm-lock.yaml') $targetVer
            Ok ('    [' + $name + '] 副本已更新 ' + $cur + ' -> ' + $targetVer +
                '（清单' + $(if ($specChanged) { '已改' } else { '未变' }) +
                '，lock ' + $(if ($lockChanged) { '已改' } else { '未变' }) + '）')
        } catch {
            Warn ('    [' + $name + '] 同步失败: ' + $_.Exception.Message + '，正在回滚该副本')
            if (Test-Path -LiteralPath $copy) { Remove-Item -LiteralPath $copy -Recurse -Force -ErrorAction SilentlyContinue }
            if (Test-Path -LiteralPath $bak) { Move-Item -LiteralPath $bak -Destination $copy -Force }
            if (Test-Path -LiteralPath $ledgerBak) {
                foreach ($lf in @('package.json', 'pnpm-lock.yaml', 'package-lock.json')) {
                    $lp = Join-Path $ledgerBak $lf
                    if (Test-Path -LiteralPath $lp) { Copy-Item -LiteralPath $lp -Destination (Join-Path $prof $lf) -Force }
                }
            }
        }
    }
    if (-not $found) { Log '本机没有 dsh 副本需要同步。' }
}


# ---------------- 1. 定位离线包 / payload ----------------

function Find-Bundle([string]$dir) {
    if (-not (Test-Path -LiteralPath $dir)) { return '' }
    $best = ''
    foreach ($f in [System.IO.Directory]::GetFiles($dir)) {
        $n = [System.IO.Path]::GetFileName($f)
        if ($n -like 'bili-offline-*' -and ($n -like '*.tar.gz' -or $n -like '*.zip')) {
            if (-not $best -or [System.IO.File]::GetLastWriteTimeUtc($f) -gt [System.IO.File]::GetLastWriteTimeUtc($best)) { $best = $f }
        }
    }
    return $best
}

$work = ''
$pkgRoot = ''

if (-not [string]::IsNullOrWhiteSpace($PayloadDir)) {
    # 快速通道：payload 已就绪
    $pkgRoot = [System.IO.Path]::GetFullPath($PayloadDir)
    if (-not (Test-Path -LiteralPath $pkgRoot)) { Die ('PayloadDir 不存在: ' + $pkgRoot) }
    if (-not (Test-Path -LiteralPath (Join-Path $pkgRoot 'payload'))) {
        # 允许直接传 payload 目录本身
        if (Test-Path -LiteralPath (Join-Path $pkgRoot 'node_modules\billion-context\dist\index.js')) {
            $payload = $pkgRoot
        } else {
            Die ('PayloadDir 结构不正确：缺少 payload\ 或 node_modules\billion-context\dist\index.js')
        }
    } else {
        $payload = Join-Path $pkgRoot 'payload'
    }
    Log ('使用 payload 目录: ' + $payload)
} else {
    # 独立离线包模式
    if ([string]::IsNullOrWhiteSpace($Bundle)) {
        foreach ($d in @($scriptRoot, (Join-Path $scriptRoot 'out'), (Join-Path (Split-Path -Parent $scriptRoot) 'out'))) {
            $Bundle = Find-Bundle $d
            if (-not [string]::IsNullOrWhiteSpace($Bundle)) { break }
        }
        if ([string]::IsNullOrWhiteSpace($Bundle)) {
            Die '没找到离线包。请把 bili-offline-*.tar.gz 放到本脚本同目录，或用 -Bundle 指定路径，或用 -PayloadDir 指定已解包目录。'
        }
    }
    $Bundle = [System.IO.Path]::GetFullPath($Bundle)
    if (-not (Test-Path -LiteralPath $Bundle)) { Die ('离线包不存在: ' + $Bundle) }
    $bundleMb = [math]::Round((([System.IO.FileInfo]$Bundle).Length / 1MB), 1)
    Log ('离线包: ' + $Bundle + '  (' + $bundleMb + ' MB)')

    # ---------------- 2. 校验 ----------------
    $sidecar = $Bundle + '.sha256'
    if (-not $SkipVerify -and (Test-Path -LiteralPath $sidecar)) {
        Log '校验 SHA256 ...'
        $parts = ([System.IO.File]::ReadAllText($sidecar)).Trim() -split '\s+'
        if (-not $parts -or [string]::IsNullOrWhiteSpace($parts[0])) { Die '校验文件内容为空' }
        $actual = Get-Sha256Hex $Bundle
        if ($parts[0].ToLower() -ne $actual) {
            Die 'SHA256 校验失败：文件不完整（拷贝中断？）。请重新拷贝，或加 -SkipVerify 跳过校验。'
        }
        Ok 'SHA256 校验通过'
    }

    # ---------------- 3. 解包 ----------------
    $work = Join-Path $env:TEMP ('bili-offline-' + [guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Force -Path $work | Out-Null
    if ($Bundle.ToLower().EndsWith('.zip')) {
        Log '解压 zip ...'
        Expand-ZipArchive $Bundle $work
    } else {
        $tarExe = Get-WinTar
        if ([string]::IsNullOrWhiteSpace($tarExe)) { Die '系统缺少 tar.exe（Win10 1803+ 自带）。请改用 .zip 离线包。' }
        Log '解压 tar.gz ...'
        Push-Location $work
        try { & $tarExe -xzf $Bundle } finally { Pop-Location }
        if ($LASTEXITCODE -ne 0) { Die '解包失败' }
    }

    $pkgRoot = $work
    if (-not (Test-Path -LiteralPath (Join-Path $pkgRoot 'payload'))) {
        $cand = ''
        foreach ($d in [System.IO.Directory]::GetDirectories($work)) {
            if (Test-Path -LiteralPath (Join-Path $d 'payload')) { $cand = $d; break }
        }
        if (-not [string]::IsNullOrWhiteSpace($cand)) { $pkgRoot = $cand }
    }
    $payload = Join-Path $pkgRoot 'payload'
}

try {
    $newPkg = Join-Path $payload 'node_modules\billion-context'
    if (-not (Test-Path -LiteralPath (Join-Path $newPkg 'dist\index.js'))) {
        Die '离线包结构不正确：缺少 payload\node_modules\billion-context\dist\index.js'
    }

    $newVer = Get-JsonStringField (Join-Path $newPkg 'package.json') 'version'
    $commit = Get-JsonStringField (Join-Path $newPkg 'dist\build-info.json') 'commit'
    if ([string]::IsNullOrWhiteSpace($newVer)) { Die '无法读取离线包版本号' }
    Log ('离线包版本: ' + $newVer + ' ' + $commit)

    # ---------------- 4. 安装目标 ----------------

    if ([string]::IsNullOrWhiteSpace($Target)) {
        $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
        if (-not $npmCmd) { $npmCmd = Get-Command npm -ErrorAction SilentlyContinue }
        if ($npmCmd) {
            try {
                $p = ((& $npmCmd.Source prefix -g) 2>$null | Out-String).Trim()
                foreach ($line in @($p -split "\r?\n")) {
                    if (-not [string]::IsNullOrWhiteSpace($line)) { $Target = $line.Trim() }
                }
            } catch { }
        }
        if ([string]::IsNullOrWhiteSpace($Target)) {
            $biliCmd = Get-Command bili.cmd -ErrorAction SilentlyContinue
            if ($biliCmd) { $Target = Split-Path -Parent $biliCmd.Source }
        }
        if ([string]::IsNullOrWhiteSpace($Target)) { $Target = Join-Path $env:APPDATA 'npm' }
    }
    $Target = [System.IO.Path]::GetFullPath($Target)
    if (-not (Test-Path -LiteralPath $Target)) { New-Item -ItemType Directory -Force -Path $Target | Out-Null }
    Log ('安装目录: ' + $Target)

    try {
        $probe = Join-Path $Target ('.bili-writetest-' + [guid]::NewGuid().ToString('N'))
        [System.IO.File]::WriteAllText($probe, 'x')
        [System.IO.File]::Delete($probe)
    } catch {
        Die ('目录不可写: ' + $Target + '。请以管理员身份运行，或用 -Target 指定其他 npm 全局目录。')
    }

    $nmDir = Join-Path $Target 'node_modules'
    $livePkg = Join-Path $nmDir 'billion-context'

    $oldVer = Get-JsonStringField (Join-Path $livePkg 'package.json') 'version'
    $oldText = '(未安装)'
    if (-not [string]::IsNullOrWhiteSpace($oldVer)) { $oldText = $oldVer }
    Log ('当前版本: ' + $oldText + '   目标版本: ' + $newVer)

    $same = ($oldVer -eq $newVer)
    $downgrade = $false
    if (-not [string]::IsNullOrWhiteSpace($oldVer) -and -not $same) {
        try { if ([version]$newVer -lt [version]$oldVer) { $downgrade = $true } } catch { $downgrade = $false }
    }
    if ($same -and -not $Force) {
        Ok ('本机已经是 ' + $newVer + '，主安装无需更新。（强制重装请加 -Force）')
        if (-not $SkipDshProfiles) {
            Log '检查 DeepSeek Harness (dsh) 副本 ...'
            Sync-DshProfiles $newPkg $newVer
        }
        exit 0
    }
    if ($downgrade -and -not $Force) {
        Die ('离线包版本 ' + $newVer + ' 低于本机 ' + $oldVer + '，已阻止降级；确认要降级请加 -Force。')
    }

    # ---------------- 5. 运行中的 bili ----------------

    $pids = @(Get-BiliPids)
    $doStop = [bool]$StopRunning
    if ($pids.Count -gt 0) {
        Warn ('检测到 ' + $pids.Count + ' 个 bili 进程正在运行 (PID: ' + ($pids -join ', ') + ')')
        if (-not $doStop -and -not $DryRun -and -not $NonInteractive) {
            $canPrompt = $true
            try { $canPrompt = -not [Console]::IsInputRedirected } catch { }
            if ($canPrompt) {
                try {
                    $ans = Read-Host '现在结束这些进程，让新版本立即生效？(y/N)'
                    if ($ans -match '^(y|Y|yes|是)') { $doStop = $true }
                } catch { }
            } else {
                Warn '未结束进程，继续替换文件（客户端下次启动时生效）。'
            }
        } elseif (-not $doStop -and $NonInteractive) {
            Warn '非交互模式：未结束进程，继续替换文件（客户端下次启动时生效）。'
        }
    }

    if ($DryRun) {
        Write-Host ''
        Log 'DryRun：以下操作不会真正执行。'
        Write-Host ('    备份 ' + $livePkg + '  ->  ' + $nmDir + '\' + $BakPrefix + '*')
        Write-Host ('    写入 ' + $livePkg)
        if (-not $SkipShims) { Write-Host ('    写入垫片 ' + $Target + '\bili*') }
        exit 0
    }

    if ($doStop -and $pids.Count -gt 0) {
        Log '结束正在运行的 bili 进程 ...'
        foreach ($procId in $pids) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }
        Start-Sleep -Milliseconds 1200
        Ok '已结束'
    }

    # ---------------- 6. 备份 + 替换 ----------------

    $stamp = Get-Date -Format 'yyyyMMddHHmmss'
    $backupPath = ''
    if (Test-Path -LiteralPath $livePkg) {
        $tag = ($oldVer -replace '[^0-9A-Za-z._-]', '_')
        if ([string]::IsNullOrWhiteSpace($tag)) { $tag = 'unknown' }
        $backupPath = Join-Path $nmDir ($BakPrefix + $tag + '-' + $stamp)
        Log ('备份旧版本 -> ' + $backupPath)
        Move-Item -LiteralPath $livePkg -Destination $backupPath -Force
    } else {
        New-Item -ItemType Directory -Force -Path $nmDir | Out-Null
    }

    try {
        Log '写入新版本文件 ...'
        $robo = Get-Command robocopy.exe -ErrorAction SilentlyContinue
        if ($robo) {
            & $robo.Source $newPkg $livePkg /E /NFL /NDL /NJH /NJS /NP /R:1 /W:1 | Out-Null
            if ($LASTEXITCODE -ge 8) { throw ('robocopy 失败，exit ' + $LASTEXITCODE) }
        } else {
            New-Item -ItemType Directory -Force -Path $livePkg | Out-Null
            Copy-Item -Path (Join-Path $newPkg '*') -Destination $livePkg -Recurse -Force
        }

        if (-not $SkipShims) {
            Log '写入 bili / bili-proxy 启动垫片 ...'
            foreach ($f in [System.IO.Directory]::GetFiles($payload)) {
                Copy-Item -LiteralPath $f -Destination (Join-Path $Target ([System.IO.Path]::GetFileName($f))) -Force
            }
        }

        # ---------------- 7. 验证 ----------------
        # 优先读 package.json；--version 在某些沙箱里因 spawn 受限会失败，不致命。
        $instVer = Get-JsonStringField (Join-Path $livePkg 'package.json') 'version'
        if ($instVer -ne $newVer) { throw ('版本验证失败：已安装 package.json 为 ' + $instVer + '，期望 ' + $newVer) }
        $nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $nodeCmd) { $nodeCmd = Get-Command node -ErrorAction SilentlyContinue }
        if ($nodeCmd) {
            try {
                $eap = $ErrorActionPreference
                $ErrorActionPreference = 'Continue'
                $verOut = ((& $nodeCmd.Source (Join-Path $livePkg 'dist\index.js') --version) 2>&1 | Out-String).Trim()
                $ErrorActionPreference = $eap
                if ($verOut -and $verOut -notmatch [regex]::Escape($newVer)) {
                    Warn ('--version 输出 "' + $verOut + '" 与期望 ' + $newVer + ' 不符，但 package.json 已匹配。')
                } else {
                    $dispVer = if ($verOut) { $verOut } else { $instVer }
                    Ok ('bili --version -> ' + $dispVer)
                }
            } catch { }
        }
    } catch {
        $err = $_.Exception.Message
        Warn ('更新失败: ' + $err)
        Log '回滚 ...'
        if (Test-Path -LiteralPath $livePkg) { Remove-Item -LiteralPath $livePkg -Recurse -Force -ErrorAction SilentlyContinue }
        if (-not [string]::IsNullOrWhiteSpace($backupPath) -and (Test-Path -LiteralPath $backupPath)) {
            Move-Item -LiteralPath $backupPath -Destination $livePkg -Force
            Ok ('已回滚到 ' + $oldText)
        }
        Die '更新未完成，本机保持原版本。'
    }

    # ---------------- 8. 健康检查 ----------------

    if (-not $NoSmokeTest) {
        $port = 0
        for ($i = 0; $i -lt 10; $i++) {
            $tryPort = Get-Random -Minimum 19200 -Maximum 19799
            try {
                $l = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $tryPort)
                $l.Start(); $l.Stop(); $port = $tryPort; break
            } catch { }
        }
        if ($port -gt 0) {
            Log ('健康检查：临时启动代理于端口 ' + $port + ' ...')
            $argStr = '\"' + (Join-Path $livePkg 'dist\index.js') + '\" --passthrough --no-auto-update --port ' + $port
            $proc = $null
            try {
                $proc = Start-Process -FilePath $nodeCmd.Source -ArgumentList $argStr -PassThru -WindowStyle Hidden
                $healthy = $false
                for ($i = 0; $i -lt 25; $i++) {
                    Start-Sleep -Milliseconds 800
                    if ($proc.HasExited) { break }
                    if (Test-HttpOk ('http://127.0.0.1:' + $port + '/__bili/health') 2500) { $healthy = $true; break }
                }
                if ($healthy) { Ok '健康检查通过（/__bili/health 返回 200）' }
                else { Warn '健康检查未通过，但版本已正确写入。请手动运行 bili --debug 观察；需要时可从备份目录回滚。' }
            } catch {
                Warn ('健康检查异常: ' + $_.Exception.Message)
            } finally {
                if ($proc -and -not $proc.HasExited) {
                    try { Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue } catch { }
                }
            }
        }
    }

    # ---------------- 9. 清理旧备份 ----------------

    if (-not $NoPrune) {
        $baks = New-Object System.Collections.ArrayList
        foreach ($d in [System.IO.Directory]::GetDirectories($nmDir)) {
            if ([System.IO.Path]::GetFileName($d).StartsWith($BakPrefix)) { [void]$baks.Add($d) }
        }
        if ($baks.Count -gt 2) {
            $sorted = $baks | Sort-Object { [System.IO.Directory]::GetLastWriteTimeUtc($_) } -Descending
            foreach ($b in ($sorted | Select-Object -Skip 2)) {
                try { Remove-Item -LiteralPath $b -Recurse -Force; Log ('清理旧备份 ' + [System.IO.Path]::GetFileName($b)) } catch { }
            }
        }
    }

    Write-Host ''
    Ok ('更新完成: ' + $oldText + ' -> ' + $newVer + ' ' + $commit)
    Write-Host ('    安装目录: ' + $livePkg)
    if (-not [string]::IsNullOrWhiteSpace($backupPath) -and (Test-Path -LiteralPath $backupPath)) {
        Write-Host ('    旧版备份: ' + $backupPath)
    }
    # ---------------- 10. dsh 副本 ----------------

    if (-not $SkipDshProfiles) {
        Write-Host ''
        Log '同步 DeepSeek Harness (dsh) 副本 ...'
        Sync-DshProfiles $newPkg $newVer
    }

    Write-Host ''
    if (-not $NonInteractive) {
        Write-Host '还需要做的事：'
        Write-Host '  1) 重启客户端让新版本接管，例如  bili dsh  /  bili claude  /  bili codebuddy'
        if ($SkipDshProfiles) {
            Write-Host '  2) 你用了 -SkipDshProfiles，dsh 副本未动；需要时再跑：'
            Write-Host '         .\update.ps1 -SkipDshProfiles:$false   或   bili doctor --fix'
        }
        Write-Host ''
        Write-Host '提示：设置环境变量 ACP_AUTO_UPDATE=0，可避免内网机器反复尝试联网自更新。'
    }
}
finally {
    if (-not [string]::IsNullOrWhiteSpace($work)) {
        Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
    }
}
