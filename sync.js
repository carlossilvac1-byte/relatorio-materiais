/* =====================================================================
 * sync.js — SINCRONIZAÇÃO COM A BASE CENTRAL (Supabase)
 * ---------------------------------------------------------------------
 * IDA   — cada relatório salvo no aparelho entra numa fila e sobe para a
 *         base central assim que houver internet (fotos no Storage).
 * VOLTA — a cada 30 s (e ao abrir o app) o aparelho busca na base os
 *         relatórios que o usuário tem direito de ver. Quem decide é o
 *         SERVIDOR (regras do banco):
 *           • administrador ............ todos
 *           • visão "todas" ............. todos dos seus lotes
 *           • visão "próprias" .......... só os que ele mesmo fez
 *         As fotos dos relatórios recebidos são baixadas sob demanda
 *         (ao abrir o detalhe ou gerar o PDF).
 *
 * Sem internet nada se perde: a fila espera e o app segue funcionando.
 * Sem Supabase configurado em config.js este módulo fica inativo e o
 * app trabalha no modo local.
 * ===================================================================== */

const SYNC = (function () {

  let emExecucao = false;
  let semTabela = false;            // base sem banco/01-estrutura.sql rodado
  let timer = null;
  const ouvintes = [];
  const TOPICO = 'realtime:rf-materiais';

  const S = () => CONFIG.supabase || {};
  function base() { return String(S().url || '').replace(/\/+$/, ''); }
  function ativo() { return !!(window.AUTH && AUTH.configurado() && !AUTH.modoLocal()); }

  async function fetchTimeout(url, opcoes, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 20000);
    try {
      return await fetch(url, Object.assign({}, opcoes || {}, { signal: ctrl.signal }));
    } finally {
      clearTimeout(t);
    }
  }

  /** Há conexão de verdade com a base? (navigator.onLine engana em campo) */
  async function online() {
    if (!navigator.onLine || !ativo()) return false;
    try {
      const r = await fetchTimeout(base() + '/auth/v1/health', {
        headers: { apikey: S().anonKey }, cache: 'no-store'
      }, 6000);
      return !!r && r.status < 500;
    } catch (e) {
      return false;
    }
  }

  function aoMudar(fn) { ouvintes.push(fn); }
  function notificar(evento, dados) {
    ouvintes.forEach(fn => { try { fn(evento, dados); } catch (e) { /* tela não derruba o envio */ } });
  }

  /* ===================================================================
   * IDA — envio da fila
   * =================================================================== */
  async function enviarFotos(reg, fotos) {
    const meta = [];
    let semFoto = 0;
    for (const f of fotos) {
      const nome = String(f.ordem).padStart(3, '0') + '_' + String(f.id).slice(0, 8) + '.jpg';
      const caminho = reg.lote + '/' + reg.id + '/' + nome;
      const m = { legenda: f.legenda || '', ordem: f.ordem, slot: f.slot || null, bytes: f.bytes || 0, vinculo: f.vinculo || null };
      // Foto que já está na base: só repete os metadados.
      if (f.caminhoRemoto) { meta.push(Object.assign({ caminho: f.caminhoRemoto }, m)); continue; }
      // Foto perdida no aparelho e nunca enviada: não há o que mandar (não trava o envio).
      if (f.indisponivel || !f.dados || !DB.imagemValida(f.dados)) { semFoto++; continue; }
      const url = base() + '/storage/v1/object/' + S().bucketFotos + '/' +
                  caminho.split('/').map(encodeURIComponent).join('/');
      const cab = await AUTH.cabecalhosAutenticados({ 'x-upsert': 'true' });
      cab['Content-Type'] = f.tipo || 'image/jpeg';
      // BYTES, não Blob: no iPhone um Blob vindo do banco pode estar ilegível.
      const r = await fetchTimeout(url, { method: 'POST', headers: cab, body: new Uint8Array(f.dados) }, 90000);
      if (!r.ok) {
        const t = await r.text().catch(() => '');
        if (r.status === 401) throw new Error('SESSAO_EXPIRADA');
        if (/bucket not found/i.test(t)) throw new Error('SEM_TABELA');
        if (r.status === 403 || /row-level security|policy|unauthorized/i.test(t)) {
          throw new Error('Foto recusada pela base: sem permissão no lote ' + reg.lote + '.');
        }
        throw new Error('Falha ao enviar foto (HTTP ' + r.status + ').');
      }
      meta.push(Object.assign({ caminho: caminho }, m));
    }
    if (semFoto) notificar('fotosIndisponiveis', { relatorioId: reg.id, qtd: semFoto });
    return meta;
  }

  /** Linha no formato da tabela "relatorios". */
  function linhaDoRelatorio(reg, fotosMeta) {
    return {
      id_local: reg.id,
      usuario_id: AUTH.usuarioId(),            // o banco reconfirma: autor = quem está logado
      numero: DB.numeroRelatorio(reg) || null,   // a base central redefine (sequência por projeto)
      responsavel: reg.responsavel,
      funcao_responsavel: reg.funcaoResponsavel || null,
      projeto: DB.nomeProjeto(reg),
      lote: reg.lote,
      data_relatorio: reg.dataRelatorio,
      tipo: reg.tipo,
      nf: reg.nf || null,
      fornecedor: reg.fornecedor || null,
      canteiro: reg.tipo === 'Recebimento' ? (DB.nomeCanteiro(reg) || null) : null,
      transportadora: reg.tipo === 'Saída' ? (reg.transportadora || null) : null,
      trecho: reg.tipo === 'Saída' ? (reg.trecho || null) : null,
      torre: reg.tipo === 'Saída' ? (reg.torre || null) : null,
      descricao: reg.descricao || '',
      nao_conformidade: reg.naoConformidade === 'Sim',
      descricao_nc: reg.naoConformidade === 'Sim' ? (reg.descricaoNC || null) : null,
      observacoes: reg.observacoes || null,
      latitude: reg.latitude,
      longitude: reg.longitude,
      precisao_gps: reg.precisaoGps,
      dispositivo: reg.dispositivo,
      fotos: fotosMeta,
      versao: reg.versao || 1,
      criado_em: reg.criadoEm,
      atualizado_em: reg.atualizadoEm,
      excluido: !!reg.excluido,
      motivo_exclusao: reg.motivoExclusao || null,
      excluido_em: reg.excluidoEm || null
    };
  }

  async function enviar(reg) {
    const fotos = reg.excluido ? [] : await DB.listarFotos(reg.id);
    const fotosMeta = fotos.length ? await enviarFotos(reg, fotos) : (reg.fotosRemotas || []);
    const cab = await AUTH.cabecalhosAutenticados({ Prefer: 'resolution=merge-duplicates,return=representation' });
    const r = await fetchTimeout(base() + '/rest/v1/' + S().tabelaRelatorios + '?on_conflict=id_local', {
      method: 'POST', headers: cab, body: JSON.stringify(linhaDoRelatorio(reg, fotosMeta))
    }, 30000);
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      if (r.status === 401) throw new Error('SESSAO_EXPIRADA');
      if (r.status === 404 || /PGRST205|relation .* does not exist/i.test(t)) {
        throw new Error('SEM_TABELA');
      }
      if (r.status === 403 || /row-level security|violates row/i.test(t)) {
        throw new Error('Gravação recusada pela base: seu usuário não tem permissão no lote ' + reg.lote + '.');
      }
      throw new Error('Base respondeu ' + r.status + ': ' + t.slice(0, 160));
    }
    // Número sequencial do projeto, definido pela base (RF-<SIGLA>-001…)
    try {
      const volta = await r.json();
      const l = Array.isArray(volta) ? volta[0] : volta;
      if (l && l.seq) await DB.definirNumero(reg.id, l.seq, l.numero);
    } catch (e) { /* base ainda sem a numeração: segue sem número */ }
    // Guarda o caminho remoto nas fotos locais (evita reenviar)
    for (const m of fotosMeta) {
      const f = fotos.find(x => x.ordem === m.ordem);
      if (f && !f.caminhoRemoto) await DB.marcarFotoRemota(f.id, m.caminho);
    }
  }

  async function enviarFila(manual) {
    let fila = await DB.listarPendentes();
    if (!manual) fila = fila.filter(r => (r.tentativas || 0) < CONFIG.sync.maxTentativas);
    const resumo = { enviados: 0, falhas: 0 };
    for (const reg of fila) {
      try {
        await enviar(reg);
        await DB.marcarStatus(reg.id, 'sincronizado', '', reg.atualizadoEm);
        resumo.enviados++;
      } catch (e) {
        const msg = (e && e.message) || String(e);
        // Base sem a tabela (script ainda não rodado): fica na fila, sem
        // contar tentativa, e sobe sozinho quando a tabela existir.
        if (msg === 'SEM_TABELA') { resumo.semTabela = true; break; }
        await DB.marcarStatus(reg.id, 'erro', msg === 'SESSAO_EXPIRADA' ? 'Sessão expirada — entre novamente.' : msg);
        resumo.falhas++;
        if (msg === 'SESSAO_EXPIRADA') break;
      }
    }
    return resumo;
  }

  /* ===================================================================
   * VOLTA — recebimento do que o usuário pode ver
   * =================================================================== */
  function chaveCursor() { return 'cursorRecebimento:' + AUTH.usuarioId(); }

  async function receber() {
    let cursor = await DB.kvGet(chaveCursor(), '1970-01-01T00:00:00Z');
    let total = 0;
    for (let pagina = 0; pagina < 20; pagina++) {
      const url = base() + '/rest/v1/' + S().tabelaRelatorios +
        '?select=*&recebido_em=gt.' + encodeURIComponent(cursor) +
        '&order=recebido_em.asc&limit=200';
      const cab = await AUTH.cabecalhosAutenticados();
      const r = await fetchTimeout(url, { headers: cab }, 30000);
      if (!r.ok) {
        if (r.status === 401) throw new Error('SESSAO_EXPIRADA');
        if (r.status === 404) { semTabela = true; return total; }   // tabela ainda não criada
        throw new Error('Falha ao receber relatórios (HTTP ' + r.status + ').');
      }
      const linhas = await r.json();
      for (const l of linhas) {
        if (await DB.salvarRecebido(l)) total++;
        cursor = l.recebido_em;
      }
      await DB.kvSet(chaveCursor(), cursor);
      if (linhas.length < 200) break;
    }
    return total;
  }

  /** Baixa as fotos de um relatório recebido (ou recupera as perdidas no aparelho). */
  async function baixarFotos(reg) {
    if (!ativo() || !reg || !Array.isArray(reg.fotosRemotas) || !reg.fotosRemotas.length) return 0;
    const locais = await DB.listarFotos(reg.id);
    const faltam = reg.fotosRemotas.filter(m => !locais.some(f => f.caminhoRemoto === m.caminho && !f.indisponivel));
    if (!faltam.length || !navigator.onLine) return 0;
    let n = 0;
    for (const m of faltam) {
      try {
        const url = base() + '/storage/v1/object/authenticated/' + S().bucketFotos + '/' +
                    String(m.caminho).split('/').map(encodeURIComponent).join('/');
        const cab = await AUTH.cabecalhosAutenticados();
        delete cab['Content-Type'];
        const r = await fetchTimeout(url, { headers: cab }, 60000);
        if (!r.ok) continue;
        await DB.salvarFotoRecebida(reg.id, m, await r.blob());   // valida a imagem antes de gravar
        n++;
      } catch (e) { /* segue com as demais */ }
    }
    return n;
  }

  /* ===================================================================
   * CICLO COMPLETO
   * =================================================================== */
  async function sincronizar(manual) {
    if (emExecucao || !ativo() || !AUTH.autenticado()) return { pulado: true };
    if (!AUTH.podeEnviar() && navigator.onLine) await AUTH.revalidar();
    if (!AUTH.podeEnviar()) return { pulado: true, sessaoExpirada: true };
    if (!(await online())) { notificar('rede', { online: false }); agendarSegundoPlano(); return { pulado: true, offline: true }; }

    emExecucao = true;
    notificar('inicio');
    const resumo = { enviados: 0, falhas: 0, recebidas: 0 };
    try {
      const st = await AUTH.revalidar();
      if (st === 'BLOQUEADO') { resumo.bloqueado = true; return resumo; }
      semTabela = false;
      Object.assign(resumo, await enviarFila(manual));
      resumo.recebidas = await receber();
      if (semTabela) resumo.semTabela = true;
      await DB.kvSet('ultimaSincronizacao:' + AUTH.usuarioId(), new Date().toISOString());
      try { AUTH.informarSituacao((await DB.listarPendentes()).length); } catch (e) { /* informativo */ }
    } catch (e) {
      resumo.erro = (e && e.message) || String(e);
    } finally {
      emExecucao = false;
      notificar('fim', resumo);
      if (resumo.falhas || resumo.erro) agendarSegundoPlano();
    }
    return resumo;
  }

  /* ===================================================================
   * ENVIO EM SEGUNDO PLANO (Background Sync — Android / Chrome)
   * =================================================================== */
  function agendarSegundoPlano() {
    try {
      if (!ativo() || typeof window === 'undefined' || !window.document) return;
      if (!('serviceWorker' in navigator) || !('SyncManager' in window)) return;
      navigator.serviceWorker.ready
        .then(reg => reg.sync && reg.sync.register('enviar-relatorios'))
        .catch(() => { /* o envio segue pelo app aberto */ });
    } catch (e) { /* recurso indisponível */ }
  }

  /* ===================================================================
   * TEMPO REAL (Supabase Realtime — websocket Phoenix)
   * -------------------------------------------------------------------
   * Para quem vê relatórios de outras pessoas (administrador e visão
   * "todas"): a base avisa no instante em que um relatório é gravado.
   * Heartbeat a cada 25 s e renovação do token no canal.
   * =================================================================== */
  const rt = { ws: null, ref: 0, batimento: null, espera: 5000, timerReconexao: null, timerBusca: null, conectado: false, tokenEnviado: null };

  function rtEnviar(msg) { if (rt.ws && rt.ws.readyState === 1) rt.ws.send(JSON.stringify(msg)); }
  function rtFechar() {
    clearInterval(rt.batimento); clearTimeout(rt.timerReconexao);
    if (rt.ws) { try { rt.ws.onclose = null; rt.ws.close(); } catch (e) {} }
    rt.ws = null; rt.conectado = false;
  }
  function rtAgendarReconexao() {
    clearTimeout(rt.timerReconexao);
    rt.timerReconexao = setTimeout(tempoReal, rt.espera);
    rt.espera = Math.min(rt.espera * 2, 60000);
  }
  async function tempoReal() {
    try {
      if (typeof WebSocket === 'undefined' || !ativo() || !AUTH.autenticado() || !AUTH.veTodas()) { rtFechar(); return; }
      if (rt.ws && (rt.ws.readyState === 0 || rt.ws.readyState === 1)) return;
      if (!navigator.onLine) { rtAgendarReconexao(); return; }
      const token = await AUTH.obterTokenAcesso();
      if (!token) { rtAgendarReconexao(); return; }
      const url = base().replace(/^http/, 'ws') + '/realtime/v1/websocket?apikey=' +
                  encodeURIComponent(S().anonKey) + '&vsn=1.0.0';
      const ws = new WebSocket(url);
      rt.ws = ws;
      ws.onopen = () => {
        rt.ref = 0;
        const ref = String(++rt.ref);
        rt.tokenEnviado = token;
        rtEnviar({
          topic: TOPICO, event: 'phx_join', ref: ref, join_ref: ref,
          payload: {
            config: {
              broadcast: { ack: false, self: false }, presence: { key: '' }, private: false,
              postgres_changes: [{ event: '*', schema: 'public', table: S().tabelaRelatorios }]
            },
            access_token: token
          }
        });
        clearInterval(rt.batimento);
        rt.batimento = setInterval(async () => {
          rtEnviar({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(++rt.ref) });
          try {
            const novo = await AUTH.obterTokenAcesso();
            if (novo && novo !== rt.tokenEnviado) {
              rt.tokenEnviado = novo;
              rtEnviar({ topic: TOPICO, event: 'access_token', payload: { access_token: novo }, ref: String(++rt.ref) });
            }
          } catch (e) { /* segue com o atual */ }
        }, 25000);
      };
      ws.onmessage = (ev) => {
        let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (m.event === 'phx_reply' && m.payload && m.payload.status === 'ok' && m.topic === TOPICO) {
          rt.conectado = true; rt.espera = 5000; notificar('tempo-real', { conectado: true });
        }
        if (m.event === 'postgres_changes') {
          clearTimeout(rt.timerBusca);
          rt.timerBusca = setTimeout(() => sincronizar(false), 700);
        }
        if (m.event === 'phx_error' || (m.event === 'system' && m.payload && m.payload.status === 'error')) {
          rtFechar(); rtAgendarReconexao();
        }
      };
      ws.onclose = () => { rt.conectado = false; clearInterval(rt.batimento); notificar('tempo-real', { conectado: false }); rtAgendarReconexao(); };
      ws.onerror = () => { /* onclose cuida da reconexão */ };
    } catch (e) {
      rtAgendarReconexao();
    }
  }

  async function ultimaSincronizacao() {
    if (!AUTH.usuarioId()) return null;
    return DB.kvGet('ultimaSincronizacao:' + AUTH.usuarioId(), null);
  }

  function iniciar() {
    if (!ativo()) return;
    window.addEventListener('online', () => { notificar('rede', { online: true }); sincronizar(false); tempoReal(); });
    window.addEventListener('offline', () => { notificar('rede', { online: false }); agendarSegundoPlano(); });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') { sincronizar(false); tempoReal(); }
      else { sincronizar(false); agendarSegundoPlano(); }
    });
    window.addEventListener('pagehide', () => { sincronizar(false); agendarSegundoPlano(); });
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', (e) => {
        if (e.data && e.data.tipo === 'sincronizar') sincronizar(false);
      });
    }
    setTimeout(tempoReal, 2500);
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
      if (document.visibilityState === 'visible') sincronizar(false);
    }, (CONFIG.sync.intervaloSegundos || 30) * 1000);
    setTimeout(() => sincronizar(false), 1500);
  }

  return {
    iniciar: iniciar,
    sincronizar: sincronizar,
    baixarFotos: baixarFotos,
    online: online,
    ativo: ativo,
    aoMudar: aoMudar,
    ultimaSincronizacao: ultimaSincronizacao,
    agendarSegundoPlano: agendarSegundoPlano,
    tempoReal: tempoReal,
    tempoRealAtivo: () => rt.conectado,
    baseSemTabela: () => semTabela
  };
})();

window.SYNC = SYNC;
