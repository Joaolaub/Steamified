const STEAMID64_BASE = 76561197960265728n;

const SHORTCUTS_HEADER = [0x00, 0x73, 0x68, 0x6f, 0x72, 0x74, 0x63, 0x75, 0x74, 0x73, 0x00];

function normalizePath(p) {
  const isWindows = typeof NL_OS !== 'undefined' && NL_OS === 'Windows';
  return isWindows ? p.replace(/\//g, '\\') : p;
}

function joinPath(base, ...parts) {
  const sep = base.includes('\\') ? '\\' : '/';
  return [base.replace(/[\\/]+$/, ''), ...parts].join(sep);
}

async function pathExists(fs, p) {
  try {
    await fs.getStats(p);
    return true;
  } catch (err) {
    return false;
  }
}

function parseRegValue(output) {
  const match = /REG_SZ\s+(.+?)\s*$/m.exec(output || '');
  return match ? match[1].trim() : null;
}

async function isValidSteamPath(fs, p) {
  return (await pathExists(fs, joinPath(p, 'steam.exe'))) ||
         (await pathExists(fs, joinPath(p, 'userdata')));
}

async function findSteamPath(os = Neutralino.os, fs = Neutralino.filesystem) {
  const candidates = [];

  const regKeys = [
    ['HKCU\\Software\\Valve\\Steam', 'SteamPath'],
    ['HKLM\\SOFTWARE\\WOW6432Node\\Valve\\Steam', 'InstallPath'],
    ['HKLM\\SOFTWARE\\Valve\\Steam', 'InstallPath'],
  ];
  for (const [key, value] of regKeys) {
    try {
      const result = await os.execCommand(`reg query "${key}" /v ${value}`);
      const found = parseRegValue(result.stdOut);
      if (found) candidates.push(found);
    } catch (err) {
    }
  }

  for (const envName of ['ProgramFiles(x86)', 'ProgramFiles']) {
    try {
      const base = await os.getEnv(envName);
      if (base) candidates.push(joinPath(normalizePath(base), 'Steam'));
    } catch (err) {
    }
  }
  candidates.push('C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam');

  for (const candidate of candidates) {
    const p = normalizePath(candidate);
    if (await isValidSteamPath(fs, p)) return p;
  }
  return null;
}

function parseLoginUsers(text) {
  const users = {};
  const blockRegex = /"(\d{17})"\s*\{([^{}]*)\}/g;
  let match;

  while ((match = blockRegex.exec(text || '')) !== null) {
    const accountId = (BigInt(match[1]) - STEAMID64_BASE).toString();
    const body = match[2];
    users[accountId] = {
      personaName: (/"PersonaName"\s*"([^"]*)"/i.exec(body) || [])[1] || '',
      accountName: (/"AccountName"\s*"([^"]*)"/i.exec(body) || [])[1] || '',
      mostRecent: /"MostRecent"\s*"1"/i.test(body),
    };
  }
  return users;
}

async function getSteamUsers(steamPath, fs = Neutralino.filesystem) {
  let entries = [];
  try {
    entries = await fs.readDirectory(joinPath(steamPath, 'userdata'));
  } catch (err) {
    return [];
  }

  let logins = {};
  try {
    logins = parseLoginUsers(await fs.readFile(joinPath(steamPath, 'config', 'loginusers.vdf')));
  } catch (err) {
  }

  const users = [];
  for (const item of entries) {
    if (item.type !== 'DIRECTORY' || !/^\d+$/.test(item.entry) || item.entry === '0') continue;

    const info = logins[item.entry] || {};
    const configDir = joinPath(item.path, 'config');
    const shortcutsPath = joinPath(configDir, 'shortcuts.vdf');

    let shortcutsExists = false;
    let shortcutsSize = 0;
    try {
      shortcutsSize = (await fs.getStats(shortcutsPath)).size;
      shortcutsExists = true;
    } catch (err) {
    }

    users.push({
      accountId: item.entry,
      name: info.personaName || info.accountName || `User ${item.entry}`,
      mostRecent: !!info.mostRecent,
      configDir,
      shortcutsPath,
      shortcutsExists,
      shortcutsSize,
    });
  }

  users.sort((a, b) => (b.mostRecent - a.mostRecent) || a.accountId.localeCompare(b.accountId));
  return users;
}

async function readShortcutsFile(shortcutsPath, fs = Neutralino.filesystem) {
  const bytes = new Uint8Array(await fs.readBinaryFile(shortcutsPath));
  const validHeader = SHORTCUTS_HEADER.every((byte, i) => bytes[i] === byte);
  return { size: bytes.length, validHeader };
}

