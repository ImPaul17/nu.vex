# WinLibs GCC 16.2.0's conditional manifest specs lose quoting in paths with spaces.
# Retain the same manifest object through GCC's standard %s path handling.
$ErrorActionPreference = 'Stop'
$NuvexSpecsRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..'))
$NuvexSpecsGcc = Join-Path $NuvexSpecsRoot '.cache/toolchains/winlibs/mingw64/bin/gcc.exe'
$NuvexSpecsText = (& $NuvexSpecsGcc -dumpspecs) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the project-local GCC specs.' }
$NuvexSpecsText = $NuvexSpecsText.Replace('%:if-exists(default-manifest.o%s)', 'default-manifest.o%s')
$NuvexSpecsDestination = Join-Path $NuvexSpecsRoot '.cache/toolchains/winlibs/mingw64/lib/gcc/x86_64-w64-mingw32/16.2.0/specs'
[IO.File]::WriteAllText($NuvexSpecsDestination, $NuvexSpecsText)
Write-Output 'Project-local WinLibs manifest path handling configured.'
