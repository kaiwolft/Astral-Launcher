; Instalador de Astral Launcher (Dionixu's Launcher para ASTRAL CHAIN)
; Se compila en GitHub Actions (.github/workflows/build.yml) con Inno Setup 6.
; Espera los archivos ya preparados en ..\build\stage:
;   stage\launcher\  (Electron + resources\app + ui)
;   stage\suyu\      (suyu-windows-x86_64.zip descomprimido)
;   stage\mods\      (parche de 60 FPS y correccion de cinematicas)
; NO incluye el juego, la actualizacion, claves ni firmware.

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#define AppName "Astral Chain PC"
#define Stage "..\build\stage"

[Setup]
AppId={{42FC031B-84EC-4E27-A7FC-69F38FFB5773}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Dionixu
AppPublisherURL=https://github.com/kaiwolft/astral-launcher
AppSupportURL=https://github.com/kaiwolft/astral-launcher/issues
; carpeta portatil: el launcher guarda su configuracion y el juego exportado junto a si mismo,
; por eso no se instala en "Archivos de programa" (sin permisos de escritura)
PrivilegesRequired=lowest
DefaultDirName={userpf}\Astral Chain PC
DisableProgramGroupPage=yes
DefaultGroupName={#AppName}
UninstallDisplayIcon={app}\launcher\AstralChain.exe
UninstallDisplayName={#AppName}
OutputDir=..\build\out
OutputBaseFilename=AstralLauncher-Setup-{#AppVersion}
SetupIconFile=..\launcher\ui\assets\icon.ico
WizardStyle=modern
WizardSizePercent=120
Compression=lzma2/ultra64
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
ShowLanguageDialog=yes
UsePreviousLanguage=no
DisableWelcomePage=no

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"; LicenseFile: "LEGAL_es.txt"; InfoBeforeFile: "ANTES_es.txt"
Name: "english"; MessagesFile: "compiler:Default.isl"; LicenseFile: "LEGAL_en.txt"; InfoBeforeFile: "ANTES_en.txt"

[CustomMessages]
spanish.WelcomeExtra=Este instalador NO incluye el juego. Necesitas tu propia copia original de ASTRAL CHAIN y su actualización 1.0.1, extraídas por ti mismo de tu consola.%n%nNo se acepta la piratería.
english.WelcomeExtra=This installer does NOT include the game. You need your own original copy of ASTRAL CHAIN and its 1.0.1 update, dumped by yourself from your console.%n%nPiracy is not accepted.
spanish.TaskDesktop=Crear un acceso directo en el escritorio
english.TaskDesktop=Create a desktop shortcut
spanish.TaskVc=Instalar Microsoft Visual C++ Redistributable (necesario para suyu; pide permiso de administrador)
english.TaskVc=Install Microsoft Visual C++ Redistributable (required by suyu; asks for administrator permission)
spanish.RunLauncher=Abrir el launcher (asistente de primera vez)
english.RunLauncher=Open the launcher (first-run wizard)
spanish.ProgFiles=Elegiste una carpeta dentro de "Archivos de programa". El launcher necesita escribir en su carpeta (configuración y juego exportado), así que puede fallar ahí.%n%n¿Usar esa carpeta de todos modos?
english.ProgFiles=You chose a folder inside "Program Files". The launcher needs to write to its own folder (settings and exported game), so it may fail there.%n%nUse that folder anyway?
spanish.LegalName=Aviso legal
english.LegalName=Legal notice

[Tasks]
Name: "desktop"; Description: "{cm:TaskDesktop}"
Name: "vcredist"; Description: "{cm:TaskVc}"

[Dirs]
; suyu en modo portatil (usa su carpeta user junto al exe)
Name: "{app}\suyu\user"
Name: "{app}\launcher\data\personal"

[Files]
Source: "{#Stage}\launcher\*"; DestDir: "{app}\launcher"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Stage}\suyu\*"; DestDir: "{app}\suyu"; Excludes: "export-build-kit\*,vc_redist.x64.exe"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#Stage}\suyu\vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall skipifsourcedoesntexist; Tasks: vcredist
Source: "{#Stage}\mods\*"; DestDir: "{app}\mods"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "LEGAL_es.txt"; DestDir: "{app}\LEGAL"; DestName: "AVISO_LEGAL.txt"
Source: "LEGAL_en.txt"; DestDir: "{app}\LEGAL"; DestName: "LEGAL_NOTICE.txt"
Source: "..\LICENSE"; DestDir: "{app}\LEGAL"; DestName: "LICENSE_launcher_MIT.txt"
Source: "..\CREDITS.md"; DestDir: "{app}\LEGAL"; DestName: "CREDITOS_CREDITS.md"
; Steam: AGREGAR_A_STEAM.bat en la carpeta del juego (agrega el juego a Steam con su arte)
Source: "..\steam\AGREGAR_A_STEAM.bat"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\steam\AGREGAR_A_STEAM.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\steam\LEEME - README.txt"; DestDir: "{app}"; DestName: "AGREGAR_A_STEAM - LEEME.txt"; Flags: ignoreversion
Source: "..\steam\arte\*"; DestDir: "{app}\steam"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\launcher\AstralChain.exe"; WorkingDir: "{app}\launcher"
Name: "{autoprograms}\{#AppName} - {cm:LegalName}"; Filename: "{app}\LEGAL"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\launcher\AstralChain.exe"; WorkingDir: "{app}\launcher"; Tasks: desktop

[Run]
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /quiet /norestart"; StatusMsg: "Visual C++ Redistributable..."; Flags: waituntilterminated skipifdoesntexist; Tasks: vcredist
Filename: "{app}\launcher\AstralChain.exe"; Description: "{cm:RunLauncher}"; WorkingDir: "{app}\launcher"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; solo lo que crea el launcher; el juego exportado se borra a mano (son tus archivos)
Type: filesandordirs; Name: "{app}\launcher\data\chromium"
Type: files; Name: "{app}\launcher\data\launcher.log"

[Code]
procedure InitializeWizard;
begin
  WizardForm.WelcomeLabel2.Caption := WizardForm.WelcomeLabel2.Caption + #13#10#13#10 + CustomMessage('WelcomeExtra');
end;

function NextButtonClick(CurPageID: Integer): Boolean;
var d: String;
begin
  Result := True;
  if CurPageID = wpSelectDir then begin
    d := Lowercase(AddBackslash(WizardDirValue));
    if (Pos(Lowercase(AddBackslash(ExpandConstant('{commonpf64}'))), d) = 1) or (Pos(Lowercase(AddBackslash(ExpandConstant('{commonpf32}'))), d) = 1) then
      Result := MsgBox(CustomMessage('ProgFiles'), mbConfirmation, MB_YESNO) = IDYES;
  end;
end;
