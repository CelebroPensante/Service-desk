#Requires -Version 5.1
<#
.SYNOPSIS
    Executa toda a bateria de testes do ecossistema de Telemetria (Agente Rust + Servidor Go + PostgreSQL)
    e exporta o relatorio consolidado para arquivo.

.PARAMETER OutputFile
    Caminho do arquivo onde o log/relatorio dos testes sera exportado.
#>
param (
    [string]$OutputFile = "$PSScriptRoot\..\relatorio-testes-telemetria.txt"
)

$ErrorActionPreference = "Continue"
$env:Path += ";$env:USERPROFILE\.cargo\bin;$env:USERPROFILE\go\bin;C:\Program Files\Go\bin;C:\Program Files\PostgreSQL\18\bin"

$rootDir   = Resolve-Path "$PSScriptRoot\..\.."
$agentDir  = Join-Path $rootDir "agent"
$serverDir = Join-Path $rootDir "server-go"

$report = New-Object System.Text.StringBuilder
function Add-Section([string]$title) {
    $line = "=" * 72
    $null = $report.AppendLine("")
    $null = $report.AppendLine($line)
    $null = $report.AppendLine("  $title")
    $null = $report.AppendLine($line)
    Write-Host "`n$line`n  $title`n$line" -ForegroundColor Cyan
}

$null = $report.AppendLine("RELATORIO DE TESTES DE TELEMETRIA - SERVICEDESK")
$null = $report.AppendLine("Data/Hora: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")

# 1. Testes Unitarios do Agente em Rust
Add-Section "1. TESTES UNITARIOS DO AGENTE EM RUST (cargo test)"
Push-Location $agentDir
$rustTests = (& cargo test 2>&1 | Out-String)
Pop-Location
Write-Host $rustTests
$null = $report.AppendLine($rustTests)

# 2. Testes Unitarios e de Integracao do Servidor em Go (Hub, Watchdog, gRPC, HTTP e WebSocket)
Add-Section "2. TESTES AUTOMATIZADOS DO SERVIDOR GO (go test -v ./...)"
Push-Location $serverDir
$goTests = (& go test -v ./... 2>&1 | Out-String)
Pop-Location
Write-Host $goTests
$null = $report.AppendLine($goTests)

# 3. Teste E2E gRPC Direto no Agente Local (Porta 3000)
Add-Section "3. TESTE E2E gRPC NO AGENTE LOCAL (ObterTelemetria :3000)"
Push-Location $agentDir
$grpcAgentOut = (& cargo run --quiet --bin test_client 2>&1 | Out-String)
Pop-Location
Write-Host $grpcAgentOut
$null = $report.AppendLine($grpcAgentOut)

# 4. Teste E2E API HTTP do Servidor Go (Porta 8081)
Add-Section "4. TESTE E2E API HTTP DO SERVIDOR GO (:8081)"
try {
    $health = Invoke-RestMethod -Uri "http://localhost:8081/health" -TimeoutSec 5 | ConvertTo-Json -Depth 5
    $maquinas = Invoke-RestMethod -Uri "http://localhost:8081/api/telemetria/maquinas" -TimeoutSec 5 | ConvertTo-Json -Depth 6
    $httpOut = "--- GET /health ---`n$health`n`n--- GET /api/telemetria/maquinas ---`n$maquinas"
} catch {
    $httpOut = "Servidor Go nao estava ativo na porta 8081 durante a chamada E2E: $_"
}
Write-Host $httpOut
$null = $report.AppendLine($httpOut)

$report.ToString() | Set-Content -Path $OutputFile -Encoding UTF8
Write-Host "`nRelatorio exportado com sucesso em: $OutputFile" -ForegroundColor Green
