<#
.SYNOPSIS
    What a bConnect address is, in one place.

.DESCRIPTION
    Dot-sourced by Install-BConnectMcp-UI.ps1 (the guided installer) and by
    Manage-BConnectMcp.ps1 (the configuration window). Both ask the operator for
    the same thing and must mean the same thing by it.

    A bConnect URL is https://<server>/bconnect. The scheme, the port and the
    virtual directory are fixed by the product; only the server varies. So both
    windows ask for the server and compose the rest, rather than asking an
    operator to retype four constants around the one variable -- a typo in any of
    the four produces a 401, because bConnect answers 401 rather than 404 for a
    route it does not recognise, and a 401 reads as a bad password.

    WHY THIS IS A SHARED FILE AND NOT TWO COPIES.
    The installer writes BCONNECT_BASE_URL; the configuration window reads it
    back, decides whether it is of the standard form, and can rewrite it. If the
    two disagreed by even a character -- /bConnect against /bconnect, a kept
    trailing slash -- then opening the configuration window on a working
    installation would show a "non-standard" address, or worse, silently propose
    a different one. Test-ManageGui.ps1 asserts that both windows load this file.

    These two functions are pure: text in, text out, no controls and no state.
    Each window keeps its own reader for its own boxes, because which box wins is
    a property of that window, not of the address.
#>

function ConvertTo-ServerHost {
    <#
    .SYNOPSIS
        Whatever was typed, reduced to host or host:port.
    .DESCRIPTION
        Tolerant of a pasted URL on purpose. Both fields asked for a whole URL
        before this existed, so the first thing a returning operator does is paste
        one in; taking the host out of it is a line of code, and a validation
        error would be a worse answer to an input that says exactly what was meant.

        An IP address and a bare hostname pass through unchanged. Neither is
        rejected -- both are legitimate ways to reach a bMS -- but the caller's
        hint text is where the consequence belongs: the name has to match the
        server's certificate, and an IP address usually does not.
    #>
    param([string] $Text)
    $t = ([string]$Text).Trim()
    if (-not $t) { return '' }
    $t = $t -replace '^\s*[a-zA-Z][a-zA-Z0-9+.-]*://', ''   # a pasted scheme
    $t = $t -replace '/.*$', ''                              # a pasted path
    return $t.Trim().TrimEnd('.')
}

function Get-ComposedBaseUrl {
    <#
    .SYNOPSIS
        The bConnect address a typed server produces, or '' for empty input.
    .DESCRIPTION
        A port survives: host:8443 composes to https://host:8443/bconnect. The
        port is part of the server's address, not of the path.

        This is also the test for whether a STORED address is of the standard
        form: recompose it and compare for equality. Equality, not a pattern --
        a pattern decides what looks standard, equality proves that showing the
        server name and composing from it would reproduce the stored value
        exactly. Anything else belongs in the window's full-address box, because
        the alternative is a window that shows one address and writes another.
    #>
    param([string] $Text)
    $h = ConvertTo-ServerHost $Text
    if (-not $h) { return '' }
    return ('https://' + $h + '/bconnect')
}
