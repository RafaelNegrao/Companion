-- Migra o schema do Companion App para usar Supabase Auth (ver LOGIN-MULTIUSUARIO.md).
-- Rode DEPOIS de database/schema.sql (que ja deve ter sido executado).
-- Rode no SQL Editor do Supabase (Project > SQL Editor > New query > Run).

-- ==========================================================
-- USUARIOS vira tabela de PERFIL (nao mais de autenticacao).
-- O Supabase Auth (auth.users) passa a guardar email/senha.
-- Como o id muda de bigint para uuid (= auth.users.id), recriamos a tabela;
-- os dados (nome/privilegio) sao repostos pelo script de migracao.
-- ==========================================================
drop policy if exists "usuarios_all" on public.usuarios;

-- CASCADE aqui remove so as constraints antigas que apontavam pra
-- usuarios(email) (configuracoes_usuario_fkey, pedidos_usuario_fkey) —
-- nao apaga as tabelas configuracoes/pedidos nem os dados delas. Essas
-- colunas "usuario" continuam existindo, so deixam de ter FK (o vinculo
-- de dono de verdade passa a ser o novo user_id, adicionado mais abaixo).
drop table if exists public.usuarios cascade;

create table public.usuarios (
  id uuid primary key references auth.users(id) on delete cascade,
  nome text not null,
  privilegio text not null default 'usuario',
  created_at timestamptz not null default now()
);

alter table public.usuarios enable row level security;

create policy "usuarios_self" on public.usuarios
  for all to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Cria a linha de perfil automaticamente quando uma conta e criada no
-- Supabase Auth (cadastro pelo app ou supabase.auth.admin.createUser).
-- SECURITY DEFINER pra funcionar mesmo quando ainda nao ha sessao autenticada
-- (ex: "Confirm email" ligado no projeto -> signUp() nao retorna sessao ate
-- confirmar, entao um insert comum via RLS falharia por falta de auth.uid()).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.usuarios (id, nome, privilegio)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nome', new.email),
    coalesce(new.raw_user_meta_data->>'privilegio', 'usuario')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ==========================================================
-- PEDIDOS: adiciona user_id e troca RLS pra filtrar por dono real.
-- Fica nullable porque pedidos sem usuario com e-mail valido no Supabase
-- Auth (ex: contas legadas "@aux") continuam sem user_id ate serem migradas.
-- ==========================================================
alter table public.pedidos
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.pedidos
  alter column user_id set default auth.uid();

create index if not exists idx_pedidos_user_id on public.pedidos (user_id);

drop policy if exists "pedidos_all" on public.pedidos;

create policy "pedidos_own" on public.pedidos
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ==========================================================
-- CONFIGURACOES: mesma logica de pedidos.
-- ==========================================================
alter table public.configuracoes
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

alter table public.configuracoes
  alter column user_id set default auth.uid();

create index if not exists idx_configuracoes_user_id on public.configuracoes (user_id);

drop policy if exists "configuracoes_all" on public.configuracoes;

create policy "configuracoes_own" on public.configuracoes
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ==========================================================
-- CERTIFICADOS: catalogo compartilhado (nao e dado por usuario).
-- So passa a exigir estar autenticado; continua visivel/editavel por
-- qualquer conta logada, como ja era antes.
-- ==========================================================
drop policy if exists "certificados_all" on public.certificados;

create policy "certificados_authenticated" on public.certificados
  for all to authenticated
  using (true)
  with check (true);
