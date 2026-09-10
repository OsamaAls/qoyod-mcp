# Qoyod MCP - manual installer for Claude Desktop on Windows.
# Run from the folder that contains qoyod-mcp.cjs:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
# Asks for the name + Qoyod API key of each company (each Qoyod company has
# its own key) and registers the server in
# %APPDATA%\Claude\claude_desktop_config.json (existing servers are kept).

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $here 'qoyod-mcp.cjs'
if (-not (Test-Path $server)) { throw "qoyod-mcp.cjs not found next to install.ps1 ($here)" }

$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) {
  Write-Host "Node.js was not found. Install it first (https://nodejs.org - LTS), then re-run this script." -ForegroundColor Red
  Write-Host "Tip: winget install OpenJS.NodeJS.LTS"
  exit 1
}
Write-Host "Using Node: $node ($(node --version))"

function Read-Secret($prompt) {
  $s = Read-Host -AsSecureString $prompt
  return [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
}

$envBlock = @{}
$i = 1
while ($true) {
  $defaultName = "Company $i"
  $name = Read-Host "Company $i name (Enter = '$defaultName')"
  if (-not $name) { $name = $defaultName }
  $key = Read-Secret "Company $i Qoyod API key"
  if (-not $key) {
    if ($i -eq 1) { throw 'No API key entered.' }
    break
  }
  $envBlock["QOYOD_COMPANY_${i}_NAME"] = $name
  $envBlock["QOYOD_API_KEY_${i}"] = $key
  $i++
  $more = Read-Host "Add another company? (y/N)"
  if ($more -notmatch '^[Yy]') { break }
}

$cfgDir = Join-Path $env:APPDATA 'Claude'
$cfgPath = Join-Path $cfgDir 'claude_desktop_config.json'
New-Item -ItemType Directory -Force -Path $cfgDir | Out-Null

$cfg = @{}
if (Test-Path $cfgPath) {
  Copy-Item $cfgPath "$cfgPath.bak" -Force
  $raw = Get-Content $cfgPath -Raw
  if ($raw.Trim()) { $cfg = $raw | ConvertFrom-Json -AsHashtable }
}
if (-not $cfg.ContainsKey('mcpServers') -or $null -eq $cfg['mcpServers']) { $cfg['mcpServers'] = @{} }
$cfg['mcpServers']['qoyod'] = @{
  command = $node
  args    = @($server)
  env     = $envBlock
}
$cfg | ConvertTo-Json -Depth 10 | Set-Content -Path $cfgPath -Encoding UTF8

Write-Host ""
Write-Host "Done. Registered 'qoyod' ($($i - 1) company/companies) in $cfgPath" -ForegroundColor Green
Write-Host "Now fully quit Claude Desktop (right-click the tray icon > Quit) and open it again."
Write-Host "Then ask Claude: 'List my Qoyod accounts'."
