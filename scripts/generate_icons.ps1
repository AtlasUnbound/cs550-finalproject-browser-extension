Add-Type -AssemblyName System.Drawing
$iconDir = Join-Path $PSScriptRoot "..\icons"
New-Item -ItemType Directory -Force -Path $iconDir | Out-Null

foreach ($size in @(16, 48, 128)) {
    $bmp = New-Object System.Drawing.Bitmap($size, $size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
    $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect,
        [System.Drawing.Color]::FromArgb(255, 37, 99, 235),
        [System.Drawing.Color]::FromArgb(255, 13, 148, 136),
        45.0
    )
    
    # Fill rounded or full circle/shield base
    $margin = [Math]::Max(1, [int]($size * 0.06))
    $g.FillEllipse($brush, $margin, $margin, $size - 2 * $margin, $size - 2 * $margin)

    # Draw inner shield / fingerprint motif
    $penWidth = [Math]::Max(1.2, $size * 0.07)
    $whitePen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(245, 255, 255, 255), $penWidth)
    $cyanPen = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(220, 165, 243, 252), $penWidth)

    $pad1 = [int]($size * 0.24)
    $g.DrawEllipse($whitePen, $pad1, $pad1, $size - 2 * $pad1, $size - 2 * $pad1)

    if ($size -ge 48) {
        $pad2 = [int]($size * 0.37)
        $g.DrawEllipse($cyanPen, $pad2, $pad2, $size - 2 * $pad2, $size - 2 * $pad2)
    }

    $outPath = Join-Path $iconDir "icon-$size.png"
    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Output "Created $outPath ($size x $size)"
}
Remove-Item -Path (Join-Path $PSScriptRoot "generate_icons.py") -ErrorAction SilentlyContinue
