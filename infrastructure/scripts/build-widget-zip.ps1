# Empaqueta el widget de Kommo en un ZIP con manifest.json en la RAÍZ.
# Kommo rechaza el archivo si el manifest queda dentro de una carpeta.
# Los archivos de vista previa (index.html, preview.js, README.md) NO entran.
#
# Uso: pwsh -File infrastructure/scripts/build-widget-zip.ps1 [-SourceDir unyx/duplicados]

param(
  [string]$SourceDir
)

$ErrorActionPreference = 'Stop'

if (-not $SourceDir) {
  $SourceDir = Join-Path $PSScriptRoot '..\..\unyx\duplicados'
}

$source = (Resolve-Path -LiteralPath $SourceDir).Path
$project = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$name = Split-Path -Leaf $source
$dist = Join-Path $project 'dist'
$output = Join-Path $dist "$name.zip"

if (-not (Test-Path -LiteralPath (Join-Path $source 'manifest.json'))) {
  throw "No existe $source\manifest.json"
}

New-Item -ItemType Directory -Path $dist -Force | Out-Null
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }

$include = @('manifest.json', 'script.js', 'style.css', 'i18n', 'images')
$files = @()
foreach ($item in $include) {
  $path = Join-Path $source $item
  if (-not (Test-Path -LiteralPath $path)) { continue }
  if ((Get-Item -LiteralPath $path).PSIsContainer) {
    $files += Get-ChildItem -LiteralPath $path -Recurse -File
  }
  else {
    $files += Get-Item -LiteralPath $path
  }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $entry = $file.FullName.Substring($source.Length).TrimStart('\', '/').Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive,
      $file.FullName,
      $entry,
      [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
}
finally {
  $archive.Dispose()
}

Write-Output "ZIP generado: $output"
$files | ForEach-Object { Write-Output ("  " + $_.FullName.Substring($source.Length).TrimStart('\', '/')) }
Write-Output "Siguiente paso: Settings -> Integrations -> Create Integration -> Upload en Kommo."
