-- App Preços: estrutura do banco
-- Rode este arquivo uma única vez no Supabase: SQL Editor > New query > colar > Run.

-- Produtos: um por código de barras
create table if not exists public.produtos (
  codigo      text primary key,
  nome        text not null check (length(trim(nome)) > 0),
  criado_por  uuid default auth.uid() references auth.users (id),
  criado_em   timestamptz not null default now()
);

-- Mercados: lista montada pelo uso
create table if not exists public.mercados (
  id         bigint generated always as identity primary key,
  nome       text not null check (length(trim(nome)) > 0),
  criado_em  timestamptz not null default now()
);
create unique index if not exists mercados_nome_unico on public.mercados (lower(trim(nome)));

-- Registros de preço: cada leitura gravada
create table if not exists public.registros (
  id                   bigint generated always as identity primary key,
  codigo               text not null references public.produtos (codigo) on delete cascade,
  mercado_id           bigint not null references public.mercados (id),
  preco                numeric(10,2) not null check (preco > 0),
  comprou              boolean not null,
  registrado_por       uuid not null default auth.uid() references auth.users (id),
  registrado_por_nome  text,
  criado_em            timestamptz not null default now()
);
create index if not exists registros_codigo_data on public.registros (codigo, criado_em desc);
create index if not exists registros_data on public.registros (criado_em desc);

-- Regras de acesso: só quem está logado vê e grava
alter table public.produtos  enable row level security;
alter table public.mercados  enable row level security;
alter table public.registros enable row level security;

drop policy if exists "logados leem produtos" on public.produtos;
create policy "logados leem produtos" on public.produtos
  for select to authenticated using (true);
drop policy if exists "logados cadastram produtos" on public.produtos;
create policy "logados cadastram produtos" on public.produtos
  for insert to authenticated with check (true);

drop policy if exists "logados leem mercados" on public.mercados;
create policy "logados leem mercados" on public.mercados
  for select to authenticated using (true);
drop policy if exists "logados cadastram mercados" on public.mercados;
create policy "logados cadastram mercados" on public.mercados
  for insert to authenticated with check (true);

drop policy if exists "logados leem registros" on public.registros;
create policy "logados leem registros" on public.registros
  for select to authenticated using (true);
drop policy if exists "logados gravam os proprios registros" on public.registros;
create policy "logados gravam os proprios registros" on public.registros
  for insert to authenticated with check (registrado_por = auth.uid());
drop policy if exists "cada um apaga os proprios registros" on public.registros;
create policy "cada um apaga os proprios registros" on public.registros
  for delete to authenticated using (registrado_por = auth.uid());

-- Atualização em tempo real da lista de últimos registros
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'registros'
  ) then
    alter publication supabase_realtime add table public.registros;
  end if;
end $$;

-- Função usada só pelo "acesso automático semanal" que evita a pausa do plano gratuito.
-- Não devolve nenhum dado.
create or replace function public.manter_ativo()
returns text language sql security definer set search_path = public as $$
  select 'ok'::text where (select count(*) from public.mercados) >= 0;
$$;
grant execute on function public.manter_ativo() to anon, authenticated;
