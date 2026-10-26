#Requires -Version 7.0
# Inicia solo el conector Cloudflare registrado para esta instancia, sin publicar secretos.
[CmdletBinding()]
param([ValidateRange(5,120)][int]$ReadyTimeoutSeconds = 45)
. (Join-Path $PSScriptRoot 'central-common.ps1')

$NuvexTunnelExecutable = [IO.Path]::GetFullPath((Join-Path $NuvexCentralWorkspace '.cache/toolchains/cloudflared/cloudflared.exe'))
$NuvexTunnelExpectedHash = '76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2'
$NuvexTunnelMetrics = '127.0.0.1:20263'
$NuvexTunnelReadyUrl = 'http://127.0.0.1:20263/ready'

# El ejecutable está fuera de los datos de servicio. Se valida también cada
# antecesor hasta el workspace para rechazar enlaces en .cache/toolchains.
$NuvexTunnelCursor = $NuvexTunnelExecutable
while ($NuvexTunnelCursor -and $NuvexTunnelCursor.Length -ge $NuvexCentralWorkspace.Length) {
    if (-not (Test-Path -LiteralPath $NuvexTunnelCursor)) { throw 'Falta el ejecutable cloudflared fijado o una de sus carpetas.' }
    if ((Get-Item -LiteralPath $NuvexTunnelCursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'No se admiten enlaces en la ruta del conector Cloudflare.'
    }
    if ($NuvexTunnelCursor -eq $NuvexCentralWorkspace) { break }
    $NuvexTunnelCursor = Split-Path $NuvexTunnelCursor -Parent
}
if (-not (Test-Path -LiteralPath $NuvexTunnelExecutable -PathType Leaf) -or
    (Get-FileHash -LiteralPath $NuvexTunnelExecutable -Algorithm SHA256).Hash.ToLowerInvariant() -ne $NuvexTunnelExpectedHash) {
    throw 'El ejecutable cloudflared no coincide con la suma SHA-256 fijada; no se inicia.'
}
$NuvexTunnelVersion = @(& $NuvexTunnelExecutable '--version' 2>&1)
if ($LASTEXITCODE -ne 0 -or ($NuvexTunnelVersion -join ' ') -notmatch '^cloudflared version 2026\.10\.3(?:\s|$)') {
    throw 'Se requiere cloudflared 2026.10.3; no se inicia otra versión.'
}
if ([Environment]::GetEnvironmentVariable('TUNNEL_TOKEN', 'Process')) {
    throw 'Hay una credencial de túnel en el entorno del proceso. El conector requiere exclusivamente el archivo privado; no se modifica esa variable.'
}

Protect-CentralDirectory
$NuvexTunnelTokenFile = Assert-CentralPath (Join-Path $NuvexCentralRoot 'tunnel.token')
$NuvexTunnelStateFile = Assert-CentralPath (Join-Path $NuvexCentralRoot 'tunnel.json')
$NuvexTunnelPidFile = Assert-CentralPath (Join-Path $NuvexCentralRoot 'tunnel.pid')
$NuvexTunnelLockFile = Assert-CentralPath (Join-Path $NuvexCentralRoot 'tunnel-start.lock')
if (-not (Test-Path -LiteralPath $NuvexTunnelTokenFile -PathType Leaf)) {
    throw 'Falta tunnel.token en el directorio privado. Configura primero el conector; no pegues su credencial en argumentos ni en la conversación.'
}
$NuvexTunnelTokenItem = Get-Item -LiteralPath $NuvexTunnelTokenFile -Force
if ($NuvexTunnelTokenItem.Length -lt 64 -or $NuvexTunnelTokenItem.Length -gt 16384) {
    throw 'El archivo de credencial de túnel no tiene un tamaño válido.'
}
$NuvexTunnelOwner = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$NuvexTunnelTokenAcl = Get-Acl -LiteralPath $NuvexTunnelTokenFile
if ($NuvexTunnelTokenAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $NuvexTunnelOwner -or
    @($NuvexTunnelTokenAcl.Access | Where-Object {
        $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $NuvexTunnelOwner
    }).Count) {
    throw 'El archivo de credencial no está limitado a la identidad Windows de la instancia; no se cambia su propietario ni se inicia el túnel.'
}

# Solo la validación local lee el archivo. Nada de su contenido se devuelve,
# se pasa a argumentos, se coloca en variables de entorno o se escribe en logs.
$NuvexTunnelTokenBytes = $null
$NuvexTunnelSecretBytes = $null
try {
    $NuvexTunnelTokenText = [IO.File]::ReadAllText($NuvexTunnelTokenFile).Trim()
    if ($NuvexTunnelTokenText -notmatch '^[A-Za-z0-9+/]+={0,2}$') { throw 'invalid' }
    $NuvexTunnelTokenBytes = [Convert]::FromBase64String($NuvexTunnelTokenText)
    $NuvexTunnelTokenObject = [Text.UTF8Encoding]::new($false, $true).GetString($NuvexTunnelTokenBytes) | ConvertFrom-Json
    $NuvexTunnelId = [Guid]::Empty
    if ($NuvexTunnelTokenObject.a -isnot [string] -or $NuvexTunnelTokenObject.a -notmatch '^[a-fA-F0-9]{32}$' -or
        $NuvexTunnelTokenObject.t -isnot [string] -or -not [Guid]::TryParse($NuvexTunnelTokenObject.t, [ref]$NuvexTunnelId) -or
        $NuvexTunnelTokenObject.s -isnot [string]) { throw 'invalid' }
    $NuvexTunnelSecretBytes = [Convert]::FromBase64String($NuvexTunnelTokenObject.s)
    if ($NuvexTunnelId -eq [Guid]::Empty -or $NuvexTunnelSecretBytes.Length -lt 32 -or $NuvexTunnelSecretBytes.Length -gt 1024) { throw 'invalid' }
    $NuvexTunnelIdText = $NuvexTunnelId.ToString('D')
} catch {
    throw 'El archivo privado no contiene una credencial de túnel válida; no se muestra su contenido.'
} finally {
    if ($NuvexTunnelTokenBytes) { [Array]::Clear($NuvexTunnelTokenBytes, 0, $NuvexTunnelTokenBytes.Length) }
    if ($NuvexTunnelSecretBytes) { [Array]::Clear($NuvexTunnelSecretBytes, 0, $NuvexTunnelSecretBytes.Length) }
    $NuvexTunnelTokenText = $null
    $NuvexTunnelTokenObject = $null
    $NuvexTunnelTokenBytes = $null
    $NuvexTunnelSecretBytes = $null
}

function Get-TunnelListeners {
    return @(Get-NetTCPConnection -LocalPort 20263 -State Listen -ErrorAction SilentlyContinue)
}

function Write-TunnelState {
    param([Parameter(Mandatory)]$State)
    $NuvexStateTemporary = Assert-CentralPath (Join-Path $NuvexCentralRoot ('tunnel-state-' + [Guid]::NewGuid().ToString('N') + '.tmp'))
    [IO.File]::WriteAllText($NuvexStateTemporary, ($State | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    [void](Assert-CentralPath $NuvexTunnelStateFile)
    [IO.File]::Move($NuvexStateTemporary, $NuvexTunnelStateFile, $true)
}

function Quote-TunnelPath {
    param([Parameter(Mandatory)][string]$Path)
    if ($Path.Contains('"') -or $Path -match '[\r\n\x00]') { throw 'No se puede representar de forma segura una ruta del conector.' }
    return '"' + $Path + '"'
}

$NuvexTunnelLock = $null
try {
    try { $NuvexTunnelLock = [IO.File]::Open($NuvexTunnelLockFile, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { throw 'Ya se está preparando el conector o su bloqueo privado no está disponible; no se inicia otro proceso.' }

    $NuvexTunnelState = $null
    $NuvexTunnelProcess = $null
    $NuvexTunnelStarted = $false
    if (Test-Path -LiteralPath $NuvexTunnelStateFile) {
        try { $NuvexTunnelState = Get-Content -LiteralPath $NuvexTunnelStateFile -Raw | ConvertFrom-Json }
        catch { throw 'El estado privado del túnel no es válido; no se sustituye.' }
        $NuvexSavedPid = 0
        $NuvexPidFromFile = 0
        if ($NuvexTunnelState.schemaVersion -ne 1 -or $NuvexTunnelState.purpose -ne 'nuvex-central-tunnel' -or
            $NuvexTunnelState.executable -ne $NuvexTunnelExecutable -or $NuvexTunnelState.binarySha256 -ne $NuvexTunnelExpectedHash -or
            $NuvexTunnelState.metrics -ne $NuvexTunnelMetrics -or $NuvexTunnelState.tokenFile -ne $NuvexTunnelTokenFile -or
            $NuvexTunnelState.tunnelId -ne $NuvexTunnelIdText -or
            -not [int]::TryParse([string]$NuvexTunnelState.pid, [ref]$NuvexSavedPid) -or $NuvexSavedPid -le 0 -or
            -not (Test-Path -LiteralPath $NuvexTunnelPidFile -PathType Leaf) -or
            -not [int]::TryParse([IO.File]::ReadAllText($NuvexTunnelPidFile).Trim(), [ref]$NuvexPidFromFile) -or $NuvexPidFromFile -ne $NuvexSavedPid) {
            throw 'El estado, PID o configuración del túnel no coinciden con esta instancia. No se sustituyen.'
        }
        $NuvexTunnelProcess = Get-Process -Id $NuvexSavedPid -ErrorAction SilentlyContinue
        if ($NuvexTunnelProcess) {
            # ConvertFrom-Json puede devolver DateTime; convertirlo a string
            # primero perdería fracciones de segundo y rechazaría el PID propio.
            try { $NuvexSavedStartedAt = [DateTime]$NuvexTunnelState.processStartedAt }
            catch { throw 'La fecha del proceso registrado no es válida; no se reutiliza.' }
            if ($NuvexTunnelProcess.Path -ne $NuvexTunnelExecutable -or
                $NuvexTunnelProcess.StartTime.ToUniversalTime().Ticks -ne $NuvexSavedStartedAt.ToUniversalTime().Ticks) {
                throw 'El PID guardado pertenece a otro proceso; no se detiene ni se reutiliza.'
            }
            # Se comprueban solo argumentos no secretos; nunca se muestra CommandLine.
            $NuvexTunnelCommandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $NuvexSavedPid" -ErrorAction Stop).CommandLine
            $NuvexTokenPathPattern = '(?:^|\s)--token-file(?:=|\s+)"?' + [Regex]::Escape($NuvexTunnelTokenFile) + '"?(?:\s|$)'
            if ($NuvexTunnelCommandLine -notmatch '(?:^|\s)--metrics(?:=|\s+)"?127\.0\.0\.1:20263"?(?:\s|$)' -or
                $NuvexTunnelCommandLine -notmatch $NuvexTokenPathPattern -or $NuvexTunnelCommandLine -match '(?:^|\s)--token(?:=|\s+)') {
                throw 'El proceso registrado no usa los parámetros privados esperados; no se reutiliza ni se detiene.'
            }
            $NuvexTunnelCommandLine = $null
        }
    } elseif (Test-Path -LiteralPath $NuvexTunnelPidFile) {
        throw 'Hay un PID de túnel sin estado verificable; se conserva para revisión.'
    }

    $NuvexTunnelListeners = @(Get-TunnelListeners)
    if ($NuvexTunnelListeners.Count -and (-not $NuvexTunnelProcess -or
        @($NuvexTunnelListeners | Where-Object { $_.OwningProcess -ne $NuvexTunnelProcess.Id -or $_.LocalAddress -ne '127.0.0.1' }).Count)) {
        throw 'El puerto de métricas 20263 pertenece a otro proceso o dirección; no se ha sustituido ni detenido.'
    }

    if (-not $NuvexTunnelProcess) {
        $NuvexTunnelRun = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,8)
        $NuvexTunnelLog = Assert-CentralPath (Join-Path $NuvexCentralRoot "tunnel-$NuvexTunnelRun.log")
        $NuvexTunnelOutput = Assert-CentralPath (Join-Path $NuvexCentralRoot "tunnel-$NuvexTunnelRun.stdout.log")
        $NuvexTunnelError = Assert-CentralPath (Join-Path $NuvexCentralRoot "tunnel-$NuvexTunnelRun.stderr.log")
        $NuvexTunnelArguments = @('tunnel','--no-autoupdate','--metrics',$NuvexTunnelMetrics,'--loglevel','warn','--logfile',(Quote-TunnelPath $NuvexTunnelLog),'run','--token-file',(Quote-TunnelPath $NuvexTunnelTokenFile))
        $NuvexTunnelProcess = Start-Process -FilePath $NuvexTunnelExecutable -WorkingDirectory $NuvexCentralRoot -ArgumentList $NuvexTunnelArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput $NuvexTunnelOutput -RedirectStandardError $NuvexTunnelError
        $NuvexTunnelStarted = $true
        $NuvexTunnelState = [ordered]@{
            schemaVersion=1; purpose='nuvex-central-tunnel'; pid=$NuvexTunnelProcess.Id
            processStartedAt=$NuvexTunnelProcess.StartTime.ToUniversalTime().ToString('o')
            executable=$NuvexTunnelExecutable; binarySha256=$NuvexTunnelExpectedHash
            metrics=$NuvexTunnelMetrics; tokenFile=$NuvexTunnelTokenFile; tunnelId=$NuvexTunnelIdText
            log=$NuvexTunnelLog; stdoutLog=$NuvexTunnelOutput; stderrLog=$NuvexTunnelError
            ready=$false; lastCheckedAt=[DateTime]::UtcNow.ToString('o'); diagnostic='Pendiente de confirmar conexión con Cloudflare.'
        }
        Write-TunnelState $NuvexTunnelState
        [IO.File]::WriteAllText($NuvexTunnelPidFile, [string]$NuvexTunnelProcess.Id, [Text.UTF8Encoding]::new($false))
    }

    $NuvexTunnelReady = $false
    $NuvexTunnelDiagnostic = 'El túnel no confirmó conexión dentro del tiempo previsto. Se conserva el proceso y sus registros privados.'
    $NuvexTunnelWatch = [Diagnostics.Stopwatch]::StartNew()
    while ($NuvexTunnelWatch.Elapsed.TotalSeconds -lt $ReadyTimeoutSeconds) {
        $NuvexTunnelProcess.Refresh()
        if ($NuvexTunnelProcess.HasExited) { $NuvexTunnelDiagnostic = 'El conector terminó antes de confirmar disponibilidad. Sus registros privados y PID se conservan.'; break }
        $NuvexTunnelListeners = @(Get-TunnelListeners)
        if (@($NuvexTunnelListeners | Where-Object { $_.OwningProcess -ne $NuvexTunnelProcess.Id -or $_.LocalAddress -ne '127.0.0.1' }).Count) {
            $NuvexTunnelDiagnostic = 'El puerto de métricas no pertenece al proceso esperado. No se consulta ese destino ni se detiene ningún proceso.'
            break
        }
        if ($NuvexTunnelListeners.Count) {
            try {
                $NuvexTunnelHealth = Invoke-WebRequest -Uri $NuvexTunnelReadyUrl -UseBasicParsing -NoProxy -MaximumRedirection 0 -TimeoutSec 2
                if ($NuvexTunnelHealth.StatusCode -eq 200) { $NuvexTunnelReady = $true; $NuvexTunnelDiagnostic = 'Cloudflare ha confirmado conexiones activas del túnel.'; break }
            } catch { }
        }
        Start-Sleep -Milliseconds 250
    }
    $NuvexTunnelWatch.Stop()
    $NuvexTunnelState.ready = $NuvexTunnelReady
    $NuvexTunnelState.lastCheckedAt = [DateTime]::UtcNow.ToString('o')
    $NuvexTunnelState.diagnostic = $NuvexTunnelDiagnostic
    Write-TunnelState $NuvexTunnelState
    [ordered]@{
        started=$NuvexTunnelStarted; reused=(-not $NuvexTunnelStarted); pid=$NuvexTunnelProcess.Id
        ready=$NuvexTunnelReady; metrics=$NuvexTunnelMetrics; diagnostic=$NuvexTunnelDiagnostic
        stateFile=$NuvexTunnelStateFile; logsPrivate=$true
    } | ConvertTo-Json
    if (-not $NuvexTunnelReady) { exit 1 }
} finally {
    if ($NuvexTunnelLock) { $NuvexTunnelLock.Dispose() }
}
