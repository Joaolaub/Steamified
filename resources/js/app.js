function log(message) {
  console.log(`[Steamified] ${message}`);
}

function showStatus(message, type = 'error') {
  log(message);
  const el = document.getElementById('status');
  el.textContent = message;
  el.className = `status ${type}`;
  el.hidden = false;
}

function clearStatus() {
  document.getElementById('status').hidden = true;
}

const steamState = { path: null, users: [], selected: null };

async function describeShortcuts(user) {
  if (!user.shortcutsExists) {
    return 'No shortcuts.vdf yet for this account (it will be created when you add games).';
  }
  try {
    const info = await readShortcutsFile(user.shortcutsPath);
    return info.validHeader
      ? `shortcuts.vdf found (${info.size} bytes, valid header).`
      : `shortcuts.vdf found (${info.size} bytes) but the header looks unexpected. It will not be modified.`;
  } catch (err) {
    return `Could not read shortcuts.vdf: ${err.message || JSON.stringify(err)}`;
  }
}

async function selectSteamUser(accountId) {
  steamState.selected = steamState.users.find((u) => u.accountId === accountId) || null;
  const info = document.getElementById('steam-shortcuts');
  if (!steamState.selected) {
    info.textContent = '';
    return;
  }
  info.textContent = await describeShortcuts(steamState.selected);
  log(`Account selected: ${steamState.selected.name} (${steamState.selected.accountId})`);
  await refreshInSteam();
}

async function loadSteam(steamPath, preferredAccountId = null) {
  clearStatus();
  steamState.path = steamPath;
  document.getElementById('steam-path').textContent = `Steam folder: ${steamPath}`;
  log(`Steam found: ${steamPath}`);

  steamState.users = await getSteamUsers(steamPath);

  for (const user of steamState.users) {
    const status = user.shortcutsExists ? `${user.shortcutsSize} bytes` : 'NOT found';
    log(`Account ${user.accountId} (${user.name}): shortcuts.vdf ${status} -> ${user.shortcutsPath}`);
  }

  const select = document.getElementById('steam-user');
  select.replaceChildren();
  for (const user of steamState.users) {
    const option = document.createElement('option');
    option.value = user.accountId;
    option.textContent = `${user.name} (${user.accountId})${user.mostRecent ? ' - last used' : ''}`;
    select.append(option);
  }

  const hasUsers = steamState.users.length > 0;
  select.hidden = !hasUsers;
  document.getElementById('steam-user-row').hidden = !hasUsers;

  if (hasUsers) {
    const first = steamState.users.find((u) => u.accountId === preferredAccountId) || steamState.users[0];
    select.value = first.accountId;
    await selectSteamUser(first.accountId);
  } else {
    steamState.selected = null;
    document.getElementById('steam-shortcuts').textContent =
      'No Steam accounts found. Log in to Steam at least once and try again.';
    log('No accounts found in userdata.');
  }
}

async function detectSteam() {
  try {
    const steamPath = await findSteamPath();
    if (steamPath) {
      await loadSteam(steamPath);
    } else {
      document.getElementById('steam-path').textContent =
        'Steam not found automatically. Choose its folder manually.';
      log('Steam not found automatically.');
    }
  } catch (err) {
    showStatus(`Error looking for Steam: ${err.message || JSON.stringify(err)}`);
  }
}

async function pickSteamFolder() {
  try {
    const folder = await Neutralino.os.showFolderDialog('Select your Steam folder');
    if (!folder) return;
    const steamPath = normalizePath(folder);
    if (!(await isValidSteamPath(Neutralino.filesystem, steamPath))) {
      showStatus('That folder does not look like a Steam installation (no steam.exe or userdata).');
      return;
    }
    await loadSteam(steamPath);
  } catch (err) {
    showStatus(`Error: ${err.message || JSON.stringify(err)}`);
  }
}

const sgdbState = { key: '' };

function renderSgdbStatus() {
  const el = document.getElementById('sgdb-status');
  el.textContent = sgdbState.key
    ? `API key saved (ends with ${sgdbState.key.slice(-4)}). Artwork will be downloaded.`
    : 'No API key saved. Games will be added without artwork.';
}

async function initSgdb() {
  sgdbState.key = await loadApiKey();
  renderSgdbStatus();
}

async function saveKey() {
  const input = document.getElementById('sgdb-key');
  try {
    clearStatus();
    sgdbState.key = await saveApiKey(input.value);
    input.value = '';
    renderSgdbStatus();
    onKeyChanged();
  } catch (err) {
    showStatus(err.message || JSON.stringify(err));
  }
}

