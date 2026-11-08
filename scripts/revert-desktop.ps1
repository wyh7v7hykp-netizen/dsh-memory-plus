#requires -Version 5.1
<#
.SYNOPSIS
  Remove dsh-memory-plus from a DSH profile and restore its config backups.

.DESCRIPTION
  Closes the loop for scripts/install-desktop.ps1: removes the package rows
  from package.json via pnpm, cuts the mount block out of cordis.patch.yml, and
  restores the newest *.bak-memplus-* copy of package.json.

  ASCII-only and explicit UTF-8 IO on purpose: Windows PowerShell 5.1 otherwise
  reads and rewrites the YAML patch with the ANSI code page and corrupts the
  file's Chinese comments.

.PARAMETER Profile
  Target profile name (default: desktop).
#>
param([string]$Profile = 'desktop')

$ErrorActionPreference = 'Stop'
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$profDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$pkgJson = Join-Path $profDir 'package.json'
$patch = Join-Path $profDir 'cordis.patch.yml'

if (Get-Process -Name 'DeepSeek Harness' -ErrorAction SilentlyContinue) {
  throw 'DSH is running. Quit DeepSeek Harness completely, then rerun this script.'
}

dsh plugin --profile $Profile remove dsh-memory-plus dsh-memory-consolidation-plus 2>$null

if (Test-Path $patch) {
  $text = [System.IO.File]::ReadAllText($patch)
  $new = [regex]::Replace($text, '(?ms)\r?\n# dsh-memory-plus mount.*?(?=\r?\n- |\z)', '')
  $new = [regex]::Replace($new, '(?ms)\r?\n- insert:\r?\n    - id: memory-plus\r?\n(?:      .*\r?\n)*?(?=\r?\n- |\z)', '')
  if ($new -ne $text) {
    [System.IO.File]::WriteAllText($patch, $new.TrimEnd(), $utf8NoBom)
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
