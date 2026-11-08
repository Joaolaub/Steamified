const { JSDOM } = require('jsdom');
const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const ROOT = path.join(__dirname, '..', 'resources');
const KEY = 'k'.repeat(32);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-'));
const steam = path.join(base, 'Steam'), games = path.join(base, 'Games');
const cfg = path.join(steam, 'userdata', '1000000', 'config');
const w = (p, data = 'x') => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, data); };
w(path.join(steam, 'steam.exe'));
w(path.join(steam, 'config', 'loginusers.vdf'), '"users"\n{\n\t"76561197961265728"\n\t{\n\t\t"AccountName"\t"acc"\n\t\t"PersonaName"\t"Tester"\n\t\t"MostRecent"\t"1"\n\t}\n}');
const z = (s) => Buffer.concat([Buffer.from(s), Buffer.from([0])]);
const str = (k, v) => Buffer.concat([Buffer.from([1]), z(k), z(v)]);
const int = (k, n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return Buffer.concat([Buffer.from([2]), z(k), b]); };
const OLD_ID = 0xC0FFEE01;
const fnfExe = path.join(games, 'FridayNightFunkin', 'Funkin.exe');
const original = Buffer.concat([Buffer.from([0]), z('shortcuts'), Buffer.from([0]), z('0'), int('appid', OLD_ID | 0),
  str('AppName', 'FridayNightFunkin'), str('Exe', `"${fnfExe}"`), str('icon', ''), Buffer.from([8, 8, 8])]);
w(path.join(cfg, 'shortcuts.vdf'), original);
w(fnfExe, 'exe'); w(path.join(games, 'Hollow_Knight (v1.5)', 'hollow_knight.exe'), 'exe');
w(path.join(games, 'Mystery Game', 'mystery.exe'), 'exe'); w(path.join(games, 'RoboRacers', 'RoboRacers.exe'), 'exe');
w(path.join(games, 'Celeste', 'Celeste.exe'), 'a'.repeat(50)); w(path.join(games, 'Celeste', 'bin', 'Celeste64.exe'), 'b'.repeat(10));

const CATALOG = ["Friday Night Funkin'", 'Hollow Knight', 'RoboRacer', 'Hades', 'Celeste'];
const searches = [];
const sgdbFetch = async (url, init = {}) => {
  const j = (o, s = 200) => ({ status: s, ok: s < 300, text: async () => JSON.stringify(o) });
  if (url.startsWith('https://cdn')) return { status: 200, ok: true, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) };
  if ((init.headers || {}).Authorization !== 'Bearer ' + KEY) return j({ success: false }, 401);
  if (url.includes('/search/autocomplete/')) {
    const q = decodeURIComponent(url.split('/autocomplete/')[1]).toLowerCase(); searches.push(q);
    return j({ success: true, data: CATALOG.map((name, i) => ({ id: i + 1, name, verified: true })).filter((g) => g.name.toLowerCase().includes(q)) });
  }
  const kind = /\/(grids|heroes|logos|icons)\//.exec(url)[1];
  return j({ success: true, data: [{ url: `https://cdn2.steamgriddb.com/${kind}/${kind}.png` }] });
};

