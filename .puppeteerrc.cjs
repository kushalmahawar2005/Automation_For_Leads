const { join } = require('node:path');

// Keep Chrome with the app when hosting moves builds into a runtime directory.
module.exports = {
  cacheDirectory: join(__dirname, 'node_modules', 'puppeteer', '.local-browsers'),
};
