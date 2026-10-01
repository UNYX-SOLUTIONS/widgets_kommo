# Genera los PNG provisionales del widget con las medidas que exige Kommo.
# Los logos definitivos de UNYX se sustituyen manualmente en unyx/duplicados/images/.
# Uso: pwsh -File infrastructure/scripts/generate-placeholder-logos.ps1
param(
  [string]$TargetDir = (Join-Path $PSScriptRoot '..\..\unyx\duplicados\images')
)

Add-Type -AssemblyName System.Drawing

$brand = [System.Drawing.Color]::FromArgb(30, 64, 175)
$accent = [System.Drawing.Color]::FromArgb(37, 99, 235)

$variants = @(
  @{ Name = 'logo_main.png';   Width = 400; Height = 272 },
  @{ Name = 'logo_medium.png'; Width = 240; Height = 84 },
  @{ Name = 'logo_min.png';    Width = 84;  Height = 84 },
  @{ Name = 'logo.png';        Width = 130; Height = 100 },
  @{ Name = 'logo_small.png';  Width = 108; Height = 108 }
)

if (-not (Test-Path -LiteralPath $TargetDir)) {
  New-Item -ItemType Directory -Path $TargetDir | Out-Null
}

foreach ($variant in $variants) {
  $bitmap = New-Object System.Drawing.Bitmap($variant.Width, $variant.Height)
  $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
  $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $graphics.Clear([System.Drawing.Color]::White)

  $fontSize = [Math]::Max(10, [int]($variant.Height * 0.34))
  $font = New-Object System.Drawing.Font('Segoe UI', $fontSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)

  $layout = New-Object System.Drawing.RectangleF(0, 0, $variant.Width, $variant.Height)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center

  $brush = New-Object System.Drawing.SolidBrush($brand)
  $graphics.DrawString('UNYX', $font, $brush, $layout, $format)

  $ruleHeight = [Math]::Max(2, [int]($variant.Height * 0.05))
  $ruleBrush = New-Object System.Drawing.SolidBrush($accent)
  $ruleWidth = [int]($variant.Width * 0.42)
  $ruleX = [int](($variant.Width - $ruleWidth) / 2)
  $ruleY = [int]($variant.Height / 2 + ($variant.Height * 0.30))
  $graphics.FillRectangle($ruleBrush, $ruleX, $ruleY, $ruleWidth, $ruleHeight)

  $path = Join-Path $TargetDir $variant.Name
  $bitmap.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)

  $brush.Dispose()
  $ruleBrush.Dispose()
  $format.Dispose()
  $font.Dispose()
  $graphics.Dispose()
  $bitmap.Dispose()

  Write-Output ("{0}  {1}x{2}" -f $variant.Name, $variant.Width, $variant.Height)
}
