const SGDB_API = 'https://www.steamgriddb.com/api/v2';
const API_KEY_STORAGE = 'sgdbApiKey';

const COMMON_QUERY = 'types=static&nsfw=false&humor=false';

const ART_TYPES = [
  { id: 'cover',  endpoint: 'grids',  suffix: 'p',     query: 'dimensions=600x900&mimes=image/png,image/jpeg' },
  { id: 'banner', endpoint: 'grids',  suffix: '',      query: 'dimensions=920x430,460x215&mimes=image/png,image/jpeg' },
  { id: 'hero',   endpoint: 'heroes', suffix: '_hero', query: 'mimes=image/png,image/jpeg' },
  { id: 'logo',   endpoint: 'logos',  suffix: '_logo', query: 'mimes=image/png' },
  { id: 'icon',   endpoint: 'icons',  suffix: '_icon', query: 'mimes=image/png' },
];

const IMAGE_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.steamgriddb\.com\/[A-Za-z0-9_\-./]+$/i;

const netState = { curlApi: false, curlImages: false };

class SgdbError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function defaultDeps() {
  return {
    fetch: (...args) => fetch(...args),
    exec: (command) => Neutralino.os.execCommand(command),
    fs: Neutralino.filesystem,
    storage: Neutralino.storage,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
}

function isValidApiKey(key) {
  return /^[A-Za-z0-9_-]{16,64}$/.test(key);
}

async function loadApiKey(deps = defaultDeps()) {
  try {
    return (await deps.storage.getData(API_KEY_STORAGE)) || '';
  } catch (err) {
    return '';
  }
}

async function saveApiKey(key, deps = defaultDeps()) {
  const clean = (key || '').trim();
  if (clean === '') {
    await deps.storage.setData(API_KEY_STORAGE, null);
    return '';
  }
  if (!isValidApiKey(clean)) {
    throw new SgdbError('AUTH', 'That does not look like a valid API key (letters and numbers only).');
  }
  await deps.storage.setData(API_KEY_STORAGE, clean);
  return clean;
}

function errorForStatus(status) {
  if (status === 401 || status === 403) {
    return new SgdbError('AUTH', 'SteamGridDB rejected the API key. Check that it is correct.');
  }
  if (status === 429) {
    return new SgdbError('RATE', 'SteamGridDB rate limit reached. Wait a minute and try again.');
  }
  return new SgdbError('HTTP', `SteamGridDB returned an error (HTTP ${status}).`);
}

async function curlGetText(url, apiKey, deps) {
  const command =
    `curl -s -L --max-time 30 -H "Authorization: Bearer ${apiKey}" ` +
    `-w "HTTPSTATUS:%{http_code}" "${url}"`;
  let result;
  try {
    result = await deps.exec(command);
  } catch (err) {
    throw new SgdbError('NETWORK', 'Could not run curl. Check your internet connection.');
  }
  const out = result.stdOut || '';
  const marker = out.lastIndexOf('HTTPSTATUS:');
  if (result.exitCode !== 0 || marker === -1) {
    throw new SgdbError('NETWORK', 'Could not reach SteamGridDB. Check your internet connection.');
  }
  return { status: Number(out.slice(marker + 11).trim()), text: out.slice(0, marker) };
}

async function sgdbGet(path, apiKey, deps) {
  const url = `${SGDB_API}${path}`;

  for (let attempt = 0; attempt < 2; attempt++) {
    let response = null;

    if (!netState.curlApi) {
      try {
        const res = await deps.fetch(url, { headers: { Authorization: `Bearer ${apiKey}` } });
        response = { status: res.status, text: await res.text() };
      } catch (err) {
        netState.curlApi = true;
      }
    }
    if (netState.curlApi) {
      try {
        response = await curlGetText(url, apiKey, deps);
      } catch (err) {
        netState.curlApi = false;
        throw err;
      }
    }

    if (response.status === 404) return null;
    if (response.status === 429 && attempt === 0) {
      await deps.sleep(1500);
      continue;
    }
    if (response.status < 200 || response.status >= 300) throw errorForStatus(response.status);

    let json;
    try {
      json = JSON.parse(response.text);
    } catch (err) {
      throw new SgdbError('HTTP', 'Unexpected response from SteamGridDB.');
    }
    if (!json.success) throw new SgdbError('HTTP', 'SteamGridDB reported an error.');
    return json.data;
  }
}

function sgdbNormalize(text) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

const JUNK_WORDS = new Set([
  'gog', 'repack', 'portable', 'setup', 'installer', 'win32', 'win64', 'x64', 'x86',
  'multi', 'fitgirl', 'dodi', 'codex', 'plaza', 'skidrow', 'goldberg', 'crack', 'cracked',
]);

function cleanGameName(name) {
  let cleaned = name
    .replace(/[[(][^\])]*[\])]/g, ' ')
    .replace(/_+/g, ' ')
    .replace(/\bv?\d+(\.\d+)+\b/gi, ' ')
    .replace(/\bv\d+\b/gi, ' ')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(' ');
  while (words.length > 1 && JUNK_WORDS.has(words[words.length - 1].toLowerCase())) words.pop();
  cleaned = words.join(' ');
  return cleaned || name;
}

