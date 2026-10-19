# Dumps the local development instance and restores into a newly named database.
# The source database and every pre-existing database are left untouched.
$ErrorActionPreference = 'Stop'
$NuvexBackupRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$NuvexBackupConfig = Get-Content -Raw -LiteralPath (Join-Path $NuvexBackupRoot '.cache/postgres/connection.json') | ConvertFrom-Json
if ($NuvexBackupConfig.host -ne '127.0.0.1' -or $NuvexBackupConfig.port -ne 55432 -or $NuvexBackupConfig.database -ne 'nuvex' -or -not $NuvexBackupConfig.developmentOnly) {
    throw 'This helper is restricted to the dedicated loopback development instance.'
}
$NuvexBackupBin = Join-Path $NuvexBackupRoot '.cache/toolchains/postgresql/pgsql/bin'
$NuvexBackupRun = [Guid]::NewGuid().ToString('N')
$NuvexBackupDatabase = 'nuvex_restore_' + $NuvexBackupRun.Substring(0, 16)
$NuvexBackupDirectory = Join-Path $NuvexBackupRoot ('.cache/postgres/backups/' + $NuvexBackupRun)
New-Item -ItemType Directory -Force -Path $NuvexBackupDirectory | Out-Null
$NuvexBackupFile = Join-Path $NuvexBackupDirectory 'instance.dump'
$NuvexBackupPreviousPassword = $env:PGPASSWORD
$NuvexBackupApplicationPassword = ([Uri]$NuvexBackupConfig.databaseUrl).UserInfo.Split(':')[1]
$NuvexBackupTables = @('_sqlx_migrations', 'users', 'sessions', 'communities', 'community_members', 'channels', 'invites', 'messages')
$NuvexBackupFingerprintQuery = ($NuvexBackupTables | ForEach-Object {
    "SELECT '$_' AS table_name, count(*)::text AS row_count, coalesce(md5(string_agg(md5(row_to_json(snapshot_row)::text), '' ORDER BY md5(row_to_json(snapshot_row)::text))), md5('')) AS fingerprint FROM public.$_ snapshot_row"
}) -join ' UNION ALL '
function Get-NuvexBackupFingerprint([string]$Database) {
    $NuvexFingerprint = & (Join-Path $NuvexBackupBin 'psql.exe') -X -q -t -A -F '|' -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U nuvex -d $Database -c $NuvexBackupFingerprintQuery
    if ($LASTEXITCODE -ne 0) { throw "Could not fingerprint development database $Database." }
    return @($NuvexFingerprint | Where-Object { $_.Trim().Length -gt 0 } | Sort-Object)
}
try {
    $env:PGPASSWORD = $NuvexBackupApplicationPassword
    $NuvexBackupSourceBefore = Get-NuvexBackupFingerprint 'nuvex'
    & (Join-Path $NuvexBackupBin 'pg_dump.exe') -h 127.0.0.1 -p 55432 -U nuvex -d nuvex --format=custom --no-owner --no-acl --file $NuvexBackupFile
    if ($LASTEXITCODE -ne 0) { throw 'PostgreSQL backup failed.' }

    $env:PGPASSWORD = $NuvexBackupConfig.adminPassword
    "CREATE DATABASE $NuvexBackupDatabase OWNER nuvex;" | & (Join-Path $NuvexBackupBin 'psql.exe') -X -q -v ON_ERROR_STOP=1 -h 127.0.0.1 -p 55432 -U nuvex_admin -d postgres -f -
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the fresh verification database; no existing database was modified.' }

    $env:PGPASSWORD = $NuvexBackupApplicationPassword
    & (Join-Path $NuvexBackupBin 'pg_restore.exe') -h 127.0.0.1 -p 55432 -U nuvex -d $NuvexBackupDatabase --no-owner --no-acl --single-transaction --exit-on-error $NuvexBackupFile
    if ($LASTEXITCODE -ne 0) { throw 'Restore failed. The original database was not modified.' }
    $NuvexBackupRestored = Get-NuvexBackupFingerprint $NuvexBackupDatabase
    $NuvexBackupSourceAfter = Get-NuvexBackupFingerprint 'nuvex'
    if (Compare-Object $NuvexBackupSourceBefore $NuvexBackupSourceAfter) { throw 'The source changed during verification; repeat during a quiet development window.' }
    if (Compare-Object $NuvexBackupSourceBefore $NuvexBackupRestored) { throw 'Source and restored table fingerprints differ.' }

    $NuvexBackupCounts = @{}
    foreach ($NuvexBackupLine in $NuvexBackupRestored) {
        $NuvexBackupParts = $NuvexBackupLine.Split('|')
        $NuvexBackupCounts[$NuvexBackupParts[0]] = [long]$NuvexBackupParts[1]
    }
    $NuvexBackupReport = @{
        ok = $true
        sourceDatabase = 'nuvex'
        restoredDatabase = $NuvexBackupDatabase
        sourceUnchanged = $true
        allTableFingerprintsMatch = $true
        tables = $NuvexBackupCounts
        dumpSha256 = (Get-FileHash -LiteralPath $NuvexBackupFile -Algorithm SHA256).Hash.ToLowerInvariant()
        dumpBytes = (Get-Item -LiteralPath $NuvexBackupFile).Length
    }
    $NuvexBackupReport | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $NuvexBackupDirectory 'result.json') -Encoding utf8
    Write-Output "Backup and isolated restore passed: $($NuvexBackupTables.Count) table fingerprints match; source unchanged."
    Write-Output "Restored development database retained: $NuvexBackupDatabase"
    Write-Output "Private report: $(Join-Path $NuvexBackupDirectory 'result.json')"
    $NuvexBackupCounts | ConvertTo-Json
} finally {
    if ($null -eq $NuvexBackupPreviousPassword) { Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue }
    else { $env:PGPASSWORD = $NuvexBackupPreviousPassword }
}
