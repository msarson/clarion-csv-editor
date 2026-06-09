# Clarion CSV Editor

A CSV / TSV viewer and editor addin for the Clarion IDE. Opens `.csv` and `.tsv`
files in an editable grid rendered with [Tabulator](https://tabulator.info/)
inside a WebView2 control, instead of the default plain-text editor.

> Status: **scaffold / v0.1.0** — builds and runs the core open → edit → save
> loop. See [Roadmap](#roadmap) for what is intentionally not done yet.

## Features (v0.1.0)

- Registers as the handler for `.csv` and `.tsv` files (opens as a document tab).
- Also available as a dockable pad (**View → Tools → CSV Editor**, `Ctrl+Alt+C`)
  and a window (**View → Tools → CSV Editor (Window)**).
- Editable cells, editable column headers, add/delete rows, add columns.
- Save (`Ctrl+S`) / Save As, with the host owning the file on disk.
- Dark mode, persisted across sessions.
- Fully offline — Tabulator and Papa Parse are bundled locally; no CDN.

## How it works

This follows the same architecture as the
[Clarion Markdown Editor](../clarion-markdown-editor):

| Layer | File |
| --- | --- |
| File-type handler | `CsvDisplayBinding.cs` (`IDisplayBinding`) |
| Document tab | `CsvEditorViewContent.cs` (`AbstractViewContent`) |
| Dockable pad | `CsvEditorPad.cs` (`AbstractPadContent`) |
| WebView2 host | `CsvEditorControl.cs` |
| Grid front-end | `Resources/csv-editor.{html,css,js}` |

The C# host owns the file on disk; the JavaScript grid owns the editing UI. They
communicate over WebView2 web messages:

- **C# → JS**: `ExecuteScriptAsync("loadCsv(text, name, delimiter)")`,
  `setDarkMode(...)`, `onFileSaved(...)`
- **JS → C#**: `window.chrome.webview.postMessage({ type: "saveRequested" | "contentChanged" | "darkModeChanged" | "ready" })`

On save, the host calls `getCsv()` in the page, decodes the JSON-escaped result
(`DecodeJsonString`), and writes it to disk. Re-serialisation is done with Papa
Parse's `unparse`, so quoting/delimiters are handled correctly.

## Building

Requires the .NET Framework 4.8 developer pack and a Clarion install.

```pwsh
dotnet build ClarionCsvEditor.slnx -c Release
```

The build references `ICSharpCode.Core.dll` and `ICSharpCode.SharpDevelop.dll`
from the Clarion `bin` directory. Point it at your install via one of:

1. `CLARION_BIN` environment variable
2. a gitignored `ClarionCsvEditor/Directory.Build.props.user` (see the sample committed alongside)
3. `dotnet build /p:ClarionBin=C:\Clarion\Clarion11.1\bin`

`WebView2Loader.dll` is auto-copied to the output root after build.

## Deploying

Copy the build output to `<Clarion>\accessory\addins\CsvAddin\` (the
`deploymentPath` in `addin-config.json`), including the `Resources/` folder.

## Roadmap

- Header-row detection toggle (treat first row as data vs. header).
- Delimiter auto-detection and a UI picker.
- Undo/redo, find/replace, column reordering and type-aware editors.
- Large-file streaming for multi-hundred-MB files.

## Third-party

Bundled under `Resources/`, both MIT:

- [Tabulator](https://github.com/olifolkerd/tabulator) v6.3.1
- [Papa Parse](https://github.com/mholt/PapaParse) v5.4.1

See [THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md).

## License

MIT © 2026 Mark Sarson. See [LICENSE](LICENSE).
