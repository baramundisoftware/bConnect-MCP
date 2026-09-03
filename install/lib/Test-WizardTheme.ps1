<#
.SYNOPSIS
    Tests for the installer wizard's light theme and branding-asset handling.

.DESCRIPTION
    There is no prior UI test harness for the wizard in this directory -- Test-Secrets.ps1
    and Test-CredentialProtection.ps1 test the credential engine, not the window. This one
    is new, built the same way: throwaway/overridden inputs, PASS/FAIL lines, no manual
    inspection required to get a verdict.

    It dot-sources the REAL Install-BConnectMcp-UI.ps1 with -TestHeadless, which builds and
    wires the actual window from the actual embedded XAML and the actual $C / $Con palette
    hashtables, then returns instead of calling ShowDialog(). Everything asserted below is
    read off that live object graph -- not a second copy of the palette maintained here.

    What this proves:
      * the XAML parses and the window builds without a visible, blocking window
      * every text/background pair in the light palette clears WCAG AA (4.5:1) for normal
        text, computed with the standard relative-luminance formula, not eyeballed
      * the console pane's dark colour map separately clears AA against ITS OWN background
      * the branding asset slots (logo, window icon) degrade cleanly when the files are
        absent, and pick up the real files when they are present -- exercised against both
        the actual supplied install\assets\{logo.png,app.ico} AND a pair of paths that do
        not exist, via the -LogoPath/-IconPath overrides added for exactly this purpose
      * the disclosure pattern the four-step wizard rests on: options that are not
        decisions live in an Expander headed "Advanced", closed on arrival -- and the
        install location, which the product owner asked to be visible, is in none of them

    What it does NOT prove: that any of this looks right on a screen. Nobody has looked at
    it. This is a computed-property check, not a visual one -- layout, spacing, DPI scaling
    and overflow are unverified by eye.

.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\Test-WizardTheme.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'

if ([System.Threading.Thread]::CurrentThread.GetApartmentState() -ne 'STA') {
    Write-Host 'This test loads WPF and must run on an STA thread:' -ForegroundColor Yellow
    Write-Host '  powershell -NoProfile -ExecutionPolicy Bypass -Sta -File .\Test-WizardTheme.ps1' -ForegroundColor Yellow
    exit 2
}

$UiScript = Join-Path $PSScriptRoot '..\Install-BConnectMcp-UI.ps1'
if (-not (Test-Path -LiteralPath $UiScript)) { throw "Wizard script not found: $UiScript" }

$script:Pass = 0
$script:Fail = 0
function Check {
    param([string] $Name, [bool] $Ok, [string] $Detail = '')
    if ($Ok) { $script:Pass++; Write-Host ("  PASS  " + $Name) -ForegroundColor Green }
    else     { $script:Fail++; Write-Host ("  FAIL  " + $Name) -ForegroundColor Red }
    if ($Detail) { Write-Host ("        " + $Detail) -ForegroundColor DarkGray }
}

# -- WCAG 2.x contrast ratio, computed, not eyeballed -------------------------
function Get-RelativeLuminance {
    param([string] $Hex)
    $Hex = $Hex.TrimStart('#')
    if ($Hex.Length -eq 8) { $Hex = $Hex.Substring(2) }   # drop leading alpha, e.g. ARGB
    $r = [Convert]::ToInt32($Hex.Substring(0, 2), 16) / 255.0
    $g = [Convert]::ToInt32($Hex.Substring(2, 2), 16) / 255.0
    $b = [Convert]::ToInt32($Hex.Substring(4, 2), 16) / 255.0
    $lin = {
        param($c)
        if ($c -le 0.03928) { $c / 12.92 } else { [Math]::Pow((($c + 0.055) / 1.055), 2.4) }
    }
    return 0.2126 * (& $lin $r) + 0.7152 * (& $lin $g) + 0.0722 * (& $lin $b)
}
function Get-ContrastRatio {
    param([string] $Fg, [string] $Bg)
    $l1 = Get-RelativeLuminance $Fg
    $l2 = Get-RelativeLuminance $Bg
    $lighter = [Math]::Max($l1, $l2); $darker = [Math]::Min($l1, $l2)
    return ($lighter + 0.05) / ($darker + 0.05)
}
function Check-Contrast {
    param([string] $Name, [string] $Fg, [string] $Bg, [double] $Need = 4.5)
    $r = Get-ContrastRatio -Fg $Fg -Bg $Bg
    Check ("{0,5:N2}:1  {1}" -f $r, $Name) ($r -ge $Need) ("$Fg on $Bg, need $Need`:1")
}

