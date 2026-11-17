import { test, expect } from "@playwright/test";

// Focused check for the person hide/unhide feature against the LIVE dataset.
// Does not scan (no data mutation beyond the hide it performs and reverts).
test("hide then unhide a person", async ({ page }) => {
  await page.goto("/");

  const firstCard = page.getByTestId("person-card").first();
  await expect(firstCard).toBeVisible();

  const countBefore = await page.getByTestId("person-card").count();

  // Hover reveals the Hide pill; click it.
  await firstCard.hover();
  const hideBtn = firstCard.getByTestId("person-hide-btn");
  await expect(hideBtn).toHaveText("Hide");
  await page.screenshot({ path: "/tmp/people_hover_hide.png" });
  await hideBtn.click();

  // Card leaves the default grid.
  await expect
    .poll(() => page.getByTestId("person-card").count())
    .toBe(countBefore - 1);

  // Show hidden -> the hidden card reappears (muted) with an Unhide pill.
  await page.getByRole("button", { name: "Show hidden" }).click();
  const hiddenCard = page.locator(".card.is-hidden").first();
  await expect(hiddenCard).toBeVisible();
  await page.screenshot({ path: "/tmp/people_show_hidden.png" });

  // Unhide to restore original state.
  await hiddenCard.getByTestId("person-hide-btn").click();
  await expect(page.locator(".card.is-hidden")).toHaveCount(0);
});
