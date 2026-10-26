#Requires -Version 7.0
# Genera una copia nueva y metadatos sin mostrar credenciales ni contenido de cuentas.
[CmdletBinding()]
param()
. (Join-Path $PSScriptRoot 'central-common.ps1')
Protect-CentralDirectory
$NuvexConnection = Get-CentralConnection
Start-CentralPostgres -Connection $NuvexConnection
$NuvexBackupDirectory = Join-Path $NuvexCentralRoot 'backups'
[void](Assert-CentralPath $NuvexBackupDirectory)
if (-not (Test-Path -LiteralPath $NuvexBackupDirectory)) { [void](New-Item -ItemType Directory -Path $NuvexBackupDirectory) }
$NuvexBackupId = [DateTime]::UtcNow.ToString('yyyyMMddTHHmmss') + '-' + [Guid]::NewGuid().ToString('N').Substring(0,12)
$NuvexArchive = Join-Path $NuvexBackupDirectory "nuvexcentral-$NuvexBackupId.dump"
$NuvexMetadataPath = "$NuvexArchive.json"
if ((Test-Path -LiteralPath $NuvexArchive) -or (Test-Path -LiteralPath $NuvexMetadataPath)) { throw 'El destino de copia ya existe y se conserva.' }
$NuvexBefore = Get-CentralSummary -Connection $NuvexConnection
Invoke-CentralEnvironment @{ PGPASSWORD=$NuvexConnection.appPassword; PGCONNECT_TIMEOUT='5'; PGAPPNAME='nuvex-central-backup' } {
    $NuvexDumpOutput = @(& (Join-Path $NuvexCentralBin 'pg_dump.exe') -h 127.0.0.1 -p 55433 -U nuvex_app -d nuvexcentral --format=custom --no-owner --no-privileges --file $NuvexArchive 2>&1)
    if ($LASTEXITCODE -ne 0) { throw 'Falló la copia PostgreSQL. El archivo incompleto se conserva; no debe restaurarse sin metadatos válidos.' }
}
$NuvexAfter = Get-CentralSummary -Connection $NuvexConnection
$NuvexSourceQuiet = Compare-CentralSummary -Expected $NuvexBefore -Actual $NuvexAfter
$NuvexMetadata = [ordered]@{
    schemaVersion=1; purpose='nuvex-central-backup'; createdAt=[DateTime]::UtcNow.ToString('o')
    database='nuvexcentral'; archive=$NuvexArchive; size=(Get-Item -LiteralPath $NuvexArchive).Length
    sha256=(Get-FileHash -LiteralPath $NuvexArchive -Algorithm SHA256).Hash.ToLowerInvariant()
    sourceQuiet=$NuvexSourceQuiet; sourceSummary=$NuvexBefore
}
[IO.File]::WriteAllText($NuvexMetadataPath, ($NuvexMetadata | ConvertTo-Json -Depth 6), [Text.UTF8Encoding]::new($false))
[ordered]@{ created=$true; archive=$NuvexArchive; metadata=$NuvexMetadataPath; bytes=$NuvexMetadata.size; sourceQuiet=$NuvexSourceQuiet; accounts=$NuvexBefore.counts.users; messages=$NuvexBefore.counts.messages } | ConvertTo-Json
