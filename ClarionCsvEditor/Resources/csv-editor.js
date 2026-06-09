/*
 * CSV Editor front-end.
 *
 * Owns the editable grid. The C# host owns the file on disk. Contract:
 *   C# -> JS : loadCsv(text, fileName, delimiter), setDarkMode("true"|"false"),
 *              onFileSaved(fileName)
 *   JS -> C# : post({ type: "ready" | "contentChanged" | "saveRequested"
 *                          | "darkModeChanged", ... })
 *
 * Header model: the first CSV row is treated as the header row. Columns use
 * stable internal field ids (c0, c1, ...) so duplicate or empty header text
 * never collides. Header text is editable in-place (Tabulator editableTitle).
 */

let table = null;
let headers = [];          // display titles, index-aligned with field ids c0..cN
let delimiter = ",";
let suppressDirty = false; // true while we programmatically (re)load data

function post(payload) {
    if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(payload));
    }
}

function fieldId(i) { return "c" + i; }

function markDirty() {
    if (!suppressDirty) post({ type: "contentChanged" });
}

function setStatus(text) {
    document.getElementById("status").textContent = text;
}

function buildColumns() {
    return headers.map((title, i) => ({
        title: title,
        field: fieldId(i),
        editor: "input",
        editableTitle: true,
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
        selectableRows: true,
        reactiveData: false,
        columns: [],
        data: [],
    });

    table.on("cellEdited", markDirty);
    table.on("columnTitleChanged", function (column) {
        const field = column.getField();
        const idx = parseInt(field.substring(1), 10);
        if (!isNaN(idx)) headers[idx] = column.getDefinition().title;
        markDirty();
    });
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

    // First row = headers. Normalise blanks so every column has a usable title.
    const headerRow = rows.length > 0 ? rows[0] : [];
    headers = headerRow.map((h, i) => (h && h.length ? h : "Column " + (i + 1)));
    if (headers.length === 0) headers = ["Column 1"];

    const data = [];
    for (let r = 1; r < rows.length; r++) {
        const row = rows[r];
        const obj = {};
        for (let c = 0; c < headers.length; c++) {
            obj[fieldId(c)] = c < row.length ? row[c] : "";
        }
        data.push(obj);
    }

    suppressDirty = true;
    table.setColumns(buildColumns());
    table.setData(data).then(() => { suppressDirty = false; });

    setStatus(fileName + "  —  " + data.length + " rows × " + headers.length + " cols");
}

function setDarkMode(on) {
    const enabled = (on === true || on === "true");
    document.body.classList.toggle("dark-mode", enabled);
}

function onFileSaved(fileName) {
    setStatus("Saved  " + fileName);
}

/* ---- JS -> C# returning data ---- */

// Returns the full CSV text (header row + data) for the C# host to write to disk.
function getCsv() {
    if (!table) return "";
    const data = table.getData();
    const matrix = [headers.slice()];
    for (const row of data) {
        matrix.push(headers.map((_, c) => {
            const v = row[fieldId(c)];
            return v == null ? "" : v;
        }));
    }
    return Papa.unparse(matrix, { delimiter: delimiter });
}

/* ---- Toolbar actions ---- */

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
    headers.push("Column " + (i + 1));
    table.addColumn({
        title: headers[i],
        field: fieldId(i),
        editor: "input",
        editableTitle: true,
        headerSort: false,
        resizable: true,
        widthGrow: 1,
    });
    markDirty();
}

function requestSave() {
    post({ type: "saveRequested" });
}

/* ---- Wiring ---- */

document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        requestSave();
    }
});

ensureTable();
post({ type: "ready" });
