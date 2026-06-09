using System;
using System.IO;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using ClarionCsvEditor.Services;
using Microsoft.Web.WebView2.Core;

namespace ClarionCsvEditor
{
    /// <summary>
    /// Main user control for the CSV Editor addin.
    /// Hosts a WebView2 control that renders an editable grid (Tabulator) over a
    /// CSV file parsed with Papa Parse. The C# side owns the file on disk; the
    /// JavaScript side owns the grid.
    ///
    /// Communication over WebView2 messages:
    ///   C# -> JS : ExecuteScriptAsync("loadCsv(...)"), "setDarkMode(...)", "onFileSaved(...)"
    ///   JS -> C# (object) : { type: "ready" | "contentChanged" | "saveRequested" | "darkModeChanged" }
    ///   JS -> C# (string) : "CSV:" + csvText  — the current grid serialised as CSV.
    ///
    /// The CSV snapshot is pushed on load and after every change so the host
    /// always holds the latest content. That lets Save run synchronously (just
    /// write the cache), which is required because the IDE's File > Save calls
    /// ViewContent.Save(string) synchronously and blocking on WebView2's async
    /// ExecuteScriptAsync would deadlock the UI thread.
    /// </summary>
    public partial class CsvEditorControl : UserControl
    {
        private const string CsvSnapshotPrefix = "CSV:";

        private readonly SettingsService _settingsService;

        private bool _isWebViewReady;
        private bool _initializationStarted;
        private string _pendingFilePath;
        private string _tempHtmlPath;
        private string _currentFilePath;
        private string _latestCsv = "";
        private bool _isDarkMode;
        private bool _isDirty;

        /// <summary>Raised when the dirty state changes, so a hosting ViewContent can mirror it.</summary>
        public event EventHandler DirtyChanged;

        /// <summary>Raised when a save changes the backing file path (Save As), with the new path.</summary>
        public event Action<string> FileNameChanged;

        public bool IsDirty
        {
            get { return _isDirty; }
            private set
            {
                if (_isDirty != value)
                {
                    _isDirty = value;
                    DirtyChanged?.Invoke(this, EventArgs.Empty);
                }
            }
        }

        public string CurrentFilePath => _currentFilePath;

        public CsvEditorControl()
        {
            InitializeComponent();
            _settingsService = new SettingsService();

            webView.HandleCreated += WebView_HandleCreated;
            if (webView.IsHandleCreated)
            {
                _initializationStarted = true;
                this.BeginInvoke(new Action(() => InitializeWebView()));
            }
        }

        partial void OnCustomDispose()
        {
            if (!string.IsNullOrEmpty(_tempHtmlPath) && File.Exists(_tempHtmlPath))
            {
                try { File.Delete(_tempHtmlPath); }
                catch { /* ignore cleanup errors */ }
            }
        }

        private void WebView_HandleCreated(object sender, EventArgs e)
        {
            if (!_initializationStarted)
            {
                _initializationStarted = true;
                this.BeginInvoke(new Action(() => InitializeWebView()));
            }
        }

