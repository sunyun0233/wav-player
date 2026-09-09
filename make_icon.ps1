Add-Type -AssemblyName System.Drawing
$size = 512
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$g.Clear([System.Drawing.Color]::FromArgb(255, 8, 9, 20))
$aqua = [System.Drawing.Color]::FromArgb(255, 0, 251, 236)
$inkWhite = [System.Drawing.Color]::FromArgb(120, 255, 255, 255)
# outer orbital ring
$penOuter = New-Object System.Drawing.Pen($aqua, 12)
$g.DrawEllipse($penOuter, 96, 96, 320, 320)
# inner faint ring
$penInner = New-Object System.Drawing.Pen($inkWhite, 3)
$g.DrawEllipse($penInner, 156, 156, 200, 200)
# diagonal line
$penLine = New-Object System.Drawing.Pen($inkWhite, 6)
$g.DrawLine($penLine, 150, 330, 360, 150)
# node dot on ring
$dotBrush = New-Object System.Drawing.SolidBrush($aqua)
$g.FillEllipse($dotBrush, 376, 148, 36, 36)
# small secondary dot
$dotBrush2 = New-Object System.Drawing.SolidBrush($aqua)
$g.FillEllipse($dotBrush2, 120, 120, 20, 20)
# center core outline
$penCore = New-Object System.Drawing.Pen($aqua, 5)
$g.DrawEllipse($penCore, 222, 222, 68, 68)
# thin ring line across center (equator)
$penEq = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(90, 255,255,255), 2)
$g.DrawLine($penEq, 140, 256, 372, 256)
$g.Dispose()
$out = Join-Path (Get-Location) 'build\icon.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "icon written: $out"
