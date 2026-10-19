# Disposable native CI cluster; never installs a service or alters another cluster.
# Sources: https://www.postgresql.org/download/windows/
#          https://www.enterprisedb.com/download-postgresql-binaries
# EDB exposes no detached signature/checksum for this ZIP. This reviewed repository
# digest pins the archive previously acquired over HTTPS; it is not a vendor signature.
[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidateSet('Start', 'Stop')][string]$Action,
    [ValidateRange(1024, 65535)][int]$Port = 55433,
    # Local smoke tests may use an already prepared pgsql directory without a download.
    [string]$ToolchainDirectory = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if (-not $IsWindows -or $PSVersionTable.PSVersion.Major -lt 7) {
    throw 'This helper requires PowerShell 7 on Windows.'
}
if (-not $env:RUNNER_TEMP -or -not [IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP)) {
    throw 'An explicit absolute RUNNER_TEMP directory is required.'
}
$NuvexRunnerTemp = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\', '/')
if ($NuvexRunnerTemp -eq [IO.Path]::GetPathRoot($NuvexRunnerTemp).TrimEnd('\', '/')) {
    throw 'RUNNER_TEMP must not be a drive root.'
}
$NuvexPgBase = Join-Path $NuvexRunnerTemp 'nuvex-postgres-ci'
$NuvexPgData = Join-Path $NuvexPgBase 'data'
$NuvexPgManifest = Join-Path $NuvexPgBase 'cluster.json'
$NuvexPgArchiveHash = '80379b2c04d51c30225532e0ae04509899141e9957ed096fe749d7fd9df8f82f'
$NuvexUtf8 = [Text.UTF8Encoding]::new($false)

function Assert-NuvexPath([string]$Path, [string]$Parent) {
    $full = [IO.Path]::GetFullPath($Path)
    $prefix = [IO.Path]::GetFullPath($Parent).TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $full.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'A CI PostgreSQL path escaped its dedicated parent.'
    }
    # Lexical containment alone does not protect against directory junctions.
    $cursor = $full
    while ($cursor) {
        if (Test-Path -LiteralPath $cursor) {
            if ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw 'CI PostgreSQL paths must not traverse reparse points.'
            }
        }
        $next = [IO.Path]::GetDirectoryName($cursor)
        if ($next -eq $cursor) { break }
        $cursor = $next
    }
    return $full
}
$null = Assert-NuvexPath $NuvexPgBase $NuvexRunnerTemp

function Invoke-NuvexPg([string]$Executable, [string[]]$Arguments, [string]$Log,
                        [string]$InputText = '', [string]$Password = '') {
    if ([IO.Path]::GetFileName($Executable) -eq 'pg_ctl.exe') {
        # pg_ctl's detached Windows server can inherit anonymous output pipes.
        # File handles avoid waiting for EOF from the long-lived daemon.
        if ($InputText -or $Password) { throw 'Cluster control must not receive credentials.' }
        $quoted = ($Arguments | ForEach-Object { '"' + $_.Replace('"', '\"') + '"' }) -join ' '
        $control = Start-Process -FilePath $Executable -ArgumentList $quoted -WindowStyle Hidden -PassThru -RedirectStandardOutput $Log -RedirectStandardError "$Log.stderr"
        try {
            if (-not $control.WaitForExit(90000)) { $control.Kill(); throw 'An owned PostgreSQL control command timed out.' }
            if ($control.ExitCode -ne 0) { throw 'An owned PostgreSQL control command failed; inspect its private runner log.' }
            return ''
        } finally { $control.Dispose() }
    }
    $info = [Diagnostics.ProcessStartInfo]::new($Executable)
    $info.UseShellExecute = $false
    $info.CreateNoWindow = $true
    $info.RedirectStandardOutput = $true
    $info.RedirectStandardError = $true
    $info.RedirectStandardInput = $true
    foreach ($argument in $Arguments) { $info.ArgumentList.Add($argument) }
    # Do not inherit libpq services/options/passwords from a developer's shell.
    foreach ($key in @($info.Environment.Keys)) {
        if ($key.StartsWith('PG', [StringComparison]::OrdinalIgnoreCase)) { $null = $info.Environment.Remove($key) }
    }
    if ($Password) { $info.Environment['PGPASSWORD'] = $Password }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $info
    try {
        $null = $process.Start()
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if ($InputText) { $process.StandardInput.WriteLine($InputText) }
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(120000)) {
            # This is only the process started above, never a process-name search.
            $process.Kill()
            throw 'An owned PostgreSQL command timed out.'
        }
        $output = $stdout.GetAwaiter().GetResult()
        $errors = $stderr.GetAwaiter().GetResult()
        [IO.File]::WriteAllText($Log, $output + $errors, $NuvexUtf8)
        if ($process.ExitCode -ne 0) {
            throw 'An owned PostgreSQL command failed; inspect its private runner log.'
        }
        return $output.Trim()
    } finally { $process.Dispose() }
}

