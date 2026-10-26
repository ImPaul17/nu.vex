#Requires -Version 7.0
# Solo restaura en un destino NUEVO con prefijo nuvexcentral_restore_. Nunca borra bases.
[CmdletBinding()]
param([Parameter(Mandatory)][string]$Archive)
. (Join-Path $PSScriptRoot 'central-common.ps1')
Protect-CentralDirectory
$NuvexConnection = Get-CentralConnection
Start-CentralPostgres -Connection $NuvexConnection
$NuvexArchive = Assert-CentralPath $Archive
if (-not (Test-Path -LiteralPath $NuvexArchive -PathType Leaf) -or -not (Test-Path -LiteralPath "$NuvexArchive.json" -PathType Leaf)) {
    throw 'Se requieren el archivo de copia y sus metadatos privados.'
}
[void](Assert-CentralPath "$NuvexArchive.json")
$NuvexBackup = Get-Content -LiteralPath "$NuvexArchive.json" -Raw | ConvertFrom-Json
if ($NuvexBackup.schemaVersion -ne 1 -or $NuvexBackup.purpose -ne 'nuvex-central-backup' -or
    $NuvexBackup.database -ne 'nuvexcentral' -or $NuvexBackup.archive -ne $NuvexArchive -or
    (Get-Item -LiteralPath $NuvexArchive).Length -ne $NuvexBackup.size -or
    (Get-FileHash -LiteralPath $NuvexArchive -Algorithm SHA256).Hash.ToLowerInvariant() -ne $NuvexBackup.sha256) {
    throw 'La integridad o procedencia de la copia no coincide; no se crea ni modifica ninguna base.'
}
if (-not $NuvexBackup.sourceQuiet) { throw 'La base cambió durante la copia. Repite la comprobación de restauración en un periodo sin escrituras.' }
$NuvexRestoreDatabase = 'nuvexcentral_restore_' + [DateTime]::UtcNow.ToString('yyyyMMdd') + '_' + [Guid]::NewGuid().ToString('N').Substring(0,12)
if ($NuvexRestoreDatabase -notmatch '^nuvexcentral_restore_[a-z0-9_]+$' -or $NuvexRestoreDatabase.Length -gt 63) { throw 'Nombre de restauración no válido.' }
$NuvexCollision = Invoke-CentralSql -Connection $NuvexConnection -Admin -Database postgres -Sql "SELECT datname FROM pg_database WHERE datname='$NuvexRestoreDatabase';"
if ($NuvexCollision) { throw 'El destino de restauración ya existe; no se modifica.' }
[void](Invoke-CentralSql -Connection $NuvexConnection -Admin -Database postgres -Sql "CREATE DATABASE $NuvexRestoreDatabase OWNER nuvex_app;")
Invoke-CentralEnvironment @{ PGPASSWORD=$NuvexConnection.adminPassword; PGCONNECT_TIMEOUT='5'; PGAPPNAME='nuvex-central-restore-test' } {
    $NuvexRestoreOutput = @(& (Join-Path $NuvexCentralBin 'pg_restore.exe') -h 127.0.0.1 -p 55433 -U nuvex_admin -d $NuvexRestoreDatabase --exit-on-error --no-owner --no-privileges --role=nuvex_app $NuvexArchive 2>&1)
    if ($LASTEXITCODE -ne 0) { throw "Falló la restauración en $NuvexRestoreDatabase. El destino se conserva para diagnóstico; no se ha tocado nuvexcentral." }
}
$NuvexRestored = Get-CentralSummary -Connection $NuvexConnection -Database $NuvexRestoreDatabase
if (-not (Compare-CentralSummary -Expected $NuvexBackup.sourceSummary -Actual $NuvexRestored)) {
    throw 'El esquema o los recuentos restaurados no coinciden con la copia. El destino separado se conserva para diagnóstico.'
}
$NuvexTestUser = [Guid]::NewGuid().ToString()
$NuvexTestCommunity = [Guid]::NewGuid().ToString()
$NuvexTestChannel = [Guid]::NewGuid().ToString()
$NuvexTestMessage = [Guid]::NewGuid().ToString()
$NuvexTestClient = [Guid]::NewGuid().ToString()
$NuvexTestHandle = 'restore_' + $NuvexTestUser.Replace('-','').Substring(0,12)
$NuvexSyntheticSql = @"
BEGIN;
INSERT INTO users(id,email,handle,display_name,password_hash) VALUES('$NuvexTestUser','restore-check-$NuvexTestUser@example.test','$NuvexTestHandle','Comprobación sintética','restore-only-not-an-authentication-credential');
INSERT INTO communities(id,name,owner_id) VALUES('$NuvexTestCommunity','Comprobación de restauración','$NuvexTestUser');
INSERT INTO community_members(community_id,user_id,role) VALUES('$NuvexTestCommunity','$NuvexTestUser','owner');
INSERT INTO channels(id,community_id,name) VALUES('$NuvexTestChannel','$NuvexTestCommunity','restore-check');
INSERT INTO messages(id,channel_id,author_id,client_id,content) VALUES('$NuvexTestMessage','$NuvexTestChannel','$NuvexTestUser','$NuvexTestClient','Texto sintético de comprobación, revertido al terminar.');
SELECT json_build_object('account',EXISTS(SELECT 1 FROM users WHERE id='$NuvexTestUser'),'message',EXISTS(SELECT 1 FROM messages WHERE id='$NuvexTestMessage'));
ROLLBACK;
"@
$NuvexSynthetic = Invoke-CentralSql -Connection $NuvexConnection -Database $NuvexRestoreDatabase -Sql $NuvexSyntheticSql | ConvertFrom-Json
if (-not $NuvexSynthetic.account -or -not $NuvexSynthetic.message) { throw 'La comprobación sintética de cuenta y mensaje no se completó.' }
$NuvexAfterRollback = Get-CentralSummary -Connection $NuvexConnection -Database $NuvexRestoreDatabase
if (-not (Compare-CentralSummary -Expected $NuvexRestored -Actual $NuvexAfterRollback)) { throw 'La transacción sintética no se revirtió por completo.' }
$NuvexReceipt = [ordered]@{
    schemaVersion=1; purpose='nuvex-central-restore-test'; verifiedAt=[DateTime]::UtcNow.ToString('o')
    sourceDatabase='nuvexcentral'; restoredDatabase=$NuvexRestoreDatabase; archive=$NuvexArchive
    archiveSha256=$NuvexBackup.sha256; schemaAndCountsMatch=$true; syntheticAccountVerified=$true
    syntheticMessageVerified=$true; syntheticTransactionRolledBack=$true
    accounts=$NuvexRestored.counts.users; messages=$NuvexRestored.counts.messages
    destinationRetained=$true; sourceModified=$false
}
$NuvexReceiptFile = Join-Path $NuvexCentralRoot "$NuvexRestoreDatabase.result.json"
[IO.File]::WriteAllText($NuvexReceiptFile, ($NuvexReceipt | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
[ordered]@{ verified=$true; restoredDatabase=$NuvexRestoreDatabase; schemaAndCountsMatch=$true; syntheticAccountVerified=$true; syntheticMessageVerified=$true; rolledBack=$true; accounts=$NuvexRestored.counts.users; messages=$NuvexRestored.counts.messages; receipt=$NuvexReceiptFile; sourceModified=$false } | ConvertTo-Json
