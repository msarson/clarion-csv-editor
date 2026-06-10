const { test, expect } = require("@playwright/test");
const { openGrid, csvOut, cell } = require("./helpers");

// Right-click a cell, then click the menu item whose label contains `label`.
async function cellMenu(page, row, field, label) {
    await cell(page, row, field).click({ button: "right" });
    await page.locator(".tabulator-menu .tabulator-menu-item", { hasText: label }).click();
}

test("right-click a cell shows row/column actions", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n3,4\r\n");
    await cell(page, 0, "c0").click({ button: "right" });
    const items = page.locator(".tabulator-menu .tabulator-menu-item");
    await expect(items.filter({ hasText: "Insert row below" })).toBeVisible();
    await expect(items.filter({ hasText: "Duplicate row" })).toBeVisible();
    await expect(items.filter({ hasText: "Delete column" })).toBeVisible();
});

test("Insert row below adds a blank row after the clicked row", async ({ page }) => {
    await openGrid(page, "A\r\nx\r\ny\r\n");
    await cellMenu(page, 0, "c0", "Insert row below");
    await page.waitForFunction(() => table.getDataCount() === 3);
    expect(await csvOut(page)).toBe("A\r\nx\r\n\r\ny\r\n");
});

test("Insert row above adds a blank row before the clicked row", async ({ page }) => {
    await openGrid(page, "A\r\nx\r\ny\r\n");
    await cellMenu(page, 1, "c0", "Insert row above"); // above 'y'
    await page.waitForFunction(() => table.getDataCount() === 3);
    expect(await csvOut(page)).toBe("A\r\nx\r\n\r\ny\r\n");
});

test("Duplicate row copies it directly below", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n3,4\r\n");
    await cellMenu(page, 0, "c0", "Duplicate row");
    await page.waitForFunction(() => table.getDataCount() === 3);
    expect(await csvOut(page)).toBe("A,B\r\n1,2\r\n1,2\r\n3,4\r\n");
});

test("Delete row removes the clicked row", async ({ page }) => {
    await openGrid(page, "A\r\nx\r\ny\r\n");
    await cellMenu(page, 0, "c0", "Delete row");
    await page.waitForFunction(() => table.getDataCount() === 1);
    expect(await csvOut(page)).toBe("A\r\ny\r\n");
});

test("Delete column (cell menu) removes the clicked cell's column", async ({ page }) => {
    await openGrid(page, "A,B,C\r\n1,2,3\r\n");
    await cellMenu(page, 0, "c1", "Delete column");
    await page.waitForFunction(() => headers.length === 2);
    expect(await csvOut(page)).toBe("A,C\r\n1,3\r\n");
});

test("header context menu renames a column", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n");
    await page.locator('.tabulator-col[tabulator-field="c0"] .tabulator-col-title').click({ button: "right" });
    await page.locator(".tabulator-menu .tabulator-menu-item", { hasText: "Rename column" }).click();
    await page.locator("input.col-title-editor").fill("Name");
    await page.keyboard.press("Enter");
    await page.waitForFunction(() => headers[0] === "Name");
    expect(await csvOut(page)).toBe("Name,B\r\n1,2\r\n");
});

test("Paste via the menu fills from the clipboard", async ({ page }) => {
    await openGrid(page, "A,B\r\n1,2\r\n3,4\r\n");
    await page.evaluate(() => navigator.clipboard.writeText("9\t8"));
    await cellMenu(page, 0, "c0", "Paste");
    await page.waitForFunction(() => getCsv().indexOf("9,8") !== -1);
    expect(await csvOut(page)).toBe("A,B\r\n9,8\r\n3,4\r\n");
});
