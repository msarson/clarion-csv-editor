// Unit tests for the CSV editor's pure grid logic (parse, serialize, header/delimiter
// detection, dirty baseline). Loads the REAL Resources/csv-editor.js in a sandbox
// with the real Papa Parse and a minimal Tabulator stub, so we test the shipping
// code without a browser, WebView2, or the IDE. Run: node --test
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RES = path.join(__dirname, "..", "ClarionCsvEditor", "Resources");
const Papa = require(path.join(RES, "papaparse.min.js"));
const SOURCE = fs.readFileSync(path.join(RES, "csv-editor.js"), "utf8");

// Build a fresh sandbox running the real csv-editor.js. Returns the editor's
// internal functions/state plus the list of messages it posted to the "host".
function loadEditor() {
    const posted = [];

    class TableStub {
        constructor() { this._data = []; }
        on() {}
        setColumns() {}
        setData(d) { this._data = d.map(r => Object.assign({}, r)); return Promise.resolve(); }
        getData() { return this._data; }
        getDataCount() { return this._data.length; }
        clearFilter() {} setFilter() {} undo() {} redo() {} getRanges() { return []; }
        addRow() { return Promise.resolve({ getData: () => ({}) }); }
    }
    const el = () => ({ checked: true, value: "", textContent: "", classList: { toggle() {}, contains() { return false; } } });
    const ctx = {
        Papa,
        Tabulator: TableStub,
        console,
        document: { getElementById: el, addEventListener() {}, body: { classList: { toggle() {}, contains() { return false; } } }, activeElement: null },
        window: { chrome: { webview: { postMessage: (m) => posted.push(m) } } },
    };
    vm.createContext(ctx);
    // Expose the internals after the script's own declarations so the closures
    // capture the module-scoped let-bindings (table, headers, dirty, savedCsv...).
    const exposed = SOURCE + "\n;globalThis.__api = {" +
        "loadCsv, getCsv, markDirty, markClean, changeDelimiter, firstRowLooksLikeHeader, replaceInCell," +
        "state: () => ({ dirty, savedCsv, delimiter, hasHeader, colCount: headers.length, fileEol, fileEndsWithNewline })," +
        "rows: () => table.getData()," +
        "table: () => table };";
    vm.runInContext(exposed, ctx);
    return { api: ctx.__api, posted };
}

const flush = () => new Promise((r) => setImmediate(r));
const dirtyMsgs = (posted) => posted.filter((m) => typeof m === "object" && m.type === "dirtyChanged");

test("round-trips a CRLF file with a trailing newline unchanged", async () => {
    const { api } = loadEditor();
    const src = "Name,Age\r\nAlice,30\r\nBob,25\r\n";
    api.loadCsv(src, "people.csv", null);
    await flush();
    assert.strictEqual(api.getCsv(), src);
});

test("drops Papa's trailing empty artifact row (no phantom ,,, line)", async () => {
    const { api } = loadEditor();
    api.loadCsv("A,B\r\n1,2\r\n3,4\r\n", "f.csv", null);
    await flush();
    assert.strictEqual(api.table()._data.length, 2, "should be 2 data rows, not 3");
});

test("preserves LF and a missing trailing newline", async () => {
    const { api } = loadEditor();
    const src = "A,B\n1,2\n3,4"; // LF, no trailing newline
    api.loadCsv(src, "f.csv", null);
    await flush();
    assert.strictEqual(api.state().fileEol, "\n");
    assert.strictEqual(api.getCsv(), src);
});

test("auto-detects a semicolon delimiter", async () => {
    const { api } = loadEditor();
    api.loadCsv("a;b;c\n1;2;3\n", "f.csv", null);
    await flush();
    assert.strictEqual(api.state().delimiter, ";");
});

test("treats a numeric first row as data, not a header", async () => {
    const { api } = loadEditor();
    api.loadCsv("1,2,3\n4,5,6\n", "f.csv", null);
    await flush();
    assert.strictEqual(api.state().hasHeader, false);
});

