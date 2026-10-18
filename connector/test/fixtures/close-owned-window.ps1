param(
  [Parameter(Mandatory=$true)][int]$OwnedProcessId,
  [Parameter(Mandatory=$true)][string]$ExpectedTitle
)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class ConnectorQaWindow {
  public delegate bool EnumCallback(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr window, StringBuilder title, int maximum);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr window, uint message, IntPtr wParam, IntPtr lParam);
  public static int Close(uint ownedProcessId, string expectedTitle) {
    int closed = 0;
    EnumWindows((window, parameter) => {
      uint processId;
      GetWindowThreadProcessId(window, out processId);
      if (processId == ownedProcessId) {
        var title = new StringBuilder(256);
        GetWindowText(window, title, 256);
        if (String.Equals(title.ToString(), expectedTitle, StringComparison.Ordinal) && PostMessage(window, 0x0010, IntPtr.Zero, IntPtr.Zero)) closed++;
      }
      return true;
    }, IntPtr.Zero);
    return closed;
  }
}
'@
$qaClosed = [ConnectorQaWindow]::Close([uint32]$OwnedProcessId, $ExpectedTitle)
if ($qaClosed -ne 1) { throw "Expected one owned connector window, found $qaClosed" }
