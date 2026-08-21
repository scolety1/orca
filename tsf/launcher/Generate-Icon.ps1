<#
.SYNOPSIS
  Generates tsf/launcher/tsf.ico (Thousand Sunny Fleet's shortcut icon) from TSF's own
  established purple/dark palette -- no external image asset or dependency needed.
  Re-run this after changing the design below; the .ico itself is checked in so the
  install script never needs to regenerate it on Tim's machine.
#>

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$OutPath = Join-Path $PSScriptRoot 'tsf.ico'
$sizes = @(16, 32, 48, 256)

function New-IconBitmap {
    param([int]$Size)
    $bmp = New-Object System.Drawing.Bitmap($Size, $Size)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    # Background: rounded square, TSF's dark ground.
    $bg = [System.Drawing.Color]::FromArgb(255, 0x09, 0x09, 0x0f)
    $bgBrush = New-Object System.Drawing.SolidBrush($bg)
    $radius = [Math]::Max(2, [int]($Size * 0.22))
    $rect = New-Object -TypeName System.Drawing.Rectangle -ArgumentList @(0, 0, $Size, $Size)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $d = $radius * 2
    $path.AddArc($rect.X, $rect.Y, $d, $d, 180, 90)
    $path.AddArc($rect.Right - $d, $rect.Y, $d, $d, 270, 90)
    $path.AddArc($rect.Right - $d, $rect.Bottom - $d, $d, $d, 0, 90)
    $path.AddArc($rect.X, $rect.Bottom - $d, $d, $d, 90, 90)
    $path.CloseFigure()
    $g.FillPath($bgBrush, $path)

    # Glow ring: TSF's primary purple.
    $primary = [System.Drawing.Color]::FromArgb(255, 0x91, 0x61, 0xf9)
    $penWidth = [Math]::Max(1, [int]($Size * 0.06))
    $pen = New-Object -TypeName System.Drawing.Pen -ArgumentList @($primary, $penWidth)
    $inset = $penWidth
    $g.DrawEllipse($pen, $inset, $inset, $Size - 2 * $inset, $Size - 2 * $inset)

    # Mark: a simple sail silhouette in the accent purple.
    # Note: `New-Object Type(args)` with no space/-ArgumentList silently
    # drops the args and calls the parameterless ctor -- always use the
    # explicit -TypeName/-ArgumentList form for multi-arg .NET constructors.
    $accent = [System.Drawing.Color]::FromArgb(255, 0xa6, 0x84, 0xfc)
    $sailBrush = New-Object System.Drawing.SolidBrush($accent)
    $mid = $Size / 2.0
    $sail = New-Object System.Drawing.Drawing2D.GraphicsPath
    $pts = [System.Drawing.PointF[]]@(
        (New-Object -TypeName System.Drawing.PointF -ArgumentList @($mid, ($Size * 0.20))),
        (New-Object -TypeName System.Drawing.PointF -ArgumentList @(($Size * 0.74), ($Size * 0.62))),
        (New-Object -TypeName System.Drawing.PointF -ArgumentList @($mid, ($Size * 0.62)))
    )
    $sail.AddPolygon($pts)
    $g.FillPath($sailBrush, $sail)

    $hullBrush = New-Object System.Drawing.SolidBrush([System.Drawing.Color]::FromArgb(255, 0xe9, 0xe7, 0xf2))
    $hull = New-Object System.Drawing.Drawing2D.GraphicsPath
    $hullPts = [System.Drawing.PointF[]]@(
        (New-Object -TypeName System.Drawing.PointF -ArgumentList @(($Size * 0.22), ($Size * 0.70))),
        (New-Object -TypeName System.Drawing.PointF -ArgumentList @(($Size * 0.78), ($Size * 0.70))),
        (New-Object -TypeName System.Drawing.PointF -ArgumentList @(($Size * 0.68), ($Size * 0.82))),
        (New-Object -TypeName System.Drawing.PointF -ArgumentList @(($Size * 0.32), ($Size * 0.82)))
    )
    $hull.AddPolygon($hullPts)
    $g.FillPath($hullBrush, $hull)

    $g.Dispose()
    return $bmp
}

$bitmaps = $sizes | ForEach-Object { New-IconBitmap -Size $_ }

# Hand-roll a multi-size .ico container (System.Drawing has no multi-frame ICO
# encoder) -- ICONDIR + ICONDIRENTRY[] + PNG-encoded frames, which every
# Windows shell icon consumer accepts.
$pngBytesList = @()
foreach ($bmp in $bitmaps) {
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $pngBytesList += , $ms.ToArray()
    $ms.Dispose()
}

$fs = New-Object -TypeName System.IO.FileStream -ArgumentList @($OutPath, [System.IO.FileMode]::Create)
$bw = New-Object -TypeName System.IO.BinaryWriter -ArgumentList @($fs)

$bw.Write([UInt16]0)      # reserved
$bw.Write([UInt16]1)      # type: icon
$bw.Write([UInt16]$sizes.Count)

$headerSize = 6 + (16 * $sizes.Count)
$offset = $headerSize
for ($i = 0; $i -lt $sizes.Count; $i++) {
    $size = $sizes[$i]
    $bytes = $pngBytesList[$i]
    $dim = if ($size -ge 256) { 0 } else { $size } # 0 means 256 per ICO spec
    $bw.Write([Byte]$dim)       # width
    $bw.Write([Byte]$dim)       # height
    $bw.Write([Byte]0)          # color palette
    $bw.Write([Byte]0)          # reserved
    $bw.Write([UInt16]1)        # color planes
    $bw.Write([UInt16]32)       # bits per pixel
    $bw.Write([UInt32]$bytes.Length)
    $bw.Write([UInt32]$offset)
    $offset += $bytes.Length
}
foreach ($bytes in $pngBytesList) {
    $bw.Write($bytes)
}
$bw.Flush()
$bw.Close()
$fs.Close()

foreach ($bmp in $bitmaps) { $bmp.Dispose() }

Write-Host "Wrote $OutPath"
