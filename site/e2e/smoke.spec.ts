import { test, expect } from '@playwright/test'

test('home renders the front door', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toContainText('shared knowledge')
  await expect(page.locator('text=biomes')).toBeVisible()
})
test('⌘K opens the palette', async ({ page }) => {
  await page.goto('/')
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.locator('#kc-palette')).toBeVisible()
})
test('graph explorer mounts webgl canvas', async ({ page }) => {
  await page.goto('/graph/')
  await expect(page.locator('#gx-canvas canvas').first()).toBeVisible({ timeout: 15000 })
})
test('a note page shows three zones', async ({ page }) => {
  await page.goto('/')
  const first = page.locator('.tended a').first()
  await first.click()
  await expect(page.locator('article h1')).toBeVisible()
  await expect(page.locator('.kc-aside')).toBeVisible()
  await page.keyboard.press('[')
  await expect(page.locator('.kc-filetree .panel')).toBeVisible()
})
