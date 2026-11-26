#Requires -Version 5.1
<#
.SYNOPSIS
    Pipeline automatizado para compilar e gerar a Release Oficial do Servidor (Windows .exe e Docker).

.DESCRIPTION
    1. Compila o Backend em Rust (Axum) em modo release otimizado.
    2. Compila o Servidor Go em modo release com stripping de símbolos.
    3. Monta a árvore de binários de distribuição em dist/server/bin.
    4. Compila o instalador Windows via Inno Setup (ServiceDesk-Server-Setup-<versao>.exe).
    5. Empacota o bundle Docker On-Premise em um arquivo ZIP pronto para distribuição.

.PARAMETER Version
    Versão da release a ser gerada (padrão: "1.0.0").

.PARAMETER SkipDockerZip
    Pula a geração do pacote ZIP do Docker.

.PARAMETER SkipInstaller
    Pula a compilação do instalador Inno Setup.
#>

[CmdletBinding()]
param (
    [string]$Version = "1.0.0",
    [switch]$SkipDockerZip,
    [switch]$SkipInstaller
)

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$RootDir   = $PSScriptRoot
$DistDir   = Join-Path $RootDir "dist"
$ServerBin = Join-Path $DistDir "server\bin"

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
    Write-Host ("  " + $badge.PadRight(9) + " " + $Message) -ForegroundColor $Color
}

Write-Banner "BUILD DA RELEASE DO SERVIDOR SERVICEDESK v$Version" -Color Green

# Cria diretórios de distribuição
if (-not (Test-Path $ServerBin)) {
    New-Item -ItemType Directory -Path $ServerBin -Force | Out-Null
}

# --- 1. Compilação do Backend em Rust ---
Write-Step "BUILD" "Compilando Backend em Rust (Axum) em modo release..." -Color Cyan
$backendManifest = Join-Path $RootDir "backend\Cargo.toml"
& cargo build --release --bin servicedesk-api --manifest-path $backendManifest
if ($LASTEXITCODE -ne 0) { throw "Falha na compilação do Backend em Rust." }

$rustCompiledExe = Join-Path $RootDir "backend\target\release\servicedesk-api.exe"
Copy-Item $rustCompiledExe (Join-Path $ServerBin "servicedesk-api.exe") -Force
Write-Step "OK" "Backend compilado com sucesso -> $ServerBin\servicedesk-api.exe" -Color Green

# --- 2. Compilação do Servidor Go ---
Write-Step "BUILD" "Compilando Servidor Go (Telemetria/Acesso Remoto) em modo release..." -Color Cyan
$serverGoDir = Join-Path $RootDir "server-go"
Push-Location $serverGoDir
& go build -ldflags="-s -w" -o (Join-Path $ServerBin "server-go.exe") ./cmd/server
$goExit = $LASTEXITCODE
Pop-Location
if ($goExit -ne 0) { throw "Falha na compilação do Servidor Go." }
Write-Step "OK" "Servidor Go compilado com sucesso -> $ServerBin\server-go.exe" -Color Green

# --- 3. Cópia dos Scripts do Terminal de Controle ---
Write-Step "STAGE" "Copiando utilitários de terminal e controle (servicedesk-ctl)..." -Color Cyan
$ctlCmd = Join-Path $RootDir "packaging\server\windows\servicedesk-ctl.cmd"
$ctlPs1 = Join-Path $RootDir "packaging\server\windows\servicedesk-ctl.ps1"
Copy-Item $ctlCmd (Join-Path $ServerBin "servicedesk-ctl.cmd") -Force
Copy-Item $ctlPs1 (Join-Path $ServerBin "servicedesk-ctl.ps1") -Force
Write-Step "OK" "Utilitários copiados para $ServerBin" -Color Green

