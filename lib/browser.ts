import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';

export function browserExecutablePath(): string {
  const configured = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || process.env.CHROMIUM_PATH;
  if (configured) return configured;

  const executable = puppeteer.executablePath();
  // Some deployment packagers copy browser files without their executable bit.
  // Restore owner execute only on the bundled browser and its crash handler.
  if (process.platform === 'linux') {
    for (const file of [executable, path.join(path.dirname(executable), 'chrome_crashpad_handler')]) {
      if (!fs.existsSync(file)) continue;
      const mode = fs.statSync(file).mode;
      if (!(mode & 0o100)) fs.chmodSync(file, mode | 0o100);
    }
  }
  return executable;
}
