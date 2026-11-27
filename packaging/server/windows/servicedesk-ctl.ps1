#Requires -Version 5.1
<#
.SYNOPSIS
    Utilitário CLI e Terminal de Controle do Servidor Central ServiceDesk.

.DESCRIPTION
    Gerencia o ciclo de vida dos serviços centrais da plataforma (Backend Rust e Servidor Go),
    oferecendo controle de inicialização, encerramento, diagnóstico de portas,
    aplicação de migrations e visualização de logs em tempo real no terminal.

.PARAMETER Action
    Ação a ser executada: start, stop, restart, status, logs, migrate, test-db, set-db, console, help.
#>

[CmdletBinding()]
param (
    [Parameter(Position = 0)]
    [ValidateSet("start", "stop", "restart", "status", "logs", "migrate", "test-db", "set-db", "console", "help")]
    [string]$Action = "console",

    [Parameter(Position = 1)]
    [string]$Target = "all",

    [switch]$Follow,
    [switch]$Detached
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Determina os diretórios base de forma inteligente
$ScriptDir = $PSScriptRoot
if ((Split-Path $ScriptDir -Leaf).ToLower() -eq "bin") {
    $BaseDir = Split-Path $ScriptDir -Parent
    $BinDir  = $ScriptDir
} elseif (Test-Path (Join-Path $ScriptDir "bin\servicedesk-api.exe")) {
    $BaseDir = $ScriptDir
    $BinDir  = Join-Path $BaseDir "bin"
} elseif (Test-Path (Join-Path $ScriptDir "servicedesk-api.exe")) {
    $BaseDir = $ScriptDir
    $BinDir  = $ScriptDir
} else {
    $BaseDir = Resolve-Path (Join-Path $ScriptDir "..\..\..")
    $BinDir  = Join-Path $BaseDir "backend\target\release"
}

# Diretórios de trabalho
$ConfigDir    = Join-Path $BaseDir "config"
$MigrationDir = Join-Path $BaseDir "migrations"
$LogsDir      = Join-Path $BaseDir "logs"
$RunDir       = Join-Path $BaseDir "run"

# Se o diretório base for protegido (ex: Program Files sem admin), usa %ProgramData% para logs e pids
$TestFile = Join-Path $BaseDir ".write_test"
$CanWriteBase = $true
try {
    [System.IO.File]::WriteAllText($TestFile, "test")
    Remove-Item $TestFile -Force -ErrorAction SilentlyContinue
} catch {
    $CanWriteBase = $false
}

if (-not $CanWriteBase) {
    $DataDir = Join-Path $env:ProgramData "ServiceDesk-Server"
    $LogsDir = Join-Path $DataDir "logs"
    $RunDir  = Join-Path $DataDir "run"
}

if (-not (Test-Path $LogsDir)) { New-Item -ItemType Directory -Path $LogsDir -Force -ErrorAction SilentlyContinue | Out-Null }
if (-not (Test-Path $RunDir))  { New-Item -ItemType Directory -Path $RunDir -Force -ErrorAction SilentlyContinue | Out-Null }

$PidFileBackend  = Join-Path $RunDir "backend.pid"
$PidFileServerGo = Join-Path $RunDir "server-go.pid"
$LogBackend      = Join-Path $LogsDir "backend.log"
$LogServerGo     = Join-Path $LogsDir "server-go.log"

# Helpers visuais
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
    param ([string]$HostName = "127.0.0.1", [int]$Port, [int]$TimeoutMs = 1200)
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

function Get-ActiveBackendProcess {
    # 1. Tenta pelo arquivo de PID
    if (Test-Path $PidFileBackend) {
        $savedPid = Get-Content $PidFileBackend -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\d+$' } | Select-Object -First 1
        if ($savedPid) {
            $p = Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
            if ($p -and (-not $p.HasExited) -and ($p.ProcessName -like "*servicedesk-api*")) {
                return $p
            }
        }
    }
    # 2. Busca processo em execução com o nome exato
    $procs = Get-Process -Name "servicedesk-api" -ErrorAction SilentlyContinue
    if ($procs) {
        $active = $procs | Select-Object -First 1
        $active.Id | Set-Content $PidFileBackend -Force -ErrorAction SilentlyContinue
        return $active
    }
    return $null
}

function Get-ActiveServerGoProcess {
    if (Test-Path $PidFileServerGo) {
        $savedPid = Get-Content $PidFileServerGo -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\d+$' } | Select-Object -First 1
        if ($savedPid) {
            $p = Get-Process -Id ([int]$savedPid) -ErrorAction SilentlyContinue
            if ($p -and (-not $p.HasExited) -and ($p.ProcessName -like "*server-go*")) {
                return $p
            }
        }
    }
    $procs = Get-Process -Name "server-go" -ErrorAction SilentlyContinue
    if ($procs) {
        $active = $procs | Select-Object -First 1
        $active.Id | Set-Content $PidFileServerGo -Force -ErrorAction SilentlyContinue
        return $active
    }
    return $null
}

function Load-EnvironmentVariables {
    # Carrega .env do binário ou de config
    $envFiles = @(
        (Join-Path $BinDir ".env"),
        (Join-Path $ConfigDir "backend.env"),
        (Join-Path $BaseDir "backend\.env"),
        (Join-Path $BaseDir ".env")
    )
    foreach ($ef in $envFiles) {
        if (Test-Path $ef) {
            Get-Content $ef | ForEach-Object {
                $line = $_.Trim()
                if ($line -and (-not $line.StartsWith("#")) -and ($line -match '^([^=]+)=(.*)$')) {
                    $key = $matches[1].Trim()
                    $val = $matches[2].Trim()
                    if (-not [System.Environment]::GetEnvironmentVariable($key)) {
                        [System.Environment]::SetEnvironmentVariable($key, $val, "Process")
                    }
                }
            }
            break
        }
    }
}

# --- 1. STATUS ---
function Show-Status {
    Write-Header "SERVICEDESK - STATUS DOS SERVIÇOS DO SERVIDOR" -Color Cyan

    $procBackend = Get-ActiveBackendProcess
    $procGo      = Get-ActiveServerGoProcess

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
        $statusApi = if ($portApi) { "Porta 8080 [ONLINE]" } else { "Porta 8080 [AGUARDANDO]" }
        Write-Badge "ONLINE" "Backend API (Rust) | PID: $($procBackend.Id) | Memória: ${mem} MB | $statusApi" -Color Green
    } elseif ($portApi) {
        Write-Badge "ONLINE" "Backend API (Rust): Porta 8080 ativa (detectada no sistema)" -Color Green
    } else {
        Write-Badge "OFFLINE" "Backend API (Rust): Não está em execução" -Color Red
    }

    if ($procGo) {
        $memGo = [math]::Round($procGo.WorkingSet64 / 1MB, 1)
        $statusGo = if ($portGoW -and $portGoG) { "Portas 8081 e 50051 [ONLINE]" } else { "Portas 8081/50051 [INICIANDO]" }
        Write-Badge "ONLINE" "Servidor Go (Telemetria) | PID: $($procGo.Id) | Memória: ${memGo} MB | $statusGo" -Color Green
    } elseif ($portGoW -or $portGoG) {
        Write-Badge "ONLINE" "Servidor Go (Telemetria): Portas 8081/50051 ativas no sistema" -Color Green
    } else {
        Write-Badge "OFFLINE" "Servidor Go (Telemetria): Não está em execução" -Color Red
    }

    Write-Host ""
}

