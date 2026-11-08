# Steamified

Extremely lightweight program built with neutralinojs for Windows that scans a non-Steam games folder, adds executables to the Steam library and downloads covers, banners, heroes, logos and icons from SteamGridDB, using the official name of each game.

## How to use

1. **Steam:** the app locates your Steam by itself. If you have more than one account, choose which one to use.
2. **SteamGridDB:** create a free API key ("Get a free key" button), paste and save. Without the key, games are added normally, just without artwork.
3. **Games folder:** choose the folder that contains your games (each subfolder is a game).
4. **Detected games:** check the list. You can uncheck games, edit the name, change the executable and use "Fix match" if the SteamGridDB game is wrong. Then click **Add games to Steam**.

**Close Steam completely before adding** (tray icon, right click, Exit).
If it is open, it may overwrite changes upon closing. Then open Steam and the games will be in the library.

### Security of your data

- Before any change, the app creates `shortcuts.vdf.bak` (state prior to the last change) and `shortcuts.vdf.original.bak` (created once and never overwritten) in your Steam account folder.
- Shortcuts you already have are never changed or deleted.
- Games that are already in Steam keep the name they have (renaming would change the cover identifier). To use the official name, remove the game from the Steam library and add it again in Steamified.
- The API key is saved on the computer, unencrypted. Do not share it.

### Requirements and notices

- Windows 10 or 11 with WebView2 (already comes with updated Windows and with Edge).
- Windows may show a SmartScreen warning, because the executable is not digitally signed. Click "More info" and then "Run anyway".

## Development

```bash
npm install -g @neutralinojs/neu   # once
npm install                        # installs jsdom, used in tests
npm start                          # opens the app in development mode (neu run)
npm test                           # runs all tests
npm run build                      # generates dist/Steamified-win_x64/ (without inspector or log)
```

## Structure

```
resources/
  index.html, styles.css
  js/  app.js (interface) | scanner.js | steam.js (Steam and shortcuts.vdf) | steamgriddb.js
  fonts/  JetBrains Mono (OFL)
tests/   automated tests (Node; the interface is tested with jsdom)
scripts/ build.js
```
