# Qoyod MCP (unofficial) - manual installer for Claude Desktop on Windows.
# Works in Windows PowerShell 5.1 and PowerShell 7. Run it from the folder that contains qoyod-mcp.cjs:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# It asks for each company's name and Qoyod API key, checks each key with one read-only request,
# and adds a "qoyod" entry to Claude Desktop's config. Everything else in that file is kept, and a
# timestamped backup is made first. Prefer the .mcpb extension when you can: Claude Desktop stores its
# keys encrypted, while this method stores them in plain text in the config file.
#
# Optional parameters (mainly for testing):
#   -ConfigPath <file>     write to this config file instead of Claude Desktop's
#   -CompaniesJson <json>  '[{"name":"My Company","key":"..."}]' instead of the prompts
#   -SkipKeyCheck          do not contact Qoyod to check the keys
[CmdletBinding()]
param(
  [string]$ConfigPath,
  [string]$CompaniesJson,
  [switch]$SkipKeyCheck
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $here 'qoyod-mcp.cjs'
if (-not (Test-Path $server)) { throw "qoyod-mcp.cjs was not found next to install.ps1 ($here)." }

$nodeCmd = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCmd) {
  Write-Host 'Node.js was not found. Install Node.js 18 or newer from https://nodejs.org, then run this script again.' -ForegroundColor Red
  exit 1
}
$node = $nodeCmd.Source
$nodeVersion = (& $node --version).Trim()
if ([int]($nodeVersion.TrimStart('v').Split('.')[0]) -lt 18) {
  Write-Host "Node.js $nodeVersion is too old: version 18 or newer is needed." -ForegroundColor Red
  exit 1
}
Write-Host "Using Node.js $nodeVersion ($node)"

try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12 } catch { }

function Read-Secret([string]$Prompt) {
  $secure = Read-Host -AsSecureString $Prompt
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try { return ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)).Trim() }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

