$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path -Parent $PSScriptRoot)
$env:DEBUG = 'true'
$env:LOCAL_DB = 'demo.sqlite3'
$env:DATABASE_URL = ''
if (-not $env:DEMO_PASSWORD) { $env:DEMO_PASSWORD = 'Namaste-Demo-2026!' }
if (-not (Test-Path -LiteralPath '.venv\Scripts\python.exe')) {
    py -3.12 -m venv .venv
    if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 is required.' }
}
& .\.venv\Scripts\python.exe -m pip install -r requirements.lock
if ($LASTEXITCODE -ne 0) { throw 'Could not install server dependencies.' }
Push-Location frontend
try {
    npm.cmd ci
    if ($LASTEXITCODE -ne 0) { throw 'Could not install frontend dependencies.' }
    npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
} finally { Pop-Location }
& .\.venv\Scripts\python.exe manage.py migrate --noinput
if ($LASTEXITCODE -ne 0) { throw 'Database setup failed.' }
& .\.venv\Scripts\python.exe manage.py seed_demo
if ($LASTEXITCODE -ne 0) { throw 'Demo setup failed.' }
& .\.venv\Scripts\python.exe manage.py collectstatic --noinput
if ($LASTEXITCODE -ne 0) { throw 'Static file setup failed.' }
Write-Host 'Demo: http://127.0.0.1:8000 · Accounts: owner, billing, staff'
Write-Host 'Use DEMO_PASSWORD (default: Namaste-Demo-2026!). Demo is bound to this computer only.'
& .\.venv\Scripts\python.exe manage.py runserver 127.0.0.1:8000 --noreload
