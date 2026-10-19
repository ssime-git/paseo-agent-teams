// This is the only client module allowed to access browser APIs.
export async function copyConfiguration(text: string) {
  const browser = globalThis as unknown as { navigator?: { clipboard?: { writeText(text: string): Promise<void> } } };
  if (!browser.navigator?.clipboard) throw new Error('Select and copy the configuration text below.');
  await browser.navigator.clipboard.writeText(text);
}