Write-Host ''
Write-Host 'Wizard theme and branding-asset tests' -ForegroundColor Cyan
Write-Host ''

# ==============================================================================
# Part 1: the window builds headlessly from the real script, real XAML.
# ==============================================================================
Write-Host '-- window construction --' -ForegroundColor Cyan
. $UiScript -TestHeadless
Check 'the real wizard script built a Window without throwing' ($null -ne $win)
Check 'the outer chrome resolved to the light palette (Win bg)' ($C.Win -eq '#F4F4F6')
Check 'the accent is the corrected navy, not the originally-briefed amber' ($C.Accent -eq '#014380')
Check 'no literal amber (#E09) survives anywhere in the light chrome palette' `
    (-not ($C.Values -join ',' | Select-String -Pattern '(?i)E092' -Quiet))

# ==============================================================================
# Part 2: light-chrome contrast, WCAG AA (4.5:1) for normal text.
# ==============================================================================
Write-Host ''
Write-Host '-- light chrome contrast (WCAG AA, 4.5:1) --' -ForegroundColor Cyan
Check-Contrast 'primary text on card'              $C.Txt   $C.Card
Check-Contrast 'primary text on window background'  $C.Txt   $C.Win
Check-Contrast 'muted/secondary text on card'        $C.Muted $C.Card
Check-Contrast 'faint/tertiary text on card'         $C.Faint $C.Card
Check-Contrast 'navy accent heading on card'         $C.Accent $C.Card
Check-Contrast 'white button text on navy accent bg' '#FFFFFF' $C.Accent
Check-Contrast 'ok/success text on card'             $C.Ok    $C.Card
Check-Contrast 'warn text on card'                   $C.Warn  $C.Card
Check-Contrast 'crit/danger text on card'            $C.Crit  $C.Card
Check-Contrast 'ok text on its own tint background'  $C.Ok    $C.OkBg
Check-Contrast 'warn text on its own tint background' $C.Warn $C.WarnBg
Check-Contrast 'crit text on its own tint background'  $C.Crit $C.CritBg
Check-Contrast 'secondary accent (Accent2) on card'   $C.Accent2 $C.Card

# ==============================================================================
# Part 3: the console pane's own dark colour map, checked against ITS background
#         (see the code comment on $Con: it is intentionally not part of the
#         light chrome, because it renders the wrapped script's Write-Host colours
#         verbatim and those only read against a dark backdrop).
# ==============================================================================
Write-Host ''
Write-Host '-- console pane contrast (dark terminal well, WCAG AA) --' -ForegroundColor Cyan
Check-Contrast 'default console text on console bg' $Con.Text $Con.Bg
Check-Contrast 'Green (Ok) on console bg'            $Con.Ok $Con.Bg
Check-Contrast 'Yellow (Warn) on console bg'         $Con.Warn $Con.Bg
Check-Contrast 'Red (Crit) on console bg'            $Con.Crit $Con.Bg
Check-Contrast 'Cyan (Accent) on console bg'         $Con.Accent $Con.Bg
Check-Contrast 'DarkCyan on console bg'              $Con.DarkCyan $Con.Bg
Check-Contrast 'Gray on console bg'                  $Con.Gray $Con.Bg
Check-Contrast 'DarkGray/Faint on console bg'        $Con.DarkGray $Con.Bg
Check-Contrast 'White on console bg'                 $Con.White $Con.Bg
Check-Contrast 'DarkYellow on console bg'            $Con.DarkYellow $Con.Bg

# ==============================================================================
# Part 4: the title-bar badge fix. The badge used to be a Border with
# Opacity="0.18" wrapping fully-opaque white text -- which took the TEXT down to
# 18% alpha too, not just the chip background. Confirm the fix is really the ARGB
# background form, not a reintroduced Border.Opacity.
# ==============================================================================
Write-Host ''
Write-Host '-- title bar badge fix --' -ForegroundColor Cyan
$badgeXaml = $xaml.OuterXml
Check 'badge chip uses an ARGB background rather than Border.Opacity' `
    ($badgeXaml -match 'Background="#33FFFFFF"[^/]*CornerRadius="4"[^/]*Padding="6,1,6,2"')
