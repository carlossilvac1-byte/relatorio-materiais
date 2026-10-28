/* =====================================================================
 * imagem.js — RELATÓRIO EM IMAGEM ÚNICA (para o grupo do WhatsApp)
 * ---------------------------------------------------------------------
 * Mesmo layout e identidade do PDF (faixa EDP, identificação, dados,
 * não conformidade, registro fotográfico e localização), desenhado num
 * canvas como UMA página contínua. Sai em JPEG, pronto para enviar no
 * WhatsApp ou salvar na galeria. Gerado no próprio aparelho, sem
 * internet (o mapa entra quando há sinal).
 *
 *   IMAGEM.gerar(id)  -> { blob, nome, largura, altura }
 *   IMAGEM.paraPng(b) -> Blob PNG (para copiar na área de transferência)
 * ===================================================================== */

const IMAGEM = (function () {

  const W = 1240;                 // largura final (px)
  const M = 48;                   // margem lateral
  const LARG = W - M * 2;
  const FONTE = 'Arial, "Helvetica Neue", Helvetica, sans-serif';
  const C = () => CONFIG.cores;

  function f(ctx, tam, peso) { ctx.font = (peso || 'normal') + ' ' + tam + 'px ' + FONTE; }

  /** Quebra o texto em linhas que cabem na largura (respeita \n). */
  function quebrar(ctx, texto, largura, maxLinhas) {
    const linhas = [];
    String(texto == null ? '' : texto).split(/\r?\n/).forEach(par => {
      const palavras = par.split(/\s+/).filter(Boolean);
      if (!palavras.length) { linhas.push(''); return; }
      let atual = '';
      palavras.forEach(p => {
        const teste = atual ? atual + ' ' + p : p;
        if (ctx.measureText(teste).width <= largura) { atual = teste; return; }
        if (atual) linhas.push(atual);
        // palavra maior que a linha: corta
        while (ctx.measureText(p).width > largura && p.length > 1) {
          let k = p.length;
          while (k > 1 && ctx.measureText(p.slice(0, k)).width > largura) k--;
          linhas.push(p.slice(0, k)); p = p.slice(k);
        }
        atual = p;
      });
      if (atual) linhas.push(atual);
    });
    if (maxLinhas && linhas.length > maxLinhas) {
      const l = linhas.slice(0, maxLinhas);
      let u = l[maxLinhas - 1];
      while (u.length > 1 && ctx.measureText(u + '…').width > largura) u = u.slice(0, -1);
      l[maxLinhas - 1] = u + '…';
      return l;
    }
    return linhas;
  }

  function carregarImagem(src) {
    return new Promise((ok, erro) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => erro(new Error('imagem'));
      img.src = src;
    });
  }

  async function imagemDaFoto(foto) {
    if (!foto || foto.indisponivel || !foto.blob) return null;
    const url = URL.createObjectURL(foto.blob);
    try { return await carregarImagem(url); } catch (e) { return null; } finally { setTimeout(() => URL.revokeObjectURL(url), 5000); }
  }

  /** Foto centralizada na moldura, sem distorcer (igual ao PDF). */
  function desenharContida(ctx, img, x, y, w, h) {
    ctx.fillStyle = '#F5F7F9'; ctx.fillRect(x, y, w, h);
    if (!img) {
      ctx.strokeStyle = '#C9D2DA'; ctx.setLineDash([8, 6]); ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2); ctx.setLineDash([]);
      f(ctx, 22, 'bold'); ctx.fillStyle = '#4A5763'; ctx.textAlign = 'center';
      ctx.fillText('Foto indisponível', x + w / 2, y + h / 2 + 8); ctx.textAlign = 'left';
      return;
    }
    const e = Math.min(w / img.naturalWidth, h / img.naturalHeight);
    const iw = img.naturalWidth * e, ih = img.naturalHeight * e;
    ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
  }

  function secao(ctx, y, titulo, corHex) {
    ctx.fillStyle = corHex || C().cabecalho; ctx.fillRect(M, y, 8, 34);
    f(ctx, 28, 'bold'); ctx.fillStyle = corHex || C().cabecalho;
    ctx.fillText(titulo, M + 22, y + 27);
    return y + 52;
  }

  /** Linha rótulo | valor (mesma tabela do PDF). */
  function linha(ctx, y, rotulo, valor, opc) {
    opc = opc || {};
    const lr = 300, lv = LARG - lr;
    f(ctx, 23, opc.negrito ? 'bold' : 'normal');
    const linhas = quebrar(ctx, valor === '' || valor == null ? '-' : valor, lv - 32, opc.max || 6);
    const alt = Math.max(54, linhas.length * 31 + 22);
    ctx.fillStyle = '#EEF2F5'; ctx.fillRect(M, y, lr, alt);
    ctx.fillStyle = opc.fundo || '#FFFFFF'; ctx.fillRect(M + lr, y, lv, alt);
    ctx.strokeStyle = C().borda; ctx.lineWidth = 1.5; ctx.strokeRect(M, y, lr, alt); ctx.strokeRect(M + lr, y, lv, alt);
    f(ctx, 22, 'bold'); ctx.fillStyle = C().azulMarinho;
    quebrar(ctx, rotulo, lr - 30, 2).forEach((l, i) => ctx.fillText(l, M + 16, y + 35 + i * 28));
    f(ctx, 23, opc.negrito ? 'bold' : 'normal'); ctx.fillStyle = opc.cor || '#14181F';
    linhas.forEach((l, i) => ctx.fillText(l, M + lr + 16, y + 35 + i * 31));
    return y + alt;
  }

  async function logoEDP() {
    if (typeof LOGO_EDP_BASE64 !== 'string' || LOGO_EDP_BASE64.length < 100) return null;
    const src = LOGO_EDP_BASE64.indexOf('data:') === 0 ? LOGO_EDP_BASE64 : 'data:image/png;base64,' + LOGO_EDP_BASE64;
    try { return await carregarImagem(src); } catch (e) { return null; }
  }

  async function desenhar(reg, fotos) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = 7000;            // recortado no fim
    const ctx = canvas.getContext('2d');
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, W, canvas.height);
    const tipoCor = reg.tipo === 'Saída' ? C().saida : C().recebimento;
    const nc = reg.naoConformidade === 'Sim';

    // ---- Faixa superior (identidade EDP) --------------------------
    ctx.fillStyle = C().azulMarinho; ctx.fillRect(0, 0, W, 150);
    const lg = await logoEDP();
    if (lg) { const h = 58, w = h * lg.naturalWidth / lg.naturalHeight; ctx.drawImage(lg, M, (150 - h) / 2, w, h); }
    ctx.textAlign = 'right';
    f(ctx, 34, 'bold'); ctx.fillStyle = '#FFFFFF';
    ctx.fillText('Relatório Fotográfico de Materiais', W - M, 66);
    f(ctx, 24, 'bold'); ctx.fillStyle = tipoCor === C().saida ? '#FFB547' : '#5ED3E6';
    ctx.fillText(String(reg.tipo || '').toUpperCase(), W - M, 104);
    f(ctx, 19); ctx.fillStyle = '#9FB2BC';
    ctx.fillText(CONFIG.app.obra, W - M, 132);
    ctx.textAlign = 'left';
    let y = 190;

    // ---- Número do relatório --------------------------------------
    f(ctx, 22, 'bold'); ctx.fillStyle = C().textoApoio; ctx.fillText('RELATÓRIO Nº', M, y + 4);
    f(ctx, 64, 'bold'); ctx.fillStyle = C().azulMarinho; ctx.fillText(DB.seqExibicao(reg), M, y + 70);
    const larguraSeq = ctx.measureText(DB.seqExibicao(reg)).width;
    f(ctx, 26, 'bold'); ctx.fillStyle = C().cabecalho;
    ctx.fillText(DB.numeroExibicao(reg), M + larguraSeq + 28, y + 44);
    f(ctx, 21); ctx.fillStyle = C().textoApoio;
    ctx.fillText(quebrar(ctx, 'Registrado por ' + (reg.responsavel || '-') + ' em ' + PDFGEN.dataBR(reg.criadoEm), W - M - (M + larguraSeq + 28), 1)[0], M + larguraSeq + 28, y + 74);
    // Selo NC
    ctx.textAlign = 'right';
    const selo = nc ? 'COM NÃO CONFORMIDADE' : 'SEM NÃO CONFORMIDADE';
    f(ctx, 21, 'bold');
    const ls = ctx.measureText(selo).width + 36;
    // Selo na linha do "RELATÓRIO Nº" (não disputa espaço com o número e o responsável)
    ctx.fillStyle = nc ? '#FDECEC' : '#EAF4EB'; ctx.fillRect(W - M - ls, y - 22, ls, 40);
    ctx.strokeStyle = nc ? '#F0BDBD' : '#B9D9BB'; ctx.lineWidth = 2; ctx.strokeRect(W - M - ls, y - 22, ls, 40);
    ctx.fillStyle = nc ? C().naoConforme : C().conforme; ctx.fillText(selo, W - M - 18, y + 6);
    ctx.textAlign = 'left';
    y += 104;

    // ---- Identificação: PROJETO | LOTE | DATA | TIPO ---------------
    const cols = [
      { r: 'PROJETO', v: DB.nomeProjeto(reg), l: LARG * 0.46 },
      { r: 'LOTE', v: CONFIG.rotuloLote(reg.lote), l: LARG * 0.14 },
      { r: 'DATA', v: PDFGEN.dataBR(reg.dataRelatorio), l: LARG * 0.18 },
      { r: 'TIPO', v: String(reg.tipo || '').toUpperCase(), l: LARG * 0.22 }
    ];
    f(ctx, 26, 'bold');
    const linhasProj = quebrar(ctx, cols[0].v || '-', cols[0].l - 32, 2);
    const altId = linhasProj.length > 1 ? 112 : 86;
    ctx.fillStyle = '#E9F6F4'; ctx.fillRect(M, y, LARG, altId);
    const xt = M + cols[0].l + cols[1].l + cols[2].l;
    ctx.fillStyle = tipoCor; ctx.fillRect(xt, y, cols[3].l, altId);
    ctx.strokeStyle = C().verdeAgua; ctx.lineWidth = 2.5; ctx.strokeRect(M, y, LARG, altId);
    let x = M;
    cols.forEach((c, i) => {
      const ehTipo = i === 3;
      f(ctx, 18); ctx.fillStyle = ehTipo ? '#FFFFFF' : C().textoApoio; ctx.fillText(c.r, x + 16, y + 28);
      f(ctx, 26, 'bold'); ctx.fillStyle = ehTipo ? '#FFFFFF' : C().azulMarinho;
      const ls2 = i === 0 ? linhasProj : quebrar(ctx, c.v || '-', c.l - 32, 1);
      ls2.forEach((l, k) => ctx.fillText(l, x + 16, y + 62 + k * 30));
      if (i > 0 && !ehTipo) { ctx.strokeStyle = '#BFE3DC'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(x, y + 10); ctx.lineTo(x, y + altId - 10); ctx.stroke(); }
      x += c.l;
    });
    y += altId + 30;

    // ---- Dados -----------------------------------------------------
    y = secao(ctx, y, reg.tipo === 'Saída' ? 'Dados da saída' : 'Dados do recebimento');
    y = linha(ctx, y, 'NF', reg.nf, { negrito: true });
    y = linha(ctx, y, 'Fornecedor', reg.fornecedor);
    if (reg.tipo === 'Saída') {
      y = linha(ctx, y, 'Transportadora', reg.transportadora);
      y = linha(ctx, y, 'Trecho / Torre', [reg.trecho, reg.torre ? 'Torre ' + reg.torre : ''].filter(Boolean).join('  -  '));
    } else {
      y = linha(ctx, y, 'Canteiro', DB.nomeCanteiro(reg));
    }
    y = linha(ctx, y, 'Descrição do material', reg.descricao, { max: 8 });
    if (reg.observacoes) y = linha(ctx, y, 'Observações gerais', reg.observacoes, { max: 5 });
    y += 26;

    // ---- Não conformidade -----------------------------------------
    if (!nc) {
      y = secao(ctx, y, 'Não conformidade');
      y = linha(ctx, y, 'Houve não conformidade?', 'Não', { negrito: true, cor: C().conforme, fundo: '#EAF4EB' });
      y += 26;
    } else {
      y = secao(ctx, y, 'Não conformidade identificada', C().naoConforme);
      f(ctx, 23);
      const ld = quebrar(ctx, reg.descricaoNC || '-', LARG - 56, 10);
      const alt = 58 + ld.length * 31;
      ctx.fillStyle = '#FDECEC'; ctx.fillRect(M, y, LARG, alt);
      ctx.strokeStyle = '#F0BDBD'; ctx.lineWidth = 2; ctx.strokeRect(M, y, LARG, alt);
      ctx.fillStyle = C().naoConforme; ctx.fillRect(M, y, 8, alt);
      f(ctx, 20, 'bold'); ctx.fillText('HOUVE NÃO CONFORMIDADE: SIM  -  DESCRIÇÃO', M + 28, y + 34);
      f(ctx, 23); ctx.fillStyle = '#14181F';
      ld.forEach((l, i) => ctx.fillText(l, M + 28, y + 70 + i * 31));
      y += alt + 18;
      const fsNC = fotos.filter(ft => ft.vinculo);
      const gap = 18, cw = (LARG - gap * 2) / 3, ch = cw * 0.75;
      for (let i = 0; i < fsNC.length; i += 3) {
        for (let j = 0; j < 3 && i + j < fsNC.length; j++) {
          const xx = M + j * (cw + gap);
          desenharContida(ctx, await imagemDaFoto(fsNC[i + j]), xx, y, cw, ch);
          ctx.strokeStyle = '#E08A8A'; ctx.lineWidth = 2; ctx.strokeRect(xx, y, cw, ch);
          f(ctx, 19, 'bold'); ctx.fillStyle = C().naoConforme;
          const leg = 'Foto NC ' + (i + j + 1) + (fsNC[i + j].legenda ? ' - ' + fsNC[i + j].legenda : '');
          ctx.fillText(quebrar(ctx, leg, cw, 1)[0], xx, y + ch + 28);
        }
        y += ch + 46;
      }
      y += 12;
    }

    // ---- Registro fotográfico (3 por linha, com a observação) ------
    const gerais = fotos.filter(ft => !ft.vinculo).sort((a, b) => (a.slot || 0) - (b.slot || 0));
    y = secao(ctx, y, 'Registro fotográfico (' + gerais.length + (gerais.length === 1 ? ' foto)' : ' fotos)'));
    if (!gerais.length) {
      f(ctx, 22, 'italic'); ctx.fillStyle = '#7A8894'; ctx.fillText('Nenhuma foto anexada.', M, y + 10); y += 40;
    }
    const gap = 20, cw = (LARG - gap * 2) / 3, ph = cw * 0.75;
    for (let i = 0; i < gerais.length; i += 3) {
      f(ctx, 20);
      const obsLinhas = [0, 1, 2].map(j => gerais[i + j] ? quebrar(ctx, gerais[i + j].legenda || 'Sem observação.', cw - 28, 4) : []);
      const ch = 44 + ph + 50 + Math.max(1, ...obsLinhas.map(l => l.length)) * 26 + 14;
      for (let j = 0; j < 3 && i + j < gerais.length; j++) {
        const ft = gerais[i + j];
        const xx = M + j * (cw + gap);
        ctx.fillStyle = '#FFFFFF'; ctx.fillRect(xx, y, cw, ch);
        ctx.strokeStyle = C().borda; ctx.lineWidth = 2; ctx.strokeRect(xx, y, cw, ch);
        ctx.fillStyle = C().azulMarinho; ctx.fillRect(xx, y, cw, 40);
        f(ctx, 20, 'bold'); ctx.fillStyle = '#FFFFFF'; ctx.fillText('FOTO ' + (ft.slot || i + j + 1), xx + 14, y + 27);
        desenharContida(ctx, await imagemDaFoto(ft), xx + 6, y + 46, cw - 12, ph - 6);
        f(ctx, 16, 'bold'); ctx.fillStyle = C().textoApoio; ctx.fillText('OBSERVAÇÃO', xx + 14, y + 46 + ph + 22);
        f(ctx, 20, ft.legenda ? 'normal' : 'italic'); ctx.fillStyle = ft.legenda ? '#14181F' : '#8C96A0';
        obsLinhas[j].forEach((l, k) => ctx.fillText(l, xx + 14, y + 46 + ph + 50 + k * 26));
      }
      y += ch + gap;
    }
    y += 10;

    // ---- Localização ----------------------------------------------
    y = secao(ctx, y, 'Localização');
    const tem = MAPA.temCoord(reg);
    y = linha(ctx, y, 'Coordenadas (GPS)', tem
      ? (reg.latitude + ', ' + reg.longitude + (reg.precisaoGps ? '  (±' + reg.precisaoGps + ' m)' : '') + (reg.obsGeo === 'Ajustado no mapa' ? '  - ajustado no mapa' : ''))
      : (reg.obsGeo || 'Não capturada'));
    if (tem) {
      let mapa = null;
      try { mapa = await MAPA.imagemEstatica(reg.latitude, reg.longitude, { zoom: 16, largura: 1144, altura: 300, nc: nc }); } catch (e) { mapa = null; }
      if (mapa) {
        try {
          const im = await carregarImagem(mapa);
          y += 14;
          ctx.drawImage(im, M, y, LARG, LARG * 300 / 1144);
          ctx.strokeStyle = C().borda; ctx.lineWidth = 2; ctx.strokeRect(M, y, LARG, LARG * 300 / 1144);
          y += LARG * 300 / 1144;
        } catch (e) { /* segue sem o mapa */ }
      }
      f(ctx, 19); ctx.fillStyle = '#0B7F70';
      ctx.fillText('Google Maps: ' + MAPA.linkGoogle(reg.latitude, reg.longitude).replace('https://', ''), M, y + 32);
      y += 44;
    }
    y += 24;

    // ---- Faixa inferior --------------------------------------------
    const altRod = 96;
    ctx.fillStyle = C().azulMarinho; ctx.fillRect(0, y, W, altRod);
    f(ctx, 20); ctx.fillStyle = '#FFFFFF';
    ctx.fillText(quebrar(ctx, DB.numeroExibicao(reg) + '  |  NF ' + (reg.nf || '-') + '  |  ' + (reg.fornecedor || '-'), LARG - 300, 1)[0], M, y + 40);
    ctx.fillStyle = '#9FB2BC';
    ctx.fillText('Emitido em ' + new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }), M, y + 72);
    ctx.textAlign = 'right'; f(ctx, 20, 'bold'); ctx.fillStyle = '#FFFFFF';
    ctx.fillText('Página única', W - M, y + 56);
    ctx.textAlign = 'left';
    y += altRod;

    // Recorta na altura usada
    const final = document.createElement('canvas');
    final.width = W; final.height = Math.ceil(y);
    final.getContext('2d').drawImage(canvas, 0, 0);
    return final;
  }

  function paraBlob(canvas, tipo, qualidade) {
    return new Promise((ok, erro) => {
      const via = () => {
        try {
          const s = canvas.toDataURL(tipo, qualidade), b = atob(s.split(',')[1]);
          const arr = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) arr[i] = b.charCodeAt(i);
          ok(new Blob([arr], { type: tipo }));
        } catch (e) { erro(e); }
      };
      if (canvas.toBlob) canvas.toBlob(bl => (bl && bl.size ? ok(bl) : via()), tipo, qualidade); else via();
    });
  }

  function limpar(t) {
    return String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'SEM';
  }

  async function gerar(id) {
    const reg = await DB.obterRelatorio(id);
    if (!reg) throw new Error('Relatório não encontrado.');
    const fotos = await DB.listarFotos(id);
    const canvas = await desenhar(reg, fotos);
    const blob = await paraBlob(canvas, 'image/jpeg', 0.88);
    const nome = (DB.numeroRelatorio(reg) || 'RF-' + limpar(reg.lote)) + '_' + limpar(reg.tipo) + '_' + reg.dataRelatorio + '.jpg';
    return { blob: blob, nome: nome, largura: canvas.width, altura: canvas.height };
  }

  async function paraPng(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await carregarImagem(url);
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      return await paraBlob(c, 'image/png');
    } finally { URL.revokeObjectURL(url); }
  }

  return { gerar: gerar, paraPng: paraPng };
})();

window.IMAGEM = IMAGEM;
