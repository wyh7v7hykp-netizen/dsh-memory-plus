#requires -Version 5.1
<#
.SYNOPSIS
  Install dsh-memory-plus into a DSH profile (default: desktop).

.DESCRIPTION
  DSH refuses to touch a profile that a running app holds, so this script
  fails fast unless the app is closed. It backs up package.json and
  cordis.patch.yml, installs the two local packages as file: links, appends
  the mount rows (idempotent), and verifies the composed config.

  ASCII-only on purpose: Windows PowerShell 5.1 reads BOM-less scripts with
  the ANSI code page, so non-ASCII text here would corrupt string literals.

.PARAMETER Profile
  Target profile name under $DSH_HOME/profiles (default: desktop).

.PARAMETER Repo
  Path to the dsh-memory-plus checkout (default: this repository).

.EXAMPLE
  powershell -File scripts/install-desktop.ps1
#>
param(
  [string]$Profile = 'desktop',
  [string]$Repo = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
)

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$profDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$pkgJson = Join-Path $profDir 'package.json'
$patch = Join-Path $profDir 'cordis.patch.yml'

if (-not (Test-Path $pkgJson)) { throw "profile not found: $profDir" }
if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) {
  throw 'DSH is running. Quit DeepSeek Harness completely (window and tray), then rerun this script.'
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
Copy-Item $pkgJson "$pkgJson.bak-memplus-$stamp" -Force
Copy-Item $patch "$patch.bak-memplus-$stamp" -Force
Write-Host "backups: *.bak-memplus-$stamp"

$mem = Join-Path $Repo 'packages\memory'
$con = Join-Path $Repo 'packages\memory-consolidation'
foreach ($entry in @($mem, $con)) {
  if (-not (Test-Path (Join-Path $entry 'lib\index.js'))) {
    throw "build missing: $entry\lib\index.js - run 'pnpm build' in $Repo first"
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
$patchText = [System.IO.File]::ReadAllText($patch)
if ($patchText -notmatch 'id: memory-plus') {
  [System.IO.File]::AppendAllText($patch, $mount, $utf8NoBom)
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
Write-Host 'Next: start DeepSeek Harness and open a new session. The first turn should show a memory section; the model can call memory_search / memory_read.'
