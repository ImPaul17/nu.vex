param([Parameter(ValueFromRemainingArguments = $true)][string[]]$DockerArgs)
$NuvexDockerScript = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'wsl-docker.sh'))
$NuvexDockerLinuxScript = (& wsl.exe -d Ubuntu --exec wslpath -a -u $NuvexDockerScript).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Could not resolve the project helper inside existing WSL Ubuntu.' }
& wsl.exe -d Ubuntu -u root --exec sh $NuvexDockerLinuxScript @DockerArgs
if ($LASTEXITCODE -ne 0) { throw "Private WSL Docker command failed (exit $LASTEXITCODE)." }
