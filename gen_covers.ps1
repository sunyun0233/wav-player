Add-Type -AssemblyName System.Drawing
function Write-Cover($path, $hueStart, $hueEnd){
  $s=480; $bmp=New-Object System.Drawing.Bitmap($s,$s); $g=[System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode=[System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $rect=New-Object System.Drawing.Rectangle(0,0,$s,$s)
  $c1=[System.Drawing.Color]::FromArgb(255,10,12,32); $c2=[System.Drawing.Color]::FromArgb($hueStart,$hueEnd,6,14)
  $lin=New-Object System.Drawing.Drawing2D.LinearGradientBrush($rect,$c1,$c2,90)
  $g.FillRectangle($lin,$rect)
  $aqua=[System.Drawing.Color]::FromArgb(255,0,251,236)
  $pen=New-Object System.Drawing.Pen($aqua,3); $g.DrawEllipse($pen,90,90,300,300)
  $pen2=New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(110,255,255,255),2); $g.DrawEllipse($pen2,170,170,140,140)
  $brush=New-Object System.Drawing.SolidBrush($aqua); $g.FillEllipse($brush,330,150,40,40); $brush.Dispose()
  $g.Dispose(); $bmp.Save($path,[System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
}
Write-Cover 'samples\album\01_signal.png' 24 18
Write-Cover 'samples\album\cover.png' 60 22
Write-Output 'covers done'
