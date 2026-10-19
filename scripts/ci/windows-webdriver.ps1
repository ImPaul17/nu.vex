#Requires -Version 7.0
<#
Select an already installed, signed WebView2 runtime and its exact EdgeDriver.
This downloads only the external test driver into RUNNER_TEMP. It never installs
or updates WebView2, changes machine configuration, or executes unverified code.

Official runtime detection and WebDriver compatibility:
https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution
https://learn.microsoft.com/en-us/microsoft-edge/webview2/how-to/webdriver
The browser-executable-folder environment override selects these installed bits:
https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
if (-not $IsWindows -or -not [Environment]::Is64BitProcess) {
    throw 'This helper requires 64-bit Windows PowerShell 7.'
}
if ([string]::IsNullOrWhiteSpace($env:RUNNER_TEMP)) {
    throw 'Provide the disposable runner RUNNER_TEMP directory.'
}

function Get-ExecutableVersion([string]$Path) {
    $info = [Diagnostics.FileVersionInfo]::GetVersionInfo($Path)
    return [version]::new($info.FileMajorPart, $info.FileMinorPart, $info.FileBuildPart, $info.FilePrivatePart)
}

function Assert-MicrosoftSignature([string]$Path) {
    $signature = Get-AuthenticodeSignature -LiteralPath $Path
    if ($signature.Status -ne 'Valid' -or $null -eq $signature.SignerCertificate) {
        throw 'The native test executable does not have a valid Authenticode signature.'
    }
    $certificate = $signature.SignerCertificate
    $publisher = $certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
    if ($publisher -ne 'Microsoft Corporation' -or $certificate.Subject -notmatch '(?:^|,\s*)O=Microsoft Corporation(?:,|$)') {
        throw 'The native test executable is not signed by Microsoft Corporation.'
    }
}

# Use only Microsoft's documented runtime app ID, never the Edge browser ID.
$runtimeApp = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
$registrations = @(
    @{
        Key = "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$runtimeApp"
        Bases = @(${env:ProgramFiles(x86)}, $env:ProgramFiles)
    },
    @{
        Key = "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$runtimeApp"
        Bases = @($env:LOCALAPPDATA)
    }
)
$candidates = @(
    foreach ($registration in $registrations) {
        if (-not (Test-Path -LiteralPath $registration.Key)) { continue }
        $registered = Get-ItemPropertyValue -LiteralPath $registration.Key -Name pv -ErrorAction SilentlyContinue
        if ($registered -notmatch '^\d+\.\d+\.\d+\.\d+$' -or [version]$registered -le [version]'0.0.0.0') { continue }
        foreach ($base in $registration.Bases) {
            if ([string]::IsNullOrWhiteSpace($base)) { continue }
            $folder = Join-Path $base "Microsoft/EdgeWebView/Application/$registered"
            $binary = Join-Path $folder 'msedgewebview2.exe'
            if (Test-Path -LiteralPath $binary -PathType Leaf) {
                [pscustomobject]@{ Version = [version]$registered; Folder = $folder; Binary = $binary }
            }
        }
    }
)
if ($candidates.Count -eq 0) {
    throw 'No registered preinstalled WebView2 runtime was found. This job does not install a replacement.'
}
$runtime = $candidates | Sort-Object Version -Descending | Select-Object -First 1
Assert-MicrosoftSignature $runtime.Binary
if ((Get-ExecutableVersion $runtime.Binary) -ne $runtime.Version) {
    throw 'The registered WebView2 runtime version does not match its executable.'
}

# Exact version per run: do not silently fetch the latest Edge browser driver.
$version = $runtime.Version.ToString()
$driverDirectory = Join-Path ([IO.Path]::GetFullPath($env:RUNNER_TEMP)) "nuvex-edgedriver-$version"
if (Test-Path -LiteralPath $driverDirectory) {
    throw 'The disposable EdgeDriver output directory already exists.'
}
New-Item -ItemType Directory -Path $driverDirectory | Out-Null
$archivePath = Join-Path $driverDirectory 'edgedriver_win64.zip'
$driverBinary = Join-Path $driverDirectory 'msedgedriver.exe'
$downloadUrl = "https://msedgedriver.microsoft.com/$version/edgedriver_win64.zip"

# The archive has no published checksum; executable trust is checked using
# Windows Authenticode before any execution. Refuse redirects and bound memory.
$handler = [Net.Http.HttpClientHandler]::new()
$handler.AllowAutoRedirect = $false
$client = [Net.Http.HttpClient]::new($handler)
$client.Timeout = [TimeSpan]::FromSeconds(120)
$client.MaxResponseContentBufferSize = 64MB
try {
    $bytes = $client.GetByteArrayAsync($downloadUrl).GetAwaiter().GetResult()
    [IO.File]::WriteAllBytes($archivePath, $bytes)
} finally {
    $client.Dispose()
    $handler.Dispose()
}

# Extract a single expected entry. Other ZIP paths cannot write outside the
# private output directory, regardless of their names or archive attributes.
$archive = [IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entries = @($archive.Entries | Where-Object { $_.FullName -ceq 'msedgedriver.exe' })
    if ($entries.Count -ne 1 -or $entries[0].Length -le 0 -or $entries[0].Length -gt 128MB) {
        throw 'The EdgeDriver archive is missing its single expected executable.'
    }
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], $driverBinary, $false)
} finally {
    $archive.Dispose()
}
Assert-MicrosoftSignature $driverBinary
if ((Get-ExecutableVersion $driverBinary) -ne $runtime.Version) {
    throw 'The signed EdgeDriver file version does not match the selected WebView2 runtime.'
}
# Safe only after both signature and file-version checks have passed.
$reportedVersion = (& $driverBinary --version | Out-String).Trim()
$driverExitCode = $LASTEXITCODE
if ($driverExitCode -ne 0 -or $reportedVersion -notmatch ('^Microsoft Edge WebDriver ' + [regex]::Escape($version) + '(?:\s|$)')) {
    $diagnostic = [regex]::Replace($reportedVersion, '[\x00-\x1f\x7f-\x9f]', ' ')
    $diagnostic = $diagnostic.Substring(0, [Math]::Min(64, $diagnostic.Length))
    throw "Verified EdgeDriver version mismatch (expected $version, exit $driverExitCode, reported '$diagnostic')."
}
Write-Host "Verified EdgeDriver CLI version $version (exit $driverExitCode)."

$variables = @{
    NUVEX_NATIVE_DRIVER_BIN = $driverBinary
    NUVEX_WEBVIEW2_VERSION = $version
    WEBVIEW2_BROWSER_EXECUTABLE_FOLDER = $runtime.Folder
}
foreach ($name in $variables.Keys) {
    $value = $variables[$name]
    if ($value -match '[\r\n]') { throw 'Unexpected newline in a native driver environment value.' }
    [Environment]::SetEnvironmentVariable($name, $value, 'Process')
    if (-not [string]::IsNullOrWhiteSpace($env:GITHUB_ENV)) {
        "$name=$value" | Out-File -LiteralPath $env:GITHUB_ENV -Encoding utf8 -Append
    }
}
Write-Host "Verified Microsoft WebView2 and EdgeDriver $version; no runtime installation performed."
