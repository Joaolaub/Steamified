const fs = require('fs'), path = require('path'), os = require('os'), assert = require('assert');
const S = require('../resources/js/steam.js');

const z = (s) => Buffer.concat([Buffer.from(s, 'utf8'), Buffer.from([0])]);
const str = (k, v) => Buffer.concat([Buffer.from([1]), z(k), z(v)]);
const int = (k, n) => { const b = Buffer.alloc(4); b.writeInt32LE(n); return Buffer.concat([Buffer.from([2]), z(k), b]); };
const obj = (k, ...kids) => Buffer.concat([Buffer.from([0]), z(k), ...kids, Buffer.from([8])]);
const entry = (i, name, exe) => obj(String(i),
  int('appid', -1234567), str('AppName', name), str('Exe', `"${exe}"`), str('StartDir', '"C:\\x\\"'),
  str('icon', ''), str('LaunchOptions', '-fullscreen é'), int('IsHidden', 0), obj('tags', str('0', 'favorite')));
const file = (...entries) => Buffer.concat([Buffer.from([0]), z('shortcuts'), ...entries, Buffer.from([8]), Buffer.from([8])]);

function makeFs(opts = {}) {
  return {
    getStats: async (p) => ({ size: fs.statSync(p).size }),
    readBinaryFile: async (p) => { const b = fs.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.length); },
    writeBinaryFile: async (p, ab) => {
      let data = Buffer.from(ab);
      if (opts.corruptTarget && p.endsWith('shortcuts.vdf') && (opts.corruptAll || !opts.done)) { opts.done = true; data = data.subarray(0, data.length - 3); }
      fs.writeFileSync(p, data);
    },
    createDirectory: async (p) => fs.mkdirSync(p, { recursive: true }),
    remove: async (p) => fs.rmSync(p),
  };
}
const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vdf-'));
const userFor = (dir) => ({ configDir: dir, shortcutsPath: path.join(dir, 'shortcuts.vdf') });
const rd = (p) => fs.readFileSync(p);
let n = 0; const ok = (m) => console.log(`ok ${++n} - ${m}`);

