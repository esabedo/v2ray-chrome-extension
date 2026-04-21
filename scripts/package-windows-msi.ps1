param(
  [string]$Version = ""
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$DistDir = Join-Path $RootDir "dist\install\windows"
$StageDir = Join-Path $DistDir "stage"
$WixFile = Join-Path $RootDir "installer\windows\Product.wxs"
$SingboxExe = Join-Path $RootDir "agent\bin\sing-box.exe"
$AgentExe = Join-Path $StageDir "v2ray-agent.exe"

if (-not $Version) {
  $pkgJson = Get-Content -Path (Join-Path $RootDir "package.json") -Raw | ConvertFrom-Json
  $Version = $pkgJson.version
}

if (-not (Test-Path $SingboxExe)) {
  throw "sing-box.exe not found at $SingboxExe. Run scripts/install-singbox-windows.ps1 first."
}

$wixCmd = Get-Command "wix" -ErrorAction SilentlyContinue
if (-not $wixCmd) {
  throw "WiX CLI not found. Install WiX v4 and ensure `wix` is available in PATH."
}

if (-not (Get-Command "go" -ErrorAction SilentlyContinue)) {
  throw "Go runtime not found in PATH."
}

New-Item -ItemType Directory -Path $StageDir -Force | Out-Null

Push-Location (Join-Path $RootDir "go-agent")
try {
  go build -o ".\..\dist\install\windows\stage\v2ray-agent.exe" ".\cmd\agent"
}
finally {
  Pop-Location
}

Copy-Item -Path $SingboxExe -Destination (Join-Path $StageDir "sing-box.exe") -Force

$OutMsi = Join-Path $DistDir ("v2ray-extension-agent-" + $Version + "-x64.msi")

& wix build `
  -d "Version=$Version" `
  -d "StageDir=$StageDir" `
  -o "$OutMsi" `
  "$WixFile"

if (-not (Test-Path $OutMsi)) {
  throw "MSI was not created at expected path: $OutMsi"
}

Write-Host "Built MSI: $OutMsi"
