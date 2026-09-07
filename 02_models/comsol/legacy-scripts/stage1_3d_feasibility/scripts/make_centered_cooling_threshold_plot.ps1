$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

Add-Type -AssemblyName System.Drawing

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$root = [System.IO.Path]::GetFullPath((Join-Path $scriptDir '..'))
$tables = Join-Path $root 'tables\centered'
$figDir = Join-Path $root 'figures\centered\scans'
$coolingRoot = Join-Path $tables 'cooling_scan_final'
$actualCsv = Join-Path $tables 'cooling_threshold_actual_summary.csv'
$fitCsv = Join-Path $tables 'cooling_threshold_fit_summary.csv'
$png = Join-Path $figDir 'neon_density_threshold_cooling_time_loglog.png'

New-Item -ItemType Directory -Force -Path $figDir | Out-Null

$culture = [System.Globalization.CultureInfo]::InvariantCulture

function Parse-Double([string]$text) {
    return [double]::Parse($text, $culture)
}

function Get-DensityFromName([string]$name) {
    if ($name -notmatch '^n_(.+)$') {
        return [double]::NaN
    }
    $token = $Matches[1].Replace('p', '.').Replace('P', '.')
    try {
        return Parse-Double $token
    } catch {
        return [double]::NaN
    }
}

function Read-ParticleTable([string]$path) {
    $rows = New-Object 'System.Collections.Generic.List[double[]]'
    foreach ($raw in Get-Content -LiteralPath $path) {
        $line = $raw.Trim()
        if (-not $line -or $line.StartsWith('%')) {
            continue
        }
        $tokens = $line.Split(',')
        $values = New-Object double[] $tokens.Length
        for ($i = 0; $i -lt $tokens.Length; $i++) {
            $tok = $tokens[$i].Trim()
            if ([string]::IsNullOrWhiteSpace($tok)) {
                $values[$i] = [double]::NaN
            } else {
                $values[$i] = Parse-Double $tok
            }
        }
        $rows.Add($values)
    }
    if ($rows.Count -eq 0) {
        return $null
    }
    $time = New-Object double[] $rows.Count
    $valuesOut = New-Object 'double[][]' $rows.Count
    for ($i = 0; $i -lt $rows.Count; $i++) {
        $time[$i] = $rows[$i][0]
        $valuesOut[$i] = $rows[$i]
    }
    return @{
        Time   = $time
        Values = $valuesOut
    }
}

function Get-FirstCrossing([double[]]$time, [double[][]]$values, [double]$threshold) {
    if ($null -eq $values -or $values.Count -eq 0) {
        return @()
    }
    $nParticles = $values[0].Length
    $out = New-Object double[] $nParticles
    for ($j = 0; $j -lt $nParticles; $j++) {
        $out[$j] = [double]::NaN
        for ($i = 0; $i -lt $time.Length; $i++) {
            $y = $values[$i][$j]
            if ([double]::IsNaN($y) -or [double]::IsNaN($time[$i])) {
                continue
            }
            if ($y -le $threshold) {
                if ($i -eq 0) {
                    $out[$j] = $time[$i]
                    break
                }
                $prev = $i - 1
                while ($prev -ge 0 -and [double]::IsNaN($values[$prev][$j])) {
                    $prev--
                }
                if ($prev -lt 0 -or [double]::IsNaN($time[$prev]) -or $values[$prev][$j] -eq $y) {
                    $out[$j] = $time[$i]
                    break
                }
                $fraction = ($threshold - $values[$prev][$j]) / ($y - $values[$prev][$j])
                if ($fraction -lt 0) { $fraction = 0 }
                if ($fraction -gt 1) { $fraction = 1 }
                $out[$j] = $time[$prev] + $fraction * ($time[$i] - $time[$prev])
                break
            }
        }
    }
    return $out
}

function Get-Percentile([double[]]$values, [double]$q) {
    $finite = New-Object System.Collections.Generic.List[double]
    foreach ($v in $values) {
        if (-not [double]::IsNaN($v) -and -not [double]::IsInfinity($v)) {
            $finite.Add($v)
        }
    }
    if ($finite.Count -eq 0) {
        return [double]::NaN
    }
    $sorted = $finite.ToArray()
    [Array]::Sort($sorted)
    if ($sorted.Length -eq 1) {
        return [double]$sorted[0]
    }
    $rank = ($q / 100.0) * ($sorted.Length - 1)
    $lo = [math]::Floor($rank)
    $hi = [math]::Ceiling($rank)
    if ($lo -eq $hi) {
        return [double]$sorted[$lo]
    }
    $frac = $rank - $lo
    return [double]$sorted[$lo] + $frac * ([double]$sorted[$hi] - [double]$sorted[$lo])
}

