# Genera los 5 logos que exige Kommo a partir del logo oficial de UNYX.
# Sustituye al generador de marcadores provisionales.
#
# Uso:
#   pwsh -File infrastructure/scripts/build-widget-logos.ps1
#   pwsh -File infrastructure/scripts/build-widget-logos.ps1 -Source unyx/duplicados/images/unyx.svg
#
# El logo se ajusta DENTRO de cada lienzo conservando la proporcion (fit inside,
# centrado). Para logo_min.png y logo_small.png, que son cuadrados, un isotipo
# cuadrado se veria mejor que el logotipo horizontal: si UNYX tiene uno, pasarlo
# con -Source.
param(
  [string]$Source,
  [string]$TargetDir = (Join-Path $PSScriptRoot '..\..\unyx\duplicados\images')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not $Source) {
  $Source = Join-Path $TargetDir 'unyx.png'
}
$source = (Resolve-Path -LiteralPath $Source).Path

# Medidas exactas exigidas por Kommo.
$variantes = @(
  @{ Name = 'logo_main.png'; Width = 400; Height = 272 },
  @{ Name = 'logo_medium.png'; Width = 240; Height = 84 },
  @{ Name = 'logo_min.png'; Width = 84; Height = 84 },
  @{ Name = 'logo.png'; Width = 130; Height = 100 },
  @{ Name = 'logo_small.png'; Width = 108; Height = 108 }
)

$origin = [System.Drawing.Image]::FromFile($source)
try {
  foreach ($variante in $variantes) {
    $canvas = New-Object System.Drawing.Bitmap($variante.Width, $variante.Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $graphics = [System.Drawing.Graphics]::FromImage($canvas)
    try {
      $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
      $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
      $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
      $graphics.Clear([System.Drawing.Color]::Transparent)

      $escala = [Math]::Min($variante.Width / $origin.Width, $variante.Height / $origin.Height)
      $ancho = [Math]::Max(1, [int][Math]::Round($origin.Width * $escala))
      $alto = [Math]::Max(1, [int][Math]::Round($origin.Height * $escala))
      $x = [int](($variante.Width - $ancho) / 2)
      $y = [int](($variante.Height - $alto) / 2)

      $graphics.DrawImage($origin, $x, $y, $ancho, $alto)
    }
    finally {
      $graphics.Dispose()
    }

    $destino = Join-Path $TargetDir $variante.Name
    $canvas.Save($destino, [System.Drawing.Imaging.ImageFormat]::Png)
    $canvas.Dispose()

    Write-Output ("{0,-16} {1,4}x{2,-4} (logo {3}x{4})" -f $variante.Name, $variante.Width, $variante.Height, $ancho, $alto)
  }
}
finally {
  $origin.Dispose()
}

Write-Output ''
Write-Output "Origen: $source"
Write-Output 'Verificar con: pwsh -File infrastructure/scripts/build-widget-zip.ps1'
