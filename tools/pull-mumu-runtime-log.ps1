<#
.SYNOPSIS
    Pulls the newest persisted AutoJs6 runtime-log session from MuMu for AI analysis.

.DESCRIPTION
    The script only reads `/sdcard/水世界运行日志` from one connected MuMu emulator.
    It copies every JSONL segment and error screenshot for the newest session, then creates
    a small tail file that can be supplied to an AI without opening the full session log.
#>
[CmdletBinding()]
param(
    # Explicitly select a MuMu serial when more than one emulator is connected.
    [string]$Serial,

    # Override the verified MuMu adb location when MuMu is installed elsewhere.
    [string]$AdbPath,

    # Keep this many newest JSONL lines in the AI-oriented summary.
    [ValidateRange(1, 5000)]
    [int]$TailLines = 300
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RemoteLogDirectory = "/sdcard/水世界运行日志"
$WorkspaceRoot = Split-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) -Parent
$LocalLogRoot = Join-Path $WorkspaceRoot "_device_waterworld\runtime-logs"

<#
.SYNOPSIS
    Resolves the adb executable used to communicate with the local MuMu installation.
#>
function Resolve-AdbExecutable {
    param([string]$RequestedPath)

    if ($RequestedPath) {
        if (-not (Test-Path -LiteralPath $RequestedPath -PathType Leaf)) {
            throw "指定的 adb 不存在: $RequestedPath"
        }
        return (Resolve-Path -LiteralPath $RequestedPath).Path
    }

    $knownMuMuAdb = "F:\Program Files\Netease\MuMu\nx_main\adb.exe"
    if (Test-Path -LiteralPath $knownMuMuAdb -PathType Leaf) {
        return $knownMuMuAdb
    }

    throw "未找到 MuMu ADB: $knownMuMuAdb。请通过 -AdbPath 显式指定当前 MuMu 的 adb.exe。"
}

<#
.SYNOPSIS
    Executes adb and fails with its output so a partial pull is never reported as successful.
#>
function Invoke-AdbCommand {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $output = @(& $script:ResolvedAdbPath @Arguments)
    if ($LASTEXITCODE -ne 0) {
        throw "ADB 命令失败（$($Arguments -join ' ')）：$($output -join [Environment]::NewLine)"
    }
    return $output
}

<#
.SYNOPSIS
    Returns device serials that are fully online according to adb.
#>
function Get-OnlineDeviceSerials {
    $lines = Invoke-AdbCommand -Arguments @("devices")
    return @($lines | ForEach-Object {
        if ($_ -match "^(\S+)\s+device(?:\s|$)") { $matches[1] }
    } | Where-Object { $_ })
}

<#
.SYNOPSIS
    Selects one MuMu emulator and refuses to guess when multiple emulator instances exist.
#>
function Resolve-MuMuSerial {
    param([string]$RequestedSerial)

    $onlineSerials = Get-OnlineDeviceSerials
    if ($RequestedSerial) {
        if ($onlineSerials -notcontains $RequestedSerial) {
            throw "指定设备未在线: $RequestedSerial。在线设备: $($onlineSerials -join ', ')"
        }
        return $RequestedSerial
    }

    $emulatorSerials = @($onlineSerials | Where-Object { $_ -match "^emulator-" })
    if ($emulatorSerials.Count -ne 1) {
        throw "检测到 $($emulatorSerials.Count) 个 MuMu 模拟器，请用 -Serial 明确选择。在线设备: $($onlineSerials -join ', ')"
    }
    return $emulatorSerials[0]
}

<#
.SYNOPSIS
    Lists the durable runtime-log files on one emulator in newest-first order.
#>
function Get-RemoteRuntimeLogNames {
    param([Parameter(Mandatory = $true)][string]$DeviceSerial)

    $lines = Invoke-AdbCommand -Arguments @(
        "-s", $DeviceSerial,
        "shell", "ls -1t $RemoteLogDirectory 2>/dev/null"
    )
    return @($lines | ForEach-Object { $_.Trim() } | Where-Object { $_ })
}

<#
.SYNOPSIS
    Copies one device file through adb's raw stdout stream without relying on an ANSI-only pull path.

.DESCRIPTION
    MuMu's bundled adb can fail when `adb pull` receives a Chinese Windows destination path.
    Streaming bytes through exec-out keeps both UTF-8 JSONL and PNG evidence intact at the workspace path.
