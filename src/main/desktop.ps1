# What is open on the desktop, for "which apps do I have open?": one shot, one json line.
# Process name and window title of every visible top-level window (front first). Titles can say a lot
# (document names, mail subjects), which is why this only runs when you ask about your PC.
#
#   powershell -File desktop.ps1 <capri pid> [max windows]

param([int]$SelfPid = 0, [int]$Max = 40)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)

Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

public static class CapriDesktop {
  delegate bool EnumProc(IntPtr hwnd, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lParam);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr hwnd, int index);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int max);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr hwnd, StringBuilder name, int max);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr hwnd, int attr, out int value, int size);

  const int GWL_EXSTYLE = -20, WS_EX_TOOLWINDOW = 0x80, DWMWA_CLOAKED = 14;

  public static List<string[]> List(int selfPid, int max) {
    var found = new List<string[]>();
    IntPtr fg = GetForegroundWindow();
    EnumWindows((h, l) => {
      if (found.Count >= max) return false;
      if (!IsWindowVisible(h)) return true;
      if ((GetWindowLong(h, GWL_EXSTYLE) & WS_EX_TOOLWINDOW) != 0) return true;
      int cloaked;
      if (DwmGetWindowAttribute(h, DWMWA_CLOAKED, out cloaked, 4) == 0 && cloaked != 0) return true; // hidden UWP shells
      var cls = new StringBuilder(64); GetClassName(h, cls, 64);
      string c = cls.ToString();
      if (c == "Progman" || c == "WorkerW" || c == "Shell_TrayWnd" || c == "Shell_SecondaryTrayWnd") return true;
      var title = new StringBuilder(256); GetWindowText(h, title, 256);
      if (title.Length == 0) return true;
      uint pid; GetWindowThreadProcessId(h, out pid);
      if (selfPid != 0 && pid == (uint)selfPid) return true; // Capri herself
      found.Add(new[] { pid.ToString(), title.ToString(), h == fg ? "1" : "0", IsIconic(h) ? "1" : "0" });
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
"@

$names = @{}
Get-Process | ForEach-Object { $names[[string]$_.Id] = $_.ProcessName }
$windows = foreach ($w in [CapriDesktop]::List($SelfPid, $Max)) {
  [pscustomobject]@{
    process = $(if ($names.ContainsKey($w[0])) { $names[$w[0]] } else { '' })
    title = $w[1]
    fg = ($w[2] -eq '1')
    min = ($w[3] -eq '1')
  }
}
[Console]::Out.WriteLine((@{ ok = $true; windows = @($windows) } | ConvertTo-Json -Compress -Depth 3))