# --- 4. Compilação do Instalador Inno Setup (.exe) ---
if (-not $SkipInstaller) {
    Write-Step "PACKAGE" "Localizando compilador Inno Setup (iscc.exe)..." -Color Cyan

    $isccPaths = @(
        "iscc.exe",
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\iscc.exe",
        "C:\Program Files (x86)\Inno Setup 6\iscc.exe",
        "C:\Program Files\Inno Setup 6\iscc.exe"
    )

    $isccCmd = $null
    foreach ($p in $isccPaths) {
        if (Get-Command $p -ErrorAction SilentlyContinue) {
            $isccCmd = $p
            break
        } elseif (Test-Path $p) {
            $isccCmd = $p
            break
        }
    }

    if ($isccCmd) {
        Write-Step "ISCC" "Compilador encontrado: $isccCmd" -Color Green
        $issFile = Join-Path $RootDir "packaging\server\windows\servicedesk-server.iss"

        & $isccCmd "/DAppVersion=$Version" "/DSourceBinDir=$ServerBin" "/DOutputDir=$DistDir" $issFile
        if ($LASTEXITCODE -eq 0) {
            Write-Step "OK" "Instalador gerado: $DistDir\ServiceDesk-Server-Setup-$Version.exe" -Color Green
        } else {
            Write-Step "AVISO" "Inno Setup retornou código $LASTEXITCODE." -Color Yellow
        }
    } else {
        Write-Step "AVISO" "Inno Setup (iscc.exe) não foi encontrado no PATH. Instalador .exe pulado." -Color Yellow
    }
}

# --- 5. Criação do Pacote Docker On-Premise (ZIP) ---
if (-not $SkipDockerZip) {
    Write-Step "DOCKER" "Gerando pacote ZIP para distribuição Docker on-premise..." -Color Cyan
    $dockerBundleDir = Join-Path $DistDir "ServiceDesk-Server-Docker-$Version"
    if (Test-Path $dockerBundleDir) { Remove-Item $dockerBundleDir -Recurse -Force }
    New-Item -ItemType Directory -Path $dockerBundleDir -Force | Out-Null

    # Copia arquivos necessários para o Docker
    Copy-Item (Join-Path $RootDir "docker-compose.yml") (Join-Path $dockerBundleDir "docker-compose.yml")
    Copy-Item (Join-Path $RootDir ".env.docker.example") (Join-Path $dockerBundleDir ".env.example")

    # Copia código e dockerfiles de backend e server-go (sem pastas de build pesadas)
    & robocopy (Join-Path $RootDir "backend") (Join-Path $dockerBundleDir "backend") /E /XD "target" ".git" | Out-Null
    & robocopy (Join-Path $RootDir "server-go") (Join-Path $dockerBundleDir "server-go") /E /XD "bin" ".git" | Out-Null
    & robocopy (Join-Path $RootDir "deploy") (Join-Path $dockerBundleDir "deploy") /E /XD ".git" | Out-Null

    # Cria README explicativo do pacote Docker
    $dockerReadme = @"
# ServiceDesk Server On-Premise - Pacote Docker v$Version

Este pacote contém todos os serviços necessários para executar o Servidor Central do ServiceDesk em um ambiente containerizado Linux ou Windows.

## Pré-requisitos
- Docker Engine 24+ ou Docker Desktop
- Docker Compose v2+

## Inicialização Rápida

1. Copie o arquivo de exemplo de ambiente:
   cp .env.example .env

2. Ajuste as credenciais no arquivo .env se desejar.

3. Inicie todos os serviços:
   docker compose up -d

4. Acompanhe os logs em tempo real:
   docker compose logs -f

## Endpoints Expostos
- API Principal (Rust):        http://localhost:8080
- Telemetria e WebSocket (Go): http://localhost:8081
- Servidor gRPC Central (Go):  localhost:50051
- PostgreSQL:                  localhost:5432
"@
    Set-Content -Path (Join-Path $dockerBundleDir "README.md") -Value $dockerReadme -Encoding UTF8

    $zipFile = Join-Path $DistDir "ServiceDesk-Server-Docker-$Version.zip"
    if (Test-Path $zipFile) { Remove-Item $zipFile -Force }

    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [System.IO.Compression.ZipFile]::CreateFromDirectory($dockerBundleDir, $zipFile)
    Remove-Item $dockerBundleDir -Recurse -Force
    Write-Step "OK" "Pacote Docker gerado: $zipFile" -Color Green
}

Write-Banner "RELEASE DO SERVIDOR CONCLUÍDA COM SUCESSO!" -Color Green
Write-Host "  Artefatos prontos em: $DistDir" -ForegroundColor White
if (Test-Path (Join-Path $DistDir "ServiceDesk-Server-Setup-$Version.exe")) {
    Write-Host "    - Instalador Windows: dist\ServiceDesk-Server-Setup-$Version.exe" -ForegroundColor Cyan
}
if (Test-Path (Join-Path $DistDir "ServiceDesk-Server-Docker-$Version.zip")) {
    Write-Host "    - Pacote Docker:      dist\ServiceDesk-Server-Docker-$Version.zip" -ForegroundColor Cyan
}
Write-Host ""
