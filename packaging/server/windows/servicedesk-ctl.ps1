#Requires -Version 5.1
<#
.SYNOPSIS
    Utilitário CLI e Terminal de Controle do Servidor Central ServiceDesk.

.DESCRIPTION
    Gerencia o ciclo de vida dos serviços centrais da plataforma (Backend Rust e Servidor Go),
    oferecendo controle de inicialização, encerramento, diagnóstico de portas,
    aplicação de migrations e visualização de logs em tempo real no terminal.

.PARAMETER Action
    Ação a ser executada: start, stop, restart, status, logs, migrate, console, help.
#>

[CmdletBinding()]
param (
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status", "logs", "migrate", "console", "help")]
    [string]$Action = "console",

    [Parameter(Position = 1)]
    [string]$Target = "all",

    [switch]$Follow,
    [switch]$Detached
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Determina os diretórios base de forma flexível (instalado ou desenvolvimento)
$ScriptDir = $PSScriptRoot
if (Test-Path (Join-Path $ScriptDir "bin\servicedesk-api.exe")) {
    $BaseDir = $ScriptDir
    $BinDir  = Join-Path $BaseDir "bin"
} elseif (Test-Path (Join-Path $ScriptDir "servicedesk-api.exe")) {
    $BaseDir = $ScriptDir
    $BinDir  = $ScriptDir
} else {
    # Raiz do repositório
    $BaseDir = Resolve-Path (Join-Path $ScriptDir "..\..\..")
    $BinDir  = Join-Path $BaseDir "backend\target\release"
}

$ConfigDir    = Join-Path $BaseDir "config"
$LogsDir      = Join-Path $BaseDir "logs"
$RunDir       = Join-Path $BaseDir "run"
$MigrationDir = Join-Path $BaseDir "migrations"

try {
    if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir -Force -ErrorAction Stop | Out-Null }
} catch {
    $LogsDir = Join-Path $env:TEMP "servicedesk-server\logs"
    if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir -Force -ErrorAction SilentlyContinue | Out-Null }
}

try {
    if (-not (Test-Path $RunDir)) { New-Item -ItemType Directory -Path $RunDir -Force -ErrorAction Stop | Out-Null }
} catch {
    $RunDir = Join-Path $env:TEMP "servicedesk-server\run"
    if (-not (Test-Path $RunDir)) { New-Item -ItemType Directory -Path $RunDir -Force -ErrorAction SilentlyContinue | Out-Null }
}

$PidFileBackend  = Join-Path $RunDir "backend.pid"
$PidFileServerGo = Join-Path $RunDir "server-go.pid"
$LogBackend      = Join-Path $LogsDir "backend.log"
$LogServerGo     = Join-Path $LogsDir "server-go.log"

# Helpers
function Write-Header {
    param ([string]$Title, [ConsoleColor]$Color = [ConsoleColor]::Cyan)
    $line = "=" * 74
    Write-Host ""
    Write-Host $line -ForegroundColor $Color
    Write-Host ("  " + $Title) -ForegroundColor $Color
    Write-Host $line -ForegroundColor $Color
}

function Write-Badge {
    param ([string]$Status, [string]$Message, [ConsoleColor]$Color = [ConsoleColor]::White)
    $badge = "[$Status]"
    Write-Host ("  " + $badge.PadRight(9) + " " + $Message) -ForegroundColor $Color
}

function Test-Port {
    param ([string]$HostName = "127.0.0.1", [int]$Port, [int]$TimeoutMs = 1000)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect($HostName, $Port, $null, $null)
        $wait = $iar.AsyncWaitHandle.WaitOne($TimeoutMs, $false)
        if (-not $wait) {
            $client.Close()
            return $false
        }
        $client.EndConnect($iar)
        $client.Close()
        return $true
    } catch {
        return $false
    }
}

function Get-RunningProcessById {
    param ([string]$PidPath)
    if (Test-Path $PidPath) {
        $savedPid = Get-Content $PidPath -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\d+$' } | Select-Object -First 1
        if ($savedPid) {
            $proc = Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
            if ($proc -and (-not $proc.HasExited)) {
                return $proc
            }
        }
    }
    return $null
}

