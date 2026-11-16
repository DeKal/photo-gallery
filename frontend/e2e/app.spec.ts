import { test, expect } from "@playwright/test";
import path from "path";

// Absolute path to the backend fixture folder. Playwright runs with cwd set to
// this `frontend/` directory, so resolve the sibling backend folder from there.
const FIXTURES = path.resolve(process.cwd(), "../backend/tests/fixtures");

test("photo clustering UI end-to-end", async ({ page }) => {
  await page.goto("/");

  // 1. Drive a real scan through the UI: type the fixtures path, click Scan.
  await page.getByTestId("scan-input").fill(FIXTURES);
  await page.getByTestId("scan-btn").click();

  // 2. Wait for scan + clustering to fully complete. The status pill only
  //    reads "completed" once the scan finished AND clustering returned (which
  //    is also when the People/Similar views refresh). Long timeout covers the
  //    cold model load on first use.
  await expect(page.getByTestId("scan-status")).toHaveText("completed", {
    timeout: 180_000,
  });

  // 3. People tab (default): at least one person card is visible.
  const personCard = page.getByTestId("person-card").first();
  await expect(personCard).toBeVisible();

  // 4. Open a person -> detail photo grid shows >= 1 thumbnail.
  await personCard.click();
  await expect(page.locator(".grid img.thumb").first()).toBeVisible();

  // 5. Rename the person to "E2E Person" and Save; verify it persists on the
  //    People grid (card title reflects the new name after navigating back).
  await page.getByTestId("person-name-input").fill("E2E Person");
  await page.getByTestId("person-save-btn").click();
  await page.getByRole("button", { name: /Back/ }).click();
  await expect(page.getByText("E2E Person").first()).toBeVisible();

  // 6. Similar tab: >= 1 sim-cluster card.
  await page.getByRole("button", { name: "Similar" }).click();
  const simCard = page.getByTestId("sim-cluster-card").first();
  await expect(simCard).toBeVisible();

  // Open the cluster -> photos, then a photo -> "More like this" results grid.
  await simCard.click();
  const clusterPhoto = page.getByTestId("cluster-photo").first();
  await expect(clusterPhoto).toBeVisible();
  await clusterPhoto.click();

  const moreLikeThis = page.getByTestId("more-like-this");
  await expect(moreLikeThis).toBeVisible();
  await expect(moreLikeThis.locator("img").first()).toBeVisible();
});
