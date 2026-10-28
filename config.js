/* =====================================================================
 * config.js — ARQUIVO ÚNICO DE PARAMETRIZAÇÃO
 * ---------------------------------------------------------------------
 * Relatório Fotográfico de Materiais | EDP TRANSMISSÃO CONSTRUÇÃO
 *
 * É o único arquivo que precisa ser alterado no dia a dia:
 *   1) Projetos por lote, lotes e canteiros
 *   2) Sugestões de fornecedores e transportadoras
 *   3) Limites operacionais (fotos, compressão, GPS)
 *
 * Não é necessário mexer em app.js, auth.js, db.js ou pdf.js para
 * incluir um projeto, um canteiro, um fornecedor ou um lote.
 * ===================================================================== */

const CONFIG = {

  /* -------------------------------------------------------------------
   * 1. IDENTIFICAÇÃO DA APLICAÇÃO
   * ----------------------------------------------------------------- */
  app: {
    nome: 'Relatório Fotográfico de Materiais | EDP TRANSMISSÃO CONSTRUÇÃO',
    nomeCurto: 'RF Materiais',
    titulo: 'Relatório Fotográfico de Materiais',
    obra: 'EDP TRANSMISSÃO CONSTRUÇÃO',
    empresa: 'EDP TRANSMISSÃO CONSTRUÇÃO',
    versao: '1.1.0',
    logoOficialNoPacote: true
  },

  /* -------------------------------------------------------------------
   * 1.1 BASE CENTRAL (Supabase)
   * -------------------------------------------------------------------
   * Preencha "url" e "anonKey" com os dados do projeto do Supabase
   * deste app (Project Settings > API). A chave "anon" é pública por
   * natureza: quem protege os dados são as regras do banco
   * (banco/01-estrutura.sql). Enquanto estiver com os textos de
   * exemplo, o app funciona no modo local, sem base central.
   * NUNCA coloque aqui a chave service_role.
   * ----------------------------------------------------------------- */
  supabase: {
    url: 'https://tpciuxhgzkzvonzofmhs.supabase.co',
    anonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRwY2l1eGhnemt6dm9uem9mbWhzIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI0NTIyNzgsImV4cCI6MjEwODAyODI3OH0.gPXBOptd9IPmvvCVWILv6lQ9c6RSX3seLzAZCbeC53k',
    tabelaUsuarios: 'usuarios',
    tabelaRelatorios: 'relatorios',
    bucketFotos: 'fotos-materiais'
  },

  sync: {
    intervaloSegundos: 30,     // envio e recebimento automáticos com o app aberto
    maxTentativas: 5
  },

  /* -------------------------------------------------------------------
   * 2. ACESSO
   * ----------------------------------------------------------------- */
  auth: {
    diasSessaoOffline: 30,     // dias sem internet em que o login continua valendo
    minimoSenha: 8,            // com ao menos uma letra e um número
    funcoes: ['Analista', 'Almoxarife', 'Técnico', 'Inspetor', 'Consultor', 'Especialista', 'Gestor', 'Outro']
  },

  /* -------------------------------------------------------------------
   * 3. PROJETOS POR LOTE (lista fechada — padroniza os nomes)
   * -------------------------------------------------------------------
   * O campo "Nome do projeto" mostra só os projetos do lote escolhido.
   * Lote com um único projeto já vem preenchido.
   *
   * "sigla" compõe o número do relatório: RF-<SIGLA>-001, RF-<SIGLA>-002…
   * A numeração é sequencial POR PROJETO, começando em 001, e é definida
   * pela base central no envio (nunca repete entre aparelhos).
   *
   * ATENÇÃO: ao incluir/alterar projeto aqui, inclua/altere também na
   * tabela "projetos" do Supabase (banco/03-numeracao-projetos.sql), com
   * a MESMA sigla.
   * ----------------------------------------------------------------- */
  projetosPorLote: {
    'TN02': [
      { nome: 'LT 500 kV Colinas – Ribeiro Gonçalves C3', sigla: 'COL-RG-C3' }
    ],
    'TM05': [
      { nome: 'LT-230-KV-ITP-MAT', sigla: 'ITP-MAT' },
      { nome: 'LT-230-KV-MAT-FIR', sigla: 'MAT-FIR' }
    ],
    'TN07': [
      { nome: 'LT 230 kV Gilbués II', sigla: 'GIL-II' },
      { nome: 'LT 230 kV Formosa do Rio Preto - Dianópolis C1', sigla: 'FRP-DIA-C1' }
    ],
    'TN13': [
      { nome: 'LT 500 kV Colinas – Ribeiro Gonçalves C3', sigla: 'COL-RG-C3' }
    ]
  },

  /* -------------------------------------------------------------------
   * 4. LOTES E CANTEIROS
   * -------------------------------------------------------------------
   * Os canteiros aparecem no tipo "Recebimento", filtrados pelo lote.
   * A opção "Outro" é acrescentada automaticamente. Lote com
   * "canteiros: []" fica só com o "Outro".
   *
   * ATENÇÃO: o código do segundo lote é TM05 (com M), conforme a
   * planilha oficial da obra — o mesmo usado no app de Inspeções.
   * ----------------------------------------------------------------- */
  dominios: {
    'TN02': {
      canteiros: [
        'Canteiro COX - São João do Piauí',
        'Canteiro COX - São Francisco',
        'Canteiro COX - Paulistana',
        'Canteiro POWERCHINA - Canto do Buriti',
        'Canteiro POWERCHINA - Gurgueia',
        'Canteiro POWERCHINA - Flores',
        'Canteiro POWERCHINA - Ribeiro Gonçalves',
        'Canteiro FERNANDES - Curral Novo'
      ]
    },
    'TM05': {
      canteiros: [
        'Canteiro COX - Rubiataba',
        'Canteiro COX - Faina',
        'Canteiro COX - Itapirapuã',
        'Canteiro COX - Buriti de Goiás',
        'Canteiro COX - São Luís de Montes Belos',
        'Canteiro CEL ENGENHARIA - Matrinchã'
      ]
    },
    'TN07': {
      canteiros: []
    },
    'TN13': {
      canteiros: [
        'HUB Logístico Ribeiro Gonçalves (HUB RBG)',
        'Canteiro COX - Ribeiro Gonçalves',
        'Canteiro COX - Balsas',
        'Canteiro COX - Carolina',
        'Canteiro COX - Goiatins',
        'Canteiro COX - Colinas',
        'Canteiro FERNANDES - Colinas'
      ]
    }
  },

  /* -------------------------------------------------------------------
   * 5. SUGESTÕES (o campo continua livre; o app também aprende com o
   *    que já foi digitado nos relatórios anteriores)
   * ----------------------------------------------------------------- */
  sugestoes: {
    fornecedores: ['Brametal'],
    transportadoras: ['TDM Transporte']
  },

  /* -------------------------------------------------------------------
   * 6. TIPOS DE RELATÓRIO (não altere os nomes: o banco confere)
   * ----------------------------------------------------------------- */
  tipos: ['Recebimento', 'Saída'],

  /* -------------------------------------------------------------------
   * 7. LIMITES OPERACIONAIS
   * ----------------------------------------------------------------- */
  limites: {
    fotosRelatorio: 6,         // espaços de foto do relatório (cada um com observação)
    fotosNC: 6,                // fotos da não conformidade
    fotoLadoMaior: 1600,
    fotoAlvoBytes: 300 * 1024,
    fotoQualidadeInicial: 0.82,
    fotoQualidadeMinima: 0.40,
    alertaArmazenamentoPct: 80,
    timeoutGeolocalizacaoMs: 10000
  },

  /* -------------------------------------------------------------------
   * 8. IDENTIDADE VISUAL (espelha o styles.css e alimenta o PDF)
   * ----------------------------------------------------------------- */
  cores: {
    azulMarinho:  '#1A1F2E',
    cabecalho:    '#12373D',
    fundo:        '#F4F7F9',
    cartao:       '#FFFFFF',
    verdeAgua:    '#26A69A',
    verdeVivo:    '#32D74B',
    texto:        '#1A1F2E',
    textoApoio:   '#5A6672',
    borda:        '#DDE3E8',
    conforme:     '#2E7D32',
    naoConforme:  '#C62828',
    pendente:     '#F9A825',
    recebimento:  '#1F7A8C',
    saida:        '#B26A00'
  }
};

