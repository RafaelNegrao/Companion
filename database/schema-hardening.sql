-- ==========================================================
-- ENDURECIMENTO DE SEGURANCA
--
-- Rode DEPOIS de schema.sql e schema-auth.sql, no SQL Editor do Supabase.
-- E idempotente: pode rodar mais de uma vez sem efeito colateral.
--
-- Contexto: o acesso anonimo ja esta fechado (verificado — a anon key sozinha
-- nao le nem escreve nada). O que este arquivo corrige sao brechas que valem
-- para contas JA autenticadas.
-- ==========================================================


-- ----------------------------------------------------------
-- 1. USUARIOS: impedir que a conta altere o proprio privilegio
--
-- A policy "usuarios_self" era "for all", entao o usuario podia dar UPDATE em
-- qualquer coluna da propria linha — inclusive privilegio — e ate DELETE do
-- proprio perfil. Hoje o app nao usa privilegio para autorizar nada, entao o
-- estrago e nulo; mas no minuto em que existir uma tela restrita a admin, essa
-- policy vira uma escada de escalacao de privilegio.
--
-- RLS nao filtra coluna, so linha. Quem resolve isso e o GRANT por coluna.
-- ----------------------------------------------------------
drop policy if exists "usuarios_self" on public.usuarios;

create policy "usuarios_self_select" on public.usuarios
  for select to authenticated
  using (auth.uid() = id);

create policy "usuarios_self_update" on public.usuarios
  for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Sem policy de INSERT nem de DELETE: a linha de perfil e criada pelo trigger
-- on_auth_user_created (SECURITY DEFINER) e removida em cascata junto da conta
-- em auth.users. O usuario nao precisa fazer nenhum dos dois.

-- Nenhuma conta autenticada pode escrever nestas duas colunas.
-- O trigger continua conseguindo, porque roda como dono da funcao.
revoke update (privilegio) on public.usuarios from authenticated;
revoke update (id) on public.usuarios from authenticated;


-- ----------------------------------------------------------
-- 2. TRIGGER: nao confiar no privilegio vindo do cliente
--
-- handle_new_user lia o privilegio de raw_user_meta_data, que e preenchido
-- pelo signUp() — ou seja, pelo lado do cliente. Como o app e distribuido, esse
-- valor e controlavel por quem tiver o instalador: bastava chamar signUp com
-- privilegio 'admin'. Toda conta nova nasce como 'usuario'; promover e uma
-- acao manual no banco.
-- ----------------------------------------------------------
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
    'usuario'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


-- ----------------------------------------------------------
-- 3. Conferencia
--
-- Depois de rodar, o resultado esperado e:
--   - usuarios: usuarios_self_select (SELECT) e usuarios_self_update (UPDATE)
--   - pedidos / configuracoes: *_own, filtrando por auth.uid() = user_id
--   - certificados: certificados_authenticated
-- ----------------------------------------------------------
select tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
