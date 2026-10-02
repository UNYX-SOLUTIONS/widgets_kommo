# Empaqueta el widget de Kommo en un ZIP con manifest.json en la RAÍZ.
# Kommo rechaza el archivo si el manifest queda dentro de una carpeta.
#
# Incluye solo lo que Kommo necesita: manifest.json, script.js, style.css,
# i18n/ y los 5 logos obligatorios. Los archivos de vista previa
# (index.html, preview.js, README.md), los workflows de n8n y las imágenes
# que no sean logos NO entran.
#
# Uso: pwsh -File infrastructure/scripts/build-widget-zip.ps1 [-SourceDir unyx/duplicados] [-OutputDir dist]

param(
  [string]$SourceDir,
  [string]$OutputDir
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.Drawing

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

# Medidas exactas exigidas por Kommo para cada logo.
$logos = @(
  @{ Name = 'logo.png';        Width = 130; Height = 100 },
  @{ Name = 'logo_main.png';   Width = 400; Height = 272 },
  @{ Name = 'logo_medium.png'; Width = 240; Height = 84 },
  @{ Name = 'logo_min.png';    Width = 84;  Height = 84 },
  @{ Name = 'logo_small.png';  Width = 108; Height = 108 }
)

$imageDir = Join-Path $source 'images'
if (-not (Test-Path -LiteralPath $imageDir)) {
  throw "No existe $imageDir. Kommo exige los 5 logos."
}

# --- 1. Verificar los logos antes de empaquetar ---
$problemas = @()
foreach ($logo in $logos) {
  $ruta = Join-Path $imageDir $logo.Name
  if (-not (Test-Path -LiteralPath $ruta)) {
    $problemas += "FALTA $($logo.Name)"
    continue
  }
  $imagen = [System.Drawing.Image]::FromFile($ruta)
  try {
    if ($imagen.Width -ne $logo.Width -or $imagen.Height -ne $logo.Height) {
      $problemas += ("{0} mide {1}x{2} y debe medir {3}x{4}" -f $logo.Name, $imagen.Width, $imagen.Height, $logo.Width, $logo.Height)
    }
  }
  finally {
    $imagen.Dispose()
  }
  if ((Get-Item -LiteralPath $ruta).Length -gt 300KB) {
    $problemas += "$($logo.Name) pesa mas de 300 KB"
  }
}

if ($problemas.Count -gt 0) {
  Write-Output 'El paquete NO se genero. Kommo rechazaria o mostraria mal los logos:'
  $problemas | ForEach-Object { Write-Output "  - $_" }
  Write-Output ''
  Write-Output 'Regenerarlos desde el logo oficial:'
  Write-Output '  pwsh -File infrastructure/scripts/build-widget-logos.ps1'
  exit 1
}

$sobrantes = Get-ChildItem -LiteralPath $imageDir -File |
  Where-Object { $_.Name -notin ($logos | ForEach-Object { $_.Name }) }

# --- 2. Reunir los archivos del paquete ---
$files = @()
foreach ($item in @('manifest.json', 'script.js', 'style.css')) {
  $ruta = Join-Path $source $item
  if (-not (Test-Path -LiteralPath $ruta)) { throw "Falta $item en el paquete del widget." }
  $files += Get-Item -LiteralPath $ruta
}
$files += Get-ChildItem -LiteralPath (Join-Path $source 'i18n') -Recurse -File
foreach ($logo in $logos) { $files += Get-Item -LiteralPath (Join-Path $imageDir $logo.Name) }

# --- 3. Empaquetar con manifest.json en la raiz ---
New-Item -ItemType Directory -Path $OutputDir -Force | Out-Null
if (Test-Path -LiteralPath $output) { Remove-Item -LiteralPath $output -Force }

$archive = [System.IO.Compression.ZipFile]::Open($output, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  foreach ($file in $files) {
    $entry = $file.FullName.Substring($source.Length).TrimStart('\', '/').Replace('\', '/')
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
      $archive, $file.FullName, $entry, [System.IO.Compression.CompressionLevel]::Optimal
    ) | Out-Null
  }
}
finally {
  $archive.Dispose()
}

# --- 4. Comprobar el resultado ---
$check = [System.IO.Compression.ZipFile]::OpenRead($output)
try {
  $nombres = $check.Entries | ForEach-Object { $_.FullName }
  if ($nombres -notcontains 'manifest.json') {
    throw 'El ZIP no tiene manifest.json en la raiz: Kommo lo rechazaria.'
  }
  Write-Output ("ZIP generado: {0}  ({1:N1} KB)" -f $output, ((Get-Item -LiteralPath $output).Length / 1KB))
  $nombres | Sort-Object | ForEach-Object { Write-Output "  $_" }
}
finally {
  $check.Dispose()
}

if ($sobrantes) {
  Write-Output ''
  Write-Output 'Imagenes NO incluidas (no son logos requeridos):'
  $sobrantes | ForEach-Object { Write-Output "  - images/$($_.Name)" }
}

Write-Output ''
Write-Output 'Siguiente paso: Kommo -> Settings -> Integrations -> su integracion -> Subir'
