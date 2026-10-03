using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Win32;
using Microsoft.Web.WebView2.Core;

namespace GrindZone.Desktop
{
    // Local, top-document-only folder selection. Web content never supplies an OS path.
    internal sealed class CaptureFolderPicker : IDisposable
    {
        private const string Request = "grindzone-capture-folder:select";
        private readonly CoreWebView2 core;
        private readonly CoreWebView2Environment environment;
        private readonly Form owner;
        private readonly string root;
        private readonly Func<bool> opened;
        private bool busy, disposed;
        private long navigationGeneration;
        private string lastFolder;

        internal CaptureFolderPicker(CoreWebView2 core, CoreWebView2Environment environment, Form owner, Uri localRoot, Func<bool> opened)
        {
            this.core = core; this.environment = environment; this.owner = owner;
            root = localRoot.AbsoluteUri; this.opened = opened;
        }

        internal async Task InitializeAsync()
        {
            core.WebMessageReceived += Receive;
            core.NavigationStarting += NavigationStarting;
            // localRoot is constrained by the launch contract to http://127.0.0.1:<port>/.
            await core.AddScriptToExecuteOnDocumentCreatedAsync(@"
(() => {
  if (window !== top || location.href !== '" + root + @"') return;
  let pending = null;
  chrome.webview.addEventListener('message', event => {
    if (!pending || !['grindzone-capture-folder:selected','grindzone-capture-folder:cancelled','grindzone-capture-folder:error'].includes(event.data)) return;
    const request = pending; pending = null;
    if (event.data === 'grindzone-capture-folder:selected') {
      const directory = event.additionalObjects?.[0];
      if (directory?.kind === 'directory') request.resolve(directory);
      else request.reject(new DOMException('The folder could not be connected.','NotSupportedError'));
    } else request.reject(new DOMException('Folder selection did not complete.',event.data.endsWith(':cancelled') ? 'AbortError' : 'NotSupportedError'));
  });
  globalThis.grindZoneCaptureFolderPicker = options => {
    if (options?.id !== 'grindzone-captures' || options?.mode !== 'read' || !navigator.userActivation.isActive || pending)
      return Promise.reject(new DOMException('Choose a capture folder using its button.','SecurityError'));
    return new Promise((resolve,reject) => {
      pending = {resolve,reject};
      chrome.webview.postMessage('grindzone-capture-folder:select');
    });
  };
})();");
        }

        private bool CanReply()
        {
            return !disposed && !owner.IsDisposed && !owner.Disposing && opened() && string.Equals(core.Source, root, StringComparison.Ordinal);
        }

        private void NavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs navigation)
        {
            navigationGeneration++;
        }

        private void Reply(long generation, string status, CoreWebView2FileSystemHandle handle = null)
        {
            if (generation != navigationGeneration || !CanReply()) return;
            if (handle == null) core.PostWebMessageAsJson("\"grindzone-capture-folder:" + status + "\"");
            else core.PostWebMessageAsJson("\"grindzone-capture-folder:" + status + "\"", new List<object> { handle });
        }

        private async void Receive(object sender, CoreWebView2WebMessageReceivedEventArgs message)
        {
            if (disposed || busy || !CanReply() || !string.Equals(message.Source, root, StringComparison.Ordinal)) return;
            string request;
            try { request = message.TryGetWebMessageAsString(); } catch (ArgumentException) { return; } catch (InvalidOperationException) { return; }
            if (request != Request) return;
            busy = true;
            var generation = navigationGeneration;
            try
            {
                // Check the current top document in the host too; raw postMessage cannot skip the gesture check.
                var active = await core.CallDevToolsProtocolMethodAsync("Runtime.evaluate",
                    "{\"expression\":\"window === top && navigator.userActivation.isActive\",\"userGesture\":false,\"returnByValue\":true}");
                if (generation != navigationGeneration || !CanReply() || !string.Equals(message.Source, root, StringComparison.Ordinal)) return;
                // Accept only the exact successful boolean result; protocol errors fail closed.
                if (!Regex.IsMatch(active, @"^\s*\{\s*""result""\s*:\s*\{\s*""type""\s*:\s*""boolean""\s*,\s*""value""\s*:\s*true\s*\}\s*\}\s*$"))
                { Reply(generation, "error"); return; }
                using (var picker = new FolderBrowserDialog())
                {
                    picker.Description = "Choose your game capture folder. Screenshots are read on this device.";
                    picker.ShowNewFolderButton = false;
                    picker.SelectedPath = ExistingCaptureFolder(lastFolder);
                    if (picker.ShowDialog(owner) != DialogResult.OK) { Reply(generation, "cancelled"); return; }
                    if (generation != navigationGeneration || !CanReply()) return;
                    var selected = Path.GetFullPath(picker.SelectedPath);
                    if (!Directory.Exists(selected) || new Uri(selected).IsUnc) { Reply(generation, "error"); return; }
                    // Only explicit native confirmation creates this read-only web handle.
                    var directory = environment.CreateWebFileSystemDirectoryHandle(selected, CoreWebView2FileSystemHandlePermission.ReadOnly);
                    lastFolder = selected;
                    Reply(generation, "selected", directory);
                }
            }
            catch (Exception) { Reply(generation, "error"); }
            finally { busy = false; }
        }

        private static string ExistingCaptureFolder(string previous)
        {
            if (!string.IsNullOrEmpty(previous) && Directory.Exists(previous)) return previous;
            try
            {
                var steam = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam", "SteamPath", null) as string;
                var active = Registry.GetValue(@"HKEY_CURRENT_USER\Software\Valve\Steam\ActiveProcess", "ActiveUser", null);
                var account = active == null ? 0 : Convert.ToUInt32(active, CultureInfo.InvariantCulture);
                if (!string.IsNullOrEmpty(steam) && account != 0)
                {
                    var capture = Path.Combine(steam, "userdata", account.ToString(CultureInfo.InvariantCulture), "760", "remote", "518790", "screenshots");
                    if (Directory.Exists(capture)) return capture;
                }
            }
            catch (Exception) { /* An unavailable Steam registry leaves manual folder selection usable. */ }
            var captures = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos), "Captures");
            return Directory.Exists(captures) ? captures : Environment.GetFolderPath(Environment.SpecialFolder.MyPictures);
        }

        public void Dispose()
        {
            if (disposed) return;
            disposed = true;
            core.WebMessageReceived -= Receive;
            core.NavigationStarting -= NavigationStarting;
        }
    }
}
