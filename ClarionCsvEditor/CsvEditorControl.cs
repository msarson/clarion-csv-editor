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
    /// JavaScript side owns the grid. They talk over WebView2 web messages:
    ///   C# -> JS : ExecuteScriptAsync("loadCsv(...)"), "setDarkMode(...)"
    ///   JS -> C# : window.chrome.webview.postMessage({ type, ... })
    /// </summary>
    public partial class CsvEditorControl : UserControl
    {
        private readonly SettingsService _settingsService;

        private bool _isWebViewReady;
        private bool _initializationStarted;
        private string _pendingFilePath;
        private string _tempHtmlPath;
        private string _currentFilePath;
        private bool _isDarkMode;
        private bool _isDirty;

        /// <summary>Raised when the dirty state changes, so a hosting ViewContent can mirror it.</summary>
        public event EventHandler DirtyChanged;

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
                        menuDarkMode.Checked = _isDarkMode;
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

        #region Public API

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

        /// <summary>Pulls the current grid content and writes it back to the current file.</summary>
        public void SaveFile()
        {
            _ = SaveFileAsync();
        }

        #endregion

        #region File operations

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

        private void OpenFileDialogAndLoad()
        {
            using (var dialog = new OpenFileDialog())
            {
                dialog.Filter = "CSV files (*.csv)|*.csv|TSV files (*.tsv)|*.tsv|All files (*.*)|*.*";
                dialog.Title = "Open CSV File";

                var lastFolder = _settingsService.Get("LastOpenFolder");
                if (!string.IsNullOrEmpty(lastFolder) && Directory.Exists(lastFolder))
                    dialog.InitialDirectory = lastFolder;

                if (dialog.ShowDialog() == DialogResult.OK)
                    OpenFile(dialog.FileName);
            }
        }

        private async Task SaveFileAsync()
        {
            if (string.IsNullOrEmpty(_currentFilePath))
            {
                await SaveFileAsAsync();
                return;
            }

            string csv = await GetCsvFromGridAsync();
            if (csv == null) return;

            File.WriteAllText(_currentFilePath, csv);
            IsDirty = false;
            InvokeScript("onFileSaved", Path.GetFileName(_currentFilePath));
        }

        private async Task SaveFileAsAsync()
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

                string csv = await GetCsvFromGridAsync();
                if (csv == null) return;

                File.WriteAllText(dialog.FileName, csv);
                _currentFilePath = dialog.FileName;
                IsDirty = false;
                InvokeScript("onFileSaved", Path.GetFileName(dialog.FileName));
            }
        }

        #endregion

        #region JavaScript communication

        private void CoreWebView2_WebMessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e)
        {
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
                        _ = SaveFileAsync();
                        break;

                    case "darkModeChanged":
                        var isDark = ExtractJsonValue(message, "isDark");
                        _isDarkMode = string.Equals(isDark, "true", StringComparison.OrdinalIgnoreCase);
                        menuDarkMode.Checked = _isDarkMode;
                        _settingsService.Set("DarkMode", _isDarkMode ? "true" : "false");
                        break;
                }
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[CsvEditor] HandleWebMessage error: " + ex.Message);
            }
        }

        private async Task<string> GetCsvFromGridAsync()
        {
            if (!_isWebViewReady) return null;
            try
            {
                var result = await webView.ExecuteScriptAsync("getCsv()");
                return DecodeJsonString(result);
            }
            catch (Exception ex)
            {
                System.Diagnostics.Debug.WriteLine("[CsvEditor] GetCsvFromGridAsync error: " + ex.Message);
                return null;
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

        #region Menu handlers

        private void menuOpen_Click(object sender, EventArgs e) => OpenFileDialogAndLoad();

        private void menuSave_Click(object sender, EventArgs e) => _ = SaveFileAsync();

        private void menuSaveAs_Click(object sender, EventArgs e) => _ = SaveFileAsAsync();

        private void menuDarkMode_Click(object sender, EventArgs e)
        {
            _isDarkMode = menuDarkMode.Checked;
            _settingsService.Set("DarkMode", _isDarkMode ? "true" : "false");
            InvokeScript("setDarkMode", _isDarkMode ? "true" : "false");
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

        /// <summary>
        /// Decodes a JSON-encoded string returned by WebView2.ExecuteScriptAsync.
        /// Chromium escapes the result (e.g. &lt; becomes <, backslashes are
        /// doubled, non-ASCII becomes \uXXXX), so a full JSON string decode is required
        /// to avoid corrupting saved CSV content.
        /// </summary>
        private static string DecodeJsonString(string json)
        {
            if (string.IsNullOrEmpty(json)) return json;
            if (json == "null") return null;
            if (json.Length < 2 || json[0] != '"' || json[json.Length - 1] != '"')
                return json;

            var sb = new System.Text.StringBuilder(json.Length - 2);
            int i = 1;
            int end = json.Length - 1;
            while (i < end)
            {
                char c = json[i];
                if (c != '\\')
                {
                    sb.Append(c);
                    i++;
                    continue;
                }
                if (i + 1 >= end)
                {
                    sb.Append(c);
                    i++;
                    continue;
                }
                char esc = json[i + 1];
                switch (esc)
                {
                    case '"': sb.Append('"'); i += 2; break;
                    case '\\': sb.Append('\\'); i += 2; break;
                    case '/': sb.Append('/'); i += 2; break;
                    case 'b': sb.Append('\b'); i += 2; break;
                    case 'f': sb.Append('\f'); i += 2; break;
                    case 'n': sb.Append('\n'); i += 2; break;
                    case 'r': sb.Append('\r'); i += 2; break;
                    case 't': sb.Append('\t'); i += 2; break;
                    case 'u':
                        if (i + 6 <= end &&
                            int.TryParse(json.Substring(i + 2, 4),
                                System.Globalization.NumberStyles.HexNumber,
                                System.Globalization.CultureInfo.InvariantCulture,
                                out int codeUnit))
                        {
                            sb.Append((char)codeUnit);
                            i += 6;
                        }
                        else
                        {
                            sb.Append(esc);
                            i += 2;
                        }
                        break;
                    default:
                        sb.Append(esc);
                        i += 2;
                        break;
                }
            }
            return sb.ToString();
        }

        #endregion
    }
}