function splitJoinedWords(text) {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2');
}

function levenshtein(a, b) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = row;
  }
  return prev[b.length];
}

function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const longer = Math.max(a.length, b.length);
  const shorter = Math.min(a.length, b.length);

  let score = 1 - levenshtein(a, b) / longer;
  if (shorter >= 4 && (a.includes(b) || b.includes(a))) {
    score = Math.max(score, 0.5 + 0.4 * (shorter / longer));
  }
  if ((a.match(/\d+/g) || []).join(',') !== (b.match(/\d+/g) || []).join(',')) score *= 0.75;
  return score;
}

const MATCH_THRESHOLD = 0.8;
const CONFIDENT_SCORE = 0.9;
const MAX_QUERIES = 7;

function buildSearchQueries(name) {
  const queries = [];
  const add = (text) => {
    const q = text.replace(/\s+/g, ' ').trim();
    if (q.length >= 3 && !queries.some((x) => x.toLowerCase() === q.toLowerCase())) queries.push(q);
  };

  const base = cleanGameName(name);
  const split = splitJoinedWords(base);
  add(split);
  add(base);

  const words = split.split(' ');
  for (let n = words.length - 1; n >= 2 && words.length >= 3; n--) add(words.slice(0, n).join(' '));

  words
    .filter((w) => w.length >= 4)
    .sort((a, b) => b.length - a.length)
    .slice(0, 2)
    .forEach(add);

  const compact = sgdbNormalize(base);
  if (words.length === 1 && compact.length >= 10) add(compact.slice(0, 6));

  return queries.slice(0, MAX_QUERIES);
}

async function findGame(name, apiKey, deps = defaultDeps()) {
  const base = cleanGameName(name);
  const wanted = [...new Set([name, base, splitJoinedWords(base)].map(sgdbNormalize))].filter(Boolean);

  const seen = new Map();
  for (const query of buildSearchQueries(name)) {
    const results = await sgdbGet(`/search/autocomplete/${encodeURIComponent(query)}`, apiKey, deps);
    for (const r of results || []) {
      const candidate = sgdbNormalize(r.name || '');
      const score = Math.max(...wanted.map((w) => nameSimilarity(w, candidate)));
      if (!seen.has(r.id) || seen.get(r.id).score < score) seen.set(r.id, { id: r.id, name: r.name, score });
    }
    const best = [...seen.values()].reduce((a, b) => (b.score > (a ? a.score : -1) ? b : a), null);
    if (best && best.score >= CONFIDENT_SCORE) break;
  }

  const ranked = [...seen.values()].sort((a, b) => b.score - a.score);
  const match = ranked.length && ranked[0].score >= MATCH_THRESHOLD ? ranked[0] : null;
  const suggestions = ranked.filter((c) => c.score >= 0.4).slice(0, 3).map((c) => c.name);
  return { match, suggestions };
}

async function searchGames(term, apiKey, deps = defaultDeps()) {
  const clean = (term || '').trim();
  if (clean.length < 2) return [];
  const results = await sgdbGet(`/search/autocomplete/${encodeURIComponent(clean)}`, apiKey, deps);
  return (results || []).slice(0, 8).map((r) => ({ id: r.id, name: r.name, verified: !!r.verified }));
}

function parseGameReference(text) {
  const clean = (text || '').trim();
  const fromUrl = /steamgriddb\.com\/game\/(\d+)/i.exec(clean);
  if (fromUrl) return Number(fromUrl[1]);
  if (/^\d{1,9}$/.test(clean)) return Number(clean);
  return null;
}

async function searchGame(name, apiKey, deps = defaultDeps()) {
  return (await findGame(name, apiKey, deps)).match;
}

async function fetchArtUrl(artType, gameId, apiKey, deps) {
  const path = `/${artType.endpoint}/game/${gameId}?${COMMON_QUERY}&${artType.query}`;
  const images = await sgdbGet(path, apiKey, deps);
  if (!images) return null;
  const best = images.find((img) => IMAGE_URL_PATTERN.test(img.url || ''));
  return best ? best.url : null;
}

function imageExtension(url) {
  const match = /\.(png|jpe?g)$/i.exec(url);
  if (!match) return 'png';
  return match[1].toLowerCase() === 'png' ? 'png' : 'jpg';
}

function looksLikeImage(bytes) {
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  const isJpg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  return isPng || isJpg;
}