const dom = new JSDOM(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[^>]*><\/script>/g, ''), { runScripts: 'outside-only', pretendToBeVisual: true });
const win = dom.window, doc = win.document;
const store = {}; const dialogs = []; const folderQueue = [games];
const stat = (p) => { const s = fs.statSync(p); return { size: s.size }; };
win.NL_OS = 'Linux'; win.NL_ARCH = 'x64'; win.NL_VERSION = 'test'; win.NL_APPID = 'test'; win.NL_APPVERSION = '0'; win.NL_PATH = '/';
win.TextEncoder = TextEncoder; win.TextDecoder = TextDecoder; win.fetch = sgdbFetch;
win.Neutralino = {
  init() {}, events: { on() {} }, app: { exit() {} },
  os: {
    showFolderDialog: async () => folderQueue.shift(),
    showMessageBox: async (title, text) => { dialogs.push(text); return 'YES'; },
    execCommand: async (cmd) => ({ stdOut: cmd.includes('HKCU') ? `    SteamPath    REG_SZ    ${steam}\n` : '', exitCode: 0 }),
    getEnv: async () => { throw new Error('no'); }, open() {},
  },
  filesystem: {
    getStats: async (p) => stat(p),
    readDirectory: async (p) => fs.readdirSync(p, { withFileTypes: true }).map((e) => ({ entry: e.name, path: path.join(p, e.name), type: e.isDirectory() ? 'DIRECTORY' : 'FILE' })),
    readFile: async (p) => fs.readFileSync(p, 'utf8'),
    readBinaryFile: async (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
    writeBinaryFile: async (p, ab) => fs.writeFileSync(p, Buffer.from(ab)),
    createDirectory: async (p) => fs.mkdirSync(p, { recursive: true }), remove: async (p) => fs.rmSync(p),
  },
  storage: { getData: async (k) => { if (!(k in store)) throw new Error('none'); return store[k]; }, setData: async (k, v) => { if (v === null) delete store[k]; else store[k] = v; } },
};
for (const f of ['steam.js', 'steamgriddb.js', 'scanner.js', 'app.js']) win.eval(fs.readFileSync(path.join(ROOT, 'js', f), 'utf8'));

const $ = (id) => doc.getElementById(id);
const waitFor = async (cond, what, ms = 8000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('timeout: ' + what); await new Promise((r) => setTimeout(r, 15)); } };
const idle = () => waitFor(() => !doc.body.classList.contains('busy'), 'busy off');
const rows = () => [...doc.querySelectorAll('#games-list > li')];
const row = (folder) => rows().find((li) => li.textContent.includes(folder) || li.querySelector('.game-name-input').value.includes(folder));
const nameOf = (li) => li.querySelector('.game-name-input').value;
const matchOf = (li) => li.querySelector('.game-match').textContent;
const type = (input, text) => { input.value = text; input.dispatchEvent(new win.Event('input', { bubbles: true })); };
const parseVdf = (p) => win.parseVdf(new win.Uint8Array(fs.readFileSync(p)))[0].value.map((e) => Object.fromEntries(e.value.map((f) => [f.key, f.value])));
let n = 0; const ok = (m) => console.log(`ok ${++n} - ${m}`);

