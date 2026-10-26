# Downloads the pinned Eclipse Temurin Java 21 runtime (Windows x64 JRE) that is
# bundled into the installer, verifies its SHA-256 checksum against the value
# published by Adoptium, and extracts it to desktop\resources\jre.
#
#   powershell -ExecutionPolicy Bypass -File scripts\fetch-jre.ps1
#
# Update $Release deliberately when moving to a newer Java 21 patch release.

param(
    [string]$Release = 'jdk-21.0.12.1+1'
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = Split-Path -Parent $PSScriptRoot
$target = Join-Path $root 'desktop\resources\jre'

$api = "https://api.adoptium.net/v3/assets/release_name/eclipse/$([uri]::EscapeDataString($Release))" +
    '?architecture=x64&os=windows&image_type=jre&project=jdk'
$package = (Invoke-RestMethod -Uri $api).binaries[0].package
if (-not $package.link) { throw "No Windows x64 JRE found for release $Release." }

$zip = Join-Path ([IO.Path]::GetTempPath()) $package.name
Write-Host "Downloading $($package.name) ($([math]::Round($package.size / 1MB)) MB)"
Invoke-WebRequest -Uri $package.link -OutFile $zip -UseBasicParsing

$actual = (Get-FileHash -Path $zip -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actual -ne $package.checksum.ToLowerInvariant()) {
    Remove-Item $zip -Force
    throw "Checksum mismatch for $($package.name): expected $($package.checksum), got $actual."
}

$staging = Join-Path ([IO.Path]::GetTempPath()) "daytracker-jre-$([guid]::NewGuid())"
Expand-Archive -Path $zip -DestinationPath $staging
$extracted = Get-ChildItem $staging -Directory | Select-Object -First 1
if (-not (Test-Path (Join-Path $extracted.FullName 'bin\java.exe'))) {
    throw 'The downloaded archive does not contain bin\java.exe.'
}

if (Test-Path $target) { Remove-Item $target -Recurse -Force }
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
Move-Item $extracted.FullName $target
Remove-Item $staging -Recurse -Force
Remove-Item $zip -Force

Write-Host "Java runtime installed at $target"
& (Join-Path $target 'bin\java.exe') -version