function Stop-NuvexCluster {
    if (-not (Test-Path -LiteralPath $NuvexPgBase)) {
        Write-Host 'No disposable PostgreSQL cluster was created.'
        return
    }
    if (-not (Test-Path -LiteralPath $NuvexPgManifest -PathType Leaf)) {
        if (Test-Path -LiteralPath (Join-Path $NuvexPgData 'postmaster.pid')) {
            throw 'Refusing to stop an unrecognized PostgreSQL cluster.'
        }
        Write-Host 'No disposable PostgreSQL server was started.'
        return
    }
    $manifest = Get-Content -Raw -LiteralPath $NuvexPgManifest | ConvertFrom-Json
    if ($manifest.format -ne 'nuvex-ci-postgres-v1' -or $manifest.root -ne $NuvexPgBase -or $manifest.data -ne $NuvexPgData) {
        throw 'The CI PostgreSQL cluster manifest does not match this runner directory.'
    }
    $null = Assert-NuvexPath $NuvexPgData $NuvexPgBase
    $pidFile = Join-Path $NuvexPgData 'postmaster.pid'
    if (-not (Test-Path -LiteralPath $pidFile -PathType Leaf)) {
        Write-Host 'The disposable PostgreSQL cluster is already stopped.'
        return
    }
    $pidLines = Get-Content -LiteralPath $pidFile
    if ($pidLines.Count -lt 4 -or $pidLines[0] -notmatch '^[1-9][0-9]*$' -or
        [IO.Path]::GetFullPath($pidLines[1]) -ne $NuvexPgData -or [int]$pidLines[3] -ne [int]$manifest.port) {
        throw 'The owned PostgreSQL PID file does not match its data directory and port.'
    }
    $owned = Get-CimInstance Win32_Process -Filter "ProcessId=$($pidLines[0])"
    if (-not $owned) {
        Write-Host 'The disposable PostgreSQL process has already exited.'
        return
    }
    $expected = [IO.Path]::GetFullPath((Join-Path $manifest.bin 'postgres.exe'))
    $dataArgument = [regex]::Match($owned.CommandLine, '(?:^|\s)"?-D"?\s+(?:"([^"]+)"|(\S+))')
    $commandData = if ($dataArgument.Groups[1].Success) { $dataArgument.Groups[1].Value } else { $dataArgument.Groups[2].Value }
    if ($owned.ExecutablePath -ne $expected -or -not $dataArgument.Success -or
        [IO.Path]::GetFullPath($commandData) -ne $NuvexPgData) {
        throw 'Refusing to stop a PID that is not the exact owned PostgreSQL executable and cluster.'
    }
    $control = Join-Path $manifest.bin 'pg_ctl.exe'
    if ((Get-FileHash -LiteralPath $control -Algorithm SHA256).Hash -ne $manifest.controlSha256) {
        throw 'The PostgreSQL control executable changed after cluster creation.'
    }
    $null = Invoke-NuvexPg $control @('-D', $NuvexPgData, '-m', 'fast', '-w', '-t', '45', 'stop') (Join-Path $NuvexPgBase 'stop.log')
    Write-Host 'Stopped only the disposable runner PostgreSQL cluster.'
}

