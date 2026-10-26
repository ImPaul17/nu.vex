#Requires -Version 7.0
# Funciones internas de la instancia local de servicio. Nunca escribe secretos en la salida.
$ErrorActionPreference = 'Stop'
$NuvexCentralWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$NuvexCentralRoot = [IO.Path]::GetFullPath((Join-Path $NuvexCentralWorkspace '.cache/central-instance'))
$NuvexCentralData = Join-Path $NuvexCentralRoot 'data'
$NuvexCentralBin = Join-Path $NuvexCentralWorkspace '.cache/toolchains/postgresql/pgsql/bin'
$NuvexCentralConnectionFile = Join-Path $NuvexCentralRoot 'connection.json'
$NuvexCentralServer = Join-Path $NuvexCentralWorkspace '.cache/ui-server/debug/nuvex-server.exe'

function Assert-CentralPath {
    param([Parameter(Mandatory)][string]$Path)
    $NuvexResolved = [IO.Path]::GetFullPath($Path)
    $NuvexPrefix = $NuvexCentralRoot + [IO.Path]::DirectorySeparatorChar
    if ($NuvexResolved -ne $NuvexCentralRoot -and -not $NuvexResolved.StartsWith($NuvexPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'La ruta no pertenece al directorio de la instancia central.'
    }
    $NuvexCursor = $NuvexResolved
    while ($NuvexCursor -and $NuvexCursor.Length -ge $NuvexCentralRoot.Length) {
        if (Test-Path -LiteralPath $NuvexCursor) {
            $NuvexItem = Get-Item -LiteralPath $NuvexCursor -Force
            if ($NuvexItem.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'No se admiten enlaces en los datos de servicio.' }
        }
        if ($NuvexCursor -eq $NuvexCentralRoot) { break }
        $NuvexCursor = Split-Path $NuvexCursor -Parent
    }
    return $NuvexResolved
}

function Protect-CentralDirectory {
    [void](Assert-CentralPath $NuvexCentralRoot)
    if (-not (Test-Path -LiteralPath $NuvexCentralRoot)) { [void](New-Item -ItemType Directory -Path $NuvexCentralRoot) }
    $NuvexSid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $NuvexAcl = Get-Acl -LiteralPath $NuvexCentralRoot
    if ($NuvexAcl.GetOwner([Security.Principal.SecurityIdentifier]).Value -ne $NuvexSid.Value) {
        throw 'El directorio privado pertenece a otra identidad; no se cambia su propietario.'
    }
    $NuvexUnexpectedExplicit = @($NuvexAcl.Access | Where-Object {
        -not $_.IsInherited -and $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $NuvexSid.Value
    })
    if ($NuvexUnexpectedExplicit.Count) { throw 'El directorio contiene permisos explícitos ajenos; se conserva sin guardar secretos nuevos.' }
    # icacls modifica únicamente la DACL, sin solicitar privilegios de auditoría SACL.
    $NuvexAclOutput = @(& (Join-Path $env:SystemRoot 'System32/icacls.exe') $NuvexCentralRoot '/inheritance:r' '/grant:r' ('*' + $NuvexSid.Value + ':(OI)(CI)F') 2>&1)
    if ($LASTEXITCODE -ne 0) { throw 'No se pudo proteger el directorio privado con la identidad actual.' }
    $NuvexVerifiedAcl = Get-Acl -LiteralPath $NuvexCentralRoot
    $NuvexOtherRules = @($NuvexVerifiedAcl.Access | Where-Object {
        $_.IsInherited -or $_.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value -ne $NuvexSid.Value
    })
    if (-not $NuvexVerifiedAcl.AreAccessRulesProtected -or $NuvexOtherRules.Count) { throw 'La ACL privada no cumple el aislamiento esperado.' }
}

function Get-CentralConnection {
    if (-not (Test-Path -LiteralPath $NuvexCentralConnectionFile -PathType Leaf)) {
        throw 'Falta la configuración privada. Ejecuta scripts/instance/init-central.ps1.'
    }
    [void](Assert-CentralPath $NuvexCentralConnectionFile)
    $NuvexConnection = Get-Content -LiteralPath $NuvexCentralConnectionFile -Raw | ConvertFrom-Json
    if ($NuvexConnection.schemaVersion -ne 1 -or $NuvexConnection.purpose -ne 'nuvex-central-service' -or
        $NuvexConnection.host -ne '127.0.0.1' -or $NuvexConnection.port -ne 55433 -or
        $NuvexConnection.database -ne 'nuvexcentral' -or $NuvexConnection.user -ne 'nuvex_app' -or
        $NuvexConnection.adminUser -ne 'nuvex_admin' -or
        $NuvexConnection.appPassword -notmatch '^[a-f0-9]{64}$' -or
        $NuvexConnection.adminPassword -notmatch '^[a-f0-9]{64}$' -or
        $NuvexConnection.appPassword -eq $NuvexConnection.adminPassword -or
        [IO.Path]::GetFullPath($NuvexConnection.dataDirectory) -ne $NuvexCentralData) {
        throw 'La configuración de servicio no coincide con el clúster dedicado esperado.'
    }
    $NuvexExpectedUrl = 'postgresql://nuvex_app:' + $NuvexConnection.appPassword + '@127.0.0.1:55433/nuvexcentral'
    if ($NuvexConnection.databaseUrl -ne $NuvexExpectedUrl) { throw 'La conexión de servicio no es válida.' }
    return $NuvexConnection
}

function Invoke-CentralEnvironment {
    param([Parameter(Mandatory)][hashtable]$Variables, [Parameter(Mandatory)][scriptblock]$Action)
    $NuvexPreviousEnvironment = @{}
    foreach ($NuvexKey in $Variables.Keys) {
        $NuvexPreviousEnvironment[$NuvexKey] = [Environment]::GetEnvironmentVariable($NuvexKey, 'Process')
        [Environment]::SetEnvironmentVariable($NuvexKey, [string]$Variables[$NuvexKey], 'Process')
    }
    try { & $Action }
    finally {
        foreach ($NuvexKey in $Variables.Keys) {
            [Environment]::SetEnvironmentVariable($NuvexKey, $NuvexPreviousEnvironment[$NuvexKey], 'Process')
        }
    }
}

function Invoke-CentralSql {
    param([Parameter(Mandatory)]$Connection, [Parameter(Mandatory)][string]$Sql,
          [string]$Database = 'nuvexcentral', [switch]$Admin)
    if ($Database -notmatch '^(postgres|nuvexcentral|nuvexcentral_restore_[a-z0-9_]+)$') { throw 'Destino PostgreSQL no autorizado.' }
    $NuvexSqlUser = if ($Admin) { $Connection.adminUser } else { $Connection.user }
    $NuvexSqlPassword = if ($Admin) { $Connection.adminPassword } else { $Connection.appPassword }
    Invoke-CentralEnvironment @{ PGPASSWORD=$NuvexSqlPassword; PGCONNECT_TIMEOUT='5'; PGAPPNAME='nuvex-central-operations' } {
        $NuvexSqlArguments = @('-X','-q','-A','-t','-v','ON_ERROR_STOP=1','-h','127.0.0.1','-p','55433','-U',$NuvexSqlUser,'-d',$Database,'-f','-')
        $NuvexSqlOutput = @($Sql | & (Join-Path $NuvexCentralBin 'psql.exe') @NuvexSqlArguments 2>&1)
        if ($LASTEXITCODE -ne 0) { throw 'La operación PostgreSQL ha fallado. No se muestra su salida para proteger las credenciales.' }
        return ($NuvexSqlOutput -join "`n").Trim()
    }
}

function Start-CentralPostgres {
    param([Parameter(Mandatory)]$Connection)
    [void](Assert-CentralPath $NuvexCentralData)
    $NuvexPgCtl = Join-Path $NuvexCentralBin 'pg_ctl.exe'
    $NuvexStatusOutput = @(& $NuvexPgCtl -D $NuvexCentralData status 2>&1)
    $NuvexOwnClusterRunning = $LASTEXITCODE -eq 0
    $NuvexListeners = @(Get-NetTCPConnection -LocalPort 55433 -State Listen -ErrorAction SilentlyContinue)
    if (-not $NuvexOwnClusterRunning) {
        if ($NuvexListeners.Count) { throw 'El puerto 55433 está ocupado por otro proceso; no se ha detenido ni sustituido.' }
        # pg_ctl lanza un descendiente persistente. Redirigir fuera de los pipes de
        # PowerShell evita que una captura de salida espere hasta apagar PostgreSQL.
        $NuvexStartArguments = @('-D', ('"' + $NuvexCentralData + '"'), '-l', ('"' + (Join-Path $NuvexCentralRoot 'postgres.log') + '"'), '-o', '"-h 127.0.0.1 -p 55433"', '-w', 'start')
        $NuvexStart = Start-Process -FilePath $NuvexPgCtl -ArgumentList $NuvexStartArguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $NuvexCentralRoot 'pg_ctl-start.stdout.log') -RedirectStandardError (Join-Path $NuvexCentralRoot 'pg_ctl-start.stderr.log')
        # Start-Process -Wait espera también descendientes (el servidor permanente).
        # WaitForExit espera solo a pg_ctl, que confirma el arranque con -w.
        if (-not $NuvexStart.WaitForExit(30000)) { throw 'pg_ctl no confirmó el arranque en 30 segundos; se conserva el estado para diagnóstico.' }
        $NuvexStart.Refresh()
        if ($NuvexStart.ExitCode -ne 0) { throw 'No se pudo iniciar el clúster central. Consulta su registro privado.' }
    }
    $NuvexPostmasterFile = Join-Path $NuvexCentralData 'postmaster.pid'
    [void](Assert-CentralPath $NuvexPostmasterFile)
    $NuvexPostgresPid = 0
    if (-not (Test-Path -LiteralPath $NuvexPostmasterFile) -or
        -not [int]::TryParse((Get-Content -LiteralPath $NuvexPostmasterFile -TotalCount 1), [ref]$NuvexPostgresPid)) {
        throw 'No se puede identificar el proceso del clúster central.'
    }
    $NuvexExpectedProcess = Get-Process -Id $NuvexPostgresPid -ErrorAction SilentlyContinue
    $NuvexListeners = @(Get-NetTCPConnection -LocalPort 55433 -State Listen -ErrorAction SilentlyContinue)
    if (-not $NuvexExpectedProcess -or $NuvexExpectedProcess.Path -ne (Join-Path $NuvexCentralBin 'postgres.exe') -or
        -not $NuvexListeners.Count -or
        @($NuvexListeners | Where-Object { $_.OwningProcess -ne $NuvexPostgresPid -or $_.LocalAddress -ne '127.0.0.1' }).Count) {
        throw 'El puerto 55433 no pertenece al proceso local esperado; no se envían credenciales ni se modifica ese destino.'
    }
    $NuvexActualDirectory = Invoke-CentralSql -Connection $Connection -Admin -Database postgres -Sql 'SHOW data_directory;'
    if ([IO.Path]::GetFullPath($NuvexActualDirectory) -ne $NuvexCentralData) {
        throw 'El puerto 55433 responde desde otro clúster; no se modifica ese destino.'
    }
    $NuvexActualAddress = Invoke-CentralSql -Connection $Connection -Admin -Database postgres -Sql 'SHOW listen_addresses;'
    if ($NuvexActualAddress -ne '127.0.0.1') { throw 'PostgreSQL de servicio debe escuchar únicamente en 127.0.0.1.' }
}