(async () => {
  assert.strictEqual(S.crc32('123456789'), 0xCBF43926); ok('crc32("123456789") = 0xCBF43926');
  const id = S.generateAppId('"C:\\a.exe"', 'A'); assert(id >= 0x80000000 && id <= 0xFFFFFFFF); ok('AppID tem o bit alto ligado');

  const orig = file(entry(0, 'Celeste', 'C:\\Games\\Celeste\\Celeste.exe'), entry(1, 'Hollow Knight', 'C:\\Games\\HK\\hk.exe'));
  assert(Buffer.from(S.serializeVdf(S.parseVdf(new Uint8Array(orig)))).equals(orig)); ok('parse -> serialize devolve bytes IDÊNTICOS');
  const empty = Buffer.from([0,115,104,111,114,116,99,117,116,115,0,8,8]);
  assert(Buffer.from(S.serializeVdf(S.parseVdf(new Uint8Array(empty)))).equals(empty)); ok('arquivo vazio (só cabeçalho) também');

  let dir = tmp(), user = userFor(dir); fs.writeFileSync(user.shortcutsPath, orig);
  const games = [
    { name: 'Celeste (dup)', exePath: 'c:/games/celeste/CELESTE.exe' },
    { name: 'Balatro', exePath: 'C:\\Games\\Balatro\\Balatro.exe' },
    { name: 'Hades', exePath: 'D:\\Jogos\\Hades\\x64\\Hades.exe' },
  ];
  let r = await S.addGamesToShortcuts(user, games, makeFs());
  assert.deepStrictEqual(r.added, ['Balatro', 'Hades']); assert.deepStrictEqual(r.skipped, ['Celeste (dup)']); ok('adiciona 2, pula 1 duplicado (caixa/barras diferentes)');
  assert(rd(user.shortcutsPath + '.bak').equals(orig)); assert(rd(user.shortcutsPath + '.original.bak').equals(orig)); ok('shortcuts.vdf.bak e .original.bak idênticos ao original');
  const after = rd(user.shortcutsPath);
  assert(after.subarray(0, orig.length - 2).equals(orig.subarray(0, orig.length - 2))); ok('atalhos antigos preservados byte a byte (prefixo idêntico)');
  const list = S.parseVdf(new Uint8Array(after))[0].value;
  assert.deepStrictEqual(list.map(e => e.key), ['0', '1', '2', '3']); ok('índices novos continuam em 2 e 3');
  const hades = list[3].value; const get = (k) => hades.find(f => f.key === k).value;
  assert.strictEqual(get('AppName'), 'Hades'); assert.strictEqual(get('Exe'), '"D:\\Jogos\\Hades\\x64\\Hades.exe"');
  assert.strictEqual(get('StartDir'), '"D:\\Jogos\\Hades\\x64\\"');
  assert.strictEqual(get('appid') >>> 0, S.generateAppId('"D:\\Jogos\\Hades\\x64\\Hades.exe"', 'Hades')); ok('campos Exe/StartDir/appid corretos');

  r = await S.addGamesToShortcuts(user, [{ name: 'Outro', exePath: 'C:\\G\\o.exe' }], makeFs());
  assert(rd(user.shortcutsPath + '.bak').equals(after)); assert(rd(user.shortcutsPath + '.original.bak').equals(orig)); ok('2ª execução: .bak atualizado, .original.bak preservado');

  dir = tmp(); user = userFor(dir); fs.writeFileSync(user.shortcutsPath, orig);
  r = await S.addGamesToShortcuts(user, [{ name: 'Celeste', exePath: 'C:\\Games\\Celeste\\Celeste.exe' }], makeFs());
  assert.strictEqual(r.added.length, 0); assert(!fs.existsSync(user.shortcutsPath + '.bak')); assert(rd(user.shortcutsPath).equals(orig)); ok('sem novidades: nada é escrito, sem backup');

  dir = path.join(tmp(), 'config'); user = userFor(dir);
  r = await S.addGamesToShortcuts(user, [{ name: 'Novo', exePath: 'C:\\G\\n.exe' }], makeFs());
  assert.strictEqual(S.parseVdf(new Uint8Array(rd(user.shortcutsPath)))[0].value.length, 1); assert(!fs.existsSync(user.shortcutsPath + '.bak')); ok('arquivo inexistente: criado com 1 atalho');

  const bad = {
    'truncado': orig.subarray(0, orig.length - 10),
    'tipo desconhecido (0x07)': Buffer.concat([Buffer.from([0]), z('shortcuts'), Buffer.from([0]), z('0'), Buffer.from([7]), z('x'), Buffer.alloc(8), Buffer.from([8, 8, 8])]),
    'lixo': Buffer.from('lixo qualquer'),
    'bytes extras no fim': Buffer.concat([orig, Buffer.from([1, 2, 3])]),
    'UTF-8 inválido': Buffer.concat([Buffer.from([0]), z('shortcuts'), Buffer.from([1]), z('k'), Buffer.from([0xff, 0xfe, 0]), Buffer.from([8, 8])]),
  };
  for (const [name, bytes] of Object.entries(bad)) {
    dir = tmp(); user = userFor(dir); fs.writeFileSync(user.shortcutsPath, bytes);
    await assert.rejects(() => S.addGamesToShortcuts(user, [{ name: 'X', exePath: 'C:\\x.exe' }], makeFs()));
    assert(rd(user.shortcutsPath).equals(bytes)); assert(!fs.existsSync(user.shortcutsPath + '.bak'));
    ok(`arquivo inválido (${name}): recusado, original intacto, sem .bak`);
  }

  dir = tmp(); user = userFor(dir); fs.writeFileSync(user.shortcutsPath, orig);
  await assert.rejects(() => S.addGamesToShortcuts(user, [{ name: 'X', exePath: 'C:\\x.exe' }], makeFs({ corruptTarget: true })), /original file was restored/);
  assert(rd(user.shortcutsPath).equals(orig)); ok('gravação incompleta: detectada e original RESTAURADO');
  dir = tmp(); user = userFor(dir); fs.writeFileSync(user.shortcutsPath, orig);
  await assert.rejects(() => S.addGamesToShortcuts(user, [{ name: 'X', exePath: 'C:\\x.exe' }], makeFs({ corruptTarget: true, corruptAll: true })), /restoring the original also failed.*\.bak/);
  assert(rd(user.shortcutsPath + '.bak').equals(orig)); ok('restauração falhou também: erro honesto e o .bak continua íntegro');
  dir = tmp(); user = userFor(dir); fs.writeFileSync(user.shortcutsPath, orig);
  await assert.rejects(() => S.addGamesToShortcuts(user, [{ name: 'Mau\0Nome', exePath: 'C:\\x.exe' }], makeFs()), /null character/);
  assert(rd(user.shortcutsPath).equals(orig)); assert(!fs.existsSync(user.shortcutsPath + '.bak')); ok('nome com caractere nulo: recusado, arquivo e backup intactos');
  console.log('\nTodos os testes passaram.');
})().catch(e => { console.error('FALHOU:', e); process.exit(1); });
