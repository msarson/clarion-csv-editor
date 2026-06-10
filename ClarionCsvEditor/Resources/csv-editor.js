/*
 * CSV Editor front-end.
 *
 * Owns the editable grid. The C# host owns the file on disk. Contract:
 *   C# -> JS : loadCsv(text, fileName, delimiter), setDarkMode("true"|"false"),
 *              onFileSaved(fileName)
 *   JS -> C# : post({ type: "ready" | "dirtyChanged" | "saveRequested" | "darkModeChanged", ... })
 *
 * Column model: columns use stable internal field ids (c0, c1, ...) so duplicate
 * or empty header text never collides.
 *
 * Header mode (hasHeader):
 *   - on  : row 1 of the file is the column header; its text is the (editable)
 *           column titles, and data starts at row 2.
 *   - off : the file has no header row; every row is data and columns get
 *           generic, non-editable captions (Column 1..N).
 * The mode is auto-detected on load (numeric first row => no header) and can be
 * flipped with the toolbar toggle. Flipping re-interprets the rows already in
 * the grid (promote/demote the first row) without re-reading the file, and
 * getCsv() only emits a header line when the mode is on, so a round-trip
 * reproduces the original file regardless of the toggle.
 */

let table = null;
let headers = [];          // display titles, index-aligned with field ids c0..cN
let delimiter = ",";
let hasHeader = true;      // see "Header mode" above
let suppressDirty = false; // true while we programmatically (re)load data
let dirty = false;         // true when there are unsaved edits

// Original file's line-ending style and whether it ended with a trailing newline,
// captured on load so a re-save reproduces them exactly (round-trip fidelity).
let fileEol = "\r\n";
let fileEndsWithNewline = true;

// Raw text of the loaded file, kept so a delimiter change can re-parse the source.
let originalText = "";
// CSV of the grid as it was last loaded/saved — the "clean" baseline. The document
// is dirty only while the current grid differs from this, so undoing every change
// (or re-typing the original value) clears the dirty state, like other editors.
let savedCsv = "";
// Promise of the most recent grid (re)build, so structural ops can run follow-up
// work (mark dirty, refresh status) only after setData() has actually applied.
let lastBuild = Promise.resolve();

const CSV_SNAPSHOT_PREFIX = "CSV:";

function post(payload) {
    // Pass the object directly. WebView2 serialises it to JSON for the host's
    // WebMessageAsJson. Calling JSON.stringify here would double-encode it into
    // an escaped string literal, which the host-side parser can't read.
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(payload);
    }
}

// Push the current grid as CSV to the host over the raw-string channel, so the
// host always holds the latest content and can save synchronously. Sent as a
// plain string (not JSON) to avoid escaping a large payload. Pass a precomputed
// csv to avoid serialising twice.
function pushSnapshot(csv) {
    if (!table) return;
    if (csv === undefined) csv = getCsv();
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(CSV_SNAPSHOT_PREFIX + csv);
    }
}

function fieldId(i) { return "c" + i; }

function genericName(i) { return "Column " + (i + 1); }

// Tell the host the dirty state changed (only when it actually flips), so the IDE
// tab's '*' tracks whether the grid differs from the saved baseline.
function setDirtyState(value) {
    if (dirty === value) return;
    dirty = value;
    post({ type: "dirtyChanged", dirty: value ? "true" : "false" });
}

// Adopt the current grid as the saved baseline and clear dirty. Called on load and
// after a successful save, when the grid matches what's on disk.
function markClean() {
    savedCsv = getCsv();
    setDirtyState(false);
}

// A change happened: refresh the host snapshot and set dirty according to whether
// the grid still differs from the saved baseline (so undo-to-original clears it).
function markDirty() {
    if (suppressDirty) return;
    const csv = getCsv();
    pushSnapshot(csv);
    setDirtyState(csv !== savedCsv);
}

function setStatus(text) {
    document.getElementById("status").textContent = text;
}

function buildColumns() {
    return headers.map((title, i) => ({
        title: title,
        field: fieldId(i),
        editor: "input",
        editableTitle: hasHeader, // generic captions aren't real data; keep them read-only
        headerSort: true,
        resizable: true,
        widthGrow: 1,
    }));
}

