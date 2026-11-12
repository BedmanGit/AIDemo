import { expect, test } from '@playwright/test';

test('connects, interrupts playback, mutes and disconnects', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.stop = function (...args) {
      (window as unknown as { playbackStops: number }).playbackStops = ((window as unknown as { playbackStops: number }).playbackStops || 0) + 1;
      return stop.apply(this, args);
    };
    const stopTrack = MediaStreamTrack.prototype.stop;
    MediaStreamTrack.prototype.stop = function () {
      (window as unknown as { trackStops: number }).trackStops = ((window as unknown as { trackStops: number }).trackStops || 0) + 1;
      return stopTrack.call(this);
    };
  });
  await page.route('**/api/health', (route) => route.fulfill({ json: { ok: true, configured: true, searchConfigured: true } }));
  let audioEnd = false;
  let startedModel = '';
  await page.routeWebSocket('**/api/live', (socket) => {
    socket.onMessage((raw) => {
      const message = JSON.parse(String(raw));
      if (message.type === 'start') {
        startedModel = message.model;
        socket.send(JSON.stringify({ type: 'ready' }));
        socket.send(JSON.stringify({ type: 'transcript', speaker: 'user', text: 'Hello there.', finished: true }));
        socket.send(JSON.stringify({ type: 'transcript', speaker: 'assistant', text: 'Hello back.', finished: true }));
        socket.send(JSON.stringify({ type: 'audio', data: Buffer.alloc(48000 * 2).toString('base64') }));
        setTimeout(() => socket.send(JSON.stringify({ type: 'interrupted' })), 400);
      }
      if (message.type === 'audio-end') audioEnd = true;
    });
  });
  await page.goto('/');
  await page.screenshot({ path: testInfo.outputPath('studio.png'), fullPage: true });
  await expect(page.getByRole('heading', { name: /Voice studio/ })).toBeVisible();
  await expect(page.getByText('Tavily', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start conversation' })).toBeEnabled();
  const modelOptions = await page.locator('#root select option').evaluateAll((options) => options.map((option) => ({
    value: (option as HTMLOptionElement).value,
    label: (option as HTMLOptionElement).textContent?.trim(),
  })));
  expect(modelOptions).toEqual([
    { value: 'gemini-3.8-live', label: 'Gemini 3.8 Live · Free tier' },
    { value: 'gemini-3.8-live-extended-thinking', label: 'Gemini 3.8 Live Extended Thinking · Free tier' },
    { value: 'gemini-3.1-flash-live-preview', label: 'Gemini 3.1 Flash Live · Free tier (Preview)' },
    { value: 'gemini-2.5-flash-native-audio-preview-12-2025', label: 'Gemini 2.5 Flash Live · Free tier (Legacy preview)' },
  ]);
  expect(modelOptions.every((option) => option.label?.includes('Free tier'))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('AI model').selectOption('gemini-3.8-live-extended-thinking');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.getByText('Hello there.')).toBeVisible();
  await expect(page.getByText('Hello back.')).toBeVisible();
  expect(startedModel).toBe('gemini-3.8-live-extended-thinking');
  await expect.poll(() => page.evaluate(() => (window as unknown as { playbackStops?: number }).playbackStops ?? 0)).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Mute microphone' }).click();
  await expect.poll(() => audioEnd).toBe(true);
  await page.getByRole('button', { name: 'Unmute microphone' }).click();
  await expect(page.getByRole('button', { name: 'End session' })).toBeEnabled();
  await page.getByRole('button', { name: 'End session' }).click();
  await expect(page.getByText('Not connected')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start conversation' })).toBeEnabled();
  await expect.poll(() => page.evaluate(() => (window as unknown as { trackStops?: number }).trackStops ?? 0)).toBeGreaterThan(0);
});

test('shows microphone permission errors', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
  });
  await page.route('**/api/health', (route) => route.fulfill({ json: { ok: true, configured: true, searchConfigured: false } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'Start conversation' }).click();
  await expect(page.getByRole('status')).toContainText('Microphone access was denied');
});