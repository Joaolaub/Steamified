const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const G = require('../resources/js/steamgriddb.js');

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'grid-'));
let n = 0; const ok = (m) => console.log(`ok ${++n} - ${m}`);
const reset = () => { G.netState.curlApi = false; G.netState.curlImages = false; };

const fsMock = {
  getStats: async (p) => ({ size: fs.statSync(p).size }),
  readBinaryFile: async (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
  writeBinaryFile: async (p, ab) => fs.writeFileSync(p, Buffer.from(ab)),
  createDirectory: async (p) => fs.mkdirSync(p, { recursive: true }),
  remove: async (p) => fs.rmSync(p),
};
const json = (obj, status = 200) => ({ status, ok: status < 300, text: async () => JSON.stringify(obj) });
const img = (buf, status = 200) => ({ status, ok: status < 300, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length) });

function makeServer(opts = {}) {
  const calls = [];
  const handler = async (url, init = {}) => {
    calls.push(url);
    if (url.startsWith('https://cdn')) {
      if (url.endsWith('/html.png')) return img(Buffer.from('<html>error</html>'));
      return url.endsWith('.jpg') ? img(JPG) : img(PNG);
    }
    const auth = (init.headers || {}).Authorization;
    if (opts.badKey || auth !== 'Bearer ' + 'k'.repeat(32)) return json({ success: false }, 401);
    if (opts.rate && opts.rate()) return json({ success: false }, 429);
    if (url.includes('/search/autocomplete/')) {
      if (opts.notFound) return json({ success: true, data: [] });
      return json({ success: true, data: [{ id: 1, name: 'Hollow Knight: Silksong' }, { id: 2, name: 'Hollow Knight' }] });
    }
    if (url.includes('/grids/game/2') && url.includes('600x900')) return json({ success: true, data: [{ url: 'https://cdn2.steamgriddb.com/grid/cover.png' }] });
    if (url.includes('/grids/game/2')) return json({ success: true, data: [{ url: 'https://cdn2.steamgriddb.com/grid/banner.jpg' }] });
    if (url.includes('/heroes/game/2')) return json({ success: true, data: [{ url: 'https://cdn2.steamgriddb.com/hero/hero.png' }] });
    if (url.includes('/logos/game/2')) return json({ success: true, data: [] });
    if (url.includes('/icons/game/2')) return json({ success: true, data: [{ url: 'https://evil.example.com/x.png' }] });
    return json({ success: false }, 404);
  };
  return { handler, calls };
}
const mkDeps = (server, extra = {}) => ({ fetch: server.handler, exec: async () => { throw new Error('curl não deveria ser usado'); }, fs: fsMock, sleep: async () => {}, ...extra });
const KEY = 'k'.repeat(32), game = { name: 'Hollow_Knight (v1.5)', exePath: 'C:\\G\\hk.exe' };

