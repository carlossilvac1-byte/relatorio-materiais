/* =====================================================================
 * app.js — INTERFACE E REGRAS DE TELA
 * ---------------------------------------------------------------------
 * Orquestra as camadas: CONFIG (domínios), AUTH (acesso), DB
 * (persistência local), SYNC (envio), MAPA (GPS/mapa) e PDFGEN
 * (relatórios). Este arquivo não fala com a rede nem com o IndexedDB
 * diretamente.
 * ===================================================================== */

const APP = (function () {

  const estado = {
    tela: 'tela-login',
    registro: null,
    ehNovo: true,
    salvo: false,
    detalheId: null,
    listaHistorico: [],
    chip: '',
    slotAlvo: null,
    gps: { watchId: null, ultima: null },
    promptInstalacao: null,
    usuarios: [],
    baseAcessos: [],
    filtroLib: 'pendente',
    syncIniciado: false,
    sincronizando: false,
    ultimoResumo: null,
    pendentesAvisados: null
  };

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.prototype.slice.call(document.querySelectorAll(sel));

  const TELAS_PUBLICAS = ['tela-login', 'tela-cadastro', 'tela-recuperar'];
  const TELAS_VISUAL_ACESSO = TELAS_PUBLICAS.concat(['tela-boasvindas']);
  const N_SLOTS = () => CONFIG.limites.fotosRelatorio;

  /* ===================================================================
   * UTILIDADES DE INTERFACE
   * =================================================================== */
  function aviso(mensagem, tipo, segundos) {
    const div = document.createElement('div');
    div.className = 'aviso ' + (tipo || '');
    div.innerHTML = '<span></span><button type="button" aria-label="Fechar">×</button>';
    div.querySelector('span').textContent = mensagem;
    div.querySelector('button').onclick = () => div.remove();
    $('#avisos').appendChild(div);
    if (segundos !== 0) setTimeout(() => div.remove(), (segundos || 6) * 1000);
  }

  function carregando(ligado, texto) {
    $('#txt-carregando').textContent = texto || 'Processando…';
    $('#carregando').hidden = !ligado;
  }

  function confirmar(titulo, texto, comCampo, rotuloOk) {
    return new Promise((resolve) => {
      $('#modal-titulo').textContent = titulo;
      $('#modal-texto').textContent = texto;
      $('#modal-campo').hidden = !comCampo;
      $('#modal-input').value = '';
      $('#modal-sim').textContent = rotuloOk || 'Confirmar';
      $('#modal').hidden = false;
      const fechar = (ok) => {
        $('#modal').hidden = true;
        $('#modal-sim').onclick = null;
        $('#modal-nao').onclick = null;
        resolve({ ok: ok, valor: $('#modal-input').value.trim() });
      };
      $('#modal-sim').onclick = () => fechar(true);
      $('#modal-nao').onclick = () => fechar(false);
    });
  }

  function mostrarTela(id) {
    if (TELAS_PUBLICAS.indexOf(id) === -1 && !AUTH.autenticado()) id = 'tela-login';
    if (estado.tela === 'tela-nova' && id !== 'tela-nova') pararGPS();
    estado.tela = id;
    $$('.tela').forEach(t => { t.hidden = (t.id !== id); });
    $$('.nav-item').forEach(b => b.classList.toggle('ativa', b.dataset.ir === id ||
      (id === 'tela-detalhe' && b.dataset.ir === 'tela-historico') ||
      (id === 'tela-admin' && b.dataset.ir === 'tela-mais')));
    $('#navegacao').hidden = TELAS_VISUAL_ACESSO.indexOf(id) !== -1;
    document.body.classList.toggle('modo-publico', TELAS_VISUAL_ACESSO.indexOf(id) !== -1);
    window.scrollTo(0, 0);
    if (id === 'tela-historico') carregarHistorico();
    if (id === 'tela-sync') atualizarTelaSync();
    if (id === 'tela-mais') montarTelaMais();
    if (id === 'tela-admin') carregarUsuarios();
    if (TELAS_VISUAL_ACESSO.indexOf(id) !== -1) $('#faixa-fila').hidden = true;
    else atualizarBadges();
  }

  function hojeISO() { return DB.hojeISO(); }

  /* -----------------------------------------------------------------
   * ENTREGA DE ARQUIVOS (PDF, planilha, backup)
   * -----------------------------------------------------------------
   * No celular o sistema bloqueia download que não nasça de um toque, e
   * o PDF leva alguns segundos para ficar pronto: o arquivo é oferecido
   * numa janela "Arquivo pronto" e o toque no botão dispara o
   * compartilhamento (Salvar em Arquivos, WhatsApp, e-mail…) ou o
   * download. No computador o download é direto.
   * ----------------------------------------------------------------- */
  const UA = navigator.userAgent || '';
  const EH_IOS = /iPhone|iPad|iPod/i.test(UA) || (/Macintosh/i.test(UA) && navigator.maxTouchPoints > 1);
  const EH_ANDROID = /Android/i.test(UA);
  const EH_MOVEL = EH_IOS || EH_ANDROID;
  const EH_INSTALADO = window.navigator.standalone === true ||
    (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);

  function downloadDireto(blob, nome) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = nome; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  }
  function podeCompartilhar(arquivo) {
    try { return !!(navigator.canShare && navigator.share && navigator.canShare({ files: [arquivo] })); }
    catch (e) { return false; }
  }
  function tamanhoLegivel(b) {
    return b < 1024 * 1024 ? Math.max(1, Math.round(b / 1024)) + ' KB'
                           : (b / 1024 / 1024).toFixed(1).replace('.', ',') + ' MB';
  }

  function entregarArquivo(blob, nome, tipo) {
    tipo = tipo || blob.type || 'application/octet-stream';
    if (!EH_MOVEL) {
      downloadDireto(blob, nome);
      return Promise.resolve({ modo: 'download', nome: nome });
    }
    carregando(false);
    const arquivo = new File([blob], nome, { type: tipo, lastModified: Date.now() });
    const compartilha = podeCompartilhar(arquivo);
    const ehPdf = /pdf/i.test(tipo);
    const bt = { comp: $('#arq-compartilhar'), baixar: $('#arq-baixar'), abrir: $('#arq-abrir'), fechar: $('#arq-fechar') };
    $('#arq-titulo').textContent = ehPdf ? 'PDF pronto' : 'Arquivo pronto';
    $('#arq-nome').textContent = nome + '  ·  ' + tamanhoLegivel(blob.size);
    bt.comp.hidden = !compartilha;
    bt.baixar.hidden = EH_IOS && EH_INSTALADO && compartilha;
    bt.abrir.hidden = !(ehPdf && !EH_IOS);
    bt.baixar.classList.toggle('btn-primario', bt.comp.hidden);
    bt.baixar.classList.toggle('btn-secundario', !bt.comp.hidden);
    $('#arq-dica').textContent = compartilha
      ? (EH_IOS ? 'Toque em "Salvar / Compartilhar" e escolha "Salvar em Arquivos", WhatsApp ou e-mail.'
                : 'Compartilhe (WhatsApp, e-mail, Drive) ou baixe para a pasta Downloads.')
      : 'O arquivo vai para a pasta de downloads do aparelho.';
    return new Promise((resolve) => {
      const caixa = $('#modal-arquivo');
      let url = null;
      const fim = (modo) => {
        caixa.hidden = true;
        [bt.comp, bt.baixar, bt.abrir, bt.fechar].forEach(b => { b.onclick = null; });
        if (url) setTimeout(() => URL.revokeObjectURL(url), 120000);
        resolve({ modo: modo, nome: nome });
      };
      bt.comp.onclick = async () => {
        try { await navigator.share({ files: [arquivo], title: nome }); fim('compartilhado'); }
        catch (e) {
          if (e && e.name === 'AbortError') return;
          downloadDireto(blob, nome); fim('baixado');
        }
      };
      bt.baixar.onclick = () => { downloadDireto(blob, nome); fim('baixado'); };
      bt.abrir.onclick = () => {
        url = url || URL.createObjectURL(blob);
        const w = window.open(url, '_blank');
        if (!w) { downloadDireto(blob, nome); fim('baixado'); return; }
        fim('aberto');
      };
      bt.fechar.onclick = () => fim('fechado');
      caixa.hidden = false;
      setTimeout(() => (bt.comp.hidden ? bt.baixar : bt.comp).focus(), 50);
    });
  }

  function avisoEntrega(r) {
    if (!r) return;
    const txt = {
      download: 'Arquivo gerado: ' + r.nome,
      compartilhado: 'Arquivo enviado/salvo: ' + r.nome,
      baixado: 'Arquivo baixado: ' + r.nome + ' (pasta Downloads).',
      aberto: 'PDF aberto: ' + r.nome
    }[r.modo];
    if (txt) aviso(txt, 'sucesso', 5);
  }

  function baixarTexto(nomeArquivo, conteudo, mime) {
    const blob = new Blob([conteudo], { type: mime + ';charset=utf-8' });
    return entregarArquivo(blob, nomeArquivo, mime);
  }

  function escapar(t) {
    return String(t === null || t === undefined ? '' : t)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function dataBR(iso) { return PDFGEN.dataBR(iso); }

  function preencherSelect(el, valores, textoVazio, valorAtual) {
    el.innerHTML = '';
    if (textoVazio !== null) {
      const op0 = document.createElement('option');
      op0.value = ''; op0.textContent = textoVazio;
      el.appendChild(op0);
    }
    valores.forEach(v => {
      const o = document.createElement('option');
      o.value = (typeof v === 'string') ? v : v.valor;
      o.textContent = (typeof v === 'string') ? v : v.texto;
      el.appendChild(o);
    });
    if (valorAtual) el.value = valorAtual;
  }

  function preencherDatalist(id, valores) {
    const dl = document.getElementById(id);
    dl.innerHTML = '';
    valores.forEach(v => { const o = document.createElement('option'); o.value = v; dl.appendChild(o); });
  }

  function marcarErro(idCampo, mensagem) {
    const campo = document.getElementById(idCampo);
    if (!campo) return;
    const cont = campo.closest('.campo') || campo.parentElement;
    if (mensagem) {
      cont.classList.add('invalido');
      const span = cont.querySelector('.erro');
      if (span) span.textContent = mensagem;
    } else {
      cont.classList.remove('invalido');
    }
  }
  function limparErros(seletor) {
    $$((seletor || '') + ' .campo').forEach(c => c.classList.remove('invalido'));
    const ef = $('#e-fotos'); if (ef) ef.textContent = '';
  }

  /* ===================================================================
   * INDICADORES DO CABEÇALHO E DA NAVEGAÇÃO
   * =================================================================== */
  async function atualizarBadges() {
    if (!AUTH.autenticado()) { $('#txt-rede').textContent = '—'; $('#nav-nc-badge').hidden = true; return; }
    const lista = await DB.listarRelatorios({});
    const badge = $('#badge-rede');
    badge.classList.remove('offline', 'erro', 'online');
    const pend = await DB.listarPendentes();
    const comErro = pend.filter(r => r.status === 'erro').length;

    // Contador na aba Relatórios: o que ainda está só no aparelho (vermelho se houver erro)
    const nb = $('#nav-nc-badge');
    nb.hidden = !(SYNC.ativo() && pend.length);
    nb.textContent = pend.length;
    nb.classList.toggle('alerta', !!comErro);

    if (SYNC.ativo()) {
      const faixa = $('#faixa-fila');
      const telaInterna = TELAS_VISUAL_ACESSO.indexOf(estado.tela) === -1;
      faixa.hidden = !pend.length || !telaInterna || estado.sincronizando;
      if (pend.length) {
        $('#faixa-fila-qtd').textContent = pend.length === 1 ? '1 relatório aguardando envio'
                                                            : pend.length + ' relatórios aguardando envio';
        $('#faixa-fila-sub').textContent = SYNC.baseSemTabela()
          ? 'A base central ainda não foi preparada (script do banco). Os relatórios seguem salvos e sobem sozinhos depois.'
          : comErro
            ? 'Houve erro no envio: ' + (pend.find(r => r.status === 'erro').erroMsg || 'tente novamente.')
            : (navigator.onLine ? 'Enviando automaticamente…' : 'Sem internet. Serão enviados assim que o sinal voltar.');
        faixa.classList.toggle('erro', !!comErro);
      }
      if (estado.sincronizando) { badge.classList.add('online'); $('#txt-rede').textContent = 'Sincronizando…'; }
      else if (!navigator.onLine) { badge.classList.add('offline'); $('#txt-rede').textContent = pend.length ? 'Offline • ' + pend.length + ' na fila' : 'Offline'; }
      else if (comErro) { badge.classList.add('erro'); $('#txt-rede').textContent = comErro + ' com erro'; }
      else if (pend.length) { badge.classList.add('offline'); $('#txt-rede').textContent = pend.length + ' na fila'; }
      else { badge.classList.add('online'); $('#txt-rede').textContent = 'Sincronizado'; }
    } else {
      badge.classList.add('online');
      $('#txt-rede').textContent = lista.length === 1 ? '1 relatório' : lista.length + ' relatórios';
    }

    if (estado.tela === 'tela-sync') {
      let fotos = 0;
      for (const r of lista) fotos += (await DB.contarFotos(r.id)).total;
      $('#n-total').textContent = lista.length;
      $('#n-nc').textContent = lista.filter(r => r.naoConformidade === 'Sim').length;
      $('#n-fotos').textContent = fotos;
    }
  }

  async function verificarArmazenamento(silencioso) {
    const e = await DB.estimativaArmazenamento();
    const mb = (b) => (b / 1048576).toFixed(1) + ' MB';
    const barra = $('#barra-uso');
    if (barra) {
      const pct = Math.min(100, Math.round(e.percentual));
      barra.style.width = (e.suportado ? Math.max(2, pct) : 2) + '%';
      barra.classList.toggle('cheio', pct >= CONFIG.limites.alertaArmazenamentoPct);
      $('#txt-armazenamento').textContent = e.suportado
        ? (mb(e.usado) + ' usados de ' + mb(e.cota) + ' disponíveis (' + pct + '%).')
        : ('Aproximadamente ' + mb(e.usado) + ' em fotos. Este navegador não informa a cota total (comum no iPhone).');
    }
    if (!silencioso && e.suportado && e.percentual >= CONFIG.limites.alertaArmazenamentoPct) {
      aviso('Atenção: o armazenamento do navegador está em ' + Math.round(e.percentual) +
            '%. Sincronize e exporte um backup antes de continuar registrando fotos.', 'alerta', 0);
    }
    return e;
  }

  /* ===================================================================
   * ACESSO — LOGIN, CADASTRO E RECUPERAÇÃO
   * =================================================================== */
  function alternarSenha(botao) {
    const alvo = document.getElementById(botao.dataset.alvo);
    if (!alvo) return;
    const mostrando = alvo.type === 'text';
    alvo.type = mostrando ? 'password' : 'text';
    botao.classList.toggle('visivel', !mostrando);
    botao.setAttribute('aria-label', mostrando ? 'Mostrar senha' : 'Ocultar senha');
  }

  function atualizarAvisosDeRede() {
    const off = !navigator.onLine;
    const local = AUTH.modoLocal();
    $('#aviso-offline-login').hidden = local || !off;
    $('#aviso-offline-recuperar').hidden = local || !off;
    $('#btn-recuperar').disabled = local ? false : off;
    $('#btn-cadastrar').disabled = local ? false : off;
    $('#aviso-modo-local').hidden = !local;
    $('#aviso-cadastro-local').hidden = !local;
    $('#aviso-recuperar-local').hidden = !local;
    $('#apoio-cadastro-rede').hidden = local;
    $('#apoio-cadastro-aprovacao').hidden = local;
    $('#apoio-admin').innerHTML = local
      ? 'Contas criadas neste aparelho: lotes de atuação, visão e situação. Não exige internet.'
      : 'Todo novo cadastro chega aqui <b>bloqueado</b>. Só o administrador libera o acesso, ' +
        'define os lotes e o que cada colaborador enxerga: <b>somente os próprios relatórios</b> ' +
        'ou <b>todos os relatórios dos seus lotes</b>.';
  }

  async function fazerLogin() {
    limparErros('#tela-login');
    const email = $('#login-email').value.trim();
    const senha = $('#login-senha').value;
    let erro = false;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { marcarErro('login-email', 'Informe um e-mail válido.'); erro = true; }
    if (!senha) { marcarErro('login-senha', 'Informe a senha.'); erro = true; }
    if (erro) return;
    carregando(true, navigator.onLine ? 'Entrando…' : 'Validando acesso offline…');
    try {
      await AUTH.entrarAuto(email, senha, $('#login-manter').checked);
      $('#login-senha').value = '';
      await aoAutenticar();
    } catch (e) {
      const msg = String(e.message || e);
      if (msg === 'PENDENTE') {
        aviso('Seu cadastro está aguardando a liberação do administrador. ' +
              'Você será liberado assim que ele aprovar o acesso.', 'alerta', 0);
      } else {
        aviso(msg, 'erro', 10);
      }
    } finally {
      carregando(false);
    }
  }

  function montarLotesCadastro() {
    const cont = $('#cad-lotes');
    cont.innerHTML = '';
    const itens = [{ valor: '__todos__', texto: 'Todos os lotes' }]
      .concat(CONFIG.listarLotes().map(l => ({ valor: l, texto: CONFIG.rotuloLote(l) })));
    itens.forEach((item, i) => {
      const lab = document.createElement('label');
      if (item.valor === '__todos__') lab.classList.add('destaque');
      lab.innerHTML = '<input type="checkbox" id="cad-lote-' + i + '" value="' + escapar(item.valor) + '"><span>' + escapar(item.texto) + '</span>';
      const inp = lab.querySelector('input');
      inp.addEventListener('change', () => {
        lab.classList.toggle('marcado', inp.checked);
        if (item.valor === '__todos__') {
          $$('#cad-lotes input').forEach(o => {
            if (o.value !== '__todos__') { o.checked = inp.checked; o.closest('label').classList.toggle('marcado', inp.checked); }
          });
        } else {
          const todos = $$('#cad-lotes input').filter(o => o.value !== '__todos__').every(o => o.checked);
          const master = $('#cad-lotes input[value="__todos__"]');
          master.checked = todos;
          master.closest('label').classList.toggle('marcado', todos);
        }
      });
      cont.appendChild(lab);
    });
  }

  function lotesSelecionadosCadastro() {
    return $$('#cad-lotes input:checked').map(i => i.value).filter(v => v !== '__todos__');
  }

  async function fazerCadastro() {
    limparErros('#tela-cadastro');
    const funcaoSel = $('#cad-funcao').value;
    const dados = {
      nome: $('#cad-nome').value.trim().replace(/\s+/g, ' '),
      email: $('#cad-email').value.trim().toLowerCase(),
      funcao: funcaoSel === 'Outro' ? $('#cad-funcao-outro').value.trim() : funcaoSel,
      lotes: lotesSelecionadosCadastro(),
      senha: $('#cad-senha').value,
      confirmacao: $('#cad-senha2').value
    };
    let erro = false;
    if (dados.nome.length < 5) { marcarErro('cad-nome', 'Informe o nome completo.'); erro = true; }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(dados.email)) { marcarErro('cad-email', 'E-mail inválido.'); erro = true; }
    if (!funcaoSel) { marcarErro('cad-funcao', 'Selecione a função.'); erro = true; }
    if (funcaoSel === 'Outro' && !dados.funcao) { marcarErro('cad-funcao-outro', 'Informe a função.'); erro = true; }
    if (!dados.lotes.length) { marcarErro('cad-lotes', 'Selecione ao menos um lote.'); erro = true; }
    if (!AUTH.validarSenha(dados.senha)) {
      marcarErro('cad-senha', 'Mínimo de ' + CONFIG.auth.minimoSenha + ' caracteres, com letra e número.'); erro = true;
    }
    if (dados.senha !== dados.confirmacao) { marcarErro('cad-senha2', 'A confirmação não confere.'); erro = true; }
    if (erro) { aviso('Corrija os campos destacados.', 'erro'); return; }

    carregando(true, 'Enviando cadastro…');
    try {
      const r = await AUTH.cadastrar(dados);
      $('#cad-senha').value = ''; $('#cad-senha2').value = '';
      if (r.entrou) {
        await aoAutenticar();
        aviso('Cadastro criado neste aparelho' + (r.admin ? ' com perfil de administrador' : '') +
              '. Você já pode registrar relatórios.', 'sucesso', 8);
        return;
      }
      mostrarTela('tela-login');
      $('#login-email').value = dados.email;
      aviso(r.precisaConfirmarEmail
        ? 'Cadastro enviado. Confirme o e-mail que você recebeu e aguarde a liberação do administrador.'
        : 'Cadastro enviado. Aguarde a liberação do administrador.', 'sucesso', 0);
    } catch (e) {
      const msg = String(e.message || e);
      aviso(msg === 'SEM_REDE' ? 'O cadastro exige internet. Conecte-se à rede e tente novamente.' : msg, 'erro', 10);
    } finally {
      carregando(false);
    }
  }

  async function fazerRecuperacao() {
    limparErros('#tela-recuperar');
    const email = $('#rec-email').value.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { marcarErro('rec-email', 'Informe um e-mail válido.'); return; }
    carregando(true, 'Enviando…');
    try {
      await AUTH.recuperarSenha(email);
      mostrarTela('tela-login');
      aviso('Se o e-mail estiver cadastrado, o link de redefinição chegará em instantes.', 'sucesso', 10);
    } catch (e) {
      const msg = String(e.message || e);
      aviso(msg === 'MODO_LOCAL'
        ? 'Sem servidor configurado, a recuperação por e-mail não existe. A conta é deste aparelho: ' +
          'crie outra com um e-mail diferente ou peça ao administrador do aparelho.'
        : msg === 'SEM_REDE' ? 'Recuperação de senha exige internet. Conecte-se à rede e tente novamente.' : msg, 'erro', 12);
    } finally {
      carregando(false);
    }
  }

  async function aoAutenticar() {
    $('#cartao-admin-atalho').hidden = !AUTH.ehAdmin();
    await DB.solicitarPersistencia();
    await atualizarBadges();
    mostrarBoasVindas();
    if (SYNC.ativo() && !estado.syncIniciado) {
      estado.syncIniciado = true;
      SYNC.iniciar();
    }
  }

  /* ===================================================================
   * SINCRONIZAÇÃO — reflexo na tela
   * =================================================================== */
  function aoMudarSync(evento, resumo) {
    if (evento === 'inicio') { estado.sincronizando = true; atualizarBadges(); return; }
    if (evento === 'rede') { atualizarBadges(); return; }
    if (evento === 'fotosIndisponiveis') {
      aviso((resumo.qtd === 1 ? '1 foto se perdeu' : resumo.qtd + ' fotos se perderam') +
            ' neste aparelho antes do envio. Abra o relatório, exclua a foto marcada como "indisponível" e tire novamente.', 'alerta', 0);
      return;
    }
    if (evento !== 'fim') return;
    estado.sincronizando = false;
    estado.ultimoResumo = resumo || null;
    if (resumo && resumo.bloqueado) {
      AUTH.sair().then(() => { mostrarTela('tela-login'); aviso('Seu acesso foi suspenso pelo administrador.', 'erro', 0); });
      return;
    }
    if (resumo && resumo.semTabela && !estado.avisouSemTabela) {
      estado.avisouSemTabela = true;
      aviso('A base central ainda não foi preparada pelo administrador. Os relatórios ficam salvos neste aparelho e sobem sozinhos quando ela estiver pronta.', 'alerta', 10);
    }
    if (resumo && resumo.recebidas) {
      aviso(resumo.recebidas === 1 ? '1 relatório atualizado da base central.'
                                   : resumo.recebidas + ' relatórios atualizados da base central.', 'sucesso', 4);
    }
    if (resumo && (resumo.recebidas || resumo.enviados) && estado.tela === 'tela-historico') carregarHistorico();
    atualizarBadges();
    if (estado.tela === 'tela-sync') atualizarTelaSync();
    verificarLiberacoes();
  }

  function sincronizarEmSegundoPlano() {
    if (!SYNC.ativo()) return;
    setTimeout(() => SYNC.sincronizar(false), 300);
    SYNC.agendarSegundoPlano();
    atualizarBadges();
  }

  async function sincronizarAgora() {
    if (!SYNC.ativo()) return;
    if (!navigator.onLine) { aviso('Sem internet. Os relatórios continuam na fila do aparelho.', 'alerta', 6); return; }
    carregando(true, 'Sincronizando com a base central…');
    try {
      const r = await SYNC.sincronizar(true);
      if (r.offline) aviso('A base central não respondeu. Tente de novo em instantes.', 'alerta', 6);
      else if (r.sessaoExpirada) aviso('Sessão expirada. Saia e entre novamente para sincronizar.', 'erro', 0);
      else if (r.erro) aviso('Falha na sincronização: ' + r.erro, 'erro', 10);
      else if (!r.pulado) aviso('Sincronizado: ' + (r.enviados || 0) + ' enviado(s), ' + (r.recebidas || 0) +
                                ' recebido(s)' + (r.falhas ? ', ' + r.falhas + ' com erro' : '') + '.',
                                r.falhas ? 'alerta' : 'sucesso', 6);
    } finally {
      carregando(false);
      atualizarTelaSync();
    }
  }

  async function verificarLiberacoes() {
    const caixa = $('#bv-liberacoes');
    const selo = $('#selo-pendentes-mais');
    const nb = $('#nav-mais-badge');
    if (!AUTH.autenticado() || !AUTH.ehAdmin()) { caixa.hidden = true; selo.hidden = true; nb.hidden = true; return 0; }
    const n = await AUTH.admin.contarPendentes();
    caixa.hidden = !n; selo.hidden = !n; nb.hidden = !n;
    nb.textContent = n;
    $('#bv-lib-qtd').textContent = n;
    $('#bv-lib-rotulo').textContent = n === 1 ? 'cadastro aguardando sua liberação' : 'cadastros aguardando sua liberação';
    selo.textContent = n + (n === 1 ? ' pendente' : ' pendentes');
    if (n && estado.pendentesAvisados !== n) {
      estado.pendentesAvisados = n;
      aviso(n === 1 ? 'Há 1 novo cadastro aguardando liberação de acesso.'
                    : 'Há ' + n + ' novos cadastros aguardando liberação de acesso.', 'alerta', 8);
    }
    return n;
  }

  function mostrarBoasVindas() {
    const p = AUTH.perfil();
    const primeiro = p && p.nome ? String(p.nome).trim().split(/\s+/)[0] : '';
    $('#bv-nome').textContent = primeiro ? ', ' + primeiro.charAt(0).toUpperCase() + primeiro.slice(1).toLowerCase() : '';
    mostrarTela('tela-boasvindas');
    verificarLiberacoes();
  }

  async function sairDaConta() {
    const pend = await DB.listarPendentes();
    const texto = pend.length
      ? 'Você tem ' + pend.length + ' relatório(s) ainda não enviado(s). Eles continuam guardados neste aparelho e voltam quando você entrar de novo com a mesma conta.'
      : 'Seus relatórios continuam guardados neste aparelho.';
    const c = await confirmar('Sair da conta?', texto, false, 'Sair');
    if (!c.ok) return;
    pararGPS();
    await AUTH.sair();
    $('#login-senha').value = '';
    mostrarTela('tela-login');
    aviso('Sessão encerrada.', 'sucesso', 4);
  }

  /* ===================================================================
   * FORMULÁRIO DO RELATÓRIO
   * =================================================================== */
  function montarProjetos(valorAtual, outroAtual) {
    const lista = (CONFIG.projetos || []).slice();
    preencherSelect($('#f-projeto'), lista.concat(['Outro']), lista.length ? null : 'Selecione…');
    if (valorAtual && lista.indexOf(valorAtual) === -1 && valorAtual !== 'Outro') {
      // Projeto recebido da base que não está no config: entra como "Outro"
      $('#f-projeto').value = 'Outro';
      $('#f-projeto-outro').value = valorAtual;
    } else {
      $('#f-projeto').value = valorAtual || lista[0] || '';
      $('#f-projeto-outro').value = outroAtual || '';
    }
    $('#campo-projeto-outro').hidden = $('#f-projeto').value !== 'Outro';
  }

  function montarLotes(valorAtual) {
    const permitidos = AUTH.lotes();
    const sel = $('#f-lote');
    preencherSelect(sel, permitidos.map(l => ({ valor: l, texto: CONFIG.rotuloLote(l) })),
      permitidos.length ? 'Selecione…' : 'Nenhum lote vinculado ao seu usuário', valorAtual || '');
    const apoio = $('#apoio-lote');
    if (permitidos.length === 1) {
      sel.value = permitidos[0];
      sel.disabled = true;
      apoio.hidden = false;
      apoio.textContent = 'Você está vinculado apenas ao lote ' + permitidos[0] + '.';
    } else {
      sel.disabled = false;
      apoio.hidden = permitidos.length > 0;
      if (!permitidos.length) apoio.textContent = 'Seu usuário não tem lote liberado. Fale com o administrador.';
    }
  }

  function aoMudarLote(canteiroAtual, canteiroOutro) {
    const lote = $('#f-lote').value;
    const canteiros = CONFIG.listarCanteiros(lote);
    const sel = $('#f-canteiro');
    sel.disabled = !lote;
    let valor = canteiroAtual || '';
    if (valor && valor !== 'Outro' && canteiros.indexOf(valor) === -1) {
      canteiroOutro = valor; valor = 'Outro';
    }
    preencherSelect(sel, canteiros.concat(['Outro']),
      lote ? (canteiros.length ? 'Selecione…' : 'Nenhum cadastrado — use "Outro"') : 'Selecione o lote primeiro', valor);
    if (canteiros.length === 1 && !valor) sel.value = canteiros[0];
    if (canteiroOutro !== undefined) $('#f-canteiro-outro').value = canteiroOutro || '';
    $('#campo-canteiro-outro').hidden = sel.value !== 'Outro';
    atualizarNumero();
  }

  function tipoEscolhido() {
    const r = $$('input[name=tipo]').filter(x => x.checked)[0];
    return r ? r.value : '';
  }

  function aplicarTipo() {
    const tipo = tipoEscolhido();
    $('.opcao-receb').classList.toggle('escolhida', tipo === 'Recebimento');
    $('.opcao-saida').classList.toggle('escolhida', tipo === 'Saída');
    $('#dados-tipo').hidden = !tipo;
    $('#bloco-recebimento').hidden = tipo !== 'Recebimento';
    $('#bloco-saida').hidden = tipo !== 'Saída';
    $('#tit-dados').textContent = tipo === 'Recebimento' ? 'Dados do recebimento'
                                : tipo === 'Saída' ? 'Dados da saída' : 'Dados do material';
    $('#sub-dados').textContent = tipo === 'Recebimento' ? 'NF, fornecedor, canteiro e descrição do material'
                                : tipo === 'Saída' ? 'NF, fornecedor, transportadora, trecho, torre e descrição'
                                : 'Escolha o tipo para abrir os campos';
    $('#cartao-dados').dataset.tipo = tipo;
    if (tipo) marcarErro('campo-tipo', null);
    $('#titulo-form').textContent = (estado.ehNovo ? 'Novo relatório' : 'Editar relatório') + (tipo ? ' — ' + tipo : '');
  }

  function ncEscolhida() {
    const r = $$('input[name=nc]').filter(x => x.checked)[0];
    return r ? r.value : 'Não';
  }

  function aplicarNC() {
    const nc = ncEscolhida();
    $('.opcao-sim').classList.toggle('escolhida', nc === 'Sim');
    $('.opcao-nao').classList.toggle('escolhida', nc === 'Não');
    $('#bloco-nc').hidden = nc !== 'Sim';
    $('#cartao-nc').classList.toggle('com-nc', nc === 'Sim');
    if (nc !== 'Sim') marcarErro('f-descricao-nc', null);
  }

  function atualizarNumero() {
    if (!estado.registro) return;
    const tmp = Object.assign({}, estado.registro, { lote: $('#f-lote').value, dataRelatorio: $('#f-data').value });
    $('#txt-numero').textContent = DB.numeroRelatorio(tmp);
  }

  async function atualizarSugestoes() {
    preencherDatalist('lista-fornecedores', await DB.sugestoes('fornecedor', CONFIG.sugestoes.fornecedores));
    preencherDatalist('lista-transportadoras', await DB.sugestoes('transportadora', CONFIG.sugestoes.transportadoras));
  }

  /** Preenche a tela com um registro (novo ou em edição). */
  async function preencherFormulario(reg) {
    const p = AUTH.perfil();
    $('#txt-responsavel').textContent = reg.responsavel || (p ? p.nome : '—');
    $('#txt-funcao').textContent = reg.funcaoResponsavel || (p ? p.funcao : '');
    montarProjetos(reg.projeto, reg.projetoOutro);
    $('#f-data').max = hojeISO();
    $('#f-data').value = reg.dataRelatorio;
    montarLotes(reg.lote);
    aoMudarLote(reg.canteiro, reg.canteiroOutro);
    $$('input[name=tipo]').forEach(x => { x.checked = (x.value === reg.tipo); });
    aplicarTipo();
    $('#f-nf').value = reg.nf || '';
    $('#f-fornecedor').value = reg.fornecedor || '';
    $('#f-transportadora').value = reg.transportadora || '';
    $('#f-trecho').value = reg.trecho || '';
    $('#f-torre').value = reg.torre || '';
    $('#f-descricao').value = reg.descricao || '';
    $('#f-observacoes').value = reg.observacoes || '';
    $$('input[name=nc]').forEach(x => { x.checked = (x.value === (reg.naoConformidade || 'Não')); });
    aplicarNC();
    $('#f-descricao-nc').value = reg.descricaoNC || '';
    limparErros('#form-relatorio');
    atualizarNumero();
    await atualizarSugestoes();
    await desenharFotos();
  }

  /**
   * Descarta o que está aberto no formulário sem salvar.
   * - Relatório novo: as fotos dele não ficam órfãs no aparelho.
   * - Edição: as fotos já trocadas ficam gravadas; o relatório volta à
   *   fila para que a base central receba as fotos novas.
   */
  async function descartarRascunho() {
    const r = estado.registro;
    if (!r || estado.salvo) return;
    if (estado.ehNovo) await DB.removerFotosDoRelatorio(r.id);
    else if (estado.fotosAlteradas) {
      const original = await DB.obterRelatorio(r.id);
      if (original) { await DB.salvarRelatorio(original); sincronizarEmSegundoPlano(); }
    }
    estado.fotosAlteradas = false;
  }

  async function novoRelatorio(tipo) {
    pararGPS();
    await descartarRascunho();
    estado.registro = DB.novoRelatorio(tipo);
    estado.fotosAlteradas = false;
    estado.ehNovo = true;
    estado.salvo = false;
    await preencherFormulario(estado.registro);
    mostrarTela('tela-nova');
    mostrarGeo();
    atualizarMapaForm();
    iniciarGPS();
  }

  /** Volta ao rascunho em andamento (aba "Novo") ou abre um novo. */
  async function abrirAbaNovo() {
    if (estado.registro && !estado.salvo && estado.tela !== 'tela-nova') {
      mostrarTela('tela-nova');
      atualizarMapaForm();
      if (!estado.registro.ajusteManual && estado.ehNovo) iniciarGPS();
      return;
    }
    if (estado.tela !== 'tela-nova') await novoRelatorio('');
  }

  async function editarRelatorio(id) {
    const reg = await DB.obterRelatorio(id);
    if (!reg) { aviso('Relatório não encontrado ou de outro usuário.', 'erro'); return; }
    if (!DB.ehMeu(reg)) { aviso('Somente quem registrou o relatório pode editá-lo.', 'alerta', 6); return; }
    await descartarRascunho();
    await garantirFotos(reg);
    pararGPS();
    estado.registro = JSON.parse(JSON.stringify(reg));
    estado.fotosAlteradas = false;
    estado.ehNovo = false;
    estado.salvo = false;
    // Na edição o local já registrado é mantido; o GPS ao vivo volta só se pedido.
    if (MAPA.temCoord(estado.registro)) estado.registro.ajusteManual = true;
    await preencherFormulario(estado.registro);
    mostrarTela('tela-nova');
    mostrarGeo();
    atualizarMapaForm();
    if (!MAPA.temCoord(estado.registro)) iniciarGPS();
  }

  function validar() {
    limparErros('#form-relatorio');
    const erros = [];
    const projeto = $('#f-projeto').value;
    if (!projeto) { marcarErro('f-projeto', 'Selecione o projeto.'); erros.push('Projeto'); }
    if (projeto === 'Outro' && !$('#f-projeto-outro').value.trim()) { marcarErro('f-projeto-outro', 'Informe o nome do projeto.'); erros.push('Projeto (Outro)'); }

    const lote = $('#f-lote').value;
    if (!lote) { marcarErro('f-lote', 'Selecione o lote.'); erros.push('Lote'); }
    else if (AUTH.lotes().indexOf(lote) === -1) { marcarErro('f-lote', 'Você não tem acesso a este lote.'); erros.push('Lote não autorizado'); }

    const data = $('#f-data').value;
    if (!data) { marcarErro('f-data', 'Informe a data.'); erros.push('Data'); }
    else if (data > hojeISO()) { marcarErro('f-data', 'Não é permitida data futura.'); erros.push('Data futura'); }

    const tipo = tipoEscolhido();
    if (!tipo) { marcarErro('campo-tipo', 'Escolha Recebimento ou Saída.'); $('#e-tipo').textContent = 'Escolha Recebimento ou Saída.'; erros.push('Tipo'); }
    else {
      if (!$('#f-nf').value.trim()) { marcarErro('f-nf', 'Informe a NF.'); erros.push('NF'); }
      if (!$('#f-fornecedor').value.trim()) { marcarErro('f-fornecedor', 'Informe o fornecedor.'); erros.push('Fornecedor'); }
      if (tipo === 'Recebimento') {
        if (!$('#f-canteiro').value) { marcarErro('f-canteiro', 'Selecione o canteiro.'); erros.push('Canteiro'); }
        if ($('#f-canteiro').value === 'Outro' && !$('#f-canteiro-outro').value.trim()) { marcarErro('f-canteiro-outro', 'Informe o canteiro.'); erros.push('Canteiro (Outro)'); }
      } else {
        if (!$('#f-transportadora').value.trim()) { marcarErro('f-transportadora', 'Informe a transportadora.'); erros.push('Transportadora'); }
        if (!$('#f-trecho').value.trim()) { marcarErro('f-trecho', 'Informe o trecho.'); erros.push('Trecho'); }
        if (!$('#f-torre').value.trim()) { marcarErro('f-torre', 'Informe a torre.'); erros.push('Torre'); }
      }
      if ($('#f-descricao').value.trim().length < 3) { marcarErro('f-descricao', 'Descreva o material.'); erros.push('Descrição do material'); }
    }
    if (ncEscolhida() === 'Sim' && $('#f-descricao-nc').value.trim().length < 3) {
      marcarErro('f-descricao-nc', 'Obrigatório descrever a não conformidade.'); erros.push('Descrição da NC');
    }
    if (!estado.qtdFotosGerais) {
      $('#e-fotos').textContent = 'Inclua ao menos uma foto no registro fotográfico.';
      erros.push('Ao menos 1 foto');
    }
    return erros;
  }

  function coletarFormulario() {
    const r = estado.registro;
    const p = AUTH.perfil();
    r.responsavel = r.responsavel || (p ? p.nome : '');
    r.funcaoResponsavel = r.funcaoResponsavel || (p ? p.funcao : '');
    r.emailResponsavel = r.emailResponsavel || (p ? p.email : '');
    r.projeto = $('#f-projeto').value;
    r.projetoOutro = r.projeto === 'Outro' ? $('#f-projeto-outro').value.trim() : '';
    r.lote = $('#f-lote').value;
    r.dataRelatorio = $('#f-data').value;
    r.tipo = tipoEscolhido();
    r.nf = $('#f-nf').value.trim();
    r.fornecedor = $('#f-fornecedor').value.trim();
    r.canteiro = $('#f-canteiro').value;
    r.canteiroOutro = r.canteiro === 'Outro' ? $('#f-canteiro-outro').value.trim() : '';
    r.transportadora = $('#f-transportadora').value.trim();
    r.trecho = $('#f-trecho').value.trim();
    r.torre = $('#f-torre').value.trim();
    r.descricao = $('#f-descricao').value.trim();
    r.observacoes = $('#f-observacoes').value.trim();
    r.naoConformidade = ncEscolhida();
    r.descricaoNC = r.naoConformidade === 'Sim' ? $('#f-descricao-nc').value.trim() : '';
    return r;
  }

  async function salvarFormulario(ev) {
    if (ev) ev.preventDefault();
    await salvarLegendasPendentes();
    const erros = validar();
    if (erros.length) {
      aviso('Não foi possível salvar. Corrija: ' + erros.join(', ') + '.', 'erro', 8);
      const primeiro = $('#form-relatorio .campo.invalido') || ($('#e-fotos').textContent ? $('#slots-fotos') : null);
      if (primeiro) primeiro.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const r = coletarFormulario();
    carregando(true, 'Gravando no aparelho…');
    try {
      pararGPS();
      await DB.salvarRelatorio(r);
      estado.salvo = true;
      const n = await DB.contarFotos(r.id);
      aviso('Relatório ' + r.numero + ' salvo no aparelho com ' + n.total + ' foto(s)' +
            (SYNC.ativo() ? (navigator.onLine ? ' e enviado para a base central.' : '. Será enviado quando houver internet.') : '.'),
            'sucesso', 7);
      sincronizarEmSegundoPlano();
      await atualizarBadges();
      await verificarArmazenamento(false);
      const id = r.id;
      estado.registro = null;
      await abrirDetalhe(id);
    } catch (e) {
      aviso('Falha ao gravar: ' + (e.message || e), 'erro', 0);
    } finally {
      carregando(false);
    }
  }

  async function cancelarFormulario() {
    const c = await confirmar('Descartar?', 'As informações preenchidas nesta tela serão perdidas.', false, 'Descartar');
    if (!c.ok) return;
    pararGPS();
    const editado = !estado.ehNovo && estado.registro ? estado.registro.id : null;
    const fotosMudaram = !!estado.fotosAlteradas;
    await descartarRascunho();
    estado.registro = null;
    if (editado) {
      if (fotosMudaram) aviso('Os dados não foram alterados. As fotos trocadas durante a edição foram mantidas.', 'alerta', 7);
      await abrirDetalhe(editado);
    } else {
      mostrarBoasVindas();
    }
  }

  /* ---------------------------------------------------------------
   * GPS EM TEMPO REAL
   * ------------------------------------------------------------- */
  function iniciarGPS() {
    const r = estado.registro;
    if (!r) return;
    pararGPS();
    if (!navigator.geolocation) {
      r.obsGeo = 'Geolocalização não suportada neste navegador.';
      mostrarGeo('erro');
      return;
    }
    r.ajusteManual = false;
    mostrarGeo('buscando');
    estado.gps.watchId = navigator.geolocation.watchPosition((pos) => {
      if (!estado.registro || estado.registro !== r || r.ajusteManual) return;
      r.latitude = +pos.coords.latitude.toFixed(6);
      r.longitude = +pos.coords.longitude.toFixed(6);
      r.precisaoGps = pos.coords.accuracy ? Math.round(pos.coords.accuracy) : null;
      r.obsGeo = null;
      estado.gps.ultima = new Date();
      mostrarGeo('vivo');
      if (estado.tela === 'tela-nova' && window.MAPA) MAPA.seguir(r.latitude, r.longitude, r.precisaoGps);
    }, (err) => {
      if (!estado.registro || estado.registro !== r) return;
      const motivos = { 1: 'Permissão de localização negada. Libere a localização para este app nas configurações.',
                        2: 'Localização indisponível no momento.', 3: 'O GPS está demorando para responder…' };
      if (err.code === 3 && MAPA.temCoord(r)) return;      // já tem posição: só segue tentando
      r.obsGeo = motivos[err.code] || 'Não foi possível obter a localização.';
      mostrarGeo(err.code === 3 ? 'buscando' : 'erro');
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: CONFIG.limites.timeoutGeolocalizacaoMs * 2 });
  }

  function pararGPS() {
    if (estado.gps.watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(estado.gps.watchId);
    estado.gps.watchId = null;
  }

  /** Atualiza o quadro do GPS. modo: vivo | fixo | buscando | erro */
  function mostrarGeo(modo) {
    const r = estado.registro;
    if (!r) return;
    const caixa = $('#rf-gps');
    const tem = MAPA.temCoord(r);
    if (!modo) modo = r.ajusteManual && tem ? 'fixo' : (estado.gps.watchId !== null ? (tem ? 'vivo' : 'buscando') : (tem ? 'fixo' : 'erro'));
    caixa.className = 'rf-gps ' + modo;
    const coord = tem ? ('Lat ' + r.latitude + ' / Long ' + r.longitude + (r.precisaoGps ? ' (±' + r.precisaoGps + ' m)' : '')) : '';
    const hora = estado.gps.ultima ? estado.gps.ultima.toLocaleTimeString('pt-BR') : '';
    if (modo === 'vivo') {
      $('#gps-estado').textContent = 'GPS ao vivo';
      $('#txt-geo').textContent = coord + (hora ? ' • atualizado às ' + hora : '');
    } else if (modo === 'fixo') {
      $('#gps-estado').textContent = r.obsGeo === 'Ajustado no mapa' ? 'Local fixado no mapa' : 'Local registrado';
      $('#txt-geo').textContent = coord;
    } else if (modo === 'buscando') {
      $('#gps-estado').textContent = 'Localizando…';
      $('#txt-geo').textContent = r.obsGeo || 'Aguardando o GPS do aparelho. Em área aberta o sinal chega mais rápido.';
    } else {
      $('#gps-estado').textContent = 'Sem localização';
      $('#txt-geo').textContent = r.obsGeo || 'Não capturada.';
    }
    $('#btn-geo').hidden = modo === 'vivo' || modo === 'buscando';
    $('#btn-geo').textContent = tem ? 'Retomar GPS ao vivo' : 'Tentar novamente';
  }

  function atualizarMapaForm() {
    if (!window.MAPA || estado.tela !== 'tela-nova' || !estado.registro) return;
    MAPA.formulario(estado.registro, (lat, lng) => {
      const r = estado.registro;
      if (!r) return;
      pararGPS();
      Object.assign(r, { latitude: lat, longitude: lng, precisaoGps: null, obsGeo: 'Ajustado no mapa', ajusteManual: true });
      mostrarGeo('fixo');
    });
  }

  /* ---------------------------------------------------------------
   * FOTOS — 6 espaços com observação + fotos da NC
   * ------------------------------------------------------------- */
  const FOTO_INDISPONIVEL = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">' +
    '<rect width="400" height="300" fill="#F3F5F7"/><rect x="1" y="1" width="398" height="298" fill="none" stroke="#C9D2DA" stroke-dasharray="8 6" stroke-width="2"/>' +
    '<g fill="none" stroke="#8A97A3" stroke-width="6" stroke-linejoin="round"><rect x="160" y="95" width="80" height="60" rx="8"/><circle cx="200" cy="125" r="16"/></g>' +
    '<text x="200" y="195" font-family="Arial, sans-serif" font-size="20" font-weight="700" fill="#4A5763" text-anchor="middle">Foto indisponível</text>' +
    '<text x="200" y="222" font-family="Arial, sans-serif" font-size="15" fill="#6B7884" text-anchor="middle">exclua e tire novamente</text></svg>');
  function srcFoto(f) {
    if (!f || f.indisponivel || !f.blob) return FOTO_INDISPONIVEL;
    return URL.createObjectURL(f.blob);
  }

  /** Grava a observação que ainda está sendo digitada (antes de salvar / trocar de tela). */
  async function salvarLegendasPendentes() {
    for (const t of $$('#slots-fotos textarea[data-foto], #grade-fotos-nc input[data-foto]')) {
      await DB.atualizarLegenda(t.dataset.foto, t.value.trim());
    }
  }

  async function adicionarArquivos(lista, opcoes) {
    if (!lista || !lista.length || !estado.registro) return;
    const arquivos = Array.prototype.slice.call(lista).filter(a => /^image\//.test(a.type) || !a.type);
    if (!arquivos.length) { aviso('Escolha um arquivo de imagem.', 'erro'); return; }
    await salvarLegendasPendentes();
    carregando(true, 'Otimizando ' + arquivos.length + ' foto(s)…');
    let ok = 0;
    try {
      for (let i = 0; i < arquivos.length; i++) {
        const op = Object.assign({}, opcoes);
        if (op.slot && i > 0) op.slot = null;           // demais fotos da galeria: próximos espaços livres
        await DB.adicionarFoto(estado.registro.id, arquivos[i], op);
        estado.fotosAlteradas = true;
        ok++;
      }
    } catch (e) {
      aviso(e.message || 'Falha ao processar a foto.', 'erro', 8);
    } finally {
      carregando(false);
    }
    await desenharFotos();
    if (ok) aviso(ok === 1 ? 'Foto adicionada.' : ok + ' fotos adicionadas.', 'sucesso', 3);
    verificarArmazenamento(false);
  }

  async function desenharFotos() {
    const cont = $('#slots-fotos');
    const contNC = $('#grade-fotos-nc');
    cont.innerHTML = ''; contNC.innerHTML = '';
    if (!estado.registro) return;
    const todas = await DB.listarFotos(estado.registro.id);
    const gerais = todas.filter(f => !f.vinculo);
    const nc = todas.filter(f => f.vinculo);
    estado.qtdFotosGerais = gerais.length;
    $('#sub-fotos').textContent = gerais.length + ' de ' + N_SLOTS() + ' fotos • cada uma com a sua observação';
    if (gerais.length) $('#e-fotos').textContent = '';

    for (let s = 1; s <= N_SLOTS(); s++) {
      const f = gerais.find(x => x.slot === s);
      const div = document.createElement('div');
      div.className = 'rf-slot' + (f ? ' cheio' : '');
      if (f) {
        const url = srcFoto(f);
        div.innerHTML =
          '<div class="rf-slot-img"><img src="' + url + '" alt="Foto ' + s + '">' +
            '<span class="rf-slot-num">' + s + '</span>' +
            '<button type="button" class="rf-slot-x" data-acao="remover" aria-label="Excluir foto ' + s + '">✕</button>' +
            '<div class="rf-slot-trocar"><button type="button" data-acao="camera">Trocar</button></div></div>' +
          '<textarea rows="2" maxlength="300" data-foto="' + escapar(f.id) + '" placeholder="Observação da foto ' + s + '">' + escapar(f.legenda || '') + '</textarea>';
        const img = div.querySelector('img');
        if (url.indexOf('blob:') === 0) img.onload = () => URL.revokeObjectURL(url);
        div.querySelector('textarea').addEventListener('change', (e) => { estado.fotosAlteradas = true; DB.atualizarLegenda(f.id, e.target.value.trim()); });
      } else {
        div.innerHTML =
          '<div class="rf-slot-vazio"><span class="rf-slot-num">' + s + '</span>' +
            '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13.5" r="3.5"/></svg>' +
            '<div class="rf-slot-bts"><button type="button" class="btn btn-secundario" data-acao="camera">Tirar foto</button>' +
            '<button type="button" class="btn btn-neutro" data-acao="galeria">Anexar</button></div></div>' +
          '<textarea rows="2" disabled placeholder="Observação (inclua a foto primeiro)"></textarea>';
      }
      div.addEventListener('click', async (ev) => {
        const bt = ev.target.closest('[data-acao]');
        if (!bt) return;
        const acao = bt.dataset.acao;
        if (acao === 'camera' || acao === 'galeria') {
          estado.slotAlvo = s;
          $(acao === 'camera' ? '#in-camera' : '#in-galeria').click();
        }
        if (acao === 'remover' && f) {
          const c = await confirmar('Excluir foto ' + s + '?', 'A foto e a observação deste espaço serão removidas.', false, 'Excluir');
          if (!c.ok) return;
          await DB.removerFoto(f.id);
          estado.fotosAlteradas = true;
          await desenharFotos();
        }
      });
      cont.appendChild(div);
    }

    $('#contador-fotos-nc').textContent = '(' + nc.length + '/' + CONFIG.limites.fotosNC + ')';
    $('#btn-nc-camera').disabled = $('#btn-nc-galeria').disabled = nc.length >= CONFIG.limites.fotosNC;
    nc.forEach((f, i) => {
      const div = document.createElement('div');
      div.className = 'foto-item foto-nc';
      const url = srcFoto(f);
      div.innerHTML = '<img src="' + url + '" alt="Foto da NC ' + (i + 1) + '">' +
        '<div class="foto-acoes"><input type="text" maxlength="200" data-foto="' + escapar(f.id) + '" placeholder="Legenda (opcional)" value="' + escapar(f.legenda) + '">' +
        '<button type="button" class="btn-remover" aria-label="Excluir foto">✕</button></div>';
      if (url.indexOf('blob:') === 0) div.querySelector('img').onload = () => URL.revokeObjectURL(url);
      div.querySelector('input').addEventListener('change', (e) => { estado.fotosAlteradas = true; DB.atualizarLegenda(f.id, e.target.value.trim()); });
      div.querySelector('.btn-remover').addEventListener('click', async () => {
        const c = await confirmar('Excluir foto?', 'A foto da não conformidade será removida.', false, 'Excluir');
        if (!c.ok) return;
        await DB.removerFoto(f.id);
        estado.fotosAlteradas = true;
        await desenharFotos();
      });
      contNC.appendChild(div);
    });
  }

  /* ===================================================================
   * RELATÓRIOS REGISTRADOS (lista)
   * =================================================================== */
  function filtrosAtuais() {
    return {
      de: $('#h-de').value || null,
      ate: $('#h-ate').value || null,
      lote: $('#h-lote').value || null,
      texto: $('#h-texto').value || null,
      incluirExcluidos: $('#h-excluidos').checked
    };
  }

  function aplicarChip(lista) {
    if (estado.chip === 'NC') return lista.filter(r => r.naoConformidade === 'Sim');
    if (estado.chip) return lista.filter(r => r.tipo === estado.chip);
    return lista;
  }

  function descreverFiltros(f) {
    const p = [];
    if (f.de || f.ate) p.push('Período ' + (f.de ? dataBR(f.de) : 'início') + ' a ' + (f.ate ? dataBR(f.ate) : 'hoje'));
    if (f.lote) p.push('Lote ' + f.lote);
    if (estado.chip === 'NC') p.push('Somente com NC');
    else if (estado.chip) p.push('Tipo ' + estado.chip);
    if (f.texto) p.push('Busca "' + f.texto + '"');
    return p.length ? p.join(' | ') : 'Todos os registros';
  }

  async function listaFiltrada() {
    return aplicarChip(await DB.listarRelatorios(filtrosAtuais()));
  }

  async function carregarHistorico() {
    const vL = $('#h-lote').value;
    preencherSelect($('#h-lote'), AUTH.lotes(), 'Todos', vL);
    const f = filtrosAtuais();
    const base = await DB.listarRelatorios(f);
    const ativos = base.filter(r => !r.excluido);
    $('#k-total').textContent = ativos.length;
    $('#k-receb').textContent = ativos.filter(r => r.tipo === 'Recebimento').length;
    $('#k-saida').textContent = ativos.filter(r => r.tipo === 'Saída').length;
    $('#k-nc').textContent = ativos.filter(r => r.naoConformidade === 'Sim').length;
    const contagem = { '': base.length, 'Recebimento': base.filter(r => r.tipo === 'Recebimento').length,
                       'Saída': base.filter(r => r.tipo === 'Saída').length, 'NC': base.filter(r => r.naoConformidade === 'Sim').length };
    $$('[data-chip]').forEach(b => {
      b.classList.toggle('ativa', b.dataset.chip === estado.chip);
      b.querySelector('i').textContent = contagem[b.dataset.chip];
    });

    const lista = aplicarChip(base);
    estado.listaHistorico = lista;
    const comNC = lista.filter(r => r.naoConformidade === 'Sim').length;
    $('#h-resumo').textContent = lista.length + ' relatório(s) • ' + comNC + ' com NC';

    const cont = $('#lista-historico');
    cont.innerHTML = '';
    if (!lista.length) {
      cont.innerHTML = '<div class="vazio">Nenhum relatório encontrado com os filtros atuais.</div>';
      return;
    }
    // Ordem de urgência: erro de envio, fila, com NC e depois os demais (mais recentes primeiro)
    const peso = r => (r.status === 'erro' && DB.ehMeu(r) ? 0 : (r.status === 'pendente' && DB.ehMeu(r) && SYNC.ativo() ? 1 : 2));
    const ordenada = lista.slice().sort((a, b) => peso(a) - peso(b));

    for (const r of ordenada) {
      const qtd = await DB.contarFotos(r.id);
      const meu = DB.ehMeu(r);
      const div = document.createElement('div');
      div.className = 'item rf-item ' + (r.tipo === 'Saída' ? 't-saida' : 't-receb') +
                      (r.naoConformidade === 'Sim' ? ' com-nc' : '') + (r.excluido ? ' excluido' : '');
      const status = meu ? (SYNC.ativo() && r.status !== 'sincronizado'
                        ? '<span class="selo selo-cinza">' + (r.status === 'erro' ? 'ERRO NO ENVIO' : 'NA FILA') + '</span>' : '')
                     : '<span class="selo selo-recebida">' + escapar(r.responsavel || 'Equipe') + '</span>';
      div.innerHTML =
        '<div class="topo">' +
          '<span class="data">' + dataBR(r.dataRelatorio) + ' • ' + escapar(r.lote) + '</span>' +
          '<span class="rf-selos"><span class="selo ' + (r.tipo === 'Saída' ? 'selo-saida' : 'selo-receb') + '">' + escapar(r.tipo).toUpperCase() + '</span>' + status + '</span>' +
        '</div>' +
        '<div class="linha2"><b>NF ' + escapar(r.nf) + '</b> — ' + escapar(r.fornecedor) + '</div>' +
        '<div class="linha3">' + escapar(DB.localResumo(r)) + (r.tipo === 'Saída' && r.transportadora ? ' • ' + escapar(r.transportadora) : '') + '</div>' +
        '<div class="linha3 rf-desc">' + escapar((r.descricao || '').slice(0, 120)) + '</div>' +
        '<div class="linha3">' +
          (r.naoConformidade === 'Sim'
            ? '<span class="selo selo-nc">NÃO CONFORMIDADE</span> ' + escapar((r.descricaoNC || '').slice(0, 80))
            : '<span class="selo selo-ok">Sem NC</span>') +
          ' <span class="rf-nfotos">' + qtd.gerais + ' foto(s)' + (qtd.nc ? ' + ' + qtd.nc + ' da NC' : '') + '</span>' +
          (r.excluido ? ' <span class="selo selo-nc">EXCLUÍDO</span>' : '') +
        '</div>' +
        '<div class="rf-num">' + escapar(r.numero || DB.numeroRelatorio(r)) + '</div>' +
        '<div class="acoes-item">' +
          '<button type="button" class="btn btn-secundario" data-acao="ver">Ver</button>' +
          (meu && !r.excluido ? '<button type="button" class="btn btn-neutro" data-acao="editar">Editar</button>' : '') +
          '<button type="button" class="btn btn-neutro" data-acao="pdf">PDF</button>' +
          (!meu ? '' : r.excluido
            ? '<button type="button" class="btn btn-neutro" data-acao="restaurar">Restaurar</button>'
            : '<button type="button" class="btn btn-neutro" data-acao="excluir">Excluir</button>') +
        '</div>';
      div.addEventListener('click', async (ev) => {
        const bt = ev.target.closest('[data-acao]');
        const acao = bt ? bt.dataset.acao : null;
        if (!acao) { abrirDetalhe(r.id); return; }
        ev.stopPropagation();
        if (acao === 'ver') abrirDetalhe(r.id);
        if (acao === 'editar') editarRelatorio(r.id);
        if (acao === 'pdf') gerarPdfIndividual(r.id);
        if (acao === 'excluir') excluirRegistro(r.id);
        if (acao === 'restaurar') {
          const p = AUTH.perfil();
          await DB.restaurarRelatorio(r.id, p ? p.nome : '');
          aviso('Relatório restaurado.', 'sucesso', 3);
          sincronizarEmSegundoPlano();
          carregarHistorico();
        }
      });
      cont.appendChild(div);
    }
  }

  async function excluirRegistro(id) {
    const alvo = await DB.obterRelatorio(id);
    if (!alvo || !DB.ehMeu(alvo)) { aviso('Somente quem registrou o relatório pode excluí-lo.', 'alerta', 6); return; }
    const c = await confirmar('Excluir relatório?',
      'A exclusão é lógica: o relatório sai da lista, mas continua guardado com a trilha de auditoria.', true, 'Excluir');
    if (!c.ok) return;
    const p = AUTH.perfil();
    await DB.excluirRelatorio(id, c.valor, p ? p.nome : '');
    aviso('Relatório excluído (exclusão lógica registrada).', 'sucesso', 4);
    sincronizarEmSegundoPlano();
    await atualizarBadges();
    if (estado.tela === 'tela-detalhe') mostrarTela('tela-historico');
    else carregarHistorico();
  }

  async function exportarExcelLista() {
    const f = filtrosAtuais();
    const lista = await listaFiltrada();
    if (!lista.length) { aviso('Nenhum relatório no filtro atual.', 'alerta'); return; }
    carregando(true, 'Montando a planilha…');
    try {
      const csv = await DB.exportarCSV(Object.assign({}, f, {
        tipo: estado.chip && estado.chip !== 'NC' ? estado.chip : null,
        naoConformidade: estado.chip === 'NC' ? 'Sim' : null
      }));
      const r = await baixarTexto('RF-Materiais_' + hojeISO() + '.csv', csv, 'text/csv');
      if (r.modo !== 'fechado') aviso(lista.length + ' relatório(s) exportado(s) para a planilha.', 'sucesso', 5);
    } catch (e) {
      aviso('Falha ao exportar: ' + (e.message || e), 'erro', 0);
    } finally {
      carregando(false);
    }
  }

  /* ===================================================================
   * DETALHE
   * =================================================================== */
  async function abrirDetalhe(id) {
    const r = await DB.obterRelatorio(id);
    if (!r) { aviso('Relatório não encontrado.', 'erro'); return; }
    estado.detalheId = id;
    await garantirFotos(r);
    const fotos = await DB.listarFotos(id);
    const meu = DB.ehMeu(r);
    $('#btn-editar-detalhe').hidden = !meu || !!r.excluido;
    $('#btn-excluir-detalhe').hidden = !meu || !!r.excluido;
    const auditoria = await DB.listarAuditoria(id);
    const nc = r.naoConformidade === 'Sim';

    let html = '<div class="rf-det-cab"><span class="selo ' + (r.tipo === 'Saída' ? 'selo-saida' : 'selo-receb') + '">' +
               escapar(r.tipo).toUpperCase() + '</span>' + (nc ? '<span class="selo selo-nc">COM NÃO CONFORMIDADE</span>' : '<span class="selo selo-ok">Sem NC</span>') + '</div>';
    html += '<h1>' + escapar(r.numero || DB.numeroRelatorio(r)) + '</h1>';
    html += '<table class="tabela-detalhe"><tbody>';
    const linhas = [
      ['Projeto', DB.nomeProjeto(r)],
      ['Lote', CONFIG.rotuloLote(r.lote)],
      ['Data', dataBR(r.dataRelatorio)],
      ['Tipo', r.tipo],
      ['NF', r.nf],
      ['Fornecedor', r.fornecedor]
    ];
    if (r.tipo === 'Recebimento') linhas.push(['Canteiro', DB.nomeCanteiro(r)]);
    else linhas.push(['Transportadora', r.transportadora], ['Trecho', r.trecho], ['Torre', r.torre]);
    linhas.push(['Descrição do material', r.descricao]);
    if (r.observacoes) linhas.push(['Observações gerais', r.observacoes]);
    linhas.push(['Não conformidade', r.naoConformidade]);
    linhas.push(['Responsável', r.responsavel + (r.funcaoResponsavel ? ' (' + r.funcaoResponsavel + ')' : '')]);
    linhas.push(['Coordenadas', MAPA.temCoord(r)
      ? (r.latitude + ', ' + r.longitude + (r.precisaoGps ? ' (±' + r.precisaoGps + ' m)' : '') + (r.obsGeo === 'Ajustado no mapa' ? ' • ajustado no mapa' : ''))
      : (r.obsGeo || 'Não capturada')]);
    linhas.push(['Registrado em', dataBR(r.criadoEm)]);
    if ((r.versao || 1) > 1) linhas.push(['Última edição', dataBR(r.atualizadoEm) + ' (v' + (r.versao || 1) + ')']);
    if (SYNC.ativo()) linhas.push(['Base central', r.status === 'sincronizado' ? 'Sincronizado'
      : r.status === 'erro' ? 'Erro no envio — ' + (r.erroMsg || '') : 'Na fila de envio']);
    if (r.excluido) linhas.push(['Excluído em', dataBR(r.excluidoEm) + (r.motivoExclusao ? ' — ' + r.motivoExclusao : '')]);
    linhas.forEach(l => {
      const destaque = l[0] === 'Não conformidade' && l[1] === 'Sim';
      html += '<tr><th>' + escapar(l[0]) + '</th><td' + (destaque ? ' class="nc-sim"' : '') + '>' + escapar(l[1] || '—') + '</td></tr>';
    });
    html += '</tbody></table>';

    if (nc) {
      const fsNC = fotos.filter(f => f.vinculo);
      html += '<h2 style="margin-top:18px">Não conformidade</h2><div class="nc-card"><div class="nc-card-cab"><span class="nc-num">NC</span>' +
              '<span class="nc-item">' + escapar(r.tipo) + '</span></div>' +
              '<p class="nc-perg rf-pre">' + escapar(r.descricaoNC) + '</p>' +
              (fsNC.length ? '<div class="galeria">' + fsNC.map((f, i) => '<figure><img src="' + srcFoto(f) + '" alt="Foto da NC"><figcaption>NC ' + (i + 1) + (f.legenda ? ' — ' + escapar(f.legenda) : '') + '</figcaption></figure>').join('') + '</div>'
                           : '<p class="apoio pequena">Sem foto da não conformidade.</p>') + '</div>';
    }

    if (MAPA.temCoord(r)) {
      html += '<h2 style="margin-top:18px">Localização</h2>' +
        '<div class="mapa-box"><div id="mapa-detalhe" class="mapa"></div>' +
        '<div class="mapa-offline" hidden>Sem internet: o mapa aparece quando a conexão voltar.</div></div>' +
        '<a class="btn btn-secundario btn-mapa-google" target="_blank" rel="noopener" href="' + MAPA.linkGoogle(r.latitude, r.longitude) + '">Abrir no Google Maps</a>';
    }

    const gerais = fotos.filter(f => !f.vinculo).sort((a, b) => (a.slot || 0) - (b.slot || 0));
    html += '<h2 style="margin-top:18px">Registro fotográfico (' + gerais.length + ')</h2>';
    if (!gerais.length) html += '<p class="apoio pequena">' + (r.fotosRemotas && r.fotosRemotas.length && !navigator.onLine
      ? 'As fotos estão na base central e aparecem quando houver internet.' : 'Nenhuma foto anexada.') + '</p>';
    else {
      html += '<div class="galeria rf-galeria">';
      gerais.forEach(f => {
        html += '<figure><img src="' + srcFoto(f) + '" alt="Foto ' + f.slot + '"><figcaption><b>Foto ' + (f.slot || '') + '</b>' +
                (f.legenda ? ' — ' + escapar(f.legenda) : '') + '</figcaption></figure>';
      });
      html += '</div>';
    }

    html += '<details class="rf-auditoria"><summary>Auditoria (' + auditoria.length + ')</summary><div class="lista-log">';
    auditoria.forEach(a => {
      html += '<div class="log-item"><b>' + escapar(a.acao) + '</b> — ' + escapar(a.detalhe) +
              '<span class="quando">' + dataBR(a.em) + ' • ' + escapar(a.usuario) + '</span></div>';
    });
    html += '</div></details>';

    $('#detalhe-conteudo').innerHTML = html;
    mostrarTela('tela-detalhe');
    if (window.MAPA) MAPA.detalhe(document.getElementById('mapa-detalhe'), r, nc);
  }

  /* ===================================================================
   * PDF
   * =================================================================== */
  async function gerarPdfIndividual(id) {
    carregando(true, 'Montando o PDF…');
    try {
      const reg = await DB.obterRelatorio(id);
      if (reg) await garantirFotos(reg);
      avisoEntrega(await PDFGEN.gerarIndividual(id));
    } catch (e) {
      aviso('Falha ao gerar o PDF: ' + (e.message || e), 'erro', 0);
    } finally {
      carregando(false);
    }
  }

  /** Relatório recebido da base (ou foto perdida no aparelho): baixa o que falta. */
  async function garantirFotos(reg) {
    if (!SYNC.ativo() || !reg || !Array.isArray(reg.fotosRemotas) || !reg.fotosRemotas.length) return;
    const temLocal = (await DB.listarFotos(reg.id)).filter(f => !f.indisponivel).length;
    if (temLocal >= reg.fotosRemotas.length || !navigator.onLine) return;
    try { await SYNC.baixarFotos(reg); } catch (e) { /* segue sem as fotos */ }
  }

  async function gerarPdfConsolidadoLista() {
    const lista = await listaFiltrada();
    if (!lista.length) { aviso('Nenhum relatório no filtro atual.', 'alerta'); return; }
    await gerarConsolidado(lista, descreverFiltros(filtrosAtuais()));
  }

  async function gerarConsolidado(lista, desc) {
    carregando(true, 'Montando o consolidado (' + lista.length + ' relatórios)…');
    try {
      for (const reg of lista) await garantirFotos(reg);
      avisoEntrega(await PDFGEN.gerarConsolidado(lista, desc));
    } catch (e) {
      aviso('Falha ao gerar o PDF: ' + (e.message || e), 'erro', 0);
    } finally {
      carregando(false);
    }
  }

  /* ===================================================================
   * EXPORTAÇÃO
   * =================================================================== */
  function periodoExportacao() {
    const hoje = new Date();
    const fim = hojeISO();
    const tipo = $('#exp-periodo').value;
    const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    if (tipo === 'mes') return { de: fim.slice(0, 8) + '01', ate: fim, rotulo: 'mês atual' };
    if (tipo === 'anterior') return { de: iso(new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1)),
                                      ate: iso(new Date(hoje.getFullYear(), hoje.getMonth(), 0)), rotulo: 'mês anterior' };
    if (tipo === 'ano') return { de: fim.slice(0, 4) + '-01-01', ate: fim, rotulo: 'ano corrente' };
    if (tipo === 'tudo') return { de: null, ate: null, rotulo: 'histórico completo' };
    return { de: $('#exp-de').value || null, ate: $('#exp-ate').value || null, rotulo: 'período personalizado' };
  }

  async function atualizarTelaSync() {
    await atualizarBadges();
    $('#exp-custom').hidden = ($('#exp-periodo').value !== 'custom');
    const p = periodoExportacao();
    const lista = await DB.listarRelatorios({ de: p.de, ate: p.ate });
    const nc = lista.filter(r => r.naoConformidade === 'Sim').length;
    $('#exp-resumo').textContent = lista.length
      ? (lista.length + ' relatório(s) no ' + p.rotulo + (p.de ? ' (' + dataBR(p.de) + ' a ' + dataBR(p.ate) + ')' : '') +
         ' • ' + nc + ' com não conformidade')
      : ('Nenhum relatório no ' + p.rotulo + '.');
    verificarArmazenamento(true);
    const base = SYNC.ativo();
    $('#cartao-base').hidden = !base;
    $('#apoio-exportar').textContent = base
      ? 'Os relatórios ficam no aparelho e na base central. Use a planilha para o controle e o PDF consolidado para o dossiê.'
      : 'Os relatórios ficam guardados neste aparelho. Use a planilha para o controle e o PDF consolidado para o dossiê.';
    if (base) {
      const pend = await DB.listarPendentes();
      const erros = pend.filter(r => r.status === 'erro');
      $('#n-fila').textContent = pend.length - erros.length;
      $('#n-erros').textContent = erros.length;
      const ult = await SYNC.ultimaSincronizacao();
      $('#n-ultima').textContent = ult ? new Date(ult).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—';
      const txt = $('#txt-sync-erro');
      const msg = SYNC.baseSemTabela() ? 'A base central ainda não tem a estrutura do app (o administrador precisa rodar banco/01-estrutura.sql). Os relatórios seguem salvos no aparelho.'
        : erros.length ? erros[0].erroMsg : (estado.ultimoResumo && estado.ultimoResumo.erro) || '';
      txt.hidden = !msg;
      txt.textContent = msg ? 'Atenção: ' + msg : '';
    }
  }

  async function exportarPlanilha() {
    const p = periodoExportacao();
    const lista = await DB.listarRelatorios({ de: p.de, ate: p.ate });
    if (!lista.length) { aviso('Nenhum relatório no período escolhido.', 'alerta', 6); return; }
    carregando(true, 'Montando a planilha…');
    try {
      const csv = await DB.exportarCSV({ de: p.de, ate: p.ate });
      const carimbo = p.de ? p.de.slice(0, 7).replace('-', '') : 'completo';
      const r = await baixarTexto('RF-Materiais_' + carimbo + '.csv', csv, 'text/csv');
      if (r.modo !== 'fechado') aviso(lista.length + ' relatório(s) exportado(s) para a planilha.', 'sucesso', 5);
    } catch (e) {
      aviso('Falha ao exportar: ' + (e.message || e), 'erro', 0);
    } finally {
      carregando(false);
    }
  }

  async function exportarPdfPeriodo() {
    const p = periodoExportacao();
    const lista = await DB.listarRelatorios({ de: p.de, ate: p.ate });
    if (!lista.length) { aviso('Nenhum relatório no período escolhido.', 'alerta', 6); return; }
    await gerarConsolidado(lista, p.de ? ('Período: ' + dataBR(p.de) + ' a ' + dataBR(p.ate)) : 'Histórico completo');
  }

  async function exportarBackupJSON() {
    carregando(true, 'Gerando o backup…');
    try {
      const carimbo = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const r = await baixarTexto('RF-Materiais_backup_' + carimbo + '.json', await DB.exportarJSON(), 'application/json');
      if (r.modo !== 'fechado') aviso('Backup completo gerado (inclui as fotos).', 'sucesso', 5);
    } catch (e) {
      aviso('Falha ao exportar: ' + (e.message || e), 'erro', 0);
    } finally {
      carregando(false);
    }
  }

  /* ===================================================================
   * TELA "MAIS" — CONTA
   * =================================================================== */
  function montarTelaMais() {
    const p = AUTH.perfil();
    const est = AUTH.estado();
    $('#conta-nome').textContent = p ? p.nome : '—';
    $('#conta-email').textContent = p ? p.email : '—';
    $('#conta-funcao').textContent = p ? p.funcao : '—';
    $('#conta-lotes').textContent = est.lotes.length ? est.lotes.join(', ') : 'nenhum';
    $('#conta-perfil').textContent = est.ehAdmin ? 'Administrador (vê todos os relatórios e libera acessos)'
      : AUTH.veTodas() ? 'Visualiza todos os relatórios dos seus lotes' : 'Visualiza somente os próprios relatórios';
    $('#conta-sessao').textContent = AUTH.modoLocal() ? 'conta deste aparelho — não expira'
      : 'vale ' + CONFIG.auth.diasSessaoOffline + ' dias sem internet';
    $('#cartao-admin-atalho').hidden = !est.ehAdmin;
    $('#txt-sobre').textContent = CONFIG.app.nome + ' • versão ' + CONFIG.app.versao +
      (AUTH.modoLocal() ? ' • modo local (sem base central)' : ' • base central ativa');
    verificarLiberacoes();
  }

  /* ===================================================================
   * ADMINISTRAÇÃO — LIBERAÇÕES DE ACESSO
   * =================================================================== */
  async function carregarUsuarios() {
    if (!AUTH.ehAdmin()) { aviso('Área restrita ao administrador.', 'erro', 5); mostrarTela('tela-boasvindas'); return; }
    const cont = $('#lista-usuarios');
    cont.innerHTML = '<div class="vazio">Carregando…</div>';
    try {
      const [lista, base] = await Promise.all([AUTH.admin.listar(), AUTH.admin.baseDeAcessos()]);
      estado.usuarios = lista;
      estado.baseAcessos = Array.isArray(base) ? base : [];
      desenharUsuarios(lista);
      verificarLiberacoes();
    } catch (e) {
      cont.innerHTML = '<div class="vazio">Não foi possível carregar a lista.<br>' + escapar(e.message || e) +
                       (AUTH.modoLocal() ? '' : '<br><small>Esta tela precisa de internet.</small>') + '</div>';
    }
  }

  function grupoStatus(st) { return st === 'pendente' ? 'pendente' : st === 'ativo' ? 'ativo' : 'bloqueado'; }

  function desenharUsuarios(lista) {
    const cont = $('#lista-usuarios');
    cont.innerHTML = '';
    const limite = Date.now() - 7 * 86400000;
    $('#ad-pendentes').textContent = lista.filter(u => u.status === 'pendente').length;
    $('#ad-ativos').textContent = lista.filter(u => u.status === 'ativo').length;
    $('#ad-aparelhos').textContent = lista.filter(u => u.ultimo_acesso && new Date(u.ultimo_acesso).getTime() >= limite).length;
    $$('[data-filtro-lib]').forEach(b => b.classList.toggle('ativa', b.dataset.filtroLib === estado.filtroLib));
    const filtrada = estado.filtroLib === 'todos' ? lista : lista.filter(u => grupoStatus(u.status) === estado.filtroLib);
    if (!filtrada.length) {
      cont.innerHTML = '<div class="vazio">' + (estado.filtroLib === 'pendente'
        ? 'Nenhum cadastro aguardando liberação.' : 'Nenhum usuário nesta situação.') + '</div>';
      return;
    }
    const ordenada = filtrada.slice().sort((a, b) => {
      const peso = s => (s === 'pendente' ? 0 : s === 'ativo' ? 1 : 2);
      return peso(a.status) - peso(b.status) || String(a.nome).localeCompare(String(b.nome), 'pt-BR');
    });
    const eu = AUTH.usuarioId();
    ordenada.forEach(u => {
      const div = document.createElement('div');
      div.className = 'item usuario-item' + (u.status === 'pendente' ? ' pendente' : '');
      const seloStatus = u.status === 'ativo' ? 'selo-ok' : u.status === 'pendente' ? 'selo-cinza' : 'selo-nc';
      const rotStatus = { ativo: 'LIBERADO', pendente: 'AGUARDANDO', recusado: 'RECUSADO', inativo: 'INATIVO' }[u.status] || String(u.status).toUpperCase();
      const ehEu = u.id === eu;
      const ehAdm = u.perfil === 'admin';
      const ref = estado.baseAcessos.find(b => String(b.email).toLowerCase() === String(u.email).toLowerCase());
      const lotesPadrao = u.status === 'pendente' && ref && (ref.lotes || []).length ? ref.lotes : (u.lotes || []);
      const visaoPadrao = u.status === 'pendente' && ref ? (ref.visao || 'proprias') : (u.visao || 'proprias');
      let quadroBase = '';
      if (u.status === 'pendente') {
        quadroBase = ref
          ? '<div class="lib-base">Consta na base de acessos como <b>' + escapar(ref.funcao || '—') + '</b> • lotes ' +
            escapar((ref.lotes || []).join(', ') || '—') + ' • ' + (ref.visao === 'todas' ? 'vê todos os relatórios' : 'vê só os próprios') +
            '. Já pré-preenchido abaixo.</div>'
          : '<div class="lib-base sem-base">Este e-mail <b>não consta</b> na base de acessos. Confira com quem é antes de liberar.</div>';
      }
      div.innerHTML =
        '<div class="topo"><div><span class="data">' + escapar(u.nome) + '</span>' +
          (ehAdm ? ' <span class="selo selo-ok">ADMIN</span>' : '') +
          '<div class="email">' + escapar(u.email) + '</div></div>' +
          '<span class="selo ' + seloStatus + '">' + escapar(rotStatus) + '</span></div>' +
        '<div class="linha3">' + escapar(u.funcao || '—') + ' • cadastro: ' + (u.criado_em ? dataBR(u.criado_em) : '—') + '</div>' +
        (u.status === 'ativo' ? situacaoEnvio(u) : '') + quadroBase +
        (ehAdm
          ? '<div class="linha3">Administrador: vê todos os relatórios de todos os lotes e libera acessos.</div>'
          : '<div class="lib-grade">' +
              '<div><div class="rotulo">Lotes liberados</div><div class="lista-check" data-lotes></div></div>' +
              '<label><div class="rotulo">O que pode visualizar</div><select data-visao>' +
                '<option value="proprias"' + (visaoPadrao !== 'todas' ? ' selected' : '') + '>Somente os próprios relatórios</option>' +
                '<option value="todas"' + (visaoPadrao === 'todas' ? ' selected' : '') + '>Todos os relatórios dos seus lotes</option>' +
              '</select></label></div>') +
        '<div class="acoes-item">' +
          (u.status === 'pendente'
            ? '<button type="button" class="btn btn-primario" data-acao="aprovar">Liberar acesso</button>' +
              '<button type="button" class="btn btn-neutro" data-acao="recusar">Recusar</button>' : '') +
          (u.status === 'ativo' && !ehAdm
            ? '<button type="button" class="btn btn-secundario" data-acao="salvar-acesso">Salvar alterações</button>' +
              '<button type="button" class="btn btn-neutro" data-acao="desativar">Bloquear acesso</button>' : '') +
          ((u.status === 'inativo' || u.status === 'recusado') && !ehEu
            ? '<button type="button" class="btn btn-primario" data-acao="reativar">Liberar novamente</button>' : '') +
        '</div>';
      const cxLotes = div.querySelector('[data-lotes]');
      if (cxLotes) {
        CONFIG.listarLotes().forEach(l => {
          const lab = document.createElement('label');
          const marcado = lotesPadrao.indexOf(l) !== -1;
          lab.innerHTML = '<input type="checkbox" value="' + l + '"' + (marcado ? ' checked' : '') + '><span>' + CONFIG.rotuloLote(l) + '</span>';
          if (marcado) lab.classList.add('marcado');
          lab.querySelector('input').addEventListener('change', (e) => lab.classList.toggle('marcado', e.target.checked));
          cxLotes.appendChild(lab);
        });
      }
      div.addEventListener('click', async (ev) => {
        const acao = ev.target && ev.target.dataset ? ev.target.dataset.acao : null;
        if (!acao) return;
        ev.stopPropagation();
        const lotes = cxLotes ? Array.prototype.slice.call(cxLotes.querySelectorAll('input:checked')).map(i => i.value) : [];
        const sel = div.querySelector('[data-visao]');
        await acaoAdmin(acao, u, lotes, sel ? sel.value : 'proprias');
      });
      cont.appendChild(div);
    });
  }

  function situacaoEnvio(u) {
    const ult = u.ultimo_acesso ? new Date(u.ultimo_acesso) : null;
    const horas = ult ? (Date.now() - ult.getTime()) / 3600000 : null;
    const pend = Number(u.pendentes_envio || 0);
    let quando = 'nunca conectou';
    if (ult) quando = horas < 1 ? 'há ' + Math.max(1, Math.round(horas * 60)) + ' min'
                   : horas < 48 ? 'há ' + Math.round(horas) + ' h' : 'há ' + Math.round(horas / 24) + ' dias';
    const alerta = pend > 0 && (horas === null || horas > 24);
    const cls = alerta ? 'envio-alerta' : (pend > 0 ? 'envio-pend' : 'envio-ok');
    return '<div class="envio-situacao ' + cls + '"><i></i>Última conexão: <b>' + quando + '</b>' +
      (pend > 0 ? ' • <b>' + pend + '</b> relatório' + (pend === 1 ? '' : 's') + ' aguardando envio no aparelho'
                : ' • nada pendente no aparelho') + '</div>';
  }

  async function acaoAdmin(acao, u, lotes, visao) {
    const descVisao = visao === 'todas' ? 'todos os relatórios dos lotes' : 'somente os próprios relatórios';
    const rotulos = {
      aprovar: 'Liberar o acesso de ' + u.nome + ' aos lotes ' + lotes.join(', ') + ', visualizando ' + descVisao + '?',
      recusar: 'Recusar o cadastro de ' + u.nome + '? A pessoa não conseguirá entrar no app.',
      desativar: 'Bloquear o acesso de ' + u.nome + '? Ele perde o acesso na próxima sincronização.',
      reativar: 'Liberar novamente o acesso de ' + u.nome + '?',
      'salvar-acesso': 'Salvar para ' + u.nome + ': lotes ' + lotes.join(', ') + ' e visão de ' + descVisao + '?'
    };
    if ((acao === 'aprovar' || acao === 'salvar-acesso' || acao === 'reativar') && u.perfil !== 'admin' && !lotes.length) {
      aviso('Marque ao menos um lote antes de liberar.', 'alerta', 8);
      return;
    }
    const c = await confirmar('Confirmar', rotulos[acao] || 'Confirmar ação?', false, 'Confirmar');
    if (!c.ok) return;
    carregando(true, 'Aplicando…');
    try {
      if (acao === 'aprovar' || acao === 'reativar') await AUTH.admin.aprovar(u.id, lotes, visao);
      if (acao === 'recusar') await AUTH.admin.recusar(u.id);
      if (acao === 'desativar') await AUTH.admin.desativar(u.id);
      if (acao === 'salvar-acesso') await AUTH.admin.definirAcesso(u.id, lotes, visao);
      aviso(acao === 'aprovar' ? 'Acesso liberado. ' + u.nome.split(' ')[0] + ' já pode entrar no app.' : 'Alteração aplicada.', 'sucesso', 5);
      estado.pendentesAvisados = null;
      await carregarUsuarios();
    } catch (e) {
      aviso('Falha: ' + (e.message || e), 'erro', 10);
    } finally {
      carregando(false);
    }
  }

  /* ===================================================================
   * EVENTOS
   * =================================================================== */
  function ligarEventos() {
    $$('.nav-item').forEach(b => b.addEventListener('click', () => {
      if (b.dataset.ir === 'tela-nova') abrirAbaNovo();
      else mostrarTela(b.dataset.ir);
    }));
    $('#badge-rede').addEventListener('click', () => mostrarTela('tela-sync'));

    // Acesso
    $('#btn-login').addEventListener('click', fazerLogin);
    $('#login-senha').addEventListener('keydown', e => { if (e.key === 'Enter') fazerLogin(); });
    $('#link-cadastro').addEventListener('click', () => { mostrarTela('tela-cadastro'); atualizarAvisosDeRede(); });
    $('#link-esqueci').addEventListener('click', () => { mostrarTela('tela-recuperar'); atualizarAvisosDeRede(); });
    $('#voltar-login-1').addEventListener('click', () => mostrarTela('tela-login'));
    $('#voltar-login-2').addEventListener('click', () => mostrarTela('tela-login'));
    $('#btn-cadastrar').addEventListener('click', fazerCadastro);
    $('#btn-recuperar').addEventListener('click', fazerRecuperacao);
    $('#btn-sair').addEventListener('click', sairDaConta);
    $('#btn-abrir-admin').addEventListener('click', () => mostrarTela('tela-admin'));
    $('#btn-recarregar-usuarios').addEventListener('click', carregarUsuarios);
    $('#btn-bv-liberacoes').addEventListener('click', () => { estado.filtroLib = 'pendente'; mostrarTela('tela-admin'); });
    $$('[data-novo-tipo]').forEach(b => b.addEventListener('click', () => novoRelatorio(b.dataset.novoTipo)));
    $('#btn-bv-historico').addEventListener('click', () => mostrarTela('tela-historico'));
    $('#btn-sincronizar').addEventListener('click', sincronizarAgora);
    $('#btn-faixa-enviar').addEventListener('click', sincronizarAgora);
    $$('[data-filtro-lib]').forEach(b => b.addEventListener('click', () => {
      estado.filtroLib = b.dataset.filtroLib;
      desenharUsuarios(estado.usuarios || []);
    }));
    $$('.btn-olho').forEach(b => b.addEventListener('click', () => alternarSenha(b)));
    $('#cad-funcao').addEventListener('change', () => { $('#campo-cad-funcao-outro').hidden = ($('#cad-funcao').value !== 'Outro'); });
    $$('.aba[data-so]').forEach(b => b.addEventListener('click', () => {
      $$('.aba[data-so]').forEach(x => x.classList.toggle('ativa', x === b));
      $$('.aba-conteudo').forEach(c => { c.hidden = (c.dataset.so !== b.dataset.so); });
    }));
    $$('.aba[data-so2]').forEach(b => b.addEventListener('click', () => {
      $$('.aba[data-so2]').forEach(x => x.classList.toggle('ativa', x === b));
      $$('.aba-conteudo2').forEach(c => { c.hidden = (c.dataset.so2 !== b.dataset.so2); });
    }));

    // Formulário
    $('#f-projeto').addEventListener('change', () => { $('#campo-projeto-outro').hidden = $('#f-projeto').value !== 'Outro'; });
    $('#f-lote').addEventListener('change', () => aoMudarLote());
    $('#f-data').addEventListener('change', atualizarNumero);
    $('#f-canteiro').addEventListener('change', () => { $('#campo-canteiro-outro').hidden = $('#f-canteiro').value !== 'Outro'; });
    $$('input[name=tipo]').forEach(r => r.addEventListener('change', aplicarTipo));
    $$('input[name=nc]').forEach(r => r.addEventListener('change', () => {
      aplicarNC();
      if (ncEscolhida() === 'Sim') setTimeout(() => $('#f-descricao-nc').focus(), 60);
    }));
    $('#form-relatorio').addEventListener('submit', salvarFormulario);
    $('#btn-cancelar').addEventListener('click', cancelarFormulario);
    $('#in-camera').addEventListener('change', e => { adicionarArquivos(e.target.files, { slot: estado.slotAlvo }); e.target.value = ''; });
    $('#in-galeria').addEventListener('change', e => { adicionarArquivos(e.target.files, { slot: estado.slotAlvo }); e.target.value = ''; });
    $('#btn-nc-camera').addEventListener('click', () => $('#in-nc-camera').click());
    $('#btn-nc-galeria').addEventListener('click', () => $('#in-nc-galeria').click());
    ['#in-nc-camera', '#in-nc-galeria'].forEach(sel => $(sel).addEventListener('change', e => {
      adicionarArquivos(e.target.files, { vinculo: { tipo: 'nc' } }); e.target.value = '';
    }));
    $('#btn-geo').addEventListener('click', () => iniciarGPS());

    // Lista
    $$('[data-chip]').forEach(b => b.addEventListener('click', () => { estado.chip = b.dataset.chip; carregarHistorico(); }));
    ['#h-de', '#h-ate', '#h-lote', '#h-excluidos'].forEach(s => $(s).addEventListener('change', carregarHistorico));
    let temporizador = null;
    $('#h-texto').addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(carregarHistorico, 250); });
    $('#btn-limpar-filtros').addEventListener('click', () => {
      ['#h-de', '#h-ate', '#h-texto', '#h-lote'].forEach(s => { $(s).value = ''; });
      $('#h-excluidos').checked = false;
      estado.chip = '';
      carregarHistorico();
    });
    $('#btn-pdf-consolidado').addEventListener('click', gerarPdfConsolidadoLista);
    $('#btn-excel-historico').addEventListener('click', exportarExcelLista);

    // Detalhe
    $('#btn-voltar-detalhe').addEventListener('click', () => mostrarTela('tela-historico'));
    $('#btn-editar-detalhe').addEventListener('click', () => editarRelatorio(estado.detalheId));
    $('#btn-excluir-detalhe').addEventListener('click', () => excluirRegistro(estado.detalheId));
    $('#btn-pdf-detalhe').addEventListener('click', () => gerarPdfIndividual(estado.detalheId));

    // Exportação
    $('#exp-periodo').addEventListener('change', atualizarTelaSync);
    ['#exp-de', '#exp-ate'].forEach(s => $(s).addEventListener('change', atualizarTelaSync));
    $('#btn-exp-planilha').addEventListener('click', exportarPlanilha);
    $('#btn-exp-pdf').addEventListener('click', exportarPdfPeriodo);
    $('#btn-exp-json').addEventListener('click', exportarBackupJSON);
    $('#btn-limpar-base').addEventListener('click', async () => {
      const c = await confirmar('Apagar TODA a base local?',
        'Todos os relatórios e fotos deste aparelho serão apagados, inclusive os ainda não sincronizados. Digite APAGAR para confirmar.', true, 'Apagar tudo');
      if (!c.ok) return;
      if (c.valor.toUpperCase() !== 'APAGAR') { aviso('Confirmação incorreta. Nada foi apagado.', 'alerta'); return; }
      await DB.limparTudo();
      estado.registro = null;
      aviso('Base local apagada.', 'sucesso');
      atualizarTelaSync();
    });

    // Rede
    window.addEventListener('online', () => {
      atualizarAvisosDeRede(); atualizarBadges();
      if (AUTH.autenticado()) aviso('Conexão restabelecida.' + (SYNC.ativo() ? ' Sincronizando…' : ''), 'sucesso', 4);
    });
    window.addEventListener('offline', () => {
      atualizarAvisosDeRede(); atualizarBadges();
      if (AUTH.autenticado()) aviso('Sem conexão. Os relatórios continuam sendo gravados no aparelho.', 'alerta', 5);
    });
    window.addEventListener('resize', () => { if (window.MAPA) MAPA.redimensionar(); });
    document.addEventListener('visibilitychange', () => {
      // GPS só roda com o formulário na frente (economiza bateria)
      if (document.visibilityState !== 'visible') { if (estado.tela === 'tela-nova') salvarLegendasPendentes(); pararGPS(); }
      else if (estado.tela === 'tela-nova' && estado.registro && !estado.registro.ajusteManual && estado.ehNovo) iniciarGPS();
    });

    AUTH.aoMudar((est) => {
      if (!est.autenticado && TELAS_PUBLICAS.indexOf(estado.tela) === -1) mostrarTela('tela-login');
    });

    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      estado.promptInstalacao = e;
      $('#btn-instalar').hidden = false;
    });
    $('#btn-instalar').addEventListener('click', async () => {
      if (!estado.promptInstalacao) return;
      estado.promptInstalacao.prompt();
      await estado.promptInstalacao.userChoice;
      estado.promptInstalacao = null;
      $('#btn-instalar').hidden = true;
    });
    window.addEventListener('beforeunload', (e) => {
      if (estado.tela === 'tela-nova' && !estado.salvo && estado.qtdFotosGerais) { e.preventDefault(); e.returnValue = ''; }
    });
  }

  function registrarServiceWorker() {
    if (!('serviceWorker' in navigator)) return;
    window.addEventListener('load', () => {
      let recarregou = false;
      const tinhaControle = !!navigator.serviceWorker.controller;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!tinhaControle || recarregou) return;
        if (estado.tela === 'tela-nova' && !estado.salvo && estado.qtdFotosGerais) {
          aviso('Nova versão instalada. Salve o relatório e reabra o app para atualizar.', 'alerta', 10);
          return;
        }
        recarregou = true;
        window.location.reload();
      });
      navigator.serviceWorker.register('service-worker.js', { updateViaCache: 'none' })
        .then(reg => {
          reg.update().catch(() => {});
          reg.addEventListener('updatefound', () => {
            const novo = reg.installing;
            if (!novo) return;
            novo.addEventListener('statechange', () => {
              if (novo.state === 'installed' && navigator.serviceWorker.controller) {
                aviso('Nova versão disponível. Feche e abra o aplicativo para atualizar.', 'alerta', 10);
              }
            });
          });
        })
        .catch(err => console.warn('Service Worker não registrado:', err));
    });
  }

  /* ===================================================================
   * INICIALIZAÇÃO
   * =================================================================== */
  async function iniciar() {
    document.title = CONFIG.app.nome;
    registrarServiceWorker();
    ligarEventos();
    preencherSelect($('#cad-funcao'), CONFIG.auth.funcoes, 'Selecione…');
    montarLotesCadastro();
    atualizarAvisosDeRede();

    try { await DB.db.open(); }
    catch (e) {
      aviso('Não foi possível abrir o banco local: ' + (e.message || e) + '. Em janelas anônimas o armazenamento é bloqueado.', 'erro', 0);
    }

    const veioDaConfirmacao = /type=signup|access_token=/.test(window.location.hash);
    if (window.location.hash) history.replaceState(null, '', window.location.pathname);

    await AUTH.iniciar();
    SYNC.aoMudar(aoMudarSync);

    if (AUTH.autenticado()) {
      $('#login-email').value = AUTH.estado().emailUltimaConta || '';
      await aoAutenticar();
    } else {
      const est = AUTH.estado();
      if (est.emailUltimaConta) $('#login-email').value = est.emailUltimaConta;
      const so = /iPhone|iPad|iPod/i.test(UA) ? 'ios' : /Android/i.test(UA) ? 'android' : 'desktop';
      const aba = $$('.aba[data-so]').filter(b => b.dataset.so === so)[0];
      if (aba) aba.click();
      mostrarTela('tela-login');
      if (est.sessaoLocalEncerrada) {
        aviso('O app agora usa a base central da EDP. Entre novamente com seu e-mail e senha — os relatórios ' +
              'já salvos neste aparelho serão mantidos e enviados. Se ainda não tem cadastro na base, toque em "Criar cadastro".', 'alerta', 0);
      }
      if (veioDaConfirmacao) aviso('E-mail confirmado. Entre com seu e-mail e senha.', 'sucesso', 10);
    }

    setInterval(atualizarBadges, 15000);
    setInterval(() => { if (document.visibilityState === 'visible') verificarLiberacoes(); }, 60000);
  }

  return {
    iniciar: iniciar,
    estado: estado,
    confirmar: confirmar,
    aviso: aviso,
    carregando: carregando,
    mostrarTela: mostrarTela,
    escapar: escapar,
    entregarArquivo: entregarArquivo,
    avisoEntrega: avisoEntrega,
    abrirRelatorio: abrirDetalhe,
    novoRelatorio: novoRelatorio
  };
})();

document.addEventListener('DOMContentLoaded', APP.iniciar);
window.APP = APP;
