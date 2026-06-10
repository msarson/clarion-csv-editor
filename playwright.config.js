const { defineConfig } = require("@playwright/test");

// E2E tests drive the real csv-editor page (Tabulator + Papa Parse) in headless
// Chromium — the layer between the node unit tests and full IDE testing. Clipboard
// permissions are granted so copy/paste (Excel interop) can be exercised.
module.exports = defineConfig({
    testDir: "./tests/e2e",
    fullyParallel: false,
    reporter: "list",
    use: {
        headless: true,
        permissions: ["clipboard-read", "clipboard-write"],
    },
    projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
