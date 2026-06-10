const { test, expect } = require("@playwright/test");
const { openGrid, csvOut, dirtyNow } = require("./helpers");

async function openFind(page) {
    await page.locator("#findBtn").click();
    await page.locator("#findPanel").waitFor({ state: "visible" });
}

async function replaceAll(page, find, repl, matchCase = false) {
    await openFind(page);
    await page.fill("#search", find);
    await page.fill("#replace", repl);
    if (matchCase) await page.check("#matchCase");
    await page.getByRole("button", { name: "Replace All" }).click();
}

test("Replace All replaces across all cells (case-insensitive)", async ({ page }) => {
    await openGrid(page, "A,B\r\nfoo,FOObar\r\nbaz,foo\r\n");
    await replaceAll(page, "foo", "X");
    await page.waitForFunction(() => getCsv().toLowerCase().indexOf("foo") === -1);
    expect(await csvOut(page)).toBe("A,B\r\nX,Xbar\r\nbaz,X\r\n");
    expect(await dirtyNow(page)).toBe(true);
});

test("Replace All respects match-case", async ({ page }) => {
    await openGrid(page, "A\r\nfoo\r\nFOO\r\n");
    await replaceAll(page, "foo", "X", true);
    await page.waitForFunction(() => getCsv().indexOf("X") !== -1);
    expect(await csvOut(page)).toBe("A\r\nX\r\nFOO\r\n"); // only the lowercase match
});

test("Replace All with an empty Find does nothing", async ({ page }) => {
    await openGrid(page, "A\r\nfoo\r\n");
    await openFind(page);
    await page.fill("#replace", "X");
    await page.getByRole("button", { name: "Replace All" }).click();
    expect(await csvOut(page)).toBe("A\r\nfoo\r\n");
    expect(await dirtyNow(page)).toBe(false);
});

test("Ctrl+F opens the find panel and Esc closes it", async ({ page }) => {
    await openGrid(page, "A\r\n1\r\n");
    await expect(page.locator("#findPanel")).toBeHidden();
    await page.keyboard.press("Control+f");
    await expect(page.locator("#findPanel")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#findPanel")).toBeHidden();
});

test("Replace All clears the find filter so results stay visible", async ({ page }) => {
    await openGrid(page, "A\r\nfoo\r\nbar\r\n");
    await replaceAll(page, "foo", "baz");
    await page.waitForFunction(() => table.getDataCount("active") === 2); // nothing filtered out
    expect(await page.inputValue("#search")).toBe("");
});
