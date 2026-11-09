-- =====================================================================
-- banco/05-tipo-fabrica.sql — TIPO "FÁBRICA" (saída de material na fábrica) v1.3.0
-- Relatório Fotográfico de Materiais | EDP Transmissão Construção
-- ---------------------------------------------------------------------
-- Rode DEPOIS do 03 e do 04. Pode rodar de novo sem problema.
--
-- Campos do tipo Fábrica:
--   fabricante ........ novo
--   tipo_torre ........ novo
--   descricao ......... (já existe) = descrição da carga
--   nf ................ (já existe) = nº da NF / romaneio
--   peso_carga ........ novo (kg)
--   canteiro .......... (já existe) = canteiro destino
-- A numeração continua a mesma do projeto (RF-<SIGLA>-nnn).
-- =====================================================================

alter table public.relatorios add column if not exists fabricante text;
alter table public.relatorios add column if not exists tipo_torre text;
alter table public.relatorios add column if not exists peso_carga numeric(14,3);

alter table public.relatorios drop constraint if exists relatorios_tipo_valido;
alter table public.relatorios add  constraint relatorios_tipo_valido
  check (tipo in ('Recebimento', 'Saída', 'Fábrica'));

alter table public.relatorios drop constraint if exists relatorios_peso_valido;
alter table public.relatorios add  constraint relatorios_peso_valido
  check (peso_carga is null or peso_carga > 0);

-- Visão do Power BI com os campos da Fábrica
drop view if exists public.vw_relatorios;
create view public.vw_relatorios with (security_invoker = true) as
select r.numero, r.seq, r.id_local, r.data_relatorio, date_trunc('month', r.data_relatorio)::date as competencia,
       r.tipo, r.projeto, p.sigla as sigla_projeto, r.lote, r.nf, r.fornecedor, r.canteiro, r.transportadora, r.trecho, r.torre,
       r.fabricante, r.tipo_torre, r.peso_carga,
       r.descricao, r.nao_conformidade, r.descricao_nc, r.observacoes,
       r.latitude, r.longitude, r.qtd_fotos,
       r.responsavel, r.funcao_responsavel, u.email as email_responsavel,
       r.versao, r.criado_em, r.atualizado_em
  from public.relatorios r
  join public.usuarios u on u.id = r.usuario_id
  left join public.projetos p on p.nome = r.projeto
 where r.excluido = false;
grant select on public.vw_relatorios to authenticated;

notify pgrst, 'reload schema';

-- Conferência:
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'relatorios' and column_name in ('fabricante', 'tipo_torre', 'peso_carga');