function Get-CentralSummary {
    param([Parameter(Mandatory)]$Connection, [string]$Database = 'nuvexcentral')
    $NuvexSummarySql = @'
SELECT json_build_object(
 'tables', (SELECT json_agg(t.table_name ORDER BY t.table_name) FROM information_schema.tables t WHERE t.table_schema='public' AND t.table_type='BASE TABLE'),
 'schemaFingerprint', (SELECT md5(coalesce(string_agg(c.table_name||'.'||c.column_name||':'||c.data_type||':'||c.is_nullable||':'||coalesce(c.column_default,''),'|' ORDER BY c.table_name,c.ordinal_position),'')) FROM information_schema.columns c WHERE c.table_schema='public'),
 'counts', json_build_object('users',(SELECT count(*) FROM users),'sessions',(SELECT count(*) FROM sessions),'communities',(SELECT count(*) FROM communities),'community_members',(SELECT count(*) FROM community_members),'channels',(SELECT count(*) FROM channels),'invites',(SELECT count(*) FROM invites),'messages',(SELECT count(*) FROM messages)),
 'migrations', (SELECT count(*) FROM _sqlx_migrations WHERE success)
);
'@
    $NuvexSummary = Invoke-CentralSql -Connection $Connection -Database $Database -Sql $NuvexSummarySql | ConvertFrom-Json
    $NuvexExpectedTables = @('_sqlx_migrations','channels','communities','community_members','invites','messages','sessions','users')
    if (($NuvexSummary.tables -join '|') -ne ($NuvexExpectedTables -join '|') -or $NuvexSummary.migrations -lt 1) {
        throw 'El esquema no coincide con la instancia nu.vex esperada.'
    }
    return $NuvexSummary
}

function Compare-CentralSummary {
    param([Parameter(Mandatory)]$Expected, [Parameter(Mandatory)]$Actual)
    if ($Expected.schemaFingerprint -ne $Actual.schemaFingerprint -or $Expected.migrations -ne $Actual.migrations -or
        ($Expected.tables -join '|') -ne ($Actual.tables -join '|')) { return $false }
    foreach ($NuvexTable in @('users','sessions','communities','community_members','channels','invites','messages')) {
        if ($Expected.counts.$NuvexTable -ne $Actual.counts.$NuvexTable) { return $false }
    }
    return $true
}