(async () => {
  assert(G.isValidApiKey(KEY) && !G.isValidApiKey('curta') && !G.isValidApiKey(KEY + '"& calc')); ok('validação da chave (rejeita aspas/&/curta)');
  const store = {}; const storage = { getData: async (k) => { if (!(k in store)) throw new Error('NE_ST_NOSTKEX'); return store[k]; }, setData: async (k, v) => { if (v === null) delete store[k]; else store[k] = v; } };
  assert.strictEqual(await G.loadApiKey({ storage }), ''); await G.saveApiKey('  ' + KEY + ' ', { storage }); assert.strictEqual(await G.loadApiKey({ storage }), KEY);
  await assert.rejects(() => G.saveApiKey('x"; del *', { storage }), /valid API key/); await G.saveApiKey('', { storage }); assert.strictEqual(await G.loadApiKey({ storage }), ''); ok('salvar/ler/apagar chave; inválida é recusada');
  assert.strictEqual(G.cleanGameName('Hollow_Knight (v1.5) [GOG]'), 'Hollow Knight'); ok('limpeza do nome da pasta para a busca');

  reset(); let s = makeServer();
  const found = await G.searchGame(game.name, KEY, mkDeps(s)); assert.strictEqual(found.id, 2); ok('busca prefere o nome idêntico (não o 1º resultado)');

  let grid = path.join(tmp(), 'grid'); fs.mkdirSync(grid);
  let r = await G.downloadGameArt(game, 3000000001, grid, KEY, mkDeps(s));
  assert.deepStrictEqual(fs.readdirSync(grid).sort(), ['3000000001.jpg', '3000000001_hero.png', '3000000001p.png']); ok('nomes de arquivo: <id>p.png, <id>.jpg, <id>_hero.png');
  assert(fs.readFileSync(path.join(grid, '3000000001p.png')).equals(PNG) && fs.readFileSync(path.join(grid, '3000000001.jpg')).equals(JPG)); ok('conteúdo gravado correto (PNG/JPG)');
  assert.deepStrictEqual(r.missing.sort(), ['icon', 'logo']); assert.strictEqual(r.iconPath, ''); ok('logo vazio e ícone de host proibido contam como "sem imagem"');
  assert(s.calls.every(u => u.startsWith('https://www.steamgriddb.com/api/v2/') || u.startsWith('https://cdn'))); assert(!s.calls.some(u => u.includes('evil'))); ok('nunca baixa de host fora do steamgriddb.com');
  assert(s.calls.some(u => u.includes('nsfw=false') && u.includes('humor=false') && u.includes('types=static'))); ok('filtros nsfw/humor/estático aplicados');

  fs.writeFileSync(path.join(grid, '3000000001p.png'), 'MINHA ARTE PERSONALIZADA');
  s = makeServer(); r = await G.downloadGameArt(game, 3000000001, grid, KEY, mkDeps(s));
  assert.strictEqual(fs.readFileSync(path.join(grid, '3000000001p.png'), 'utf8'), 'MINHA ARTE PERSONALIZADA'); assert(r.existing.includes('cover')); assert(!r.saved.includes('cover')); ok('arte já existente NÃO é sobrescrita');

  grid = path.join(tmp(), 'grid'); fs.mkdirSync(grid);
  r = await G.downloadGameArt(game, 1, grid, KEY, mkDeps(makeServer({ notFound: true }))); assert.strictEqual(r.found, false); assert.strictEqual(fs.readdirSync(grid).length, 0); ok('jogo não encontrado: found=false, nada gravado');

  await assert.rejects(() => G.downloadAllArt([{ game, appId: 5 }], grid, KEY, () => {}, mkDeps(makeServer({ badKey: true }))), (e) => e.code === 'AUTH'); ok('chave recusada (401): erro AUTH interrompe');
  let calls429 = 0; s = makeServer({ rate: () => calls429++ === 0 });
  r = await G.searchGame(game.name, KEY, mkDeps(s)); assert.strictEqual(r.id, 2); ok('429 uma vez: espera e repete com sucesso');
  s = makeServer({ rate: () => true });
  const sum = await G.downloadAllArt([{ game, appId: 6 }, { game, appId: 7 }], grid, KEY, () => {}, mkDeps(s)); assert(/rate limit/i.test(sum.stoppedEarly)); ok('429 persistente: para com mensagem, sem quebrar');

  grid = path.join(tmp(), 'grid'); fs.mkdirSync(grid); reset();
  const htmlServer = makeServer(); const htmlDeps = mkDeps(htmlServer);
  const origFetch = htmlDeps.fetch; htmlDeps.fetch = async (u, i) => u.includes('/grids/game/2') && u.includes('600x900') ? json({ success: true, data: [{ url: 'https://cdn2.steamgriddb.com/grid/html.png' }] }) : origFetch(u, i);
  r = await G.downloadGameArt(game, 8, grid, KEY, htmlDeps); assert(r.failed.some(f => f.type === 'cover')); assert(!fs.existsSync(path.join(grid, '8p.png'))); ok('conteúdo que não é PNG/JPEG é rejeitado e não vira arquivo');

  grid = path.join(tmp(), 'grid'); fs.mkdirSync(grid); reset();
  const cmds = []; const base = makeServer();
  const curlDeps = {
    fetch: async () => { throw new TypeError('Failed to fetch'); },
    fs: fsMock, sleep: async () => {},
    exec: async (cmd) => {
      cmds.push(cmd);
      const url = /"(https:[^"]+)"\s*$/.exec(cmd)[1];
      if (cmd.includes('-o "')) {
        const dest = /-o "([^"]+)"/.exec(cmd)[1]; fs.writeFileSync(dest, url.endsWith('.jpg') ? JPG : PNG); return { exitCode: 0, stdOut: '' };
      }
      const auth = /Bearer ([A-Za-z0-9]+)/.exec(cmd)[1];
      const res = await base.handler(url, { headers: { Authorization: 'Bearer ' + auth } });
      return { exitCode: 0, stdOut: (await res.text()) + 'HTTPSTATUS:' + res.status };
    },
  };
  r = await G.downloadGameArt(game, 9, grid, KEY, curlDeps);
  assert.deepStrictEqual(fs.readdirSync(grid).sort(), ['9.jpg', '9_hero.png', '9p.png']); assert(G.netState.curlApi && G.netState.curlImages); ok('CORS bloqueou o fetch: curl assumiu API e imagens com o mesmo resultado');
  assert(cmds.every(c => c.startsWith('curl '))); assert(cmds.filter(c => c.includes('Authorization')).length >= 5); ok('comandos curl bem formados (autenticação presente)');

  reset(); G.netState.curlImages = true;
  await assert.rejects(() => G.downloadGameArt(game, 10, path.join(tmp(), 'a"b'), KEY, { ...curlDeps, fs: { ...fsMock, getStats: async () => { throw new Error('x'); } } }).then(x => { if (x.failed.length) throw new Error(x.failed[0].message); }), /not supported|Could not/);
  ok('caminho de destino com aspas é recusado no plano B (sem injeção de comando)');

  reset(); grid = path.join(tmp(), 'grid');
  const ids = []; s = makeServer(); const sv2 = makeServer();
  const full = mkDeps(sv2); const oldFetch = full.fetch;
  full.fetch = async (u, i) => u.includes('/icons/game/2') ? json({ success: true, data: [{ url: 'https://cdn2.steamgriddb.com/icon/ic.png' }] }) : oldFetch(u, i);
  const sum2 = await G.downloadAllArt([{ game, appId: 11 }, { game: { name: 'Jogo Inexistente', exePath: 'C:\\x.exe' }, appId: 12 }], grid, KEY, (p) => ids.push(`${p.index}/${p.total}`), full);
  assert.deepStrictEqual(ids, ['1/2', '2/2']); assert.strictEqual(sum2.perGame[0].iconPath, path.join(grid, '11_icon.png')); assert(fs.existsSync(sum2.perGame[0].iconPath)); assert(sum2.downloaded === 4); ok('pasta grid criada, progresso 1/2 e 2/2, caminho do ícone devolvido');
  console.log('\nTodos os testes passaram.');
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
