param(
  [string]$DestinationRoot = "",
  [string]$UserDataPath = "",
  [switch]$SkipRuntimeData
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path -LiteralPath (Join-Path $scriptRoot "..")

if ([string]::IsNullOrWhiteSpace($DestinationRoot)) {
  $DestinationRoot = Join-Path $repoRoot "backups"
}

if ([string]::IsNullOrWhiteSpace($UserDataPath)) {
  $UserDataPath = Join-Path $env:APPDATA "tan-chin-mim-pmc-system\pmc-system.db"
}

function Resolve-ProjectPath {
  param([string]$PathValue)

  if ([System.IO.Path]::IsPathRooted($PathValue)) {
    return [System.IO.Path]::GetFullPath($PathValue)
  }

  return [System.IO.Path]::GetFullPath((Join-Path $repoRoot $PathValue))
}

$destinationRootFull = Resolve-ProjectPath -PathValue $DestinationRoot
New-Item -ItemType Directory -Force -Path $destinationRootFull | Out-Null

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$backupName = "Tan-Chin-MIM-Sintering-PMC-System-$timestamp"
$tempRoot = [System.IO.Path]::GetTempPath()
$stagingRoot = Join-Path $tempRoot $backupName
$zipPath = Join-Path $destinationRootFull "$backupName.zip"

if (Test-Path -LiteralPath $stagingRoot) {
  $resolvedStaging = [System.IO.Path]::GetFullPath($stagingRoot)
  if (-not $resolvedStaging.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove staging path outside temp directory: $resolvedStaging"
  }
  Remove-Item -LiteralPath $resolvedStaging -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $stagingRoot | Out-Null

function Copy-RepoItem {
  param([string]$RelativePath)

  $source = Join-Path $repoRoot $RelativePath
  if (-not (Test-Path -LiteralPath $source)) {
    return
  }

  $target = Join-Path $stagingRoot $RelativePath
  $targetParent = Split-Path -Parent $target
  if ($targetParent) {
    New-Item -ItemType Directory -Force -Path $targetParent | Out-Null
  }

  Copy-Item -LiteralPath $source -Destination $target -Recurse -Force
}

$coreItems = @(
  ".gitignore",
  "README.md",
  "package.json",
  "package-lock.json",
  "index.html",
  "main.js",
  "preload.js",
  "server.js",
  "database.js",
  "seed.js",
  "clear.js",
  "tailwind.config.js",
  "assets",
  "renderer-scripts",
  "docs",
  "scripts",
  "web-client\index.html",
  "web-client\package.json",
  "web-client\package-lock.json",
  "web-client\vite.config.js",
  "web-client\src"
)

foreach ($item in $coreItems) {
  Copy-RepoItem -RelativePath $item
}

$runtimeCopies = @()
if (-not $SkipRuntimeData) {
  $runtimeDbPath = [System.IO.Path]::GetFullPath($UserDataPath)
  $runtimeTargets = @($runtimeDbPath, "$runtimeDbPath-shm", "$runtimeDbPath-wal")
  $runtimeFolder = Join-Path $stagingRoot "runtime-user-data"

  foreach ($runtimeFile in $runtimeTargets) {
    if (Test-Path -LiteralPath $runtimeFile) {
      New-Item -ItemType Directory -Force -Path $runtimeFolder | Out-Null
      Copy-Item -LiteralPath $runtimeFile -Destination (Join-Path $runtimeFolder (Split-Path -Leaf $runtimeFile)) -Force
      $runtimeCopies += $runtimeFile
    }
  }
}

$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$manifest = [ordered]@{
  generated_at = (Get-Date).ToString("o")
  project = "Tan-Chin-MIM-Sintering-PMC-System"
  version = $packageJson.version
  repo_root = $repoRoot.Path
  destination_zip = $zipPath
  runtime_database_source = if ($SkipRuntimeData) { $null } else { [System.IO.Path]::GetFullPath($UserDataPath) }
  runtime_database_files_copied = $runtimeCopies
  included_core_items = $coreItems
}

$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $stagingRoot "backup-manifest.json") -Encoding UTF8

@"
# Restore Instructions

Backup name: $backupName
Generated at: $($manifest.generated_at)
System version: $($packageJson.version)

## Restore steps

1. Close the Electron desktop app and any `npm run server` process first.
2. Extract this zip into a new project folder.
3. Run `npm install`.
4. If `runtime-user-data/pmc-system.db` exists, restore it to `%APPDATA%\tan-chin-mim-pmc-system\pmc-system.db`, or point `PMC_DB_PATH` to that database.
5. Start the desktop app with `npm start`, or start the LAN server only with `npm run server`.

## Notes

- Back up the current machine database before restoring runtime data.
- `node_modules/`, `dist/`, and `.validation-data/` are intentionally excluded.
- If SQLite is actively writing data, close the system before backup so WAL files can settle.
"@ | Set-Content -LiteralPath (Join-Path $stagingRoot "RESTORE-INSTRUCTIONS.md") -Encoding UTF8

if (Test-Path -LiteralPath $zipPath) {
  Remove-Item -LiteralPath $zipPath -Force
}

Compress-Archive -Path (Join-Path $stagingRoot "*") -DestinationPath $zipPath -Force

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $entries = $zip.Entries | ForEach-Object { $_.FullName.Replace("\", "/") }
  $requiredEntries = @(
    "package.json",
    "backup-manifest.json",
    "RESTORE-INSTRUCTIONS.md"
  )

  foreach ($required in $requiredEntries) {
    if ($entries -notcontains $required) {
      throw "Backup archive is missing required entry: $required"
    }
  }

  if (-not ($entries | Where-Object { $_ -like "docs/*" })) {
    throw "Backup archive is missing docs entries."
  }
}
finally {
  $zip.Dispose()
}

$resolvedStagingRoot = [System.IO.Path]::GetFullPath($stagingRoot)
if ($resolvedStagingRoot.StartsWith($tempRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
  Remove-Item -LiteralPath $resolvedStagingRoot -Recurse -Force
}

Write-Host "Backup created: $zipPath"
