/* =====================================================================
 * pdf.js — RELATÓRIO FOTOGRÁFICO EM PDF (100% no dispositivo)
 * ---------------------------------------------------------------------
 * jsPDF embarcado (vendor/jspdf.umd.min.js): funciona em modo avião.
 *
 * Formato EDP (o mesmo do app de Inspeções): faixa #1A1F2E em todas as
 * páginas com a logo negativa à esquerda e o título à direita; rodapé
 * com identificação do documento, data/hora de emissão e "Página x de y".
 *
 * Cada relatório sai SEMPRE em UMA página A4 (v1.5.0):
 *   identificação -> dados (esq.) | localização, NC e validação (dir.)
 *   -> registro fotográfico em grade que se ajusta à quantidade de fotos.
 *
 * Regras de diagramação: tudo é MEDIDO antes de desenhar, com a mesma
 * fonte e estilo da escrita; nenhum título fica órfão no pé da página.
 *
 *   gerarIndividual(id)         -> um relatório
 *   gerarConsolidado(lista, f)  -> resumo + tabela + um relatório por página
 * ===================================================================== */

const PDFGEN = (function () {

  const A4 = { largura: 210, altura: 297 };
  const M = 14;
  const LARG = A4.largura - M * 2;
  const FAIXA_TOPO = 22;
  const FAIXA_BASE = 15;
  const TOPO_CONTEUDO = FAIXA_TOPO + 9;
  const LIMITE_INFERIOR = A4.altura - FAIXA_BASE - 6;
  const TX = [20, 24, 31];

  let logoCache = null;

  /* ---------------------------------------------------------------
   * Utilitários
   * ------------------------------------------------------------- */
  function rgb(hex) {
    return [parseInt(hex.substr(1, 2), 16), parseInt(hex.substr(3, 2), 16), parseInt(hex.substr(5, 2), 16)];
  }
  function cor(doc, hex, tipo) {
    const c = rgb(hex);
    if (tipo === 'preenchimento') doc.setFillColor(c[0], c[1], c[2]);
    else if (tipo === 'traco') doc.setDrawColor(c[0], c[1], c[2]);
    else doc.setTextColor(c[0], c[1], c[2]);
  }
  function texto0(doc) { doc.setTextColor(TX[0], TX[1], TX[2]); }

  function dataBR(iso) {
    if (!iso) return '';
    if (String(iso).length === 10) {
      const p = String(iso).split('-');
      return p[2] + '/' + p[1] + '/' + p[0];
    }
    const d = new Date(iso);
    if (isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  }

  /** Texto seguro para a fonte padrão do PDF (sem glifos fora do conjunto). */
  function t(v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/[–—]/g, '-').replace(/·/g, '-').replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"').replace(/…/g, '...').replace(/\r/g, '');
  }

  function limpar(txt) {
    return String(txt || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'SEM';
  }

  async function logo() {
    if (logoCache !== null) return logoCache;
    if (typeof LOGO_EDP_BASE64 === 'string' && LOGO_EDP_BASE64.length > 100) {
      logoCache = {
        dataUrl: LOGO_EDP_BASE64.indexOf('data:') === 0 ? LOGO_EDP_BASE64 : 'data:image/png;base64,' + LOGO_EDP_BASE64,
        largura: (typeof LOGO_EDP_INFO === 'object' && LOGO_EDP_INFO.largura) || 400,
        altura: (typeof LOGO_EDP_INFO === 'object' && LOGO_EDP_INFO.altura) || 120
      };
      return logoCache;
    }
    try {
      const r = await fetch('assets/edp-logo-neg.png');
      const dataUrl = await DB.blobParaDataUrl(await r.blob());
      const dim = await new Promise((ok) => {
        const img = new Image();
        img.onload = () => ok({ largura: img.naturalWidth, altura: img.naturalHeight });
        img.onerror = () => ok({ largura: 400, altura: 120 });
        img.src = dataUrl;
      });
      logoCache = { dataUrl: dataUrl, largura: dim.largura, altura: dim.altura };
    } catch (e) {
      logoCache = { dataUrl: '', largura: 0, altura: 0 };
    }
    return logoCache;
  }

  /* ---------------------------------------------------------------
   * Faixas de identidade (aplicadas em todas as páginas no fim)
   * ------------------------------------------------------------- */
  async function aplicarFaixas(doc, titulo, identificacao, ultimaPagina, totalPaginas) {
    const lg = await logo();
    const total = totalPaginas || doc.internal.getNumberOfPages();
    const emissao = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const alturaLogo = 8;
    const proporcao = (lg.largura && lg.altura) ? (lg.largura / lg.altura) : 3.3;
    const larguraLogo = alturaLogo * proporcao;
    const respiro = alturaLogo;
    for (let p = 1; p <= (ultimaPagina || total); p++) {
      doc.setPage(p);
      cor(doc, CONFIG.cores.azulMarinho, 'preenchimento');
      doc.rect(0, 0, A4.largura, FAIXA_TOPO, 'F');
      if (lg.dataUrl) {
        try { doc.addImage(lg.dataUrl, 'PNG', respiro, (FAIXA_TOPO - alturaLogo) / 2, larguraLogo, alturaLogo); } catch (e) { /* sem logo */ }
      }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12.5); doc.setTextColor(255, 255, 255);
      doc.text(t(titulo), A4.largura - M, FAIXA_TOPO / 2 + 1.2, { align: 'right' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(159, 178, 188);
      doc.text(t(CONFIG.app.obra), A4.largura - M, FAIXA_TOPO / 2 + 6.4, { align: 'right' });

      cor(doc, CONFIG.cores.azulMarinho, 'preenchimento');
      doc.rect(0, A4.altura - FAIXA_BASE, A4.largura, FAIXA_BASE, 'F');
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(255, 255, 255);
      doc.setFontSize(7.5);
      const ident = doc.splitTextToSize(t(identificacao || CONFIG.app.nome), LARG - 32)[0];
      doc.text(ident, M, A4.altura - FAIXA_BASE + 6);
      doc.setTextColor(159, 178, 188);
      doc.text('Emitido em ' + emissao, M, A4.altura - FAIXA_BASE + 10.6);
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5);
      doc.text('Página ' + p + ' de ' + total, A4.largura - M, A4.altura - FAIXA_BASE + 8.5, { align: 'right' });
      texto0(doc);
    }
  }

  /** Faixas numa única página (página A4 de reserva no consolidado). */
  async function faixaUmaPagina(doc, pagina, titulo, identificacao) {
    const total = doc.internal.getNumberOfPages();
    const original = doc.setPage.bind(doc);
    // desenha só na página pedida reaproveitando aplicarFaixas
    const getN = doc.internal.getNumberOfPages;
    doc.internal.getNumberOfPages = () => 1;
    doc.setPage = () => original(pagina);
    try { await aplicarFaixas(doc, titulo, identificacao, 1, total); }
    finally { doc.setPage = original; doc.internal.getNumberOfPages = getN; }
  }

  /* ---------------------------------------------------------------
   * Blocos de conteúdo
   * ------------------------------------------------------------- */
  function novaPaginaSePreciso(doc, y, altura) {
    if (y + altura > LIMITE_INFERIOR) { doc.addPage(); return TOPO_CONTEUDO; }
    return y;
  }

  function secao(doc, y, titulo, corHex) {
    y = novaPaginaSePreciso(doc, y, 14);
    cor(doc, corHex || CONFIG.cores.cabecalho, 'preenchimento');
    doc.rect(M, y, 3, 7, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5);
    cor(doc, corHex || CONFIG.cores.cabecalho, 'texto');
    doc.text(t(titulo), M + 6, y + 5.6);
    texto0(doc);
    return y + 11;
  }

  /** Título só é escrito se o bloco seguinte couber junto (sem título órfão). */
  function secaoBloco(doc, y, titulo, alturaNecessaria, corHex) {
    if (y + 11 + (alturaNecessaria || 0) > LIMITE_INFERIOR) { doc.addPage(); y = TOPO_CONTEUDO; }
    return secao(doc, y, titulo, corHex);
  }

  /** Faixa de identificação: PROJETO | LOTE | DATA | TIPO. */
  function faixaIdentificacao(doc, y, reg) {
    const tipoCor = CONFIG.corTipo(reg.tipo);
    const cols = [
      { r: 'PROJETO', v: DB.nomeProjeto(reg), l: LARG * 0.46 },
      { r: 'LOTE', v: CONFIG.rotuloLote(reg.lote), l: LARG * 0.14 },
      { r: 'DATA', v: dataBR(reg.dataRelatorio), l: LARG * 0.18 },
      { r: 'TIPO', v: String(reg.tipo || '').toUpperCase(), l: LARG * 0.22 }
    ];
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    const linhasProj = doc.splitTextToSize(t(cols[0].v || '-'), cols[0].l - 6).slice(0, 2);
    const alt = linhasProj.length > 1 ? 18 : 14;
    doc.setFillColor(233, 246, 244);
    cor(doc, CONFIG.cores.verdeAgua, 'traco'); doc.setLineWidth(0.4);
    doc.rect(M, y, LARG, alt, 'FD');
    // Tipo destacado na cor do tipo
    const xTipo = M + cols[0].l + cols[1].l + cols[2].l;
    cor(doc, tipoCor, 'preenchimento');
    doc.rect(xTipo, y, cols[3].l, alt, 'F');
    let x = M;
    cols.forEach((c, i) => {
      const ehTipo = i === 3;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
      if (ehTipo) doc.setTextColor(255, 255, 255); else cor(doc, CONFIG.cores.textoApoio, 'texto');
      doc.text(c.r, x + 3, y + 5);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
      if (ehTipo) doc.setTextColor(255, 255, 255); else cor(doc, CONFIG.cores.azulMarinho, 'texto');
      const val = i === 0 ? linhasProj : doc.splitTextToSize(t(c.v || '-'), c.l - 6)[0];
      doc.text(val, x + 3, y + 10.5);
      if (i > 0 && !ehTipo) { cor(doc, '#BFE3DC', 'traco'); doc.setLineWidth(0.2); doc.line(x, y + 2, x, y + alt - 2); }
      x += c.l;
    });
    texto0(doc);
    return y + alt + 5;
  }

  /** Linha rótulo | valor, com altura medida pelo texto. */
  function linha(doc, y, rotulo, valor, opcoes) {
    opcoes = opcoes || {};
    const larguraRot = 50;
    const larguraVal = LARG - larguraRot;
    const valorTxt = (valor === null || valor === undefined || valor === '') ? '-' : t(valor);
    doc.setFontSize(9.5);
    doc.setFont('helvetica', opcoes.negrito ? 'bold' : 'normal');
    const linhas = doc.splitTextToSize(valorTxt, larguraVal - 6);
    const alt = Math.max(8.5, linhas.length * 4.5 + 4);
    if (alt > LIMITE_INFERIOR - TOPO_CONTEUDO) {
      // Texto muito longo: quebra em partes que cabem por página
      const porPagina = Math.floor((LIMITE_INFERIOR - TOPO_CONTEUDO - 4) / 4.5);
      for (let i = 0; i < linhas.length; i += porPagina) {
        y = linha(doc, y, i ? rotulo + ' (cont.)' : rotulo, linhas.slice(i, i + porPagina).join('\n'), opcoes);
      }
      return y;
    }
    y = novaPaginaSePreciso(doc, y, alt);
    cor(doc, CONFIG.cores.borda, 'traco'); doc.setLineWidth(0.2);
    doc.setFillColor(238, 242, 245);
    doc.rect(M, y, larguraRot, alt, 'FD');
    if (opcoes.fundo) { cor(doc, opcoes.fundo, 'preenchimento'); doc.rect(M + larguraRot, y, larguraVal, alt, 'FD'); }
    else doc.rect(M + larguraRot, y, larguraVal, alt, 'D');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5);
    cor(doc, CONFIG.cores.azulMarinho, 'texto');
    doc.text(doc.splitTextToSize(t(rotulo), larguraRot - 6), M + 3, y + 5.8);
    doc.setFont('helvetica', opcoes.negrito ? 'bold' : 'normal');
    if (opcoes.cor) cor(doc, opcoes.cor, 'texto'); else texto0(doc);
    doc.text(linhas, M + larguraRot + 3, y + 5.8);
    texto0(doc);
    return y + alt;
  }

  function formatoImagem(dataUrl) {
    return /^data:image\/png/.test(dataUrl) ? 'PNG' : (/^data:image\/webp/.test(dataUrl) ? 'WEBP' : 'JPEG');
  }

  function fotoIndisponivel(doc, x, y, w, h) {
    doc.setFillColor(243, 245, 247); doc.setDrawColor(201, 210, 218); doc.setLineWidth(0.3);
    if (doc.setLineDashPattern) doc.setLineDashPattern([1.5, 1.2], 0);
    doc.rect(x, y, w, h, 'FD');
    if (doc.setLineDashPattern) doc.setLineDashPattern([], 0);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(74, 87, 99);
    doc.text('Foto indisponível', x + w / 2, y + h / 2 - 1, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(107, 120, 132);
    doc.text('não foi possível ler a imagem neste aparelho', x + w / 2, y + h / 2 + 4, { align: 'center' });
    texto0(doc);
  }

  /** Desenha a foto centralizada dentro da moldura (sem distorcer). */
  async function desenharFoto(doc, f, x, y, w, h, corBorda) {
    doc.setFillColor(245, 247, 249);
    doc.rect(x, y, w, h, 'F');
    if (!f || f.indisponivel || !f.blob) { fotoIndisponivel(doc, x, y, w, h); return; }
    try {
      const prop = (f.largura && f.altura) ? f.largura / f.altura : 4 / 3;
      let fw = w, fh = w / prop;
      if (fh > h) { fh = h; fw = h * prop; }
      const dataUrl = await DB.blobParaDataUrl(f.blob);
      doc.addImage(dataUrl, formatoImagem(dataUrl), x + (w - fw) / 2, y + (h - fh) / 2, fw, fh, undefined, 'FAST');
      cor(doc, corBorda || '#9AA6B0', 'traco'); doc.setLineWidth(0.3);
      doc.rect(x, y, w, h, 'D');
    } catch (e) {
      fotoIndisponivel(doc, x, y, w, h);
    }
  }

  /* ===============================================================
   * RELATÓRIO EM UMA ÚNICA PÁGINA (v1.5.0)
   * ---------------------------------------------------------------
   *  ┌ identificação (projeto | lote | data | tipo) ───────────────┐
   *  │ dados do registro (esq.)  │ localização + NC + validação   │
   *  ├ registro fotográfico: grade que se ajusta à quantidade ────┤
   *  └ (1 a N fotos ocupam sempre o espaço que sobra na página) ──┘
   * Textos muito longos são resumidos e, em último caso, a página
   * inteira é reduzida proporcionalmente — nunca vira 2 páginas.
   * =============================================================== */
  const GAP = 5;                                   // espaço entre colunas
  const LARG_ESQ = 106;                            // coluna dos dados
  const LARG_DIR = LARG - LARG_ESQ - GAP;          // coluna localização / validação
  /** Altura mínima reservada às fotos: cada foto com pelo menos ~24 mm de altura. */
  function fotoMin(n) {
    if (!n) return 8;
    const linhas = Math.ceil(n / Math.min(n, 6));
    return 7 + linhas * (24 + 4.6 + 6.4 + 2) + (linhas - 1) * 2.5;
  }

  /** Título compacto de seção. */
  function secaoC(doc, x, y, titulo, corHex, desenhar) {
    if (desenhar) {
      cor(doc, corHex || CONFIG.cores.cabecalho, 'preenchimento');
      doc.rect(x, y, 2.2, 5.2, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9.6);
      cor(doc, corHex || CONFIG.cores.cabecalho, 'texto');
      doc.text(t(titulo), x + 4.2, y + 4.1);
      texto0(doc);
    }
    return y + 7;
  }

  /** Linha compacta rótulo | valor (texto limitado a "max" linhas). */
  function linhaC(doc, x, y, w, rotulo, valor, o, desenhar) {
    o = o || {};
    const lr = o.larguraRotulo || 27, lv = w - lr;
    const vazio = valor === null || valor === undefined || valor === '';
    doc.setFont('helvetica', o.negrito ? 'bold' : 'normal'); doc.setFontSize(7.9);
    let linhas = doc.splitTextToSize(vazio ? '-' : t(valor), lv - 4);
    if (o.max && linhas.length > o.max) {
      linhas = linhas.slice(0, o.max);
      linhas[o.max - 1] = String(linhas[o.max - 1]).replace(/\s*\S{0,6}$/, '') + ' (...)';
    }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.4);
    const rot = doc.splitTextToSize(t(rotulo), lr - 4);
    const alt = Math.max(6, Math.max(linhas.length * 3.35, rot.length * 3.1) + 2.9);
    if (desenhar) {
      cor(doc, CONFIG.cores.borda, 'traco'); doc.setLineWidth(0.18);
      doc.setFillColor(238, 242, 245); doc.rect(x, y, lr, alt, 'FD');
      if (o.fundo) { cor(doc, o.fundo, 'preenchimento'); doc.rect(x + lr, y, lv, alt, 'FD'); }
      else doc.rect(x + lr, y, lv, alt, 'D');
      cor(doc, CONFIG.cores.azulMarinho, 'texto');
      doc.text(rot, x + 2, y + 4.1);
      doc.setFont('helvetica', o.negrito ? 'bold' : 'normal'); doc.setFontSize(7.9);
      if (o.cor) cor(doc, o.cor, 'texto'); else texto0(doc);
      doc.text(linhas, x + lr + 2, y + 4.1);
      texto0(doc);
    }
    return y + alt;
  }

  /** Coluna esquerda: dados do registro. */
  function colunaDados(doc, x, y, reg, maxTexto, desenhar) {
    const w = LARG_ESQ;
    const L = (rot, val, o) => { y = linhaC(doc, x, y, w, rot, val, o, desenhar); };
    y = secaoC(doc, x, y, CONFIG.tituloDados(reg.tipo, CONFIG.categoriaFabrica(reg)), null, desenhar);
    L('Nº do relatório', DB.numeroExibicao(reg), { negrito: true });
    if (reg.tipo === 'Fábrica') {
      if (CONFIG.categoriaFabrica(reg) === 'Subestação') {
        L('Fornecedor', reg.fabricante); L('Tipo de equipamento', reg.tipoEquipamento);
      } else {
        L('Fabricante', reg.fabricante); L('Tipo de torre', reg.tipoTorre);
      }
      L('Descrição', reg.descricao, { max: maxTexto });
      L('Nº da NF / Romaneio', reg.nf);
      L('Peso da carga', CONFIG.pesoExibicao(reg), { negrito: true });
      L('Canteiro destino', DB.nomeCanteiro(reg));
    } else {
      L('NF', reg.nf);
      L('Fornecedor', reg.fornecedor);
      if (reg.tipo === 'Saída') { L('Transportadora', reg.transportadora); L('Trecho', reg.trecho); L('Torre', reg.torre); }
      else L('Canteiro', DB.nomeCanteiro(reg));
      L('Descrição do material', reg.descricao, { max: maxTexto });
    }
    if (reg.observacoes) L('Observações gerais', reg.observacoes, { max: Math.max(2, Math.round(maxTexto * 0.6)) });
    return y;
  }

  /** Coluna direita: localização, não conformidade e validação. */
  function colunaLateral(doc, x, y, reg, mapa, maxTexto, ctx, desenhar) {
    const w = LARG_DIR;
    const L = (rot, val, o) => { y = linhaC(doc, x, y, w, rot, val, Object.assign({ larguraRotulo: 22 }, o || {}), desenhar); };
    const tem = MAPA.temCoord(reg);
    y = secaoC(doc, x, y, 'Localização', null, desenhar);
    L('Coordenadas (GPS)', tem
      ? (reg.latitude + ', ' + reg.longitude + (reg.precisaoGps ? ' (±' + reg.precisaoGps + ' m)' : '') +
         (reg.obsGeo === 'Ajustado no mapa' ? ' - ajustado no mapa' : ''))
      : (reg.obsGeo || 'Não capturada'), { max: 3 });
    if (mapa) {
      const altMapa = w * mapa.altura / mapa.largura;
      if (desenhar) {
        doc.addImage(mapa.dataUrl, 'JPEG', x, y + 1.5, w, altMapa);
        cor(doc, CONFIG.cores.borda, 'traco'); doc.setLineWidth(0.25); doc.rect(x, y + 1.5, w, altMapa);
      }
      y += altMapa + 1.5;
    }
    if (tem) {
      y += 3.6;
      if (desenhar) {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7.2); doc.setTextColor(11, 127, 112);
        const rot = 'Abrir este local no Google Maps';
        doc.text(rot, x, y);
        ctx.link(x, y - 2.8, doc.getTextWidth(rot), 3.6, MAPA.linkGoogle(reg.latitude, reg.longitude));
        texto0(doc);
      }
      y += 1.2;
    }
    // Não conformidade
    if (reg.naoConformidade === 'Sim') {
      y = secaoC(doc, x, y + 3, 'Não conformidade', CONFIG.cores.naoConforme, desenhar);
      L('Houve NC?', 'SIM', { negrito: true, cor: CONFIG.cores.naoConforme, fundo: '#FDECEC' });
      L('Descrição da NC', reg.descricaoNC, { max: Math.max(3, Math.round(maxTexto * 0.7)), fundo: '#FDF5F5' });
    } else {
      y = secaoC(doc, x, y + 3, 'Não conformidade', null, desenhar);
      L('Houve NC?', 'Não', { negrito: true, cor: CONFIG.cores.conforme, fundo: '#EAF4EB' });
    }
    // Registro e validação
    y = secaoC(doc, x, y + 3, 'Registro e validação', null, desenhar);
    L('Registrado por', CONFIG.textoFiscalizacao(reg.responsavel, reg.funcaoResponsavel), { max: 3 });
    L('Registrado em', dataBR(reg.criadoEm) + ((reg.versao || 1) > 1 ? ' | última edição: ' + dataBR(reg.atualizadoEm) : ''), { max: 2 });
    if (reg.excluido) L('Excluído em', dataBR(reg.excluidoEm) + (reg.motivoExclusao ? ' - ' + reg.motivoExclusao : ''), { cor: CONFIG.cores.naoConforme, negrito: true, max: 3 });
    // Assinatura
    if (desenhar) {
      const funcao = (reg.funcaoResponsavel && reg.funcaoResponsavel !== 'Outro') ? reg.funcaoResponsavel : '';
      cor(doc, '#8A97A3', 'traco'); doc.setLineWidth(0.3);
      doc.line(x + 4, y + 10, x + w - 4, y + 10);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.8); cor(doc, CONFIG.cores.azulMarinho, 'texto');
      doc.text(doc.splitTextToSize(t(reg.responsavel || '-'), w - 8)[0], x + w / 2, y + 13.4, { align: 'center' });
      doc.setFont('helvetica', 'normal'); doc.setFontSize(6.9); cor(doc, CONFIG.cores.textoApoio, 'texto');
      doc.text(doc.splitTextToSize(t('Fiscalização EDP' + (funcao ? ' - ' + funcao : '')), w - 8)[0], x + w / 2, y + 16.6, { align: 'center' });
      texto0(doc);
    }
    return y + 18;
  }

  /** Escolhe colunas x linhas que deixam as fotos maiores no espaço disponível. */
  function gradeFotos(n, alturaDisp, comLegenda) {
    const esp = 2.5, cab = 4.6, leg = comLegenda ? 6.4 : 0;
    let melhor = null;
    for (let cols = 1; cols <= Math.min(n, 8); cols++) {
      const linhas = Math.ceil(n / cols);
      const cw = (LARG - (cols - 1) * esp) / cols;
      const ch = (alturaDisp - (linhas - 1) * esp) / linhas;
      const iw = cw - 2, ih = ch - cab - leg - 2;
      if (ih < 8) continue;
      const fw = Math.min(iw, ih * 4 / 3), fh = fw * 3 / 4;     // área útil de uma foto 4:3
      const nota = fw * fh * (cols * linhas === n ? 1.03 : 1);  // preferir grade sem buracos
      if (!melhor || nota > melhor.nota) {
        // altura da imagem limitada à proporção 4:3 (sem sobra exagerada)
        const ihFinal = Math.min(ih, iw * 0.80);
        const cwFinal = Math.min(cw, ihFinal * 1.45 + 2);          // cartão do tamanho da foto
        const larguraGrade = cols * cwFinal + (cols - 1) * esp;
        melhor = { nota, cols, linhas, cw: cwFinal, ch: ihFinal + cab + leg + 2, iw, ih: ihFinal, esp, cab, leg,
                   margem: (LARG - larguraGrade) / 2 };
      }
    }
    return melhor;
  }

  async function grade(doc, y, alturaDisp, fotos) {
    const gerais = fotos.filter(f => !f.vinculo).sort((a, b) => (a.slot || a.ordem || 0) - (b.slot || b.ordem || 0));
    const nc = fotos.filter(f => f.vinculo);
    const todas = gerais.map((f, i) => ({ f, rot: 'FOTO ' + (f.slot || i + 1), nc: false }))
      .concat(nc.map((f, i) => ({ f, rot: 'FOTO NC ' + (i + 1), nc: true })));
    const titulo = 'Registro fotográfico (' + todas.length + (todas.length === 1 ? ' foto)' : ' fotos)');
    y = secaoC(doc, M, y, todas.length ? titulo : 'Registro fotográfico', null, true);
    if (!todas.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8.5); doc.setTextColor(120, 130, 140);
      doc.text('Nenhuma foto anexada.', M, y + 3); texto0(doc);
      return y + 6;
    }
    const comLeg = todas.some(o => o.f.legenda);
    const g = gradeFotos(todas.length, alturaDisp - 7, comLeg);
    if (!g) return y;
    for (let i = 0; i < todas.length; i++) {
      const o = todas[i], c = i % g.cols, l = Math.floor(i / g.cols);
      // última linha incompleta: centraliza
      const naLinha = Math.min(g.cols, todas.length - l * g.cols);
      const desloc = (g.cols - naLinha) * (g.cw + g.esp) / 2;
      const x = M + g.margem + desloc + c * (g.cw + g.esp), yy = y + l * (g.ch + g.esp);
      const corMoldura = o.nc ? CONFIG.cores.naoConforme : CONFIG.cores.azulMarinho;
      cor(doc, o.nc ? '#E08A8A' : CONFIG.cores.borda, 'traco'); doc.setLineWidth(0.25);
      doc.setFillColor(255, 255, 255); doc.rect(x, yy, g.cw, g.ch, 'FD');
      cor(doc, corMoldura, 'preenchimento'); doc.rect(x, yy, g.cw, g.cab, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(g.cols >= 5 ? 6.4 : 7.2); doc.setTextColor(255, 255, 255);
      doc.text(o.rot, x + 1.8, yy + 3.3);
      await desenharFoto(doc, o.f, x + 1, yy + g.cab + 1, g.cw - 2, g.ih, o.nc ? '#E08A8A' : null);
      if (g.leg) {
        doc.setFont('helvetica', o.f.legenda ? 'normal' : 'italic'); doc.setFontSize(6.5);
        if (o.f.legenda) texto0(doc); else doc.setTextColor(150, 158, 166);
        let leg = doc.splitTextToSize(t(o.f.legenda || 'Sem observação.'), g.cw - 3);
        if (leg.length > 2) { leg = leg.slice(0, 2); leg[1] = String(leg[1]).replace(/\s*\S{0,6}$/, '') + ' (...)'; }
        doc.text(leg, x + 1.5, yy + g.cab + g.ih + 3.7);
        texto0(doc);
      }
    }
    return y + g.linhas * g.ch + (g.linhas - 1) * g.esp;
  }

  /** Mapa do local (com internet ou com as imagens já guardadas no aparelho). */
  async function mapaDoLocal(reg) {
    if (!MAPA.temCoord(reg)) return null;
    const largura = 640, altura = 390;
    try {
      const dataUrl = await MAPA.imagemEstatica(reg.latitude, reg.longitude,
        { zoom: 16, largura, altura, nc: reg.naoConformidade === 'Sim', semInternet: true });
      return dataUrl ? { dataUrl, largura, altura } : null;
    } catch (e) { return null; }
  }

  /**
   * Desenha o relatório inteiro na página atual — sempre UMA página.
   */
  async function paginaUnica(doc, reg, fotos) {
    const topo = TOPO_CONTEUDO, base = LIMITE_INFERIOR, disp = base - topo;
    const mapa = await mapaDoLocal(reg);
    const k = doc.internal.scaleFactor;
    const links = [];
    const medir = { link() {} };

    // 1) mede o bloco de cima e resume textos longos se ele tomar o lugar das fotos
    const temFotos = fotos.length > 0;
    const alturaTopo = (maxT) => {
      const yi = faixaIdentificacaoAltura(doc, reg);
      const a = colunaDados(doc, M, topo + yi, reg, maxT, false);
      const b = colunaLateral(doc, M + LARG_ESQ + GAP, topo + yi, reg, mapa, maxT, medir, false);
      return Math.max(a, b) - topo;
    };
    const minFotos = fotoMin(fotos.length);
    const limiteTopo = temFotos ? disp - minFotos - 4 : disp;
    let maxT = 40, hTopo = alturaTopo(maxT);
    while (hTopo > limiteTopo && maxT > 4) { maxT = maxT > 12 ? maxT - 4 : maxT - 1; hTopo = alturaTopo(maxT); }

    // 2) se ainda não couber, reduz a página inteira (sem nunca criar 2ª página)
    const necessario = hTopo + (temFotos ? minFotos + 4 : 8);
    const s = necessario > disp ? disp / necessario : 1;
    const ox = (LARG * (1 - s)) / 2;          // centraliza horizontalmente
    const ctx = {
      link(x, y, w, h, url) {
        links.push({ x: M + ox + s * (x - M), y: topo + s * (y - topo), w: w * s, h: h * s, url });
      }
    };
    if (s < 1) {
      doc.saveGraphicsState();
      const H = doc.internal.pageSize.getHeight() * k;
      doc.setCurrentTransformationMatrix(new doc.Matrix(s, 0, 0, s, (M * (1 - s) + ox) * k, (1 - s) * (H - topo * k)));
    }
    const baseVirtual = topo + disp / s;

    // 3) desenha
    let y = faixaIdentificacao(doc, topo, reg);
    const yA = colunaDados(doc, M, y, reg, maxT, true);
    const yB = colunaLateral(doc, M + LARG_ESQ + GAP, y, reg, mapa, maxT, ctx, true);
    y = Math.max(yA, yB) + 4;
    await grade(doc, y, baseVirtual - y, fotos);

    if (s < 1) doc.restoreGraphicsState();
    links.forEach(l => doc.link(l.x, l.y, l.w, l.h, { url: l.url }));
  }

  /** Altura da faixa de identificação (sem desenhar). */
  function faixaIdentificacaoAltura(doc, reg) {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
    const linhasProj = doc.splitTextToSize(t(DB.nomeProjeto(reg) || '-'), LARG * 0.46 - 6).slice(0, 2);
    return (linhasProj.length > 1 ? 18 : 14) + 5;
  }

  function baixar(doc, nomeArquivo) {
    return window.APP.entregarArquivo(doc.output('blob'), nomeArquivo, 'application/pdf');
  }

  function nomeArquivo(reg) {
    return 'RF-Materiais_' + limpar(reg.tipo) + '_' + limpar(reg.lote) + '_NF-' + limpar(reg.nf) + '_' + reg.dataRelatorio + '.pdf';
  }

  /* ---------------------------------------------------------------
   * RELATÓRIO INDIVIDUAL
   * ------------------------------------------------------------- */
  async function montarIndividual(id) {
    const reg = await DB.obterRelatorio(id);
    if (!reg) throw new Error('Relatório não encontrado.');
    // v1.5.1: PDF no MESMO formato da imagem do relatório — página única contínua
    try {
      const img = await IMAGEM.gerar(id);
      return { doc: await IMAGEM.paginaPdf(null, img), nome: nomeArquivo(reg) };
    } catch (e) {
      console.warn('[PDF] formato imagem indisponível, usando A4:', e);
    }
    const fotos = await DB.listarFotos(id);
    const doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    await paginaUnica(doc, reg, fotos);
    await aplicarFaixas(doc, CONFIG.app.titulo + ' - ' + reg.tipo,
      DB.numeroExibicao(reg) + '  |  NF ' + reg.nf + '  |  ' + ((reg.tipo === 'Fábrica' ? reg.fabricante : reg.fornecedor) || ''));
    return { doc: doc, nome: nomeArquivo(reg) };
  }

  async function gerarIndividual(id) {
    const r = await montarIndividual(id);
    return baixar(r.doc, r.nome);
  }

  /* ---------------------------------------------------------------
   * RELATÓRIO CONSOLIDADO
   * ------------------------------------------------------------- */
  async function montarConsolidado(lista, descricaoFiltro) {
    if (!lista || !lista.length) throw new Error('Nenhum relatório no filtro atual.');
    lista = lista.slice().sort((a, b) => (a.dataRelatorio + a.criadoEm).localeCompare(b.dataRelatorio + b.criadoEm));
    const doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    let y = TOPO_CONTEUDO;
    const p = (window.AUTH && AUTH.perfil) ? AUTH.perfil() : null;
    const receb = lista.filter(r => r.tipo === 'Recebimento').length;
    const saidas = lista.filter(r => r.tipo === 'Saída').length;
    const fabrica = lista.filter(r => r.tipo === 'Fábrica').length;
    const comNC = lista.filter(r => r.naoConformidade === 'Sim').length;
    let totalFotos = 0;
    const qtds = {};
    for (const r of lista) { qtds[r.id] = await DB.contarFotos(r.id); totalFotos += qtds[r.id].total; }

    // Cartões de resumo
    y = secao(doc, y, 'Resumo');
    const cards = [
      ['Relatórios', lista.length, CONFIG.cores.verdeAgua],
      ['Recebimentos', receb, CONFIG.cores.recebimento],
      ['Saídas', saidas, CONFIG.cores.saida],
      ['Fábrica', fabrica, CONFIG.cores.fabrica],
      ['Com NC', comNC, CONFIG.cores.naoConforme],
      ['Fotos', totalFotos, CONFIG.cores.azulMarinho]
    ];
    const lc = (LARG - 4 * (cards.length - 1)) / cards.length;
    cards.forEach((c, i) => {
      const x = M + i * (lc + 4);
      doc.setFillColor(255, 255, 255); cor(doc, CONFIG.cores.borda, 'traco'); doc.setLineWidth(0.3);
      doc.rect(x, y, lc, 18, 'FD');
      cor(doc, c[2], 'preenchimento'); doc.rect(x, y, lc, 1.4, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15); cor(doc, c[2], 'texto');
      doc.text(String(c[1]), x + 3.5, y + 9.5);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); cor(doc, CONFIG.cores.textoApoio, 'texto');
      doc.text(t(c[0]), x + 3.5, y + 14.5);
    });
    texto0(doc);
    y += 23;
    y = linha(doc, y, 'Filtro aplicado', descricaoFiltro || 'Todos os registros');
    y = linha(doc, y, 'Período dos registros', dataBR(lista[0].dataRelatorio) + ' a ' + dataBR(lista[lista.length - 1].dataRelatorio));
    y = linha(doc, y, 'Emitido por', p ? (p.nome + (p.funcao ? ' - ' + p.funcao : '')) : '-');

    // Tabela
    y = secaoBloco(doc, y + 3, 'Relatórios do período', 20);
    const cols = [
      { t: 'Nº', l: 11 }, { t: 'Data', l: 17 }, { t: 'Tipo', l: 20 }, { t: 'Lote', l: 12 }, { t: 'NF', l: 18 },
      { t: 'Fornecedor', l: 30 }, { t: 'Local / Trecho - Torre', l: 37 }, { t: 'NC', l: 10 }, { t: 'Fotos', l: 11 }, { t: 'Pág.', l: 16 }
    ];
    const cabecalhoTabela = (yy) => {
      cor(doc, CONFIG.cores.azulMarinho, 'preenchimento'); doc.rect(M, yy, LARG, 7.5, 'F');
      doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
      let x = M; cols.forEach(c => { doc.text(c.t, x + 1.8, yy + 5.1); x += c.l; });
      texto0(doc);
      return yy + 7.5;
    };
    y = cabecalhoTabela(y);
    const posPaginas = [];        // onde escrever o número da página de cada relatório
    let alterna = false;
    for (const r of lista) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8);
      const local = r.tipo === 'Saída' ? [r.trecho, r.torre ? 'Torre ' + r.torre : ''].filter(Boolean).join(' - ')
                  : r.tipo === 'Fábrica' ? ['Destino ' + DB.nomeCanteiro(r), CONFIG.pesoExibicao(r)].filter(Boolean).join(' - ')
                  : DB.nomeCanteiro(r);
      const valores = [DB.seqExibicao(r), dataBR(r.dataRelatorio), r.tipo, r.lote, r.nf, r.fornecedor, local,
                       r.naoConformidade === 'Sim' ? 'Sim' : 'Não', String(qtds[r.id].total), ''];
      let maxL = 1;
      const partes = valores.map((v, i) => { const pp = doc.splitTextToSize(t(v || '-'), cols[i].l - 3).slice(0, 3); maxL = Math.max(maxL, pp.length); return pp; });
      const alt = maxL * 3.6 + 3;
      if (y + alt > LIMITE_INFERIOR) { doc.addPage(); y = cabecalhoTabela(TOPO_CONTEUDO); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.8); }
      if (alterna) { doc.setFillColor(244, 247, 249); doc.rect(M, y, LARG, alt, 'F'); }
      alterna = !alterna;
      cor(doc, CONFIG.cores.borda, 'traco'); doc.setLineWidth(0.15); doc.line(M, y + alt, M + LARG, y + alt);
      let x = M;
      partes.forEach((pp, i) => {
        if (i === 2) cor(doc, CONFIG.corTipo(r.tipo), 'texto');
        if (i === 7 && pp[0] === 'Sim') { cor(doc, CONFIG.cores.naoConforme, 'texto'); doc.setFont('helvetica', 'bold'); }
        doc.text(pp, x + 1.8, y + 4.2);
        texto0(doc); doc.setFont('helvetica', 'normal');
        x += cols[i].l;
      });
      posPaginas.push({ pagina: doc.internal.getCurrentPageInfo().pageNumber, y: y + 4.2, x: x - cols[9].l + 1.8 });
      y += alt;
    }

    // Um relatório completo por página — mesmo formato do relatório individual (imagem)
    const paginasResumo = doc.internal.getNumberOfPages();
    const imagens = [];
    for (let i = 0; i < lista.length; i++) {
      try { imagens.push(await IMAGEM.gerar(lista[i].id)); } catch (e) { imagens.push(null); }
    }
    for (let i = 0; i < lista.length; i++) {
      if (imagens[i]) {
        await IMAGEM.paginaPdf(doc, imagens[i]);
      } else {
        doc.addPage('a4', 'p');
        await paginaUnica(doc, lista[i], await DB.listarFotos(lista[i].id));
        imagens[i] = 'a4';
      }
      posPaginas[i].destino = doc.internal.getCurrentPageInfo().pageNumber;
    }
    // Número da página de cada relatório na tabela (com link interno)
    posPaginas.forEach(pp => {
      doc.setPage(pp.pagina);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.8); doc.setTextColor(11, 127, 112);
      doc.textWithLink('p. ' + pp.destino, pp.x, pp.y, { pageNumber: pp.destino });
      texto0(doc);
    });

    // Faixas EDP nas páginas de resumo e nas páginas A4 de reserva (as páginas em imagem já têm as suas)
    await aplicarFaixas(doc, 'Relatório Fotográfico Consolidado', 'Consolidado  |  ' + (descricaoFiltro || 'todos os registros'), paginasResumo);
    for (let i = 0; i < lista.length; i++) {
      if (imagens[i] !== 'a4') continue;
      const pg = posPaginas[i].destino;
      await faixaUmaPagina(doc, pg, CONFIG.app.titulo + ' - ' + lista[i].tipo, DB.numeroExibicao(lista[i]));
    }
    return { doc: doc, nome: 'RF-Materiais_Consolidado_' + DB.hojeISO() + '.pdf' };
  }

  async function gerarConsolidado(lista, descricaoFiltro) {
    const r = await montarConsolidado(lista, descricaoFiltro);
    return baixar(r.doc, r.nome);
  }

  return {
    dataBR: dataBR,
    gerarIndividual: gerarIndividual,
    gerarConsolidado: gerarConsolidado,
    montarIndividual: montarIndividual,
    montarConsolidado: montarConsolidado
  };
})();

window.PDFGEN = PDFGEN;
