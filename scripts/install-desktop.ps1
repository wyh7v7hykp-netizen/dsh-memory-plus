#requires -Version 7
<#
.SYNOPSIS
  Install dsh-memory-plus into a DSH profile (default: desktop).

.DESCRIPTION
  DSH refuses to touch a profile that a running app holds, so this script
  fails fast unless the app is closed. It backs up package.json and
  cordis.patch.yml, installs the two local packages as file: links, appends
  the mount rows (idempotent), and verifies the composed config.

.PARAMETER Profile
  Target profile name under $DSH_HOME/profiles (default: desktop).

.PARAMETER Repo
  Path to the dsh-memory-plus checkout (default: this repository).

.EXAMPLE
  pwsh -File scripts/install-desktop.ps1
#>
param(
  [string]$Profile = 'desktop',
  [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
$profDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$pkgJson = Join-Path $profDir 'package.json'
$patch = Join-Path $profDir 'cordis.patch.yml'

if (-not (Test-Path $pkgJson)) { throw "profile not found: $profDir" }
if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) {
  throw 'DSH 正在运行。请先完全退出 DeepSeek Harness（窗口与托盘），再运行本脚本。'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item $pkgJson "$pkgJson.bak-memplus-$stamp" -Force
Copy-Item $patch "$patch.bak-memplus-$stamp" -Force
Write-Host "backups: *.bak-memplus-$stamp"

$mem = Join-Path $Repo 'packages\memory'
$con = Join-Path $Repo 'packages\memory-consolidation'
foreach ($entry in @($mem, $con)) {
  if (-not (Test-Path (Join-Path $entry 'lib\index.js'))) {
    throw "build missing: $entry\lib\index.js — run 'pnpm build' in $Repo first"
  }
}

dsh plugin --profile $Profile add "file:$mem" "file:$con"
if ($LASTEXITCODE -ne 0) { throw "dsh plugin add failed ($LASTEXITCODE)" }

$mount = @'

# dsh-memory-plus mount (added by scripts/install-desktop.ps1)
- insert:
    - id: memory-plus
      name: dsh-memory-plus
    - id: memory-consolidation-plus
      name: dsh-memory-consolidation-plus
      config:
        extractMinIntervalMinutes: 5
        extractMinSurfaceEvents: 8
        extractMaxPerHour: 8
'@
$patchText = Get-Content $patch -Raw
if ($patchText -notmatch 'id: memory-plus') {
  Add-Content -Path $patch -Value $mount -Encoding utf8
  Write-Host 'mount rows appended'
} else {
  Write-Host 'mount rows already present'
}

$dump = dsh --profile $Profile --dump-config 2>&1 | Out-String
if ($dump -notmatch 'memory-plus' -or $dump -notmatch 'memory-consolidation-plus') {
  throw "composed config verification failed. Restore from *.bak-memplus-$stamp and inspect."
}
Write-Host 'verified: composed config contains memory-plus and memory-consolidation-plus'
Write-Host ''
Write-Host "下一步：启动 DeepSeek Harness，新开会话；首轮应出现 memory 段，模型可调用 memory_search / memory_read。" -ForegroundColor Green
