const { test, expect } = require("@playwright/test");
const { openGrid, csvOut, dirtyNow, cell } = require("./helpers");

const btn = (page, name) => page.getByRole("button", { name });

test("add column appends a column and marks dirty", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n");
    await btn(page, "+ Col").click();
    await page.waitForFunction(() => headers.length === 3);
    expect(await dirtyNow(page)).toBe(true);
});

test("delete column removes the selected cell's column (last column)", async ({ page }) => {
    await openGrid(page, "A,B,C\r\n1,2,3\r\n");
    await cell(page, 0, "c2").click(); // put the active range in column C
    await btn(page, "- Col").click();
    await page.waitForFunction(() => headers.length === 2);
    expect(await csvOut(page)).toBe("A,B\r\n1,2\r\n");
});

test("delete a selected middle column keeps remaining columns contiguous", async ({ page }) => {
    await openGrid(page, "A,B,C\r\n1,2,3\r\n");
    await cell(page, 0, "c1").click(); // active range in column B
    await btn(page, "- Col").click();
    await page.waitForFunction(() => headers.length === 2);
    expect(await csvOut(page)).toBe("A,C\r\n1,3\r\n");
});

test("add row inserts below the selected row (logical save order)", async ({ page }) => {
    await openGrid(page, "A\r\nx\r\ny\r\n");
    await cell(page, 0, "c0").click(); // select row x
    await btn(page, "+ Row").click();
    await page.waitForFunction(() => table.getDataCount() === 3);
    expect(await csvOut(page)).toBe("A\r\nx\r\n\r\ny\r\n"); // blank row between x and y
});

test("delete selected rows removes them", async ({ page }) => {
    await openGrid(page, "A\r\nx\r\ny\r\n");
    await cell(page, 0, "c0").click();
    await btn(page, "- Row").click();
    await page.waitForFunction(() => table.getDataCount() === 1);
    expect(await csvOut(page)).toBe("A\r\ny\r\n");
});

test("header toggle preserves the serialized CSV (promote/demote round-trip)", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n3,4\r\n");
    const before = await csvOut(page);
    await page.click("#headerToggle"); // header off -> first row becomes data
    await page.waitForFunction(() => table.getDataCount() === 3);
    expect(await csvOut(page)).toBe(before);
    await page.click("#headerToggle"); // header on again
    await page.waitForFunction(() => table.getDataCount() === 2);
    expect(await csvOut(page)).toBe(before);
});

test("redo re-applies an undone edit", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n");
    await cell(page, 0, "c0").dblclick();
    await page.keyboard.type("9");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => getCsv().indexOf("9,2") !== -1);

    await page.keyboard.press("Control+z");
    await page.waitForFunction(() => dirty === false);
    await page.keyboard.press("Control+y");
    await page.waitForFunction(() => getCsv().indexOf("9,2") !== -1);
    expect(await dirtyNow(page)).toBe(true);
});

test("clearing the search restores all rows", async ({ page }) => {
    await openGrid(page, "A\r\nfoo\r\nbar\r\n");
    await page.fill("#search", "foo");
    await page.waitForFunction(() => table.getDataCount("active") === 1);
    await page.fill("#search", "");
    await page.waitForFunction(() => table.getDataCount("active") === 2);
});

test("delimiter picker re-parses the file", async ({ page }) => {
    await openGrid(page, "a;b;c\r\n1;2;3\r\n");
    await page.waitForFunction(() => delimiter === ";" && headers.length === 3);
    await page.selectOption("#delimiter", ","); // re-read as comma -> single column
    await page.waitForFunction(() => delimiter === "," && headers.length === 1);
});

test("paste a multi-row TSV block fills down and across", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n3,4\r\n");
    await cell(page, 0, "c0").click();
    await page.evaluate(() => {
        const dt = new DataTransfer();
        dt.setData("text/plain", "9\t8\n7\t6");
        document.querySelector(".tabulator-tableholder")
            .dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
    });
    await page.waitForFunction(() => getCsv().indexOf("9,8") !== -1);
    expect(await csvOut(page)).toBe("A,B\r\n9,8\r\n7,6\r\n");
});

test("clicking the row gutter selects the whole row", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n3,4\r\n");
    await page.locator(".tabulator-row").nth(1).locator(".row-header").click();
    expect(await page.evaluate(() => table.getRanges()[0].getData())).toEqual([{ c0: "3", c1: "4" }]);
});

// KNOWN LIMITATION (surfaced by this suite): clicking a column header does not
// select the whole column, even though the equivalent row-gutter click does. The
// header click is consumed by the sort/editable-title handling. Selecting a cell in
// the column still works (and -Col uses that), so this is a convenience gap, not a
// blocker. Pinned with test.fail so it flips green the moment it's fixed.
test.fail("clicking a column header selects the whole column", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n3,4\r\n");
    await page.locator('.tabulator-col[tabulator-field="c0"]').click();
    expect(await page.evaluate(() => table.getRanges()[0].getData())).toEqual([{ c0: "1" }, { c0: "3" }]);
});
