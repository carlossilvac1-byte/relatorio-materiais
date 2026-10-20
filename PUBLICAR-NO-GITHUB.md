# Publicar no GitHub Pages — Relatório Fotográfico de Materiais

## 1. Repositório
1. Em <https://github.com> → **New** → nome `relatorio-materiais` → **Public** → sem README → **Create repository**.

## 2. Enviar os arquivos
1. Na página do repositório vazio → **uploading an existing file**.
2. Abra a pasta `relatorio-materiais-edp` e selecione **tudo o que está dentro dela**
   (arquivos soltos e as pastas `assets`, `icons`, `images`, `vendor`, `banco`) e arraste.
   - O `index.html` precisa ficar na raiz do repositório (não arraste a pasta inteira nem um .zip).
   - **NÃO envie** `banco/02-base-de-acessos.sql` (tem e-mails da equipe).
   - `iniciar-servidor.bat` e `servidor.ps1` podem ficar de fora (só servem para testar no computador).
3. **Commit changes**.

## 3. Ligar o GitHub Pages
**Settings → Pages** → *Source*: **Deploy from a branch** → **main** / **(root)** → **Save**.
Em 1 a 2 minutos: `https://carlossilvac1-byte.github.io/relatorio-materiais/`.
Confira em **Actions** se "pages build and deployment" terminou com sinal verde.

## 4. Instalar no celular
- **Android (Chrome):** menu ⋮ → **Instalar aplicativo**.
- **iPhone (Safari):** Compartilhar → **Adicionar à Tela de Início**. Abra sempre pelo ícone.
- Abra **uma vez com internet** logo após instalar: é quando o app se guarda no aparelho.
- Permita **Câmera** e **Localização** quando o app pedir (GPS em tempo real).

## 5. Atualizar depois
**Add file → Upload files** com os arquivos alterados → **Commit changes**.
Sempre suba juntos `config.js` (versão), `service-worker.js` (VERSAO) e `versao.txt`.
Publicação presa em "Queued": envie de novo o `versao.txt` alterado.

## Testar no computador antes de publicar
Duplo clique em `iniciar-servidor.bat` → abre em `http://localhost:8090`.
