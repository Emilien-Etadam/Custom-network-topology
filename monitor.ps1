# monitor.ps1 (fast configurable version)
Write-Host "Starting Network Monitor (Configurable Fast Mode) with Uptime Tracking..." -ForegroundColor Cyan

$configPath = ".\config.json"

# === CONFIGURATION ===
$scanIntervalMs = 1000      # How often to perform a full scan (milliseconds).
$pingTimeoutMs   = 300      # Timeout for ICMP ping in ms
$portTimeoutMs   = 300      # Timeout for TCP connect in ms
# ======================

# State tracking for Uptime
$stateStore = @{} 

function Test-PingFast {
    param($Address, $TimeoutMs = 300)
    if ([string]::IsNullOrWhiteSpace($Address)) { return $false }
    try {
        $ping = New-Object System.Net.NetworkInformation.Ping
        $reply = $ping.Send($Address, [int]$TimeoutMs)
        if ($reply -ne $null) {
            return ($reply.Status -eq "Success")
        }
        return $false
    } catch {
        return $false
    }
}

function Test-PortFast {
    param($Address, $Port, $TimeoutMs = 300)
    if ([string]::IsNullOrWhiteSpace($Address) -or -not $Port) { return $false }
    try {
        $tcp = New-Object System.Net.Sockets.TcpClient
        $iar = $tcp.BeginConnect($Address, [int]$Port, $null, $null)
        $wait = $iar.AsyncWaitHandle.WaitOne([int]$TimeoutMs, $false)
        if (-not $wait) {
            $tcp.Close()
            return $false
        }
        $tcp.EndConnect($iar)
        $tcp.Close()
        return $true
    } catch {
        return $false
    }
}

function Get-DurationString {
    param($TimeSpan)
    if ($TimeSpan.TotalDays -ge 1) {
        return "{0}d {1}h {2}m" -f $TimeSpan.Days, $TimeSpan.Hours, $TimeSpan.Minutes
    } elseif ($TimeSpan.TotalHours -ge 1) {
        return "{0}h {1}m" -f $TimeSpan.Hours, $TimeSpan.Minutes
    } elseif ($TimeSpan.TotalMinutes -ge 1) {
        return "{0}m {1}s" -f $TimeSpan.Minutes, $TimeSpan.Seconds
    } else {
        return "{0}s" -f $TimeSpan.Seconds
    }
}

# Convert interval into whole seconds and milliseconds for Start-Sleep usage
$intervalSeconds = [math]::Floor($scanIntervalMs / 1000)
$intervalRemainderMs = $scanIntervalMs % 1000

while ($true) {
    if (-not (Test-Path $configPath)) {
        Write-Host "Error: config.json not found! Ensure it's in the same directory." -ForegroundColor Red
        Start-Sleep -Seconds 1
        continue
    }

    $jsonContent = Get-Content -Path $configPath -Raw
    try {
        $configData = $jsonContent | ConvertFrom-Json
    } catch {
        Write-Host "Error reading JSON configuration." -ForegroundColor Red
        Start-Sleep -Seconds 1
        continue
    }

    # Handle new structure (Object) vs old structure (Array)
    if ($configData -is [Array]) {
        $rawNodes = $configData
        $settings = @{ showGrid = $true }
    } else {
        $rawNodes = $configData.nodes
        $settings = $configData.settings
    }

    # Normalize nodes
    $nodes = @()
    foreach ($n in $rawNodes) {
        $nodes += [PSCustomObject]@{
            id = $n.id
            name = $n.name
            address = $n.address
            port = if ($null -ne $n.port -and $n.port -ne '') { [int]$n.port } else { $null }
            primaryParentId = if ($n.primaryParentId -and $n.primaryParentId -ne '') { $n.primaryParentId } else { $null }
            secondaryParentId = if ($n.secondaryParentId -and $n.secondaryParentId -ne '') { $n.secondaryParentId } else { $null }
            icon = $n.icon
            iconType = $n.iconType
            x = if ($n.x -ne $null) { $n.x } else { $null }
            y = if ($n.y -ne $null) { $n.y } else { $null }
        }
    }

    $startTime = Get-Date
    $statuses = @{}

    # Perform checks
    foreach ($entry in $nodes) {
        if ([string]::IsNullOrWhiteSpace($entry.address)) {
            $statuses[$entry.id] = $false
            continue
        }

        if ($entry.port -ne $null) {
            $up = Test-PortFast -Address $entry.address -Port $entry.port -TimeoutMs $portTimeoutMs
        } else {
            $up = Test-PingFast -Address $entry.address -TimeoutMs $pingTimeoutMs
        }
        $statuses[$entry.id] = [bool]$up
    }

    # Process logic
    $finalResults = @()
    $now = Get-Date

    foreach ($entry in $nodes) {
        # 1. State / Uptime Logic
        $isUp = $statuses[$entry.id]
        if (-not $stateStore.ContainsKey($entry.id)) {
            # First run seen
            $stateStore[$entry.id] = @{ Status = $isUp; ChangeTime = $now }
        } elseif ($stateStore[$entry.id].Status -ne $isUp) {
            # Status changed
            $stateStore[$entry.id].Status = $isUp
            $stateStore[$entry.id].ChangeTime = $now
        }
        
        $durationSpan = $now - $stateStore[$entry.id].ChangeTime
        $uptimeString = Get-DurationString -TimeSpan $durationSpan

        # 2. Failover Logic
        $primaryId = $entry.primaryParentId
        $secondaryId = $entry.secondaryParentId
        $primaryUp = $false
        $secondaryUp = $false

        if ($primaryId -and $statuses.ContainsKey($primaryId)) { $primaryUp = $statuses[$primaryId] }
        if ($secondaryId -and $statuses.ContainsKey($secondaryId)) { $secondaryUp = $statuses[$secondaryId] }

        $activeParentId = $null
        if ($primaryUp) { $activeParentId = $primaryId }
        elseif ($secondaryUp) { $activeParentId = $secondaryId }
        else { $activeParentId = $primaryId } 

        $finalResults += [PSCustomObject]@{
            id = $entry.id
            name = $entry.name
            address = $entry.address
            port = $entry.port
            status = $isUp
            icon = $entry.icon
            iconType = $entry.iconType
            primaryParentId = $entry.primaryParentId
            secondaryParentId = $entry.secondaryParentId
            activeParentId = $activeParentId
            x = $entry.x
            y = $entry.y
            uptime = $uptimeString # New Field
        }
    }

    $duration = ((Get-Date) - $startTime).TotalMilliseconds
    Write-Host ("Updated {0} hosts in {1}ms." -f $finalResults.Count, [math]::Round($duration))

    $output = @{
        updated = (Get-Date).ToString("HH:mm:ss")
        settings = $settings
        nodes = $finalResults
    }

    $jsonOutput = $output | ConvertTo-Json -Depth 4 -Compress
    $jsContent = "setNetworkData($jsonOutput);"
    $jsContent | Out-File -FilePath "status.js" -Encoding utf8 -Force

    if ($intervalSeconds -gt 0) { Start-Sleep -Seconds $intervalSeconds }
    if ($intervalRemainderMs -gt 0) { Start-Sleep -Milliseconds $intervalRemainderMs }
}