function ensureTable() {
    if (table) return;
    table = new Tabulator("#grid", {
        height: "100%",
        layout: "fitDataStretch",
        reactiveData: false,
        columns: [],
        data: [],

        // #1 Sorting: only the sort-arrow icon triggers a sort, leaving a plain
        // header click free to select the column and a double-click to edit its title.
        headerSortClickElement: "icon",

        // #3 Undo / redo of cell edits and row add/delete.
        history: true,

        // #4 / #5 Excel-style cell-range selection + clipboard. Single click or drag
        // selects a range; double-click edits. Copy/paste use TSV — the same format
        // Excel puts on the clipboard — so blocks round-trip with a spreadsheet.
        selectableRange: 1,
        selectableRangeColumns: true,
        selectableRangeRows: true,
        editTriggerEvent: "dblclick",
        clipboard: true,
        clipboardCopyStyled: false,
        clipboardCopyConfig: { columnHeaders: false }, // copy raw cell values, no header row
        clipboardCopyRowRange: "range",
        // Parser AND action must both be "range" for spreadsheet-style paste: a TSV
        // block fills outward from the anchor cell across columns/rows. With the
        // default "table" parser the action mis-maps and only the last value lands.
        clipboardPasteParser: "range",
        clipboardPasteAction: "range",

        // Row-number gutter; also the click target for selecting whole rows.
        rowHeader: {
            formatter: "rownum", hozAlign: "center", headerSort: false,
            resizable: false, frozen: true, width: 44, editor: false,
            cssClass: "row-header",
        },
    });

    table.on("cellEdited", markDirty);
    table.on("columnTitleChanged", function (column) {
        if (!hasHeader) return; // captions are read-only in headerless mode
        const field = column.getField();
        const idx = parseInt(field.substring(1), 10);
        if (!isNaN(idx)) headers[idx] = column.getDefinition().title;
        markDirty();
    });
    // Reliable post-mutation hook: fires after edits/adds/deletes are applied,
    // so the host's CSV cache is never stale (Tabulator's add/delete are async).
    table.on("dataChanged", function () { pushSnapshot(); });
    // Undo/redo and clipboard paste change data outside cellEdited — mark dirty too.
    table.on("historyUndo", markDirty);
    table.on("historyRedo", markDirty);
    table.on("clipboardPasted", markDirty);
}

/* ---- Header-mode helpers ---- */

// A first row that contains a purely-numeric cell is almost certainly data,
// not a header. Used only to pick the initial toggle position on load.
function firstRowLooksLikeHeader(rows) {
    if (rows.length === 0) return true;
    for (const cell of rows[0]) {
        if (cell !== null && cell !== "" && !isNaN(cell) && isFinite(cell)) return false;
    }
    return true;
}

// Current grid contents as a plain array-of-arrays, header row excluded (the header
// lives in `headers`, not in row data). Rows are emitted in their original logical
// order (_ord), not the current sort/filter view — getData() returns every row
// including any hidden by a search filter, so a save never loses or reorders data.
function currentDataMatrix() {
    return table.getData()
        .slice()
        .sort((a, b) => (a._ord == null ? 1e9 : a._ord) - (b._ord == null ? 1e9 : b._ord))
        .map(row => headers.map((_, c) => {
            const v = row[fieldId(c)];
            return v == null ? "" : v;
        }));
}

// Rebuild the grid from a full matrix (array-of-arrays). Splits the matrix into
// headers + data according to the current `hasHeader`. Does not touch dirty
// state — callers decide that.
function buildFrom(rows) {
    let colCount = 1;
    for (const r of rows) colCount = Math.max(colCount, r.length);

    let dataRows;
    if (hasHeader) {
        const hr = rows.length > 0 ? rows[0] : [];
        headers = [];
        for (let i = 0; i < colCount; i++) {
            headers.push(hr[i] && hr[i].length ? hr[i] : genericName(i));
        }
        dataRows = rows.slice(1);
    } else {
        headers = [];
        for (let i = 0; i < colCount; i++) headers.push(genericName(i));
        dataRows = rows.slice(0);
    }

    const data = dataRows.map((row, idx) => {
        const obj = { _ord: idx };   // stable logical order; keeps sort/filter view-only
        for (let c = 0; c < colCount; c++) obj[fieldId(c)] = c < row.length ? row[c] : "";
        return obj;
    });

    suppressDirty = true;
    table.setColumns(buildColumns());
    // Push the snapshot only once the data is actually applied — getCsv() reads
    // the live grid, which is empty until this promise resolves. Pushing earlier
    // would cache an empty file and a subsequent save would wipe the CSV.
    lastBuild = table.setData(data).then(() => {
        suppressDirty = false;
        pushSnapshot();
        refreshStatus();
    });
    return lastBuild;
}

function syncHeaderToggle() {
    const cb = document.getElementById("headerToggle");
    if (cb) cb.checked = hasHeader;
}

// Grid dimensions (the file name lives on the IDE document tab, not here). When a
// search filter is hiding rows it shows "<shown> of <total> rows".
function refreshStatus() {
    if (!table) return;
    const total = table.getDataCount();
    const shown = table.getDataCount("active");
    const mode = hasHeader ? "" : "  (no header)";
    let s = total + " rows × " + headers.length + " cols" + mode;
    if (shown !== total) s = shown + " of " + s;
    setStatus(s);
}

