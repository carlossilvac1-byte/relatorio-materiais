# Ativar a base central (Supabase) — Relatório Fotográfico de Materiais v1.0.0

Tempo estimado: 15 minutos. Plano gratuito do Supabase atende (permite 2 projetos ativos).

> Use um **projeto novo**, separado do projeto do app de Inspeções. Assim os
> cadastros, as regras de acesso e as fotos de um app não interferem no outro.

## 1. Criar o projeto
1. Acesse https://supabase.com e entre com a mesma conta (GitHub).
2. **New project** → nome `rf-materiais`, região **South America (São Paulo)**,
   defina e guarde a senha do banco → **Create**.

## 2. Criar a estrutura e as regras de acesso
1. **SQL Editor** → **New query** → cole TODO o `banco/01-estrutura.sql` → **Run**.
   Deve terminar com "Success". Cria tabelas, regras (RLS), bucket `fotos-materiais`
   e liga o tempo real.
2. Nova query → cole `banco/02-base-de-acessos.sql` → **Run**.
   (É a planilha BASE_LOG: você como administrador; Victor no TN13; Claudemir em todos os lotes.)

3. (v1.1.0) Nova query → cole `banco/03-numeracao-projetos.sql` → **Run**.
   Cria a tabela de projetos por lote e a numeração sequencial por projeto
   (RF-<SIGLA>-001…), e numera os relatórios que já existem na ordem de criação.

4. (v1.2.0) Nova query → cole `banco/04-numero-manual.sql` → **Run**.
   Permite informar o "Nº do registro" no formulário (em branco continua automático).

5. (v1.3.0) Nova query → cole `banco/05-tipo-fabrica.sql` → **Run**.
   Libera o tipo **Fábrica** (saída de material na fábrica): fabricante, tipo de torre e peso da carga.

Os scripts podem ser rodados de novo sem problema.

## 3. Configurar o login
**Authentication → URL Configuration**
- Site URL: `https://carlossilvac1-byte.github.io/relatorio-materiais/`
- Redirect URLs: a mesma URL.

**Authentication → Providers → Email**: deixe **Confirm email** ligado.

## 4. Pegar as chaves
**Project Settings → API**: copie **Project URL** e a chave **anon public**.
**Nunca** use a chave *service_role* no app.

## 5. Ligar o app
Em `config.js`, bloco `supabase`, troque:
```js
url: 'https://SEUPROJETO.supabase.co',
anonKey: 'COLOQUE-AQUI-A-CHAVE-ANON',
```
pelos valores do passo 4 e publique `config.js` no GitHub.
Enquanto estiver com os textos de exemplo, o app funciona no **modo local**
(cada aparelho guarda os próprios relatórios).

## 6. Primeiro acesso
1. **Você se cadastra primeiro** com `carloseduardo.ribeiro@edp.com`. Confirme o e-mail e
   entre: o acesso já vem liberado como administrador.
2. Os colaboradores se cadastram pelo link do app e **não entram** até você liberar.
3. Na tela de boas-vindas aparece o aviso "cadastros aguardando sua liberação" →
   **Abrir liberações de acesso** → confira lotes e visão (já pré-preenchidos) → **Liberar acesso**.

## Regras garantidas pelo banco
- Cadastro novo nasce `pendente`; pendente não lê nem grava nada.
- Só o administrador altera status, perfil, lotes e visão de alguém.
- Ninguém grava relatório fora dos seus lotes, nem altera relatório de outra pessoa.
- Fotos ficam em bucket privado; cada um só baixa as fotos que pode ver.
- Relatórios não são apagados: a exclusão é lógica e toda edição gera histórico.

## Power BI
A visão `vw_relatorios` traz os relatórios ativos já com competência (mês), tipo,
NF, fornecedor, local e NC — pronta para conectar pelo conector PostgreSQL.