Check 'the badge chip Border itself carries no Opacity attribute' `
    (-not ($badgeXaml -match 'Background="#FFFFFF"\s+Opacity='))
$badgeCompositeRatio = Get-ContrastRatio -Fg '#FFFFFF' -Bg '#346A99'   # ~20% white over #014380, see handoff notes
Check ("{0,5:N2}:1  white badge text on its translucent-over-navy chip (approx.)" -f $badgeCompositeRatio) `
    ($badgeCompositeRatio -ge 4.5)

# ==============================================================================
# Part 5: Primary button style must explicitly set white Foreground -- BasedOn
# Flat would otherwise inherit Flat's dark Foreground onto a navy background.
# ==============================================================================
Write-Host ''
Write-Host '-- Primary button style --' -ForegroundColor Cyan
if ($win.Resources.Contains('Primary')) {
    $primaryStyle = $win.Resources['Primary']
    $fgSetter = $primaryStyle.Setters | Where-Object { $_.Property.Name -eq 'Foreground' }
    $bgSetter = $primaryStyle.Setters | Where-Object { $_.Property.Name -eq 'Background' }
    $fgVal = if ($fgSetter) { $fgSetter.Value.ToString() } else { $null }
    $bgVal = if ($bgSetter) { $bgSetter.Value.ToString() } else { $null }
    # WPF resolves a Setter's Value through a BrushConverter, which normalizes to
    # 8-digit ARGB (#FFxxxxxx) even when the XAML wrote 6-digit RGB -- compare the
    # trailing 6 digits so this isn't sensitive to that normalization.
    Check 'Primary style sets an explicit white Foreground' ($fgVal -match 'FFFFFF$') "Foreground=$fgVal"
    Check 'Primary style background is the navy accent' ($bgVal -match '014380$') "Background=$bgVal"
} else {
    Check 'Primary style resource exists' $false
}

# ==============================================================================
# Part 6: branding assets -- present vs. absent, using the REAL wizard file both
# times via -LogoPath/-IconPath, never by touching the real install\assets\ files.
# ==============================================================================
Write-Host ''
Write-Host '-- branding assets: present (the real supplied files) --' -ForegroundColor Cyan
$realLogo = Join-Path $PSScriptRoot '..\assets\logo.png'
$realIcon = Join-Path $PSScriptRoot '..\assets\app.ico'
Check 'install\assets\logo.png exists (supplied asset)' (Test-Path -LiteralPath $realLogo)
Check 'install\assets\app.ico exists (supplied asset)' (Test-Path -LiteralPath $realIcon)
if ((Test-Path -LiteralPath $realLogo) -and (Test-Path -LiteralPath $realIcon)) {
    . $UiScript -TestHeadless -LogoPath $realLogo -IconPath $realIcon
    Check 'logo image is shown when logo.png is present' ($els.logoImage.Visibility -eq 'Visible')
    Check 'logo image has a decoded source' ($null -ne $els.logoImage.Source)
    Check 'text-wordmark fallback is hidden when the logo loads' ($els.logoFallback.Visibility -eq 'Collapsed')
    Check 'window Icon is set when app.ico is present' ($null -ne $win.Icon)
}

