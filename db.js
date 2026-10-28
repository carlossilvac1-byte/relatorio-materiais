/* =====================================================================
 * db.js — CAMADA DE PERSISTÊNCIA LOCAL (IndexedDB via Dexie)
 * ---------------------------------------------------------------------
 * Princípio offline-first: TUDO é gravado primeiro aqui. A rede é um
 * detalhe posterior. Nenhuma tela fala com o servidor; todas falam com
 * este arquivo.
 *
 * Cada relatório carrega usuarioId: trocar de usuário no mesmo aparelho
 * não expõe os registros do anterior, e a fila de envio é por usuário.
 *
 * Tabelas:
 *   relatorios     - o relatório (sem as fotos)
 *   fotos          - uma linha por foto, gravada em BYTES (ArrayBuffer)
 *                    slot 1..6 = fotos do relatório; vinculo {tipo:'nc'}
 *                    = evidência da não conformidade
 *   versoes        - cópia da versão anterior a cada edição
 *   auditoria      - trilha (criação, edição, exclusão, envio)
 *   syncLog        - log das sincronizações
 *   kv             - sessão e preferências do aparelho
 *   usuariosLocais - contas do modo local (sem servidor)
 * ===================================================================== */

const DB = (function () {

  const db = new Dexie('rf_materiais_edp');

  // v1 — estrutura inicial. Mudanças futuras: db.version(2) declarando
  // só as tabelas novas (padrão do app de Inspeções).
  db.version(1).stores({
    relatorios:     'id, usuarioId, dataRelatorio, lote, tipo, naoConformidade, status, excluido, criadoEm, atualizadoEm',
    fotos:          'id, relatorioId, ordem',
    versoes:        '++seq, relatorioId, salvoEm',
    auditoria:      '++seq, relatorioId, em, acao',
    syncLog:        '++seq, em',
    kv:             'chave',
    usuariosLocais: 'id, email'
  });

  // ---------------------------------------------------------------
  // Utilitários
  // ---------------------------------------------------------------
  function uuid() {
    if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    const buf = new Uint8Array(16);
    crypto.getRandomValues(buf);
    buf[6] = (buf[6] & 0x0f) | 0x40;
    buf[8] = (buf[8] & 0x3f) | 0x80;
    const hex = Array.from(buf, b => b.toString(16).padStart(2, '0')).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) +
           '-' + hex.slice(16, 20) + '-' + hex.slice(20);
  }

  function agora() { return new Date().toISOString(); }

  function hojeISO() {
    const d = new Date();
    return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  }

  function dispositivo() {
    const ua = navigator.userAgent || '';
    let so = 'Desconhecido';
    if (/Android/i.test(ua)) so = 'Android';
    else if (/iPhone|iPad|iPod/i.test(ua)) so = 'iOS';
    else if (/Windows/i.test(ua)) so = 'Windows';
    else if (/Mac OS X/i.test(ua)) so = 'macOS';
    else if (/Linux/i.test(ua)) so = 'Linux';
    let nav = 'Outro';
    if (/Edg\//.test(ua)) nav = 'Edge';
    else if (/Chrome\//.test(ua)) nav = 'Chrome';
    else if (/Firefox\//.test(ua)) nav = 'Firefox';
    else if (/Safari\//.test(ua)) nav = 'Safari';
    return so + ' / ' + nav;
  }

  function usuarioAtual() {
    return (window.AUTH && AUTH.usuarioId) ? AUTH.usuarioId() : null;
  }

  // ---------------------------------------------------------------
  // Preferências (chave/valor)
  // ---------------------------------------------------------------
  async function kvSet(chave, valor) {
    await db.kv.put({ chave: chave, valor: valor });
    return valor;
  }
  async function kvGet(chave, padrao) {
    const r = await db.kv.get(chave);
    if (!r || r.valor === null || r.valor === undefined) return padrao === undefined ? null : padrao;
    return r.valor;
  }

  // ---------------------------------------------------------------
  // Contas locais (modo sem servidor)
  // ---------------------------------------------------------------
  async function contarUsuariosLocais() { return db.usuariosLocais.count(); }
  async function listarUsuariosLocais() {
    const l = await db.usuariosLocais.toArray();
    l.sort((a, b) => String(a.nome).localeCompare(String(b.nome), 'pt-BR'));
    return l;
  }
  async function obterUsuarioLocalPorEmail(email) {
    const alvo = String(email || '').trim().toLowerCase();
    const todos = await db.usuariosLocais.toArray();
    return todos.filter(u => String(u.email).toLowerCase() === alvo)[0] || null;
  }
  async function criarUsuarioLocal(dados) {
    const registro = {
      id: 'local-' + uuid(),
      nome: dados.nome,
      email: String(dados.email).trim().toLowerCase(),
      funcao: dados.funcao,
      lotes: dados.lotes || [],
      perfil: dados.perfil || 'inspetor',
      visao: dados.perfil === 'admin' ? 'todas' : 'proprias',
      status: 'ativo',
      credencial: dados.credencial,
      criado_em: agora(),
      ultimo_acesso: null,
      local: true
    };
    await db.usuariosLocais.add(registro);
    await auditar('(sistema)', 'cadastro-local',
      'Conta criada neste aparelho: ' + registro.email + ' (' + registro.perfil + ')', registro.nome);
    return registro;
  }
  async function atualizarUsuarioLocal(id, campos) {
    await db.usuariosLocais.update(id, campos);
    return db.usuariosLocais.get(id);
  }
  /** Mesma pessoa que usava o modo local entrou na base central: os registros vão junto. */
  async function migrarRegistrosLocais(idAntigo, idNovo) {
    if (!idAntigo || !idNovo || idAntigo === idNovo) return 0;
    const n = await db.relatorios.where('usuarioId').equals(idAntigo).modify({ usuarioId: idNovo });
    if (n) await auditar('(sistema)', 'migracao', n + ' relatório(s) da conta local passaram para a conta da base central.', '');
    return n;
  }

  // ---------------------------------------------------------------
  // Compressão de imagem — lado maior 1600 px, alvo ~300 KB, JPEG
  // ---------------------------------------------------------------
  async function comprimirImagem(arquivo) {
    const L = CONFIG.limites;
    let bitmap = null, img = null, url = null, larguraOrig, alturaOrig;
    if (typeof createImageBitmap === 'function') {
      try {
        bitmap = await createImageBitmap(arquivo);
        larguraOrig = bitmap.width; alturaOrig = bitmap.height;
      } catch (e) { bitmap = null; }
    }
    if (!bitmap) {
      url = URL.createObjectURL(arquivo);
      img = await new Promise((ok, erro) => {
        const e = new Image();
        e.onload = () => ok(e);
        e.onerror = () => erro(new Error('Não foi possível ler a imagem.'));
        e.src = url;
      });
      larguraOrig = img.naturalWidth; alturaOrig = img.naturalHeight;
    }
    const maior = Math.max(larguraOrig, alturaOrig);
    const escala = maior > L.fotoLadoMaior ? L.fotoLadoMaior / maior : 1;
    const largura = Math.max(1, Math.round(larguraOrig * escala));
    const altura = Math.max(1, Math.round(alturaOrig * escala));

    const canvas = document.createElement('canvas');
    canvas.width = largura; canvas.height = altura;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, largura, altura);
    ctx.drawImage(bitmap || img, 0, 0, largura, altura);
    if (bitmap && bitmap.close) bitmap.close();
    if (url) URL.revokeObjectURL(url);

    let qualidade = L.fotoQualidadeInicial;
    let blob = await paraBlob(canvas, qualidade);
    if (!blob) throw new Error('O aparelho não conseguiu processar esta foto. Tente novamente.');
    while (blob.size > L.fotoAlvoBytes && qualidade > L.fotoQualidadeMinima) {
      qualidade = Math.max(L.fotoQualidadeMinima, qualidade - 0.10);
      blob = await paraBlob(canvas, qualidade);
    }
    if (blob.size > L.fotoAlvoBytes && largura > 640) {
      const c2 = document.createElement('canvas');
      c2.width = Math.round(largura * 0.8); c2.height = Math.round(altura * 0.8);
      c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
      blob = await paraBlob(c2, L.fotoQualidadeMinima + 0.1);
      return { blob: blob, largura: c2.width, altura: c2.height, bytes: blob.size };
    }
    return { blob: blob, largura: largura, altura: altura, bytes: blob.size };
  }

  function paraBlob(canvas, qualidade) {
    return new Promise((ok) => {
      const viaDataUrl = () => {
        try { ok(dataUrlParaBlob(canvas.toDataURL('image/jpeg', qualidade))); } catch (e) { ok(null); }
      };
      // No iPhone o toBlob pode devolver null (memória): cai no toDataURL.
      if (canvas.toBlob) canvas.toBlob(b => (b && b.size ? ok(b) : viaDataUrl()), 'image/jpeg', qualidade);
      else viaDataUrl();
    });
  }

  /* ---------------------------------------------------------------
   * Fotos em BYTES (ArrayBuffer), nunca Blob: no iPhone um Blob gravado
   * no IndexedDB pode ficar ilegível depois de recarregar o app.
   * ------------------------------------------------------------- */
  async function lerBytes(blob) {
    if (!blob) throw new Error('Foto vazia.');
    if (blob.arrayBuffer) return await blob.arrayBuffer();
    return await new Promise((ok, erro) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result);
      fr.onerror = () => erro(fr.error || new Error('Falha ao ler a foto.'));
      fr.readAsArrayBuffer(blob);
    });
  }

  /** Assinatura de imagem de verdade (JPEG, PNG ou WebP). */
  function imagemValida(bytes) {
    if (!bytes || bytes.byteLength < 200) return false;
    const b = new Uint8Array(bytes, 0, 12);
    const jpeg = b[0] === 0xFF && b[1] === 0xD8;
    const png = b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4E && b[3] === 0x47;
    const webp = b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45;
    return jpeg || png || webp;
  }
  function tipoDosBytes(bytes) {
    const b = new Uint8Array(bytes, 0, 4);
    if (b[0] === 0x89) return 'image/png';
    if (b[0] === 0x52) return 'image/webp';
    return 'image/jpeg';
  }

  /** Recria o Blob a partir dos bytes; sem bytes, marca como indisponível. */
  function prepararFoto(f) {
    if (f.dados && f.dados.byteLength) {
      f.blob = new Blob([f.dados], { type: f.tipo || 'image/jpeg' });
      f.indisponivel = false;
    } else {
      f.blob = null;
      f.indisponivel = true;
    }
    return f;
  }

  /** Registro antigo com Blob: converte para bytes (ou marca como perdido). */
  async function migrarFoto(f) {
    if (f.dados || f.corrompida || !f.blob) return f;
    let dados = null;
    try { const b = await lerBytes(f.blob); if (imagemValida(b)) dados = b; } catch (e) { /* Blob perdido */ }
    const mud = dados ? { dados: dados, tipo: tipoDosBytes(dados), blob: undefined, bytes: dados.byteLength }
                      : { corrompida: 1, blob: undefined };
    try { await db.fotos.update(f.id, mud); } catch (e) { /* segue com a cópia em memória */ }
    Object.assign(f, mud);
    delete f.blob;
    return f;
  }

  function dataUrlParaBlob(dataUrl) {
    const partes = dataUrl.split(',');
    const mime = partes[0].match(/:(.*?);/)[1];
    const bin = atob(partes[1]);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  function blobParaBase64(blob) {
    return new Promise((ok, erro) => {
      const fr = new FileReader();
      fr.onload = () => { const s = String(fr.result); ok(s.slice(s.indexOf(',') + 1)); };
      fr.onerror = () => erro(fr.error);
      fr.readAsDataURL(blob);
    });
  }
  function blobParaDataUrl(blob) {
    return new Promise((ok, erro) => {
      const fr = new FileReader();
      fr.onload = () => ok(String(fr.result));
      fr.onerror = () => erro(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  // ---------------------------------------------------------------
  // Auditoria
  // ---------------------------------------------------------------
  async function auditar(relatorioId, acao, detalhe, usuario) {
    const p = (window.AUTH && AUTH.perfil) ? AUTH.perfil() : null;
    await db.auditoria.add({
      relatorioId: relatorioId || '(sistema)',
      usuarioId: usuarioAtual(),
      acao: acao,
      detalhe: detalhe || '',
      usuario: usuario || (p ? p.nome : 'não identificado'),
      dispositivo: dispositivo(),
      em: agora()
    });
  }

  // ---------------------------------------------------------------
  // Relatórios
  // ---------------------------------------------------------------

  /**
   * Número do relatório: RF-<SIGLA DO PROJETO>-001 (sequencial por projeto).
   * Com a base central, a sequência é definida pelo servidor no envio —
   * antes disso o relatório fica com o número "pendente".
   */
  function numeroRelatorio(r) {
    if (!r) return '';
    if (r.numero && /^RF-/.test(r.numero)) return r.numero;
    return CONFIG.numeroFormatado(nomeProjeto(r), r.seq);
  }
  /** Texto para telas e PDF (com aviso quando ainda não foi numerado). */
  function numeroExibicao(r) {
    return numeroRelatorio(r) || 'Nº pendente (definido no envio)';
  }
  /** Só a sequência, ex.: "007" (ou "—"). */
  function seqExibicao(r) {
    return r && r.seq ? String(r.seq).padStart(3, '0') : '—';
  }

  /** Próximo número no modo local (sem base central): maior do projeto + 1. */
  async function proximoSeqLocal(projeto, ignorarId) {
    const lista = await db.relatorios.toArray();
    return lista.filter(r => r.id !== ignorarId && nomeProjeto(r) === projeto && r.seq)
      .reduce((m, r) => Math.max(m, r.seq), 0) + 1;
  }

  /** Número definido pela base central depois do envio. */
  async function definirNumero(id, seq, numero) {
    if (!seq) return;
    const r = await db.relatorios.get(id);
    if (!r) return;
    await db.relatorios.update(id, { seq: seq, numero: numero || CONFIG.numeroFormatado(nomeProjeto(r), seq) });
  }

  /** Modelo em branco já vinculado ao usuário logado. */
  function novoRelatorio(tipo) {
    const p = (window.AUTH && AUTH.perfil) ? AUTH.perfil() : null;
    const lotes = (window.AUTH && AUTH.lotes) ? AUTH.lotes() : [];
    return {
      id: uuid(),
      usuarioId: usuarioAtual(),
      numero: '',
      seq: null,
      projeto: (lotes.length === 1 && CONFIG.listarProjetos(lotes[0]).length === 1) ? CONFIG.listarProjetos(lotes[0])[0] : '',
      projetoOutro: '',
      lote: lotes.length === 1 ? lotes[0] : '',
      dataRelatorio: hojeISO(),
      tipo: CONFIG.tipos.indexOf(tipo) !== -1 ? tipo : '',
      nf: '',
      fornecedor: '',
      canteiro: '',
      canteiroOutro: '',
      transportadora: '',
      trecho: '',
      torre: '',
      descricao: '',
      naoConformidade: 'Não',
      descricaoNC: '',
      observacoes: '',
      latitude: null, longitude: null, precisaoGps: null, obsGeo: null, ajusteManual: false,
      responsavel: p ? p.nome : '',
      funcaoResponsavel: p ? p.funcao : '',
      emailResponsavel: p ? p.email : '',
      dispositivo: dispositivo(),
      criadoEm: agora(),
      atualizadoEm: agora(),
      versao: 1,
      status: 'pendente',
      erroMsg: '',
      tentativas: 0,
      sincronizadoEm: null,
      excluido: 0,
      excluidoEm: null,
      motivoExclusao: ''
    };
  }

  /** Grava (cria ou atualiza). Em edição, arquiva a versão anterior e devolve à fila. */
  async function salvarRelatorio(registro) {
    const anterior = await db.relatorios.get(registro.id);
    const ehNovo = !anterior;
    if (anterior) {
      await db.versoes.add({
        relatorioId: anterior.id, usuarioId: anterior.usuarioId, salvoEm: agora(),
        versao: anterior.versao || 1, conteudo: JSON.parse(JSON.stringify(anterior))
      });
      registro.criadoEm = anterior.criadoEm;
      registro.versao = (anterior.versao || 1) + 1;
      registro.usuarioId = anterior.usuarioId;          // o autor não muda
    } else if (!registro.usuarioId) {
      registro.usuarioId = usuarioAtual();
    }
    // Campos que não pertencem ao tipo escolhido saem do registro.
    if (registro.tipo === 'Recebimento') { registro.transportadora = ''; registro.trecho = ''; registro.torre = ''; }
    if (registro.tipo === 'Saída') { registro.canteiro = ''; registro.canteiroOutro = ''; }
    if (registro.naoConformidade !== 'Sim') registro.descricaoNC = '';
    // Numeração por projeto: trocou de projeto, ganha número novo no novo projeto.
    if (anterior && nomeProjeto(anterior) !== nomeProjeto(registro)) { registro.seq = null; registro.numero = ''; }
    if (!registro.seq && window.AUTH && AUTH.modoLocal && AUTH.modoLocal()) {
      registro.seq = await proximoSeqLocal(nomeProjeto(registro), registro.id);
    }
    registro.numero = registro.seq ? CONFIG.numeroFormatado(nomeProjeto(registro), registro.seq) : '';
    registro.atualizadoEm = agora();
    registro.excluido = registro.excluido ? 1 : 0;
    registro.status = 'pendente';
    registro.erroMsg = '';
    registro.tentativas = 0;
    await db.relatorios.put(registro);
    if (registro.naoConformidade !== 'Sim') {
      // NC desmarcada: as fotos da NC deixam de existir no relatório.
      await db.fotos.where('relatorioId').equals(registro.id).filter(f => !!f.vinculo).delete();
    }
    await auditar(registro.id, ehNovo ? 'criacao' : 'edicao',
      ehNovo ? 'Relatório criado no aparelho.' : 'Relatório editado (versão ' + registro.versao + ').',
      registro.responsavel);
    return registro;
  }

  /** O usuário logado pode ver este registro neste aparelho? */
  function podeVer(r, u) {
    u = u || usuarioAtual();
    if (!u || !r.usuarioId || r.usuarioId === u) return true;
    return !!(window.AUTH && AUTH.veTodas && AUTH.veTodas() && r.origem === 'servidor');
  }
  function ehMeu(r) {
    const u = usuarioAtual();
    return !!r && (!r.usuarioId || r.usuarioId === u);
  }

  async function obterRelatorio(id) {
    const r = await db.relatorios.get(id);
    if (!r || !podeVer(r)) return null;
    return r;
  }

  /** Relatório vindo da base central. Nunca passa por cima de edição local pendente. */
  async function salvarRecebido(l) {
    const local = await db.relatorios.get(l.id_local);
    if (local && (local.status === 'pendente' || local.status === 'erro')) return false;
    if (local && local.atualizadoEm && l.atualizado_em &&
        new Date(local.atualizadoEm).getTime() >= new Date(l.atualizado_em).getTime() &&
        local.origem !== 'servidor') {
      // É o nosso próprio envio voltando: registra fotos e o número da base.
      local.fotosRemotas = l.fotos || local.fotosRemotas || [];
      if (l.seq) { local.seq = l.seq; local.numero = l.numero || CONFIG.numeroFormatado(nomeProjeto(local), l.seq); }
      await db.relatorios.put(local);
      return false;
    }
    const reg = Object.assign({}, local || {}, {
      id: l.id_local,
      usuarioId: l.usuario_id,
      origem: (local && local.usuarioId === usuarioAtual() && local.origem !== 'servidor') ? 'aparelho' : 'servidor',
      numero: l.seq ? (l.numero || '') : '',
      seq: l.seq || null,
      projeto: l.projeto || '', projetoOutro: '',
      lote: l.lote,
      dataRelatorio: l.data_relatorio,
      tipo: l.tipo,
      nf: l.nf || '',
      fornecedor: l.fornecedor || '',
      canteiro: l.canteiro || '', canteiroOutro: '',
      transportadora: l.transportadora || '',
      trecho: l.trecho || '',
      torre: l.torre || '',
      descricao: l.descricao || '',
      naoConformidade: l.nao_conformidade ? 'Sim' : 'Não',
      descricaoNC: l.descricao_nc || '',
      observacoes: l.observacoes || '',
      latitude: l.latitude, longitude: l.longitude, precisaoGps: l.precisao_gps,
      obsGeo: (l.latitude === null || l.latitude === undefined) ? 'Não capturada' : null,
      responsavel: l.responsavel || '',
      funcaoResponsavel: l.funcao_responsavel || '',
      dispositivo: l.dispositivo || '',
      criadoEm: l.criado_em, atualizadoEm: l.atualizado_em,
      versao: l.versao || 1,
      status: 'sincronizado', erroMsg: '', tentativas: 0,
      sincronizadoEm: agora(),
      fotosRemotas: l.fotos || [],
      qtdFotosRemotas: l.qtd_fotos || (l.fotos || []).length,
      excluido: l.excluido ? 1 : 0,
      excluidoEm: l.excluido_em || null,
      motivoExclusao: l.motivo_exclusao || ''
    });
    await db.relatorios.put(reg);
    return true;
  }

  /** Foto baixada da base para um relatório recebido (ou para recuperar uma perdida). */
  async function salvarFotoRecebida(relatorioId, meta, blob) {
    const dados = await lerBytes(blob);
    if (!imagemValida(dados)) throw new Error('Arquivo recebido não é uma imagem válida.');
    let largura = 0, altura = 0;
    try {
      const bmp = await createImageBitmap(new Blob([dados], { type: tipoDosBytes(dados) }));
      largura = bmp.width; altura = bmp.height;
      if (bmp.close) bmp.close();
    } catch (e) { /* dimensões são opcionais */ }
    const existentes = await db.fotos.where('relatorioId').equals(relatorioId).toArray();
    const local = existentes.find(f => f.caminhoRemoto && f.caminhoRemoto === meta.caminho);
    const comum = {
      dados: dados, tipo: tipoDosBytes(dados), blob: undefined, corrompida: undefined,
      largura: largura || (local && local.largura) || 0, altura: altura || (local && local.altura) || 0,
      bytes: dados.byteLength, enviada: 1, caminhoRemoto: meta.caminho
    };
    if (local) { await db.fotos.update(local.id, comum); return; }
    // Foto recebida substitui a que estiver no mesmo espaço (slot)
    if (meta.slot) {
      const doSlot = existentes.filter(f => !f.vinculo && f.slot === meta.slot);
      for (const f of doSlot) await db.fotos.delete(f.id);
    }
    await db.fotos.put(Object.assign({
      id: 'r-' + relatorioId.slice(0, 8) + '-' + (meta.ordem || 0),
      relatorioId: relatorioId,
      legenda: meta.legenda || '',
      nome: String(meta.caminho || '').split('/').pop(),
      ordem: meta.ordem || 0,
      slot: meta.slot || null,
      criadoEm: agora(),
      vinculo: meta.vinculo || null
    }, comum));
  }

  async function marcarFotoRemota(fotoId, caminho) {
    await db.fotos.update(fotoId, { caminhoRemoto: caminho, enviada: 1 });
  }

  /** Exclusão LÓGICA, com motivo e trilha de auditoria. */
  async function excluirRelatorio(id, motivo, usuario) {
    const reg = await obterRelatorio(id);
    if (!reg) return false;
    await db.versoes.add({ relatorioId: id, usuarioId: reg.usuarioId, salvoEm: agora(),
      versao: reg.versao || 1, conteudo: JSON.parse(JSON.stringify(reg)) });
    reg.excluido = 1;
    reg.excluidoEm = agora();
    reg.atualizadoEm = agora();
    reg.motivoExclusao = motivo || '';
    reg.status = 'pendente';
    await db.relatorios.put(reg);
    await auditar(id, 'exclusao', 'Exclusão lógica. Motivo: ' + (motivo || 'não informado'), usuario);
    return true;
  }

  async function restaurarRelatorio(id, usuario) {
    const reg = await obterRelatorio(id);
    if (!reg) return false;
    reg.excluido = 0; reg.excluidoEm = null; reg.motivoExclusao = '';
    reg.atualizadoEm = agora();
    reg.status = 'pendente';
    await db.relatorios.put(reg);
    await auditar(id, 'restauracao', 'Relatório restaurado.', usuario);
    return true;
  }

  function nomeProjeto(r) { return r.projeto === 'Outro' ? (r.projetoOutro || 'Outro') : (r.projeto || ''); }
  function nomeCanteiro(r) { return r.canteiro === 'Outro' ? (r.canteiroOutro || 'Outro') : (r.canteiro || ''); }
  /** Local resumido: canteiro (recebimento) ou trecho/torre (saída). */
  function localResumo(r) {
    if (r.tipo === 'Saída') {
      return [r.trecho ? 'Trecho ' + r.trecho : '', r.torre ? 'Torre ' + r.torre : ''].filter(Boolean).join(' • ');
    }
    return nomeCanteiro(r);
  }

  /**
   * Relatórios que o usuário logado pode ver, com filtros:
   * { de, ate, lote, tipo, naoConformidade, status, texto, incluirExcluidos }
   */
  async function listarRelatorios(filtros) {
    filtros = filtros || {};
    const u = usuarioAtual();
    let lista = (await db.relatorios.toArray()).filter(r => podeVer(r, u));
    const permitidos = (window.AUTH && AUTH.lotes) ? AUTH.lotes() : null;
    if (permitidos && permitidos.length) lista = lista.filter(r => !r.lote || permitidos.indexOf(r.lote) !== -1);
    if (!filtros.incluirExcluidos) lista = lista.filter(r => !r.excluido);
    if (filtros.de) lista = lista.filter(r => r.dataRelatorio >= filtros.de);
    if (filtros.ate) lista = lista.filter(r => r.dataRelatorio <= filtros.ate);
    if (filtros.lote) lista = lista.filter(r => r.lote === filtros.lote);
    if (filtros.tipo) lista = lista.filter(r => r.tipo === filtros.tipo);
    if (filtros.projeto) lista = lista.filter(r => nomeProjeto(r) === filtros.projeto);
    if (filtros.naoConformidade) lista = lista.filter(r => r.naoConformidade === filtros.naoConformidade);
    if (filtros.status) lista = lista.filter(r => r.status === filtros.status);
    if (filtros.texto) {
      const t = String(filtros.texto).toLowerCase().trim();
      lista = lista.filter(r => [
        r.numero, nomeProjeto(r), r.lote, r.tipo, r.nf, r.fornecedor, nomeCanteiro(r), r.transportadora,
        r.trecho, r.torre, r.descricao, r.descricaoNC, r.observacoes, r.responsavel, r.dataRelatorio
      ].join(' ').toLowerCase().indexOf(t) !== -1);
    }
    lista.sort((a, b) => (b.dataRelatorio + b.criadoEm).localeCompare(a.dataRelatorio + a.criadoEm));
    return lista;
  }

  /** Valores já digitados num campo (fornecedor, transportadora…) + sugestões do config. */
  async function sugestoes(campo, extras) {
    const lista = await db.relatorios.toArray();
    const s = new Set((extras || []).filter(Boolean));
    lista.forEach(r => { if (r[campo]) s.add(String(r[campo]).trim()); });
    return Array.from(s).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }

  // ---------------------------------------------------------------
  // Fotos
  // ---------------------------------------------------------------
  /**
   * @param {object} opcoes { slot: 1..6 } para foto do relatório (substitui
   *        a que estiver no espaço) ou { vinculo: {tipo:'nc'} } para foto da NC.
   */
  async function adicionarFoto(relatorioId, arquivo, opcoes) {
    opcoes = opcoes || {};
    const existentes = await db.fotos.where('relatorioId').equals(relatorioId).toArray();
    const ehNC = !!opcoes.vinculo;
    let ordem, slot = null, legenda = opcoes.legenda || '', substituir = null;
    if (ehNC) {
      const nc = existentes.filter(f => f.vinculo);
      if (nc.length >= CONFIG.limites.fotosNC) {
        throw new Error('Limite de ' + CONFIG.limites.fotosNC + ' fotos da não conformidade atingido.');
      }
      ordem = 100 + nc.reduce((m, f) => Math.max(m, (f.ordem || 100) - 100), 0) + 1;
    } else {
      slot = Number(opcoes.slot);
      if (!(slot >= 1 && slot <= CONFIG.limites.fotosRelatorio)) {
        const livres = [];
        for (let i = 1; i <= CONFIG.limites.fotosRelatorio; i++) {
          if (!existentes.some(f => !f.vinculo && f.slot === i)) livres.push(i);
        }
        if (!livres.length) throw new Error('Os ' + CONFIG.limites.fotosRelatorio + ' espaços de foto já estão preenchidos.');
        slot = livres[0];
      }
      substituir = existentes.find(f => !f.vinculo && f.slot === slot) || null;
      if (substituir && !opcoes.legenda) legenda = substituir.legenda || '';
      ordem = slot;
    }
    const comp = await comprimirImagem(arquivo);
    const dados = await lerBytes(comp.blob);
    if (!imagemValida(dados)) throw new Error('A foto não pôde ser processada. Tire novamente.');
    const foto = {
      id: uuid(),
      relatorioId: relatorioId,
      dados: dados,
      tipo: 'image/jpeg',
      legenda: legenda,
      nome: (ehNC ? 'nc_' + (ordem - 100) : 'foto_' + slot) + '.jpg',
      largura: comp.largura,
      altura: comp.altura,
      bytes: dados.byteLength,
      ordem: ordem,
      slot: slot,
      criadoEm: agora(),
      enviada: 0,
      vinculo: ehNC ? { tipo: 'nc' } : null
    };
    await db.fotos.add(foto);
    // Releitura imediata: garante que o aparelho gravou a foto inteira.
    const conf = await db.fotos.get(foto.id);
    if (!conf || !conf.dados || conf.dados.byteLength !== dados.byteLength) {
      await db.fotos.delete(foto.id).catch(() => {});
      throw new Error('O aparelho não conseguiu salvar a foto (armazenamento cheio?). Tente novamente.');
    }
    if (substituir) await db.fotos.delete(substituir.id);
    return prepararFoto(foto);
  }

  async function listarFotos(relatorioId) {
    const fotos = await db.fotos.where('relatorioId').equals(relatorioId).toArray();
    for (const f of fotos) await migrarFoto(f);
    fotos.forEach(prepararFoto);
    fotos.sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    return fotos;
  }

  async function removerFoto(fotoId) { await db.fotos.delete(fotoId); }
  async function atualizarLegenda(fotoId, legenda) { await db.fotos.update(fotoId, { legenda: legenda }); }
  async function removerFotosDoRelatorio(id) { await db.fotos.where('relatorioId').equals(id).delete(); }
  async function contarFotos(id) {
    const fotos = await db.fotos.where('relatorioId').equals(id).toArray();
    if (fotos.length) {
      return { gerais: fotos.filter(f => !f.vinculo).length, nc: fotos.filter(f => f.vinculo).length, total: fotos.length };
    }
    const r = await db.relatorios.get(id);           // recebido da base: fotos ainda não baixadas
    const rem = (r && r.fotosRemotas) || [];
    return { gerais: rem.filter(m => !m.vinculo).length, nc: rem.filter(m => m.vinculo).length, total: rem.length };
  }

  // ---------------------------------------------------------------
  // Fila de envio (por usuário)
  // ---------------------------------------------------------------
  async function listarPendentes() {
    const u = usuarioAtual();
    return (await db.relatorios.toArray())
      .filter(r => r.usuarioId === u && (r.status === 'pendente' || r.status === 'erro'))
      .sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
  }

  async function marcarStatus(id, status, mensagem, atualizadoEmEnviado) {
    const reg = await db.relatorios.get(id);
    if (!reg) return;
    // Editado enquanto subia: continua pendente para subir a versão nova.
    if (status === 'sincronizado' && atualizadoEmEnviado && reg.atualizadoEm !== atualizadoEmEnviado) return;
    reg.status = status;
    reg.erroMsg = mensagem || '';
    if (status === 'sincronizado') {
      reg.sincronizadoEm = agora();
      reg.tentativas = 0;
      await db.fotos.where('relatorioId').equals(id).modify({ enviada: 1 });
    } else if (status === 'erro') {
      reg.tentativas = (reg.tentativas || 0) + 1;
    }
    await db.relatorios.put(reg);
  }

  async function registrarLogSync(entrada) {
    entrada.em = agora();
    entrada.usuarioId = usuarioAtual();
    await db.syncLog.add(entrada);
    const total = await db.syncLog.count();
    if (total > 100) {
      const antigas = await db.syncLog.orderBy('seq').limit(total - 100).toArray();
      await db.syncLog.bulkDelete(antigas.map(e => e.seq));
    }
  }

  async function listarAuditoria(relatorioId) {
    const l = await db.auditoria.where('relatorioId').equals(relatorioId).toArray();
    l.sort((a, b) => b.em.localeCompare(a.em));
    return l;
  }

  // ---------------------------------------------------------------
  // Armazenamento
  // ---------------------------------------------------------------
  async function estimativaArmazenamento() {
    if (navigator.storage && navigator.storage.estimate) {
      try {
        const e = await navigator.storage.estimate();
        const usado = e.usage || 0, cota = e.quota || 0;
        return { usado: usado, cota: cota, percentual: cota ? (usado / cota) * 100 : 0, suportado: true };
      } catch (err) { /* cálculo aproximado */ }
    }
    const fotos = await db.fotos.toArray();
    return { usado: fotos.reduce((s, f) => s + (f.bytes || 0), 0), cota: 0, percentual: 0, suportado: false };
  }

  async function solicitarPersistencia() {
    if (navigator.storage && navigator.storage.persist) {
      try { if (await navigator.storage.persisted()) return true; return await navigator.storage.persist(); }
      catch (e) { return false; }
    }
    return false;
  }

  // ---------------------------------------------------------------
  // Exportação
  // ---------------------------------------------------------------
  async function exportarJSON() {
    const u = usuarioAtual();
    const lista = (await db.relatorios.toArray()).filter(r => r.usuarioId === u);
    const p = (window.AUTH && AUTH.perfil) ? AUTH.perfil() : null;
    const saida = {
      aplicacao: CONFIG.app.nome, versao: CONFIG.app.versao, exportadoEm: agora(),
      exportadoPor: p ? { nome: p.nome, email: p.email, lotes: p.lotes } : null,
      totalRelatorios: lista.length, relatorios: []
    };
    for (const reg of lista) {
      const item = JSON.parse(JSON.stringify(reg));
      item.fotos = [];
      for (const f of await listarFotos(reg.id)) {
        const meta = { id: f.id, nome: f.nome, legenda: f.legenda, slot: f.slot, vinculo: f.vinculo,
                       bytes: f.bytes, largura: f.largura, altura: f.altura };
        if (f.blob) meta.base64 = await blobParaBase64(f.blob);
        item.fotos.push(meta);
      }
      saida.relatorios.push(item);
    }
    return JSON.stringify(saida, null, 2);
  }

  /** Planilha em CSV (";" e BOM UTF-8): o Excel em português abre certo. */
  async function exportarCSV(filtros) {
    const lista = await listarRelatorios(Object.assign({}, filtros || {}, { incluirExcluidos: false }));
    const nFotos = CONFIG.limites.fotosRelatorio;
    const cab = ['Numero', 'Tipo', 'Data', 'Projeto', 'Lote', 'NF', 'Fornecedor', 'Canteiro',
                 'Transportadora', 'Trecho', 'Torre', 'Descricao do material', 'Nao conformidade',
                 'Descricao da NC', 'Observacoes'];
    for (let i = 1; i <= nFotos; i++) cab.push('Obs foto ' + i);
    cab.push('Qtd fotos', 'Qtd fotos NC', 'Latitude', 'Longitude', 'Responsavel', 'Funcao',
             'Criado em', 'Ultima edicao', 'ID');
    const linhas = [cab.map(csvCampo).join(';')];
    for (const r of lista) {
      const fotos = await db.fotos.where('relatorioId').equals(r.id).toArray();
      const gerais = fotos.length ? fotos.filter(f => !f.vinculo) : (r.fotosRemotas || []).filter(m => !m.vinculo);
      const nc = fotos.length ? fotos.filter(f => f.vinculo) : (r.fotosRemotas || []).filter(m => m.vinculo);
      const cols = [numeroRelatorio(r) || 'pendente', r.tipo, r.dataRelatorio, nomeProjeto(r), r.lote, r.nf, r.fornecedor,
        r.tipo === 'Recebimento' ? nomeCanteiro(r) : '', r.transportadora, r.trecho, r.torre, r.descricao,
        r.naoConformidade, r.descricaoNC, r.observacoes];
      for (let i = 1; i <= nFotos; i++) {
        const f = gerais.find(x => x.slot === i);
        cols.push(f ? (f.legenda || '') : '');
      }
      cols.push(gerais.length, nc.length,
        r.latitude === null || r.latitude === undefined ? '' : String(r.latitude).replace('.', ','),
        r.longitude === null || r.longitude === undefined ? '' : String(r.longitude).replace('.', ','),
        r.responsavel, r.funcaoResponsavel || '', r.criadoEm, r.atualizadoEm, r.id);
      linhas.push(cols.map(csvCampo).join(';'));
    }
    return '﻿' + linhas.join('\r\n');
  }

  function csvCampo(v) {
    if (v === null || v === undefined) return '';
    const s = String(v).replace(/\r?\n/g, ' ').replace(/"/g, '""');
    return /[;"]/.test(s) ? '"' + s + '"' : s;
  }

  async function limparTudo() {
    await db.transaction('rw', db.relatorios, db.fotos, db.versoes, db.auditoria, db.syncLog, async () => {
      await db.relatorios.clear(); await db.fotos.clear(); await db.versoes.clear();
      await db.auditoria.clear(); await db.syncLog.clear();
    });
  }

  return {
    db: db,
    uuid: uuid, agora: agora, hojeISO: hojeISO, dispositivo: dispositivo, usuarioAtual: usuarioAtual,
    kvGet: kvGet, kvSet: kvSet,
    contarUsuariosLocais: contarUsuariosLocais, listarUsuariosLocais: listarUsuariosLocais,
    obterUsuarioLocalPorEmail: obterUsuarioLocalPorEmail, criarUsuarioLocal: criarUsuarioLocal,
    atualizarUsuarioLocal: atualizarUsuarioLocal, migrarRegistrosLocais: migrarRegistrosLocais,
    numeroRelatorio: numeroRelatorio, numeroExibicao: numeroExibicao, seqExibicao: seqExibicao,
    definirNumero: definirNumero, novoRelatorio: novoRelatorio, salvarRelatorio: salvarRelatorio,
    salvarRecebido: salvarRecebido, salvarFotoRecebida: salvarFotoRecebida, marcarFotoRemota: marcarFotoRemota,
    podeVer: podeVer, ehMeu: ehMeu, obterRelatorio: obterRelatorio, listarRelatorios: listarRelatorios,
    excluirRelatorio: excluirRelatorio, restaurarRelatorio: restaurarRelatorio,
    nomeProjeto: nomeProjeto, nomeCanteiro: nomeCanteiro, localResumo: localResumo, sugestoes: sugestoes,
    adicionarFoto: adicionarFoto, listarFotos: listarFotos, removerFoto: removerFoto,
    atualizarLegenda: atualizarLegenda, removerFotosDoRelatorio: removerFotosDoRelatorio, contarFotos: contarFotos,
    imagemValida: imagemValida, lerBytes: lerBytes, prepararFoto: prepararFoto,
    comprimirImagem: comprimirImagem, blobParaBase64: blobParaBase64, blobParaDataUrl: blobParaDataUrl,
    listarPendentes: listarPendentes, marcarStatus: marcarStatus, registrarLogSync: registrarLogSync,
    listarAuditoria: listarAuditoria, auditar: auditar,
    estimativaArmazenamento: estimativaArmazenamento, solicitarPersistencia: solicitarPersistencia,
    exportarJSON: exportarJSON, exportarCSV: exportarCSV, limparTudo: limparTudo
  };
})();

window.DB = DB;
