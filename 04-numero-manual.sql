-- =====================================================================
-- banco/04-numero-manual.sql — Nº DO REGISTRO INFORMADO (v1.2.0)
-- Relatório Fotográfico de Materiais | EDP Transmissão Construção
-- ---------------------------------------------------------------------
-- Rode DEPOIS do 03-numeracao-projetos.sql. Pode rodar de novo.
--
-- A Fiscalização pode informar o "Nº do registro" no formulário:
--   • informado ......... a base usa o número informado (se já existir no
--                         mesmo projeto, o envio é recusado com aviso);
--   • em branco ......... a base dá o próximo número do projeto;
--   • o contador do projeto acompanha o maior número usado, então a
--     numeração automática continua depois do último informado.
-- =====================================================================

alter table public.relatorios add column if not exists seq_manual boolean not null default false;

/* Registra um número informado: contador nunca fica atrás dele. */
create or replace function public.rf_registrar_manual(p_projeto text, p_seq integer) returns void
language sql security definer set search_path = public as $$
  insert into public.contadores_projeto (projeto, ultimo) values (p_projeto, p_seq)
  on conflict (projeto) do update set ultimo = greatest(public.contadores_projeto.ultimo, excluded.ultimo);
$$;

create or replace function public.fn_relatorio_numerar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    -- upsert de um relatório que já existe: quem numera é o caminho de UPDATE
    if exists (select 1 from public.relatorios r where r.id_local = new.id_local) then
      return new;
    end if;
    if coalesce(new.seq_manual, false) and new.seq is not null and new.seq > 0 then
      perform public.rf_registrar_manual(new.projeto, new.seq);
    else
      new.seq_manual := false;
      new.seq := public.rf_proximo_seq(new.projeto);
    end if;
  else
    if coalesce(new.seq_manual, false) and new.seq is not null and new.seq > 0 then
      if new.seq is distinct from old.seq or new.projeto is distinct from old.projeto then
        perform public.rf_registrar_manual(new.projeto, new.seq);
      end if;
    elsif old.seq is null or new.projeto is distinct from old.projeto then
      new.seq_manual := false;
      new.seq := public.rf_proximo_seq(new.projeto);
    else
      new.seq := old.seq;
      new.seq_manual := old.seq_manual;
    end if;
  end if;
  new.numero := 'RF-' || public.rf_sigla(new.projeto) || '-' || lpad(new.seq::text, 3, '0');
  return new;
end;
$$;

drop trigger if exists trg_relatorio_z_numerar on public.relatorios;
create trigger trg_relatorio_z_numerar before insert or update on public.relatorios
  for each row execute function public.fn_relatorio_numerar();

-- Conferência:
--   select projeto, numero, seq_manual, data_relatorio from public.relatorios order by projeto, seq;
