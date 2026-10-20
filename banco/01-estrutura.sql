-- =====================================================================
-- banco/01-estrutura.sql — BASE CENTRAL (versão 1.0.0)
-- Relatório Fotográfico de Materiais | EDP Transmissão Construção
-- ---------------------------------------------------------------------
-- Rode num projeto Supabase PRÓPRIO deste app (não no projeto do app de
-- Inspeções). O script cria:
--   • usuarios            — cadastro de quem usa o app (nasce PENDENTE)
--   • autorizacoes        — base de acessos (lotes e visão pré-definidos
--                           por e-mail, carregada pelo arquivo 02)
--   • relatorios          — todos os relatórios de todos os aparelhos
--   • relatorios_historico— versões anteriores de cada relatório
--   • bucket de fotos privado "fotos-materiais"
--   • regras de acesso (RLS) aplicadas NO SERVIDOR:
--       - administrador: libera cadastros e vê tudo;
--       - visão "todas": vê os relatórios de todos, nos seus lotes;
--       - visão "proprias": vê somente os relatórios que ele fez.
--   • tempo real (Realtime) na tabela de relatórios
--
-- COMO EXECUTAR
--   Supabase > SQL Editor > New query > cole este arquivo > Run.
--   Depois execute o 02-base-de-acessos.sql do mesmo jeito.
--   O script pode ser executado de novo sem quebrar nada.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. USUÁRIOS
-- ---------------------------------------------------------------------
create table if not exists public.usuarios (
  id              uuid primary key references auth.users(id) on delete cascade,
  nome            text not null,
  email           text not null unique,
  funcao          text not null default 'Outro',
  lotes           text[] not null default '{}',
  perfil          text not null default 'inspetor',
  visao           text not null default 'proprias',
  status          text not null default 'pendente',
  criado_em       timestamptz not null default now(),
  aprovado_em     timestamptz,
  aprovado_por    uuid,
  ultimo_acesso   timestamptz,
  ultimo_sync     timestamptz,
  dispositivo     text,
  pendentes_envio int not null default 0
);
alter table public.usuarios add column if not exists pendentes_envio int not null default 0;

alter table public.usuarios drop constraint if exists usuarios_perfil_valido;
alter table public.usuarios add  constraint usuarios_perfil_valido check (perfil in ('inspetor', 'admin'));
alter table public.usuarios drop constraint if exists usuarios_status_valido;
alter table public.usuarios add  constraint usuarios_status_valido check (status in ('pendente', 'ativo', 'inativo', 'recusado'));
alter table public.usuarios drop constraint if exists usuarios_visao_valida;
alter table public.usuarios add  constraint usuarios_visao_valida check (visao in ('proprias', 'todas'));
create index if not exists idx_usuarios_status on public.usuarios (status);

-- ---------------------------------------------------------------------
-- 2. BASE DE ACESSOS (pré-autorização por e-mail)
-- ---------------------------------------------------------------------
create table if not exists public.autorizacoes (
  email         text primary key,
  nome          text,
  funcao        text,
  perfil        text not null default 'inspetor',
  lotes         text[] not null default '{}',
  visao         text not null default 'proprias',
  observacao    text,
  atualizado_em timestamptz not null default now(),
  constraint autorizacoes_email_minusculo check (email = lower(email)),
  constraint autorizacoes_perfil_valido check (perfil in ('inspetor', 'admin')),
  constraint autorizacoes_visao_valida  check (visao in ('proprias', 'todas'))
);

-- ---------------------------------------------------------------------
-- 3. RELATÓRIOS
-- ---------------------------------------------------------------------
create table if not exists public.relatorios (
  id                 bigint generated always as identity primary key,
  id_local           uuid not null unique,
  usuario_id         uuid not null references public.usuarios(id) on delete restrict,
  numero             text,
  responsavel        text not null,
  funcao_responsavel text,
  projeto            text not null,
  lote               text not null,
  data_relatorio     date not null,
  tipo               text not null,
  nf                 text,
  fornecedor         text,
  canteiro           text,          -- recebimento
  transportadora     text,          -- saída
  trecho             text,          -- saída
  torre              text,          -- saída
  descricao          text not null default '',
  nao_conformidade   boolean not null default false,
  descricao_nc       text,
  observacoes        text,
  latitude           double precision,
  longitude          double precision,
  precisao_gps       integer,
  dispositivo        text,
  fotos              jsonb not null default '[]'::jsonb,
  qtd_fotos          integer not null default 0,
  versao             integer not null default 1,
  criado_em          timestamptz not null,
  atualizado_em      timestamptz not null,
  excluido           boolean not null default false,
  motivo_exclusao    text,
  excluido_em        timestamptz,
  recebido_em        timestamptz not null default now()
);
alter table public.relatorios drop constraint if exists relatorios_tipo_valido;
alter table public.relatorios add  constraint relatorios_tipo_valido check (tipo in ('Recebimento', 'Saída'));
alter table public.relatorios drop constraint if exists relatorios_nc_descrita;
alter table public.relatorios add  constraint relatorios_nc_descrita
  check (nao_conformidade = false or coalesce(length(trim(descricao_nc)), 0) > 0);