function openKeyPage() {
  Neutralino.os.open('https://www.steamgriddb.com/profile/preferences/api');
}

const scanState = { games: [] };

function selectedGames() {
  return scanState.games.filter((g) => g.selected);
}

function relativeExe(game, exePath) {
  const prefix = game.folder.replace(/[\\/]+$/, '');
  return exePath.startsWith(prefix) ? exePath.slice(prefix.length + 1) : exePath;
}

function updateSelectionUi() {
  const total = scanState.games.length;
  const count = selectedGames().length;

  document.getElementById('games-count').textContent = `(${count} of ${total} selected)`;

  const all = document.getElementById('select-all');
  all.checked = total > 0 && count === total;
  all.indeterminate = count > 0 && count < total;

  const button = document.getElementById('btn-apply');
  button.textContent = count === 1 ? 'Add 1 game to Steam' : `Add ${count} games to Steam`;
  button.disabled = count === 0;
}

function showMatch(game, text) {
  game.matchText = text;
  renderMatchLine(game);
}

function renderMatchLine(game) {
  const parts = [];
  if (game.inSteam) parts.push(`Already in Steam as "${game.existingName}" (that name is kept).`);
  if (game.matchText) parts.push(game.matchText);
  game.ui.matchEl.textContent = parts.join(' ');
  game.ui.nameInput.disabled = game.inSteam;
  game.ui.nameInput.title = game.inSteam ? 'Already in Steam: its name is kept' : 'Name shown in Steam';
}

function createPicker(game) {
  const panel = document.createElement('div');
  panel.className = 'game-picker';
  panel.hidden = true;

  const input = document.createElement('input');
  input.type = 'text';
  input.placeholder = 'Game name, SteamGridDB link or ID';
  input.spellcheck = false;

  const searchBtn = document.createElement('button');
  searchBtn.textContent = 'Search';
  searchBtn.className = 'small';

  const autoBtn = document.createElement('button');
  autoBtn.textContent = 'Use automatic matching';
  autoBtn.className = 'small secondary';

  const row = document.createElement('div');
  row.className = 'actions';
  row.append(input, searchBtn, autoBtn);

  const results = document.createElement('div');
  results.className = 'picker-results';

  panel.append(row, results);

  function choose(id, name, isRealName = true) {
    game.sgdbId = id;
    game.sgdbName = name;
    game.matchState = 'manual';
    if (isRealName && !game.inSteam) {
      game.name = name;
      game.nameEdited = true;
      game.ui.nameInput.value = name;
    }
    showMatch(game, `SteamGridDB (manual): ${name}`);
    results.replaceChildren();
    panel.hidden = true;
  }

  async function search() {
    results.replaceChildren();
    const term = input.value.trim();
    if (!term) return;

    const ref = parseGameReference(term);
    if (ref) return choose(ref, `ID ${ref}`, false);

    const message = document.createElement('p');
    message.className = 'muted';
    results.append(message);

    if (!sgdbState.key) {
      message.textContent = 'Save your SteamGridDB API key first.';
      return;
    }
    message.textContent = 'Searching...';
    try {
      const found = await searchGames(term, sgdbState.key);
      results.replaceChildren();
      if (found.length === 0) {
        message.textContent = 'No results. Try another name, or paste the game link from steamgriddb.com.';
        results.append(message);
        return;
      }
      for (const item of found) {
        const option = document.createElement('button');
        option.className = 'secondary small';
        option.textContent = `${item.name}${item.verified ? ' (verified)' : ''}`;
        option.addEventListener('click', () => choose(item.id, item.name));
        results.append(option);
      }
    } catch (err) {
      message.textContent = err.message || 'Search failed.';
    }
  }

  searchBtn.addEventListener('click', search);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });
  autoBtn.addEventListener('click', () => {
    game.sgdbId = null;
    game.sgdbName = '';
    game.nameEdited = false;
    results.replaceChildren();
    panel.hidden = true;
    matchOne(game).catch((err) => showMatch(game, err.message || 'Search failed.'));
  });

  return { panel, input };
}

