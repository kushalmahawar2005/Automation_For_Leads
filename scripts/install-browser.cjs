const { execFileSync } = require('node:child_process');
const { accessSync, constants } = require('node:fs');

const executable = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROME_PATH || process.env.CHROMIUM_PATH;
if (executable) {
  accessSync(executable, constants.X_OK);
  console.log('Using configured system Chrome.');
} else {
  execFileSync(process.execPath, [require.resolve('puppeteer/lib/cjs/puppeteer/node/cli.js'), 'browsers', 'install', 'chrome'], {
    stdio: 'inherit',
  });
}
