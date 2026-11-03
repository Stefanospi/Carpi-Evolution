# Lists what is on a window so she can tell you where things are: UI Automation, one shot.
# Prints ONE json line: the window (title, process, bounds) and its controls (type, name, bounds).
# Physical pixels, like windows.ps1. Field contents are never read (only names), password fields are skipped.
#
#   powershell -File uia.ps1 <hwnd> [max elements] [time budget in ms]

param([long]$Hwnd, [int]$Max = 200, [int]$BudgetMs = 3500)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false) # names with accents reach Node intact

Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class CapriDpi {
  [DllImport("user32.dll")] static extern bool SetProcessDpiAwarenessContext(IntPtr value);
  public static void Init() { SetProcessDpiAwarenessContext(new IntPtr(-4)); } // per-monitor v2: real pixels
}
"@
[CapriDpi]::Init()

$AE = [System.Windows.Automation.AutomationElement]
$root = $AE::FromHandle([IntPtr]$Hwnd)

$cr = New-Object System.Windows.Automation.CacheRequest
foreach ($p in @($AE::NameProperty, $AE::ControlTypeProperty, $AE::BoundingRectangleProperty, $AE::IsOffscreenProperty,
                 $AE::IsEnabledProperty, $AE::AutomationIdProperty, $AE::IsPasswordProperty)) { $cr.Add($p) }
$cr.TreeScope = [System.Windows.Automation.TreeScope]::Element

$interactive = @('Button', 'SplitButton', 'CheckBox', 'RadioButton', 'ComboBox', 'Edit', 'Hyperlink', 'MenuItem',
                 'TabItem', 'ListItem', 'TreeItem', 'Slider', 'Spinner', 'DataItem', 'Image')
$skip = @('ScrollBar', 'Thumb', 'TitleBar', 'Pane', 'Group', 'Window', 'Custom', 'Separator', 'Header', 'List', 'Tree',
          'Table', 'Document', 'ToolBar', 'MenuBar', 'Menu', 'Tab', 'StatusBar', 'DataGrid', 'ToolTip', 'AppBar')

$weak = @('Pane', 'Group', 'Custom')
$walker = [System.Windows.Automation.TreeWalker]::ControlViewWalker
$deadline = [DateTime]::UtcNow.AddMilliseconds($BudgetMs)
$queue = New-Object System.Collections.Generic.Queue[object]
$queue.Enqueue($root)
$found = New-Object System.Collections.Generic.List[object]
$visited = 0
$truncated = $false

while ($queue.Count -gt 0) {
  if ([DateTime]::UtcNow -gt $deadline -or $visited -ge 2500) { $truncated = $true; break }
  $node = $queue.Dequeue()
  $child = $walker.GetFirstChild($node, $cr)
  while ($null -ne $child) {
    $visited++
    $c = $child.Cached
    $type = $c.ControlType.ProgrammaticName -replace '^ControlType\.', ''
    $name = [string]$c.Name
    $r = $c.BoundingRectangle
    $usable = (-not $c.IsOffscreen) -and (-not $c.IsPassword) -and (-not [double]::IsInfinity($r.Width)) -and $r.Width -gt 2 -and $r.Height -gt 2
    if ($usable) {
      $isInteractive = $interactive -contains $type
      $named = $name.Trim().Length -gt 0
      # old and custom apps show their buttons as small named panes; big named panes are just containers
      $smallWeak = ($weak -contains $type) -and $named -and $r.Width -le 500 -and $r.Height -le 150
      if ($isInteractive -or ($type -eq 'Text' -and $named) -or ($named -and $skip -notcontains $type) -or $smallWeak) {
        if ($name.Length -gt 80) { $name = $name.Substring(0, 80) + '…' }
        $found.Add([pscustomobject]@{
          t = $type; n = $name.Trim(); a = ([string]$c.AutomationId); e = [bool]$c.IsEnabled; p = [int]$isInteractive
          x = [int]$r.X; y = [int]$r.Y; w = [int]$r.Width; h = [int]$r.Height
        })
      }
    }
    if ($type -ne 'Edit') { $queue.Enqueue($child) } # no need to dive into a text box
    $child = $walker.GetNextSibling($child, $cr)
  }
}

# interactive controls first, then labels; keep their on-screen reading order (top to bottom, left to right)
$picked = @($found | Sort-Object @{ e = { -$_.p } }, y, x | Select-Object -First $Max | Sort-Object y, x)
$id = 0
$items = foreach ($f in $picked) {
  $id++
  [pscustomobject]@{ i = $id; t = $f.t; n = $f.n; a = $f.a; e = $f.e; x = $f.x; y = $f.y; w = $f.w; h = $f.h }
}

$rect = $root.Current.BoundingRectangle
$proc = try { (Get-Process -Id $root.Current.ProcessId).ProcessName } catch { '' }
[Console]::Out.WriteLine((@{
  ok = $true
  title = [string]$root.Current.Name
  process = $proc
  rect = @([int]$rect.X, [int]$rect.Y, [int]$rect.Width, [int]$rect.Height)
  visited = $visited
  truncated = $truncated
  elements = @($items)
} | ConvertTo-Json -Compress -Depth 4))
