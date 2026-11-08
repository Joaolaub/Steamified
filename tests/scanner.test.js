const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const { scanGamesFolder } = require('../resources/js/scanner.js');

const mock = {
  readDirectory: async (p) => fs.readdirSync(p, { withFileTypes: true }).map((e) => ({
    entry: e.name, path: path.join(p, e.name), type: e.isDirectory() ? 'DIRECTORY' : 'FILE' })),
  getStats: async (p) => ({ size: fs.statSync(p).size }),
};

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'games-'));
const mk = (rel, size = 10) => { const f = path.join(root, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, Buffer.alloc(size)); };

mk('Hollow Knight/hollow_knight.exe', 5000);
mk('Hollow Knight/UnityCrashHandler64.exe', 9000);
mk('Hollow Knight/unins000.exe', 8000);
mk('Celeste/Celeste.exe', 3000);
mk('Celeste/_CommonRedist/vcredist/vc_redist.x64.exe', 99999);
mk('Celeste/Mods/helper.exe', 100);
mk('Some Unreal Game/SomeUnrealGame.exe', 200);
mk('Some Unreal Game/Engine/Binaries/Win64/CrashReportClient.exe', 500);
mk('Some Unreal Game/SomeUnrealGame/Binaries/Win64/SomeUnrealGame-Win64-Shipping.exe', 90000);
mk('Only Installers/setup.exe', 50);
mk('Docs/readme.txt', 5);
mk('Loose Game.exe', 700);
mk('Deep/a/b/c/d/toodeep.exe', 10);
mk('Deep/a/b/ok.exe', 10);

(async () => {
  const games = await scanGamesFolder(root, mock);
  const found = Object.fromEntries(games.map((g) => [g.name, path.relative(root, g.exePath)]));

  assert.deepStrictEqual(Object.keys(found).sort(), ['Celeste', 'Deep', 'Hollow Knight', 'Loose Game', 'Some Unreal Game']);
  console.log('ok 1 - pastas sem jogo (só instalador, só documentos) são omitidas');
  assert.strictEqual(found['Hollow Knight'], path.join('Hollow Knight', 'hollow_knight.exe'));
  assert.strictEqual(found['Celeste'], path.join('Celeste', 'Celeste.exe'));
  console.log('ok 2 - ignora crash handler, desinstalador e redistribuíveis; escolhe o executável certo');
  assert.strictEqual(found['Some Unreal Game'], path.join('Some Unreal Game', 'SomeUnrealGame.exe'));
  console.log('ok 3 - jogo Unreal: usa o executável da raiz e ignora a pasta Engine');
  assert.strictEqual(found['Loose Game'], 'Loose Game.exe');
  console.log('ok 4 - .exe solto na raiz conta como um jogo');
  assert.strictEqual(found['Deep'], path.join('Deep', 'a', 'b', 'ok.exe'));
  console.log('ok 5 - respeita a profundidade máxima de busca');
  assert.strictEqual(games.find((g) => g.name === 'Celeste').candidates.length, 2);
  console.log('ok 6 - guarda os outros executáveis como alternativas');
  console.log('\nTodos os testes passaram.');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
