const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const S = require('../resources/js/steam.js');

const mockFs = {
  getStats: async (p) => { const s = fs.statSync(p); return { size: s.size }; },
  readDirectory: async (p) => fs.readdirSync(p, { withFileTypes: true }).map(e => ({
    entry: e.name, path: path.join(p, e.name), type: e.isDirectory() ? 'DIRECTORY' : 'FILE' })),
  readFile: async (p) => fs.readFileSync(p, 'utf8'),
  readBinaryFile: async (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
};

const steam = fs.mkdtempSync(path.join(os.tmpdir(), 'steam-'));
const w = (rel, data) => { const f = path.join(steam, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, data); };
w('steam.exe', 'x');
w('config/loginusers.vdf', `"users"
{
\t"76561197961265728"
\t{
\t\t"AccountName"\t\t"oldlogin"
\t\t"PersonaName"\t\t"Old Account"
\t\t"MostRecent"\t\t"0"
\t}
\t"76561197962265728"
\t{
\t\t"AccountName"\t\t"mainlogin"
\t\t"PersonaName"\t\t"Main Account"
\t\t"MostRecent"\t\t"1"
\t}
}`);
const header = Buffer.from([0,115,104,111,114,116,99,117,116,115,0,8,8]);
w('userdata/1000000/config/shortcuts.vdf', header);
w('userdata/2000000/config/localconfig.vdf', 'x');
w('userdata/0/config/x.vdf', 'x');
w('userdata/ac/x.txt', 'x');
w('userdata/3000000/config/shortcuts.vdf', 'lixo');

(async () => {
  const REG_OUT = '\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n\r\n';
  assert.strictEqual(S.parseRegValue(REG_OUT), 'c:/program files (x86)/steam');
  assert.strictEqual(S.parseRegValue('ERROR: The system was unable to find the specified registry key'), null);
  console.log('ok 1 - lê o caminho da Steam da saída do registro (e reconhece erro)');

  const mockOs = {
    execCommand: async (cmd) => cmd.includes('HKCU')
      ? { stdOut: '    SteamPath    REG_SZ    /caminho/que/nao/existe\n' }
      : { stdOut: `    InstallPath    REG_SZ    ${steam}\n` },
    getEnv: async () => { throw new Error('no env'); },
  };
  assert.strictEqual(await S.findSteamPath(mockOs, mockFs), steam);
  console.log('ok 2 - descarta caminho inexistente do registro e usa a próxima chave');
  assert.strictEqual(await S.findSteamPath({ execCommand: async () => ({ stdOut: '' }), getEnv: async () => '' }, mockFs), null);
  console.log('ok 3 - Steam não instalada: devolve null (a interface pede para escolher a pasta)');

  const users = await S.getSteamUsers(steam, mockFs);
  assert.deepStrictEqual(users.map((u) => u.accountId), ['2000000', '1000000', '3000000']);
  assert.strictEqual(users[0].name, 'Main Account'); assert.strictEqual(users[0].mostRecent, true);
  console.log('ok 4 - contas listadas com a mais recente primeiro; pastas "0" e "ac" ignoradas');
  assert.strictEqual(users[2].name, 'User 3000000');
  console.log('ok 5 - conta sem nome no loginusers.vdf usa o número como nome');
  assert.strictEqual(users[0].shortcutsExists, false); assert.strictEqual(users[1].shortcutsExists, true);
  console.log('ok 6 - detecta quais contas já têm shortcuts.vdf');
  assert.strictEqual((await S.readShortcutsFile(users[1].shortcutsPath, mockFs)).validHeader, true);
  assert.strictEqual((await S.readShortcutsFile(users[2].shortcutsPath, mockFs)).validHeader, false);
  console.log('ok 7 - confere o cabeçalho binário do shortcuts.vdf');
  console.log('\nTodos os testes passaram.');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
