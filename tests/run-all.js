const { spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');

let hasJsdom = true;
try { require.resolve('jsdom'); } catch (e) { hasJsdom = false; }

const files = fs.readdirSync(__dirname).filter((f) => f.endsWith('.test.js')).sort();
let failed = 0;

for (const file of files) {
  if (file === 'ui.test.js' && !hasJsdom) {
    console.log(`PULADO  ${file} (rode "npm install" para instalar o jsdom)`);
    continue;
  }
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { encoding: 'utf8' });
  const lines = (result.stdout || '').split('\n').filter((l) => /^ok \d+/.test(l)).length;
  if (result.status === 0) {
    console.log(`OK      ${file} (${lines} verificações)`);
  } else {
    failed++;
    console.log(`FALHOU  ${file}\n${result.stdout}\n${result.stderr}`);
  }
}
console.log(failed === 0 ? '\nTodos os testes passaram.' : `\n${failed} arquivo(s) de teste falharam.`);
process.exit(failed === 0 ? 0 : 1);
