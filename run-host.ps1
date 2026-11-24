#Requires -Version 5.1
<#
.SYNOPSIS
    Entrypoint principal para inicializacao e orquestracao de todos os servicos
    do lado do Host da plataforma ServiceDesk.

.DESCRIPTION
    Inicializa em janelas dedicadas e monitora toda a infraestrutura central:
      1. Verificacao de pre-requisitos (Rust, Go, Node.js, PostgreSQL)
      2. Validacao de conexao com o banco de dados PostgreSQL (porta 5432)
      3. Backend Principal em Rust/Axum (porta 8080)
      4. Servidor On-Premise Go (gRPC :50051 / HTTP & WebSocket :8081)
      5. Frontend / Painel Web em Vite (porta :5173) ou App Desktop (Tauri)
      6. Encerramento unificado e gracioso via Ctrl+C, tecla 'Q' ou flag -Stop

.PARAMETER NoFrontend
    Executa apenas os servicos de backend (API Rust + Servidor Go + DB), sem iniciar a interface grafica/web.
    Alias: -BackendOnly

.PARAMETER BackendOnly
    Alias para -NoFrontend.

.PARAMETER Desktop
    Inicia o frontend como aplicacao desktop nativa via Tauri (npx tauri dev) em vez do servidor web Vite.
    Alias: -Tauri

.PARAMETER Tauri
    Alias para -Desktop.

.PARAMETER ApplyMigrations
    Executa automaticamente todos os scripts de migration pendentes em 'backend/migrations/*.sql'
    utilizando a ferramenta psql antes de iniciar os servicos.

.PARAMETER Detached
    Inicia os servicos em janelas separadas e encerra o script de orquestracao imediatamente sem monitorar.

.PARAMETER Stop
    Localiza e encerra imediatamente todos os processos ativos do Host previamente iniciados por este script.

.PARAMETER CheckOnly
    Apenas valida dependencias, conectividade com o banco e portas sem iniciar nenhum processo.

.EXAMPLE
    .\run-host.ps1
    Inicia a stack completa do Host (Backend Rust + Servidor Go + Frontend Vite).

.EXAMPLE
    .\run-host.ps1 -BackendOnly
    Inicia apenas a API Rust e o Servidor Go sem o frontend.

.EXAMPLE
    .\run-host.ps1 -Desktop
    Inicia a API Rust, o Servidor Go e o App Desktop via Tauri.

.EXAMPLE
    .\run-host.ps1 -Stop
    Encerra todos os servicos do Host em execucao.
#>

[CmdletBinding()]
param (
    [switch]$NoFrontend,
    [switch]$BackendOnly,
    [switch]$Desktop,
    [switch]$Tauri,
    [switch]$ApplyMigrations,
    [switch]$Detached,
    [switch]$Stop,
    [switch]$CheckOnly
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# Normaliza aliases
if ($BackendOnly) { $NoFrontend = $true }
if ($Tauri) { $Desktop = $true }

$RootDir     = $PSScriptRoot
$BackendDir  = Join-Path $RootDir "backend"
$ServerGoDir = Join-Path $RootDir "server-go"
$FrontendDir = Join-Path $RootDir "app-desktop"
$PidFilePath = Join-Path $env:TEMP "servicedesk-host.pids"

function Write-Banner {
    param ([string]$Title, [ConsoleColor]$Color = [ConsoleColor]::Cyan)
    $line = "=" * 74
    Write-Host ""
    Write-Host $line -ForegroundColor $Color
    Write-Host ("  " + $Title) -ForegroundColor $Color
    Write-Host $line -ForegroundColor $Color
}

function Write-Step {
    param ([string]$Status, [string]$Message, [ConsoleColor]$Color = [ConsoleColor]::White)
    $badge = "[$Status]"
    Write-Host ("  " + $badge.PadRight(7) + " " + $Message) -ForegroundColor $Color
}

function Update-SessionPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath    = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path    = "$machinePath;$userPath"

    $extraPaths = @(
        "$env:USERPROFILE\.cargo\bin",
        "$env:USERPROFILE\go\bin",
        "C:\Program Files\Go\bin",
        "C:\Program Files\nodejs",
        "C:\Program Files\PostgreSQL\18\bin",
        "C:\Program Files\PostgreSQL\17\bin",
        "C:\Program Files\PostgreSQL\16\bin"
    )
    foreach ($p in $extraPaths) {
        if ((Test-Path $p) -and ($env:Path -notlike "*$p*")) {
            $env:Path += ";$p"
        }
    }
}

function Test-CommandExists {
    param ([string]$Command)
    return [bool](Get-Command $Command -ErrorAction SilentlyContinue)
}

