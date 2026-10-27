#Requires -Version 5.1
<#
.SYNOPSIS
    Script oficial de preparacao e verificacao do ambiente de desenvolvimento do projeto ServiceDesk.

.DESCRIPTION
    Verifica e instala todas as dependencias necessarias para compilar e executar os modulos do monorepo:
      - Frontend / Desktop: Node.js (LTS), Edge WebView2 Runtime, Visual Studio 2022 Build Tools (C++)
      - Banco de Dados: PostgreSQL 18
      - Backend e Agente Local: Rust (rustup / cargo)
      - Servidor On-Premise e Telemetria gRPC: Go (Golang), Protocol Buffers (protoc) e plugins Go gRPC

.PARAMETER CheckOnly
    Apenas verifica o status de instalacao de cada ferramenta sem executar instalacoes.

.PARAMETER SkipDatabase
    Pula a instalacao do PostgreSQL 18 (util caso utilize banco em container Docker ou servidor remoto).

.PARAMETER SkipVSBuildTools
    Pula a instalacao do Visual Studio 2022 Build Tools (caso ja possua o Visual Studio Community/Pro instalado).

.EXAMPLE
    .\setup-env.ps1
    Verifica e instala todas as ferramentas ausentes e configura os plugins gRPC do Go.

.EXAMPLE
    .\setup-env.ps1 -CheckOnly
    Exibe um relatorio completo das ferramentas instaladas e pendentes na maquina.
#>

[CmdletBinding()]
param (
    [switch]$CheckOnly,
    [switch]$SkipDatabase,
    [switch]$SkipVSBuildTools
)

$ErrorActionPreference = "Continue"

function Write-Banner {
    param ([string]$Title)
    Write-Host ""
    Write-Host "======================================================================" -ForegroundColor Cyan
    Write-Host ("  " + $Title) -ForegroundColor Cyan
    Write-Host "======================================================================" -ForegroundColor Cyan
}

