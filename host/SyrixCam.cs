// SYRIX Cam desktop host.
//
// A WinForms window around Microsoft Edge WebView2. The web app is served by
// this host from the local "app" folder under a private host name and is
// locked down:
//   * the only network destination is the SYRIX gateway, which the page
//     contacts when the user talks to Syrix; every other request that is not
//     for the bundled app is answered with 403;
//   * navigation away from the app and new windows are refused (links the
//     user chooses to open go to the default browser instead);
//   * the camera and microphone permissions are granted to the bundled app
//     only, and every other permission (location, notifications...) is denied;
//   * downloads are cancelled, so nothing can be written to disk;
//   * the browser profile runs InPrivate, so no browsing data is kept.
//
// The host also keeps the user's preferences and this device's SYRIX token.
// The token is encrypted with Windows DPAPI for the current user account.

using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

[assembly: AssemblyTitle("SYRIX Cam")]
[assembly: AssemblyDescription("Real-time camera effects, Syrix voice and vision assistant, health scan, face and hand tracking, and camera games.")]
[assembly: AssemblyCompany("SYRIX")]
[assembly: AssemblyProduct("SYRIX Cam")]
[assembly: AssemblyCopyright("Copyright (c) 2026 Kabirr Kohli")]
[assembly: AssemblyVersion("3.0.0.0")]
[assembly: AssemblyFileVersion("3.0.0.0")]

namespace Syrix.Cam
{
    internal static class Program
    {
        internal const string AppName = "SYRIX Cam";
        // The caption of the main window. A second launch finds the running
        // window by this exact text, so both must use this constant.
        internal const string WindowTitle = AppName + " — Made by Kabirr Kohli";
        internal const string Version = "3.0";

        [STAThread]
        private static void Main(string[] args)
        {
            bool created;
            using (var mutex = new Mutex(true, @"Local\Syrix.Cam.SingleInstance", out created))
            {
                if (!created)
                {
                    // The camera can only be opened by one window at a time, so a
                    // second launch brings the existing window forward instead.
                    NativeMethods.ActivateExisting(WindowTitle);
                    return;
                }

                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new MainWindow(ParseDebugPort(args)));
                GC.KeepAlive(mutex);
            }
        }