function createGameRow(game) {
  const li = document.createElement('li');
  li.className = 'game';

  const main = document.createElement('div');
  main.className = 'game-main';

  const check = document.createElement('input');
  check.type = 'checkbox';
  check.checked = game.selected;
  check.title = 'Include this game';
  check.addEventListener('change', () => {
    game.selected = check.checked;
    updateSelectionUi();
  });

  const nameInput = document.createElement('input');
  nameInput.type = 'text';
  nameInput.className = 'game-name-input';
  nameInput.value = game.name;
  nameInput.title = 'Name shown in Steam';
  nameInput.spellcheck = false;
  nameInput.addEventListener('input', () => { game.name = nameInput.value; game.nameEdited = true; });

  const fixBtn = document.createElement('button');
  fixBtn.className = 'secondary small';
  fixBtn.textContent = 'Fix match';
  fixBtn.title = 'Choose the correct game on SteamGridDB';

  main.append(check, nameInput, fixBtn);

  const exeLine = document.createElement('div');
  exeLine.className = 'game-exe-line';
  if (game.candidates.length > 1) {
    const select = document.createElement('select');
    select.title = 'Choose which executable starts the game';
    for (const candidate of game.candidates) {
      const option = document.createElement('option');
      option.value = candidate.path;
      option.textContent = relativeExe(game, candidate.path);
      select.append(option);
    }
    select.value = game.exePath;
    select.addEventListener('change', () => { game.exePath = select.value; refreshInSteam(); });
    exeLine.append(select);
  } else {
    const exe = document.createElement('span');
    exe.className = 'game-exe';
    exe.textContent = relativeExe(game, game.exePath);
    exe.title = game.exePath;
    exeLine.append(exe);
  }

  const matchEl = document.createElement('div');
  matchEl.className = 'game-match muted';

  game.ui = { check, matchEl, nameInput };
  const picker = createPicker(game);
  fixBtn.addEventListener('click', () => {
    picker.panel.hidden = !picker.panel.hidden;
    if (!picker.panel.hidden) {
      picker.input.value = game.name;
      picker.input.focus();
    }
  });

  li.append(main, exeLine, matchEl, picker.panel);
  return li;
}

function renderGames(games) {
  scanState.games = games.map((g) => ({
    ...g,
    originalName: g.name,
    name: cleanGameName(g.name),
    nameEdited: false,
    selected: true,
    sgdbId: null,
    sgdbName: '',
    matchState: sgdbState.key ? 'pending' : 'nokey',
    matchText: '',
    inSteam: false,
    existingName: '',
  }));

  const list = document.getElementById('games-list');
  list.replaceChildren(...scanState.games.map(createGameRow));
  for (const game of scanState.games) showMatch(game, sgdbState.key ? 'Waiting to search SteamGridDB...' : '');

  document.getElementById('games-card').hidden = false;
  updateSelectionUi();
}

async function pickFolder() {
  try {
    const folder = await Neutralino.os.showFolderDialog('Select your games folder');
    if (!folder) {
      log('Folder selection cancelled.');
      return;
    }
    clearStatus();
    document.getElementById('folder-path').textContent = folder;
    log(`Selected folder: ${folder}`);

    const games = await scanGamesFolder(folder);
    renderGames(games);
    log(`Scan finished: ${games.length} game(s) detected.`);
    if (games.length === 0) {
      showStatus('No games found in that folder (no valid .exe files).');
      return;
    }
    await refreshInSteam();
    await runMatching();
    notifyRenamed();
  } catch (err) {
    showStatus(`Error: ${err.message || JSON.stringify(err)}`);
  }
}

const MATCH_SURE = 0.97;

async function matchOne(game) {
  if (!sgdbState.key) {
    game.matchState = 'nokey';
    showMatch(game, '');
    return;
  }
  showMatch(game, 'Searching SteamGridDB...');
  try {
    const { match, suggestions } = await findGame(game.originalName, sgdbState.key);

    if (!match) {
      game.matchState = 'notfound';
      const closest = suggestions.length ? ` Closest: "${suggestions[0]}".` : '';
      showMatch(game, `Not found on SteamGridDB.${closest} Use "Fix match".`);
    } else if (match.score >= MATCH_SURE) {
      game.sgdbId = match.id;
      game.sgdbName = match.name;
      game.matchState = 'matched';
      if (!game.nameEdited && !game.inSteam) {
        game.name = match.name;
        game.ui.nameInput.value = match.name;
      }
      showMatch(game, `SteamGridDB: ${match.name}`);
    } else {
      game.sgdbId = match.id;
      game.sgdbName = match.name;
      game.matchState = 'similar';
      showMatch(game, `Similar match on SteamGridDB: "${match.name}". Your name was kept; use "Fix match" to confirm or change it.`);
    }
  } catch (err) {
    game.matchState = 'error';
    showMatch(game, `Search failed: ${err.message || 'unknown error'}`);
    throw err;
  }
}

