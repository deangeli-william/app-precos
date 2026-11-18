-- App Preços: estrutura do banco (aplicada pelo Claude via conector Supabase).

-- Quem pode criar conta: só os e-mails desta lista (sem acesso pelo app).
create table public.permitidos (
  email text primary key
);
alter table public.permitidos enable row level security;
-- sem políticas: ninguém lê nem altera pelo app

create or replace function public.so_permitidos()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.permitidos p where lower(p.email) = lower(new.email)) then
    raise exception 'Este e-mail não tem acesso ao app.';
  end if;
  -- e-mail liberado: já entra confirmado (sem link de confirmação)
  new.email_confirmed_at := coalesce(new.email_confirmed_at, now());
  return new;
end $$;
revoke execute on function public.so_permitidos() from public, anon, authenticated;

create trigger so_permitidos
  before insert on auth.users
  for each row execute function public.so_permitidos();

-- Nome que aparece nos registros.
create table public.perfis (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null check (length(trim(nome)) between 1 and 30)
);

create table public.produtos (
  id bigint generated always as identity primary key,
  codigo text unique check (codigo ~ '^[0-9]{6,14}$'),
  produto text not null check (length(trim(produto)) between 1 and 60),
  marca text not null default '' check (length(marca) <= 40),
  vendido_por text not null check (vendido_por in ('kg','g','litro','ml','pacote','unidade','caixa')),
  tamanho text not null default '' check (length(tamanho) <= 20),
  criado_por uuid not null default auth.uid() references public.perfis(id),
  criado_em timestamptz not null default now()
);

create table public.lugares (
  id bigint generated always as identity primary key,
  nome text not null check (length(trim(nome)) between 1 and 40),
  criado_em timestamptz not null default now()
);
create unique index lugares_nome_unico on public.lugares (lower(nome));

create table public.registros (
  id bigint generated always as identity primary key,
  produto_id bigint not null references public.produtos(id) on delete cascade,
  lugar_id bigint not null references public.lugares(id),
  preco numeric(10,2) not null check (preco > 0),
  comprou boolean not null,
  quando timestamptz not null default now(),
  usuario_id uuid not null default auth.uid() references public.perfis(id)
);
create index registros_produto_quando on public.registros (produto_id, quando desc);
create index registros_quando on public.registros (quando desc);
create index registros_lugar on public.registros (lugar_id);
create index registros_usuario on public.registros (usuario_id);
create index produtos_criado_por on public.produtos (criado_por);

-- Segurança: sem login, ninguém vê nada.
alter table public.perfis enable row level security;
alter table public.produtos enable row level security;
alter table public.lugares enable row level security;
alter table public.registros enable row level security;

create policy "logados veem perfis" on public.perfis for select to authenticated using (true);
create policy "cria o proprio perfil" on public.perfis for insert to authenticated with check (id = (select auth.uid()));
create policy "muda o proprio perfil" on public.perfis for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "logados veem produtos" on public.produtos for select to authenticated using (true);
create policy "logados cadastram produtos" on public.produtos for insert to authenticated with check (criado_por = (select auth.uid()));
-- o cadastro do produto é compartilhado: qualquer um dos dois corrige
create policy "logados corrigem produtos" on public.produtos for update to authenticated using (true) with check (true);

create policy "logados veem lugares" on public.lugares for select to authenticated using (true);
create policy "logados cadastram lugares" on public.lugares for insert to authenticated with check (true);

create policy "logados veem registros" on public.registros for select to authenticated using (true);
create policy "registra em seu nome" on public.registros for insert to authenticated with check (usuario_id = (select auth.uid()));
-- cada um corrige e apaga só os próprios registros
create policy "corrige os proprios" on public.registros for update to authenticated using (usuario_id = (select auth.uid())) with check (usuario_id = (select auth.uid()));
create policy "apaga os proprios" on public.registros for delete to authenticated using (usuario_id = (select auth.uid()));

-- Ninguém muda quem cadastrou o produto.
create or replace function public.manter_criador()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.criado_por := old.criado_por;
  new.criado_em := old.criado_em;
  return new;
end $$;
create trigger manter_criador before update on public.produtos
  for each row execute function public.manter_criador();

-- O que um registra aparece para o outro na hora.
alter publication supabase_realtime add table public.registros, public.produtos, public.lugares;