        // Development diagnostics only: exposes the page to a local debugger
        // when the app is started with --remote-debugging-port=<port>.
        private static int ParseDebugPort(string[] args)
        {
            const string prefix = "--remote-debugging-port=";
            foreach (var arg in args)
            {
                int port;
                if (arg.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)
                    && int.TryParse(arg.Substring(prefix.Length), out port)
                    && port > 1024 && port < 65536)
                {
                    return port;
                }
            }
            return 0;
        }
    }

    internal static class Store
    {
        private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("Syrix.Cam.Device.v1");

        internal static string Dir
        {
            get
            {
                string d = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "SYRIX Cam");
                Directory.CreateDirectory(d);
                return d;
            }
        }

        private static string SettingsPath { get { return Path.Combine(Dir, "settings.json"); } }
        private static string TokenPath { get { return Path.Combine(Dir, "syrix.device"); } }

        // Earlier builds stored a key file for a different assistant service.
        // Nothing reads it any more, so it is removed on start-up.
        internal static void RemoveLegacyFiles()
        {
            try
            {
                string legacy = Path.Combine(Dir, "assistant.key");
                if (File.Exists(legacy)) File.Delete(legacy);
            }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }

        internal static string LoadSettings()
        {
            try { return File.Exists(SettingsPath) ? File.ReadAllText(SettingsPath, Encoding.UTF8) : null; }
            catch (IOException) { return null; }
        }

        internal static void SaveSettings(string json)
        {
            if (json == null || json.Length > 256 * 1024) return;
            string tmp = SettingsPath + ".tmp";
            File.WriteAllText(tmp, json, Encoding.UTF8);
            if (File.Exists(SettingsPath)) File.Delete(SettingsPath);
            File.Move(tmp, SettingsPath);
        }

        internal static void ResetSettings()
        {
            if (File.Exists(SettingsPath)) File.Delete(SettingsPath);
        }

        internal static bool HasToken { get { return File.Exists(TokenPath); } }

        internal static void SaveToken(string token)
        {
            byte[] data = ProtectedData.Protect(Encoding.UTF8.GetBytes(token), Entropy, DataProtectionScope.CurrentUser);
            File.WriteAllBytes(TokenPath, data);
        }

        internal static string LoadToken()
        {
            if (!HasToken) return null;
            try
            {
                byte[] data = ProtectedData.Unprotect(File.ReadAllBytes(TokenPath), Entropy, DataProtectionScope.CurrentUser);
                return Encoding.UTF8.GetString(data);
            }
            catch (CryptographicException)
            {
                return null;
            }
        }

        internal static void ClearToken()
        {
            if (File.Exists(TokenPath)) File.Delete(TokenPath);
        }
    }

    internal sealed class MainWindow : Form
    {
        private const string AppHost = "app.syrixcam.example";
        private const string GatewayHost = "your-syrix-gateway.example.workers.dev";
        private static readonly string AppOrigin = "https://" + AppHost + "/";

        private readonly WebView2 view;
        private readonly int debugPort;
        private readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 4 * 1024 * 1024 };
        private CoreWebView2Environment environment;
        private string appDir;
        private bool fullscreen;
        private bool minimized;
        private bool pip;
        private FormWindowState restoreState;
        private Rectangle restoreBounds;

        public MainWindow(int debugPort)
        {
            this.debugPort = debugPort;
            Text = Program.WindowTitle;
            BackColor = Color.FromArgb(5, 5, 6);
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            StartPosition = FormStartPosition.CenterScreen;

            var area = Screen.PrimaryScreen.WorkingArea;
            Size = new Size((int)(area.Width * 0.82), (int)(area.Height * 0.86));
            MinimumSize = new Size(360, 240);

            view = new WebView2();
            view.Dock = DockStyle.Fill;
            view.DefaultBackgroundColor = BackColor;
            Controls.Add(view);
        }

        protected override void OnHandleCreated(EventArgs e)
        {
            base.OnHandleCreated(e);
            NativeMethods.UseDarkTitleBar(Handle, BackColor);
        }

        protected override async void OnLoad(EventArgs e)
        {
            base.OnLoad(e);
            try
            {
                await InitializeWebViewAsync();
            }
            catch (WebView2RuntimeNotFoundException)
            {
                Fail("SYRIX Cam needs the Microsoft Edge WebView2 Runtime, which is not installed on this PC.\n\n" +
                     "Install it from Microsoft (search for \"WebView2 Runtime\") and start SYRIX Cam again.");
            }
            catch (Exception ex)
            {
                Fail("SYRIX Cam could not start.\n\n" + ex.Message);
            }
        }

        private void Fail(string message)
        {
            MessageBox.Show(this, message, Program.AppName, MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }

        private async Task InitializeWebViewAsync()
        {
            appDir = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app"));
            Store.RemoveLegacyFiles();
            if (!File.Exists(Path.Combine(appDir, "index.html")))
            {
                throw new FileNotFoundException("The app files are missing. Please reinstall SYRIX Cam.");
            }

            string dataDir = Path.Combine(Store.Dir, "WebView2");
            // Chromium pauses drawing for windows it believes are covered, and
            // its occlusion check misreads windows under on-screen overlays, so
            // the live picture froze while the window was in plain view. The
            // app stops the camera itself when the window is minimised, so
            // the check and background throttling are both switched off.
            string browserArgs = "--autoplay-policy=no-user-gesture-required"
                + " --disable-features=CalculateNativeWinOcclusion"
                + " --disable-background-timer-throttling --disable-renderer-backgrounding";
            if (debugPort > 0) browserArgs += " --remote-debugging-port=" + debugPort;

            var options = new CoreWebView2EnvironmentOptions(browserArgs);
            environment = await CoreWebView2Environment.CreateAsync(null, dataDir, options);

            var controllerOptions = environment.CreateCoreWebView2ControllerOptions();
            controllerOptions.IsInPrivateModeEnabled = true;
            await view.EnsureCoreWebView2Async(environment, controllerOptions);

            CoreWebView2 core = view.CoreWebView2;
            CoreWebView2Settings s = core.Settings;
            s.AreDevToolsEnabled = debugPort > 0;
            s.AreBrowserAcceleratorKeysEnabled = debugPort > 0;
            s.AreDefaultContextMenusEnabled = false;
            s.AreDefaultScriptDialogsEnabled = true;
            s.AreHostObjectsAllowed = false;
            s.IsStatusBarEnabled = false;
            s.IsZoomControlEnabled = false;
            s.IsPinchZoomEnabled = false;
            s.IsSwipeNavigationEnabled = false;
            s.IsPasswordAutosaveEnabled = false;
            s.IsGeneralAutofillEnabled = false;
            s.IsWebMessageEnabled = true;
            s.IsBuiltInErrorPageEnabled = true;

            core.PermissionRequested += OnPermissionRequested;
            core.NavigationStarting += OnNavigationStarting;
            core.NewWindowRequested += OnNewWindowRequested;
            core.DownloadStarting += OnDownloadStarting;
            core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += OnWebResourceRequested;
            core.ContainsFullScreenElementChanged += OnFullScreenChanged;
            core.WebMessageReceived += OnWebMessage;
            core.ProcessFailed += OnProcessFailed;

            core.Navigate(AppOrigin + "index.html");
        }

        private static bool IsAppUri(string uri)
        {
            Uri u;
            return Uri.TryCreate(uri, UriKind.Absolute, out u)
                && u.Scheme == Uri.UriSchemeHttps
                && string.Equals(u.Host, AppHost, StringComparison.OrdinalIgnoreCase);
        }

        private static bool IsGatewayUri(string uri)
        {
            Uri u;
            return Uri.TryCreate(uri, UriKind.Absolute, out u)
                && u.Scheme == Uri.UriSchemeHttps
                && string.Equals(u.Host, GatewayHost, StringComparison.OrdinalIgnoreCase);
        }

        private void OnPermissionRequested(object sender, CoreWebView2PermissionRequestedEventArgs e)
        {
            bool allow = IsAppUri(e.Uri)
                && (e.PermissionKind == CoreWebView2PermissionKind.Camera
                    || e.PermissionKind == CoreWebView2PermissionKind.Microphone);
            e.State = allow ? CoreWebView2PermissionState.Allow : CoreWebView2PermissionState.Deny;
        }

        private void OnNavigationStarting(object sender, CoreWebView2NavigationStartingEventArgs e)
        {
            if (!IsAppUri(e.Uri)) e.Cancel = true;
        }

        private void OnNewWindowRequested(object sender, CoreWebView2NewWindowRequestedEventArgs e)
        {
            e.Handled = true;
        }

        private void OnDownloadStarting(object sender, CoreWebView2DownloadStartingEventArgs e)
        {
            e.Cancel = true;
            e.Handled = true;
        }

        private void OnWebResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e)
        {
            string uri = e.Request.Uri;
            if (IsAppUri(uri))
            {
                ServeApp(e, uri);
                return;
            }
            if (IsGatewayUri(uri)) return;
            e.Response = environment.CreateWebResourceResponse(new MemoryStream(), 403, "Blocked", "Content-Type: text/plain");
        }

        // Every app file is answered here, from the local "app" folder, rather
        // than through a folder mapping: a mapped folder cannot add response
        // headers, and the COOP/COEP pair below is what makes the page
        // cross-origin isolated so the on-device voice and vision models can
        // run multi-threaded WebAssembly. File streams are read by WebView2 off
        // the UI thread, so large model files do not stall the window.
        private static readonly Dictionary<string, string> Types = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            { ".html", "text/html; charset=utf-8" }, { ".js", "text/javascript; charset=utf-8" },
            { ".mjs", "text/javascript; charset=utf-8" }, { ".css", "text/css; charset=utf-8" },
            { ".json", "application/json" }, { ".txt", "text/plain; charset=utf-8" },
            { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".svg", "image/svg+xml" },
            { ".ico", "image/x-icon" }, { ".wav", "audio/wav" }, { ".wasm", "application/wasm" },
        };

        private void ServeApp(CoreWebView2WebResourceRequestedEventArgs e, string uri)
        {
            string path = new Uri(uri).AbsolutePath;
            string rel = Uri.UnescapeDataString(path.TrimStart('/')).Replace('/', Path.DirectorySeparatorChar);
            if (rel.Length == 0) rel = "index.html";
            string file = Path.GetFullPath(Path.Combine(appDir, rel));
            if (!file.StartsWith(appDir + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !File.Exists(file))
            {
                e.Response = environment.CreateWebResourceResponse(new MemoryStream(), 404, "Not Found", "Content-Type: text/plain");
                return;
            }
            string type;
            if (!Types.TryGetValue(Path.GetExtension(file), out type)) type = "application/octet-stream";
            // Small files are read into memory so no handle stays open; large
            // model files are streamed with sharing that never blocks the file.
            var info = new FileInfo(file);
            Stream body = info.Length < 4 * 1024 * 1024
                ? (Stream)new MemoryStream(File.ReadAllBytes(file))
                : new FileStream(file, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 1 << 16);
            string headers = "Content-Type: " + type + "\r\n" +
                             "Content-Length: " + body.Length + "\r\n" +
                             "Cross-Origin-Opener-Policy: same-origin\r\n" +
                             "Cross-Origin-Embedder-Policy: require-corp\r\n" +
                             "Cross-Origin-Resource-Policy: same-origin\r\n" +
                             "X-Content-Type-Options: nosniff\r\n" +
                             "Cache-Control: no-cache";
            e.Response = environment.CreateWebResourceResponse(body, 200, "OK", headers);
        }

        private void OnProcessFailed(object sender, CoreWebView2ProcessFailedEventArgs e)
        {
            if (e.ProcessFailedKind == CoreWebView2ProcessFailedKind.BrowserProcessExited)
            {
                Fail("The display engine stopped unexpectedly. Please start SYRIX Cam again.");
            }
            else if (view.CoreWebView2 != null)
            {
                view.CoreWebView2.Reload();
            }
        }

        // ---------------------------------------------------------------- bridge

        private void Send(Dictionary<string, object> message)
        {
            if (view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsJson(json.Serialize(message));
        }

        private static Dictionary<string, object> Msg(string type)
        {
            var d = new Dictionary<string, object>();
            d["type"] = type;
            return d;
        }

        private static string Str(Dictionary<string, object> m, string key)
        {
            object v;
            return m.TryGetValue(key, out v) && v != null ? v.ToString() : null;
        }

        private void OnWebMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            if (!IsAppUri(e.Source)) return;
            Dictionary<string, object> m;
            try
            {
                m = json.DeserializeObject(e.WebMessageAsJson) as Dictionary<string, object>;
            }
            catch (ArgumentException)
            {
                return;
            }
            if (m == null) return;

            try
            {
                switch (Str(m, "type"))
                {
                    case "hello":
                    {
                        var r = Msg("host");
                        r["version"] = Program.Version;
                        r["paired"] = Store.HasToken;
                        r["settings"] = Store.LoadSettings();
                        Send(r);
                        break;
                    }
                    case "settings:save":
                        Store.SaveSettings(Str(m, "data"));
                        break;
                    case "settings:reset":
                        Store.ResetSettings();
                        break;
                    case "token:set":
                    {
                        string token = (Str(m, "token") ?? "").Trim();
                        if (token.Length > 0 && token.Length < 512) Store.SaveToken(token);
                        var r = Msg("token:state");
                        r["id"] = Str(m, "id");
                        r["paired"] = Store.HasToken;
                        Send(r);
                        break;
                    }
                    case "token:clear":
                    {
                        Store.ClearToken();
                        var r = Msg("token:state");
                        r["id"] = Str(m, "id");
                        r["paired"] = false;
                        Send(r);
                        break;
                    }
                    case "token:get":
                    {
                        var r = Msg("token:value");
                        r["id"] = Str(m, "id");
                        r["token"] = Store.LoadToken();
                        Send(r);
                        break;
                    }
                    case "open":
                        OpenExternal(Str(m, "url"));
                        break;
                    case "pip":
                        SetPictureInPicture(Str(m, "on") == "True");
                        break;
                }
            }
            catch (Exception ex)
            {
                var r = Msg("host:error");
                r["message"] = ex.Message;
                Send(r);
            }
        }

        // Links from chat answers (shops, sources) open in the default browser.
        private static void OpenExternal(string url)
        {
            Uri u;
            if (url == null || !Uri.TryCreate(url, UriKind.Absolute, out u)) return;
            if (u.Scheme != Uri.UriSchemeHttps && u.Scheme != Uri.UriSchemeHttp) return;
            Process.Start(new ProcessStartInfo(u.AbsoluteUri) { UseShellExecute = true });
        }

        // ---------------------------------------------------------------- window state

        protected override void OnResize(EventArgs e)
        {
            base.OnResize(e);
            bool isMinimized = WindowState == FormWindowState.Minimized;
            if (isMinimized != minimized)
            {
                minimized = isMinimized;
                // The page releases the camera while the window is minimised.
                var r = Msg("window");
                r["state"] = isMinimized ? "hidden" : "visible";
                Send(r);
            }
        }

        private void OnFullScreenChanged(object sender, object e)
        {
            SetFullscreen(view.CoreWebView2.ContainsFullScreenElement);
        }

        private void SetFullscreen(bool on)
        {
            if (on == fullscreen) return;
            if (on && pip) SetPictureInPicture(false);
            fullscreen = on;
            if (on)
            {
                restoreState = WindowState;
                if (WindowState == FormWindowState.Maximized) WindowState = FormWindowState.Normal;
                restoreBounds = Bounds;
                FormBorderStyle = FormBorderStyle.None;
                Bounds = Screen.FromControl(this).Bounds;
            }
            else
            {
                FormBorderStyle = FormBorderStyle.Sizable;
                Bounds = restoreBounds;
                WindowState = restoreState;
            }
        }

        // A small always-on-top window in the corner of the screen.
        private void SetPictureInPicture(bool on)
        {
            if (on == pip || fullscreen) return;
            pip = on;
            if (on)
            {
                restoreState = WindowState;
                if (WindowState != FormWindowState.Normal) WindowState = FormWindowState.Normal;
                restoreBounds = Bounds;
                var area = Screen.FromControl(this).WorkingArea;
                int w = Math.Max(420, area.Width / 4);
                int h = (int)(w * 0.6);
                TopMost = true;
                Bounds = new Rectangle(area.Right - w - 24, area.Bottom - h - 24, w, h);
            }
            else
            {
                TopMost = false;
                Bounds = restoreBounds;
                WindowState = restoreState;
            }
            var r = Msg("pip");
            r["on"] = on;
            Send(r);
        }
    }

    internal static class NativeMethods
    {
        private const int DWMWA_USE_IMMERSIVE_DARK_MODE = 20;
        private const int DWMWA_CAPTION_COLOR = 35;
        private const int SW_RESTORE = 9;

        [DllImport("dwmapi.dll")]
        private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern IntPtr FindWindow(string className, string windowName);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool IsIconic(IntPtr hwnd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool ShowWindow(IntPtr hwnd, int cmd);

        [DllImport("user32.dll")]
        [return: MarshalAs(UnmanagedType.Bool)]
        private static extern bool SetForegroundWindow(IntPtr hwnd);

        internal static void UseDarkTitleBar(IntPtr hwnd, Color caption)
        {
            try
            {
                int on = 1;
                DwmSetWindowAttribute(hwnd, DWMWA_USE_IMMERSIVE_DARK_MODE, ref on, sizeof(int));
                int bgr = caption.R | (caption.G << 8) | (caption.B << 16);
                DwmSetWindowAttribute(hwnd, DWMWA_CAPTION_COLOR, ref bgr, sizeof(int));
            }
            catch (DllNotFoundException)
            {
                // Older Windows builds keep the default title bar.
            }
        }

        internal static void ActivateExisting(string title)
        {
            IntPtr hwnd = FindWindow(null, title);
            if (hwnd == IntPtr.Zero) return;
            if (IsIconic(hwnd)) ShowWindow(hwnd, SW_RESTORE);
            SetForegroundWindow(hwnd);
        }
    }
}
