# Capturas del instalador (pagina del aviso legal) en espanol e ingles. Se usa en GitHub Actions.
# Uso: installer_shots.ps1 -Setup <ruta del setup.exe> -Out <carpeta>
param([Parameter(Mandatory)] [string]$Setup, [Parameter(Mandatory)] [string]$Out)
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force $Out | Out-Null
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices;
public static class W {
  [StructLayout(LayoutKind.Sequential)] public struct R { public int L, T, Rt, B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out R r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint f);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
"@
[W]::SetProcessDPIAware() | Out-Null
$ws = New-Object -ComObject WScript.Shell

function Shot($h, $file) {
  $r = New-Object W+R; [W]::GetWindowRect($h, [ref]$r) | Out-Null
  $w = $r.Rt - $r.L; $hh = $r.B - $r.T
  $bmp = New-Object System.Drawing.Bitmap $w, $hh
  $g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
  [W]::PrintWindow($h, $dc, 2) | Out-Null   # PW_RENDERFULLCONTENT
  $g.ReleaseHdc($dc); $g.Dispose(); $bmp.Save($file, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
  Write-Host "ok $file ($w x $hh)"
}

foreach ($l in @(@('spanish', '01_installer_legal_es.png'), @('english', '02_installer_legal_en.png'))) {
  $p = Start-Process -FilePath $Setup -ArgumentList "/LANG=$($l[0])" -PassThru
  $win = $null
  for ($i = 0; $i -lt 60 -and -not $win; $i++) {
    Start-Sleep -Milliseconds 500
    $win = Get-Process | Where-Object { $_.ProcessName -like '*Setup*' -and $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } | Select-Object -First 1
  }
  if (-not $win) { throw 'no aparecio la ventana del instalador' }
  [W]::SetForegroundWindow($win.MainWindowHandle) | Out-Null
  Start-Sleep -Milliseconds 800
  $ws.AppActivate($win.Id) | Out-Null
  $ws.SendKeys('{ENTER}')            # bienvenida -> aviso legal
  Start-Sleep -Milliseconds 1200
  $win.Refresh()
  Shot $win.MainWindowHandle (Join-Path $Out $l[1])
  Get-Process | Where-Object { $_.ProcessName -like '*Setup*' } | Stop-Process -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 1
}
