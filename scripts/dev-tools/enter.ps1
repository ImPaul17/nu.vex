# Dot-source this file: . ./scripts/dev-tools/enter.ps1
$NuvexToolRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$env:CARGO_HOME = Join-Path $NuvexToolRoot '.cache/toolchains/cargo'
$env:RUSTUP_HOME = Join-Path $NuvexToolRoot '.cache/toolchains/rustup'
$NuvexGccBin = Join-Path $NuvexToolRoot '.cache/toolchains/winlibs/mingw64/bin'
$NuvexPgBin = Join-Path $NuvexToolRoot '.cache/toolchains/postgresql/pgsql/bin'
$NuvexPathEntries = @((Join-Path $env:CARGO_HOME 'bin'), $NuvexGccBin, $NuvexPgBin)
foreach ($NuvexPathEntry in $NuvexPathEntries) {
    if (-not (Test-Path -LiteralPath $NuvexPathEntry -PathType Container)) {
        throw "Local toolchain not prepared: $NuvexPathEntry. See docs/toolchain-local.md."
    }
}
$env:PATH = (($NuvexPathEntries + ($env:PATH -split ';')) | Select-Object -Unique) -join ';'
$env:CARGO_TARGET_X86_64_PC_WINDOWS_GNU_LINKER = Join-Path $NuvexGccBin 'gcc.exe'
$env:CC_x86_64_pc_windows_gnu = Join-Path $NuvexGccBin 'gcc.exe'
$env:AR_x86_64_pc_windows_gnu = Join-Path $NuvexGccBin 'ar.exe'
$NuvexPgConnectionFile = Join-Path $NuvexToolRoot '.cache/postgres/connection.json'
if (Test-Path -LiteralPath $NuvexPgConnectionFile -PathType Leaf) {
    $NuvexPgConnection = Get-Content -Raw -LiteralPath $NuvexPgConnectionFile | ConvertFrom-Json
    $env:NUVEX_DATABASE_URL = $NuvexPgConnection.databaseUrl
}