function Format-Scientific([double]$value) {
    if ($value -le 0 -or [double]::IsNaN($value) -or [double]::IsInfinity($value)) {
        return ''
    }
    $exp = [math]::Round([math]::Log10($value))
    $mant = $value / [math]::Pow(10.0, $exp)
    if ([math]::Abs($mant - 1.0) -lt 0.15) {
        return ('1e{0}' -f $exp)
    }
    return ('{0:0.#}e{1}' -f $mant, $exp)
}

function Format-TimeLabel([double]$value) {
    if ($value -lt 10) { return ('{0:0.#}' -f $value) }
    if ($value -lt 1000) {
        return ('{0:0}' -f $value)
    }
    return ('1e{0}' -f [math]::Round([math]::Log10($value)))
}

function To-LogCoord([double]$value, [double]$min, [double]$max, [int]$pixelMin, [int]$pixelMax) {
    $logMin = [math]::Log10($min)
    $logMax = [math]::Log10($max)
    $t = ([math]::Log10($value) - $logMin) / ($logMax - $logMin)
    return [int]([math]::Round($pixelMin + $t * ($pixelMax - $pixelMin)))
}

function Draw-PanelLabel($g, [string]$text, [System.Drawing.Font]$font, [System.Drawing.Brush]$brush, [int]$x, [int]$y) {
    $g.DrawString($text, $font, $brush, $x, $y)
}