/* ---- C# -> JS entry points ---- */

function loadCsv(text, fileName, delim) {
    originalText = text || "";
    ensureTable();

    fileEol = originalText.indexOf("\r\n") !== -1 ? "\r\n" : "\n";
    fileEndsWithNewline = /\n$/.test(originalText);

    // .tsv forces tab; otherwise let Papa auto-detect (comma, semicolon, tab, pipe).
    parseAndBuild((delim === "\t") ? "\t" : null);
}

// (Re)parse the original file text and rebuild the grid. forcedDelim null = let Papa
// auto-detect the delimiter. Always works from the source text, so changing the
// delimiter re-reads the file. The grid's host CSV cache is reseeded by buildFrom().
function parseAndBuild(forcedDelim) {
    const parsed = Papa.parse(originalText, {
        delimiter: forcedDelim || "",
        skipEmptyLines: false,
        newline: "",
    });
    delimiter = parsed.meta.delimiter || forcedDelim || ",";
    syncDelimiterPicker();

    const rows = parsed.data || [];
    // Papa keeps a trailing one-cell empty row [""] for a file that ends with a
    // newline. Left in the grid it becomes a phantom blank row that getCsv() pads
    // to the full column width (",,,,,,,") on save. Drop it — the trailing newline
    // itself is restored on save via fileEndsWithNewline.
    if (rows.length > 1) {
        const last = rows[rows.length - 1];
        if (last.length === 1 && last[0] === "") rows.pop();
    }

    hasHeader = firstRowLooksLikeHeader(rows);
    syncHeaderToggle();
    buildFrom(rows);
    lastBuild.then(markClean);   // load / delimiter-change: the grid now matches the file
}

// Delimiter picker changed: re-read the original file with the chosen delimiter.
// Note: this re-parses the source, so edits made since load are discarded.
function changeDelimiter(v) {
    const d = v === "tab" ? "\t" : v;
    if (d === delimiter) return;
    parseAndBuild(d);
}

function syncDelimiterPicker() {
    const sel = document.getElementById("delimiter");
    if (sel) sel.value = (delimiter === "\t") ? "tab" : delimiter;
}

// Called by the host on load to apply the persisted preference. `on` arrives as
// the string "true"/"false" from C#, or a bool from the in-page toggle.
function setDarkMode(on) {
    const enabled = (on === true || on === "true");
    document.body.classList.toggle("dark-mode", enabled);
    const btn = document.getElementById("darkBtn");
    if (btn) btn.classList.toggle("active", enabled);
}

// In-page dark-mode toggle. Flips the theme and tells the host to persist it.
function toggleDark() {
    const enabled = !document.body.classList.contains("dark-mode");
    setDarkMode(enabled);
    post({ type: "darkModeChanged", isDark: enabled ? "true" : "false" });
}

// Host signals a successful save. The grid now matches what was written to disk,
// so adopt it as the clean baseline (the IDE tab's '*' conveys the rest).
function onFileSaved(fileName) {
    markClean();
}

/* ---- JS -> C# returning data ---- */

// Returns the full CSV text for the C# host to write to disk. A header line is
// emitted only in header mode, and the original line-ending style and trailing
// newline are reproduced, so the output round-trips the source file.
function getCsv() {
    if (!table) return "";
    const body = currentDataMatrix();
    const matrix = hasHeader ? [headers.slice(), ...body] : body;
    let out = Papa.unparse(matrix, { delimiter: delimiter, newline: fileEol });
    if (fileEndsWithNewline) out += fileEol;
    return out;
}

// Commit any in-flight cell editor, then return the CSV. The host calls THIS at
// save time (not getCsv directly) so the value currently being typed is always
// included, regardless of how the save was triggered (Ctrl+S, IDE File > Save,
// ...). Blur commits the editor into the grid; suppressDirty stops that commit
// from re-marking the document dirty after we're about to clear it on save.
function commitAndGetCsv() {
    const el = document.activeElement;
    if (el && typeof el.blur === "function") {
        suppressDirty = true;
        el.blur();
        suppressDirty = false;
    }
    return getCsv();
}

/* ---- Toolbar actions ---- */

// Flip header mode, re-interpreting the rows already in the grid. Turning the
// header off pushes the current header text down as a new first data row;
// turning it on promotes the first data row back up to the header. Lossless,
// so it preserves dirty state rather than resetting it.
function toggleHeader() {
    const cb = document.getElementById("headerToggle");
    const want = cb ? cb.checked : !hasHeader;
    if (want === hasHeader) return;

    const data = currentDataMatrix();
    const full = hasHeader ? [headers.slice(), ...data] : data;
    hasHeader = want;
    buildFrom(full); // re-seeds the host cache + refreshes status when setData resolves
    lastBuild.then(markDirty); // header on/off changes the saved text -> recompute dirty
}

