<#
.SYNOPSIS
  DevTools local dev server launcher (PowerShell wrapper around serve.js).

.EXAMPLE
  .\serve.ps1 www.test.com
  .\serve.ps1 hearts -Port 4000
  .\serve.ps1 -List
  .\serve.ps1 www.test.com -Init
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)] [string] $Site,
  [int]    $Port,
  [string] $Type,
  [string] $BindHost,
  [switch] $NoOpen,
  [switch] $NoReload,
  [switch] $List,
  [switch] $Init,
  [switch] $Help
)

$serve = Join-Path $PSScriptRoot 'serve.js'
$argsList = @()

if ($Help)     { $argsList += '--help' }
if ($List)     { $argsList += '--list' }
if ($Site)     { $argsList += $Site }
if ($Init)     { $argsList += '--init' }
if ($Port)     { $argsList += @('--port', "$Port") }
if ($Type)     { $argsList += @('--type', $Type) }
if ($BindHost) { $argsList += @('--host', $BindHost) }
if ($NoOpen)   { $argsList += '--no-open' }
if ($NoReload) { $argsList += '--no-reload' }

& node $serve @argsList
