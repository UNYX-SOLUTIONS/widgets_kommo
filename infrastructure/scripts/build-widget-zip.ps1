# Empaqueta el widget de Kommo en un ZIP con manifest.json en la RAÍZ.
# Kommo rechaza el archivo si el manifest queda dentro de una carpeta.
# Los archivos de vista previa (index.html, preview.js, README.md) y los
# workflows de n8n NO entran en el ZIP.
#
# Uso: pwsh -File infrastructure/scripts/build-widget-zip.ps1 [-SourceDir unyx/duplicados] [-OutputDir dist]

param(
  [string]$SourceDir,
  [string]$OutputDir
)

$ErrorActionPreference = 'Stop'

if (-not $SourceDir) {
  $SourceDir = Join-Path $PSScriptRoot '..\..\unyx\duplicados'
}
if (-not $OutputDir) {
  $OutputDir = Join-Path $PSScriptRoot '..\..\dist'
}

$source = (Resolve-Path -LiteralPath $SourceDir).Path
$name = Split-Path -Leaf $source
$output = Join-Path $OutputDir "$name.zip"

if (-not (Test-Path -LiteralPath (Join-Path $source 'manifest.json'))) {
  throw "No existe $source\manifest.json"
}

New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
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

# Comprobación: manifest.json debe estar en la raíz del ZIP.
$check = [System.IO.Compression.ZipFile]::OpenRead($output)
try {
  $names = $check.Entries | ForEach-Object { $_.FullName }
  if ($names -notcontains 'manifest.json') {
    throw 'El ZIP no tiene manifest.json en la raíz: Kommo lo rechazaría.'
  }
  Write-Output "ZIP generado: $output"
  $names | Sort-Object | ForEach-Object { Write-Output "  $_" }
}
finally {
  $check.Dispose()
}

Write-Output ''
Write-Output 'Siguiente paso: Kommo -> Settings -> Integrations -> su integracion -> Upload'
