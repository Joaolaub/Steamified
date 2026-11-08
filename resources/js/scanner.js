const MAX_DEPTH = 3;

const IGNORED_EXE = [
  /^unins/i,
  /uninstall/i,
  /^setup/i,
  /install/i,
  /^vc_?redist/i,
  /^dxsetup/i,
  /^dotnet/i,
  /^ndp\d/i,
  /^physx/i,
  /^oalinst/i,
  /crash/i,
  /^bssndrpt/i,
  /^cefsharp/i,
  /^notification_helper/i,
  /^7z/i,
  /^updater$/i,
  /^config(uration)?(tool)?$/i,
];

const IGNORED_FOLDERS = [
  /^_?common_?redist$/i,
  /^_?redist/i,
  /^directx$/i,
  /^dotnet/i,
  /^vcredist/i,
  /^prerequisites?$/i,
  /^__installer$/i,
  /^engine$/i,
  /^__macosx$/i,
  /^\./,
];

function normalizeName(text) {
  return text.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function isExe(fileName) {
  return /\.exe$/i.test(fileName);
}

function isIgnoredExe(fileName) {
  const baseName = fileName.replace(/\.exe$/i, '');
  return IGNORED_EXE.some((pattern) => pattern.test(baseName));
}

function isIgnoredFolder(folderName) {
  return IGNORED_FOLDERS.some((pattern) => pattern.test(folderName));
}

async function findExecutables(fs, folderPath, depth = 0) {
  let entries;
  try {
    entries = await fs.readDirectory(folderPath);
  } catch (err) {
    return [];
  }

  const found = [];
  for (const item of entries) {
    if (item.entry === '.' || item.entry === '..') continue;

    if (item.type === 'FILE') {
      if (isExe(item.entry) && !isIgnoredExe(item.entry)) {
        found.push({ name: item.entry, path: item.path, depth });
      }
    } else if (item.type === 'DIRECTORY') {
      if (depth < MAX_DEPTH && !isIgnoredFolder(item.entry)) {
        found.push(...(await findExecutables(fs, item.path, depth + 1)));
      }
    }
  }
  return found;
}

function rankCandidates(candidates, gameName) {
  const gameKey = normalizeName(gameName);

  return [...candidates].sort((a, b) => {
    const aKey = normalizeName(a.name.replace(/\.exe$/i, ''));
    const bKey = normalizeName(b.name.replace(/\.exe$/i, ''));
    const aMatch = aKey && (gameKey.includes(aKey) || aKey.includes(gameKey)) ? 1 : 0;
    const bMatch = bKey && (gameKey.includes(bKey) || bKey.includes(gameKey)) ? 1 : 0;

    if (aMatch !== bMatch) return bMatch - aMatch;
    if (a.depth !== b.depth) return a.depth - b.depth;
    return (b.size || 0) - (a.size || 0);
  });
}

async function addFileSizes(fs, candidates) {
  for (const exe of candidates) {
    try {
      exe.size = (await fs.getStats(exe.path)).size;
    } catch (err) {
      exe.size = 0;
    }
  }
}

async function scanGamesFolder(rootPath, fs = Neutralino.filesystem) {
  const rootEntries = await fs.readDirectory(rootPath);
  const games = [];

  for (const item of rootEntries) {
    if (item.entry === '.' || item.entry === '..') continue;

    let gameName, folder, candidates;

    if (item.type === 'DIRECTORY') {
      if (isIgnoredFolder(item.entry)) continue;
      gameName = item.entry;
      folder = item.path;
      candidates = await findExecutables(fs, item.path);
    } else if (item.type === 'FILE' && isExe(item.entry) && !isIgnoredExe(item.entry)) {
      gameName = item.entry.replace(/\.exe$/i, '');
      folder = rootPath;
      candidates = [{ name: item.entry, path: item.path, depth: 0 }];
    } else {
      continue;
    }

    if (candidates.length === 0) continue;

    await addFileSizes(fs, candidates);
    const ranked = rankCandidates(candidates, gameName);

    games.push({
      name: gameName,
      folder,
      exePath: ranked[0].path,
      exeName: ranked[0].name,
      candidates: ranked,
    });
  }

  games.sort((a, b) => a.name.localeCompare(b.name));
  return games;
}

if (typeof module !== 'undefined') {
  module.exports = { scanGamesFolder, findExecutables, rankCandidates, isIgnoredExe, isIgnoredFolder };
}
