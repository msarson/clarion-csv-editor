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
        "loadCsv, getCsv, markDirty, markClean, firstRowLooksLikeHeader," +
        "state: () => ({ dirty, savedCsv, delimiter, hasHeader, fileEol, fileEndsWithNewline })," +
        "table: () => table, posted: () => null };";
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