function Draw-ThresholdPlot(
    [string]$outPath,
    [object[]]$records,
    [object[]]$fitRows
) {
    $width = 1600
    $height = 1000
    $left = 140
    $top = 100
    $right = 280
    $bottom = 140
    $plot = New-Object System.Drawing.Rectangle($left, $top, $width - $left - $right, $height - $top - $bottom)
    $xMin = 1e19
    $xMax = 1e25
    $yMin = 1
    $yMax = 1e6

    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::White)

    $titleFont = New-Object System.Drawing.Font('Arial', 26, [System.Drawing.FontStyle]::Bold)
    $subFont = New-Object System.Drawing.Font('Arial', 14, [System.Drawing.FontStyle]::Regular)
    $axisFont = New-Object System.Drawing.Font('Arial', 15, [System.Drawing.FontStyle]::Regular)
    $legendFont = New-Object System.Drawing.Font('Arial', 15, [System.Drawing.FontStyle]::Regular)
    $noteFont = New-Object System.Drawing.Font('Arial', 13, [System.Drawing.FontStyle]::Regular)

    $penAxis = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(120, 130, 140), 2)
    $penGrid = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(225, 230, 235), 1)
    $penGridDash = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(150, 150, 150), 1)
    $penGridDash.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash

    $g.DrawString('Centered-source cooling time versus Ne density', $titleFont, [System.Drawing.Brushes]::DarkBlue, $left, 24)
    $subtitle = 'P90 first-crossing time to K_perp <= 10/30/50/70/90 eV. Solid markers are current solved cases; dashed lines are density-scaled continuation from the 1.5e24 m^-3 reference case.'
    $g.DrawString($subtitle, $subFont, [System.Drawing.Brushes]::DimGray, $left, 62)

    $g.DrawRectangle($penAxis, $plot)

    # Grid and ticks.
    for ($e = 19; $e -le 25; $e++) {
        $x = [math]::Pow(10.0, $e)
        $px = To-LogCoord $x $xMin $xMax $plot.Left $plot.Right
        $g.DrawLine($penGrid, $px, $plot.Top, $px, $plot.Bottom)
        $g.DrawLine($penAxis, $px, $plot.Bottom, $px, $plot.Bottom + 8)
        $label = ('1e{0}' -f $e)
        $size = $g.MeasureString($label, $axisFont)
        $g.DrawString($label, $axisFont, [System.Drawing.Brushes]::Black, $px - ($size.Width / 2), $plot.Bottom + 12)
    }
    for ($e = 0; $e -le 6; $e++) {
        $y = [math]::Pow(10.0, $e)
        $py = To-LogCoord $y $yMin $yMax $plot.Bottom $plot.Top
        $g.DrawLine($penGrid, $plot.Left, $py, $plot.Right, $py)
        $g.DrawLine($penAxis, $plot.Left - 8, $py, $plot.Left, $py)
        $label = Format-TimeLabel $y
        $size = $g.MeasureString($label, $axisFont)
        $g.DrawString($label, $axisFont, [System.Drawing.Brushes]::Black, $plot.Left - 14 - $size.Width, $py - ($size.Height / 2))
    }

    $xAxisLabel = 'Ne number density (m^-3, log scale)'
    $yAxisLabel = 'P90 cooling time to threshold (ns, log scale)'
    $g.DrawString($xAxisLabel, $axisFont, [System.Drawing.Brushes]::Black, $plot.Left + ($plot.Width / 2) - 120, $height - 70)
    $g.TranslateTransform(28, $plot.Top + ($plot.Height / 2) + 100)
    $g.RotateTransform(-90)
    $g.DrawString($yAxisLabel, $axisFont, [System.Drawing.Brushes]::Black, 0, 0)
    $g.ResetTransform()

    $thresholds = @(10, 30, 50, 70, 90)
    $colors = @{
        10 = [System.Drawing.Color]::FromArgb(47, 107, 154)
        30 = [System.Drawing.Color]::FromArgb(211, 123, 59)
        50 = [System.Drawing.Color]::FromArgb(61, 139, 114)
        70 = [System.Drawing.Color]::FromArgb(184, 74, 74)
        90 = [System.Drawing.Color]::FromArgb(138, 90, 168)
    }

    # Draw fit and actual data.
    foreach ($thr in $thresholds) {
        $color = $colors[$thr]
        $penSolid = New-Object System.Drawing.Pen($color, 3)
        $penFit = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(190, $color.R, $color.G, $color.B), 2)
        $penFit.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
        $brush = New-Object System.Drawing.SolidBrush($color)
        $fitRow = $fitRows | Where-Object { $_.threshold_eV -eq $thr } | Select-Object -First 1
        if ($null -ne $fitRow) {
            $fitConst = [double]$fitRow.fit_constant_ns_m3
            $fitPoints = New-Object System.Collections.Generic.List[System.Drawing.Point]
            for ($i = 0; $i -le 200; $i++) {
                $x = $xMin * [math]::Pow($xMax / $xMin, $i / 200.0)
                $y = $fitConst / $x
                if ($y -lt $yMin -or $y -gt $yMax) {
                    continue
                }
                $px = To-LogCoord $x $xMin $xMax $plot.Left $plot.Right
                $py = To-LogCoord $y $yMin $yMax $plot.Bottom $plot.Top
                $fitPoints.Add((New-Object System.Drawing.Point($px, $py)))
            }
            if ($fitPoints.Count -gt 1) {
                $g.DrawLines($penFit, $fitPoints.ToArray())
            }
        }

        $actual = $records | Where-Object { $_.threshold_eV -eq $thr } | Sort-Object density_m3
        $actualPoints = New-Object System.Collections.Generic.List[System.Drawing.Point]
        foreach ($row in $actual) {
            $x = [double]$row.density_m3
            $y = [double]$row.p90_censored_ns
            if ($x -le 0 -or $y -le 0 -or [double]::IsNaN($x) -or [double]::IsNaN($y)) {
                continue
            }
            $px = To-LogCoord $x $xMin $xMax $plot.Left $plot.Right
            $py = To-LogCoord $y $yMin $yMax $plot.Bottom $plot.Top
            $actualPoints.Add((New-Object System.Drawing.Point($px, $py)))
        }
        if ($actualPoints.Count -gt 1) {
            $g.DrawLines($penSolid, $actualPoints.ToArray())
        }
        foreach ($pt in $actualPoints) {
            $g.FillEllipse($brush, $pt.X - 5, $pt.Y - 5, 10, 10)
            $g.DrawEllipse([System.Drawing.Pens]::Black, $pt.X - 5, $pt.Y - 5, 10, 10)
        }
    }

    # Censoring horizon line.
    $yCensor = 100.0
    $pyC = To-LogCoord $yCensor $yMin $yMax $plot.Bottom $plot.Top
    $g.DrawLine($penGridDash, $plot.Left, $pyC, $plot.Right, $pyC)
    $g.DrawString('100 ns censoring horizon', $noteFont, [System.Drawing.Brushes]::Gray, $plot.Right - 180, $pyC - 22)

    # Legend.
    $legendX = $plot.Right + 30
    $legendY = $plot.Top + 20
    $g.DrawString('Threshold curves', $axisFont, [System.Drawing.Brushes]::Black, $legendX, $legendY)
    $legendY += 30
    foreach ($thr in $thresholds) {
        $color = $colors[$thr]
        $penLegend = New-Object System.Drawing.Pen($color, 3)
        $g.DrawLine($penLegend, $legendX, $legendY + 10, $legendX + 48, $legendY + 10)
        $g.FillEllipse((New-Object System.Drawing.SolidBrush($color)), $legendX + 18, $legendY + 4, 12, 12)
        $g.DrawEllipse([System.Drawing.Pens]::Black, $legendX + 18, $legendY + 4, 12, 12)
        $g.DrawString(('{0} eV' -f $thr), $legendFont, [System.Drawing.Brushes]::Black, $legendX + 60, $legendY)
        $legendY += 34
    }
    $legendY += 10
    $fitPenLegend = New-Object System.Drawing.Pen([System.Drawing.Color]::Gray, 2)
    $fitPenLegend.DashStyle = [System.Drawing.Drawing2D.DashStyle]::Dash
    $g.DrawLine($fitPenLegend, $legendX, $legendY + 10, $legendX + 48, $legendY + 10)
    $g.DrawString('dashed = n^-1 continuation', $legendFont, [System.Drawing.Brushes]::Black, $legendX + 60, $legendY)
    $legendY += 34
    $g.DrawLine($penGridDash, $legendX, $legendY + 10, $legendX + 48, $legendY + 10)
    $g.DrawString('100 ns censoring horizon', $legendFont, [System.Drawing.Brushes]::Black, $legendX + 60, $legendY)

    $footer = 'Current archive coverage: actual solved points are in n = 1e23 to 1.5e24 m^-3. Lower density behavior is an extrapolation of the density-linear stopping model already used by the Phase-A COMSOL setup.'
    $g.DrawString($footer, $noteFont, [System.Drawing.Brushes]::DimGray, $left, $height - 50)

    $bmp.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
}