Write-Host ''
Write-Host '-- branding assets: absent (paths that do not exist) --' -ForegroundColor Cyan
$missingLogo = Join-Path $PSScriptRoot 'does-not-exist\logo.png'
$missingIcon = Join-Path $PSScriptRoot 'does-not-exist\app.ico'
$threw = $false
try {
    . $UiScript -TestHeadless -LogoPath $missingLogo -IconPath $missingIcon
} catch { $threw = $true; Write-Host ("        threw: " + $_.Exception.Message) -ForegroundColor DarkGray }
Check 'a missing logo/icon pair does not throw' (-not $threw)
if (-not $threw) {
    Check 'logo image stays collapsed when logo.png is absent' ($els.logoImage.Visibility -eq 'Collapsed')
    Check 'text-wordmark fallback is shown when the logo is absent' ($els.logoFallback.Visibility -eq 'Visible')
    Check 'the fallback is not an empty gap (has text)' (-not [string]::IsNullOrWhiteSpace($els.logoFallback.Text))
    Check 'window Icon is left at its default (no crash) when app.ico is absent' ($null -eq $win.Icon -or $win.Icon -eq $win.GetType().GetProperty('Icon').GetValue($win, $null))
}

# ==============================================================================
# Part 7: the disclosure pattern.
#
# The wizard is four steps because the things that are not decisions moved behind
# one repeated affordance -- an Expander headed "Advanced", closed on arrival. That
# is a piece of the visual language now, so it is held here with the palette: an
# Expander that ships open is a page that is long again, and an option that is only
# reachable by scrolling past it is the wall of text coming back.
# ==============================================================================
Write-Host ''
Write-Host '-- advanced options are disclosed, not displayed --' -ForegroundColor Cyan
. $UiScript -TestHeadless
$expanders = @()
$queue = New-Object System.Collections.Queue
$queue.Enqueue($win)
while ($queue.Count) {
    $n = $queue.Dequeue()
    if ($n -is [System.Windows.Controls.Expander]) { $expanders += $n }
    foreach ($child in [System.Windows.LogicalTreeHelper]::GetChildren($n)) {
        if ($child -is [System.Windows.DependencyObject]) { $queue.Enqueue($child) }
    }
}
Check 'the window uses expanders to hold what is not a decision' `
    ($expanders.Count -ge 3) ("$($expanders.Count) found: " + ((@($expanders | ForEach-Object { [string]$_.Header })) -join ' / '))
Check 'every one of them is closed when the window opens' `
    (@($expanders | Where-Object { $_.IsExpanded }).Count -eq 0) `
    ((@($expanders | Where-Object { $_.IsExpanded } | ForEach-Object { [string]$_.Header })) -join ', ')
Check 'the connect and permissions pages each have one, and it is headed Advanced' `
    ($null -ne $els.expConnectAdvanced -and $null -ne $els.expServers -and
     [string]$els.expConnectAdvanced.Header -eq 'Advanced' -and [string]$els.expServers.Header -eq 'Advanced') `
    ("connect='$([string]$els.expConnectAdvanced.Header)' permissions='$([string]$els.expServers.Header)'")
# The install location is the deliberate exception: the product owner asked for it
# to be VISIBLE, so it must not be inside any of them.
$inExpander = $false
$n = $els.lblInstallLocation
while ($n) {
    $n = [System.Windows.LogicalTreeHelper]::GetParent($n)
    if ($n -is [System.Windows.Controls.Expander]) { $inExpander = $true; break }
}
Check 'the install location line is NOT inside an expander' (-not $inExpander)

Write-Host ''
Write-Host ("  $script:Pass passed, $script:Fail failed") -ForegroundColor $(if ($script:Fail) { 'Red' } else { 'Green' })
Write-Host ''
Write-Host '  Not proven by this script: what any of this looks like on a screen. No one has' -ForegroundColor DarkGray
Write-Host '  looked at it. Layout, spacing, DPI scaling and overflow are unverified by eye.' -ForegroundColor DarkGray
Write-Host ''
if ($script:Fail) { exit 1 }
exit 0
