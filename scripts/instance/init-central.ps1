#Requires -Version 7.0
# Crea/reutiliza únicamente el clúster independiente de servicio. No inicia la API.
[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'central-common.ps1')
Protect-CentralDirectory
$NuvexInitializationLockPath = Assert-CentralPath (Join-Path $NuvexCentralRoot 'initialize.lock')
try { $NuvexInitializationLock = [IO.FileStream]::new($NuvexInitializationLockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
catch { throw 'Otra inicialización de la instancia central está en curso. Se conserva el estado existente.' }
try {
foreach ($NuvexRequired in @('initdb.exe','pg_ctl.exe','psql.exe')) {
    if (-not (Test-Path -LiteralPath (Join-Path $NuvexCentralBin $NuvexRequired) -PathType Leaf)) { throw 'Falta PostgreSQL portable del proyecto.' }
}
if (-not (Test-Path -LiteralPath $NuvexCentralServer -PathType Leaf)) { throw 'Falta el binario actual del servidor para aplicar migraciones.' }

$NuvexNewCluster = -not (Test-Path -LiteralPath (Join-Path $NuvexCentralData 'PG_VERSION'))
if ($NuvexNewCluster) {
    if (Test-Path -LiteralPath $NuvexCentralData) {
        if (@(Get-ChildItem -LiteralPath $NuvexCentralData -Force).Count) { throw 'Existe un directorio de datos incompleto. Se conserva sin reemplazarlo.' }
    }
    if (Test-Path -LiteralPath $NuvexCentralConnectionFile) { throw 'Existe configuración de una inicialización incompleta. Se conserva para recuperación manual.' }
    if (@(Get-NetTCPConnection -LocalPort 55433 -State Listen -ErrorAction SilentlyContinue).Count) { throw 'El puerto 55433 está ocupado; no se ha inicializado ningún clúster.' }
    $NuvexAdminPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $NuvexAppPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $NuvexConfiguration = [ordered]@{
        schemaVersion=1; purpose='nuvex-central-service'; createdAt=[DateTime]::UtcNow.ToString('o')
        host='127.0.0.1'; port=55433; database='nuvexcentral'; user='nuvex_app'; adminUser='nuvex_admin'
        dataDirectory=$NuvexCentralData; appPassword=$NuvexAppPassword; adminPassword=$NuvexAdminPassword
        databaseUrl=('postgresql://nuvex_app:' + $NuvexAppPassword + '@127.0.0.1:55433/nuvexcentral')
    }
    $NuvexPasswordFile = Join-Path $NuvexCentralRoot 'init-password.txt'
    [IO.File]::WriteAllText($NuvexCentralConnectionFile, ($NuvexConfiguration | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
    [IO.File]::WriteAllText($NuvexPasswordFile, $NuvexAdminPassword, [Text.UTF8Encoding]::new($false))
    try {
        $NuvexInitOutput = @(& (Join-Path $NuvexCentralBin 'initdb.exe') -D $NuvexCentralData -U nuvex_admin --pwfile $NuvexPasswordFile --auth=scram-sha-256 --encoding=UTF8 --locale=C --no-instructions 2>&1)
        if ($LASTEXITCODE -ne 0) { throw 'Falló initdb. Los archivos quedan intactos para diagnosticar la inicialización.' }
    } finally {
        [void](Assert-CentralPath $NuvexPasswordFile)
        if (Test-Path -LiteralPath $NuvexPasswordFile) { Remove-Item -LiteralPath $NuvexPasswordFile }
    }
    @'

# Configuración nu.vex de servicio: no usar para pruebas automatizadas.
listen_addresses = '127.0.0.1'
port = 55433
password_encryption = 'scram-sha-256'
max_connections = 40
timezone = 'UTC'
log_timezone = 'UTC'
log_statement = 'none'
log_min_error_statement = 'panic'
'@ | Add-Content -LiteralPath (Join-Path $NuvexCentralData 'postgresql.conf') -Encoding utf8
}

$NuvexConnection = Get-CentralConnection
Start-CentralPostgres -Connection $NuvexConnection
$NuvexExistingRole = Invoke-CentralSql -Connection $NuvexConnection -Admin -Database postgres -Sql "SELECT rolname FROM pg_roles WHERE rolname='nuvex_app';"
if (-not $NuvexExistingRole) {
    $NuvexCreateRoleSql = "CREATE ROLE nuvex_app WITH LOGIN PASSWORD '" + $NuvexConnection.appPassword + "' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;"
    [void](Invoke-CentralSql -Connection $NuvexConnection -Admin -Database postgres -Sql $NuvexCreateRoleSql)
}
$NuvexRoleSafe = Invoke-CentralSql -Connection $NuvexConnection -Admin -Database postgres -Sql "SELECT (rolcanlogin AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication)::text FROM pg_roles WHERE rolname='nuvex_app';"
if ($NuvexRoleSafe -ne 'true') { throw 'El rol de aplicación no conserva los permisos mínimos esperados.' }
$NuvexExistingDatabase = Invoke-CentralSql -Connection $NuvexConnection -Admin -Database postgres -Sql "SELECT datname FROM pg_database WHERE datname='nuvexcentral';"
if (-not $NuvexExistingDatabase) { [void](Invoke-CentralSql -Connection $NuvexConnection -Admin -Database postgres -Sql 'CREATE DATABASE nuvexcentral OWNER nuvex_app;') }
$NuvexOwner = Invoke-CentralSql -Connection $NuvexConnection -Admin -Database postgres -Sql "SELECT pg_get_userbyid(datdba) FROM pg_database WHERE datname='nuvexcentral';"
if ($NuvexOwner -ne 'nuvex_app') { throw 'La base existente pertenece a otro rol; no se modifica.' }

Invoke-CentralEnvironment @{ NUVEX_DATABASE_URL=$NuvexConnection.databaseUrl; NUVEX_ALLOWED_ORIGIN='https://localhost'; NUVEX_INSECURE_DEV='false'; NUVEX_REGISTRATION_OPEN='false'; NUVEX_MIGRATE_ON_START='false' } {
    $NuvexMigrationOutput = @(& $NuvexCentralServer --migrate 2>&1)
    if ($LASTEXITCODE -ne 0) { throw 'Fallaron las migraciones; no se muestra la salida para proteger la conexión.' }
}
$NuvexSummary = Get-CentralSummary -Connection $NuvexConnection
[ordered]@{ initialized=$true; reused=(-not $NuvexNewCluster); host='127.0.0.1'; port=55433; database='nuvexcentral'; applicationRole='nuvex_app'; migrations=$NuvexSummary.migrations; accounts=$NuvexSummary.counts.users; messages=$NuvexSummary.counts.messages; apiStarted=$false } | ConvertTo-Json
} finally { $NuvexInitializationLock.Dispose() }
