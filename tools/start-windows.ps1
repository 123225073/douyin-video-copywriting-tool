$ErrorActionPreference = "Stop"

$RootDir = Split-Path -Parent $PSScriptRoot
$AppDir = Join-Path $RootDir "prototype"
$Url = "http://127.0.0.1:5176"

function Write-Step($Message) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $env:Path = "$machinePath;$userPath"
}

function Try-Install-WithWinget($PackageId, $Name) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    return $false
  }
  Write-Step "Installing $Name with winget"
  winget install --id $PackageId -e --accept-package-agreements --accept-source-agreements
  Refresh-Path
  return $true
}

function Ensure-Node {
  if (Get-Command node -ErrorAction SilentlyContinue) {
    return
  }
  Try-Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS" | Out-Null
  if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Start-Process "https://nodejs.org/zh-cn/download"
    throw "Node.js is missing. The download page has been opened. Install Node.js LTS, then run start-windows.bat again."
  }
}

function Get-PythonLauncher {
  if (Get-Command py -ErrorAction SilentlyContinue) {
    return @{ Exe = "py"; Prefix = @("-3") }
  }
  if (Get-Command python -ErrorAction SilentlyContinue) {
    return @{ Exe = "python"; Prefix = @() }
  }
  Try-Install-WithWinget "Python.Python.3.12" "Python 3" | Out-Null
  if (Get-Command py -ErrorAction SilentlyContinue) {
    return @{ Exe = "py"; Prefix = @("-3") }
  }
  if (Get-Command python -ErrorAction SilentlyContinue) {
    return @{ Exe = "python"; Prefix = @() }
  }
  Start-Process "https://www.python.org/downloads/windows/"
  throw "Python 3 is missing. The download page has been opened. Install Python 3, then run start-windows.bat again."
}

function Invoke-Python {
  & $script:PythonExe @script:PythonPrefix @args
}

function Test-Server {
  try {
    $response = Invoke-WebRequest -UseBasicParsing "$Url/api/health" -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

if (-not (Test-Path $AppDir)) {
  throw "Cannot find prototype directory. Please keep start-windows.bat in the project root."
}

if (Test-Server) {
  Write-Step "The tool is already running"
  Start-Process $Url
  Write-Host "Opened $Url"
  exit 0
}

Write-Host "Fengsha Viral Video Remake Desk - one-click starter" -ForegroundColor Green
Write-Host "First run may take several minutes because dependencies and local AI packages are installed."

Ensure-Node
$python = Get-PythonLauncher
$script:PythonExe = $python.Exe
$script:PythonPrefix = $python.Prefix

Write-Step "Checking versions"
node --version
npm --version
Invoke-Python --version

Push-Location $AppDir
try {
  Write-Step "Installing Node dependencies"
  npm install --no-audit --no-fund --cache ".npm-cache"

  Write-Step "Installing Python recognition dependencies"
  Invoke-Python -m pip install --upgrade pip
  Invoke-Python -m pip install -r "requirements.txt"

  Write-Step "Building web app"
  npm run build

  Write-Step "Starting local server"
  $server = Start-Process -FilePath "node" -ArgumentList "server.mjs" -WorkingDirectory $AppDir -PassThru
  try {
    $ready = $false
    for ($i = 0; $i -lt 40; $i++) {
      if (Test-Server) {
        $ready = $true
        break
      }
      Start-Sleep -Milliseconds 750
    }
    if (-not $ready) {
      throw "Server did not become ready in time."
    }
    Start-Process $Url
    Write-Host ""
    Write-Host "The tool is ready: $Url" -ForegroundColor Green
    Write-Host "Keep this window open while using the tool."
    Write-Host "Press Enter in this window to stop the local server."
    Read-Host | Out-Null
  } finally {
    if ($server -and -not $server.HasExited) {
      Stop-Process -Id $server.Id -Force
    }
  }
} finally {
  Pop-Location
}
