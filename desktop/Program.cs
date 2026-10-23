using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace GrindZone.Desktop;

internal static class Program
{
    [STAThread]
    private static int Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--version")
        {
            Console.WriteLine(typeof(Program).Assembly.GetName().Version);
            return 0;
        }

        if (!TryReadArguments(args, out var localUrl, out var profile, out var fingerprint, out var readyToken))
        {
            Console.Error.WriteLine("GrindZone could not verify its local desktop launch. Open the installed shortcut again.");
            return 2;
        }

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Application.Run(new GrindZoneWindow(localUrl!, profile!, fingerprint!, readyToken!));
        return 0;
    }

    private static bool TryReadArguments(string[] args, out Uri? localUrl, out string? profile, out string? fingerprint, out string? readyToken)
    {
        localUrl = null;
        profile = null;
        fingerprint = null;
        readyToken = null;
        if (args.Length != 8 || args[0] != "--url" || args[2] != "--profile" ||
            args[4] != "--fingerprint" || args[6] != "--ready-token") return false;
        if (!Uri.TryCreate(args[1], UriKind.Absolute, out var parsed) ||
            parsed.Scheme != Uri.UriSchemeHttp || parsed.Host != "127.0.0.1" ||
            parsed.Port < 1024 || parsed.Port > 65535 || parsed.AbsolutePath != "/" ||
            !string.IsNullOrEmpty(parsed.Query) || !string.IsNullOrEmpty(parsed.Fragment) ||
            !string.IsNullOrEmpty(parsed.UserInfo)) return false;
        if (!Path.IsPathRooted(args[3])) return false;
        if (!Regex.IsMatch(args[5], "^[a-f0-9]{64}$") || !Regex.IsMatch(args[7], "^[a-f0-9]{64}$")) return false;
        localUrl = parsed;
        profile = Path.GetFullPath(args[3]);
        fingerprint = args[5];
        readyToken = args[7];
        return true;
    }
}

internal sealed class GrindZoneWindow : Form
{
    private readonly Uri localUrl;
    private readonly string profile;
    private readonly string fingerprint;
    private readonly string readyToken;
    private readonly WebView2 view = new() { Dock = DockStyle.Fill };
    private readonly Label startup = new() { Dock = DockStyle.Fill, Text = "Starting GrindZone…", TextAlign = ContentAlignment.MiddleCenter, BackColor = Color.FromArgb(18, 28, 21), ForeColor = Color.White };
    private bool prepared;
    private bool opened;
    private CaptureFolderPicker? capturePicker;

    internal GrindZoneWindow(Uri localUrl, string profile, string fingerprint, string readyToken)
    {
        this.localUrl = localUrl;
        this.profile = profile;
        this.fingerprint = fingerprint;
        this.readyToken = readyToken;
        Text = "GrindZone";
        Width = 1280;
        Height = 850;
        MinimumSize = new Size(800, 560);
        StartPosition = FormStartPosition.CenterScreen;
        Controls.Add(view);
        Controls.Add(startup);
        startup.BringToFront();
        Shown += async (_, _) => await OpenAsync();
        _ = Task.Run(ReadOwnerCommands);
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            capturePicker?.Dispose();
            capturePicker = null;
        }
        base.Dispose(disposing);
    }

    private void ReadOwnerCommands()
    {
        string? command;
        while ((command = Console.ReadLine()) != null)
        {
            if (command == "open")
            {
                if (IsHandleCreated && !IsDisposed) BeginInvoke(new Action(OpenApp));
                continue;
            }
            if (command == "close")
            {
                if (IsHandleCreated && !IsDisposed) BeginInvoke(Close);
                return;
            }
        }
        if (IsHandleCreated && !IsDisposed) BeginInvoke(Close);
    }

    private async Task OpenAsync()
    {
        try
        {
            Directory.CreateDirectory(profile);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: profile);
            if (IsDisposed) return;
            await view.EnsureCoreWebView2Async(environment);
            if (IsDisposed) return;
            capturePicker = new CaptureFolderPicker(view.CoreWebView2, environment, this, localUrl, () => opened);
            await capturePicker.InitializeAsync();
            if (IsDisposed) return;
            view.CoreWebView2.NavigationStarting += (_, e) =>
            {
                if (IsLocalNavigation(e.Uri)) return;
                e.Cancel = true;
                OpenExternalLink(e.Uri);
            };
            view.CoreWebView2.NewWindowRequested += (_, e) =>
            {
                e.Handled = true;
                OpenExternalLink(e.Uri);
            };
            var navigation = new TaskCompletionSource<bool>(TaskCreationOptions.RunContinuationsAsynchronously);
            EventHandler<CoreWebView2NavigationCompletedEventArgs>? completed = null;
            completed = (_, e) =>
            {
                view.CoreWebView2.NavigationCompleted -= completed;
                navigation.TrySetResult(e.IsSuccess);
            };
            view.CoreWebView2.NavigationCompleted += completed;
            view.CoreWebView2.Navigate(new Uri(localUrl, "api/bootstrap").AbsoluteUri);
            if (!await navigation.Task || IsDisposed) throw new InvalidOperationException("The local app did not answer the desktop startup check.");
            var response = await view.CoreWebView2.ExecuteScriptAsync("document.body.innerText");
            if (IsDisposed) return;
            if (response.IndexOf(fingerprint, StringComparison.OrdinalIgnoreCase) < 0)
                throw new InvalidOperationException("The desktop window did not reach the selected signed app.");
            prepared = true;
            Console.Out.WriteLine("gz-desktop-ready:" + readyToken);
            Console.Out.Flush();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine("GrindZone desktop startup failed: " + error.Message);
            if (!IsDisposed) Close();
        }
    }

    private void OpenApp()
    {
        if (!prepared || opened || IsDisposed) return;
        opened = true;
        EventHandler<CoreWebView2NavigationCompletedEventArgs>? completed = null;
        completed = (_, e) =>
        {
            view.CoreWebView2.NavigationCompleted -= completed;
            if (e.IsSuccess) { startup.Visible = false; view.BringToFront(); }
            else startup.Text = "GrindZone could not load. Close this window and reopen the installed shortcut.";
        };
        view.CoreWebView2.NavigationCompleted += completed;
        view.CoreWebView2.Navigate(localUrl.AbsoluteUri);
    }

    private bool IsLocalNavigation(string address)
    {
        return Uri.TryCreate(address, UriKind.Absolute, out var target) &&
            target.Scheme == Uri.UriSchemeHttp && target.Host == "127.0.0.1" &&
            target.Port == localUrl.Port && string.IsNullOrEmpty(target.UserInfo);
    }

    private static void OpenExternalLink(string address)
    {
        if (!Uri.TryCreate(address, UriKind.Absolute, out var target) ||
            target.Scheme != Uri.UriSchemeHttps) return;
        try { Process.Start(new ProcessStartInfo(target.AbsoluteUri) { UseShellExecute = true }); }
        catch { /* The application remains usable when an external link cannot open. */ }
    }
}