async function runMatching() {
  if (!sgdbState.key) return;
  const targets = scanState.games.filter((g) => !g.sgdbId);
  if (targets.length === 0) return;

  document.body.classList.add('busy');
  try {
    for (let i = 0; i < targets.length; i++) {
      setProgress(i / targets.length, `Searching SteamGridDB ${i + 1}/${targets.length}: ${targets[i].originalName}`);
      try {
        await matchOne(targets[i]);
      } catch (err) {
        if (['AUTH', 'RATE', 'NETWORK'].includes(err.code)) {
          showStatus(err.message);
          break;
        }
      }
    }
  } finally {
    document.body.classList.remove('busy');
    setProgress(null);
    updateSelectionUi();
  }
}

function onKeyChanged() {
  for (const game of scanState.games) {
    if (!game.sgdbId) showMatch(game, sgdbState.key ? 'Waiting to search SteamGridDB...' : '');
  }
  runMatching().then(notifyRenamed);
}

async function refreshInSteam() {
  const user = steamState.selected;
  if (!user || scanState.games.length === 0) return;
  try {
    const plan = await planShortcuts(user, scanState.games.map((g) => ({ name: g.name, exePath: g.exePath })));
    plan.forEach((item, i) => {
      const game = scanState.games[i];
      const becameInSteam = !game.inSteam && !item.isNew;
      const leftSteam = game.inSteam && item.isNew;
      game.inSteam = !item.isNew;
      game.existingName = item.existingName;
      if (becameInSteam) {
        game.selected = false;
        game.ui.check.checked = false;
      }
      if (leftSteam) {
        game.selected = true;
        game.ui.check.checked = true;
        if (game.matchState === 'matched' && !game.nameEdited) {
          game.name = game.sgdbName;
          game.ui.nameInput.value = game.sgdbName;
        }
      }
      renderMatchLine(game);
    });
    updateSelectionUi();
  } catch (err) {
    log(`Could not check existing shortcuts: ${err.message || JSON.stringify(err)}`);
  }
}

function notifyRenamed() {
  const different = scanState.games.filter((g) => g.inSteam && g.sgdbName && g.existingName !== g.sgdbName);
  if (different.length === 0) return;
  const g = different[0];
  const more = different.length > 1 ? ` (+${different.length - 1} more)` : '';
  showStatus(
    `Already in Steam with a different name: "${g.existingName}" (official: "${g.sgdbName}")${more}. ` +
    'Steam keeps the old name. To use the official one, remove the game from your Steam library and add it again here.',
    'ok'
  );
}

function setProgress(fraction, text) {
  const wrap = document.getElementById('progress-wrap');
  if (fraction === null) {
    wrap.hidden = true;
    return;
  }
  wrap.hidden = false;
  document.getElementById('progress-bar').style.width = `${Math.round(fraction * 100)}%`;
  document.getElementById('progress').textContent = text;
}

function buildResultMessage(result, art, artError, total) {
  const parts = [];

  if (result.added.length === 0) {
    parts.push(`Nothing to add: all ${total} game(s) are already in Steam.`);
  } else {
    const skipped = result.skipped.length ? ` ${result.skipped.length} already existed and were skipped.` : '';
    parts.push(`${result.added.length} game(s) added.${skipped} Backup saved as shortcuts.vdf.bak.`);
  }

  if (art) {
    parts.push(`Artwork: ${art.downloaded} image(s) downloaded.`);
    if (art.fuzzy.length) {
      const shown = art.fuzzy.slice(0, 3).map((f) => `${f.folder} -> ${f.matched}`).join(', ');
      const more = art.fuzzy.length > 3 ? ` (+${art.fuzzy.length - 3} more)` : '';
      parts.push(`Matched by similarity: ${shown}${more}.`);
    }
    if (art.notFoundDetails.length) {
      const shown = art.notFoundDetails.slice(0, 3)
        .map((d) => (d.suggestions.length ? `${d.name} (closest: ${d.suggestions[0]})` : d.name))
        .join(', ');
      const more = art.notFoundDetails.length > 3 ? ` (+${art.notFoundDetails.length - 3} more)` : '';
      parts.push(`Not found on SteamGridDB: ${shown}${more}. Use "Fix match" on those games and run again.`);
    }
    if (art.failed.length) parts.push(`${art.failed.length} image(s) failed to download.`);
    if (art.stoppedEarly) parts.push(`${art.stoppedEarly} Run it again later to get the rest.`);
  } else if (artError) {
    parts.push(`Artwork could not be downloaded: ${artError}`);
  } else {
    parts.push('No API key saved, so no artwork was downloaded.');
  }

  parts.push('If Steam was open, close it from the tray icon and open it again to see the changes.');
  return parts.join(' ');
}

