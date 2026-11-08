const assert = require('assert');
const G = require('../resources/js/steamgriddb.js');
let n = 0; const ok = (m) => console.log(`ok ${++n} - ${m}`);

const CATALOG = ["Friday Night Funkin'", 'Friday the 13th: The Game', 'Hollow Knight', 'Hollow Knight: Silksong',
  'NieR:Automata', 'Hades', 'Hades II', 'Celeste', 'Celeste 64', 'Portal', 'Portal 2', 'Cyberpunk 2077'];
function server(catalog, log) {
  return {
    fetch: async (url) => {
      const q = decodeURIComponent(url.split('/search/autocomplete/')[1]).toLowerCase();
      log.push(q);
      const data = catalog.map((name, i) => ({ id: i + 1, name })).filter((g) => g.name.toLowerCase().includes(q));
      return { status: 200, ok: true, text: async () => JSON.stringify({ success: true, data }) };
    },
    sleep: async () => {},
  };
}
const find = async (folder, catalog = CATALOG) => { const log = []; G.netState.curlApi = false; const r = await G.findGame(folder, 'k'.repeat(32), server(catalog, log)); return { ...r, log }; };

(async () => {
  assert.strictEqual(G.splitJoinedWords('FridayNightFunkin'), 'Friday Night Funkin');
  assert.strictEqual(G.splitJoinedWords('NieRAutomata'), 'Nie R Automata');
  assert.strictEqual(G.splitJoinedWords('Hollow Knight'), 'Hollow Knight'); ok('separa CamelCase sem estragar nomes normais');
  assert.strictEqual(G.cleanGameName('Friday_Night_Funkin_v0.2.8_GOG'), 'Friday Night Funkin');
  assert.strictEqual(G.cleanGameName('Hollow_Knight (v1.5) [GOG]'), 'Hollow Knight');
  assert.strictEqual(G.cleanGameName('Portal 2'), 'Portal 2'); ok('limpa versão/GOG/_ sem apagar o "2" de "Portal 2"');
  const q = G.buildSearchQueries('FridayNightFunkin'); assert.strictEqual(q[0], 'Friday Night Funkin'); assert(q.length <= 7); ok(`buscas geradas (${q.length}): ${JSON.stringify(q)}`);

  let r = await find('FridayNightFunkin');
  assert.strictEqual(r.match.name, "Friday Night Funkin'"); assert(r.match.score >= 0.97); assert.strictEqual(r.log.length, 1); ok('FridayNightFunkin -> "Friday Night Funkin\'" já na 1ª busca');

  r = await find('fridaynightfunkin'); assert.strictEqual(r.match.name, "Friday Night Funkin'"); ok('tudo minúsculo e colado: achado pelo prefixo + comparação de letras');
  r = await find('NieRAutomata'); assert.strictEqual(r.match.name, 'NieR:Automata'); ok('NieRAutomata -> NieR:Automata (via palavra "Automata")');
  r = await find('Hollw Knight'); assert.strictEqual(r.match.name, 'Hollow Knight'); assert(r.match.score < 0.97); ok('erro de digitação "Hollw Knight" -> Hollow Knight');
  r = await find('Friday_Night_Funkin_v0.2.8_GOG'); assert.strictEqual(r.match.name, "Friday Night Funkin'"); ok('nome sujo de repack/versão');
  r = await find('Friday Night Funkin Mod'); assert.strictEqual(r.match.name, "Friday Night Funkin'"); ok('"... Mod" casa com o jogo base removendo a última palavra');

  r = await find('Hades'); assert.strictEqual(r.match.name, 'Hades'); ok('"Hades" escolhe Hades, não Hades II');
  r = await find('Portal'); assert.strictEqual(r.match.name, 'Portal'); r = await find('Portal 2'); assert.strictEqual(r.match.name, 'Portal 2'); ok('Portal x Portal 2 não se confundem');
  r = await find('Hades', ['Hades II', 'Celeste']); assert.strictEqual(r.match, null); assert.deepStrictEqual(r.suggestions, ['Hades II']); ok('só existe a sequência: recusa (não pega Hades II) e sugere');
  r = await find('Celeste', ['Celeste 64']); assert.strictEqual(r.match, null); ok('"Celeste" não vira "Celeste 64"');
  r = await find('Hollow Knight', ['Hollow Knight: Silksong']); assert.strictEqual(r.match, null); ok('"Hollow Knight" não vira "Silksong" quando só ele existe');
  r = await find('ZzzJogoQueNaoExiste'); assert.strictEqual(r.match, null); assert(r.log.length <= 7); ok(`jogo inexistente: null, ${r.log.length} buscas no máximo`);

  r = await find('Celeste'); assert.strictEqual(r.log.length, 1); ok('nome já correto: apenas 1 requisição');
  console.log('\nTodos os testes passaram.');
})().catch((e) => { console.error('FALHOU:', e); process.exit(1); });