/* ---------------------------------------------------------------------
 * FUNÇÕES AUXILIARES DE DOMÍNIO
 * ------------------------------------------------------------------- */

/** Todos os códigos de lote cadastrados. */
CONFIG.listarLotes = function () {
  return Object.keys(CONFIG.dominios);
};

/** Lotes que o usuário pode usar (administrador: todos). */
CONFIG.lotesPermitidos = function (lotesDoUsuario, ehAdmin) {
  const todos = CONFIG.listarLotes();
  if (ehAdmin) return todos;
  if (!Array.isArray(lotesDoUsuario) || !lotesDoUsuario.length) return [];
  return todos.filter(l => lotesDoUsuario.indexOf(l) !== -1);
};

/** Canteiros de um lote, na ordem do cadastro. */
CONFIG.listarCanteiros = function (lote) {
  if (!lote || !CONFIG.dominios[lote]) return [];
  return (CONFIG.dominios[lote].canteiros || []).slice();
};

/** Projetos (nomes) de um lote. */
CONFIG.listarProjetos = function (lote) {
  return ((CONFIG.projetosPorLote || {})[lote] || []).map(p => p.nome);
};

/** Sigla do projeto para o número do relatório ("OUT" se não cadastrado). */
CONFIG.siglaProjeto = function (nome) {
  const todos = Object.keys(CONFIG.projetosPorLote || {}).reduce((a, l) => a.concat(CONFIG.projetosPorLote[l]), []);
  const p = todos.filter(x => x.nome === nome)[0];
  return p ? p.sigla : 'OUT';
};

/** Número do relatório: RF-<SIGLA>-001. */
CONFIG.numeroFormatado = function (projeto, seq) {
  if (!seq) return '';
  return 'RF-' + CONFIG.siglaProjeto(projeto) + '-' + String(seq).padStart(3, '0');
};

/** Rótulo do lote nas telas e no PDF: somente a sigla. */
CONFIG.rotuloLote = function (lote) {
  return String(lote || '');
};

window.CONFIG = CONFIG;
