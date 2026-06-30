const fs = require('fs');
const { execSync } = require('child_process');
const path = require('path');

const pkg = require('../package.json');

function safe(cmd, fallback = '') {
  try {
    return execSync(cmd, { encoding: 'utf8' }).trim();
  } catch {
    return fallback;
  }
}

const version = {
  version: pkg.version,
  commit: safe('git rev-parse HEAD'),
  date: new Date().toISOString(),
//   electron: process.versions.electron || '',
//   electronBuildId: process.env.ELECTRON_BUILD_ID || '',
//   chromium: process.versions.chrome || '',
//   node: process.versions.node || process.version.replace(/^v/, ''),
//   v8: process.versions.v8 || ''
};
/*
fs.writeFileSync(
  path.join(__dirname, '..', 'version.json'),
  JSON.stringify(version, null, 2) + '\n'
);
*/