function Test-TcpPort {
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

function Stop-HostServices {
    param ([switch]$Quiet)
    if (-not (Test-Path $PidFilePath)) {
        if (-not $Quiet) {
            Write-Host "[INFO] Nenhum registro de servicos do Host em execucao foi encontrado ($PidFilePath)." -ForegroundColor Yellow
        }
        return
    }

    $rawContent = Get-Content $PidFilePath -ErrorAction SilentlyContinue
    $pids = $rawContent -split '[\r\n]+' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ }

    if ($pids.Count -gt 0) {
        if (-not $Quiet) {
            Write-Banner "ENCERRANDO SERVICOS DO HOST" -Color Yellow
        }
        foreach ($pidToKill in $pids) {
            try {
                $proc = Get-Process -Id $pidToKill -ErrorAction SilentlyContinue
                if ($proc) {
                    if (-not $Quiet) {
                        Write-Step "KILL" "Encerrando processo $pidToKill ($($proc.ProcessName))..." -Color Yellow
                    }
                    & taskkill.exe /PID $pidToKill /T /F 2>$null | Out-Null
                }
            } catch {}
        }
    }

    Remove-Item $PidFilePath -Force -ErrorAction SilentlyContinue
    if (-not $Quiet) {
        Write-Step "OK" "Todos os servicos do Host foram encerrados com sucesso." -Color Green
    }
}

# --- Se acionado com -Stop, encerra processos e sai ---
if ($Stop) {
    Stop-HostServices
    exit 0
}

Update-SessionPath

Write-Banner "SERVICEDESK - INICIALIZADOR DO HOST (TUDO)" -Color Cyan
Write-Host "  Este script inicializa a infraestrutura completa do servidor central:" -ForegroundColor Gray
Write-Host "    - PostgreSQL (Porta 5432)" -ForegroundColor Gray
Write-Host "    - Backend Principal em Rust (Porta 8080)" -ForegroundColor Gray
Write-Host "    - Servidor Go de Telemetria e Conexao Remota (Portas 8081 e 50051)" -ForegroundColor Gray
if (-not $NoFrontend) {
    if ($Desktop) {
        Write-Host "    - App Desktop do Tecnico via Tauri (npx tauri dev)" -ForegroundColor Gray
    } else {
        Write-Host "    - Frontend Web em Vite (http://localhost:5173)" -ForegroundColor Gray
    }
}
Write-Host ""

# --- 1. Verificacao de Pre-requisitos ---
Write-Host ">> Verificando ferramentas e dependencias do sistema..." -ForegroundColor Cyan

$allOk = $true

if (Test-CommandExists "cargo") {
    $cargoVer = (& cargo --version 2>&1 | Out-String).Trim()
    Write-Step "OK" "Rust / Cargo: $cargoVer" -Color Green
} else {
    Write-Step "ERRO" "Rust / Cargo nao encontrado no PATH. Execute .\setup-env.ps1 para instalar." -Color Red
    $allOk = $false
}

if (Test-CommandExists "go") {
    $goVer = (& go version 2>&1 | Out-String).Trim()
    Write-Step "OK" "Go (Golang): $goVer" -Color Green
} else {
    Write-Step "ERRO" "Go nao encontrado no PATH. Execute .\setup-env.ps1 para instalar." -Color Red
    $allOk = $false
}

if (-not $NoFrontend) {
    if (Test-CommandExists "node") {
        $nodeVer = (& node --version 2>&1 | Out-String).Trim()
        Write-Step "OK" "Node.js: $nodeVer" -Color Green
    } else {
        Write-Step "ERRO" "Node.js nao encontrado no PATH." -Color Red
        $allOk = $false
    }

    if (Test-CommandExists "npm") {
        $npmVer = (& npm --version 2>&1 | Out-String).Trim()
        Write-Step "OK" "npm: $npmVer" -Color Green
    } else {
        Write-Step "ERRO" "npm nao encontrado no PATH." -Color Red
        $allOk = $false
    }
}

# Verificacao do PostgreSQL
$pgListening = Test-TcpPort -Port 5432
if ($pgListening) {
    Write-Step "OK" "PostgreSQL ativo e respondendo na porta 5432." -Color Green
} else {
    Write-Step "AVISO" "Porta 5432 do PostgreSQL nao esta respondendo." -Color Yellow
    # Tenta verificar servico no Windows
    try {
        $pgSvc = Get-Service -Name "*postgres*" -ErrorAction SilentlyContinue | Where-Object { $_.Status -ne "Running" } | Select-Object -First 1
        if ($pgSvc) {
            Write-Host "         Tentando iniciar o servico $($pgSvc.Name)..." -ForegroundColor Yellow
            Start-Service $pgSvc.Name -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 2
            if (Test-TcpPort -Port 5432) {
                Write-Step "OK" "Servico $($pgSvc.Name) iniciado e respondendo na porta 5432." -Color Green
                $pgListening = $true
            }
        }
    } catch {}

    if (-not $pgListening) {
        Write-Host "         Certifique-se de que o servico do PostgreSQL 18 esta ativo antes de prosseguir." -ForegroundColor Yellow
    }
}

