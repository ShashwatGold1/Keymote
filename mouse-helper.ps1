
param(
    [Parameter(Mandatory=$true)]
    [string]$Action,
    
    [Parameter(Mandatory=$false)]
    [int]$X = 0,
    
    [Parameter(Mandatory=$false)]
    [int]$Y = 0,
    
    [Parameter(Mandatory=$false)]
    [int]$Clicks = 1
)

Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

public class MouseSim {
    [DllImport("user32.dll")]
    private static extern bool SetCursorPos(int X, int Y);
    
    [DllImport("user32.dll")]
    private static extern bool GetCursorPos(out POINT lpPoint);
    
    [DllImport("user32.dll")]
    private static extern void mouse_event(uint dwFlags, int dx, int dy, int dwData, UIntPtr dwExtraInfo);
    
    [StructLayout(LayoutKind.Sequential)]
    public struct POINT {
        public int X;
        public int Y;
    }
    
    private const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
    private const uint MOUSEEVENTF_LEFTUP = 0x0004;
    private const uint MOUSEEVENTF_RIGHTDOWN = 0x0008;
    private const uint MOUSEEVENTF_RIGHTUP = 0x0010;
    private const uint MOUSEEVENTF_MIDDLEDOWN = 0x0020;
    private const uint MOUSEEVENTF_MIDDLEUP = 0x0040;
    private const uint MOUSEEVENTF_WHEEL = 0x0800;
    
    public static void MoveTo(int x, int y) {
        SetCursorPos(x, y);
    }
    
    public static void MoveBy(int dx, int dy) {
        POINT pt;
        GetCursorPos(out pt);
        SetCursorPos(pt.X + dx, pt.Y + dy);
    }
    
    public static void LeftClick() {
        mouse_event(MOUSEEVENTF_LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(10);
        mouse_event(MOUSEEVENTF_LEFTUP, 0, 0, 0, UIntPtr.Zero);
    }
    
    public static void RightClick() {
        mouse_event(MOUSEEVENTF_RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(10);
        mouse_event(MOUSEEVENTF_RIGHTUP, 0, 0, 0, UIntPtr.Zero);
    }
    
    public static void MiddleClick() {
        mouse_event(MOUSEEVENTF_MIDDLEDOWN, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(10);
        mouse_event(MOUSEEVENTF_MIDDLEUP, 0, 0, 0, UIntPtr.Zero);
    }
    
    public static void Scroll(int delta) {
        mouse_event(MOUSEEVENTF_WHEEL, 0, 0, delta, UIntPtr.Zero);
    }
    
    public static POINT GetPos() {
        POINT pt;
        GetCursorPos(out pt);
        return pt;
    }
}
"@ -Language CSharp

switch ($Action) {
    "move" {
        [MouseSim]::MoveBy($X, $Y)
        Write-Output "OK"
    }
    "moveto" {
        [MouseSim]::MoveTo($X, $Y)
        Write-Output "OK"
    }
    "left" {
        for ($i = 0; $i -lt $Clicks; $i++) {
            [MouseSim]::LeftClick()
            Start-Sleep -Milliseconds 50
        }
        Write-Output "OK"
    }
    "right" {
        [MouseSim]::RightClick()
        Write-Output "OK"
    }
    "middle" {
        [MouseSim]::MiddleClick()
        Write-Output "OK"
    }
    "scroll" {
        [MouseSim]::Scroll($Y)
        Write-Output "OK"
    }
}