function Test-IsAdministrator {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
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
        "C:\Program Files\PostgreSQL\18\bin"
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

function Test-WingetPackageInstalled {
    param ([string]$PackageId)
    $output = winget list --id $PackageId --exact --accept-source-agreements 2>$null | Out-String
    return ($LASTEXITCODE -eq 0 -and $output -match [regex]::Escape($PackageId))
}

function Install-ToolWithWinget {
    param (
        [Parameter(Mandatory = $true)][string]$Id,
        [Parameter(Mandatory = $true)][string]$Name,
        [string]$CommandCheck = "",
        [string]$OverrideArgs = "",
        [bool]$CustomInstalledCheck = $false
    )

    Update-SessionPath

    $alreadyPresent = $false
    if ($CustomInstalledCheck) {
        $alreadyPresent = $true
    } elseif ($CommandCheck -and (Test-CommandExists $CommandCheck)) {
        $alreadyPresent = $true
    } elseif (-not $CommandCheck -and (Test-WingetPackageInstalled -PackageId $Id)) {
        $alreadyPresent = $true
    }

    if ($alreadyPresent) {
        Write-Host "  [OK] $Name ja esta instalado." -ForegroundColor Green
        return $true
    }

    if ($CheckOnly) {
        Write-Host "  [PENDENTE] $Name ($Id) nao encontrado." -ForegroundColor Yellow
        return $false
    }

    Write-Host "`n  -> Instalando $Name ($Id) via Winget..." -ForegroundColor Yellow
    $wingetArgs = @(
        "install",
        "--id", $Id,
        "--exact",
        "--accept-package-agreements",
        "--accept-source-agreements"
    )
    if ($OverrideArgs) {
        $wingetArgs += @("--override", $OverrideArgs)
    }

    & winget @wingetArgs

    if ($LASTEXITCODE -eq 0 -or $LASTEXITCODE -eq -1978335189 -or $LASTEXITCODE -eq 2316632065) {
        Update-SessionPath
        Write-Host "  [OK] $Name instalado com sucesso!" -ForegroundColor Green
        return $true
    } else {
        Write-Host "  [ERRO] Falha ao instalar $Name (Codigo: $LASTEXITCODE)." -ForegroundColor Red
        return $false
    }
}

function Install-GoGrpcPlugins {
    Update-SessionPath

    if (-not (Test-CommandExists "go")) {
        if ($CheckOnly) {
            Write-Host "  [PENDENTE] Plugins Go gRPC (protoc-gen-go / protoc-gen-go-grpc) aguardando instalacao do Go." -ForegroundColor Yellow
        } else {
            Write-Host "  [AVISO] Comando 'go' ainda nao disponivel nesta sessao. Reabra o terminal e rode novamente para instalar os plugins gRPC." -ForegroundColor Yellow
        }
        return
    }

    $plugins = @(
        @{ Name = "protoc-gen-go";      Cmd = "protoc-gen-go";      Pkg = "google.golang.org/protobuf/cmd/protoc-gen-go@latest" },
        @{ Name = "protoc-gen-go-grpc"; Cmd = "protoc-gen-go-grpc"; Pkg = "google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest" }
    )

    foreach ($plugin in $plugins) {
        if (Test-CommandExists $plugin.Cmd) {
            Write-Host "  [OK] Plugin Go '$($plugin.Name)' ja esta instalado." -ForegroundColor Green
            continue
        }

        if ($CheckOnly) {
            Write-Host "  [PENDENTE] Plugin Go '$($plugin.Name)' nao encontrado em GOPATH\bin." -ForegroundColor Yellow
            continue
        }

        Write-Host "  -> Instalando plugin Go '$($plugin.Name)'..." -ForegroundColor Yellow
        & go install $plugin.Pkg
        Update-SessionPath

        if ($LASTEXITCODE -eq 0) {
            Write-Host "  [OK] Plugin '$($plugin.Name)' instalado em $(go env GOPATH)\bin" -ForegroundColor Green
        } else {
            Write-Host "  [ERRO] Falha ao instalar '$($plugin.Name)'." -ForegroundColor Red
        }
    }
}

# =====================================================================
# Execucao Principal
# =====================================================================

Write-Banner "ServiceDesk - Preparacao do Ambiente de Desenvolvimento"

if (-not (Test-CommandExists "winget")) {
    Write-Host "[ERRO CRITICO] O gerenciador 'winget' nao foi encontrado neste Windows." -ForegroundColor Red
    Write-Host "Instale o 'App Installer' pela Microsoft Store antes de continuar." -ForegroundColor Yellow
    exit 1
}

if (-not $CheckOnly -and -not (Test-IsAdministrator)) {
    Write-Host "[AVISO] Este script nao esta rodando como Administrador." -ForegroundColor Yellow
    Write-Host "Alguns instaladores (PostgreSQL / VS Build Tools) podem solicitar elevacao UAC." -ForegroundColor Yellow
}

Write-Host "`n[1/7] Verificando Node.js (LTS) - Frontend React/Vite..." -ForegroundColor Cyan
Install-ToolWithWinget -Id "OpenJS.NodeJS.LTS" -Name "Node.js (LTS)" -CommandCheck "node" | Out-Null

Write-Host "`n[2/7] Verificando PostgreSQL 18 - Banco de Dados Relacional..." -ForegroundColor Cyan
if ($SkipDatabase) {
    Write-Host "  [PULADO] Instalacao do PostgreSQL ignorada via -SkipDatabase." -ForegroundColor DarkGray
} else {
    Install-ToolWithWinget -Id "PostgreSQL.PostgreSQL.18" -Name "PostgreSQL 18" -CommandCheck "psql" | Out-Null
}

Write-Host "`n[3/7] Verificando Visual Studio 2022 Build Tools (C++) - Compilador nativo para Rust/Tauri/C..." -ForegroundColor Cyan
if ($SkipVSBuildTools) {
    Write-Host "  [PULADO] Instalacao do VS Build Tools ignorada via -SkipVSBuildTools." -ForegroundColor DarkGray
} else {
    $vsOverride = "--passive --wait --add Microsoft.VisualStudio.Workload.VCTools;includeRecommended"
    $clInstalled = [bool](Get-Item "${env:ProgramFiles(x86)}\Microsoft Visual Studio\*\*\VC\Tools\MSVC", "${env:ProgramFiles}\Microsoft Visual Studio\*\*\VC\Tools\MSVC" -ErrorAction SilentlyContinue)
    Install-ToolWithWinget -Id "Microsoft.VisualStudio.2022.BuildTools" -Name "Visual Studio C++ Build Tools (MSVC)" -OverrideArgs $vsOverride -CustomInstalledCheck $clInstalled | Out-Null
}

Write-Host "`n[4/7] Verificando Microsoft Edge WebView2 Runtime - Renderizador Tauri..." -ForegroundColor Cyan
Install-ToolWithWinget -Id "Microsoft.EdgeWebView2Runtime" -Name "Edge WebView2 Runtime" -CustomInstalledCheck (Test-WebView2Installed) | Out-Null

Write-Host "`n[5/7] Verificando Rust (Rustup e Cargo) - Backend e Agente Local..." -ForegroundColor Cyan
Install-ToolWithWinget -Id "Rustlang.Rustup" -Name "Rust (Rustup)" -CommandCheck "cargo" | Out-Null

Write-Host "`n[6/7] Verificando Go (Golang) - Servidor Coordenador On-Premise..." -ForegroundColor Cyan
Install-ToolWithWinget -Id "GoLang.Go" -Name "Go (Golang)" -CommandCheck "go" | Out-Null

Write-Host "`n[7/7] Verificando Protocol Buffers (protoc) e Plugins Go gRPC..." -ForegroundColor Cyan
Install-ToolWithWinget -Id "Google.Protobuf" -Name "Protocol Buffers Compiler (protoc)" -CommandCheck "protoc" | Out-Null
Install-GoGrpcPlugins

# =====================================================================
# Resumo Final de Verificacao
# =====================================================================
Update-SessionPath
Write-Banner "Resumo do Ambiente (ServiceDesk)"

$checks = @(
    @{ Ferramenta = "Node.js";              Comando = "node";               VersaoArg = "--version" },
    @{ Ferramenta = "NPM";                  Comando = "npm";                VersaoArg = "--version" },
    @{ Ferramenta = "Rust (Cargo)";         Comando = "cargo";              VersaoArg = "--version" },
    @{ Ferramenta = "Rust (Compiler)";      Comando = "rustc";              VersaoArg = "--version" },
    @{ Ferramenta = "Go (Golang)";          Comando = "go";                 VersaoArg = "version"   },
    @{ Ferramenta = "Protobuf (protoc)";    Comando = "protoc";             VersaoArg = "--version" },
    @{ Ferramenta = "Plugin protoc-gen-go"; Comando = "protoc-gen-go";      VersaoArg = "--version" },
    @{ Ferramenta = "Plugin go-grpc";       Comando = "protoc-gen-go-grpc"; VersaoArg = "--version" },
    @{ Ferramenta = "PostgreSQL (psql)";    Comando = "psql";               VersaoArg = "--version" }
)

foreach ($item in $checks) {
    if (Test-CommandExists $item.Comando) {
        $ver = (& $item.Comando $item.VersaoArg 2>$null | Select-Object -First 1)
        Write-Host ("  [OK]       {0,-24} -> {1}" -f $item.Ferramenta, $ver) -ForegroundColor Green
    } else {
        Write-Host ("  [AUSENTE]  {0,-24} -> Nao encontrado no PATH atual" -f $item.Ferramenta) -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Proximos passos:" -ForegroundColor Cyan
Write-Host "  1. Caso tenha acabado de instalar Go, Rust ou Protoc, feche e reabra o terminal."
Write-Host "  2. Certifique-se de que o GOPATH\bin (%USERPROFILE%\go\bin) esta no seu PATH."
Write-Host "  3. Configure o arquivo 'backend\.env' (baseado em 'backend\.env.example')."
Write-Host ""
