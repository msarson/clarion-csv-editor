# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## v0.1.0 — 2026-06-09 — Initial scaffold

### Added
- WebView2-hosted CSV / TSV editor for the Clarion IDE, built on the same
  SharpDevelop addin architecture as the Clarion Markdown Editor.
- `IDisplayBinding` registration for `.csv` / `.tsv` (opens as a document tab,
  `insertbefore="Text"`), plus a dockable pad (`Ctrl+Alt+C`) and a window command.
- Editable grid via [Tabulator](https://tabulator.info/) 6.3.1 (bundled, MIT):
  editable cells and headers, add/delete rows, add columns, row selection.
- CSV parsing/serialisation via [Papa Parse](https://www.papaparse.com/) 5.4.1
  (bundled, MIT) — correct quoting and delimiter handling.
- Save (`Ctrl+S`) / Save As; the C# host owns the file on disk and decodes the
  JSON-escaped grid content with a full JSON string decoder to avoid corruption.
- Dark mode, persisted via `SettingsService` under `%APPDATA%\ClarionCsvEditor`.
- Offline-first: Tabulator + Papa Parse are inlined into the page at navigation
  time, served through the `app.local` WebView2 virtual host. No CDN dependency.