#>
function Copy-RemoteRuntimeFile {
    param(
        [Parameter(Mandatory = $true)][string]$DeviceSerial,
        [Parameter(Mandatory = $true)][string]$RemotePath,
        [Parameter(Mandatory = $true)][string]$DestinationPath
    )

    $processInfo = [System.Diagnostics.ProcessStartInfo]::new()
    $processInfo.FileName = $script:ResolvedAdbPath
    $processInfo.UseShellExecute = $false
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $processInfo.CreateNoWindow = $true
    foreach ($argument in @("-s", $DeviceSerial, "exec-out", "cat", $RemotePath)) {
        [void]$processInfo.ArgumentList.Add($argument)
    }

    $process = [System.Diagnostics.Process]::new()
    $process.StartInfo = $processInfo
    if (-not $process.Start()) {
        throw "无法启动 adb 以拉取 $RemotePath"
    }

    $stream = $null
    $completed = $false
    try {
        # 使用 CreateNew 防止意外覆盖已经拉回的 AI 诊断快照。
        $stream = [System.IO.File]::Open(
            $DestinationPath,
            [System.IO.FileMode]::CreateNew,
            [System.IO.FileAccess]::Write,
            [System.IO.FileShare]::None
        )
        $process.StandardOutput.BaseStream.CopyTo($stream)
        $stream.Close()
        $stream = $null
        $standardError = $process.StandardError.ReadToEnd()
        $process.WaitForExit()
        if ($process.ExitCode -ne 0) {
            throw "ADB 无法拉取 $RemotePath：$standardError"
        }
        $completed = $true
    } finally {
        if ($stream) { $stream.Dispose() }
        $process.Dispose()
        if (-not $completed -and (Test-Path -LiteralPath $DestinationPath)) {
            # 仅移除本次新建且未完成的文件，避免 AI 误把半截日志当完整诊断数据。
            Remove-Item -LiteralPath $DestinationPath -Force
        }
    }
}

<#
.SYNOPSIS
    Creates an AI-oriented text excerpt from all JSONL segments in the newest log session.
#>
function Write-AiTailFile {
    param(
        [Parameter(Mandatory = $true)][string[]]$LogPaths,
        [Parameter(Mandatory = $true)][string]$OutputPath,
        [Parameter(Mandatory = $true)][string]$DeviceSerial,
        [Parameter(Mandatory = $true)][string]$SessionPrefix,
        [Parameter(Mandatory = $true)][int]$LineCount
    )

    $body = foreach ($logPath in $LogPaths) {
        "===== $(Split-Path -Leaf $logPath) ====="
        Get-Content -LiteralPath $logPath -Encoding utf8
    }
    $header = @(
        "# 疯狂水世界 AutoJs6 运行日志摘录",
        "serial: $DeviceSerial",
        "session: $SessionPrefix",
        "pulledAt: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss K')",
        "tailLines: $LineCount",
        ""
    )
    @($header + @($body | Select-Object -Last $LineCount)) |
        Set-Content -LiteralPath $OutputPath -Encoding utf8
}

$script:ResolvedAdbPath = Resolve-AdbExecutable -RequestedPath $AdbPath
$deviceSerial = Resolve-MuMuSerial -RequestedSerial $Serial
$remoteNames = Get-RemoteRuntimeLogNames -DeviceSerial $deviceSerial
$latestLogName = $remoteNames |
    Where-Object { $_ -match "^fkssj-run-\d{8}-\d{6}-\d{3}-\d{3}\.jsonl$" } |
    Select-Object -First 1

if (-not $latestLogName) {
    throw "设备 $deviceSerial 未找到运行日志。请先在 AutoJs6 中启动新版脚本并产生至少一条运行日志。"
}

$sessionPrefix = $latestLogName -replace "-\d{3}\.jsonl$", ""
$sessionFileNames = @($remoteNames |
    Where-Object {
        $_.StartsWith("$sessionPrefix-") -and
        ($_.EndsWith(".jsonl") -or $_.EndsWith(".png"))
    } |
    Sort-Object)
$sessionLogNames = @($sessionFileNames | Where-Object { $_.EndsWith(".jsonl") })

if ($sessionLogNames.Count -eq 0) {
    throw "最新会话 $sessionPrefix 没有可拉取的 JSONL 日志分段。"
}

$pullTimestamp = Get-Date -Format "yyyyMMdd-HHmmss"
$destinationDirectory = Join-Path $LocalLogRoot "$deviceSerial-$sessionPrefix-$pullTimestamp"
New-Item -ItemType Directory -Path $destinationDirectory -Force | Out-Null

foreach ($remoteName in $sessionFileNames) {
    # 将每次拉取放入独立目录，保留同一远端会话在不同时间点的诊断快照。
    Copy-RemoteRuntimeFile -DeviceSerial $deviceSerial `
        -RemotePath "$RemoteLogDirectory/$remoteName" `
        -DestinationPath (Join-Path $destinationDirectory $remoteName)
}

$pulledLogPaths = @($sessionLogNames | ForEach-Object {
    Join-Path $destinationDirectory $_
})
$aiTailPath = Join-Path $destinationDirectory "ai-tail-$TailLines.txt"
Write-AiTailFile -LogPaths $pulledLogPaths -OutputPath $aiTailPath -DeviceSerial $deviceSerial -SessionPrefix $sessionPrefix -LineCount $TailLines

# 使用稳定的单行输出，调用方不会因 Format-List 在长中文路径处自动换行而误判拉取失败。
Write-Output "DeviceSerial=$deviceSerial"
Write-Output "Session=$sessionPrefix"
Write-Output "LogFiles=$($pulledLogPaths.Count)"
Write-Output "ErrorScreenshots=$(@($sessionFileNames | Where-Object { $_.EndsWith(".png") }).Count)"
Write-Output "Destination=$destinationDirectory"
Write-Output "AiTail=$aiTailPath"