# --- 1. STATUS ---
function Show-Status {
    Write-Header "SERVICEDESK - STATUS DOS SERVIÇOS DO SERVIDOR" -Color Cyan

    $procBackend = Get-RunningProcessById $PidFileBackend
    $procGo      = Get-RunningProcessById $PidFileServerGo

    $portPg   = Test-Port -Port 5432
    $portApi  = Test-Port -Port 8080
    $portGoW  = Test-Port -Port 8081
    $portGoG  = Test-Port -Port 50051

    Write-Host "  Infraestrutura e Banco de Dados:" -ForegroundColor Gray
    if ($portPg) {
        Write-Badge "ATIVO" "PostgreSQL (Porta 5432): Respondendo localmente" -Color Green
    } else {
        Write-Badge "INATIVO" "PostgreSQL (Porta 5432): Conexão não detectada" -Color Red
    }

    Write-Host "`n  Serviços Centrais:" -ForegroundColor Gray
    if ($procBackend) {
        $mem = [math]::Round($procBackend.WorkingSet64 / 1MB, 1)
        $statusApi = if ($portApi) { "Porta 8080 OK" } else { "Aguardando porta 8080" }
        Write-Badge "ONLINE" "Backend API (Rust) | PID: $($procBackend.Id) | Memória: ${mem} MB | $statusApi" -Color Green
    } else {
        Write-Badge "OFFLINE" "Backend API (Rust): Não está em execução" -Color Red
    }

    if ($procGo) {
        $memGo = [math]::Round($procGo.WorkingSet64 / 1MB, 1)
        $statusGo = if ($portGoW -and $portGoG) { "Portas 8081/50051 OK" } else { "Iniciando portas..." }
        Write-Badge "ONLINE" "Servidor Go (Telemetria) | PID: $($procGo.Id) | Memória: ${memGo} MB | $statusGo" -Color Green
    } else {
        Write-Badge "OFFLINE" "Servidor Go (Telemetria): Não está em execução" -Color Red
    }

    Write-Host ""
}

# --- 2. START ---
function Start-ServerServices {
    param ([switch]$AsDetached)

    Write-Header "INICIANDO SERVIÇOS DO SERVIDOR SERVICEDESK" -Color Cyan

    # Localiza executáveis
    $exeBackend = if (Test-Path (Join-Path $BinDir "servicedesk-api.exe")) {
        Join-Path $BinDir "servicedesk-api.exe"
    } else {
        Join-Path $BaseDir "backend\target\release\servicedesk-api.exe"
    }

    $exeServerGo = if (Test-Path (Join-Path $BinDir "server-go.exe")) {
        Join-Path $BinDir "server-go.exe"
    } elseif (Test-Path (Join-Path $BaseDir "server-go\bin\server-go.exe")) {
        Join-Path $BaseDir "server-go\bin\server-go.exe"
    } else {
        Join-Path $BaseDir "server-go\server-go.exe"
    }

    # Verifica se já estão rodando
    $procBackend = Get-RunningProcessById $PidFileBackend
    if ($procBackend) {
        Write-Badge "AVISO" "Backend Rust já está rodando (PID: $($procBackend.Id))." -Color Yellow
    } else {
        Write-Badge "START" "Iniciando Backend Rust na porta 8080..." -Color Cyan
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $exeBackend
        $psi.WorkingDirectory = if (Test-Path (Join-Path $BaseDir "backend")) { Join-Path $BaseDir "backend" } else { $BaseDir }
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true

        $procB = [System.Diagnostics.Process]::Start($psi)
        $procB.Id | Set-Content $PidFileBackend -Force

        # Stream assíncrono para o arquivo de log
        $null = Register-ObjectEvent -InputObject $procB -EventName OutputDataReceived -Action {
            if ($EventArgs.Data) { Add-Content -Path $using:LogBackend -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $EventArgs.Data) }
        }
        $null = Register-ObjectEvent -InputObject $procB -EventName ErrorDataReceived -Action {
            if ($EventArgs.Data) { Add-Content -Path $using:LogBackend -Value ("[{0}][ERR] {1}" -f (Get-Date -Format 'HH:mm:ss'), $EventArgs.Data) }
        }
        $procB.BeginOutputReadLine()
        $procB.BeginErrorReadLine()

        Write-Badge "OK" "Backend Rust iniciado com sucesso (PID: $($procB.Id))." -Color Green
    }

    $procGo = Get-RunningProcessById $PidFileServerGo
    if ($procGo) {
        Write-Badge "AVISO" "Servidor Go já está rodando (PID: $($procGo.Id))." -Color Yellow
    } else {
        Write-Badge "START" "Iniciando Servidor Go nas portas 8081 (HTTP/WS) e 50051 (gRPC)..." -Color Cyan
        $psiGo = New-Object System.Diagnostics.ProcessStartInfo
        $psiGo.FileName = $exeServerGo
        $psiGo.WorkingDirectory = if (Test-Path (Join-Path $BaseDir "server-go")) { Join-Path $BaseDir "server-go" } else { $BaseDir }
        $psiGo.RedirectStandardOutput = $true
        $psiGo.RedirectStandardError = $true
        $psiGo.UseShellExecute = $false
        $psiGo.CreateNoWindow = $true

        $procG = [System.Diagnostics.Process]::Start($psiGo)
        $procG.Id | Set-Content $PidFileServerGo -Force

        $null = Register-ObjectEvent -InputObject $procG -EventName OutputDataReceived -Action {
            if ($EventArgs.Data) { Add-Content -Path $using:LogServerGo -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $EventArgs.Data) }
        }
        $null = Register-ObjectEvent -InputObject $procG -EventName ErrorDataReceived -Action {
            if ($EventArgs.Data) { Add-Content -Path $using:LogServerGo -Value ("[{0}][ERR] {1}" -f (Get-Date -Format 'HH:mm:ss'), $EventArgs.Data) }
        }
        $procG.BeginOutputReadLine()
        $procG.BeginErrorReadLine()

        Write-Badge "OK" "Servidor Go iniciado com sucesso (PID: $($procG.Id))." -Color Green
    }

    Start-Sleep -Seconds 2
    Show-Status
}