const VDF_OBJECT = 0x00;
const VDF_STRING = 0x01;
const VDF_INT32 = 0x02;
const VDF_END = 0x08;

function parseVdf(bytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 0;

  function readCString() {
    const end = bytes.indexOf(0x00, pos);
    if (end === -1) throw new Error('Corrupted shortcuts.vdf (unterminated text)');
    const text = decoder.decode(bytes.subarray(pos, end));
    pos = end + 1;
    return text;
  }

  function readObject() {
    const entries = [];
    while (true) {
      if (pos >= bytes.length) throw new Error('Corrupted shortcuts.vdf (unexpected end of file)');
      const type = bytes[pos++];
      if (type === VDF_END) return entries;

      const key = readCString();
      if (type === VDF_OBJECT) {
        entries.push({ type, key, value: readObject() });
      } else if (type === VDF_STRING) {
        entries.push({ type, key, value: readCString() });
      } else if (type === VDF_INT32) {
        if (pos + 4 > bytes.length) throw new Error('Corrupted shortcuts.vdf (truncated number)');
        entries.push({ type, key, value: view.getInt32(pos, true) });
        pos += 4;
      } else {
        throw new Error(`Unsupported data type 0x${type.toString(16)} in shortcuts.vdf`);
      }
    }
  }

  const tree = readObject();
  if (pos !== bytes.length) throw new Error('Unexpected extra data at the end of shortcuts.vdf');
  return tree;
}