/* ---- Selection helpers (Excel-style range model) ---- */

// Rows intersected by the current selection range(s), de-duplicated.
function selectedRows() {
    if (!table) return [];
    const seen = new Set(), out = [];
    table.getRanges().forEach(rg => rg.getRows().forEach(r => {
        if (!seen.has(r)) { seen.add(r); out.push(r); }
    }));
    return out;
}

// Data-column indexes (into `headers`) intersected by the current selection.
function selectedColumnIndexes() {
    if (!table) return [];
    const idxs = new Set();
    table.getRanges().forEach(rg => rg.getColumns().forEach(c => {
        const f = c.getField();
        if (f && /^c\d+$/.test(f)) idxs.add(parseInt(f.substring(1), 10));
    }));
    return Array.from(idxs).sort((a, b) => a - b);
}

function maxOrd() {
    let m = -1;
    table.getData().forEach(r => { if ((r._ord || 0) > m) m = r._ord; });
    return m;
}

// Smallest _ord greater than ref, so an inserted row sorts right after its anchor.
function ordAfter(ref) {
    let next = Infinity;
    table.getData().forEach(r => { if (r._ord > ref && r._ord < next) next = r._ord; });
    return next === Infinity ? ref + 1 : (ref + next) / 2;
}

function doUndo() { if (table) table.undo(); }
function doRedo() { if (table) table.redo(); }

/* ---- Toolbar actions: rows & columns ---- */

function addRow() {
    if (!table) return;
    const ref = selectedRows().pop();
    const blank = { _ord: ref ? ordAfter(ref.getData()._ord) : maxOrd() + 1 };
    headers.forEach((_, c) => { blank[fieldId(c)] = ""; });
    table.addRow(blank, false, ref).then(() => { markDirty(); refreshStatus(); });
}

function deleteSelectedRows() {
    if (!table) return;
    const rows = selectedRows();
    if (rows.length === 0) return;
    Promise.all(rows.map(r => r.delete())).then(() => { markDirty(); refreshStatus(); });
}

function addColumn() {
    if (!table) return;
    const i = headers.length;
    headers.push(genericName(i));
    table.addColumn({
        title: headers[i], field: fieldId(i), editor: "input",
        editableTitle: hasHeader, headerSort: true, resizable: true, widthGrow: 1,
    }).then(() => { markDirty(); refreshStatus(); });
}

// Delete the selected column(s), or the last column if nothing is selected. Field
// ids (c0..cN) must stay contiguous, so rebuild from a full matrix with the chosen
// columns removed rather than dropping columns in place.
function deleteSelectedColumns() {
    if (!table || headers.length === 0) return;
    let idxs = selectedColumnIndexes();
    if (idxs.length === 0) idxs = [headers.length - 1];
    if (idxs.length >= headers.length) return; // keep at least one column
    const drop = new Set(idxs);
    const header = headers.filter((_, c) => !drop.has(c));
    const body = currentDataMatrix().map(row => row.filter((_, c) => !drop.has(c)));
    buildFrom(hasHeader ? [header, ...body] : body);
    lastBuild.then(() => { markDirty(); refreshStatus(); });
}

/* ---- Search ---- */

// Filter to rows where any cell contains the query (case-insensitive). Filtered-out
// rows are still saved — currentDataMatrix() reads the full data set, not just the
// visible rows.
function applySearch(q) {
    if (!table) return;
    q = (q || "").trim().toLowerCase();
    if (!q) { table.clearFilter(); refreshStatus(); return; }
    table.setFilter(function (data) {
        for (let c = 0; c < headers.length; c++) {
            const v = data[fieldId(c)];
            if (String(v == null ? "" : v).toLowerCase().indexOf(q) !== -1) return true;
        }
        return false;
    });
    refreshStatus();
}

/* ---- Wiring ---- */

// Ctrl+S saves. WebView2 captures keyboard input while the grid has focus and does
// NOT forward the keystroke to the IDE's File > Save accelerator, so the page has to
// handle it by asking the host to save. The host reads commitAndGetCsv(), which
// commits any in-flight cell edit before serialising, so nothing typed is lost.
document.addEventListener("keydown", function (e) {
    const mod = e.ctrlKey || e.metaKey;
    if (!mod) return;
    const k = e.key.toLowerCase();

    if (k === "s") { e.preventDefault(); post({ type: "saveRequested" }); return; }

    // While a cell/title editor is open, leave undo/redo to the browser so it acts
    // on the text being typed rather than the whole grid.
    if (isEditing()) return;
    if (k === "z" && !e.shiftKey) { e.preventDefault(); doUndo(); }
    else if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); doRedo(); }
});

function isEditing() {
    const el = document.activeElement;
    return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
}

ensureTable();
post({ type: "ready" });
