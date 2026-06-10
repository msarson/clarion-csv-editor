const { test, expect } = require("@playwright/test");
const { openGrid, csvOut, dirtyNow, cell } = require("./helpers");

test("loads CSV rows into the grid", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n3,4\r\n");
    await expect(page.locator(".tabulator-row")).toHaveCount(2);
});

test("sort is view-only — saved order is unchanged", async ({ page }) => {
    await openGrid(page, "N\r\n3\r\n1\r\n2\r\n");
    await page.evaluate(() => table.setSort("c0", "asc")); // display becomes 1,2,3
    expect(await csvOut(page)).toBe("N\r\n3\r\n1\r\n2\r\n"); // file order preserved
});

test("search hides rows but a save still writes them all", async ({ page }) => {
    await openGrid(page, "A\r\nfoo\r\nbar\r\nbaz\r\n");
    await page.fill("#search", "foo");
    await page.waitForFunction(() => table.getDataCount("active") === 1);
    expect(await csvOut(page)).toBe("A\r\nfoo\r\nbar\r\nbaz\r\n");
});

test("edit then undo reverts the value and clears dirty", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n3,4\r\n");
    await cell(page, 0, "c0").dblclick();
    await page.keyboard.type("99");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => dirty === true);

    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => dirty === false);
    expect(await csvOut(page)).toBe("A,B\r\n1,2\r\n3,4\r\n");
});

test("shift-click selects a cell range", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n3,4\r\n");
    await cell(page, 0, "c0").click();
    await cell(page, 0, "c1").click({ modifiers: ["Shift"] });
    // The range spans both cells of row 0.
    expect(await page.evaluate(() => table.getRanges()[0].getData())).toEqual([{ c0: "1", c1: "2" }]);
});

test("copying a range produces tab-separated values", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n3,4\r\n");
    await page.evaluate(() => { window.__copied = null; table.on("clipboardCopied", (c) => { window.__copied = c; }); });
    await cell(page, 0, "c0").click();
    await cell(page, 0, "c1").click({ modifiers: ["Shift"] });
    // Headless Chromium does not raise a native 'copy' event from a synthetic
    // Ctrl+C, so copy is invoked through the API; the produced text is what a real
    // Ctrl+C puts on the clipboard (verified the same in headed mode).
    await page.evaluate(() => table.copyToClipboard("range"));
    await page.waitForFunction(() => window.__copied !== null);
    expect(await page.evaluate(() => window.__copied)).toMatch(/1\t2/);
});

// Regression guard: a tab-separated row must spread across columns from the anchor
// cell (this previously collapsed to only the last value in the first cell — fixed
// by pairing clipboardPasteParser:"range" with clipboardPasteAction:"range").
test("paste of a TSV row distributes across columns", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n3,4\r\n");
    await cell(page, 0, "c0").click();
    await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData("text/plain", "9\t8");
        document.querySelector(".tabulator-tableholder")
            .dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => getCsv() !== "A,B\r\n1,2\r\n3,4\r\n");
    expect(await csvOut(page)).toBe("A,B\r\n9,8\r\n3,4\r\n");
    expect(await dirtyNow(page)).toBe(true);
});
