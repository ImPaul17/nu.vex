param([ValidateSet('start', 'stop', 'status')][string]$Action = 'status')
$ErrorActionPreference = 'Stop'
$NuvexPgRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$NuvexPgData = Join-Path $NuvexPgRoot '.cache/postgres/data'
$NuvexPgCtl = Join-Path $NuvexPgRoot '.cache/toolchains/postgresql/pgsql/bin/pg_ctl.exe'
if (-not (Test-Path -LiteralPath (Join-Path $NuvexPgData 'PG_VERSION'))) {
    throw 'The project-local PostgreSQL cluster has not been initialized. See docs/toolchain-local.md.'
}
switch ($Action) {
    'start' {
        & $NuvexPgCtl -D $NuvexPgData status *> $null
        if ($LASTEXITCODE -ne 0) {
            & $NuvexPgCtl -D $NuvexPgData -l (Join-Path $NuvexPgRoot '.cache/postgres/server.log') -o '-h 127.0.0.1 -p 55432' -w start
        }
    }
    'stop' { & $NuvexPgCtl -D $NuvexPgData -m fast -w stop }
    'status' { & $NuvexPgCtl -D $NuvexPgData status }
}
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL $Action failed (exit $LASTEXITCODE)." }