(async () => {
  await waitFor(() => /Steam folder/.test($('steam-path').textContent) && /found/.test($('steam-shortcuts').textContent), 'steam');
  assert(/Tester/.test($('steam-user').textContent)); ok('Steam e conta detectadas ao iniciar');

  $('sgdb-key').value = KEY; $('btn-save-key').click(); await waitFor(() => /ends with kkkk/.test($('sgdb-status').textContent), 'chave'); ok('chave salva e validada');

  $('btn-pick-folder').click();
  await waitFor(() => rows().length === 5, 'linhas'); await idle();
  assert.strictEqual(rows().length, 5); ok('5 jogos detectados');

  const fnf = row('FridayNightFunkin'), hk = row('Hollow Knight'), my = row('Mystery'), rr = row('RoboRacer'), ce = row('Celeste');
  assert.strictEqual(nameOf(hk), 'Hollow Knight'); assert(/SteamGridDB: Hollow Knight/.test(matchOf(hk))); ok('"Hollow_Knight (v1.5)" -> nome oficial "Hollow Knight" automaticamente');
  assert.strictEqual(nameOf(my), 'Mystery Game'); assert(/Not found/.test(matchOf(my))); ok('jogo desconhecido: nome mantido e marcado "Not found"');
  assert.strictEqual(nameOf(rr), 'RoboRacers'); assert(/Similar match.*RoboRacer"/.test(matchOf(rr))); ok('correspondência aproximada: NÃO renomeia sozinho, só sugere');
  assert(/Already in Steam as "FridayNightFunkin"/.test(matchOf(fnf))); assert(fnf.querySelector('.game-name-input').disabled); assert.strictEqual(fnf.querySelector('input[type=checkbox]').checked, false); ok('o FridayNightFunkin que já está na Steam: marcado, nome travado e desmarcado');
  assert(/different name/.test($('status').textContent) && /Friday Night Funkin'/.test($('status').textContent)); ok('aviso explica que a Steam mantém o nome antigo e como refazer');
  assert.strictEqual(ce.querySelectorAll('select option').length, 2); ok('Celeste com 2 executáveis: seletor mostra as 2 opções');
  assert(searches.length < 30); ok(`busca no SteamGridDB feita (${searches.length} requisições no total)`);

  const before = searches.length;
  my.querySelector('.game-main button').click();
  const picker = my.querySelector('.game-picker'); assert.strictEqual(picker.hidden, false);
  type(picker.querySelector('input'), 'Hades'); picker.querySelector('button').click();
  await waitFor(() => picker.querySelector('.picker-results button'), 'resultados');
  [...picker.querySelectorAll('.picker-results button')].find((b) => /Hades/.test(b.textContent)).click();
  assert.strictEqual(nameOf(my), 'Hades'); assert(/manual/.test(matchOf(my))); ok('Fix match: escolher "Hades" troca o nome para o oficial');

  const count = () => rows().filter((li) => li.querySelector('input[type=checkbox]').checked).length;
  assert.strictEqual(count(), 4); assert(/Add 4 games/.test($('btn-apply').textContent));
  $('btn-apply').click(); await waitFor(() => /game\(s\) added/.test($('status').textContent), 'aplicar'); await idle();
  assert(/Backup saved/.test($('status').textContent)); ok(`aplicado: "${$('status').textContent.split('.')[0]}."`);

  const list = parseVdf(path.join(cfg, 'shortcuts.vdf')); const names = list.map((e) => e.AppName);
  assert.deepStrictEqual([...names].sort(), ['Celeste', 'FridayNightFunkin', 'Hades', 'Hollow Knight', 'RoboRacers']); ok('shortcuts.vdf: nomes oficiais nos novos; "FridayNightFunkin" antigo intacto');
  assert(!names.includes('Mystery Game')); ok('o nome do jogo corrigido à mão ("Hades") foi usado no lugar de "Mystery Game"');
  const old = list.find((e) => e.AppName === 'FridayNightFunkin'); assert.strictEqual(old.appid >>> 0, OLD_ID); ok('atalho existente: appid original preservado');
  const grid = fs.readdirSync(path.join(cfg, 'grid')); const hkId = list.find((e) => e.AppName === 'Hollow Knight').appid >>> 0;
  assert(grid.includes(`${hkId}p.png`) && grid.includes(`${hkId}_hero.png`) && grid.includes(`${hkId}_icon.png`)); assert(list.find((e) => e.AppName === 'Hollow Knight').icon.endsWith(`${hkId}_icon.png`)); ok('artes nomeadas com o appid do atalho e ícone gravado');
  assert(fs.readFileSync(path.join(cfg, 'shortcuts.vdf.original.bak')).equals(original)); ok('backup .original.bak idêntico ao arquivo original');
  assert(/Add 0 games/.test($('btn-apply').textContent) && $('btn-apply').disabled); ok('depois de aplicar: todos "já na Steam", nada marcado, botão desabilitado');

  folderQueue.push(games); $('btn-pick-folder').click(); await waitFor(() => rows().length === 5 && !doc.body.classList.contains('busy'), 'rescan'); await new Promise((r) => setTimeout(r, 100));
  assert.strictEqual(parseVdf(path.join(cfg, 'shortcuts.vdf')).length, 5); assert(rows().every((li) => /Already in Steam/.test(matchOf(li)))); ok('nova varredura: 5 atalhos, todos reconhecidos como já existentes');

  const afterAdd = win.parseVdf(new win.Uint8Array(fs.readFileSync(path.join(cfg, 'shortcuts.vdf'))));
  afterAdd[0].value = afterAdd[0].value.filter((e) => e.value.find((f) => f.key === 'AppName').value !== 'FridayNightFunkin');
  fs.writeFileSync(path.join(cfg, 'shortcuts.vdf'), Buffer.from(win.serializeVdf(afterAdd)));
  $('btn-recheck-steam').click();
  await waitFor(() => !row('Friday Night Funkin').querySelector('.game-name-input').disabled, 'recheck');
  const fnf2 = row('Friday Night Funkin');
  assert.strictEqual(nameOf(fnf2), "Friday Night Funkin'"); assert.strictEqual(fnf2.querySelector('input[type=checkbox]').checked, true); ok('removido da Steam + Re-check: volta marcado e com o nome oficial "Friday Night Funkin\'"');
  $('btn-apply').click(); await waitFor(() => /1 game\(s\) added/.test($('status').textContent), 'aplicar 2'); await idle();
  const list2 = parseVdf(path.join(cfg, 'shortcuts.vdf')); const fnfNew = list2.find((e) => e.AppName === "Friday Night Funkin'");
  assert(fnfNew && fnfNew.appid >>> 0 !== OLD_ID); assert(fs.readdirSync(path.join(cfg, 'grid')).includes(`${fnfNew.appid >>> 0}p.png`)); ok('re-adicionado com o nome oficial, novo appid e capas baixadas para esse appid');

  const ev = new win.Event('unhandledrejection'); ev.reason = new Error('boom de teste'); win.dispatchEvent(ev);
  assert(/Unexpected error: boom de teste/.test($('status').textContent)); assert(!$('status').hidden); ok('erro não tratado vira mensagem visível na interface');
  console.log('\nInterface OK.');
})().catch((e) => { console.error('FALHOU:', e.message); console.error(e.stack.split('\n').slice(1, 4).join('\n')); process.exit(1); });
