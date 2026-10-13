# Registers (or unregisters) the "dsh" URL protocol handler for this package,
# so dsh://session/<id> links open the DeepSeek Harness web GUI at the live
# Web URL (see dsh-open.cmd for the resolution order; plain `dsh web` falls
# back to http://127.0.0.1:3080/?session=<id>).
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File register-protocol.ps1            # register (refuses to steal the scheme)
#   powershell -ExecutionPolicy Bypass -File register-protocol.ps1 -Force     # take the scheme over from another handler
#   powershell -ExecutionPolicy Bypass -File register-protocol.ps1 -Uninstall # unregister
#
# The scheme is per-user (HKCU), so no admin rights are needed. DSH Desktop
# registers its own `dsh` handler; -Force replaces it with this launcher.
param(
  [switch]$Uninstall,
  [switch]$Force,
  # Advanced/testing: registry root to operate on.
  [string]$RegistryPath = "HKCU:\Software\Classes\dsh"
)

$ErrorActionPreference = "Stop"
$pkgDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$launcher = Join-Path $pkgDir "dsh-open.cmd"
$key = $RegistryPath

# Default (unnamed) value of one registry key, or $null when absent.
function Get-DefaultValue([string]$path) {
  if (-not (Test-Path $path)) { return $null }
  $item = Get-Item -Path $path -ErrorAction SilentlyContinue
  if ($null -eq $item) { return $null }
  try { return [string]$item.GetValue("") } catch { return $null }
}

if ($Uninstall) {
  if (Test-Path $key) { Remove-Item -Path $key -Recurse -Force }
  Write-Host "dsh:// protocol handler unregistered."
  exit 0
}

if (-not (Test-Path $launcher)) { throw "launcher not found: $launcher" }

$command = "`"$launcher`" `"%1`""
$existingDescription = Get-DefaultValue $key
$existingCommand = Get-DefaultValue "$key\shell\open\command"
$isOurs = $null -ne $existingCommand -and $existingCommand -like "*$launcher*"

# Refuse to silently steal a foreign handler (e.g. DSH Desktop's own
# registration); taking it over is an explicit -Force decision.
if ($null -ne $existingCommand -and -not $isOurs -and -not $Force) {
  Write-Host "The dsh:// scheme is already handled by another program:"
  if ($null -ne $existingDescription -and $existingDescription -ne "") { Write-Host "  description: $existingDescription" }
  Write-Host "  command:     $existingCommand"
  Write-Host ""
  Write-Host "Refusing to overwrite it. Options:"
  Write-Host "  - re-run with -Force to take the scheme over for this plugin (dsh-open.cmd);"
  Write-Host "  - leave it as is (DSH Desktop 2.0.x registers its own handler and does not"
  Write-Host "    parse session ids yet, so dsh:// links will not reach a session there);"
  Write-Host "  - paste the copied link into a conversation instead - that path needs no protocol."
  exit 1
}

# Per-user protocol registration (HKCU): no admin rights needed.
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name "(default)" -Value "URL:DeepSeek Harness Session" -PropertyType String -Force | Out-Null
New-ItemProperty -Path $key -Name "URL Protocol" -Value "" -PropertyType String -Force | Out-Null
New-Item -Path "$key\shell\open\command" -Force | Out-Null
New-ItemProperty -Path "$key\shell\open\command" -Name "(default)" -Value $command -PropertyType String -Force | Out-Null

Write-Host "dsh:// protocol handler registered:"
Write-Host "  $command"
if ($null -ne $existingCommand -and -not $isOurs) {
  Write-Host "Note: an existing handler was replaced (-Force):"
  Write-Host "  previous: $existingCommand"
}
Write-Host "Test: start dsh://session/session-test123"