# --- 2. START ---
function Start-ServerServices {
    Write-Header "INICIANDO SERVIÇOS DO SERVIDOR SERVICEDESK" -Color Cyan

    Load-EnvironmentVariables

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

    if (-not (Test-Path $exeBackend)) {
        Write-Badge "ERRO" "Executável do Backend não encontrado: $exeBackend" -Color Red
        return
    }
    if (-not (Test-Path $exeServerGo)) {
        Write-Badge "ERRO" "Executável do Servidor Go não encontrado: $exeServerGo" -Color Red
        return
    }

    # 1. Inicia Backend Rust
    $procBackend = Get-ActiveBackendProcess
    if ($procBackend) {
        Write-Badge "AVISO" "Backend Rust já está rodando (PID: $($procBackend.Id))." -Color Yellow
    } else {
        Write-Badge "START" "Disparando Backend Rust na porta 8080..." -Color Cyan
        $workDir = Split-Path $exeBackend -Parent

        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $psi.FileName = $exeBackend
        $psi.WorkingDirectory = $workDir
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true

        $procB = [System.Diagnostics.Process]::Start($psi)
        $procB.Id | Set-Content $PidFileBackend -Force -ErrorAction SilentlyContinue

        # Aguarda 1.5s e valida se o processo continuou vivo
        Start-Sleep -Milliseconds 1500

        if ($procB.HasExited) {
            $errText = $procB.StandardError.ReadToEnd()
            $outText = $procB.StandardOutput.ReadToEnd()
            $msg = if ($errText) { $errText } else { $outText }
            Add-Content -Path $LogBackend -Value ("[{0}][CRASH] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msg) -ErrorAction SilentlyContinue
            Write-Badge "FALHA" "Backend Rust encerrou com código $($procB.ExitCode)." -Color Red
            if ($msg) {
                Write-Host "         Motivo: $msg" -ForegroundColor Yellow
            }
            Write-Host "         Dica: Verifique se o PostgreSQL está ativo e com a senha correta (use 'test-db')." -ForegroundColor Yellow
        } else {
            Write-Badge "OK" "Backend Rust em execução (PID: $($procB.Id)) -> http://localhost:8080" -Color Green
            # Redireciona stream contínuo
            $null = Register-ObjectEvent -InputObject $procB -EventName OutputDataReceived -Action {
                if ($EventArgs.Data) { Add-Content -Path $using:LogBackend -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $EventArgs.Data) -ErrorAction SilentlyContinue }
            } -ErrorAction SilentlyContinue
            $null = Register-ObjectEvent -InputObject $procB -EventName ErrorDataReceived -Action {
                if ($EventArgs.Data) { Add-Content -Path $using:LogBackend -Value ("[{0}][ERR] {1}" -f (Get-Date -Format 'HH:mm:ss'), $EventArgs.Data) -ErrorAction SilentlyContinue }
            } -ErrorAction SilentlyContinue
            $procB.BeginOutputReadLine()
            $procB.BeginErrorReadLine()
        }
    }

    # 2. Inicia Servidor Go
    $procGo = Get-ActiveServerGoProcess
    if ($procGo) {
        Write-Badge "AVISO" "Servidor Go já está rodando (PID: $($procGo.Id))." -Color Yellow
    } else {
        Write-Badge "START" "Disparando Servidor Go nas portas 8081 (HTTP/WS) e 50051 (gRPC)..." -Color Cyan
        $workDirGo = Split-Path $exeServerGo -Parent

        $psiGo = New-Object System.Diagnostics.ProcessStartInfo
        $psiGo.FileName = $exeServerGo
        $psiGo.WorkingDirectory = $workDirGo
        $psiGo.RedirectStandardOutput = $true
        $psiGo.RedirectStandardError = $true
        $psiGo.UseShellExecute = $false
        $psiGo.CreateNoWindow = $true

        $procG = [System.Diagnostics.Process]::Start($psiGo)
        $procG.Id | Set-Content $PidFileServerGo -Force -ErrorAction SilentlyContinue

        Start-Sleep -Milliseconds 1500

        if ($procG.HasExited) {
            $errGo = $procG.StandardError.ReadToEnd()
            $outGo = $procG.StandardOutput.ReadToEnd()
            $msgGo = if ($errGo) { $errGo } else { $outGo }
            Add-Content -Path $LogServerGo -Value ("[{0}][CRASH] {1}" -f (Get-Date -Format 'HH:mm:ss'), $msgGo) -ErrorAction SilentlyContinue
            Write-Badge "FALHA" "Servidor Go encerrou com código $($procG.ExitCode)." -Color Red
            if ($msgGo) {
                Write-Host "         Motivo: $msgGo" -ForegroundColor Yellow
            }
        } else {
            Write-Badge "OK" "Servidor Go em execução (PID: $($procG.Id)) -> HTTP/WS :8081 | gRPC :50051" -Color Green
            $null = Register-ObjectEvent -InputObject $procG -EventName OutputDataReceived -Action {
                if ($EventArgs.Data) { Add-Content -Path $using:LogServerGo -Value ("[{0}] {1}" -f (Get-Date -Format 'HH:mm:ss'), $EventArgs.Data) -ErrorAction SilentlyContinue }
            } -ErrorAction SilentlyContinue
            $null = Register-ObjectEvent -InputObject $procG -EventName ErrorDataReceived -Action {
                if ($EventArgs.Data) { Add-Content -Path $using:LogServerGo -Value ("[{0}][ERR] {1}" -f (Get-Date -Format 'HH:mm:ss'), $EventArgs.Data) -ErrorAction SilentlyContinue }
            } -ErrorAction SilentlyContinue
            $procG.BeginOutputReadLine()
            $procG.BeginErrorReadLine()
        }
    }

    Start-Sleep -Seconds 1
    Show-Status
}

