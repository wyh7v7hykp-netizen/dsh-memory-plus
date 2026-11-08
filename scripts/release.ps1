#requires -Version 5.1
<#
.SYNOPSIS
  Build dsh-memory-plus and publish an immutable, versioned release into the
  DSH profile's local-packages directory.

.DESCRIPTION
  The stable install is a copy inside the profile, not a link to the dev tree:
  editing src/ then never reaches DSH until you publish a new version directory
  and reinstall the bundle. That is deliberate.

  Steps: pnpm build -> pnpm test -> copy the three packages ->
  verify every package.json parses and has no BOM -> print the install commands.

  ASCII-only on purpose (Windows PowerShell 5.1 reads BOM-less scripts with the
  ANSI code page).

.PARAMETER Version
  Release version, must match the three package.json versions (default 1.0.0).

.PARAMETER Profile
  Target profile (default desktop).

.EXAMPLE
  powershell -File scripts/release.ps1 -Version 1.0.0
#>
param(
  [string]$Version = '1.0.0',
  [string]$Profile = 'desktop'
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

$packages = @('memory', 'memory-consolidation', 'bundle')
foreach ($name in $packages) {
  $manifest = Join-Path $root "packages\$name\package.json"
  $text = [System.IO.File]::ReadAllText($manifest).TrimStart([char]0xFEFF)
  $json = $text | ConvertFrom-Json
  if ($json.version -ne $Version) {
    throw "version mismatch: packages/$name/package.json is $($json.version), expected $Version"
  }
}

Push-Location $root
try {
  & pnpm build
  if ($LASTEXITCODE -ne 0) { throw "pnpm build failed ($LASTEXITCODE)" }
  & pnpm test
  if ($LASTEXITCODE -ne 0) { throw "pnpm test failed ($LASTEXITCODE)" }
} finally {
  Pop-Location
}

$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
$releaseDir = Join-Path $profileDir "local-packages\dsh-memory-plus\$Version"
if (Test-Path $releaseDir) { Remove-Item $releaseDir -Recurse -Force }
New-Item -ItemType Directory -Path $releaseDir -Force | Out-Null

foreach ($name in $packages) {
  $src = Join-Path $root "packages\$name"
  $dst = Join-Path $releaseDir $name
  New-Item -ItemType Directory -Path $dst -Force | Out-Null
  Copy-Item (Join-Path $src 'package.json') $dst
  if (Test-Path (Join-Path $src 'cordis.patch.yml')) {
    Copy-Item (Join-Path $src 'cordis.patch.yml') $dst
  }
  if (Test-Path (Join-Path $src 'lib')) {
    Copy-Item (Join-Path $src 'lib') (Join-Path $dst 'lib') -Recurse
  }
  if (Test-Path (Join-Path $src 'types')) {
    Copy-Item (Join-Path $src 'types') (Join-Path $dst 'types') -Recurse
  }
  $readme = Join-Path $src 'README.upstream.md'
  if (Test-Path $readme) { Copy-Item $readme (Join-Path $dst 'README.md') }
}

# Re-write every manifest as UTF-8 without BOM. Windows PowerShell's
# `Set-Content -Encoding utf8` adds one, and DSH rejects a BOM-prefixed
# package.json with "Unexpected token '\\uFEFF'".
Get-ChildItem $releaseDir -Recurse -Filter package.json | ForEach-Object {
  $clean = [System.IO.File]::ReadAllText($_.FullName).TrimStart([char]0xFEFF)
  try { $null = $clean | ConvertFrom-Json } catch { throw "invalid JSON: $($_.FullName)" }
  [System.IO.File]::WriteAllText($_.FullName, $clean, $utf8NoBom)
}

$bundlePath = Join-Path $releaseDir 'bundle'
Write-Host ''
Write-Host "release: $releaseDir"
Write-Host 'install / upgrade (run while DSH is running, via the plugin manager):'
Write-Host "  plugin_manager set_bundle    target=dsh-memory-plus-bundle enabled=false"
Write-Host "  plugin_manager remove_bundle target=dsh-memory-plus-bundle"
Write-Host "  plugin_manager install_bundle target=file:$($bundlePath -replace '\\','/')"
Write-Host ''
Write-Host 'rollback: keep the old version directory and install it the same way.'
exit 0
