#Requires -Version 5.1
<#
.SYNOPSIS
    Entrypoint principal para inicializacao e orquestracao dos modulos do lado
    do Cliente da plataforma ServiceDesk (Agente de Telemetria e App Desktop).

.DESCRIPTION
    Inicializa em janelas dedicadas e monitora os componentes locais da estacao do cliente:
      1. Verificacao de pre-requisitos (Rust/Cargo, Node.js, npm, WebView2)
      2. Configuracao dinamica de apontamento para o Host central (-ServerHost)
      3. Agente Local em Rust (coleta de metricas, telemetria gRPC, controle remoto nativo)
      4. App Desktop em Tauri (interface nativa do solicitante/tecnico) ou modo Web (-Web)
      5. Encerramento unificado e gracioso via Ctrl+C, tecla 'Q' ou flag -Stop

.PARAMETER ServerHost
    Endereco IP ou Hostname do servidor Host central onde o backend e o servidor Go estao rodando.
    Exemplos: -ServerHost "10.100.0.52" ou -ServerHost "192.168.1.15" ou -ServerHost "localhost".
    Se omitido, o script utiliza a configuracao existente em 'agent/.env' ou padroes locais.

.PARAMETER Web
    Inicia a interface no navegador via Vite (npm run dev) em vez de abrir a janela nativa Desktop via Tauri.

.PARAMETER Detached
    Inicia o Agente e o App Desktop em janelas separadas e encerra o script de orquestracao imediatamente sem monitorar.

.PARAMETER Stop
    Localiza e encerra imediatamente os processos ativos do Cliente (Agente e App Desktop) previamente iniciados por este script.

.PARAMETER CheckOnly
    Apenas valida dependencias, configuracoes e conectividade sem iniciar nenhum processo.

.EXAMPLE
    .\run-client.ps1
    Inicia o Agente Local e o App Desktop conectando ao servidor configurado localmente.

.EXAMPLE
    .\run-client.ps1 -ServerHost 10.100.0.52
    Inicia o Agente e o App Desktop apontando automaticamente para o servidor central no IP 10.100.0.52.

.EXAMPLE
    .\run-client.ps1 -Web
    Inicia o Agente e roda o frontend no navegador (modo Web de desenvolvimento).

.EXAMPLE
    .\run-client.ps1 -Stop
    Encerra todos os processos do Cliente em execucao.
#>

[CmdletBinding()]
param (
    [string]$ServerHost = "",
    [switch]$Web,
    [switch]$Detached,
    [switch]$Stop,
    [switch]$CheckOnly
)

$ErrorActionPreference = "Continue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir     = $PSScriptRoot
$AgentDir    = Join-Path $RootDir "agent"
$FrontendDir = Join-Path $RootDir "app-desktop"
$PidFilePath = Join-Path $env:TEMP "servicedesk-client.pids"

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
        "C:\Program Files\nodejs"
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
    param ([string]$HostName, [int]$Port, [int]$TimeoutMs = 1500)
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

function Test-WebView2Installed {
    $regPaths = @(
        "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
        "HKCU:\Software\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
    )
    foreach ($rp in $regPaths) {
        if (Test-Path $rp) {
            return $true
        }
    }
    return $false
}