create index if not exists idx_relatorios_lote     on public.relatorios (lote);
create index if not exists idx_relatorios_usuario  on public.relatorios (usuario_id);
create index if not exists idx_relatorios_recebido on public.relatorios (recebido_em);
create index if not exists idx_relatorios_data     on public.relatorios (data_relatorio desc);

create table if not exists public.relatorios_historico (
  id            bigint generated always as identity primary key,
  id_local      uuid not null,
  usuario_id    uuid,
  lote          text,
  versao        integer,
  conteudo      jsonb not null,
  motivo        text,
  arquivado_em  timestamptz not null default now()
);
create index if not exists idx_rhist_id_local on public.relatorios_historico (id_local);

-- ---------------------------------------------------------------------
-- 4. FUNÇÕES DE AUTORIZAÇÃO (security definer: leem usuarios sem RLS)
-- ---------------------------------------------------------------------
create or replace function public.eh_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u
                  where u.id = auth.uid() and u.perfil = 'admin' and u.status = 'ativo');
$$;

create or replace function public.usuario_ativo() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.usuarios u where u.id = auth.uid() and u.status = 'ativo');
$$;

create or replace function public.meus_lotes() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select u.lotes from public.usuarios u
                     where u.id = auth.uid() and u.status = 'ativo'), '{}'::text[]);
$$;

create or replace function public.minha_visao() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select u.visao from public.usuarios u
                     where u.id = auth.uid() and u.status = 'ativo'), 'proprias');
$$;

create or replace function public.meu_status() returns text
language sql stable security definer set search_path = public as $$
  select u.status from public.usuarios u where u.id = auth.uid();
$$;
create or replace function public.meu_perfil() returns text
language sql stable security definer set search_path = public as $$
  select u.perfil from public.usuarios u where u.id = auth.uid();
$$;
create or replace function public.meus_lotes_gravados() returns text[]
language sql stable security definer set search_path = public as $$
  select coalesce((select u.lotes from public.usuarios u where u.id = auth.uid()), '{}'::text[]);
$$;
create or replace function public.minha_visao_gravada() returns text
language sql stable security definer set search_path = public as $$
  select u.visao from public.usuarios u where u.id = auth.uid();
$$;

