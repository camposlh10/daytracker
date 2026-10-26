# Development launcher: builds the backend JAR, starts the Vite dev server, then
# runs Electron (which launches and supervises the Spring Boot process).
# Vite is stopped when Electron exits. Data goes to "%APPDATA%\Day Tracker Dev".
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot

Push-Location (Join-Path $root 'backend')
try {
    & .\mvnw.cmd -B -q -ntp -DskipTests package
    if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
}
finally { Pop-Location }

Push-Location (Join-Path $root 'desktop')
try {
    & npm run build
    if ($LASTEXITCODE -ne 0) { throw 'Desktop build failed.' }
}
finally { Pop-Location }

$vite = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', 'npm run dev' `
    -WorkingDirectory (Join-Path $root 'frontend') -PassThru -WindowStyle Hidden
try {
    $deadline = (Get-Date).AddSeconds(30)
    $up = $false
    while (-not $up -and (Get-Date) -lt $deadline) {
        try {
            Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 2 | Out-Null
            $up = $true
        }
        catch { Start-Sleep -Milliseconds 300 }
    }
    if (-not $up) { throw 'The Vite dev server did not start on 127.0.0.1:5173.' }

    Push-Location (Join-Path $root 'desktop')
    try { & npx electron . }
    finally { Pop-Location }
}
finally {
    # Stops cmd.exe and the node process it started.
    & taskkill /PID $vite.Id /T /F 2>$null | Out-Null
}
