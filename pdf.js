/* =====================================================================
 * pdf.js — RELATÓRIO FOTOGRÁFICO EM PDF (100% no dispositivo)
 * ---------------------------------------------------------------------
 * jsPDF embarcado (vendor/jspdf.umd.min.js): funciona em modo avião.
 *
 * Formato EDP (o mesmo do app de Inspeções): faixa #1A1F2E em todas as
 * páginas com a logo negativa à esquerda e o título à direita; rodapé
 * com identificação do documento, data/hora de emissão e "Página x de y".
 *
 * Ordem das seções:
 *   identificação (projeto, lote, data, tipo) -> dados do material ->
 *   não conformidade (descrição + fotos) -> localização (mapa) ->
 *   registro fotográfico (fotos 1 a 6, 2 por linha, com a observação)
 *   -> registro e validação.
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
  async function aplicarFaixas(doc, titulo, identificacao) {
    const lg = await logo();
    const total = doc.internal.getNumberOfPages();
    const emissao = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const alturaLogo = 8;
    const proporcao = (lg.largura && lg.altura) ? (lg.largura / lg.altura) : 3.3;
    const larguraLogo = alturaLogo * proporcao;
    const respiro = alturaLogo;
    for (let p = 1; p <= total; p++) {
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
    const tipoCor = reg.tipo === 'Saída' ? CONFIG.cores.saida : CONFIG.cores.recebimento;
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

  /** Dados do recebimento / da saída. */
  function blocoDados(doc, y, reg) {
    y = secaoBloco(doc, y, reg.tipo === 'Saída' ? 'Dados da saída' : 'Dados do recebimento', 20);
    y = linha(doc, y, 'Nº do relatório', DB.numeroExibicao(reg), { negrito: true });
    y = linha(doc, y, 'NF', reg.nf);
    y = linha(doc, y, 'Fornecedor', reg.fornecedor);
    if (reg.tipo === 'Saída') {
      y = linha(doc, y, 'Transportadora', reg.transportadora);
      y = linha(doc, y, 'Trecho', reg.trecho);
      y = linha(doc, y, 'Torre', reg.torre);
    } else {
      y = linha(doc, y, 'Canteiro', DB.nomeCanteiro(reg));
    }
    y = linha(doc, y, 'Descrição do material', reg.descricao);
    if (reg.observacoes) y = linha(doc, y, 'Observações gerais', reg.observacoes);
    y = linha(doc, y, 'Responsável', reg.responsavel + (reg.funcaoResponsavel ? '  (' + reg.funcaoResponsavel + ')' : ''));
    return y;
  }

  /** Não conformidade: situação, descrição e fotos (2 por linha). */
  async function blocoNC(doc, y, reg, fotos) {
    if (reg.naoConformidade !== 'Sim') {
      y = secaoBloco(doc, y + 3, 'Não conformidade', 10);
      return linha(doc, y, 'Houve não conformidade?', 'Não', { negrito: true, cor: CONFIG.cores.conforme, fundo: '#EAF4EB' });
    }
    const fs = fotos.filter(f => f.vinculo);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
    const linhasDesc = doc.splitTextToSize(t(reg.descricaoNC || '-'), LARG - 10);
    const altDesc = 11 + linhasDesc.length * 4.5;
    const colLarg = (LARG - 6) / 2, imgAlt = 56;
    y = secaoBloco(doc, y + 3, 'Não conformidade identificada', Math.min(altDesc, 60) + (fs.length ? imgAlt + 8 : 6), CONFIG.cores.naoConforme);
    // Caixa da descrição (quebra entre páginas se for muito longa)
    let i = 0;
    while (i < linhasDesc.length) {
      const cabem = Math.max(1, Math.floor((LIMITE_INFERIOR - y - 11) / 4.5));
      const parte = linhasDesc.slice(i, i + cabem);
      if (parte.length < Math.min(3, linhasDesc.length - i) && y > TOPO_CONTEUDO) { doc.addPage(); y = TOPO_CONTEUDO; continue; }
      const alt = 10 + parte.length * 4.5;
      doc.setFillColor(253, 236, 236); cor(doc, '#F0BDBD', 'traco'); doc.setLineWidth(0.3);
      doc.rect(M, y, LARG, alt, 'FD');
      cor(doc, CONFIG.cores.naoConforme, 'preenchimento'); doc.rect(M, y, 1.6, alt, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); cor(doc, CONFIG.cores.naoConforme, 'texto');
      doc.text(i ? 'DESCRIÇÃO (CONT.)' : 'HOUVE NÃO CONFORMIDADE: SIM  -  DESCRIÇÃO', M + 5, y + 5.4);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); texto0(doc);
      doc.text(parte, M + 5, y + 10.6);
      y += alt + 3;
      i += parte.length;
    }
    if (!fs.length) {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(8); doc.setTextColor(120, 130, 140);
      y = novaPaginaSePreciso(doc, y, 6);
      doc.text('Sem foto da não conformidade.', M + 2, y + 2);
      texto0(doc);
      return y + 6;
    }
    for (let k = 0; k < fs.length; k += 2) {
      // Altura da linha: maior legenda das duas fotos
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      const legs = [0, 1].map(j => fs[k + j] ? doc.splitTextToSize(t('Foto NC ' + (k + j + 1) + (fs[k + j].legenda ? ' - ' + fs[k + j].legenda : '')), colLarg).slice(0, 3) : []);
      const altLeg = Math.max(legs[0].length, legs[1].length) * 3.6 + 2;
      y = novaPaginaSePreciso(doc, y, imgAlt + altLeg + 4);
      for (let j = 0; j < 2 && k + j < fs.length; j++) {
        const x = M + j * (colLarg + 6);
        await desenharFoto(doc, fs[k + j], x, y, colLarg, imgAlt, '#E08A8A');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8); cor(doc, CONFIG.cores.naoConforme, 'texto');
        doc.text(legs[j], x, y + imgAlt + 4);
        texto0(doc);
      }
      y += imgAlt + altLeg + 4;
    }
    return y;
  }

  /** Localização: coordenadas, miniatura do mapa e link. */
  async function blocoLocalizacao(doc, y, reg) {
    const tem = MAPA.temCoord(reg);
    let img = null;
    if (tem) {
      try {
        img = await MAPA.imagemEstatica(reg.latitude, reg.longitude,
          { zoom: 16, largura: 900, altura: 330, nc: reg.naoConformidade === 'Sim' });
      } catch (e) { img = null; }
    }
    const altMapa = img ? LARG * 330 / 900 : 0;
    y = secaoBloco(doc, y + 3, 'Localização', 9 + (img ? altMapa + 9 : 0));
    y = linha(doc, y, 'Coordenadas (GPS)', tem
      ? (reg.latitude + ', ' + reg.longitude + (reg.precisaoGps ? '  (±' + reg.precisaoGps + ' m)' : '') +
         (reg.obsGeo === 'Ajustado no mapa' ? '  - ajustado no mapa' : ''))
      : (reg.obsGeo || 'Não capturada'));
    if (img) {
      y = novaPaginaSePreciso(doc, y + 2, altMapa + 9);
      doc.addImage(img, 'JPEG', M, y, LARG, altMapa);
      cor(doc, CONFIG.cores.borda, 'traco'); doc.setLineWidth(0.3); doc.rect(M, y, LARG, altMapa);
      y += altMapa + 4;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(11, 127, 112);
      doc.textWithLink('Abrir este local no Google Maps', M, y + 1, { url: MAPA.linkGoogle(reg.latitude, reg.longitude) });
      texto0(doc);
      y += 4;
    } else if (tem) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(11, 127, 112);
      y = novaPaginaSePreciso(doc, y + 1, 6);
      doc.textWithLink('Abrir este local no Google Maps (mapa não incluído: PDF gerado sem internet)', M, y + 3,
        { url: MAPA.linkGoogle(reg.latitude, reg.longitude) });
      texto0(doc);
      y += 6;
    }
    return y;
  }

  /**
   * Registro fotográfico: fotos 1 a 6, duas por linha, cada uma com a sua
   * observação logo abaixo (moldura do mesmo tamanho para todas).
   */
  async function blocoFotos(doc, y, fotos) {
    const gerais = fotos.filter(f => !f.vinculo).sort((a, b) => (a.slot || a.ordem || 0) - (b.slot || b.ordem || 0));
    const colLarg = (LARG - 6) / 2;
    const imgAlt = 62;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8.6);
    const obs = gerais.map(f => doc.splitTextToSize(t(f.legenda || 'Sem observação.'), colLarg - 6).slice(0, 5));
    const altLinha = (k) => imgAlt + 13 + Math.max(obs[k] ? obs[k].length : 1, obs[k + 1] ? obs[k + 1].length : 1) * 3.9 + 4;
    if (!gerais.length) {
      y = secaoBloco(doc, y + 3, 'Registro fotográfico', 8);
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(120, 130, 140);
      doc.text('Nenhuma foto anexada.', M, y + 3);
      texto0(doc);
      return y + 8;
    }
    y = secaoBloco(doc, y + 3, 'Registro fotográfico (' + gerais.length + (gerais.length === 1 ? ' foto)' : ' fotos)'), altLinha(0));
    for (let k = 0; k < gerais.length; k += 2) {
      const alt = altLinha(k);
      y = novaPaginaSePreciso(doc, y, alt);
      for (let j = 0; j < 2 && k + j < gerais.length; j++) {
        const f = gerais[k + j];
        const x = M + j * (colLarg + 6);
        // Moldura do cartão da foto
        cor(doc, CONFIG.cores.borda, 'traco'); doc.setLineWidth(0.3);
        doc.setFillColor(255, 255, 255);
        doc.rect(x, y, colLarg, alt - 3, 'FD');
        // Número da foto
        cor(doc, CONFIG.cores.azulMarinho, 'preenchimento');
        doc.rect(x, y, colLarg, 6, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(255, 255, 255);
        doc.text('FOTO ' + (f.slot || (k + j + 1)), x + 3, y + 4.2);
        await desenharFoto(doc, f, x + 2, y + 7.5, colLarg - 4, imgAlt - 2);
        // Observação
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.2); cor(doc, CONFIG.cores.textoApoio, 'texto');
        doc.text('OBSERVAÇÃO', x + 3, y + imgAlt + 9);
        doc.setFont('helvetica', f.legenda ? 'normal' : 'italic'); doc.setFontSize(8.6);
        if (f.legenda) texto0(doc); else doc.setTextColor(140, 150, 160);
        doc.text(obs[k + j], x + 3, y + imgAlt + 13);
        texto0(doc);
      }
      y += alt;
    }
    return y;
  }

  /** Registro e validação: quem registrou e espaço para assinaturas. */
  function blocoValidacao(doc, y, reg) {
    y = secaoBloco(doc, y + 3, 'Registro e validação', 36);
    y = linha(doc, y, 'Registrado por', reg.responsavel + (reg.funcaoResponsavel ? '  (' + reg.funcaoResponsavel + ')' : ''));
    y = linha(doc, y, 'Registrado em', dataBR(reg.criadoEm) + ((reg.versao || 1) > 1 ? '   |   última edição: ' + dataBR(reg.atualizadoEm) : ''));
    if (reg.excluido) y = linha(doc, y, 'Relatório excluído em', dataBR(reg.excluidoEm) + (reg.motivoExclusao ? ' - ' + reg.motivoExclusao : ''), { cor: CONFIG.cores.naoConforme, negrito: true });
    y = novaPaginaSePreciso(doc, y + 4, 20);
    const larg = (LARG - 12) / 2;
    [['Responsável pelo registro', reg.responsavel], ['Fiscalização / Logística EDP', '']].forEach((a, i) => {
      const x = M + i * (larg + 12);
      cor(doc, '#8A97A3', 'traco'); doc.setLineWidth(0.3);
      doc.line(x, y + 12, x + larg, y + 12);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(8); cor(doc, CONFIG.cores.azulMarinho, 'texto');
      doc.text(t(a[0]), x, y + 16);
      if (a[1]) { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); cor(doc, CONFIG.cores.textoApoio, 'texto'); doc.text(t(a[1]), x, y + 19.5); }
    });
    texto0(doc);
    return y + 22;
  }

  async function corpoRelatorio(doc, y, reg, fotos) {
    y = faixaIdentificacao(doc, y, reg);
    y = blocoDados(doc, y, reg);
    y = await blocoNC(doc, y, reg, fotos);
    y = await blocoLocalizacao(doc, y, reg);
    y = await blocoFotos(doc, y, fotos);
    y = blocoValidacao(doc, y, reg);
    return y;
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
    const fotos = await DB.listarFotos(id);
    const doc = new jspdf.jsPDF({ unit: 'mm', format: 'a4', compress: true });
    await corpoRelatorio(doc, TOPO_CONTEUDO, reg, fotos);
    await aplicarFaixas(doc, CONFIG.app.titulo + ' - ' + reg.tipo,
      DB.numeroExibicao(reg) + '  |  NF ' + reg.nf + '  |  ' + reg.fornecedor);
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
    const comNC = lista.filter(r => r.naoConformidade === 'Sim').length;
    let totalFotos = 0;
    const qtds = {};
    for (const r of lista) { qtds[r.id] = await DB.contarFotos(r.id); totalFotos += qtds[r.id].total; }

    // Cartões de resumo
    y = secao(doc, y, 'Resumo');
    const cards = [
      ['Relatórios', lista.length, CONFIG.cores.verdeAgua],
      ['Recebimentos', receb, CONFIG.cores.recebimento],
      ['Saídas', lista.length - receb, CONFIG.cores.saida],
      ['Com NC', comNC, CONFIG.cores.naoConforme],
      ['Fotos', totalFotos, CONFIG.cores.azulMarinho]
    ];
    const lc = (LARG - 4 * 4) / 5;
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
      const local = r.tipo === 'Saída' ? [r.trecho, r.torre ? 'Torre ' + r.torre : ''].filter(Boolean).join(' - ') : DB.nomeCanteiro(r);
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
        if (i === 2) cor(doc, r.tipo === 'Saída' ? CONFIG.cores.saida : CONFIG.cores.recebimento, 'texto');
        if (i === 7 && pp[0] === 'Sim') { cor(doc, CONFIG.cores.naoConforme, 'texto'); doc.setFont('helvetica', 'bold'); }
        doc.text(pp, x + 1.8, y + 4.2);
        texto0(doc); doc.setFont('helvetica', 'normal');
        x += cols[i].l;
      });
      posPaginas.push({ pagina: doc.internal.getCurrentPageInfo().pageNumber, y: y + 4.2, x: x - cols[9].l + 1.8 });
      y += alt;
    }

    // Um relatório completo por página
    for (let i = 0; i < lista.length; i++) {
      doc.addPage();
      posPaginas[i].destino = doc.internal.getCurrentPageInfo().pageNumber;
      const fotos = await DB.listarFotos(lista[i].id);
      await corpoRelatorio(doc, TOPO_CONTEUDO, lista[i], fotos);
    }
    // Número da página de cada relatório na tabela (com link interno)
    posPaginas.forEach(pp => {
      doc.setPage(pp.pagina);
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7.8); doc.setTextColor(11, 127, 112);
      doc.textWithLink('p. ' + pp.destino, pp.x, pp.y, { pageNumber: pp.destino });
      texto0(doc);
    });

    await aplicarFaixas(doc, 'Relatório Fotográfico Consolidado', 'Consolidado  |  ' + (descricaoFiltro || 'todos os registros'));
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
