#Requires -Version 7.0
# Inicia únicamente el backend de servicio, una vez conocida la URL HTTPS real del Worker.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$AllowedOrigin,
    [Parameter(Mandatory)][bool]$RegistrationOpen,
    [ValidateLength(1,80)][string]$InstanceName = 'nu.vex'
)
. (Join-Path $PSScriptRoot 'central-common.ps1')
try { $NuvexOriginUri = [Uri]$AllowedOrigin } catch { throw 'AllowedOrigin debe ser un origen HTTPS exacto.' }
if (-not $NuvexOriginUri.IsAbsoluteUri -or $NuvexOriginUri.Scheme -ne 'https' -or
    $NuvexOriginUri.UserInfo -or $NuvexOriginUri.Query -or $NuvexOriginUri.Fragment -or
    $AllowedOrigin -ne $NuvexOriginUri.GetLeftPart([UriPartial]::Authority)) {
    throw 'AllowedOrigin debe ser un origen HTTPS exacto, sin ruta, barra final, parámetros ni credenciales.'
}
& (Join-Path $PSScriptRoot 'init-central.ps1') | Out-Null
$NuvexConnection = Get-CentralConnection
$NuvexStateFile = Join-Path $NuvexCentralRoot 'backend.json'
$NuvexListeners = @(Get-NetTCPConnection -LocalPort 3003 -State Listen -ErrorAction SilentlyContinue)
if ($NuvexListeners.Count) {
    if (-not (Test-Path -LiteralPath $NuvexStateFile)) { throw 'El puerto 3003 ya está ocupado; no se modifica el proceso existente.' }
    $NuvexSavedState = Get-Content -LiteralPath $NuvexStateFile -Raw | ConvertFrom-Json
    $NuvexExistingProcess = Get-Process -Id $NuvexSavedState.pid -ErrorAction SilentlyContinue
    if (-not $NuvexExistingProcess -or $NuvexExistingProcess.Path -ne $NuvexCentralServer -or
        @($NuvexListeners | Where-Object { $_.OwningProcess -ne $NuvexSavedState.pid -or $_.LocalAddress -ne '127.0.0.1' }).Count -or
        $NuvexSavedState.allowedOrigin -ne $AllowedOrigin -or $NuvexSavedState.registrationOpen -ne $RegistrationOpen -or
        $NuvexSavedState.instanceName -ne $InstanceName) {
        throw 'El puerto 3003 o su configuración no coinciden con esta instancia. No se reinicia ni sustituye ningún proceso.'
    }
    [ordered]@{ started=$false; reused=$true; pid=$NuvexSavedState.pid; bind='127.0.0.1:3003'; allowedOrigin=$AllowedOrigin; registrationOpen=$RegistrationOpen } | ConvertTo-Json
    return
}
$NuvexRun = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
$NuvexOutputLog = Join-Path $NuvexCentralRoot "backend-$NuvexRun.stdout.log"
$NuvexErrorLog = Join-Path $NuvexCentralRoot "backend-$NuvexRun.stderr.log"
$NuvexBackendEnvironment = @{
    NUVEX_DATABASE_URL=$NuvexConnection.databaseUrl
    NUVEX_BIND='127.0.0.1:3003'
    NUVEX_ALLOWED_ORIGIN=$AllowedOrigin
    NUVEX_INSECURE_DEV='false'
    NUVEX_REGISTRATION_OPEN=$RegistrationOpen.ToString().ToLowerInvariant()
    NUVEX_MIGRATE_ON_START='false'
    NUVEX_TRUSTED_PROXIES='127.0.0.1/32'
    NUVEX_INSTANCE_NAME=$InstanceName
    RUST_LOG='nuvex_server=info'
}
$NuvexBackendProcess = Invoke-CentralEnvironment $NuvexBackendEnvironment {
    Start-Process -FilePath $NuvexCentralServer -WorkingDirectory $NuvexCentralWorkspace -WindowStyle Hidden -PassThru -RedirectStandardOutput $NuvexOutputLog -RedirectStandardError $NuvexErrorLog
}
$NuvexState = [ordered]@{
    schemaVersion=1; purpose='nuvex-central-service'; pid=$NuvexBackendProcess.Id; startedAt=[DateTime]::UtcNow.ToString('o')
    executable=$NuvexCentralServer; bind='127.0.0.1:3003'; allowedOrigin=$AllowedOrigin
    instanceName=$InstanceName; registrationOpen=$RegistrationOpen
    stdoutLog=$NuvexOutputLog; stderrLog=$NuvexErrorLog; ready=$false
}
[IO.File]::WriteAllText($NuvexStateFile, ($NuvexState | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText((Join-Path $NuvexCentralRoot 'backend.pid'), [string]$NuvexBackendProcess.Id, [Text.UTF8Encoding]::new($false))
$NuvexReady = $false
for ($NuvexAttempt = 0; $NuvexAttempt -lt 40; $NuvexAttempt++) {
    $NuvexBackendProcess.Refresh()
    if ($NuvexBackendProcess.HasExited) { throw 'El backend terminó antes de estar disponible. Consulta sus registros privados.' }
    try {
        $NuvexHealth = Invoke-WebRequest -Uri 'http://127.0.0.1:3003/health/ready' -UseBasicParsing -NoProxy -TimeoutSec 2
        if ($NuvexHealth.StatusCode -eq 200) { $NuvexReady = $true; break }
    } catch { }
    Start-Sleep -Milliseconds 250
}
if (-not $NuvexReady) { throw 'El backend no confirmó disponibilidad. El PID y los registros quedan en el directorio privado para diagnóstico.' }
$NuvexState.ready = $true
[IO.File]::WriteAllText($NuvexStateFile, ($NuvexState | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
[ordered]@{ started=$true; reused=$false; pid=$NuvexBackendProcess.Id; ready=$true; bind='127.0.0.1:3003'; allowedOrigin=$AllowedOrigin; registrationOpen=$RegistrationOpen; instanceName=$InstanceName } | ConvertTo-Json
