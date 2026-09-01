<#
.SYNOPSIS
    The one palette both windows are drawn from, and the two brush/thickness helpers.

.DESCRIPTION
    Dot-sourced by Install-BConnectMcp-UI.ps1 (the guided installer) and by
    Manage-BConnectMcp.ps1 (the settings window). It exists because those are two
    applications from one vendor and they must not look like two products: a second
    copy of these values is a second product's chrome, arriving one edit at a time.

    Dot-sourcing rather than importing as a module is deliberate. The variables have
    to land in the caller's own scope, and lib\Test-WizardTheme.ps1 reads $C and $Con
    out of that scope after dot-sourcing the wizard -- so the palette a test measures
    is the palette a window paints with, with nothing in between.

        . (Join-Path $LibDir 'Theme.ps1')

    The XAML in each window still carries the same colours as literals, because XAML
    loaded from a string cannot reference a PowerShell variable. Test-WizardTheme.ps1
    and lib\Test-ManageGui.ps1 assert the literals against these values rather than
    trusting them to have been kept in step by hand.
#>

# Light theme, to match baramundi's other installers. Inverted from bPerfMon's dark
# palette (Win/Card/Border/Text roles kept, values flipped) with the brand colour
# corrected to #014380 (sampled directly from the supplied logo.png -- the five most
# common non-white pixel colours in that file are #014380, #024280, #014282, #02427f,
# #004380, all the same navy within antialiasing noise; there is no orange anywhere in
# the mark). Every text/background pair below was checked against the WCAG 2.x contrast
# formula, not eyeballed -- see lib\Test-WizardTheme.ps1, which asserts the same ratios
# reported in the handoff notes. Nobody has looked at this on a screen; only the maths
# has been checked.
#
#   Txt on Card ......... 16.24:1   Muted on Card ........ 6.63:1
#   Faint on Card ........ 4.58:1   Navy accent on Card ... 9.93:1 (white text on navy also 9.93:1)
#   Ok/Warn/Crit on Card .. 5.3-5.7:1, and again >=4.76:1 on their own tint backgrounds
#
# All clear the 4.5:1 AA threshold for normal text; the accent clears AAA (7:1).
$C = @{
    Win='#F4F4F6'; Card='#FFFFFF'; Card2='#F0F1F3'; Border='#DDDDDD'; Track='#D8D8D8'
    Title='#014380'; Brand='#014380'; Accent='#014380'; Accent2='#0C6FA6'
    Txt='#202024'; Muted='#5C5C63'; Faint='#75757B'
    Ok='#1E7B34'; Warn='#9A5B00'; Crit='#C4281F'
    OkBg='#E9F5EC'; WarnBg='#FBF1E0'; CritBg='#FBEAE8'
}

# The output pane on a run page is a deliberate exception: it renders the wrapped
# script's own Write-Host colours (Green/Yellow/Red/Cyan/Gray/DarkGray/White/
# DarkYellow) verbatim, and that seven-colour mapping only reads cleanly against a
# dark backdrop -- recolouring the pane to match the light chrome would mean inventing
# a new mapping that no longer corresponds to what PowerShell actually sent. So the
# console keeps a dark "terminal well" (bPerfMon's original values, with two colours
# darkened further for AA once measured against #141417 rather than the old #1C1C1F:
# DarkCyan and the DarkGray/Faint mapping both fell short of 4.5:1 at their original
# values and were adjusted until they cleared it). Everything outside such a pane is
# the light palette above.
$Con = @{
    Bg='#141417'; Border='#2E2E34'; Text='#C8C8CC'; Faint='#8C8C90'
    Ok='#5FCF6A'; Warn='#E6A23C'; Crit='#E0524D'; Accent='#2EA0DD'
    DarkCyan='#5B93A6'; Gray='#B4B4BA'; DarkGray='#8C8C90'; White='#FFFFFF'; DarkYellow='#B8912F'
}

function Br($h) { (New-Object System.Windows.Media.BrushConverter).ConvertFromString($h) }
function Thk($a, $b, $c, $d) { New-Object System.Windows.Thickness($a, $b, $c, $d) }
