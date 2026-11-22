import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const files = ['manifest.json', 'background.js', 'popup.html', 'popup.js'];

for (const f of files) {
  const full = path.join(__dirname, f);
  if (!fs.existsSync(full)) {
    throw new Error(`Missing extension file: ${full}`);
  }
}

const outXpi = path.join(__dirname, 'kevin-os-thunderbird-bridge.xpi');
const webDownloadDir = path.join(repoRoot, 'web', 'public', 'downloads');
const webXpi = path.join(webDownloadDir, 'kevin-os-thunderbird-bridge.xpi');
const tempZip = path.join(__dirname, 'kevin-os-thunderbird-bridge.zip');

fs.mkdirSync(webDownloadDir, { recursive: true });
for (const p of [outXpi, webXpi, tempZip]) {
  if (fs.existsSync(p)) fs.unlinkSync(p);
}

if (process.platform === 'win32') {
  const psFiles = files.map((f) => `'${path.join(__dirname, f)}'`).join(',');
  execSync(
    `powershell -NoProfile -Command "Compress-Archive -Path ${psFiles} -DestinationPath '${tempZip}' -Force"`,
    { stdio: 'inherit' }
  );
  fs.renameSync(tempZip, outXpi);
} else {
  execSync(`zip -j "${outXpi}" ${files.map((f) => `"${path.join(__dirname, f)}"`).join(' ')}`, {
    stdio: 'inherit',
  });
}

fs.copyFileSync(outXpi, webXpi);
console.log(`Built Thunderbird add-on:`);
console.log(`  1) ${outXpi}`);
console.log(`  2) ${webXpi}`);
