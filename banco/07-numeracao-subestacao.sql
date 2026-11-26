-- =====================================================================
-- banco/07-numeracao-subestacao.sql — NUMERAÇÃO PRÓPRIA DE SUBESTAÇÃO (v1.6.0)
-- Relatório Fotográfico de Materiais | EDP Transmissão Construção
-- ---------------------------------------------------------------------
-- Rode DEPOIS do 06. Pode rodar de novo sem problema.
--
-- Materiais Subestação é uma evidência à parte dos Materiais LT:
--   • Materiais LT / Recebimento / Saída .. RF-<SIGLA>-001, 002, ... (como hoje)
--   • Materiais Subestação ............... RF-<SIGLA>-SE-001, 002, ... (própria)
-- A sequência de Subestação começa em 001 em cada projeto, automática.
-- Os registros de Subestação que já existem são renumerados a partir de
-- 001, na ordem em que foram criados. A sequência de LT não muda.
-- =====================================================================

-- 1. Série do registro ('' = LT e demais tipos, 'SE' = Materiais Subestação)
alter table public.relatorios add column if not exists serie text
  generated always as (case when tipo = 'Fábrica' and categoria_fabrica = 'Subestação' then 'SE' else '' end) stored;

-- Número único por projeto E por série
drop index if exists public.ux_relatorios_projeto_seq;
create unique index if not exists ux_relatorios_projeto_serie_seq
  on public.relatorios (projeto, serie, seq) where seq is not null;

-- Chave do contador: projeto (LT) ou "projeto #SE" (Subestação)
create or replace function public.rf_chave_contador(p_projeto text, p_serie text) returns text
language sql immutable as $$
  select case when coalesce(p_serie, '') = '' then p_projeto else p_projeto || ' #' || p_serie end;
$$;

create or replace function public.rf_numero(p_projeto text, p_serie text, p_seq integer) returns text
language sql stable security definer set search_path = public as $$
  select 'RF-' || public.rf_sigla(p_projeto) || case when coalesce(p_serie, '') = '' then '' else '-' || p_serie end
         || '-' || lpad(p_seq::text, 3, '0');
$$;

-- 2. Gatilho de numeração com série
create or replace function public.fn_relatorio_numerar() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_serie text := case when new.tipo = 'Fábrica' and new.categoria_fabrica = 'Subestação' then 'SE' else '' end;
  v_serie_ant text;
  v_chave text := public.rf_chave_contador(new.projeto, v_serie);
begin
  if tg_op = 'INSERT' then
    -- upsert de um relatório que já existe: quem numera é o caminho de UPDATE
    if exists (select 1 from public.relatorios r where r.id_local = new.id_local) then
      return new;
    end if;
    if coalesce(new.seq_manual, false) and new.seq is not null and new.seq > 0 then
      perform public.rf_registrar_manual(v_chave, new.seq);
    else
      new.seq_manual := false;
      new.seq := public.rf_proximo_seq(v_chave);
    end if;
  else
    v_serie_ant := case when old.tipo = 'Fábrica' and old.categoria_fabrica = 'Subestação' then 'SE' else '' end;
    if coalesce(new.seq_manual, false) and new.seq is not null and new.seq > 0 then
      if new.seq is distinct from old.seq or new.projeto is distinct from old.projeto or v_serie <> v_serie_ant then
        perform public.rf_registrar_manual(v_chave, new.seq);
      end if;
    elsif old.seq is null or new.projeto is distinct from old.projeto or v_serie <> v_serie_ant then
      -- trocou de projeto ou de LT <-> Subestação: número novo na série nova
      new.seq_manual := false;
      new.seq := public.rf_proximo_seq(v_chave);
    else
      new.seq := old.seq;
      new.seq_manual := old.seq_manual;
    end if;
  end if;
  new.numero := public.rf_numero(new.projeto, v_serie, new.seq);
  return new;
end;
$$;

drop trigger if exists trg_relatorio_z_numerar on public.relatorios;
create trigger trg_relatorio_z_numerar before insert or update on public.relatorios
  for each row execute function public.fn_relatorio_numerar();

-- 3. Renumera os registros de Subestação que ainda têm número de LT
--    (001, 002, ... por projeto). Só na 1ª execução: rodar de novo não mexe
--    nos números de Subestação já dados.
do $$
begin
  if exists (select 1 from public.relatorios where serie = 'SE' and seq is not null and numero not like '%-SE-%') then
    alter table public.relatorios disable trigger trg_relatorio_z_numerar;
    alter table public.relatorios disable trigger trg_relatorio_versionar;

    -- passo provisório (evita choque de números durante a troca)
    update public.relatorios set seq = -seq where serie = 'SE' and seq > 0;

    with ordem as (
      select id_local, row_number() over (partition by projeto order by criado_em, id_local) as n
        from public.relatorios
       where serie = 'SE'
    )
    update public.relatorios r
       set seq = o.n,
           seq_manual = false,
           numero = public.rf_numero(r.projeto, 'SE', o.n::integer),
           recebido_em = now()           -- os aparelhos baixam o número novo
      from ordem o
     where r.id_local = o.id_local;

    alter table public.relatorios enable trigger trg_relatorio_versionar;
    alter table public.relatorios enable trigger trg_relatorio_z_numerar;
  end if;
end $$;

-- contador de Subestação de cada projeto nunca fica atrás do maior número usado
insert into public.contadores_projeto (projeto, ultimo)
select public.rf_chave_contador(projeto, 'SE'), max(seq)
  from public.relatorios where serie = 'SE' and seq is not null
 group by projeto
on conflict (projeto) do update set ultimo = greatest(public.contadores_projeto.ultimo, excluded.ultimo);

notify pgrst, 'reload schema';

-- Conferência (Subestação começando em 001):
select projeto, serie, numero, data_relatorio
  from public.relatorios
 where tipo = 'Fábrica'
 order by projeto, serie, seq;
