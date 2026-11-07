# SeenVisualizer one-shot setup (Windows, no admin required).
# Downloads a portable Node.js + the open-source Piper TTS engine and voice
# models into .tools/ (git-ignored), then installs npm deps and builds the UI.
#
#   powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root  = Split-Path -Parent $PSScriptRoot
$Tools = Join-Path $Root '.tools'
New-Item -ItemType Directory -Force $Tools | Out-Null

$NodeVersion = 'v24.22.2'
$NodeDir = Join-Path $Tools "node-$NodeVersion-win-x64"

function Get-File($url, $dest) {
  if (Test-Path $dest) { return }
  Write-Host "  downloading $url"
  Invoke-WebRequest -Uri $url -OutFile "$dest.part" -UseBasicParsing
  Move-Item "$dest.part" $dest
}

# ---- Node.js (skip if a system node >= 20 exists) ----------------------------
$sysNode = Get-Command node -ErrorAction SilentlyContinue
if (-not $sysNode -and -not (Test-Path (Join-Path $NodeDir 'node.exe'))) {
  Write-Host '[1/4] Portable Node.js'
  $zip = Join-Path $Tools 'node.zip'
  Get-File "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip" $zip
  Expand-Archive $zip -DestinationPath $Tools -Force
  Remove-Item $zip
} else { Write-Host '[1/4] Node.js present' }
if (-not $sysNode) { $env:PATH = "$NodeDir;$env:PATH" }

# ---- Piper TTS (open source, MIT, runs fully offline) -------------------------
$PiperDir = Join-Path $Tools 'piper'
if (-not (Test-Path (Join-Path $PiperDir 'piper.exe'))) {
  Write-Host '[2/4] Piper TTS engine'
  $zip = Join-Path $Tools 'piper.zip'
  Get-File 'https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip' $zip
  Expand-Archive $zip -DestinationPath $Tools -Force
  Remove-Item $zip
} else { Write-Host '[2/4] Piper present' }

# ---- Piper voices ---------------------------------------------------------------
Write-Host '[3/4] Piper voice models'
$Voices = Join-Path $Tools 'voices'
New-Item -ItemType Directory -Force $Voices | Out-Null
$hf = 'https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US'
foreach ($v in @(
  @{ id = 'en_US-ryan-medium'; path = 'ryan/medium' }
)) {
  Get-File "$hf/$($v.path)/$($v.id).onnx"      (Join-Path $Voices "$($v.id).onnx")
  Get-File "$hf/$($v.path)/$($v.id).onnx.json" (Join-Path $Voices "$($v.id).onnx.json")
}

# ---- npm deps + build -----------------------------------------------------------
Write-Host '[4/4] npm install + build'
Push-Location $Root
try {
  npm install --no-fund --no-audit
  npm run build
} finally { Pop-Location }

Write-Host ''
Write-Host 'Done. Start the app with:  scripts\start.ps1   (then open http://localhost:8000)'
