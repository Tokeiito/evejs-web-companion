<#
.SYNOPSIS
    Start, stop or check the EvEJS browser client.

.DESCRIPTION
    Day-to-day companion to SetupWebClient.bat. Setup records how the client is
    meant to run (EVEJS_WEB_MODE in .env) and which folder the server is in, so
    this needs no arguments and no decisions.

    It re-detects whether the SERVER is native or in Docker every time, because
    that can change between sessions and it decides which compose files apply.

.EXAMPLE
    .\StartWebClient.bat
    .\StartWebClient.bat stop
    .\StartWebClient.bat check
#>
[CmdletBinding()]
param(
  [ValidateSet("start", "stop", "check")]
  [string]$Action = "start"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version 1.0

$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$WebEnvPath = Join-Path $RepoRoot ".env"
$ComposeBase = Join-Path $RepoRoot "compose.yaml"
$ComposeOverlay = Join-Path $RepoRoot "compose.evejs-docker.yaml"
$ClientUrl = "http://127.0.0.1:26500"

function Write-Info { param([string]$T) Write-Host "  $T" -ForegroundColor Gray }
function Write-Good { param([string]$T) Write-Host "  $T" -ForegroundColor Green }
function Write-Warn { param([string]$T) Write-Host "  $T" -ForegroundColor Yellow }

function Read-EnvFile {
  param([string]$Path)
  $map = @{}
  if (-not (Test-Path $Path)) { return $map }
  foreach ($line in (Get-Content -LiteralPath $Path)) {
    $trimmed = $line.Trim()
    if (-not $trimmed -or $trimmed.StartsWith("#")) { continue }
    $split = $trimmed.IndexOf("=")
    if ($split -lt 1) { continue }
    $map[$trimmed.Substring(0, $split).Trim()] = $trimmed.Substring($split + 1).Trim()
  }
  return $map
}

$env_ = Read-EnvFile $WebEnvPath
$clientMode = "native"
if ($env_.ContainsKey("EVEJS_WEB_MODE") -and $env_["EVEJS_WEB_MODE"] -eq "docker") { $clientMode = "docker" }

# Which compose files apply depends on where the SERVER is right now, not on
# anything setup recorded -- the server can move between sessions.
$serverInDocker = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
  $names = & docker ps --filter "name=evejs-server" --format "{{.Names}}" 2>$null
  if ($LASTEXITCODE -eq 0 -and $names) { $serverInDocker = $true }
}
$composeArgs = @("-f", $ComposeBase)
if ($serverInDocker) { $composeArgs = @("-f", $ComposeBase, "-f", $ComposeOverlay) }

Push-Location $RepoRoot
try {
  switch ($Action) {
    "stop" {
      if ($clientMode -eq "docker") {
        & docker compose @composeArgs down
        Write-Good "Stopped."
      } else {
        Write-Warn "The client runs in its own window -- close that window to stop it."
      }
    }

    "check" {
      if ($clientMode -eq "docker") {
        & docker compose @composeArgs exec -T bff node scripts/doctor.js
      } else {
        & npm run doctor --silent
      }
      exit $LASTEXITCODE
    }

    "start" {
      if ($clientMode -eq "docker") {
        & docker compose @composeArgs up --detach
        if ($LASTEXITCODE -ne 0) { throw "Could not start the client container." }
        Start-Sleep -Seconds 5
        & docker compose @composeArgs exec -T bff node scripts/doctor.js | Out-Null
        $connected = ($LASTEXITCODE -eq 0)
      } else {
        Start-Process -FilePath "cmd.exe" `
          -ArgumentList "/k", "cd /d ""$RepoRoot"" && npm start" `
          -WorkingDirectory $RepoRoot | Out-Null
        Start-Sleep -Seconds 6
        & npm run doctor --silent | Out-Null
        $connected = ($LASTEXITCODE -eq 0)
      }

      Write-Host ""
      if ($connected) {
        Write-Good "Ready. Open this in your browser:"
        Write-Host ""
        Write-Host "      $ClientUrl" -ForegroundColor White
        Write-Host ""
      } else {
        Write-Warn "The client started but could not reach the EvEJS server."
        Write-Host ""
        Write-Info "Is the server running? Then run:  StartWebClient.bat check"
        Write-Info "That names exactly what is wrong."
        Write-Host ""
        exit 1
      }
    }
  }
} finally {
  Pop-Location
}

exit 0