async function downloadImage(url, destPath, deps) {
  if (!IMAGE_URL_PATTERN.test(url)) throw new SgdbError('HTTP', 'Unexpected image address.');

  if (!netState.curlImages) {
    let res = null;
    try {
      res = await deps.fetch(url);
    } catch (err) {
      netState.curlImages = true;
    }
    if (res) {
      if (!res.ok) throw errorForStatus(res.status);
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (!looksLikeImage(bytes)) throw new SgdbError('HTTP', 'The downloaded file is not an image.');
      await deps.fs.writeBinaryFile(destPath, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      return;
    }
  }

  if (/["%]/.test(destPath)) {
    throw new SgdbError('NETWORK', 'The Steam folder path contains characters that are not supported for downloads.');
  }
  let result;
  try {
    result = await deps.exec(`curl -s -L -f --max-time 60 -o "${destPath}" "${url}"`);
  } catch (err) {
    throw new SgdbError('NETWORK', 'Could not run curl. Check your internet connection.');
  }
  if (result.exitCode !== 0) {
    throw new SgdbError('NETWORK', 'Could not download the image. Check your internet connection.');
  }
  const saved = new Uint8Array(await deps.fs.readBinaryFile(destPath));
  if (!looksLikeImage(saved)) {
    await deps.fs.remove(destPath);
    throw new SgdbError('HTTP', 'The downloaded file is not an image.');
  }
}

async function findExistingArt(fs, gridDir, baseName) {
  for (const ext of ['png', 'jpg', 'jpeg', 'webp']) {
    const candidate = `${gridDir}${gridDir.includes('\\') ? '\\' : '/'}${baseName}.${ext}`;
    try {
      await fs.getStats(candidate);
      return candidate;
    } catch (err) {
    }
  }
  return null;
}

async function downloadGameArt(game, appId, gridDir, apiKey, deps = defaultDeps()) {
  const result = { found: true, matched: null, suggestions: [], saved: [], existing: [], missing: [], failed: [], iconPath: '' };
  const pending = [];

  for (const type of ART_TYPES) {
    const current = await findExistingArt(deps.fs, gridDir, `${appId}${type.suffix}`);
    if (current) {
      result.existing.push(type.id);
      if (type.id === 'icon') result.iconPath = current;
    } else {
      pending.push(type);
    }
  }
  if (pending.length === 0) return result;

  const manualId = Number(game.sgdbId);
  const hasId = Number.isInteger(manualId) && manualId > 0;
  if (!hasId && game.skipSearch) {
    result.found = false;
    return result;
  }
  const { match, suggestions } = hasId
    ? { match: { id: manualId, name: game.sgdbName || `ID ${manualId}`, score: 1 }, suggestions: [] }
    : await findGame(game.name, apiKey, deps);
  if (!match) {
    result.found = false;
    result.suggestions = suggestions;
    return result;
  }
  result.matched = match;

  const separator = gridDir.includes('\\') ? '\\' : '/';
  await Promise.all(pending.map(async (type) => {
    try {
      const url = await fetchArtUrl(type, match.id, apiKey, deps);
      if (!url) {
        result.missing.push(type.id);
        return;
      }
      const destPath = `${gridDir}${separator}${appId}${type.suffix}.${imageExtension(url)}`;
      await downloadImage(url, destPath, deps);
      result.saved.push(type.id);
      if (type.id === 'icon') result.iconPath = destPath;
    } catch (err) {
      if (err.code === 'AUTH' || err.code === 'RATE') throw err;
      result.failed.push({ type: type.id, message: err.message });
    }
  }));
  return result;
}

async function downloadAllArt(items, gridDir, apiKey, onProgress = () => {}, deps = defaultDeps()) {
  const summary = { perGame: [], downloaded: 0, notFound: [], notFoundDetails: [], fuzzy: [], failed: [], stoppedEarly: '' };

  try {
    await deps.fs.getStats(gridDir);
  } catch (err) {
    await deps.fs.createDirectory(gridDir);
  }

  for (let i = 0; i < items.length; i++) {
    const { game, appId } = items[i];
    onProgress({ index: i + 1, total: items.length, name: game.name });

    let result;
    try {
      result = await downloadGameArt(game, appId, gridDir, apiKey, deps);
    } catch (err) {
      if (err.code === 'RATE') {
        summary.stoppedEarly = err.message;
        break;
      }
      throw err;
    }

    summary.downloaded += result.saved.length;
    if (!result.found) {
      summary.notFound.push(game.name);
      summary.notFoundDetails.push({ name: game.name, suggestions: result.suggestions });
    } else if (result.matched && result.matched.score < 0.97) {
      summary.fuzzy.push({ folder: game.name, matched: result.matched.name });
    }
    for (const f of result.failed) summary.failed.push({ name: game.name, ...f });
    summary.perGame.push({
      name: game.name, appId, iconPath: result.iconPath,
      found: result.found, matched: result.matched ? result.matched.name : '',
    });
  }
  return summary;
}

if (typeof module !== 'undefined') {
  module.exports = {
    isValidApiKey, loadApiKey, saveApiKey, searchGame, searchGames, parseGameReference, findGame, buildSearchQueries, nameSimilarity,
    splitJoinedWords, cleanGameName, fetchArtUrl,
    downloadGameArt, downloadAllArt, looksLikeImage, imageExtension, netState, ART_TYPES,
  };
}