/* Pode GRAVAR neste lote? */
create or replace function public.pode_no_lote(p_lote text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.eh_admin() or (p_lote = any (public.meus_lotes()));
$$;

/* Pode VER este relatório? Administrador vê tudo; visão "todas" vê tudo
   dos seus lotes; os demais veem apenas o que eles mesmos registraram. */
create or replace function public.pode_ver(p_usuario uuid, p_lote text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.usuario_ativo() and (
           public.eh_admin()
        or p_usuario = auth.uid()
        or (public.minha_visao() = 'todas' and p_lote = any (public.meus_lotes()))
  );
$$;

-- ---------------------------------------------------------------------
-- 5. GATILHOS
-- ---------------------------------------------------------------------

/* 5.1 Cadastro: toda conta criada no Auth ganha a linha em usuarios,
       sempre PENDENTE — exceto o administrador da base de acessos. */
create or replace function public.fn_novo_usuario() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  a  public.autorizacoes%rowtype;
  md jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  lotes_pedidos text[];
begin
  select * into a from public.autorizacoes where email = lower(new.email);
  select coalesce(array_agg(x), '{}') into lotes_pedidos
    from jsonb_array_elements_text(coalesce(md->'lotes', '[]'::jsonb)) as x;
  insert into public.usuarios (id, nome, email, funcao, lotes, perfil, visao, status, aprovado_em)
  values (
    new.id,
    coalesce(nullif(md->>'nome', ''), a.nome, split_part(new.email, '@', 1)),
    lower(new.email),
    coalesce(nullif(md->>'funcao', ''), a.funcao, 'Outro'),
    case when a.email is not null then a.lotes else lotes_pedidos end,
    case when a.perfil = 'admin' then 'admin' else 'inspetor' end,
    case when a.perfil = 'admin' then 'todas' else coalesce(a.visao, 'proprias') end,
    case when a.perfil = 'admin' then 'ativo' else 'pendente' end,
    case when a.perfil = 'admin' then now() else null end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;
drop trigger if exists trg_novo_usuario on auth.users;
create trigger trg_novo_usuario
  after insert on auth.users
  for each row execute function public.fn_novo_usuario();

/* 5.2 Versão anterior vai para o histórico; versão mais antiga não
       sobrescreve a mais nova (aparelho atrasado). */
create or replace function public.fn_relatorio_versionar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.relatorios_historico (id_local, usuario_id, lote, versao, conteudo, motivo)
  values (old.id_local, old.usuario_id, old.lote, old.versao, to_jsonb(old),
          case when new.atualizado_em < old.atualizado_em then 'edicao-ignorada' else 'edicao' end);
  if new.atualizado_em < old.atualizado_em then
    return old;
  end if;
  new.usuario_id  := old.usuario_id;            -- o autor nunca muda
  new.criado_em   := old.criado_em;
  new.qtd_fotos   := coalesce(jsonb_array_length(new.fotos), 0);
  new.recebido_em := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists trg_relatorio_versionar on public.relatorios;
create trigger trg_relatorio_versionar before update on public.relatorios
  for each row execute function public.fn_relatorio_versionar();

/* 5.3 Na inserção o autor é sempre quem está logado. */
create or replace function public.fn_relatorio_inserir() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.usuario_id  := auth.uid();
  new.qtd_fotos   := coalesce(jsonb_array_length(new.fotos), 0);
  new.recebido_em := clock_timestamp();
  return new;
end;
$$;
drop trigger if exists trg_relatorio_inserir on public.relatorios;
create trigger trg_relatorio_inserir before insert on public.relatorios
  for each row execute function public.fn_relatorio_inserir();

/* 5.4 Último envio do usuário (aparece na tela de liberações). */
create or replace function public.fn_marcar_sync() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.usuarios
     set ultimo_sync = now(), ultimo_acesso = now(),
         dispositivo = coalesce(new.dispositivo, dispositivo)
   where id = auth.uid();
  return null;
end;
$$;
drop trigger if exists trg_marcar_sync on public.relatorios;
create trigger trg_marcar_sync after insert or update on public.relatorios
  for each row execute function public.fn_marcar_sync();

/* 5.5 Carimbo de quem liberou e quando. */
create or replace function public.fn_usuario_aprovacao() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'ativo' and old.status is distinct from 'ativo' then
    new.aprovado_em  := now();
    new.aprovado_por := auth.uid();
  end if;
  return new;
end;
$$;
drop trigger if exists trg_usuario_aprovacao on public.usuarios;
create trigger trg_usuario_aprovacao before update on public.usuarios
  for each row execute function public.fn_usuario_aprovacao();

-- ---------------------------------------------------------------------
-- 6. REGRAS DE ACESSO (ROW LEVEL SECURITY)
-- ---------------------------------------------------------------------
alter table public.usuarios             enable row level security;
alter table public.autorizacoes         enable row level security;
alter table public.relatorios           enable row level security;
alter table public.relatorios_historico enable row level security;

-- 6.1 usuarios: cada um lê o próprio; o administrador lê e altera todos.
drop policy if exists "usuario le o proprio cadastro" on public.usuarios;
create policy "usuario le o proprio cadastro" on public.usuarios for select to authenticated
  using (id = auth.uid() or public.eh_admin());

-- O próprio usuário só altera dados descritivos (acesso fica congelado).
drop policy if exists "usuario atualiza dados proprios" on public.usuarios;
create policy "usuario atualiza dados proprios" on public.usuarios for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and status = public.meu_status()
    and perfil = public.meu_perfil()
    and visao  = public.minha_visao_gravada()
    and lotes  = public.meus_lotes_gravados()
  );

drop policy if exists "admin administra usuarios" on public.usuarios;
create policy "admin administra usuarios" on public.usuarios for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- 6.2 autorizacoes: somente o administrador.
drop policy if exists "admin gerencia autorizacoes" on public.autorizacoes;
create policy "admin gerencia autorizacoes" on public.autorizacoes for all to authenticated
  using (public.eh_admin()) with check (public.eh_admin());

-- 6.3 relatorios
drop policy if exists "le relatorios permitidos" on public.relatorios;
create policy "le relatorios permitidos" on public.relatorios for select to authenticated
  using (public.pode_ver(usuario_id, lote));

drop policy if exists "grava relatorio no meu lote" on public.relatorios;
create policy "grava relatorio no meu lote" on public.relatorios for insert to authenticated
  with check (public.usuario_ativo() and public.pode_no_lote(lote));

-- Edição: somente o autor (dentro do seu lote) ou o administrador.
drop policy if exists "edita relatorio do meu lote" on public.relatorios;
create policy "edita relatorio do meu lote" on public.relatorios for update to authenticated
  using (public.usuario_ativo() and (public.eh_admin() or (usuario_id = auth.uid() and public.pode_no_lote(lote))))
  with check (public.eh_admin() or (usuario_id = auth.uid() and public.pode_no_lote(lote)));
-- Sem DELETE: a exclusão é lógica (excluido = true).

drop policy if exists "le historico permitido" on public.relatorios_historico;
create policy "le historico permitido" on public.relatorios_historico for select to authenticated
  using (public.pode_ver(usuario_id, lote));

-- ---------------------------------------------------------------------
-- 7. FOTOS (Storage) — caminho {lote}/{id_local}/{arquivo}
--    Ids comparados como TEXTO (sem ::uuid): o Postgres não garante a
--    ordem de avaliação e uma conversão pode quebrar outros caminhos.
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('fotos-materiais', 'fotos-materiais', false, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

/* Pode ver as fotos desta pasta? Mesma regra do relatório. Se o relatório
   ainda não chegou (fotos sobem antes da linha), vale o lote do autor. */
create or replace function public.pode_ver_foto(p_nome text) returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (select 1 from public.relatorios r where r.id_local::text = split_part(p_nome, '/', 2))
      then exists (select 1 from public.relatorios r
                    where r.id_local::text = split_part(p_nome, '/', 2)
                      and public.pode_ver(r.usuario_id, r.lote))
    else public.pode_no_lote(split_part(p_nome, '/', 1))
  end;
$$;

/* Pode gravar fotos nesta pasta? Lote permitido e, se o relatório já
   existe, ele tem de ser do próprio usuário (ou ele é administrador). */
create or replace function public.pode_gravar_foto(p_nome text) returns boolean
language sql stable security definer set search_path = public as $$
  select public.usuario_ativo()
     and public.pode_no_lote(split_part(p_nome, '/', 1))
     and not exists (select 1 from public.relatorios r
                      where r.id_local::text = split_part(p_nome, '/', 2)
                        and r.usuario_id <> auth.uid() and not public.eh_admin());
$$;

drop policy if exists "rf envia foto do meu lote" on storage.objects;
create policy "rf envia foto do meu lote" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos-materiais' and public.pode_gravar_foto(name));

drop policy if exists "rf atualiza foto do meu lote" on storage.objects;
create policy "rf atualiza foto do meu lote" on storage.objects for update to authenticated
  using (bucket_id = 'fotos-materiais' and public.pode_gravar_foto(name))
  with check (bucket_id = 'fotos-materiais' and public.pode_gravar_foto(name));

drop policy if exists "rf le foto permitida" on storage.objects;
create policy "rf le foto permitida" on storage.objects for select to authenticated
  using (bucket_id = 'fotos-materiais' and public.pode_ver_foto(name));

-- ---------------------------------------------------------------------
-- 8. TEMPO REAL — o app do administrador (e de quem tem visão "todas")
--    é avisado no instante em que um relatório chega. Respeita a RLS.
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    create publication supabase_realtime;
  end if;
  if not exists (select 1 from pg_publication_tables
                  where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'relatorios') then
    alter publication supabase_realtime add table public.relatorios;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 9. VISÃO PARA O POWER BI (respeita as regras de quem consulta)
-- ---------------------------------------------------------------------
create or replace view public.vw_relatorios with (security_invoker = true) as
select r.numero, r.id_local, r.data_relatorio, date_trunc('month', r.data_relatorio)::date as competencia,
       r.tipo, r.projeto, r.lote, r.nf, r.fornecedor, r.canteiro, r.transportadora, r.trecho, r.torre,
       r.descricao, r.nao_conformidade, r.descricao_nc, r.observacoes,
       r.latitude, r.longitude, r.qtd_fotos,
       r.responsavel, r.funcao_responsavel, u.email as email_responsavel,
       r.versao, r.criado_em, r.atualizado_em
  from public.relatorios r
  join public.usuarios u on u.id = r.usuario_id
 where r.excluido = false;

-- =====================================================================
-- Conferência rápida:
--   select nome, email, perfil, visao, status, lotes from public.usuarios order by criado_em;
--   select numero, tipo, lote, nf, nao_conformidade, qtd_fotos from public.relatorios order by recebido_em desc;
-- =====================================================================