# Returns 'ok', 'rejected' or 'unknown'.
function Test-QoyodKey([string]$Key) {
  try {
    $null = Invoke-WebRequest -Uri 'https://api.qoyod.com/2.0/inventories' -Method Get -UseBasicParsing -TimeoutSec 30 `
      -Headers @{ 'API-KEY' = $Key; 'Accept' = 'application/json' }
    return 'ok'
  } catch {
    $status = $null
    if ($_.Exception.Response) { try { $status = [int]$_.Exception.Response.StatusCode } catch { } }
    if ($status -eq 404) { return 'ok' }   # Qoyod answers "found nothing" with 404: the key works
    if ($status -eq 401 -or $status -eq 403) { return 'rejected' }
    Write-Host "  Could not reach Qoyod to check the key ($($_.Exception.Message))." -ForegroundColor Yellow
    return 'unknown'
  }
}

function Get-ClaudeConfigPath {
  if ($ConfigPath) { return $ConfigPath }
  $classic = Join-Path $env:APPDATA 'Claude\claude_desktop_config.json'
  $packages = Join-Path $env:LOCALAPPDATA 'Packages'
  $store = Get-ChildItem $packages -Directory -Filter 'Claude_*' -ErrorAction SilentlyContinue | Select-Object -First 1
  # The Microsoft Store (MSIX) build of Claude Desktop keeps its settings inside its package folder.
  $storeCfg = if ($store) { Join-Path $store.FullName 'LocalCache\Roaming\Claude\claude_desktop_config.json' } else { $null }
  if ($storeCfg -and (Test-Path $storeCfg)) { return $storeCfg }
  if (Test-Path $classic) { return $classic }
  if ($storeCfg) { return $storeCfg }
  return $classic
}

# ConvertFrom-Json silently keeps only one of two duplicate keys, which would drop settings when we rewrite the file.
function Test-DuplicateJsonKeys([string]$Path) {
  $js = @'
const s = require('fs').readFileSync(process.argv[2], 'utf8').replace(/^﻿/, '');
const stack = [];
const dups = [];
let i = 0;
while (i < s.length) {
  const c = s[i];
  if (c === '"') {
    let j = i + 1;
    while (j < s.length && s[j] !== '"') j += s[j] === '\\' ? 2 : 1;
    const str = s.slice(i, j + 1);
    i = j + 1;
    const top = stack[stack.length - 1];
    if (top && top.keys && top.expectKey) {
      if (top.keys.has(str)) dups.push(str);
      top.keys.add(str);
      top.expectKey = false;
    }
    continue;
  }
  if (c === '{') stack.push({ keys: new Set(), expectKey: true });
  else if (c === '[') stack.push({});
  else if (c === '}' || c === ']') stack.pop();
  else if (c === ',' && stack.length && stack[stack.length - 1].keys) stack[stack.length - 1].expectKey = true;
  i++;
}
if (dups.length) { console.log(dups.join(', ')); process.exit(3); }
'@
  $tmp = Join-Path ([IO.Path]::GetTempPath()) "qoyod-mcp-dupcheck-$PID.js"
  [IO.File]::WriteAllText($tmp, $js, (New-Object System.Text.UTF8Encoding($false)))
  try {
    $out = & $node $tmp $Path 2>&1 | Out-String
    if ($LASTEXITCODE -eq 3) { return $out.Trim() }
    return $null
  } finally {
    Remove-Item $tmp -ErrorAction SilentlyContinue
  }
}

# ---- collect companies ---------------------------------------------------------------
$companies = @()
if ($CompaniesJson) {
  foreach ($c in ($CompaniesJson | ConvertFrom-Json)) { $companies += [pscustomobject]@{ name = "$($c.name)".Trim(); key = "$($c.key)".Trim() } }
} else {
  $i = 1
  while ($true) {
    $name = ''
    while (-not $name) { $name = (Read-Host "Company $i name (as you will say it to the assistant)").Trim() }
    $key = Read-Secret "Company $i Qoyod API key (Qoyod: Settings > General Settings > API key)"
    if (-not $key) {
      if ($i -eq 1) { throw 'No API key was entered, so nothing was changed.' }
      break
    }
    $companies += [pscustomobject]@{ name = $name; key = $key }
    $i++
    $more = Read-Host 'Add another company? (y/N)'
    if ($more -notmatch '^[Yy]') { break }
  }
}
if ($companies.Count -eq 0) { throw 'No companies were given, so nothing was changed.' }

$envBlock = [ordered]@{}
$n = 0
$seenKeys = @{}
$seenNames = @{}
foreach ($c in $companies) {
  $n++
  if (-not $c.name) { throw "Company $n has no name." }
  if ($c.key -match '[\s#"'']') { throw "The key for `"$($c.name)`" contains a space, # or quote. Copy it again from Qoyod." }
  if ($seenKeys.ContainsKey($c.key)) { throw "`"$($c.name)`" has the same API key as `"$($seenKeys[$c.key])`". Each Qoyod company has its own key." }
  if ($seenNames.ContainsKey($c.name.ToLowerInvariant())) { throw "Two companies are named `"$($c.name)`"." }
  $seenKeys[$c.key] = $c.name
  $seenNames[$c.name.ToLowerInvariant()] = $true
  if (-not $SkipKeyCheck) {
    Write-Host "Checking the key for `"$($c.name)`" with one read-only request..."
    $result = Test-QoyodKey $c.key
    if ($result -eq 'rejected') { throw "Qoyod rejected the key for `"$($c.name)`". In Qoyod open Settings > General Settings > API key, click Save, and run this script again." }
  }
  $envBlock["QOYOD_COMPANY_${n}_NAME"] = $c.name
  $envBlock["QOYOD_API_KEY_${n}"] = $c.key
}

# ---- merge into the Claude Desktop config ----------------------------------------------
$cfgPath = Get-ClaudeConfigPath
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $cfgPath) | Out-Null

$cfg = New-Object PSObject
if (Test-Path $cfgPath) {
  $backup = "$cfgPath.$(Get-Date -Format 'yyyyMMdd-HHmmss').bak"
  Copy-Item $cfgPath $backup
  Write-Host "Backup of the existing config: $backup"
  $raw = [IO.File]::ReadAllText($cfgPath)
  if ($raw.Trim()) {
    $dups = Test-DuplicateJsonKeys $cfgPath
    if ($dups) { throw "$cfgPath contains duplicate keys ($dups), so nothing was changed. Merge them by hand, then run this script again." }
    $convertArgs = @{}
    if ((Get-Command ConvertFrom-Json).Parameters.ContainsKey('DateKind')) { $convertArgs.DateKind = 'String' }
    try { $cfg = $raw | ConvertFrom-Json @convertArgs }
    catch { throw "$cfgPath is not valid JSON, so nothing was changed. Fix or remove that file, then run this script again." }
  }
}
if (-not $cfg.PSObject.Properties['mcpServers'] -or $null -eq $cfg.mcpServers) {
  $cfg | Add-Member -NotePropertyName mcpServers -NotePropertyValue (New-Object PSObject) -Force
}
$entry = New-Object PSObject -Property ([ordered]@{
  command = $node
  args    = @($server)
  env     = (New-Object PSObject -Property $envBlock)
})
$cfg.mcpServers | Add-Member -NotePropertyName qoyod -NotePropertyValue $entry -Force

$json = ConvertTo-Json -InputObject $cfg -Depth 50
$null = $json | ConvertFrom-Json   # make sure what we write parses
$tmp = "$cfgPath.tmp"
[IO.File]::WriteAllText($tmp, $json, (New-Object System.Text.UTF8Encoding($false)))
Move-Item -Force $tmp $cfgPath

Write-Host ''
Write-Host "Done: 'qoyod' is registered with $($companies.Count) company/companies in $cfgPath" -ForegroundColor Green
Write-Host 'Note: with this method the API keys are stored in plain text in that file (and its .bak backups).'
Write-Host 'Use only one method per computer: if the Qoyod extension (.mcpb) is also installed, remove one of them.'
Write-Host 'Now fully quit Claude Desktop (right-click its icon next to the clock > Quit) and open it again.'
Write-Host 'Then ask: "Check my Qoyod connection".'
