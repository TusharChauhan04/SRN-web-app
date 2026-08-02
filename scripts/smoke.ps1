# Smoke test — proves the app's externally visible behaviour is unchanged.
#
# Exists so a change to routing, middleware/proxy or build config can be shown
# not to regress anything, rather than assumed not to. Run it before and after
# any such change and diff the output.
#
#   pwsh scripts/smoke.ps1 -Port 3140
param([int]$Port = 3140)

$ErrorActionPreference = "Continue"
$base = "http://localhost:$Port"

$proc = Start-Process -FilePath "node" `
  -ArgumentList "node_modules\next\dist\bin\next", "dev", "-p", "$Port" `
  -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput "$env:TEMP\smoke-out.txt" `
  -RedirectStandardError "$env:TEMP\smoke-err.txt"

Start-Sleep -Seconds 25

function New-Session([string]$Email) {
  $s = New-Object Microsoft.PowerShell.Commands.WebRequestSession
  $cred = (Invoke-WebRequest "$base/api/v1/auth/dev-credential" -Method POST `
    -Headers @{"Content-Type" = "application/json" } `
    -Body (@{email = $Email } | ConvertTo-Json) -UseBasicParsing -WebSession $s).Content | ConvertFrom-Json
  Invoke-WebRequest "$base/api/v1/auth.createSession" -Method POST `
    -Headers @{"Content-Type" = "application/json" } `
    -Body (@{input = @{credential = $cred.credential } } | ConvertTo-Json) `
    -UseBasicParsing -WebSession $s | Out-Null
  return $s
}

function Get-Status($Session, [string]$Path) {
  try {
    $r = Invoke-WebRequest "$base$Path" -UseBasicParsing -WebSession $Session `
      -MaximumRedirection 0 -TimeoutSec 120
    return $r.StatusCode
  }
  catch { return $_.Exception.Response.StatusCode.value__ }
}

function Get-OpStatus($Session, [string]$Op, $Payload) {
  # NB: do not name this parameter $Input - that is a PowerShell automatic
  # variable (the pipeline enumerator) and is never $null inside a function.
  $body = if ($null -eq $Payload) { '{}' } else { (@{input = $Payload } | ConvertTo-Json -Depth 6) }
  try {
    $r = Invoke-WebRequest "$base/api/v1/$Op" -Method POST `
      -Headers @{"Content-Type" = "application/json" } -Body $body `
      -UseBasicParsing -WebSession $Session -TimeoutSec 120
    return $r.StatusCode
  }
  catch { return $_.Exception.Response.StatusCode.value__ }
}

# Warm-up: dev mode compiles routes on first request. Without this, the first
# hit on each route can exceed the timeout and register as a false failure.
$warm = New-Object Microsoft.PowerShell.Commands.WebRequestSession
foreach ($p in @("/", "/login", "/dashboard", "/admin", "/requirements", "/messages", "/profile")) {
  try { Invoke-WebRequest "$base$p" -UseBasicParsing -WebSession $warm -TimeoutSec 180 | Out-Null } catch {}
}

Write-Output "=== ANONYMOUS (protected routes must redirect, api must 401) ==="
$anon = New-Object Microsoft.PowerShell.Commands.WebRequestSession
foreach ($p in @("/", "/dashboard", "/requirements", "/admin", "/messages")) {
  Write-Output "  $p -> $(Get-Status $anon $p)"
}
Write-Output "  /login -> $(Get-Status $anon '/login')"
Write-Output "  /api/healthz -> $(Get-Status $anon '/api/healthz')"
# The gateway must answer JSON 401, never a redirect — a redirect here would
# mean middleware/proxy started intercepting the API surface.
Write-Output "  api dashboard.get -> $(Get-OpStatus $anon 'dashboard.get' $null)"

Write-Output "=== PROVIDER ==="
$prov = New-Session "smoke-provider@test.local"
Get-OpStatus $prov "auth.completeOnboarding" @{role = "digital"; name = "Smoke Dev"; title = "Dev"; skills = @("react") } | Out-Null
foreach ($p in @("/", "/dashboard", "/requirements", "/portfolio", "/earnings", "/analytics", "/availability", "/subscription", "/messages", "/profile", "/settings", "/notifications", "/search", "/referrals", "/settings/phone", "/settings/verification", "/settings/data")) {
  Write-Output "  $p -> $(Get-Status $prov $p)"
}
Write-Output "  /admin (must redirect away) -> $(Get-Status $prov '/admin')"
Write-Output "  api admin.overview (must be 403) -> $(Get-OpStatus $prov 'admin.overview' $null)"

Write-Output "=== ADMIN ==="
$admin = New-Session "boss@test.local"
foreach ($p in @("/", "/admin", "/admin/users", "/admin/disputes", "/admin/verification", "/admin/moderation", "/admin/fraud", "/admin/revenue", "/admin/flags", "/admin/audit", "/profile")) {
  Write-Output "  $p -> $(Get-Status $admin $p)"
}
Write-Output "  api admin.overview -> $(Get-OpStatus $admin 'admin.overview' $null)"

Stop-Process -Id $proc.Id -Force
Write-Output "=== done ==="