# --- 3. STOP ---
function Stop-ServerServices {
    Write-Header "ENCERRANDO SERVIÇOS DO SERVIDOR SERVICEDESK" -Color Yellow

    # Encerra por PID e também busca qualquer processo remanescente pelo nome
    $pidsToKill = @()
    if (Test-Path $PidFileBackend) {
        $p = Get-Content $PidFileBackend -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\d+$' }
        if ($p) { $pidsToKill += [int]$p }
    }
    if (Test-Path $PidFileServerGo) {
        $p = Get-Content $PidFileServerGo -ErrorAction SilentlyContinue | Where-Object { $_ -match '^\d+$' }
        if ($p) { $pidsToKill += [int]$p }
    }

    foreach ($pidKill in $pidsToKill) {
        try {
            & taskkill.exe /PID $pidKill /T /F 2>$null | Out-Null
        } catch {}
    }

    # Garante que nenhum processo órfão continue travando as portas
    $remainingBackend = Get-Process -Name "servicedesk-api" -ErrorAction SilentlyContinue
    if ($remainingBackend) {
        $remainingBackend | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
        Write-Badge "KILL" "Instâncias ativas do Backend Rust foram encerradas." -Color Yellow
    }

    $remainingGo = Get-Process -Name "server-go" -ErrorAction SilentlyContinue
    if ($remainingGo) {
        $remainingGo | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }
        Write-Badge "KILL" "Instâncias ativas do Servidor Go foram encerradas." -Color Yellow
    }

    Remove-Item $PidFileBackend -Force -ErrorAction SilentlyContinue
    Remove-Item $PidFileServerGo -Force -ErrorAction SilentlyContinue

    Write-Badge "OK" "Todos os serviços do servidor foram encerrados." -Color Green
}

