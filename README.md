# Clarion CSV Editor

A CSV / TSV viewer and editor addin for the Clarion IDE. Opens `.csv` and `.tsv`
files in an editable grid rendered with [Tabulator](https://tabulator.info/)
inside a WebView2 control, instead of the default plain-text editor.

> Status: **scaffold / v0.1.0** — builds and runs the core open → edit → save
> loop. See [Roadmap](#roadmap) for what is intentionally not done yet.

## Features (v0.1.0)

- Registers as the handler for `.csv` and `.tsv` files; each file opens in its
  own editor document tab (titled with the file name).
- **Integrates with the IDE's native File menu** — **File → Open** routes here,
  and **File → Save** / **Save As** save the grid. The unsaved `*` marker and
  the close-without-saving prompt work like any other editor.
- Editable cells, editable column headers, add/delete rows, add columns.
- Header-row handling for files with or without a header row (auto-detected,
  with a toolbar toggle).
- In-editor dark mode toggle, persisted across sessions.
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
- **JS → C# (object)**: `postMessage({ type: "ready" | "contentChanged" | "saveRequested" | "darkModeChanged", ... })`
- **JS → C# (string)**: `postMessage("CSV:" + getCsv())` — the current grid
  serialised back to CSV (via Papa Parse `unparse`).

### Saving is synchronous by design

The IDE's `File > Save` calls `ViewContent.Save(string)` **synchronously**, and
blocking on WebView2's async `ExecuteScriptAsync` to pull content would deadlock
the UI thread. So instead the page **pushes** a CSV snapshot to the host on load
and after every change (the `"CSV:"` string message above). `Save` just writes
that cached snapshot — no round-trip, no deadlock. The snapshot travels as a raw
string rather than inside a JSON object to avoid escaping a large payload.

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
