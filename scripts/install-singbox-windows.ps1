param(
  [string]$Version = "latest"
)

$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$TargetDir = Join-Path $RootDir "agent\bin"
$TargetBin = Join-Path $TargetDir "sing-box.exe"
$TempDir = New-Item -ItemType Directory -Path (Join-Path $env:TEMP ("singbox-" + [guid]::NewGuid())) -Force

try {
if ($Version -eq "latest") {
    $headers = @{
      "Accept" = "application/vnd.github+json"
      "User-Agent" = "v2ray-extension-ci"
    }
    if ($env:GITHUB_TOKEN) {
      $headers["Authorization"] = "Bearer $($env:GITHUB_TOKEN)"
    }
    $latest = Invoke-RestMethod -Uri "https://api.github.com/repos/SagerNet/sing-box/releases/latest" -Headers $headers
    $Version = $latest.tag_name
  }

  if (-not $Version) {
    throw "Unable to resolve sing-box version"
  }

  $verTrimmed = $Version.TrimStart("v")
  $archiveName = "sing-box-$verTrimmed-windows-amd64.zip"
  $downloadUrl = "https://github.com/SagerNet/sing-box/releases/download/$Version/$archiveName"
  $zipPath = Join-Path $TempDir.FullName "singbox.zip"

  Write-Host "Downloading $downloadUrl"
  Invoke-WebRequest -Uri $downloadUrl -Headers @{ "User-Agent" = "v2ray-extension-ci" } -OutFile $zipPath
  Expand-Archive -Path $zipPath -DestinationPath $TempDir.FullName -Force

  $found = Get-ChildItem -Path $TempDir.FullName -Filter "sing-box.exe" -Recurse | Select-Object -First 1
  if (-not $found) {
    throw "sing-box.exe not found in archive"
  }

  New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
  Copy-Item -Path $found.FullName -Destination $TargetBin -Force
  Write-Host "Installed: $TargetBin"
}
finally {
  if (Test-Path $TempDir.FullName) {
    Remove-Item -Path $TempDir.FullName -Recurse -Force
  }
}