$cases = @()
Get-ChildItem -LiteralPath $coolingRoot -Directory -ErrorAction SilentlyContinue | Sort-Object Name | ForEach-Object {
    if ($_.Name -notmatch '^n_') {
        return
    }
    $kp = Join-Path $_.FullName 'Kperp_eV.csv'
    if (-not (Test-Path -LiteralPath $kp)) {
        return
    }
    $data = Read-ParticleTable $kp
    if ($null -eq $data) {
        return
    }
    $cases += [pscustomobject]@{
        density_m3 = Get-DensityFromName $_.Name
        case = $_.FullName
        time = $data.Time
        values = $data.Values
    }
}

$thresholds = @(10, 30, 50, 70, 90)
$records = New-Object System.Collections.Generic.List[object]
$fitRows = New-Object System.Collections.Generic.List[object]

foreach ($case in ($cases | Sort-Object density_m3)) {
    foreach ($thr in $thresholds) {
        $cross = Get-FirstCrossing $case.time $case.values $thr
        $crossNs = New-Object double[] $cross.Length
        $censoredNs = New-Object double[] $cross.Length
        for ($i = 0; $i -lt $cross.Length; $i++) {
            if ([double]::IsNaN($cross[$i])) {
                $crossNs[$i] = [double]::NaN
                $censoredNs[$i] = 100.0
            } else {
                $crossNs[$i] = $cross[$i] * 1e9
                $censoredNs[$i] = $crossNs[$i]
            }
        }
        $p90 = Get-Percentile $crossNs 90
        $p90Censored = Get-Percentile $censoredNs 90
        $fractionReached = (($crossNs | Where-Object { -not [double]::IsNaN($_) }).Count) / [double]$crossNs.Length
        $records.Add([pscustomobject]@{
            threshold_eV = $thr
            density_m3 = [double]$case.density_m3
            n_particles = $crossNs.Length
            fraction_reached = [double]$fractionReached
            p90_first_cross_ns = [double]$p90
            p90_censored_ns = [double]$p90Censored
        })
    }
}

foreach ($thr in $thresholds) {
    $subset = $records | Where-Object { $_.threshold_eV -eq $thr } | Sort-Object density_m3
    $reference = $subset | Where-Object { $_.density_m3 -eq 1.5e24 } | Select-Object -First 1
    if ($null -eq $reference) {
        $reference = $subset | Where-Object { [double]::IsFinite($_.p90_first_cross_ns) } | Sort-Object density_m3 -Descending | Select-Object -First 1
    }
    $fitConstant = [double]::NaN
    if ($null -ne $reference -and [double]::IsFinite($reference.p90_first_cross_ns)) {
        $fitConstant = [double]$reference.density_m3 * [double]$reference.p90_first_cross_ns
    }
    $fitRows.Add([pscustomobject]@{
        threshold_eV = $thr
        ref_density_m3 = if ($null -ne $reference) { [double]$reference.density_m3 } else { [double]::NaN }
        ref_p90_ns = if ($null -ne $reference) { [double]$reference.p90_first_cross_ns } else { [double]::NaN }
        fit_constant_ns_m3 = $fitConstant
    })
}

$actualRecords = $records | Sort-Object threshold_eV, density_m3
$fitRecords = $fitRows | Sort-Object threshold_eV

function Write-ObjectCsv([string]$path, [object[]]$rows) {
    if ($rows.Count -eq 0) {
        return
    }
    $rows | Export-Csv -LiteralPath $path -NoTypeInformation -Encoding UTF8
}

Write-ObjectCsv $actualCsv $actualRecords
Write-ObjectCsv $fitCsv $fitRecords
Draw-ThresholdPlot $png $actualRecords $fitRecords

Write-Output $actualCsv
Write-Output $fitCsv
Write-Output $png