function serializeVdf(tree) {
  const encoder = new TextEncoder();
  const chunks = [];

  function writeCString(text) {
    if (text.includes('\0')) throw new Error('Text with a null character cannot be saved');
    chunks.push(encoder.encode(text), Uint8Array.of(0x00));
  }

  function writeObject(entries) {
    for (const { type, key, value } of entries) {
      chunks.push(Uint8Array.of(type));
      writeCString(key);
      if (type === VDF_OBJECT) {
        writeObject(value);
      } else if (type === VDF_STRING) {
        writeCString(value);
      } else if (type === VDF_INT32) {
        const num = new Uint8Array(4);
        new DataView(num.buffer).setInt32(0, value, true);
        chunks.push(num);
      } else {
        throw new Error(`Unsupported data type 0x${type.toString(16)}`);
      }
    }
    chunks.push(Uint8Array.of(VDF_END));
  }

  writeObject(tree);

  const out = new Uint8Array(chunks.reduce((sum, c) => sum + c.length, 0));
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

let crcTable = null;

function crc32(text) {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function generateAppId(quotedExe, appName) {
  return (crc32(quotedExe + appName) | 0x80000000) >>> 0;
}

function getShortcutsEntries(tree) {
  const root = tree.find((e) => e.type === VDF_OBJECT && e.key.toLowerCase() === 'shortcuts');
  if (!root) throw new Error('shortcuts.vdf has no "shortcuts" section');
  return root.value;
}

function exeKey(exePath) {
  return exePath.replace(/^"|"$/g, '').replace(/\//g, '\\').toLowerCase();
}

function shortcutAppId(game) {
  return generateAppId(`"${normalizePath(game.exePath)}"`, game.name);
}

async function planShortcuts(user, games, fs = Neutralino.filesystem) {
  const existingIds = new Map();
  if (await pathExists(fs, user.shortcutsPath)) {
    const tree = parseVdf(await readBytes(fs, user.shortcutsPath));
    for (const entry of getShortcutsEntries(tree)) {
      const exeField = entry.value.find((f) => f.key.toLowerCase() === 'exe');
      const idField = entry.value.find((f) => f.key.toLowerCase() === 'appid');
      const nameField = entry.value.find((f) => f.key.toLowerCase() === 'appname');
      if (exeField && idField) {
        existingIds.set(exeKey(exeField.value), { appId: idField.value >>> 0, name: nameField ? nameField.value : '' });
      }
    }
  }
  return games.map((game) => {
    const existing = existingIds.get(exeKey(game.exePath));
    return {
      game,
      appId: existing !== undefined ? existing.appId : shortcutAppId(game),
      isNew: existing === undefined,
      existingName: existing !== undefined ? existing.name : '',
    };
  });
}

function buildShortcutEntry(index, game) {
  const exe = normalizePath(game.exePath);
  const quotedExe = `"${exe}"`;
  const dirEnd = Math.max(exe.lastIndexOf('\\'), exe.lastIndexOf('/'));
  const startDir = `"${exe.slice(0, dirEnd + 1)}"`;

  const str = (key, value) => ({ type: VDF_STRING, key, value });
  const int = (key, value) => ({ type: VDF_INT32, key, value });

  return {
    type: VDF_OBJECT,
    key: String(index),
    value: [
      int('appid', shortcutAppId(game) | 0),
      str('AppName', game.name),
      str('Exe', quotedExe),
      str('StartDir', startDir),
      str('icon', game.iconPath || ''),
      str('ShortcutPath', ''),
      str('LaunchOptions', ''),
      int('IsHidden', 0),
      int('AllowDesktopConfig', 1),
      int('AllowOverlay', 1),
      int('OpenVR', 0),
      int('Devkit', 0),
      str('DevkitGameID', ''),
      int('DevkitOverrideAppID', 0),
      int('LastPlayTime', 0),
      str('FlatpakAppID', ''),
      { type: VDF_OBJECT, key: 'tags', value: [] },
    ],
  };
}

function sameBytes(a, b) {
  return a.length === b.length && a.every((byte, i) => byte === b[i]);
}

async function readBytes(fs, filePath) {
  return new Uint8Array(await fs.readBinaryFile(filePath));
}

async function writeBytes(fs, filePath, bytes) {
  await fs.writeBinaryFile(filePath, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
}

async function createBackup(fs, shortcutsPath, originalBytes) {
  const backupPath = `${shortcutsPath}.bak`;
  await writeBytes(fs, backupPath, originalBytes);
  if (!sameBytes(await readBytes(fs, backupPath), originalBytes)) {
    throw new Error('Backup verification failed. Nothing was changed.');
  }

  const firstBackupPath = `${shortcutsPath}.original.bak`;
  if (!(await pathExists(fs, firstBackupPath))) {
    await writeBytes(fs, firstBackupPath, originalBytes);
  }
  return backupPath;
}

async function addGamesToShortcuts(user, games, fs = Neutralino.filesystem) {
  const target = user.shortcutsPath;
  const exists = await pathExists(fs, target);

  let originalBytes = null;
  let tree;
  if (exists) {
    originalBytes = await readBytes(fs, target);
    tree = parseVdf(originalBytes);
  } else {
    tree = [{ type: VDF_OBJECT, key: 'shortcuts', value: [] }];
  }
  const list = getShortcutsEntries(tree);

  const known = new Set();
  let nextIndex = 0;
  for (const entry of list) {
    const exeField = entry.value.find((f) => f.key.toLowerCase() === 'exe');
    if (exeField) known.add(exeKey(exeField.value));
    if (/^\d+$/.test(entry.key)) nextIndex = Math.max(nextIndex, Number(entry.key) + 1);
  }

  const added = [];
  const skipped = [];
  for (const game of games) {
    const key = exeKey(game.exePath);
    if (known.has(key)) {
      skipped.push(game.name);
      continue;
    }
    list.push(buildShortcutEntry(nextIndex++, game));
    known.add(key);
    added.push(game.name);
  }
  if (added.length === 0) return { added, skipped, backupPath: null };

  const output = serializeVdf(tree);
  if (getShortcutsEntries(parseVdf(output)).length !== list.length) {
    throw new Error('Internal check failed. Nothing was changed.');
  }

  let backupPath = null;
  if (exists) {
    backupPath = await createBackup(fs, target, originalBytes);
  } else if (!(await pathExists(fs, user.configDir))) {
    await fs.createDirectory(user.configDir);
  }

  try {
    await writeBytes(fs, target, output);
    if (!sameBytes(await readBytes(fs, target), output)) {
      throw new Error('the saved file does not match what was written');
    }
  } catch (err) {
    let restored = false;
    try {
      if (originalBytes) {
        await writeBytes(fs, target, originalBytes);
        restored = sameBytes(await readBytes(fs, target), originalBytes);
      } else {
        await fs.remove(target);
        restored = true;
      }
    } catch (restoreErr) {
      restored = false;
    }
    if (!restored) {
      throw new Error(`Write failed (${err.message}) and restoring the original also failed. Your backup is at ${backupPath}`);
    }
    throw new Error(`Write failed (${err.message}). Your original file was restored.`);
  }

  return { added, skipped, backupPath };
}

if (typeof module !== 'undefined') {
  module.exports = {
    findSteamPath, getSteamUsers, readShortcutsFile,
    parseLoginUsers, parseRegValue, isValidSteamPath,
    parseVdf, serializeVdf, crc32, generateAppId, shortcutAppId, planShortcuts, addGamesToShortcuts,
  };
}
