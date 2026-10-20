# Relatório Fotográfico de Materiais | EDP Transmissão Construção — v1.0.0

PWA (HTML/CSS/JS puro, sem build) no padrão do app de Inspeções: offline primeiro,
Supabase como base central, GitHub Pages como hospedagem.

## O que faz
- Relatório de **Recebimento** (NF, fornecedor, canteiro, descrição) ou **Saída**
  (NF, fornecedor, transportadora, trecho, torre, descrição), com projeto, lote e data.
- **6 espaços de foto** (tirar ou anexar), cada um com a sua observação.
- **Não conformidade** Sim/Não: ao marcar Sim, descrição obrigatória + até 6 fotos.
- **GPS em tempo real** com mapa (OpenStreetMap / Satélite Esri); tocar no mapa fixa o ponto.
- **PDF no formato EDP** (individual e consolidado), gerado no aparelho; planilha CSV; backup JSON.
- Acesso com liberação pelo administrador (tela Liberações), visão "próprias" ou "todas".

## Arquivos
index.html, styles.css (identidade EDP), materiais.css (componentes deste app), config.js,
db.js, auth.js, sync.js, mapa.js, pdf.js, app.js, service-worker.js, manifest.json,
assets/, icons/, images/, vendor/, banco/ (scripts SQL + guia).

## Parametrização
Somente `config.js`: projetos, lotes/canteiros, sugestões de fornecedor/transportadora,
limites de fotos e as chaves do Supabase.

## Publicação e base central
Ver `PUBLICAR-NO-GITHUB.md` e `banco/ATIVAR-BASE-CENTRAL.md`.
