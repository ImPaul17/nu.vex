# Initializes only the dedicated, ignored development cluster. Never use for production.
$ErrorActionPreference = 'Stop'
$NuvexInitRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$NuvexInitBase = Join-Path $NuvexInitRoot '.cache/postgres'
$NuvexInitData = Join-Path $NuvexInitBase 'data'
$NuvexInitBin = Join-Path $NuvexInitRoot '.cache/toolchains/postgresql/pgsql/bin'
if (Test-Path -LiteralPath (Join-Path $NuvexInitData 'PG_VERSION')) {
    throw 'A project cluster already exists. Use postgres.ps1 start; initialization never replaces data.'
}
if (Get-NetTCPConnection -LocalPort 55432 -State Listen -ErrorAction SilentlyContinue) {
    throw 'Port 55432 is occupied. No existing process was modified.'
}
if (-not (Test-Path -LiteralPath (Join-Path $NuvexInitBin 'initdb.exe'))) {
    throw 'Portable PostgreSQL is missing. See docs/toolchain-local.md.'
}
New-Item -ItemType Directory -Force -Path $NuvexInitBase | Out-Null
$NuvexInitIdentity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$NuvexInitAcl = Get-Acl -LiteralPath $NuvexInitBase
$NuvexInitAcl.SetAccessRuleProtection($true, $false)
$NuvexInitAcl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $NuvexInitIdentity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
Set-Acl -LiteralPath $NuvexInitBase -AclObject $NuvexInitAcl
$NuvexInitAdminSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$NuvexInitAppSecret = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
$NuvexInitPasswordFile = Join-Path $NuvexInitBase 'init-password.txt'
[IO.File]::WriteAllText($NuvexInitPasswordFile, $NuvexInitAdminSecret)
$NuvexInitConnection = @{
    developmentOnly = $true
    host = '127.0.0.1'
    port = 55432
    database = 'nuvex'
    user = 'nuvex'
    databaseUrl = "postgresql://nuvex:${NuvexInitAppSecret}@127.0.0.1:55432/nuvex"
    adminPassword = $NuvexInitAdminSecret
}
$NuvexInitConnection | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $NuvexInitBase 'connection.json') -Encoding utf8
& (Join-Path $NuvexInitBin 'initdb.exe') -D $NuvexInitData -U nuvex_admin --pwfile $NuvexInitPasswordFile --auth=scram-sha-256 --encoding=UTF8 --locale=C --no-instructions
if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL initdb failed.' }
Remove-Item -LiteralPath $NuvexInitPasswordFile
@"
listen_addresses = '127.0.0.1'
port = 55432
password_encryption = 'scram-sha-256'
max_connections = 30
timezone = 'UTC'
log_timezone = 'UTC'
"@ | Add-Content -LiteralPath (Join-Path $NuvexInitData 'postgresql.conf')
& (Join-Path $PSScriptRoot 'postgres.ps1') start
$env:PGPASSWORD = $NuvexInitAdminSecret
try {
    @"
CREATE ROLE nuvex WITH LOGIN PASSWORD '$NuvexInitAppSecret' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
CREATE DATABASE nuvex OWNER nuvex;
"@ | & (Join-Path $NuvexInitBin 'psql.exe') -X -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U nuvex_admin -d postgres -f -
    if ($LASTEXITCODE -ne 0) { throw 'Development role/database creation failed.' }
} finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
}
Write-Output 'Project PostgreSQL initialized on 127.0.0.1:55432; credentials are in ignored .cache/postgres/connection.json.'
