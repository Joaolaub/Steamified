# Steamified

Programa leve para Windows que escaneia uma pasta de jogos que não são da Steam, adiciona os
executáveis à biblioteca da Steam e baixa capas, banners, heroes, logos e ícones do SteamGridDB,
usando o nome oficial de cada jogo.

## Como usar

1. **Steam:** o app localiza sua Steam sozinho. Se tiver mais de uma conta, escolha qual usar.
2. **SteamGridDB:** crie uma chave de API gratuita (botão "Get a free key"), cole e salve. Sem a
   chave, os jogos são adicionados normalmente, só que sem artes.
3. **Games folder:** escolha a pasta que contém seus jogos (cada subpasta é um jogo).
4. **Detected games:** confira a lista. Dá para desmarcar jogos, editar o nome, trocar o executável
   e usar "Fix match" se o jogo do SteamGridDB estiver errado. Depois clique em **Add games to Steam**.

**Feche a Steam por completo antes de adicionar** (ícone na bandeja, botão direito, Exit).
Se ela estiver aberta, pode sobrescrever as alterações ao fechar. Depois abra a Steam e os jogos
estarão na biblioteca.

### Segurança dos seus dados

- Antes de qualquer alteração, o app cria `shortcuts.vdf.bak` (estado anterior à última alteração) e
  `shortcuts.vdf.original.bak` (criado uma vez e nunca sobrescrito) na pasta da sua conta da Steam.
- Atalhos que você já tem nunca são alterados nem apagados.
- Jogos que já estão na Steam mantêm o nome que têm (renomear mudaria o identificador das capas).
  Para usar o nome oficial, remova o jogo da biblioteca da Steam e adicione de novo no Steamified.
- A chave de API fica salva no computador, sem criptografia. Não a compartilhe.

### Requisitos e avisos

- Windows 10 ou 11 com o WebView2 (já vem com o Windows atualizado e com o Edge).
- O Windows pode mostrar um aviso do SmartScreen, porque o executável não é assinado digitalmente.
  Clique em "Mais informações" e depois em "Executar assim mesmo".

## Desenvolvimento

```bash
npm install -g @neutralinojs/neu   # uma vez
npm install                        # instala o jsdom, usado nos testes
npm start                          # abre o app em modo de desenvolvimento (neu run)
npm test                           # roda todos os testes
npm run build                      # gera dist/Steamified-win_x64/ (sem inspetor nem log)
```

## Estrutura

```
resources/
  index.html, styles.css
  js/  app.js (interface) | scanner.js | steam.js (Steam e shortcuts.vdf) | steamgriddb.js
  fonts/  JetBrains Mono (OFL)
tests/   testes automatizados (Node; a interface é testada com jsdom)
scripts/ build.js
```