<#
.SYNOPSIS
    Converts a PNG into a multi-resolution Windows .ico for install\assets\app.ico.

.DESCRIPTION
    install\assets\app.ico is currently the real, supplied baramundi icon (7 sizes,
    PNG-compressed RGBA) and this script did not create it and must not regenerate it.
    It exists for the day someone needs to REPLACE that file -- a rebrand, a corrected
    source image -- without needing an image editor that can author a proper multi-size
    .ico container.

    Each requested size is rendered independently with high-quality scaling (not a single
    image stretched by the OS), letterboxed onto a transparent square canvas so a
    non-square source is not distorted -- this project's own logo.png is a 538x125
    wordmark, exactly the shape that would smear across a naively-stretched icon. Each
    size is stored PNG-compressed inside the .ico container, the same format `file`
    reports for the real supplied app.ico, which Vista and later read natively.

    Default sizes are 16, 32, 48, 256 -- 16 and 32 for the title bar and Alt-Tab, 48 for
    the shell's "large icon" views, 256 for a crisp taskbar thumbnail at high DPI. See
    "Branding assets" in INSTALL.md for where each size actually gets used.

.PARAMETER SourcePng
    A PNG to convert. Square source art is recommended; a non-square source is
    letterboxed (scaled to fit, centred, transparent padding) rather than stretched.

.PARAMETER OutputIco
    Where to write the .ico. Pass install\assets\app.ico to replace the shipped icon.

.PARAMETER Sizes
    Pixel sizes to include. Defaults to 16, 32, 48, 256.

.EXAMPLE
    .\New-AppIcon.ps1 -SourcePng C:\art\new-mark.png -OutputIco C:\bConnect-MCP\install\assets\app.ico

.EXAMPLE
    # Rehearse without touching the real asset:
    .\New-AppIcon.ps1 -SourcePng C:\art\new-mark.png -OutputIco C:\temp\test.ico
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $SourcePng,
    [Parameter(Mandatory)] [string] $OutputIco,
    [int[]] $Sizes = @(16, 32, 48, 256)
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $SourcePng)) { throw "Source PNG not found: $SourcePng" }
$Sizes = @($Sizes | Sort-Object -Unique)
if ($Sizes.Count -eq 0) { throw 'At least one size is required.' }
foreach ($s in $Sizes) {
    if ($s -lt 1 -or $s -gt 256) { throw "Size $s out of range -- ICO entries support 1..256 px." }
}

function ConvertTo-ResizedPngBytes {
    param([System.Drawing.Image] $Source, [int] $Size)
    $bmp = New-Object System.Drawing.Bitmap $Size, $Size, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    try {
        $g.CompositingMode   = [System.Drawing.Drawing2D.CompositingMode]::SourceOver
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.SmoothingMode     = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.PixelOffsetMode   = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.Clear([System.Drawing.Color]::Transparent)
        # Letterbox, don't stretch: fit the source inside the square canvas preserving
        # its aspect ratio, then centre it. A wide source (this project's own logo.png
        # is 4.3:1) would smear unrecognisably if forced edge-to-edge into a square.
        $scale = [Math]::Min($Size / $Source.Width, $Size / $Source.Height)
        $w = [Math]::Max(1, [int][Math]::Round($Source.Width * $scale))
        $h = [Math]::Max(1, [int][Math]::Round($Source.Height * $scale))
        $x = [int][Math]::Round(($Size - $w) / 2.0)
        $y = [int][Math]::Round(($Size - $h) / 2.0)
        $g.DrawImage($Source, $x, $y, $w, $h)
    } finally {
        $g.Dispose()
    }
    $ms = New-Object System.IO.MemoryStream
    try {
        $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        return , $ms.ToArray()
    } finally {
        $bmp.Dispose()
        $ms.Dispose()
    }
}

$src = [System.Drawing.Image]::FromFile((Resolve-Path -LiteralPath $SourcePng).Path)
try {
    $entries = @()
    foreach ($s in $Sizes) {
        $entries += [pscustomobject]@{ Size = $s; Png = (ConvertTo-ResizedPngBytes -Source $src -Size $s) }
    }
} finally {
    $src.Dispose()
}

# -- assemble the ICO container (ICONDIR + ICONDIRENTRY[] + PNG payloads) ----------
# https://en.wikipedia.org/wiki/ICO_(file_format) -- PNG-compressed entries are valid
# from Windows Vista onward and are what the real supplied app.ico already uses.
$ms = New-Object System.IO.MemoryStream
$bw = New-Object System.IO.BinaryWriter($ms)
try {
    $bw.Write([UInt16] 0)              # reserved, must be 0
    $bw.Write([UInt16] 1)              # image type: 1 = icon
    $bw.Write([UInt16] $entries.Count)

    $offset = 6 + (16 * $entries.Count)
    foreach ($e in $entries) {
        $sizeByte = if ($e.Size -ge 256) { 0 } else { $e.Size }   # 0 means 256 per the spec
        $bw.Write([byte] $sizeByte)    # width
        $bw.Write([byte] $sizeByte)    # height
        $bw.Write([byte] 0)            # colour palette size (0 = no palette / true colour)
        $bw.Write([byte] 0)            # reserved
        $bw.Write([UInt16] 1)          # colour planes
        $bw.Write([UInt16] 32)         # bits per pixel
        $bw.Write([UInt32] $e.Png.Length)
        $bw.Write([UInt32] $offset)
        $offset += $e.Png.Length
    }
    foreach ($e in $entries) { $bw.Write($e.Png) }
    $bw.Flush()

    $outDir = Split-Path -Parent $OutputIco
    if ($outDir -and -not (Test-Path -LiteralPath $outDir)) {
        New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }
    [System.IO.File]::WriteAllBytes($OutputIco, $ms.ToArray())
} finally {
    $bw.Dispose()
    $ms.Dispose()
}

Write-Host "Wrote $OutputIco  ($($entries.Count) size(s): $(($entries.Size -join ', ')) px)" -ForegroundColor Green
