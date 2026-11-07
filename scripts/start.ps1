# Start SIEMVisual on http://localhost:8000 (uses the portable Node from setup.ps1 if needed)
$Root = Split-Path -Parent $PSScriptRoot
$Portable = Get-ChildItem (Join-Path $Root '.tools') -Directory -Filter 'node-*' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not (Get-Command node -ErrorAction SilentlyContinue) -and $Portable) { $env:PATH = "$($Portable.FullName);$env:PATH" }
Push-Location $Root
try {
  if (-not (Test-Path 'dist/web/index.html')) { npm run build }
  npm start
} finally { Pop-Location }
