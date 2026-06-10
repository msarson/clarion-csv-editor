/*
 * CSV Editor front-end.
 *
 * Owns the editable grid. The C# host owns the file on disk. Contract:
 *   C# -> JS : loadCsv(text, fileName, delimiter), setDarkMode("true"|"false"),
 *              onFileSaved(fileName)
 *   JS -> C# : post({ type: "ready" | "contentChanged" | "saveRequested" | "darkModeChanged", ... })
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
// plain string (not JSON) to avoid escaping a large payload.
function pushSnapshot() {
    if (!table) return;
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(CSV_SNAPSHOT_PREFIX + getCsv());
    }
}

function fieldId(i) { return "c" + i; }

function genericName(i) { return "Column " + (i + 1); }

function setDirty(value) {
    dirty = value;
}

function markDirty() {
    if (suppressDirty) return;
    if (!dirty) setDirty(true);
    post({ type: "contentChanged" });
    pushSnapshot();
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
        headerSort: false,
        resizable: true,
        widthGrow: 1,
    }));
}

function ensureTable() {
    if (table) return;
    table = new Tabulator("#grid", {
        height: "100%",
        layout: "fitDataStretch",
        // Single-row selection: clicking a cell in another row moves the
        // highlight rather than accumulating selections. Tabulator deselects
        // the previous row once the limit (1) is exceeded.
        selectableRows: 1,
        reactiveData: false,
        columns: [],
        data: [],
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

// Current grid contents as a plain array-of-arrays, header row excluded
// (the header lives in `headers`, not in the row data).
function currentDataMatrix() {
    return table.getData().map(row => headers.map((_, c) => {
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

    const data = dataRows.map(row => {
        const obj = {};
        for (let c = 0; c < colCount; c++) obj[fieldId(c)] = c < row.length ? row[c] : "";
        return obj;
    });

    suppressDirty = true;
    table.setColumns(buildColumns());
    // Push the snapshot only once the data is actually applied — getCsv() reads
    // the live grid, which is empty until this promise resolves. Pushing earlier
    // would cache an empty file and a subsequent save would wipe the CSV.
    table.setData(data).then(() => {
        suppressDirty = false;
        pushSnapshot();
    });
    return data.length;
}

function syncHeaderToggle() {
    const cb = document.getElementById("headerToggle");
    if (cb) cb.checked = hasHeader;
}

// Grid dimensions only — the file name lives on the IDE document tab, not here.
function setStatusForFile(rowCount) {
    const mode = hasHeader ? "" : "  (no header)";
    setStatus(rowCount + " rows × " + headers.length + " cols" + mode);
}

/* ---- C# -> JS entry points ---- */

function loadCsv(text, fileName, delim) {
    delimiter = delim || ",";
    ensureTable();

    const parsed = Papa.parse(text, {
        delimiter: delimiter,
        skipEmptyLines: false,
        newline: "",
    });
    const rows = parsed.data || [];

    hasHeader = firstRowLooksLikeHeader(rows);
    syncHeaderToggle();

    const rowCount = buildFrom(rows);
    setDirty(false);
    // Note: the host cache is seeded by buildFrom() once setData() resolves.
    setStatusForFile(rowCount);
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

function onFileSaved(fileName) {
    setDirty(false);
    setStatus("Saved");
}

/* ---- JS -> C# returning data ---- */

// Returns the full CSV text for the C# host to write to disk. A header line is
// emitted only in header mode, so the output matches the original file.
function getCsv() {
    if (!table) return "";
    const body = currentDataMatrix();
    const matrix = hasHeader ? [headers.slice(), ...body] : body;
    return Papa.unparse(matrix, { delimiter: delimiter });
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
    const rowCount = buildFrom(full); // re-seeds the host cache when setData resolves
    setStatusForFile(rowCount);
}

function addRow() {
    if (!table) return;
    const blank = {};
    headers.forEach((_, c) => { blank[fieldId(c)] = ""; });
    const selected = table.getSelectedRows();
    if (selected.length > 0) {
        table.addRow(blank, false, selected[selected.length - 1]);
    } else {
        table.addRow(blank);
    }
    markDirty();
}

function deleteSelectedRows() {
    if (!table) return;
    const selected = table.getSelectedRows();
    if (selected.length === 0) return;
    selected.forEach(r => r.delete());
    markDirty();
}

function addColumn() {
    if (!table) return;
    const i = headers.length;
    headers.push(genericName(i));
    table.addColumn({
        title: headers[i],
        field: fieldId(i),
        editor: "input",
        editableTitle: hasHeader,
        headerSort: false,
        resizable: true,
        widthGrow: 1,
    });
    markDirty();
}

/* ---- Wiring ---- */

// Ctrl+S saves. WebView2 captures keyboard input while the grid has focus and does
// NOT forward the keystroke to the IDE's File > Save accelerator, so the page has to
// handle it: commit any in-flight cell edit (blur fires cellEdited -> the host's CSV
// snapshot updates), then ask the host to save. The host pulls getCsv() to write.
document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const el = document.activeElement;
        if (el && typeof el.blur === "function") el.blur();
        post({ type: "saveRequested" });
    }
});

ensureTable();
post({ type: "ready" });