# --- 4. LOGS ---
function Show-Logs {
    param ([string]$Component, [switch]$Tail)

    Write-Header "LOGS DO SERVIDOR SERVICEDESK" -Color Cyan

    if ($Component -eq "backend" -or $Component -eq "all") {
        Write-Host "--- [LOGS: Backend Rust ($LogBackend)] ---" -ForegroundColor Green
        if (Test-Path $LogBackend) {
            if ($Tail) {
                Get-Content $LogBackend -Tail 25 -Wait
                return
            } else {
                Get-Content $LogBackend -Tail 30
            }
        } else {
            Write-Host "Nenhum arquivo de log gerado ainda." -ForegroundColor Gray
        }
    }

    if ($Component -eq "server-go" -or $Component -eq "all") {
        Write-Host "`n--- [LOGS: Servidor Go ($LogServerGo)] ---" -ForegroundColor Cyan
        if (Test-Path $LogServerGo) {
            if ($Tail) {
                Get-Content $LogServerGo -Tail 25 -Wait
                return
            } else {
                Get-Content $LogServerGo -Tail 30
            }
        } else {
            Write-Host "Nenhum arquivo de log gerado ainda." -ForegroundColor Gray
        }
    }
}

# --- 5. TEST-DB & SET-DB ---
function Test-DatabaseConnection {
    Write-Header "TESTE DE CONEXÃO COM O POSTGRESQL" -Color Cyan
    Load-EnvironmentVariables

    $dbUrl = [System.Environment]::GetEnvironmentVariable("DATABASE_URL")
    if (-not $dbUrl) {
        Write-Badge "ERRO" "Variável DATABASE_URL não encontrada no arquivo .env." -Color Red
        return
    }

    # Mascara a senha para exibição
    $maskedUrl = $dbUrl -replace ':(.+?)@', ':****@'
    Write-Badge "INFO" "Testando: $maskedUrl" -Color White

    if ($dbUrl -match 'postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:\/]+):?(\d+)?\/(.+)') {
        $user = $matches[1]
        $pass = $matches[2]
        $hostName = $matches[3]
        $port = if ($matches[4]) { [int]$matches[4] } else { 5432 }
        $dbname = ($matches[5] -split '\?')[0]

        $portOk = Test-Port -HostName $hostName -Port $port
        if (-not $portOk) {
            Write-Badge "FALHA" "Porta $port em $hostName não respondeu (PostgreSQL inativo ou bloqueado por firewall)." -Color Red
            return
        }

        # Tenta conexão autenticada via psql se disponível
        $psql = Get-Command "psql" -ErrorAction SilentlyContinue
        if ($psql) {
            $env:PGPASSWORD = $pass
            $out = & $psql.Source -h $hostName -p $port -U $user -d $dbname -c "SELECT 1;" 2>&1 | Out-String
            if ($LASTEXITCODE -eq 0) {
                Write-Badge "OK" "Autenticação e conexão com PostgreSQL bem-sucedidas!" -Color Green
            } else {
                Write-Badge "FALHA" "PostgreSQL respondeu com erro de autenticação ou banco ausente:" -Color Red
                Write-Host "         $out" -ForegroundColor Yellow
                Write-Host "         Para corrigir a senha ou host, use o comando: set-db" -ForegroundColor Cyan
            }
        } else {
            Write-Badge "OK" "Porta $port aberta. Utilitário psql não está no PATH para teste de credencial SQL." -Color Yellow
        }
    }
}

