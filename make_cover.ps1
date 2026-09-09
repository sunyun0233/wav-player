Add-Type -AssemblyName System.Drawing
$size = 800
$bmp = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
# vertical midnight gradient
$rect = New-Object System.Drawing.Rectangle(0,0,$size,$size)
$lin = New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect, [System.Drawing.Color]::FromArgb(255,10,12,32), [System.Drawing.Color]::FromArgb(255,6,7,14), 90)
$g.FillRectangle($lin, $rect)
$aqua = [System.Drawing.Color]::FromArgb(255,0,251,236)
# star points
$rand = New-Object System.Random(9)
for($i=0;$i -lt 160;$i++){
  $x=$rand.Next(0,$size); $y=$rand.Next(0,$size); $r=$rand.Next(1,3)
  $b=[System.Drawing.Color]::FromArgb(($rand.Next(60,200)),255,255,255)
  $gb=New-Object System.Drawing.SolidBrush($b); $g.FillEllipse($gb,$x,$y,$r,$r); $gb.Dispose()
}
# orbital rings
$pen = New-Object System.Drawing.Pen($aqua, 4)
$g.DrawEllipse($pen, 150,170,500,500)
$pen2 = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120,255,255,255), 2)
$g.DrawEllipse($pen2, 260,280,280,280)
# diagonal beam
$beam = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(140,0,251,236), 6)
$g.DrawLine($beam, 180,600, 640,220)
# luminous node
$glow = New-Object System.Drawing.SolidBrush($aqua)
$g.FillEllipse($glow, 560,180, 60,60)
$g.Dispose()
$out = Join-Path (Get-Location) 'samples\cover.png'
$bmp.Save($out,[System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output "cover $out"
