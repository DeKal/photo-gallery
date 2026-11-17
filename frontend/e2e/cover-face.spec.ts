import { test, expect } from "@playwright/test";

// Cover-face picker: open a person, pick a different cover face, verify the
// highlight moves, then restore the original selection.
test("pick an alternative cover face", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("person-card").first().click();
  const picker = page.getByTestId("face-picker");
  await expect(picker).toBeVisible();
  await page.screenshot({ path: "/tmp/face_picker.png" });

  const chips = picker.getByTestId("face-chip");
  await expect(chips.first()).toBeVisible();

  // The originally-selected cover chip.
  const original = picker.locator(".face-chip.is-cover");
  await expect(original).toHaveCount(1);

  // Pick a different chip (the 3rd) and verify exactly it becomes the cover.
  const pick = chips.nth(2);
  await pick.click();
  await expect(pick).toHaveClass(/is-cover/);
  await expect(picker.locator(".face-chip.is-cover")).toHaveCount(1);
  await page.screenshot({ path: "/tmp/face_picker_changed.png" });

  // Restore: pick the first chip back as cover.
  await chips.first().click();
  await expect(chips.first()).toHaveClass(/is-cover/);
});