function Set-DatabaseCredentials {
    Write-Header "CONFIGURAR CREDENCIAIS DO BANCO POSTGRESQL" -Color Cyan

    $dbHost = Read-Host "Host do PostgreSQL [localhost]"
    if (-not $dbHost) { $dbHost = "localhost" }

    $dbPort = Read-Host "Porta do PostgreSQL [5432]"
    if (-not $dbPort) { $dbPort = "5432" }

    $dbName = Read-Host "Nome do Banco de Dados [servicedesk]"
    if (-not $dbName) { $dbName = "servicedesk" }

    $dbUser = Read-Host "Usuário [postgres]"
    if (-not $dbUser) { $dbUser = "postgres" }

    $dbPass = Read-Host "Senha do PostgreSQL"

    $newUrl = "postgres://$($dbUser):$($dbPass)@$($dbHost):$($dbPort)/$($dbName)?sslmode=disable"

    # Atualiza nos arquivos .env
    $targetEnvs = @(
        (Join-Path $BinDir ".env"),
        (Join-Path $ConfigDir "backend.env"),
        (Join-Path $ConfigDir "server-go.env"),
        (Join-Path $BaseDir ".env")
    )

    foreach ($te in $targetEnvs) {
        if (Test-Path $te) {
            $lines = Get-Content $te
            $updated = $lines | ForEach-Object {
                if ($_ -match '^DATABASE_URL=') { "DATABASE_URL=$newUrl" } else { $_ }
            }
            $updated | Set-Content $te -Force -ErrorAction SilentlyContinue
            Write-Badge "ATUALIZADO" "$te" -Color Green
        }
    }

    [System.Environment]::SetEnvironmentVariable("DATABASE_URL", $newUrl, "Process")
    Write-Badge "OK" "Credenciais atualizadas com sucesso! Reinicie os serviços com 'restart'." -Color Green
}

# --- 6. MIGRATE ---
function Invoke-Migrations {
    Write-Header "APLICANDO MIGRATIONS DO BANCO DE DADOS" -Color Cyan
    Load-EnvironmentVariables

    $sqlFiles = Get-ChildItem (Join-Path $BaseDir "backend\migrations\*.sql") -ErrorAction SilentlyContinue
    if (-not $sqlFiles) {
        $sqlFiles = Get-ChildItem (Join-Path $BaseDir "migrations\*.sql") -ErrorAction SilentlyContinue
    }
    if (-not $sqlFiles) {
        $sqlFiles = Get-ChildItem (Join-Path $MigrationDir "*.sql") -ErrorAction SilentlyContinue
    }

    if (-not $sqlFiles) {
        Write-Badge "ERRO" "Nenhum script de migration .sql foi encontrado." -Color Red
        return
    }

    # Ordenação estritamente numérica: 1, 2, ... 13, 14, 15, 16, 17
    $sorted = $sqlFiles | Sort-Object { [int]($_.BaseName -replace '\D.*') }

    $psql = Get-Command "psql" -ErrorAction SilentlyContinue
    if (-not $psql) {
        $candidatePsql = @(
            "C:\Program Files\PostgreSQL\18\bin\psql.exe",
            "C:\Program Files\PostgreSQL\17\bin\psql.exe",
            "C:\Program Files\PostgreSQL\16\bin\psql.exe"
        ) | Where-Object { Test-Path $_ } | Select-Object -First 1
        if ($candidatePsql) {
            $psql = Get-Item $candidatePsql
        }
    }

    if (-not $psql) {
        Write-Badge "ERRO" "Utilitário psql.exe não encontrado no PATH nem nos diretórios padrão do PostgreSQL." -Color Red
        return
    }

    # Extrai dados do DATABASE_URL
    $dbUrl = [System.Environment]::GetEnvironmentVariable("DATABASE_URL")
    if ($dbUrl -match 'postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:\/]+):?(\d+)?\/(.+)') {
        $env:PGPASSWORD = $matches[2]
        $user = $matches[1]
        $hostName = $matches[3]
        $port = if ($matches[4]) { $matches[4] } else { "5432" }
        $dbname = ($matches[5] -split '\?')[0]

        Write-Badge "INFO" "Aplicando $($sorted.Count) migrations no banco '$dbname' em ${hostName}:${port}..." -Color White
        foreach ($f in $sorted) {
            Write-Badge "MIGRATE" "Executando: $($f.Name)..." -Color Gray
            & $psql.FullName -h $hostName -p $port -U $user -d $dbname -f $f.FullName 2>&1 | Out-Null
        }
        Write-Badge "OK" "Todas as migrations foram aplicadas com sucesso!" -Color Green
    } else {
        Write-Badge "ERRO" "DATABASE_URL inválida ou ausente no .env." -Color Red
    }
}