test("dirty baseline: clean on load, dirty on edit, clean again when reverted", async () => {
    const { api, posted } = loadEditor();
    api.loadCsv("A,B\r\n1,2\r\n", "f.csv", null);
    await flush();
    assert.strictEqual(api.state().dirty, false, "freshly loaded file is clean");

    // Edit a cell, then signal a change.
    api.table()._data[0].c0 = "999";
    api.markDirty();
    assert.strictEqual(api.state().dirty, true, "edited cell -> dirty");
    assert.strictEqual(dirtyMsgs(posted).pop().dirty, "true");

    // Revert the cell to its original value.
    api.table()._data[0].c0 = "1";
    api.markDirty();
    assert.strictEqual(api.state().dirty, false, "reverted to original -> clean");
    assert.strictEqual(dirtyMsgs(posted).pop().dirty, "false");
});

test("no-header mode emits no header line and round-trips", async () => {
    const { api } = loadEditor();
    const src = "1,2\r\n3,4\r\n"; // numeric first row -> detected as data
    api.loadCsv(src, "f.csv", null);
    await flush();
    assert.strictEqual(api.state().hasHeader, false);
    assert.strictEqual(api.getCsv(), src);
});

test("round-trips fields that require quoting (comma + embedded quote)", async () => {
    const { api } = loadEditor();
    const src = 'a,"b,c"\r\n"x""y",z\r\n'; // quoted comma; escaped embedded quote
    api.loadCsv(src, "f.csv", null);
    await flush();
    assert.strictEqual(api.getCsv(), src);
});

test("auto-detects a tab delimiter", async () => {
    const { api } = loadEditor();
    api.loadCsv("a\tb\tc\n1\t2\t3\n", "f.csv", null);
    await flush();
    assert.strictEqual(api.state().delimiter, "\t");
});

test("auto-detects a pipe delimiter", async () => {
    const { api } = loadEditor();
    api.loadCsv("a|b|c\n1|2|3\n", "f.csv", null);
    await flush();
    assert.strictEqual(api.state().delimiter, "|");
});

test("auto-detects a 2-column tab file (no commas present)", async () => {
    const { api } = loadEditor();
    api.loadCsv("a\tb\n1\t2\n", "f.csv", null);
    await flush();
    assert.strictEqual(api.state().delimiter, "\t");
    assert.strictEqual(api.state().colCount, 2);
});

test("auto-detects a 2-column semicolon file", async () => {
    const { api } = loadEditor();
    api.loadCsv("a;b\n1;2\n", "f.csv", null);
    await flush();
    assert.strictEqual(api.state().delimiter, ";");
    assert.strictEqual(api.state().colCount, 2);
});

test("a plain single-column file stays one column (comma default)", async () => {
    const { api } = loadEditor();
    api.loadCsv("Name\r\nAlice\r\nBob\r\n", "f.csv", null);
    await flush();
    assert.strictEqual(api.state().delimiter, ",");
    assert.strictEqual(api.state().colCount, 1);
});

test("keeps a blank row in the middle (only the trailing artifact is dropped)", async () => {
    const { api } = loadEditor();
    api.loadCsv("A,B\r\n1,2\r\n\r\n3,4\r\n", "f.csv", null);
    await flush();
    // rows: [1,2], [blank], [3,4] — three data rows, not two.
    assert.strictEqual(api.rows().length, 3);
});

test("replaceInCell replaces case-insensitively by default, with a count", () => {
    const { api } = loadEditor();
    const r = api.replaceInCell("FOObar foo", "foo", "X", false);
    assert.strictEqual(r.value, "Xbar X");
    assert.strictEqual(r.count, 2);
});

test("replaceInCell respects match-case", () => {
    const { api } = loadEditor();
    const r = api.replaceInCell("foo FOO", "foo", "X", true);
    assert.strictEqual(r.value, "X FOO");
    assert.strictEqual(r.count, 1);
});

test("replaceInCell reports zero and is unchanged when nothing matches", () => {
    const { api } = loadEditor();
    const r = api.replaceInCell("abc", "z", "X", false);
    assert.strictEqual(r.value, "abc");
    assert.strictEqual(r.count, 0);
});

test("changing the delimiter re-parses the source", async () => {
    const { api } = loadEditor();
    api.loadCsv("a;b;c\r\n1;2;3\r\n", "f.csv", null);
    await flush();
    assert.strictEqual(api.state().delimiter, ";");
    assert.strictEqual(api.state().colCount, 3);

    api.changeDelimiter(","); // re-read with comma: each line is now one column
    await flush();
    assert.strictEqual(api.state().delimiter, ",");
    assert.strictEqual(api.state().colCount, 1);
});
