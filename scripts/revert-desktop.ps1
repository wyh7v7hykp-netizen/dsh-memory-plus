#requires -Version 7
<#
.SYNOPSIS
  Remove dsh-memory-plus from a DSH profile and restore its config backups.

.DESCRIPTION
  Closes the loop for scripts/install-desktop.ps1: removes the package rows
  from package.json via pnpm, cuts the mount block out of cordis.patch.yml, and
  restores the newest *.bak-memplus-* copy of package.json.

.PARAMETER Profile
  Target profile name (default: desktop).
#>
param([string]$Profile = 'desktop')

$ErrorActionPreference = 'Stop'
$profDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$pkgJson = Join-Path $profDir 'package.json'
$patch = Join-Path $profDir 'cordis.patch.yml'

if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) {
  throw 'DSH 正在运行。请先完全退出 DeepSeek Harness，再运行本脚本。'
}

dsh plugin --profile $Profile remove dsh-memory-plus dsh-memory-consolidation-plus 2>$null

if (Test-Path $patch) {
  $text = Get-Content $patch -Raw
  $pattern = '(?ms)\r?\n?# dsh-memory-plus mount.*?(?=\r?\n- |\z)'
  $new = [regex]::Replace($text, $pattern, '')
  $new = [regex]::Replace($new, '(?ms)\r?\n- insert:\r?\n    - id: memory-plus\r?\n(?:      .*\r?\n)*?(?=\r?\n- |\z)', '')
  if ($new -ne $text) {
    Set-Content -Path $patch -Value $new.TrimEnd() -NoNewline -Encoding utf8
    Write-Host 'mount rows removed'
  }
}

$backup = Get-ChildItem $profDir -Filter 'package.json.bak-memplus-*' |
  Sort-Object LastWriteTime -Descending | Select-Object -First 1
if ($backup) {
  Copy-Item $backup.FullName $pkgJson -Force
  Write-Host "package.json restored from $($backup.Name)"
}
Write-Host 'Reverted. Start DSH and confirm Settings -> Plugins no longer lists dsh-memory-plus.'