function showArtResults(chosen, art) {
  art.perGame.forEach((item, i) => {
    const game = chosen[i].original;
    if (!item.found) showMatch(game, 'Not found on SteamGridDB');
    else if (item.matched) showMatch(game, `SteamGridDB: ${item.matched}`);
    else showMatch(game, 'Artwork already present');
  });
}

async function applyToSteam() {
  clearStatus();
  const user = steamState.selected;
  if (!user) return showStatus('Select a Steam account first.');

  const chosen = selectedGames().map((game) => ({
    original: game,
    game: {
      ...game,
      name: game.name.trim() || game.originalName,
      skipSearch: game.matchState === 'notfound' || game.matchState === 'error',
    },
  }));
  if (chosen.length === 0) return showStatus('No games selected.');

  const artLine = sgdbState.key
    ? 'Covers, banners, heroes, logos and icons will be downloaded from SteamGridDB.\n\n'
    : '';
  const answer = await Neutralino.os.showMessageBox(
    'Add games to Steam',
    `Add ${chosen.length} game(s) to the Steam account "${user.name}"?\n\n${artLine}` +
    'Steam must be completely closed first (tray icon > Exit), otherwise it may overwrite the changes.\n\n' +
    'A backup (shortcuts.vdf.bak) is created automatically.',
    'YES_NO',
    'QUESTION'
  );
  if (answer !== 'YES') return;

  document.body.classList.add('busy');
  try {
    setProgress(0.02, 'Reading shortcuts.vdf...');
    const plan = await planShortcuts(user, chosen.map((c) => c.game));

    let art = null;
    let artError = '';
    const iconByAppId = new Map();
    if (sgdbState.key) {
      try {
        art = await downloadAllArt(
          plan.map(({ game, appId }) => ({ game, appId })),
          joinPath(user.configDir, 'grid'),
          sgdbState.key,
          ({ index, total, name }) => setProgress(0.05 + 0.85 * ((index - 1) / total), `Artwork ${index}/${total}: ${name}`)
        );
        for (const item of art.perGame) iconByAppId.set(item.appId, item.iconPath);
        showArtResults(chosen, art);
      } catch (err) {
        if (err.code === 'AUTH') {
          showStatus(`${err.message} No games were added.`);
          return;
        }
        artError = err.message || JSON.stringify(err);
      }
    }

    setProgress(0.93, 'Updating shortcuts.vdf...');
    const gamesToAdd = plan.map(({ game, appId }) => ({ ...game, iconPath: iconByAppId.get(appId) || '' }));
    const result = await addGamesToShortcuts(user, gamesToAdd);

    setProgress(1, 'Done.');
    await loadSteam(steamState.path, user.accountId);
    showStatus(buildResultMessage(result, art, artError, chosen.length), 'ok');
  } catch (err) {
    showStatus(`Could not update shortcuts.vdf: ${err.message || JSON.stringify(err)}`);
  } finally {
    document.body.classList.remove('busy');
    setProgress(null);
    updateSelectionUi();
  }
}

function init() {
  Neutralino.init();

  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    showStatus(`Unexpected error: ${(reason && reason.message) || reason}`);
    if (event.preventDefault) event.preventDefault();
  });
  window.addEventListener('error', (event) => {
    showStatus(`Unexpected error: ${event.message}`);
  });

  Neutralino.events.on('windowClose', () => Neutralino.app.exit());

  document.getElementById('btn-pick-folder').addEventListener('click', pickFolder);
  document.getElementById('btn-pick-steam').addEventListener('click', pickSteamFolder);
  document.getElementById('btn-recheck-steam').addEventListener('click', () => {
    return steamState.path ? loadSteam(steamState.path) : detectSteam();
  });
  document.getElementById('btn-apply').addEventListener('click', applyToSteam);
  document.getElementById('select-all').addEventListener('change', (e) => {
    for (const game of scanState.games) {
      game.selected = e.target.checked;
      game.ui.check.checked = e.target.checked;
    }
    updateSelectionUi();
  });
  document.getElementById('btn-save-key').addEventListener('click', saveKey);
  document.getElementById('btn-get-key').addEventListener('click', openKeyPage);
  document.getElementById('steam-user').addEventListener('change', (e) => selectSteamUser(e.target.value));
  log('Steamified started successfully.');
  detectSteam();
  initSgdb();
}

init();