if ($CheckOnly) {
    Write-Banner "RELATORIO DE VERIFICACAO CONCLUIDO" -Color Yellow
    exit 0
}

if (-not $allOk) {
    Write-Host ""
    Write-Host "[ERRO] Dependencias obrigatorias estao ausentes. Corrija-as ou execute .\setup-env.ps1." -ForegroundColor Red
    exit 1
}

# --- 2. Preparacao de Configuracoes (.env) ---
Write-Host ""
Write-Host ">> Verificando arquivos de configuracao..." -ForegroundColor Cyan

$backendEnv = Join-Path $BackendDir ".env"
$backendEnvEx = Join-Path $BackendDir ".env.example"
if (-not (Test-Path $backendEnv)) {
    if (Test-Path $backendEnvEx) {
        Copy-Item $backendEnvEx $backendEnv
        Write-Step "CRIADO" "Arquivo 'backend/.env' gerado a partir do .env.example." -Color Green
    } else {
        Write-Step "AVISO" "Arquivo 'backend/.env' nao encontrado." -Color Yellow
    }
} else {
    Write-Step "OK" "Arquivo 'backend/.env' presente." -Color Green
}

$serverGoEnv = Join-Path $ServerGoDir ".env"
$serverGoEnvEx = Join-Path $ServerGoDir ".env.example"
if (-not (Test-Path $serverGoEnv)) {
    if (Test-Path $serverGoEnvEx) {
        Copy-Item $serverGoEnvEx $serverGoEnv
        Write-Step "CRIADO" "Arquivo 'server-go/.env' gerado a partir do .env.example." -Color Green
    } else {
        Write-Step "AVISO" "Arquivo 'server-go/.env' nao encontrado." -Color Yellow
    }
} else {
    Write-Step "OK" "Arquivo 'server-go/.env' presente." -Color Green
}

# Se frontend ativo, verifica instalacao de modulos
if (-not $NoFrontend) {
    $nodeModules = Join-Path $FrontendDir "node_modules"
    if (-not (Test-Path $nodeModules)) {
        Write-Host ">> Instalando dependencias do frontend (npm install em app-desktop)..." -ForegroundColor Cyan
        Push-Location $FrontendDir
        & npm install
        Pop-Location
    }
}

# --- 3. Execucao de Migrations (se solicitado) ---
if ($ApplyMigrations) {
    Write-Host ""
    Write-Host ">> Aplicando migrations no PostgreSQL (backend/migrations/*.sql)..." -ForegroundColor Cyan
    if (Test-CommandExists "psql") {
        $migrationFiles = Get-ChildItem (Join-Path $BackendDir "migrations\*.sql") | Sort-Object Name
        foreach ($mf in $migrationFiles) {
            Write-Step "MIGRATION" "Executando $($mf.Name)..." -Color Gray
            & psql -U postgres -d servicedesk -f $mf.FullName 2>&1 | Out-Null
        }
        Write-Step "OK" "Migrations concluidas." -Color Green
    } else {
        Write-Step "AVISO" "Utilitario 'psql' nao encontrado no PATH para aplicar migrations automaticamente." -Color Yellow
    }
}

# Encerra instancias residuais anteriores se houver
Stop-HostServices -Quiet

# --- 4. Inicializacao dos Servicos em Janelas Dedicadas ---
Write-Host ""
Write-Host ">> Inicializando servicos centrais..." -ForegroundColor Cyan

$spawnedProcesses = @()

# 4.1 Backend em Rust (Axum :8080)
$backendCmd = @"
`$host.UI.RawUI.WindowTitle = '[ServiceDesk] 1. Backend Principal (Rust :8080)'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location '$BackendDir'
Write-Host '======================================================================' -ForegroundColor Green
Write-Host '  SERVICEDESK - API PRINCIPAL (Rust / Axum)' -ForegroundColor Green
Write-Host '  Porta: 8080 | Status: Em execucao' -ForegroundColor Gray
Write-Host '======================================================================' -ForegroundColor Green
cargo run
"@
$procBackend = Start-Process powershell.exe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $backendCmd -PassThru
$spawnedProcesses += $procBackend
Write-Step "OK" "Backend Rust iniciado (PID: $($procBackend.Id)) -> http://localhost:8080" -Color Green

# 4.2 Servidor Go (Telemetria, gRPC e Acesso Remoto :8081 / :50051)
$serverGoCmd = @"
`$host.UI.RawUI.WindowTitle = '[ServiceDesk] 2. Servidor Go (Telemetria :8081 / gRPC :50051)'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location '$ServerGoDir'
Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host '  SERVICEDESK - SERVIDOR COORDENADOR ON-PREMISE (Go)' -ForegroundColor Cyan
Write-Host '  HTTP/WS: 8081 | gRPC: 50051 | Status: Em execucao' -ForegroundColor Gray
Write-Host '======================================================================' -ForegroundColor Cyan
go run ./cmd/server
"@
$procServerGo = Start-Process powershell.exe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $serverGoCmd -PassThru
$spawnedProcesses += $procServerGo
Write-Step "OK" "Servidor Go iniciado (PID: $($procServerGo.Id)) -> HTTP/WS :8081 | gRPC :50051" -Color Green

