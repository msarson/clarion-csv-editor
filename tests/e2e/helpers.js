const fs = require("fs");
const os = require("os");
const path = require("path");

const RES = path.join(__dirname, "..", "..", "ClarionCsvEditor", "Resources");
const read = (f) => fs.readFileSync(path.join(RES, f), "utf8");

// Assemble the page exactly as the C# host does (CsvEditorControl.InjectScripts):
// inline the vendored Tabulator + Papa Parse, and also inline the linked stylesheet
// and csv-editor.js so the page is fully self-contained for setContent().
function buildHtml() {
    let html = read("csv-editor.html");
    html = html.replace("<!-- INJECT_TABULATOR_CSS -->", `<style>\n${read("tabulator.min.css")}\n</style>`);
    html = html.replace("<!-- INJECT_TABULATOR_JS -->", `<script>\n${read("tabulator.min.js")}\n</script>`);
    html = html.replace("<!-- INJECT_PAPAPARSE_JS -->", `<script>\n${read("papaparse.min.js")}\n</script>`);
    html = html.replace('<link rel="stylesheet" href="csv-editor.css">', `<style>\n${read("csv-editor.css")}\n</style>`);
    html = html.replace('<script src="csv-editor.js"></script>', `<script>\n${read("csv-editor.js")}\n</script>`);
    return html;
}

// Write the assembled page to a temp file and load it over file:// — a secure
// context, so the async Clipboard API (copy/paste) is available. (setContent runs
// at about:blank, where navigator.clipboard is undefined.)
const TMP = path.join(os.tmpdir(), "csv-editor-pw.html");
fs.writeFileSync(TMP, buildHtml());
const FILE_URL = "file://" + TMP.replace(/\\/g, "/");

// Open the editor with the given CSV text and wait for the grid to render. Stubs
// window.chrome.webview so the page's host messages are captured in window.__posted.
async function openGrid(page, csv) {
    await page.addInitScript(() => {
        window.__posted = [];
        window.chrome = { webview: { postMessage: (m) => window.__posted.push(m) } };
    });
    await page.goto(FILE_URL);
    await page.evaluate((t) => loadCsv(t, "f.csv", null), csv);
    await page.waitForFunction(() => document.querySelectorAll(".tabulator-row").length > 0);
}

const csvOut = (page) => page.evaluate(() => getCsv());
const dirtyNow = (page) => page.evaluate(() => dirty);
const posted = (page) => page.evaluate(() => window.__posted);
const cell = (page, row, field) =>
    page.locator(".tabulator-row").nth(row).locator(`[tabulator-field="${field}"]`);

module.exports = { openGrid, csvOut, dirtyNow, posted, cell };
