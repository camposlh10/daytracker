# Builds the Windows installer: tested backend JAR, production frontend assets,
# compiled Electron shell, and the bundled Java 21 runtime.
#
#   powershell -ExecutionPolicy Bypass -File scripts\package.ps1            # installer
#   powershell -ExecutionPolicy Bypass -File scripts\package.ps1 -Unpacked  # unpacked app only
#   powershell -ExecutionPolicy Bypass -File scripts\package.ps1 -LocalRun  # unpacked, runnable under Smart App Control
#   powershell -ExecutionPolicy Bypass -File scripts\package.ps1 -LocalInstaller  # unsigned installer for local install tests
#
# -LocalRun and -LocalInstaller leave the Electron executable byte-for-byte
# unmodified (no icon or metadata edit). Windows Smart App Control blocks the
# step that edits the executable, so the default installer build fails on a
# machine that enforces it; the unmodified Electron binary is allowed. The
# local installer installed, upgraded and uninstalled cleanly on the development
# machine (scripts\install-test.mjs), but it is unsigned: a distributable
# installer needs a code-signing certificate, and Windows may still warn.
#
# Requires desktop\resources\jre (see scripts\fetch-jre.ps1).

param(
    [switch]$Unpacked,
    [switch]$LocalRun,
    [switch]$LocalInstaller,
    [switch]$SkipTests
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$desktop = Join-Path $root 'desktop'

if (-not (Test-Path (Join-Path $desktop 'resources\jre\bin\java.exe'))) {
    throw 'Bundled Java runtime not found at desktop\resources\jre. Run scripts\fetch-jre.ps1 first.'
}

function Invoke-Step([string]$Directory, [scriptblock]$Command, [string]$Name) {
    Push-Location $Directory
    try {
        & $Command
        if ($LASTEXITCODE -ne 0) { throw "$Name failed." }
    }
    finally { Pop-Location }
}

Invoke-Step (Join-Path $root 'backend') {
    if ($SkipTests) { & .\mvnw.cmd -B -q -ntp -DskipTests clean package }
    else { & .\mvnw.cmd -B -q -ntp clean verify }
} 'Backend build'

Invoke-Step (Join-Path $root 'frontend') {
    & npm ci
    if ($LASTEXITCODE -eq 0 -and -not $SkipTests) { & npm test }
    if ($LASTEXITCODE -eq 0) { & npm run build }
} 'Frontend build'

$renderer = Join-Path $desktop 'renderer'
if (Test-Path $renderer) { Remove-Item $renderer -Recurse -Force }
Copy-Item (Join-Path $root 'frontend\dist') $renderer -Recurse

Invoke-Step $desktop {
    & npm ci
    if ($LASTEXITCODE -eq 0) { & npm run build }
    # The restore sequence against the real backend jar, before anything is packaged.
    if ($LASTEXITCODE -eq 0 -and -not $SkipTests) { & node (Join-Path $root 'scripts\restore-test.mjs') }
    # Start-up failures, crashes, orphan protection, and refusal of a newer database.
    if ($LASTEXITCODE -eq 0 -and -not $SkipTests) { & node (Join-Path $root 'scripts\lifecycle-test.mjs') }
    # The Spotify client against a fake Spotify: sign-in, tokens, playback control, errors.
    if ($LASTEXITCODE -eq 0 -and -not $SkipTests) { & node (Join-Path $root 'scripts\spotify-test.mjs') }
    if ($LASTEXITCODE -eq 0) {
        if ($LocalInstaller) { & npx electron-builder --win nsis --x64 '-c.win.signAndEditExecutable=false' '-c.directories.output=release-installer' }
        elseif ($LocalRun) { & npm run pack -- '-c.win.signAndEditExecutable=false' '-c.asar=false' }
        elseif ($Unpacked) { & npm run pack }
        else { & npm run dist }
    }
} 'Desktop packaging'

Write-Host "Output: $(Join-Path $desktop 'release')"
