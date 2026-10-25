; Taqseem Windows installer (Inno Setup 6). Built by scripts/windows/package.ps1, which passes
; /DAppVersion=... /DDist=<folder with the packaged app> /DOutDir=<where TaqseemSetup.exe goes>.
;
; The wizard asks what setup-windows.bat asked: on a new computer, demo data or your business;
; where Taqseem is already installed, update and keep the data, or start fresh (type DELETE).
; The work after copying the files is done by setup\install.ps1. ASCII only.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
AppId={{6B0C3E9A-6F1B-4A3C-9F2B-7A6E1D2C4B58}
AppName=Taqseem
AppVersion={#AppVersion}
AppVerName=Taqseem {#AppVersion}
AppPublisher=Taqseem
DefaultDirName={autopf}\Taqseem
DisableProgramGroupPage=yes
OutputDir={#OutDir}
OutputBaseFilename=TaqseemSetup-{#AppVersion}
Compression=lzma2/max
SolidCompression=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
UninstallDisplayName=Taqseem
UninstallDisplayIcon={app}\node\node.exe
CloseApplications=no
SetupLogging=yes

[Files]
Source: "{#Dist}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
; A Start-menu folder: open the website, and stop / start it (setup\control.ps1 asks for
; administrator permission itself). PowerShell runs without a window.
Name: "{autoprograms}\Taqseem\Taqseem"; Filename: "{app}\Taqseem.url"
Name: "{autoprograms}\Taqseem\Stop Taqseem"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\setup\control.ps1"" -Action stop"; IconFilename: "{sys}\shell32.dll"; IconIndex: 27; Comment: "Stop the Taqseem website and database (until started again)"
Name: "{autoprograms}\Taqseem\Start Taqseem"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\setup\control.ps1"" -Action start"; IconFilename: "{sys}\shell32.dll"; IconIndex: 137; Comment: "Start the Taqseem website and database, and open it"
Name: "{autodesktop}\Taqseem"; Filename: "{app}\Taqseem.url"; Tasks: desktopicon

[InstallDelete]
; Older versions put a single Taqseem icon straight in the Start menu.
Type: files; Name: "{autoprograms}\Taqseem.lnk"

[Tasks]
Name: "desktopicon"; Description: "Put a Taqseem icon on the desktop"

[Run]
Filename: "{app}\Taqseem.url"; Description: "Open Taqseem now"; Flags: postinstall shellexec nowait skipifsilent; Check: SetupSucceeded

[UninstallDelete]
Type: files; Name: "{app}\Taqseem.url"

[Code]
var
  UpdatePage: TInputOptionWizardPage;
  ConfirmPage: TInputQueryWizardPage;
  ContentsPage: TInputOptionWizardPage;
  BusinessPage: TInputQueryWizardPage;
  Succeeded: Boolean;
  DeleteDataOnUninstall: Boolean;

function DataDir(): String;
begin
  Result := ExpandConstant('{commonappdata}\Taqseem');
end;

function HasData(): Boolean;
begin
  Result := FileExists(DataDir() + '\db\PG_VERSION');
end;

function StartFresh(): Boolean;
begin
  Result := HasData() and (UpdatePage.SelectedValueIndex = 1);
end;

function NeedsContents(): Boolean;
begin
  Result := (not HasData()) or StartFresh();
end;

function SetupSucceeded(): Boolean;
begin
  Result := Succeeded;
end;

procedure InitializeWizard();
begin
  UpdatePage := CreateInputOptionPage(wpSelectDir,
    'Taqseem is already installed', 'What should happen to the data on this computer?',
    'Your orders, bills, payments, stock and customers are kept in a separate data folder.',
    True, False);
  UpdatePage.Add('Update Taqseem and keep all my data (recommended)');
  UpdatePage.Add('Start fresh: DELETE ALL DATA and begin with an empty database');
  UpdatePage.SelectedValueIndex := 0;

  ConfirmPage := CreateInputQueryPage(UpdatePage.ID,
    'Delete all data?', 'Everything in the database will be deleted for good. There is no undo.',
    'A backup is not made. Type DELETE (in capitals) to confirm, or go Back and choose Update.');
  ConfirmPage.Add('Type DELETE:', False);

  ContentsPage := CreateInputOptionPage(ConfirmPage.ID,
    'What should Taqseem contain?', 'Choose how to start.', '', True, False);
  ContentsPage.Add('Demo data, to try it out (sample companies, products and customers)');
  ContentsPage.Add('My business (empty; you enter your own data)');
  ContentsPage.SelectedValueIndex := 0;

  BusinessPage := CreateInputQueryPage(ContentsPage.ID,
    'Your business', 'The owner signs in with this email.',
    'A one-time password is shown at the end; the owner chooses a new one at first sign-in.');
  BusinessPage.Add('Business name:', False);
  BusinessPage.Add('Owner''s full name:', False);
  BusinessPage.Add('Owner''s email:', False);
end;

function ShouldSkipPage(PageID: Integer): Boolean;
begin
  Result := False;
  if PageID = UpdatePage.ID then Result := not HasData()
  else if PageID = ConfirmPage.ID then Result := not StartFresh()
  else if PageID = ContentsPage.ID then Result := not NeedsContents()
  else if PageID = BusinessPage.ID then Result := (not NeedsContents()) or (ContentsPage.SelectedValueIndex <> 1);
end;

function ValidEmail(S: String): Boolean;
var
  At: Integer;
begin
  At := Pos('@', S);
  Result := (At > 1) and (Pos('.', Copy(S, At + 2, Length(S))) > 0) and (Pos(' ', S) = 0);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = ConfirmPage.ID) and (ConfirmPage.Values[0] <> 'DELETE') then
  begin
    MsgBox('Type DELETE in capitals to delete all data, or go Back and choose Update.', mbError, MB_OK);
    Result := False;
  end
  else if CurPageID = BusinessPage.ID then
  begin
    if (Length(Trim(BusinessPage.Values[0])) < 2) or (Length(Trim(BusinessPage.Values[1])) < 2) then
    begin
      MsgBox('Enter the business name and the owner''s name.', mbError, MB_OK);
      Result := False;
    end
    else if not ValidEmail(Trim(BusinessPage.Values[2])) then
    begin
      MsgBox('Enter a valid email for the owner.', mbError, MB_OK);
      Result := False;
    end;
  end;
end;

{ Quotes a value for the PowerShell command line (double quotes are not allowed inside). }
function Arg(S: String): String;
begin
  StringChangeEx(S, '"', '''', True);
  Result := '"' + Trim(S) + '"';
end;

function PowerShell(): String;
begin
  Result := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
end;

{ Before the program files are replaced, stop the running services (they hold the files open). }
function PrepareToInstall(var NeedsRestart: Boolean): String;
var
  Code: Integer;
  Script: String;
begin
  Result := '';
  Script := ExpandConstant('{app}\setup\remove.ps1');
  if FileExists(Script) then
    Exec(PowerShell(), '-NoProfile -ExecutionPolicy Bypass -File "' + Script + '" -StopOnly',
      '', SW_HIDE, ewWaitUntilTerminated, Code);
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Params, Login, Output, Tail: String;
  Lines: TArrayOfString;
  I, Code: Integer;
begin
  if CurStep <> ssPostInstall then Exit;
  if not NeedsContents() then
    Params := '-Mode update'
  else if ContentsPage.SelectedValueIndex = 0 then
    Params := '-Mode demo'
  else
    Params := '-Mode business -Business ' + Arg(BusinessPage.Values[0]) +
      ' -Owner ' + Arg(BusinessPage.Values[1]) + ' -Email ' + Arg(BusinessPage.Values[2]);
  if StartFresh() then Params := Params + ' -Fresh';

  WizardForm.StatusLabel.Caption := 'Setting up the database and starting Taqseem (a minute or two)...';
  { Everything the script prints (also errors from PowerShell itself, before the script's own log
    starts) goes to a file, shown when something fails and kept next to the log. }
  Output := DataDir() + '\logs\install-output.txt';
  ForceDirectories(DataDir() + '\logs');
  Exec(ExpandConstant('{cmd}'), '/c ""' + PowerShell() + '" -NoProfile -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\setup\install.ps1') + '" ' + Params + ' > "' + Output + '" 2>&1"',
    '', SW_HIDE, ewWaitUntilTerminated, Code);
  Succeeded := Code = 0;
  if not Succeeded then
  begin
    Tail := '';
    if LoadStringsFromFile(Output, Lines) then
      for I := GetArrayLength(Lines) - 12 to GetArrayLength(Lines) - 1 do
        if I >= 0 then Tail := Tail + Lines[I] + #13#10;
    MsgBox('Taqseem was copied but could not be set up (code ' + IntToStr(Code) + ').' + #13#10 + #13#10 +
      Tail + #13#10 +
      'The details are in ' + DataDir() + '\logs. ' +
      'Run TaqseemSetup again; it continues where it stopped.', mbError, MB_OK);
    Exit;
  end;
  if LoadStringsFromFile(DataDir() + '\first-login.txt', Lines) then
  begin
    Login := '';
    for I := 0 to GetArrayLength(Lines) - 1 do Login := Login + Lines[I] + #13#10;
    MsgBox(Login + #13#10 + '(Saved in ' + DataDir() + '\first-login.txt)', mbInformation, MB_OK);
  end;
end;

function InitializeUninstall(): Boolean;
begin
  DeleteDataOnUninstall := MsgBox('Also delete all Taqseem data on this computer?' + #13#10 + #13#10 +
    'Yes: the database, backups and settings are deleted for good.' + #13#10 +
    'No: they stay in ' + DataDir() + ' and are used again if Taqseem is installed later.',
    mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES;
  Result := True;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  Code: Integer;
  Params: String;
begin
  if CurUninstallStep <> usUninstall then Exit;
  Params := '';
  if DeleteDataOnUninstall then Params := ' -DeleteData';
  Exec(PowerShell(), '-NoProfile -ExecutionPolicy Bypass -File "' +
    ExpandConstant('{app}\setup\remove.ps1') + '"' + Params, '', SW_HIDE, ewWaitUntilTerminated, Code);
end;
