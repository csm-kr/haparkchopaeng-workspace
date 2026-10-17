$ErrorActionPreference = 'Stop'
function Get-QaSha256([string]$LiteralPath) {
  $qaStream = [IO.File]::OpenRead($LiteralPath)
  $qaHasher = [Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($qaHasher.ComputeHash($qaStream)).Replace('-', '') }
  finally { $qaHasher.Dispose(); $qaStream.Dispose() }
}
$qaConnectorRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$qaPackage = Get-Content -LiteralPath (Join-Path $qaConnectorRoot 'desktop\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$qaInstaller = Join-Path $qaConnectorRoot ('dist\hapark-connector-' + $qaPackage.version + '-win-x64.exe')
$qaProtocol = 'Registry::HKEY_CURRENT_USER\Software\Classes\hapark-connect'
if (Test-Path -LiteralPath 'Registry::HKEY_CLASSES_ROOT\hapark-connect') { throw 'An existing protocol registration must be preserved; use a clean Windows user for installer QA.' }
$qaProductName = $qaPackage.productName
$qaPriorInstalls = @(Get-ItemProperty -Path @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*') -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -eq $qaProductName -or $_.DisplayName -like "$qaProductName *" })
if ($qaPriorInstalls.Count) { throw 'An existing installation must be preserved; use a clean Windows user for installer QA.' }
$qaTemporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$qaInstallRoot = [IO.Path]::GetFullPath((Join-Path $qaTemporaryRoot ('hapark-connector-install-' + [Guid]::NewGuid().ToString('N'))))
if (-not $qaInstallRoot.StartsWith($qaTemporaryRoot, [StringComparison]::OrdinalIgnoreCase) -or -not ([IO.Path]::GetFileName($qaInstallRoot)).StartsWith('hapark-connector-install-')) { throw 'Unexpected install target' }
$qaEvidence = @{ passed = $false; silentInstall = $false; protocolRegistered = $false; bundledNode = $false; packagedCoreMatches = $false; uninstalled = $false; existingProtocolBefore = $false; existingInstallationBefore = $false; guiLaunched = $false; automaticBrowserLaunch = $false; actualInferenceRequests = 0; installerBytes = (Get-Item -LiteralPath $qaInstaller).Length; installerSha256 = (Get-QaSha256 -LiteralPath $qaInstaller); capturedAt = (Get-Date).ToUniversalTime().ToString('o') }
New-Item -ItemType Directory -Path $qaInstallRoot | Out-Null
$qaInstalled = $false
try {
  $qaSetup = Start-Process -FilePath $qaInstaller -ArgumentList @('/S', "/D=$qaInstallRoot") -WindowStyle Hidden -PassThru -Wait
  if ($qaSetup.ExitCode -ne 0) { throw "Installer exit $($qaSetup.ExitCode)" }
  $qaInstalled = $true
  $qaExe = @(Get-ChildItem -LiteralPath $qaInstallRoot -Filter '*.exe' | Where-Object { $_.Name -notmatch '^Uninstall' })
  if ($qaExe.Count -ne 1) { throw 'Expected one installed application' }
  $qaEvidence.silentInstall = $true
  $qaCommand = (Get-Item -LiteralPath "$qaProtocol\shell\open\command").GetValue('')
  if (-not $qaCommand.Contains($qaExe[0].FullName)) { throw 'Protocol points outside the owned installation' }
  $qaEvidence.protocolRegistered = $true
  $qaSourceCoreRoot = Join-Path $qaConnectorRoot 'core'
  $qaPackagedCoreRoot = Join-Path $qaInstallRoot 'resources\core'
  $qaSourceModules = @(Get-ChildItem -LiteralPath $qaSourceCoreRoot -Filter '*.mjs' -File | Sort-Object Name)
  $qaPackagedModules = @(Get-ChildItem -LiteralPath $qaPackagedCoreRoot -Filter '*.mjs' -File | Sort-Object Name)
  if (-not $qaSourceModules.Count -or ($qaSourceModules.Name -join '|') -ne ($qaPackagedModules.Name -join '|')) { throw 'Packaged core module names do not match source' }
  foreach ($qaModule in $qaSourceModules) {
    $qaSourceHash = Get-QaSha256 -LiteralPath $qaModule.FullName
    $qaPackagedHash = Get-QaSha256 -LiteralPath (Join-Path $qaPackagedCoreRoot $qaModule.Name)
    if ($qaSourceHash -ne $qaPackagedHash) { throw "Packaged core module does not match source: $($qaModule.Name)" }
  }
  $qaEvidence.packagedCoreMatches = $true
  $qaEvidence.coreModulesVerified = $qaSourceModules.Count
  $qaEvidence.verifiedCoreModules = @($qaSourceModules.Name)
  $qaSavedRunAsNode = $env:ELECTRON_RUN_AS_NODE
  try {
    $env:ELECTRON_RUN_AS_NODE = '1'
    $qaNative = Start-Process -FilePath $qaExe[0].FullName -ArgumentList @('-p','JSON.stringify({node:process.versions.node,electron:process.versions.electron})') -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $qaInstallRoot 'node.out') -RedirectStandardError (Join-Path $qaInstallRoot 'node.err')
    if ($qaNative.ExitCode -ne 0) { throw 'Installed bundled Node failed' }
    $qaVersions = Get-Content -LiteralPath (Join-Path $qaInstallRoot 'node.out') -Raw | ConvertFrom-Json
    if (-not $qaVersions.node -or -not $qaVersions.electron) { throw 'Installed runtime versions missing' }
    $qaEvidence.bundledNode = $true; $qaEvidence.runtime = @{ node = $qaVersions.node; electron = $qaVersions.electron }
  } finally { $env:ELECTRON_RUN_AS_NODE = $qaSavedRunAsNode }
} finally {
  if ($qaInstalled) {
    $qaUninstaller = @(Get-ChildItem -LiteralPath $qaInstallRoot -Filter 'Uninstall*.exe')
    if ($qaUninstaller.Count -ne 1) { throw 'Owned uninstaller missing' }
    $qaRemoved = Start-Process -FilePath $qaUninstaller[0].FullName -ArgumentList @('/S', "_?=$qaInstallRoot") -WindowStyle Hidden -PassThru -Wait
    if ($qaRemoved.ExitCode -ne 0) { throw "Uninstaller exit $($qaRemoved.ExitCode)" }
    for ($qaRetry = 0; $qaRetry -lt 50 -and (Test-Path -LiteralPath $qaProtocol); $qaRetry++) { Start-Sleep -Milliseconds 100 }
    if (Test-Path -LiteralPath $qaProtocol) { throw 'Protocol registration remains after owned uninstall' }
    $qaEvidence.uninstalled = $true; $qaEvidence.protocolRestoredToAbsent = $true
  }
  # The resolved target was checked above and is the single GUID directory created by this script.
  if (Test-Path -LiteralPath $qaInstallRoot) { Remove-Item -LiteralPath $qaInstallRoot -Recurse -Force }
}
$qaEvidence.passed = $qaEvidence.silentInstall -and $qaEvidence.protocolRegistered -and $qaEvidence.bundledNode -and $qaEvidence.packagedCoreMatches -and $qaEvidence.uninstalled
$qaArtifactRoot = Join-Path $qaConnectorRoot 'artifacts'
New-Item -ItemType Directory -Path $qaArtifactRoot -Force | Out-Null
$qaEvidence | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $qaArtifactRoot 'windows-installer-qa.json') -Encoding UTF8
$qaEvidence | ConvertTo-Json -Depth 5 -Compress