# --- 3. STOP ---
function Stop-ServerServices {
    Write-Header "ENCERRANDO SERVIÇOS DO SERVIDOR SERVICEDESK" -Color Yellow

    $procBackend = Get-RunningProcessById $PidFileBackend
    if ($procBackend) {
        Write-Badge "KILL" "Finalizando Backend Rust (PID: $($procBackend.Id))..." -Color Yellow
        & taskkill.exe /PID $procBackend.Id /T /F 2>$null | Out-Null
        Remove-Item $PidFileBackend -Force -ErrorAction SilentlyContinue
        Write-Badge "OK" "Backend Rust encerrado." -Color Green
    } else {
        Write-Badge "INFO" "Backend Rust não estava em execução." -Color Gray
        Remove-Item $PidFileBackend -Force -ErrorAction SilentlyContinue
    }

    $procGo = Get-RunningProcessById $PidFileServerGo
    if ($procGo) {
        Write-Badge "KILL" "Finalizando Servidor Go (PID: $($procGo.Id))..." -Color Yellow
        & taskkill.exe /PID $procGo.Id /T /F 2>$null | Out-Null
        Remove-Item $PidFileServerGo -Force -ErrorAction SilentlyContinue
        Write-Badge "OK" "Servidor Go encerrado." -Color Green
    } else {
        Write-Badge "INFO" "Servidor Go não estava em execução." -Color Gray
        Remove-Item $PidFileServerGo -Force -ErrorAction SilentlyContinue
    }
}

# --- 4. LOGS ---
function Show-Logs {
    param ([string]$Component, [switch]$Tail)

    Write-Header "LOGS DO SERVIDOR SERVICEDESK" -Color Cyan

    if ($Component -eq "backend" -or $Component -eq "all") {
        Write-Host "--- [LOGS: Backend Rust ($LogBackend)] ---" -ForegroundColor Green
        if (Test-Path $LogBackend) {
            if ($Tail) {
                Get-Content $LogBackend -Tail 20 -Wait
                return
            } else {
                Get-Content $LogBackend -Tail 30
            }
        } else {
            Write-Host "Arquivo de log ainda não gerado." -ForegroundColor Gray
        }
    }

    if ($Component -eq "server-go" -or $Component -eq "all") {
        Write-Host "`n--- [LOGS: Servidor Go ($LogServerGo)] ---" -ForegroundColor Cyan
        if (Test-Path $LogServerGo) {
            if ($Tail) {
                Get-Content $LogServerGo -Tail 20 -Wait
                return
            } else {
                Get-Content $LogServerGo -Tail 30
            }
        } else {
            Write-Host "Arquivo de log ainda não gerado." -ForegroundColor Gray
        }
    }
}