function Stop-ClientServices {
    param ([switch]$Quiet)
    if (-not (Test-Path $PidFilePath)) {
        if (-not $Quiet) {
            Write-Host "[INFO] Nenhum registro de servicos do Cliente em execucao foi encontrado ($PidFilePath)." -ForegroundColor Yellow
        }
        return
    }

    $rawContent = Get-Content $PidFilePath -ErrorAction SilentlyContinue
    $pids = $rawContent -split '[\r\n]+' | Where-Object { $_ -match '^\d+$' } | ForEach-Object { [int]$_ }

    if ($pids.Count -gt 0) {
        if (-not $Quiet) {
            Write-Banner "ENCERRANDO COMPONENTES DO CLIENTE" -Color Yellow
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
        Write-Step "OK" "Todos os componentes do Cliente foram encerrados com sucesso." -Color Green
    }
}

# --- Se acionado com -Stop, encerra processos e sai ---
if ($Stop) {
    Stop-ClientServices
    exit 0
}

Update-SessionPath

Write-Banner "SERVICEDESK - INICIALIZADOR DO CLIENTE (AGENTE + APP)" -Color Cyan
Write-Host "  Este script inicializa os componentes da estacao do cliente:" -ForegroundColor Gray
Write-Host "    - Agente Local em Rust (Monitoramento, gRPC local :3000 e Acesso Remoto)" -ForegroundColor Gray
if ($Web) {
    Write-Host "    - App em modo Web (http://localhost:5173)" -ForegroundColor Gray
} else {
    Write-Host "    - App Desktop Nativo via Tauri (npx tauri dev)" -ForegroundColor Gray
}
Write-Host ""

# --- 1. Verificacao de Pre-requisitos ---
Write-Host ">> Verificando ferramentas e dependencias locais..." -ForegroundColor Cyan

$allOk = $true

if (Test-CommandExists "cargo") {
    $cargoVer = (& cargo --version 2>&1 | Out-String).Trim()
    Write-Step "OK" "Rust / Cargo: $cargoVer" -Color Green
} else {
    Write-Step "ERRO" "Rust / Cargo nao encontrado no PATH. Necessario para compilar e rodar o Agente." -Color Red
    $allOk = $false
}

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

if (-not $Web) {
    if (Test-WebView2Installed) {
        Write-Step "OK" "Microsoft Edge WebView2 Runtime instalado." -Color Green
    } else {
        Write-Step "AVISO" "Edge WebView2 Runtime nao detectado no registro padrao. O Tauri pode requerer sua presenca." -Color Yellow
    }
}

# --- 2. Determinacao e Verificacao do Host Central ---
$agentEnv = Join-Path $AgentDir ".env"
$agentEnvEx = Join-Path $AgentDir ".env.example"
if (-not (Test-Path $agentEnv)) {
    if (Test-Path $agentEnvEx) {
        Copy-Item $agentEnvEx $agentEnv
        Write-Step "CRIADO" "Arquivo 'agent/.env' gerado a partir do .env.example." -Color Green
    }
}

# Determina os enderecos de conexao
$targetHost = "127.0.0.1"
if ($ServerHost -ne "") {
    $targetHost = $ServerHost.Trim()
    Write-Step "CONFIG" "Servidor Host especificado via parametro: $targetHost" -Color Cyan
} else {
    # Tenta ler SERVER_GO_GRPC_URL do .env do agente
    if (Test-Path $agentEnv) {
        $envLines = Get-Content $agentEnv
        foreach ($line in $envLines) {
            if ($line -match '^\s*SERVER_GO_GRPC_URL\s*=\s*(?:https?:\/\/)?([^:\/]+)') {
                $targetHost = $matches[1]
                break
            }
        }
    }
    Write-Step "CONFIG" "Servidor Host detectado a partir de 'agent/.env': $targetHost" -Color Cyan
}

$grpcServerUrl    = "http://${targetHost}:50051"
$remoteWsUrl      = "ws://${targetHost}:8081/api/remoto/agente/ws"
$apiBaseUrl       = "http://${targetHost}:8080"
$telemetriaApiUrl = "http://${targetHost}:8081"

# Testa conectividade com o servidor central
Write-Host ""
Write-Host ">> Testando conectividade com o Host central ($targetHost)..." -ForegroundColor Cyan

$hostPort8081 = Test-TcpPort -HostName $targetHost -Port 8081
$hostPort50051 = Test-TcpPort -HostName $targetHost -Port 50051

if ($hostPort8081 -or $hostPort50051) {
    Write-Step "OK" "Conexao com o Host ($targetHost) estabelecida com sucesso." -Color Green
} else {
    Write-Step "AVISO" "Nao foi possivel conectar as portas do Host (${targetHost}:8081 ou 50051)." -Color Yellow
    Write-Host "         Verifique se os servicos do Host estao ativos rodando '.\run-host.ps1' no computador servidor" -ForegroundColor Yellow
    Write-Host "         e se a porta esta liberada no Firewall da rede." -ForegroundColor Yellow
}

if ($CheckOnly) {
    Write-Banner "RELATORIO DE VERIFICACAO DO CLIENTE CONCLUIDO" -Color Yellow
    exit 0
}

if (-not $allOk) {
    Write-Host ""
    Write-Host "[ERRO] Dependencias obrigatorias estao ausentes. Corrija-as ou execute .\setup-env.ps1." -ForegroundColor Red
    exit 1
}

# --- 3. Verificacao de node_modules do App Desktop ---
$nodeModules = Join-Path $FrontendDir "node_modules"
if (-not (Test-Path $nodeModules)) {
    Write-Host ">> Instalando dependencias do frontend (npm install em app-desktop)..." -ForegroundColor Cyan
    Push-Location $FrontendDir
    & npm install
    Pop-Location
}

# Encerra instancias residuais anteriores se houver
Stop-ClientServices -Quiet

# --- 4. Inicializacao dos Componentes do Cliente em Janelas Dedicadas ---
Write-Host ""
Write-Host ">> Inicializando componentes do Cliente..." -ForegroundColor Cyan

$spawnedProcesses = @()

# 4.1 Agente Local em Rust
$agentCmd = @"
`$host.UI.RawUI.WindowTitle = '[ServiceDesk] 1. Agente Local (Rust :3000)'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location '$AgentDir'
`$env:SERVER_GO_GRPC_URL = '$grpcServerUrl'
`$env:SERVER_GO_REMOTE_WS_URL = '$remoteWsUrl'
`$env:REMOTE_CONTROL_ENABLED = 'true'
Write-Host '======================================================================' -ForegroundColor Green
Write-Host '  SERVICEDESK - AGENTE LOCAL (Rust / Tokio / Tonic)' -ForegroundColor Green
Write-Host '  Endpoint gRPC Local: 0.0.0.0:3000' -ForegroundColor Gray
Write-Host '  Servidor Central Alvo: $grpcServerUrl' -ForegroundColor Gray
Write-Host '  Status: Em execucao' -ForegroundColor Gray
Write-Host '======================================================================' -ForegroundColor Green
Write-Host '  NOTA: Quando o tecnico solicitar Acesso Remoto, o codigo aleatorio' -ForegroundColor Yellow
Write-Host '        de pareamento gerado pelo agente sera exibido nesta janela.' -ForegroundColor Yellow
Write-Host '======================================================================' -ForegroundColor Green
cargo run
"@
$procAgent = Start-Process powershell.exe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $agentCmd -PassThru
$spawnedProcesses += $procAgent
Write-Step "OK" "Agente Local iniciado (PID: $($procAgent.Id)) -> Servidor Alvo: $grpcServerUrl" -Color Green

# 4.2 App Desktop (Tauri ou Web)
if ($Web) {
    $appTitle = "[ServiceDesk] 2. App Desktop em Modo Web (Vite :5173)"
    $appRun   = "npm run dev"
} else {
    $appTitle = "[ServiceDesk] 2. App Desktop Nativo (Tauri)"
    $appRun   = "npx tauri dev"
}

$appCmd = @"
`$host.UI.RawUI.WindowTitle = '$appTitle'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Set-Location '$FrontendDir'
`$env:VITE_API_URL = '$apiBaseUrl'
`$env:VITE_TELEMETRIA_API_URL = '$telemetriaApiUrl'
Write-Host '======================================================================' -ForegroundColor Cyan
Write-Host '  SERVICEDESK - $appTitle' -ForegroundColor Cyan
Write-Host '  API Central: $apiBaseUrl' -ForegroundColor Gray
Write-Host '  Telemetria:  $telemetriaApiUrl' -ForegroundColor Gray
Write-Host '  Status: Em execucao' -ForegroundColor Gray
Write-Host '======================================================================' -ForegroundColor Cyan
$appRun
"@
$procApp = Start-Process powershell.exe -ArgumentList "-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $appCmd -PassThru
$spawnedProcesses += $procApp
Write-Step "OK" "App Desktop iniciado (PID: $($procApp.Id))" -Color Green

# Salva PIDs para controle e encerramento posterior
$pidsToSave = $spawnedProcesses | ForEach-Object { $_.Id }
$pidsToSave | Set-Content -Path $PidFilePath -Force

Write-Banner "SERVICEDESK - COMPONENTES DO CLIENTE ESTAO EM EXECUCAO" -Color Green

Write-Host "  Resumo da Operacao do Cliente:" -ForegroundColor White
Write-Host "    - Agente Local (gRPC):        localhost:3000" -ForegroundColor Cyan
Write-Host "    - Servidor Central Alvo:      $targetHost (gRPC: 50051 / HTTP: 8081)" -ForegroundColor Cyan
Write-Host "    - API de Chamados e Auth:     $apiBaseUrl" -ForegroundColor Cyan
if ($Web) {
    Write-Host "    - Interface do Usuario:       http://localhost:5173 (Navegador)" -ForegroundColor Cyan
} else {
    Write-Host "    - Interface do Usuario:       Janela nativa Tauri aberta" -ForegroundColor Cyan
}
Write-Host ""
Write-Host "  ACESSO REMOTO:" -ForegroundColor Yellow
Write-Host "    O codigo de pareamento para liberar acesso remoto e gerado na janela" -ForegroundColor Yellow
Write-Host "    dedicada do Agente Local ('[ServiceDesk] 1. Agente Local')." -ForegroundColor Yellow
Write-Host ""
Write-Host "  Comandos uteis em outro terminal:" -ForegroundColor Gray
Write-Host "    Parar componentes do cliente: .\run-client.ps1 -Stop" -ForegroundColor Gray
Write-Host ""

if ($Detached) {
    Write-Host "[INFO] Modo Detached ativo. Os componentes continuam em segundo plano." -ForegroundColor Yellow
    exit 0
}

Write-Host "  [Pressione 'Q' ou Ctrl+C neste terminal para encerrar o Agente e o App]" -ForegroundColor Yellow
Write-Host ""

# Loop de monitoramento interativo e captura de encerramento
try {
    while ($true) {
        if ([Console]::KeyAvailable) {
            $key = [Console]::ReadKey($true)
            if ($key.Key -eq [ConsoleKey]::Q) {
                Write-Host "`n[INFO] Tecla 'Q' pressionada. Encerrando componentes do Cliente..." -ForegroundColor Yellow
                break
            }
        }

        # Verifica se todos os processos continuam vivos
        $deadProcesses = $spawnedProcesses | Where-Object { $_.HasExited }
        if ($deadProcesses.Count -gt 0) {
            foreach ($dp in $deadProcesses) {
                Write-Host "[AVISO] O processo $($dp.Id) encerrou inesperadamente." -ForegroundColor Yellow
            }
            $spawnedProcesses = $spawnedProcesses | Where-Object { -not $_.HasExited }
            if ($spawnedProcesses.Count -eq 0) {
                Write-Host "[AVISO] Todos os componentes do Cliente foram encerrados." -ForegroundColor Yellow
                break
            }
        }

        Start-Sleep -Milliseconds 500
    }
} finally {
    Stop-ClientServices
}
