const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const S = require('../resources/js/steam.js');
const G = require('../resources/js/steamgriddb.js');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);

const fsMock = {
  getStats: async (p) => ({ size: fs.statSync(p).size }),
  readBinaryFile: async (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
  writeBinaryFile: async (p, ab) => fs.writeFileSync(p, Buffer.from(ab)),
  createDirectory: async (p) => fs.mkdirSync(p, { recursive: true }),
  remove: async (p) => fs.rmSync(p),
};
const json = (o, s = 200) => ({ status: s, ok: s < 300, text: async () => JSON.stringify(o) });
const fetchMock = async (url) => {
  if (url.startsWith('https://cdn')) return { status: 200, ok: true, arrayBuffer: async () => PNG.buffer.slice(PNG.byteOffset, PNG.byteOffset + PNG.length) };
  if (url.includes('/search/')) return json({ success: true, data: [{ id: 7, name: decodeURIComponent(url.split('/search/autocomplete/')[1]) }] });
  const kind = /\/(grids|heroes|logos|icons)\//.exec(url)[1];
  return json({ success: true, data: [{ url: `https://cdn2.steamgriddb.com/${kind}/${kind}.png` }] });
};
const deps = { fetch: fetchMock, fs: fsMock, sleep: async () => {}, exec: async () => { throw new Error('sem curl'); } };

const z = (s) => Buffer.concat([Buffer.from(s), Buffer.from([0])]);
const str = (k, v) => Buffer.concat([Buffer.from([1]), z(k), z(v)]);
const int = (k, n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return Buffer.concat([Buffer.from([2]), z(k), b]); };
const STEAM_MADE_ID = 0xABCDEF01;
const existing = Buffer.concat([Buffer.from([0]), z('shortcuts'), Buffer.from([0]), z('0'),
  int('appid', STEAM_MADE_ID | 0), str('AppName', 'Celeste'), str('Exe', '"C:\\Games\\Celeste\\Celeste.exe"'), str('icon', ''),
  Buffer.from([8, 8, 8])]);

(async () => {
  const cfg = fs.mkdtempSync(path.join(os.tmpdir(), 'cfg-')); const user = { configDir: cfg, shortcutsPath: path.join(cfg, 'shortcuts.vdf') };
  fs.writeFileSync(user.shortcutsPath, existing);
  const games = [{ name: 'Celeste', exePath: 'C:\\Games\\Celeste\\Celeste.exe' }, { name: 'Hades', exePath: 'D:\\Hades\\Hades.exe' }];

  const plan = await S.planShortcuts(user, games, fsMock);
  assert.strictEqual(plan[0].isNew, false); assert.strictEqual(plan[0].appId, STEAM_MADE_ID);
  assert.strictEqual(plan[1].isNew, true); assert.strictEqual(plan[1].appId, S.shortcutAppId(games[1]));
  console.log('ok 1 - plano: jogo existente usa o appid da Steam; novo usa o calculado');

  const gridDir = path.join(cfg, 'grid');
  const art = await G.downloadAllArt(plan.map(({ game, appId }) => ({ game, appId })), gridDir, 'k'.repeat(32), () => {}, deps);
  const files = fs.readdirSync(gridDir).sort();
  assert(files.includes(`${STEAM_MADE_ID}p.png`) && files.includes(`${plan[1].appId}_hero.png`)); assert.strictEqual(files.length, 10);
  console.log('ok 2 - 10 arquivos, nomeados com o appid certo de cada jogo');

  const icons = new Map(art.perGame.map(p => [p.appId, p.iconPath]));
  const toAdd = plan.map(({ game, appId }) => ({ ...game, iconPath: icons.get(appId) || '' }));
  const res = await S.addGamesToShortcuts(user, toAdd, fsMock);
  assert.deepStrictEqual(res.added, ['Hades']); assert.deepStrictEqual(res.skipped, ['Celeste']);

  const list = S.parseVdf(new Uint8Array(fs.readFileSync(user.shortcutsPath)))[0].value;
  const hades = Object.fromEntries(list[1].value.map(f => [f.key, f.value]));
  assert.strictEqual(hades.appid >>> 0, plan[1].appId);
  assert.strictEqual(hades.icon, path.join(gridDir, `${plan[1].appId}_icon.png`)); assert(fs.existsSync(hades.icon));
  const celeste = Object.fromEntries(list[0].value.map(f => [f.key, f.value]));
  assert.strictEqual(celeste.icon, '');
  console.log('ok 3 - appid do atalho == appid dos arquivos; ícone no campo icon; atalho antigo intacto');

  let downloads = 0; const countingDeps = { ...deps, fetch: async (u, i) => { if (u.startsWith('https://cdn')) downloads++; return fetchMock(u, i); } };
  const plan2 = await S.planShortcuts(user, games, fsMock);
  const art2 = await G.downloadAllArt(plan2.map(({ game, appId }) => ({ game, appId })), gridDir, 'k'.repeat(32), () => {}, countingDeps);
  assert.strictEqual(downloads, 0); assert.strictEqual(art2.downloaded, 0); assert.strictEqual(plan2[1].isNew, false);
  console.log('ok 4 - 2ª execução: zero downloads (arte já existe) e nenhum jogo novo');
  console.log('\nPipeline OK.');
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
