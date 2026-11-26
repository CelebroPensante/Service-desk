; ==============================================================================
; ServiceDesk On-Premise Server - Inno Setup Installer Script
; ==============================================================================
#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif

#ifndef SourceBinDir
  #define SourceBinDir "..\..\..\dist\server\bin"
#endif

#ifndef MigrationSourceDir
  #define MigrationSourceDir "..\..\..\backend\migrations"
#endif

[Setup]
AppName=ServiceDesk Server
AppVersion={#AppVersion}
AppPublisher=ServiceDesk Team
DefaultDirName={autopf}\ServiceDesk Server
DefaultGroupName=ServiceDesk Server
OutputDir=..\..\..\dist
OutputBaseFilename=ServiceDesk-Server-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
UninstallDisplayIcon={app}\bin\servicedesk-ctl.cmd
DisableWelcomePage=no
DisableProgramGroupPage=yes

[Files]
; Binários dos serviços do servidor
Source: "{#SourceBinDir}\servicedesk-api.exe"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "{#SourceBinDir}\server-go.exe"; DestDir: "{app}\bin"; Flags: ignoreversion

; Scripts de Controle e Terminal
Source: "servicedesk-ctl.cmd"; DestDir: "{app}\bin"; Flags: ignoreversion
Source: "servicedesk-ctl.ps1"; DestDir: "{app}\bin"; Flags: ignoreversion

; Scripts de migração do banco de dados
Source: "{#MigrationSourceDir}\*.sql"; DestDir: "{app}\migrations"; Flags: ignoreversion recursesubdirs

[Dirs]
Name: "{app}\config"
Name: "{app}\logs"
Name: "{app}\run"
Name: "{app}\uploads"

[Icons]
Name: "{autoprograms}\ServiceDesk Server\Terminal de Controle e Logs"; Filename: "{app}\bin\servicedesk-ctl.cmd"; Parameters: "console"; WorkingDir: "{app}\bin"
Name: "{autoprograms}\ServiceDesk Server\Iniciar Servidores"; Filename: "{app}\bin\servicedesk-ctl.cmd"; Parameters: "start"; WorkingDir: "{app}\bin"
Name: "{autoprograms}\ServiceDesk Server\Parar Servidores"; Filename: "{app}\bin\servicedesk-ctl.cmd"; Parameters: "stop"; WorkingDir: "{app}\bin"
Name: "{autoprograms}\ServiceDesk Server\Status dos Servidores"; Filename: "{app}\bin\servicedesk-ctl.cmd"; Parameters: "status"; WorkingDir: "{app}\bin"

Name: "{autodesktop}\ServiceDesk Server Console"; Filename: "{app}\bin\servicedesk-ctl.cmd"; Parameters: "console"; WorkingDir: "{app}\bin"; Tasks: desktopicon

[Tasks]
Name: "desktopicon"; Description: "Criar atalho para o Terminal de Controle na Área de Trabalho"; GroupDescription: "Atalhos adicionais:"
Name: "runmigrations"; Description: "Executar migrations automaticamente no banco de dados após a instalação"; GroupDescription: "Banco de dados:"

[Run]
; Abre o terminal de controle ao concluir a instalação (opcional)
Filename: "{app}\bin\servicedesk-ctl.cmd"; Parameters: "console"; Description: "Abrir Terminal de Controle do Servidor agora"; Flags: postinstall nowait skipifsilent unchecked

[Code]
var
  DbConfigPage: TInputQueryWizardPage;
  PortConfigPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  // Página 1: Parâmetros de Conexão com o PostgreSQL
  DbConfigPage := CreateInputQueryPage(wpSelectTasks,
    'Configuração do Banco de Dados PostgreSQL',
    'Informe os dados de conexão com a instância local ou remota do PostgreSQL.',
    'Os serviços do Host necessitam de um banco de dados relacional para autenticação e telemetria:');

  DbConfigPage.Add('Host / Servidor do PostgreSQL:', False);
  DbConfigPage.Add('Porta:', False);
  DbConfigPage.Add('Nome do Banco de Dados:', False);
  DbConfigPage.Add('Usuário:', False);
  DbConfigPage.Add('Senha:', True); // Campo com máscara de senha

  DbConfigPage.Values[0] := ExpandConstant('{param:DBHOST|localhost}');
  DbConfigPage.Values[1] := ExpandConstant('{param:DBPORT|5432}');
  DbConfigPage.Values[2] := ExpandConstant('{param:DBNAME|servicedesk}');
  DbConfigPage.Values[3] := ExpandConstant('{param:DBUSER|postgres}');
  DbConfigPage.Values[4] := ExpandConstant('{param:DBPASSWORD|postgres}');

  // Página 2: Portas e Segurança da API
  PortConfigPage := CreateInputQueryPage(DbConfigPage.ID,
    'Configuração de Portas de Rede',
    'Defina as portas em que a API e o Servidor de Telemetria escutarão na rede.',
    'Certifique-se de que essas portas estejam liberadas no Firewall do Windows Server:');

  PortConfigPage.Add('Porta da API Principal (Rust):', False);
  PortConfigPage.Add('Porta HTTP/WS da Telemetria (Go):', False);
  PortConfigPage.Add('Porta gRPC da Telemetria (Go):', False);

  PortConfigPage.Values[0] := ExpandConstant('{param:APIPORT|8080}');
  PortConfigPage.Values[1] := ExpandConstant('{param:TELEMETRYPORT|8081}');
  PortConfigPage.Values[2] := ExpandConstant('{param:GRPCPORT|50051}');
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  DbHost, DbPort, DbName, DbUser, DbPass: String;
  ApiPort, TelemetryPort, GrpcPort: String;
  DbUrl: String;
  BackendEnvContent, GoEnvContent: String;
  ResultCode: Integer;
begin
  if CurStep = ssPostInstall then
  begin
    DbHost := Trim(DbConfigPage.Values[0]);
    DbPort := Trim(DbConfigPage.Values[1]);
    DbName := Trim(DbConfigPage.Values[2]);
    DbUser := Trim(DbConfigPage.Values[3]);
    DbPass := Trim(DbConfigPage.Values[4]);

    ApiPort       := Trim(PortConfigPage.Values[0]);
    TelemetryPort := Trim(PortConfigPage.Values[1]);
    GrpcPort      := Trim(PortConfigPage.Values[2]);

    if DbHost = '' then DbHost := 'localhost';
    if DbPort = '' then DbPort := '5432';
    if DbName = '' then DbName := 'servicedesk';
    if DbUser = '' then DbUser := 'postgres';
    if ApiPort = '' then ApiPort := '8080';
    if TelemetryPort = '' then TelemetryPort := '8081';
    if GrpcPort = '' then GrpcPort := '50051';

    DbUrl := 'postgres://' + DbUser + ':' + DbPass + '@' + DbHost + ':' + DbPort + '/' + DbName + '?sslmode=disable';

    // Cria arquivo backend/.env em {app}\bin\.env e {app}\config\backend.env
    BackendEnvContent := 'PORT=' + ApiPort + #13#10 +
                         'DATABASE_URL=' + DbUrl + #13#10 +
                         'JWT_SECRET=7b6d05c497fdcc72ed0ddf4796568e50379b8e7fe64ddaebb8dfb26f184eb850' + #13#10 +
                         'ACCESS_TOKEN_TTL_MIN=480' + #13#10 +
                         'ALLOWED_ORIGIN=*' + #13#10;

    SaveStringToFile(ExpandConstant('{app}\bin\.env'), BackendEnvContent, False);
    SaveStringToFile(ExpandConstant('{app}\config\backend.env'), BackendEnvContent, False);

    // Cria arquivo server-go/.env em {app}\bin\server-go.env e {app}\config\server-go.env
    GoEnvContent := 'HTTP_PORT=' + TelemetryPort + #13#10 +
                    'GRPC_PORT=' + GrpcPort + #13#10 +
                    'DATABASE_URL=' + DbUrl + #13#10 +
                    'API_BASE_URL=http://127.0.0.1:' + ApiPort + #13#10 +
                    'HEARTBEAT_TIMEOUT_SECS=12' + #13#10 +
                    'ALLOWED_ORIGIN=*' + #13#10;

    SaveStringToFile(ExpandConstant('{app}\config\server-go.env'), GoEnvContent, False);

    // Se a tarefa de rodar migrations foi marcada, executa via servicedesk-ctl
    if WizardIsTaskSelected('runmigrations') then
    begin
      Exec(ExpandConstant('{cmd}'), '/C powershell.exe -ExecutionPolicy Bypass -File "' + ExpandConstant('{app}\bin\servicedesk-ctl.ps1') + '" migrate', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    end;
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ResultCode: Integer;
begin
  if CurUninstallStep = usUninstall then
  begin
    // Encerra imediatamente instâncias em execução
    Exec('taskkill.exe', '/F /IM servicedesk-api.exe /T', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
    Exec('taskkill.exe', '/F /IM server-go.exe /T', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  end;
end;