# --- 5. MIGRATE ---
function Invoke-Migrations {
    Write-Header "APLICANDO MIGRATIONS DO BANCO DE DADOS" -Color Cyan

    $sqlFiles = Get-ChildItem (Join-Path $BaseDir "backend\migrations\*.sql") -ErrorAction SilentlyContinue
    if (-not $sqlFiles) {
        $sqlFiles = Get-ChildItem (Join-Path $BaseDir "migrations\*.sql") -ErrorAction SilentlyContinue
    }

    if (-not $sqlFiles) {
        Write-Badge "ERRO" "Nenhum arquivo de migration encontrado na pasta migrations/." -Color Red
        return
    }

    # Ordena numericamente
    $sorted = $sqlFiles | Sort-Object { [int]($_.BaseName -replace '\D.*') }

    Write-Badge "INFO" "Foram encontradas $($sorted.Count) migrations para validação/execução." -Color White
    foreach ($f in $sorted) {
        Write-Badge "MIGRATE" "Aplicando: $($f.Name)..." -Color Gray
        & psql -U postgres -d servicedesk -f $f.FullName 2>&1 | Out-Null
    }
    Write-Badge "OK" "Processo de migrations concluído!" -Color Green
}

# --- 6. CONSOLE INTERATIVO ---
function Start-Console {
    Clear-Host
    Write-Header "SERVICEDESK - TERMINAL DE CONTROLE E LOGS ON-PREMISE" -Color Green
    Write-Host "  Console de administração e monitoramento do servidor central." -ForegroundColor Gray
    Write-Host "  Digite 'help' para comandos ou 'exit' para sair." -ForegroundColor Gray

    Show-Status

    while ($true) {
        Write-Host ""
        $inputCmd = Read-Host "servicedesk-server>"
        $trimmed = $inputCmd.Trim().ToLower()

        switch -Regex ($trimmed) {
            "^status"  { Show-Status }
            "^start"   { Start-ServerServices }
            "^stop"    { Stop-ServerServices }
            "^restart" { Stop-ServerServices; Start-Sleep -Seconds 1; Start-ServerServices }
            "^logs\s*backend"   { Show-Logs -Component "backend" }
            "^logs\s*server-go" { Show-Logs -Component "server-go" }
            "^logs"             { Show-Logs -Component "all" }
            "^migrate" { Invoke-Migrations }
            "^clear"   { Clear-Host; Write-Header "SERVICEDESK - TERMINAL DE CONTROLE" -Color Green }
            "^help" {
                Write-Host "`nComandos disponíveis:" -ForegroundColor White
                Write-Host "  status              - Exibe status dos processos, portas e PostgreSQL" -ForegroundColor Cyan
                Write-Host "  start               - Inicia o Backend Rust e o Servidor Go" -ForegroundColor Cyan
                Write-Host "  stop                - Encerra os serviços do servidor" -ForegroundColor Cyan
                Write-Host "  restart             - Reinicia todos os serviços" -ForegroundColor Cyan
                Write-Host "  logs                - Exibe as últimas linhas de log de ambos os serviços" -ForegroundColor Cyan
                Write-Host "  logs backend        - Exibe os logs específicos do Backend Rust" -ForegroundColor Cyan
                Write-Host "  logs server-go      - Exibe os logs específicos do Servidor Go" -ForegroundColor Cyan
                Write-Host "  migrate             - Executa as migrations no PostgreSQL" -ForegroundColor Cyan
                Write-Host "  clear               - Limpa a tela" -ForegroundColor Cyan
                Write-Host "  exit / quit         - Sai deste terminal (os serviços continuam rodando)`n" -ForegroundColor Cyan
            }
            "^(exit|quit)" {
                Write-Host "`nEncerrando terminal de controle. Os serviços continuam em execução." -ForegroundColor Yellow
                break
            }
            default {
                if ($trimmed -ne "") {
                    Write-Host "Comando desconhecido: '$inputCmd'. Digite 'help' para ver os comandos." -ForegroundColor Red
                }
            }
        }
    }
}

# Despacho de Ações
switch ($Action.ToLower()) {
    "start"   { Start-ServerServices -AsDetached:$Detached }
    "stop"    { Stop-ServerServices }
    "restart" { Stop-ServerServices; Start-Sleep -Seconds 1; Start-ServerServices }
    "status"  { Show-Status }
    "logs"    { Show-Logs -Component $Target -Tail:$Follow }
    "migrate" { Invoke-Migrations }
    "console" { Start-Console }
    "help" {
        Write-Host "Uso: servicedesk-ctl [start|stop|restart|status|logs|migrate|console] [-Follow]"
    }
}