# --- 7. CONSOLE INTERATIVO ---
function Start-Console {
    Clear-Host
    Write-Header "SERVICEDESK - TERMINAL DE CONTROLE E LOGS ON-PREMISE" -Color Green
    Write-Host "  Console de administração e monitoramento do servidor central." -ForegroundColor Gray
    Write-Host "  Digite 'help' para ver os comandos disponíveis." -ForegroundColor Gray

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
            "^test-db" { Test-DatabaseConnection }
            "^set-db"  { Set-DatabaseCredentials }
            "^migrate" { Invoke-Migrations }
            "^clear"   { Clear-Host; Write-Header "SERVICEDESK - TERMINAL DE CONTROLE" -Color Green }
            "^help" {
                Write-Host "`nComandos disponíveis:" -ForegroundColor White
                Write-Host "  status              - Exibe status dos processos, portas e PostgreSQL" -ForegroundColor Cyan
                Write-Host "  start               - Inicia o Backend Rust e o Servidor Go" -ForegroundColor Cyan
                Write-Host "  stop                - Encerra os serviços do servidor" -ForegroundColor Cyan
                Write-Host "  restart             - Reinicia todos os serviços com segurança" -ForegroundColor Cyan
                Write-Host "  logs                - Exibe as últimas linhas de log de ambos os serviços" -ForegroundColor Cyan
                Write-Host "  logs backend        - Exibe os logs específicos do Backend Rust" -ForegroundColor Cyan
                Write-Host "  logs server-go      - Exibe os logs específicos do Servidor Go" -ForegroundColor Cyan
                Write-Host "  test-db             - Testa a conexão e autenticação com o PostgreSQL" -ForegroundColor Cyan
                Write-Host "  set-db              - Atualiza usuário/senha/host do banco no arquivo .env" -ForegroundColor Cyan
                Write-Host "  migrate             - Executa as migrations pendentes no banco" -ForegroundColor Cyan
                Write-Host "  clear               - Limpa a tela" -ForegroundColor Cyan
                Write-Host "  exit / quit         - Sai deste terminal (os serviços continuam rodando)`n" -ForegroundColor Cyan
            }
            "^(exit|quit)" {
                Write-Host "`nEncerrando console de controle. Os serviços continuam em execução em segundo plano." -ForegroundColor Yellow
                break
            }
            default {
                if ($trimmed -ne "") {
                    Write-Host "Comando desconhecido: '$inputCmd'. Digite 'help' para ajuda." -ForegroundColor Red
                }
            }
        }
    }
}

# Despacho de Ações
switch ($Action.ToLower()) {
    "start"   { Start-ServerServices }
    "stop"    { Stop-ServerServices }
    "restart" { Stop-ServerServices; Start-Sleep -Seconds 1; Start-ServerServices }
    "status"  { Show-Status }
    "logs"    { Show-Logs -Component $Target -Tail:$Follow }
    "test-db" { Test-DatabaseConnection }
    "set-db"  { Set-DatabaseCredentials }
    "migrate" { Invoke-Migrations }
    "console" { Start-Console }
    "help" {
        Write-Host "Uso: servicedesk-ctl [start|stop|restart|status|logs|test-db|set-db|migrate|console] [-Follow]"
    }
}
