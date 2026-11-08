const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const configPath = path.join(root, 'neutralino.config.json');
const original = fs.readFileSync(configPath, 'utf8');

const config = JSON.parse(original);
config.modes.window.enableInspector = false;
config.logging.writeToLogFile = false;

let status = 1;
try {
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  status = spawnSync('neu', ['build'], { cwd: root, stdio: 'inherit', shell: true }).status;
} finally {
  fs.writeFileSync(configPath, original);
}
if (status !== 0) {
  console.error('\n"neu build" falhou. Confira se o neu está instalado: npm install -g @neutralinojs/neu');
  process.exit(status || 1);
}

const binaryName = config.cli.binaryName;
const exeName = `${binaryName}-win_x64.exe`;
const appDir = path.join(root, 'dist', binaryName);
const outDir = path.join(root, 'dist', 'Steamified-win_x64');

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const file of [exeName, 'resources.neu']) {
  fs.copyFileSync(path.join(appDir, file), path.join(outDir, file));
}
for (const file of ['README.md', 'THIRD_PARTY_NOTICES.txt', 'LICENSE']) {
  fs.copyFileSync(path.join(root, file), path.join(outDir, file));
}

console.log(`\nPronto: ${outDir}`);
console.log(`Para distribuir, compacte essa pasta em .zip. Para abrir o app: ${exeName}`);