        private async void InitializeWebView()
        {
            if (_isWebViewReady) return;

            try
            {
                await webView.EnsureCoreWebView2Async(null);
                _isWebViewReady = true;

                webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
                webView.CoreWebView2.WebMessageReceived += CoreWebView2_WebMessageReceived;

                var resourcesPath = Path.Combine(GetAddinDir(), "Resources");
                webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                    "app.local",
                    resourcesPath,
                    CoreWebView2HostResourceAccessKind.Allow);

                var htmlPath = Path.Combine(resourcesPath, "csv-editor.html");
                if (!File.Exists(htmlPath))
                {
                    MessageBox.Show("csv-editor.html not found at:\n" + htmlPath,
                        "CSV Editor", MessageBoxButtons.OK, MessageBoxIcon.Error);
                    return;
                }

                var html = InjectScripts(File.ReadAllText(htmlPath), resourcesPath);
                _tempHtmlPath = Path.Combine(resourcesPath, "csv-editor-temp.html");
                File.WriteAllText(_tempHtmlPath, html);

                webView.CoreWebView2.NavigationCompleted += async (s, args) =>
                {
                    if (args.IsSuccess && _isWebViewReady)
                    {
                        await Task.Delay(100);
                        _isDarkMode = _settingsService.Get("DarkMode") == "true";
                        if (_isDarkMode)
                            await webView.ExecuteScriptAsync("setDarkMode(true)");

                        if (!string.IsNullOrEmpty(_pendingFilePath))
                        {
                            var path = _pendingFilePath;
                            _pendingFilePath = null;
                            OpenFile(path);
                        }
                    }
                };

                webView.CoreWebView2.Navigate("https://app.local/csv-editor-temp.html");
            }
            catch (Exception ex)
            {
                MessageBox.Show(
                    "Error initializing WebView2: " + ex.Message +
                    "\n\nPlease ensure the WebView2 Runtime is installed.",
                    "WebView2 Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private static string GetAddinDir()
        {
            return Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
        }

        /// <summary>
        /// Inlines the vendored Tabulator + Papa Parse assets into the HTML so the grid
        /// works fully offline (no CDN dependency), mirroring the markdown editor pattern.
        /// </summary>
        private string InjectScripts(string html, string resourcesPath)
        {
            try
            {
                var css = ReadIfExists(Path.Combine(resourcesPath, "tabulator.min.css"));
                if (css != null)
                    html = html.Replace("<!-- INJECT_TABULATOR_CSS -->", $"<style>\n{css}\n</style>");

                var tabulator = ReadIfExists(Path.Combine(resourcesPath, "tabulator.min.js"));
                if (tabulator != null)
                    html = html.Replace("<!-- INJECT_TABULATOR_JS -->", $"<script>\n{tabulator}\n</script>");

                var papa = ReadIfExists(Path.Combine(resourcesPath, "papaparse.min.js"));
                if (papa != null)
                    html = html.Replace("<!-- INJECT_PAPAPARSE_JS -->", $"<script>\n{papa}\n</script>");
            }
            catch { /* leave placeholders; page shows a load error */ }
            return html;
        }

        private static string ReadIfExists(string path)
        {
            return File.Exists(path) ? File.ReadAllText(path) : null;
        }

        #region Public API (used by the hosting ViewContent / Pad)

        /// <summary>Loads a CSV/TSV file into the grid. Defers if WebView2 is not ready yet.</summary>
        public void LoadFile(string filePath)
        {
            if (!_isWebViewReady)
            {
                _pendingFilePath = filePath;
                return;
            }
            OpenFile(filePath);
        }

        /// <summary>
        /// Writes the current grid content to <paramref name="path"/>. Synchronous, using
        /// the cached snapshot pushed from JS — safe to call from the IDE's File &gt; Save.
        /// Throws on I/O failure so the IDE's ObservedSave can report it.
        /// </summary>
        public void SaveToFile(string path)
        {
            File.WriteAllText(path, _latestCsv ?? "");

            bool pathChanged = !string.Equals(_currentFilePath, path, StringComparison.OrdinalIgnoreCase);
            _currentFilePath = path;
            _settingsService.Set("LastOpenFolder", Path.GetDirectoryName(path));
            IsDirty = false;
            InvokeScript("onFileSaved", Path.GetFileName(path));

            if (pathChanged)
                FileNameChanged?.Invoke(path);
        }

        /// <summary>
        /// Save initiated from inside the editor (toolbar button / Ctrl+S in the page).
        /// Writes to the current file, or prompts for a path when untitled.
        /// </summary>
        public void SaveInteractive()
        {
            if (string.IsNullOrEmpty(_currentFilePath))
            {
                SaveInteractiveAs();
                return;
            }
            try { SaveToFile(_currentFilePath); }
            catch (Exception ex)
            {
                MessageBox.Show("Could not save:\n" + ex.Message, "CSV Editor",
                    MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
        }

        private void SaveInteractiveAs()
        {
            using (var dialog = new SaveFileDialog())
            {
                dialog.Filter = "CSV files (*.csv)|*.csv|TSV files (*.tsv)|*.tsv|All files (*.*)|*.*";
                dialog.Title = "Save CSV File";
                dialog.DefaultExt = "csv";
                if (!string.IsNullOrEmpty(_currentFilePath))
                {
                    dialog.InitialDirectory = Path.GetDirectoryName(_currentFilePath);
                    dialog.FileName = Path.GetFileName(_currentFilePath);
                }

                if (dialog.ShowDialog() != DialogResult.OK) return;
                try { SaveToFile(dialog.FileName); }
                catch (Exception ex)
                {
                    MessageBox.Show("Could not save:\n" + ex.Message, "CSV Editor",
                        MessageBoxButtons.OK, MessageBoxIcon.Error);
                }
            }
        }

        #endregion

        #region File loading

        private void OpenFile(string filePath)
        {
            if (!File.Exists(filePath))
            {
                MessageBox.Show("File not found:\n" + filePath, "CSV Editor",
                    MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }

            _currentFilePath = filePath;
            _settingsService.Set("LastOpenFolder", Path.GetDirectoryName(filePath));

            string content = File.ReadAllText(filePath);
            string fileName = Path.GetFileName(filePath);
            string delimiter = filePath.EndsWith(".tsv", StringComparison.OrdinalIgnoreCase) ? "\t" : ",";

            InvokeScript("loadCsv", content, fileName, delimiter);
            IsDirty = false;
        }

        #endregion

        #region JavaScript communication

        private void CoreWebView2_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
            // CSV snapshots come through as a raw string (prefixed) to avoid
            // JSON-escaping a potentially large payload; control signals come
            // through as JSON objects.
            string asString = null;
            try { asString = e.TryGetWebMessageAsString(); }
            catch { /* not a string message — it's an object */ }

            if (asString != null && asString.StartsWith(CsvSnapshotPrefix, StringComparison.Ordinal))
            {
                _latestCsv = asString.Substring(CsvSnapshotPrefix.Length);
                return;
            }

            HandleWebMessage(e.WebMessageAsJson);
        }

        private void HandleWebMessage(string message)
        {
            try
            {
                var type = ExtractJsonValue(message, "type");
                switch (type)
                {
                    case "ready":
                        break;

                    case "contentChanged":
                        IsDirty = true;
                        break;

                    case "saveRequested":
                        SaveInteractive();
                        break;

                    case "darkModeChanged":
                        var isDark = ExtractJsonValue(message, "isDark");
                        _isDarkMode = string.Equals(isDark, "true", StringComparison.OrdinalIgnoreCase);
                        _settingsService.Set("DarkMode", _isDarkMode ? "true" : "false");
                        break;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[CsvEditor] HandleWebMessage error: " + ex.Message);
            }
        }

        private async void InvokeScript(string functionName, params string[] args)
        {
            if (!_isWebViewReady) return;
            try
            {
                var escaped = Array.ConvertAll(args, arg =>
                {
                    arg = (arg ?? "")
                        .Replace("\\", "\\\\")
                        .Replace("\"", "\\\"")
                        .Replace("\n", "\\n")
                        .Replace("\r", "\\r");
                    return $"\"{arg}\"";
                });
                await webView.ExecuteScriptAsync($"{functionName}({string.Join(",", escaped)})");
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[CsvEditor] InvokeScript error: " + ex.Message);
            }
        }

        #endregion

        #region JSON helpers

        /// <summary>
        /// Extracts a top-level string/bool value for <paramref name="key"/> from a small
        /// JSON object. Good enough for the flat { "type": ..., "isDark": ... } messages
        /// this control receives; not a general-purpose parser.
        /// </summary>
        private static string ExtractJsonValue(string json, string key)
        {
            if (string.IsNullOrEmpty(json)) return null;
            var token = "\"" + key + "\"";
            int k = json.IndexOf(token, StringComparison.Ordinal);
            if (k < 0) return null;
            int colon = json.IndexOf(':', k + token.Length);
            if (colon < 0) return null;

            int i = colon + 1;
            while (i < json.Length && char.IsWhiteSpace(json[i])) i++;
            if (i >= json.Length) return null;

            if (json[i] == '"')
            {
                int end = i + 1;
                var sb = new System.Text.StringBuilder();
                while (end < json.Length && json[end] != '"')
                {
                    if (json[end] == '\\' && end + 1 < json.Length)
                    {
                        end++;
                        switch (json[end])
                        {
                            case 'n': sb.Append('\n'); break;
                            case 'r': sb.Append('\r'); break;
                            case 't': sb.Append('\t'); break;
                            default: sb.Append(json[end]); break;
                        }
                    }
                    else sb.Append(json[end]);
                    end++;
                }
                return sb.ToString();
            }

            int valEnd = i;
            while (valEnd < json.Length && json[valEnd] != ',' && json[valEnd] != '}') valEnd++;
            return json.Substring(i, valEnd - i).Trim();
        }

        #endregion
    }
}
