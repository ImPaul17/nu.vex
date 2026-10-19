# Trust only the generated CA in the current CI user's Root store, never LocalMachine.
# https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.security/about/about_certificate_provider
# Protect is filesystem-only and permits local certificate generation smoke tests.
# Add/Remove refuse ordinary local hosts, including self-hosted Actions runners.
#Requires -Version 7.0
[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('Protect', 'Add', 'Remove')][string]$Action)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Windows certificate-store helper requires Windows.' }
if (-not $env:RUNNER_TEMP -or -not [IO.Path]::IsPathFullyQualified($env:RUNNER_TEMP)) {
    throw 'An absolute disposable RUNNER_TEMP is required.'
}
$temporary = [IO.Path]::GetFullPath($env:RUNNER_TEMP).TrimEnd('\', '/')
if ($temporary -eq [IO.Path]::GetPathRoot($temporary).TrimEnd('\', '/')) { throw 'RUNNER_TEMP cannot be a drive root.' }
$root = Join-Path $temporary 'nuvex-tls'
$marker = Join-Path $root 'windows-trust.json'
for ($cursor = $root; $cursor; $cursor = [IO.Path]::GetDirectoryName($cursor)) {
    if ((Test-Path -LiteralPath $cursor) -and ((Get-Item -LiteralPath $cursor -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) {
        throw 'Synthetic TLS paths must not traverse reparse points.'
    }
}

if ($Action -eq 'Protect') {
    if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'Create the dedicated fixture directory first.' }
    if (@(Get-ChildItem -LiteralPath $root -Force).Count -ne 0) { throw 'Only a fresh empty TLS directory may be protected.' }
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User
    $acl = [Security.AccessControl.DirectorySecurity]::new()
    $acl.SetOwner($sid)
    $acl.SetAccessRuleProtection($true, $false)
    $rule = [Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
    Set-Acl -LiteralPath $root -AclObject $acl
    Write-Host 'Private ACL applied before generating synthetic TLS keys.'
    return
}

if ($env:GITHUB_ACTIONS -ne 'true' -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted' -or $env:RUNNER_OS -ne 'Windows' -or $env:GITHUB_RUN_ID -notmatch '^\d+$') {
    throw 'Certificate-store changes are restricted to the disposable GitHub-hosted Windows CI runner.'
}
if ($Action -eq 'Remove' -and -not (Test-Path -LiteralPath $marker -PathType Leaf)) {
    Write-Host 'No owned synthetic CA trust entry was recorded.'
    return
}
$manifest = Join-Path $root 'fixture.json'
if (-not (Test-Path -LiteralPath $manifest -PathType Leaf)) { throw 'The synthetic TLS fixture manifest is missing.' }
$fixture = Get-Content -LiteralPath $manifest -Raw | ConvertFrom-Json
$certificatePath = Join-Path $root 'ca/cert.pem'
if ($fixture.version -ne 1 -or $fixture.root -ne $root -or $fixture.ca.cert -ne $certificatePath) { throw 'Unexpected synthetic CA fixture path.' }
$pem = [IO.File]::ReadAllText($certificatePath)
if ($pem -notmatch '\A\s*-----BEGIN CERTIFICATE-----\s*([A-Za-z0-9+/=\r\n]+)\s*-----END CERTIFICATE-----\s*\z') { throw 'Expected one public PEM certificate.' }
$certificate = [Security.Cryptography.X509Certificates.X509Certificate2]::new([Convert]::FromBase64String($Matches[1]))
$thumbprint = $certificate.Thumbprint
$sha256 = [Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($certificate.RawData)).ToLowerInvariant()
if ($fixture.ca.thumbprint -ne $thumbprint -or $fixture.ca.sha256 -ne $sha256) { throw 'The synthetic CA fixture fingerprint changed.' }
if ($certificate.Subject -notlike '*CN=nu.vex synthetic ca *' -or $certificate.HasPrivateKey) { throw 'Expected only the generated public CA certificate.' }
$ownership = $null
if (Test-Path -LiteralPath $marker -PathType Leaf) {
    $ownership = Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json
    if ($ownership.version -ne 1 -or $ownership.store -ne 'CurrentUser/Root' -or $ownership.thumbprint -ne $thumbprint -or $ownership.sha256 -ne $sha256 -or $ownership.runId -ne $env:GITHUB_RUN_ID) {
        throw 'The CA ownership record does not match this CI run.'
    }
}
$store = [Security.Cryptography.X509Certificates.X509Store]::new('Root', 'CurrentUser')
try {
    $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite)
    $storedCertificates = @($store.Certificates.Find([Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $thumbprint, $false))
    foreach ($existing in $storedCertificates) {
        if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($existing.RawData)).ToLowerInvariant() -ne $sha256) { throw 'A stored certificate fingerprint differs from the owned synthetic CA.' }
    }
    if ($Action -eq 'Add') {
        if ($storedCertificates.Count -gt 0 -and $null -eq $ownership) { throw 'A pre-existing root certificate must never be adopted or removed.' }
        if ($null -eq $ownership) {
            # Record ownership BEFORE adding, so cleanup remains possible after interruption.
            @{version = 1; store = 'CurrentUser/Root'; thumbprint = $thumbprint; sha256 = $sha256; runId = $env:GITHUB_RUN_ID} |
                ConvertTo-Json | Out-File -LiteralPath $marker -Encoding utf8 -NoClobber
        }
        if ($storedCertificates.Count -eq 0) { $store.Add($certificate) }
        Write-Host 'Owned synthetic CA added only to CurrentUser Root on the hosted runner.'
    } else {
        foreach ($existing in $storedCertificates) { $store.Remove($existing) }
        if ($store.Certificates.Find([Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $thumbprint, $false).Count -ne 0) { throw 'Owned synthetic CA cleanup did not complete.' }
        Write-Host 'Owned synthetic CA absent from CurrentUser Root after cleanup.'
    }
} finally {
    $store.Close()
    $store.Dispose()
    $certificate.Dispose()
}
