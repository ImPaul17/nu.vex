# Trust only the generated CA in LocalMachine Root on a disposable hosted CI VM.
# CurrentUser Root import attempts timed out, including CryptUIWizImport NO_UI.
# https://learn.microsoft.com/en-us/windows/win32/api/wincrypt/nf-wincrypt-certopenstore
# https://docs.github.com/en/actions/reference/runners/github-hosted-runners#administrative-privileges
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
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
        throw 'The disposable hosted runner must already have administrator privileges; elevation is never requested.'
    }
} finally { $identity.Dispose() }
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
    if ($ownership.version -ne 2 -or $ownership.store -ne 'LocalMachine/Root' -or $ownership.thumbprint -ne $thumbprint -or $ownership.sha256 -ne $sha256 -or $ownership.runId -ne $env:GITHUB_RUN_ID) {
        throw 'The CA ownership record does not match this CI run.'
    }
}
$store = [Security.Cryptography.X509Certificates.X509Store]::new('Root', 'LocalMachine')
try {
    Write-Host 'Opening the ordinary LocalMachine Root store on the disposable hosted runner.'
    $store.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadWrite -bor [Security.Cryptography.X509Certificates.OpenFlags]::OpenExistingOnly)
    $storedCertificates = @($store.Certificates.Find([Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $thumbprint, $false))
    foreach ($existing in $storedCertificates) {
        if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($existing.RawData)).ToLowerInvariant() -ne $sha256) { throw 'A stored certificate fingerprint differs from the owned synthetic CA.' }
    }
    if ($Action -eq 'Add') {
        if ($storedCertificates.Count -gt 0 -and $null -eq $ownership) { throw 'A pre-existing root certificate must never be adopted or removed.' }
        if ($null -eq $ownership) {
            # Record ownership BEFORE adding, so cleanup remains possible after interruption.
            @{version = 2; store = 'LocalMachine/Root'; thumbprint = $thumbprint; sha256 = $sha256; runId = $env:GITHUB_RUN_ID} |
                ConvertTo-Json | Out-File -LiteralPath $marker -Encoding utf8 -NoClobber
        }
        if ($storedCertificates.Count -eq 0) {
            Write-Host 'Adding only the public owned synthetic CA through X509Store.Add.'
            $store.Add($certificate)
        }
    } else {
        Write-Host 'Removing only the exact owned synthetic CA through X509Store.Remove.'
        foreach ($existing in $storedCertificates) { $store.Remove($existing) }
    }
} finally {
    $store.Close()
    $store.Dispose()
    $certificate.Dispose()
}
# Reopen the ordinary store after closing the writer. No policy, registry, or
# UNPROTECTED changes are used. The transport acceptance establishes actual trust.
Write-Host 'Reopening ordinary LocalMachine Root to verify the exact owned CA state.'
$verificationStore = [Security.Cryptography.X509Certificates.X509Store]::new('Root', 'LocalMachine')
try {
    $verificationStore.Open([Security.Cryptography.X509Certificates.OpenFlags]::ReadOnly -bor [Security.Cryptography.X509Certificates.OpenFlags]::OpenExistingOnly)
    $verifiedCertificates = @($verificationStore.Certificates.Find([Security.Cryptography.X509Certificates.X509FindType]::FindByThumbprint, $thumbprint, $false))
    if ($Action -eq 'Add') {
        if ($verifiedCertificates.Count -eq 0) { throw 'The owned CA is absent after reopening ordinary LocalMachine Root.' }
        foreach ($verified in $verifiedCertificates) {
            if ([Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($verified.RawData)).ToLowerInvariant() -ne $sha256) { throw 'The reopened owned CA hash differs.' }
        }
        Write-Host 'Owned synthetic CA added only to LocalMachine Root on the disposable hosted runner.'
    } else {
        if ($verifiedCertificates.Count -ne 0) { throw 'Owned synthetic CA cleanup did not complete after reopening LocalMachine Root.' }
        Write-Host 'Owned synthetic CA absent from LocalMachine Root after cleanup.'
    }
} finally { $verificationStore.Close(); $verificationStore.Dispose() }