if ($Action -eq 'Stop') { Stop-NuvexCluster; exit 0 }
if (Test-Path -LiteralPath $NuvexPgBase) {
    throw 'The disposable cluster directory already exists; initialization never replaces existing files.'
}
if (-not (Test-Path -LiteralPath $NuvexRunnerTemp -PathType Container)) {
    throw 'RUNNER_TEMP must already exist.'
}
if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
    throw 'The requested loopback port is occupied; no existing process was modified.'
}
$null = New-Item -ItemType Directory -Path $NuvexPgBase
$identity = [Security.Principal.WindowsIdentity]::GetCurrent().User
$acl = [Security.AccessControl.DirectorySecurity]::new()
$acl.SetOwner($identity)
$acl.SetAccessRuleProtection($true, $false)
$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow'))
Set-Acl -LiteralPath $NuvexPgBase -AclObject $acl

try {
    if ($ToolchainDirectory) {
        $toolchain = (Resolve-Path -LiteralPath $ToolchainDirectory).Path
    } else {
        $archive = Join-Path $NuvexPgBase 'postgresql-17.11-5-windows-x64-binaries.zip'
        Invoke-WebRequest -Uri 'https://get.enterprisedb.com/postgresql/postgresql-17.11-5-windows-x64-binaries.zip' -OutFile $archive -MaximumRedirection 0 -TimeoutSec 600
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $NuvexPgArchiveHash) {
            throw 'The PostgreSQL archive does not match the reviewed SHA-256 pin.'
        }
        $zip = [IO.Compression.ZipFile]::OpenRead($archive)
        try {
            foreach ($entry in $zip.Entries) {
                $relative = $entry.FullName.Replace('\', '/')
                if ($relative -notmatch '^pgsql/(bin|lib|share)/' -or $relative.EndsWith('/')) { continue }
                $destination = Assert-NuvexPath (Join-Path $NuvexPgBase $relative) $NuvexPgBase
                $null = New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($destination))
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $destination, $false)
            }
        } finally { $zip.Dispose() }
        $toolchain = Join-Path $NuvexPgBase 'pgsql'
    }
    $bin = Join-Path $toolchain 'bin'
    foreach ($name in @('postgres.exe', 'initdb.exe', 'pg_ctl.exe', 'psql.exe')) {
        if (-not (Test-Path -LiteralPath (Join-Path $bin $name) -PathType Leaf)) { throw 'The portable PostgreSQL toolchain is incomplete.' }
    }
    $version = Invoke-NuvexPg (Join-Path $bin 'postgres.exe') @('--version') (Join-Path $NuvexPgBase 'version.log')
    if ($version -ne 'postgres (PostgreSQL) 17.11') { throw 'This acceptance helper requires PostgreSQL 17.11 exactly.' }
    $manifest = @{ format = 'nuvex-ci-postgres-v1'; root = $NuvexPgBase; data = $NuvexPgData; port = $Port; bin = $bin; controlSha256 = (Get-FileHash -LiteralPath (Join-Path $bin 'pg_ctl.exe') -Algorithm SHA256).Hash }
    [IO.File]::WriteAllText($NuvexPgManifest, ($manifest | ConvertTo-Json), $NuvexUtf8)
    $adminPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $appPassword = [Convert]::ToHexString([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)).ToLowerInvariant()
    $firstUrl = "postgresql://nuvex_native:${appPassword}@127.0.0.1:${Port}/nuvex_native_primary"
    $secondUrl = "postgresql://nuvex_native:${appPassword}@127.0.0.1:${Port}/nuvex_native_secondary"
    if ($env:GITHUB_ACTIONS -eq 'true') {
        foreach ($secret in @($adminPassword, $appPassword, $firstUrl, $secondUrl)) { Write-Host "::add-mask::$secret" }
    }
    $passwordFile = Join-Path $NuvexPgBase 'bootstrap-password.txt'
    try {
        [IO.File]::WriteAllText($passwordFile, $adminPassword, $NuvexUtf8)
        $null = Invoke-NuvexPg (Join-Path $bin 'initdb.exe') @('-D', $NuvexPgData, '-U', 'nuvex_ci_admin', '--pwfile', $passwordFile, '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C', '--no-instructions', '--no-clean') (Join-Path $NuvexPgBase 'initdb.log')
    } finally {
        if (Test-Path -LiteralPath $passwordFile -PathType Leaf) { Remove-Item -LiteralPath $passwordFile }
    }
    [IO.File]::AppendAllText((Join-Path $NuvexPgData 'postgresql.conf'), @"

listen_addresses = '127.0.0.1'
port = $Port
password_encryption = 'scram-sha-256'
max_connections = 60
shared_buffers = '32MB'
timezone = 'UTC'
log_timezone = 'UTC'
log_statement = 'none'
log_min_error_statement = 'panic'
"@, $NuvexUtf8)
    [IO.File]::WriteAllText((Join-Path $NuvexPgData 'pg_hba.conf'), "host all all 127.0.0.1/32 scram-sha-256`n", $NuvexUtf8)
    $null = Invoke-NuvexPg (Join-Path $bin 'pg_ctl.exe') @('-D', $NuvexPgData, '-l', (Join-Path $NuvexPgBase 'server.log'), '-w', '-t', '45', 'start') (Join-Path $NuvexPgBase 'start.log')
    $sql = @"
CREATE ROLE nuvex_native WITH LOGIN PASSWORD '$appPassword' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 45;
CREATE DATABASE nuvex_native_primary OWNER nuvex_native;
CREATE DATABASE nuvex_native_secondary OWNER nuvex_native;
REVOKE ALL ON DATABASE nuvex_native_primary FROM PUBLIC;
REVOKE ALL ON DATABASE nuvex_native_secondary FROM PUBLIC;
REVOKE ALL ON DATABASE postgres FROM PUBLIC;
"@
    $common = @('-X', '-w', '-q', '-v', 'ON_ERROR_STOP=1', '-h', '127.0.0.1', '-p', "$Port")
    $null = Invoke-NuvexPg (Join-Path $bin 'psql.exe') ($common + @('-U', 'nuvex_ci_admin', '-d', 'postgres', '-f', '-')) (Join-Path $NuvexPgBase 'provision.log') $sql $adminPassword
    foreach ($database in @('nuvex_native_primary', 'nuvex_native_secondary')) {
        $query = "SELECT current_database(),current_user,NOT (rolsuper OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls) FROM pg_roles WHERE rolname=current_user;"
        $result = Invoke-NuvexPg (Join-Path $bin 'psql.exe') ($common + @('-U', 'nuvex_native', '-d', $database, '-tA', '-c', $query)) (Join-Path $NuvexPgBase "$database.log") '' $appPassword
        if ($result -ne "$database|nuvex_native|t") { throw 'The application role did not pass its authenticated least-privilege check.' }
    }
    $listeners = @(Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction Stop)
    if ($listeners.Count -ne 1 -or $listeners[0].LocalAddress -ne '127.0.0.1') { throw 'The disposable server must listen only on IPv4 loopback.' }
    $env:NUVEX_DESKTOP_DATABASE_URL = $firstUrl
    $env:NUVEX_DESKTOP_SECOND_DATABASE_URL = $secondUrl
    if ($env:GITHUB_ENV) {
        [IO.File]::AppendAllText($env:GITHUB_ENV, "NUVEX_DESKTOP_DATABASE_URL=$firstUrl`nNUVEX_DESKTOP_SECOND_DATABASE_URL=$secondUrl`n", $NuvexUtf8)
    } elseif ($env:GITHUB_ACTIONS -eq 'true') { throw 'GITHUB_ENV is required to pass the private database URLs to subsequent CI steps.' }
    Write-Host "PostgreSQL 17.11 ready on 127.0.0.1:$Port with two isolated databases and a restricted application role."
} catch {
    try { Stop-NuvexCluster } catch { Write-Warning 'Owned cluster cleanup failed; the runner will retain its private diagnostics.' }
    throw
}