# 4.3 Frontend (Vite Web ou Tauri Desktop)
if (-not $NoFrontend) {
    if ($Desktop) {
        $feTitle = "[ServiceDesk] 3. App Desktop do Tecnico (Tauri)"
        $feRun = "npx tauri dev"
    } else {
        $feTitle = "[ServiceDesk] 3. Frontend Web (Vite :5173)"
        $feRun = "npm run dev"
    }

    $frontendCmd = @"
`$host.UI.RawUI.WindowTitle = '$feTitle'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location '$FrontendDir'
Write-Host '======================================================================' -ForegroundColor Magenta
Write-Host '  SERVICEDESK - $feTitle' -ForegroundColor Magenta
Write-Host '  Status: Em execucao' -ForegroundColor Gray
Write-Host '======================================================================' -ForegroundColor Magenta
$feRun
"@
    $procFrontend = Start-Process powershell.exe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $frontendCmd -PassThru
    $spawnedProcesses += $procFrontend
    Write-Step "OK" "Interface ($feTitle) iniciada (PID: $($procFrontend.Id))" -Color Green
}

# Salva PIDs para controle e encerramento posterior
$pidsToSave = $spawnedProcesses | ForEach-Object { $_.Id }
$pidsToSave | Set-Content -Path $PidFilePath -Force

Write-Banner "SERVICEDESK - TODOS OS SERVICOS DO HOST ESTAO EM EXECUCAO" -Color Green

Write-Host "  Endpoints e Servicos Disponiveis:" -ForegroundColor White
Write-Host "    - API Principal (Rust):         http://localhost:8080" -ForegroundColor Cyan
Write-Host "    - Telemetria e WebSocket (Go):  http://localhost:8081" -ForegroundColor Cyan
Write-Host "    - Servidor gRPC Central (Go):   localhost:50051" -ForegroundColor Cyan
if (-not $NoFrontend) {
    if ($Desktop) {
        Write-Host "    - App Desktop do Tecnico:       Janela nativa Tauri aberta" -ForegroundColor Cyan
    } else {
        Write-Host "    - Interface Web (Vite):         http://localhost:5173" -ForegroundColor Cyan
    }
}
Write-Host ""
Write-Host "  Comandos uteis em outro terminal:" -ForegroundColor Gray
Write-Host "    Parar todos os servicos:        .\run-host.ps1 -Stop" -ForegroundColor Gray
Write-Host ""

if ($Detached) {
    Write-Host "[INFO] Modo Detached ativo. Os servicos continuam em segundo plano." -ForegroundColor Yellow
    exit 0
}

Write-Host "  [Pressione 'Q' ou Ctrl+C neste terminal para encerrar todos os servicos do Host]" -ForegroundColor Yellow
Write-Host ""

# Loop de monitoramento interativo e captura de encerramento
try {
    while ($true) {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq [ConsoleKey]::Q) {
                Write-Host "`n[INFO] Tecla 'Q' pressionada. Encerrando servicos do Host..." -ForegroundColor Yellow
                break
            }
        }

        # Verifica se todos os processos essenciais continuam vivos
        $deadProcesses = $spawnedProcesses | Where-Object { $_.HasExited }
        if ($deadProcesses.Count -gt 0) {
            foreach ($dp in $deadProcesses) {
                Write-Host "[AVISO] O processo $($dp.Id) encerrou inesperadamente." -ForegroundColor Yellow
            }
            # Remove processos finalizados da lista para evitar repeticao do aviso
            $spawnedProcesses = $spawnedProcesses | Where-Object { -not $_.HasExited }
            if ($spawnedProcesses.Count -eq 0) {
                Write-Host "[AVISO] Todos os processos do Host foram encerrados." -ForegroundColor Yellow
                break
            }
        }

        Start-Sleep -Milliseconds 500
    }
} finally {
    Stop-HostServices
}
