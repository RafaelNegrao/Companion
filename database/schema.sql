-- Schema do Companion App para Supabase
-- Rode este script inteiro no SQL Editor do Supabase (Project > SQL Editor > New query > Run).
-- Reflete exatamente as colunas usadas por src/main/main.js e src/renderer/renderer.js.

create extension if not exists pgcrypto;

-- ==========================================================
-- USUARIOS
-- ==========================================================
create table if not exists public.usuarios (
  id bigint generated always as identity primary key,
  nome text not null,
  email text not null unique,
  senha text not null,
  privilegio text not null default 'usuario',
  created_at timestamptz not null default now()
);

-- ==========================================================
-- CONFIGURACOES (1 linha por usuario)
-- ==========================================================
create table if not exists public.configuracoes (
  id bigint generated always as identity primary key,
  usuario text not null unique references public.usuarios(email) on update cascade on delete cascade,
  agente text,
  cod_rev text,
  email text,
  senha_email text,
  pasta_principal text,
  modo_pasta text,
  sac_cliente text,
  tela_cheia text,
  -- Apesar do nome (sobra de um campo antigo de "tela cheia"), essa coluna
  -- hoje guarda o telefone da Certisign mostrado pro cliente (ver
  -- config-tela-cheia em renderer.js). Nao renomeada para nao quebrar linhas
  -- ja gravadas — so documentando aqui pra nao confundir de novo.
  telefone_agente text,
  porcentagem_validacao numeric,
  porcentagem_venda numeric,
  desconto_total numeric,
  imposto_validacao numeric,
  desconto_validacao numeric,
  created_at timestamptz not null default now()
);

-- Adiciona a coluna em bancos que ja existiam antes dela (create table if
-- not exists acima nao altera uma tabela ja criada).
alter table public.configuracoes
  add column if not exists telefone_agente text;

-- ==========================================================
-- CERTIFICADOS (catalogo compartilhado)
-- ==========================================================
create table if not exists public.certificados (
  id bigint generated always as identity primary key,
  nome text not null unique,
  valor numeric not null default 0,
  link_venda text,
  tipo text,
  created_at timestamptz not null default now()
);

-- ==========================================================
-- PEDIDOS
-- ==========================================================
create table if not exists public.pedidos (
  id bigint generated always as identity primary key,
  usuario text not null references public.usuarios(email) on update cascade on delete cascade,
  pedido text not null,
  data text,
  hora text,
  versao text,
  modalidade text,
  venda text,
  preco_certificado numeric,
  comissao numeric,
  status text,

  -- Dados pessoais
  nome text,
  nascimento text,
  email text,
  telefone text,
  mae text,
  cpf text,
  rg text,
  orgao_rg text,
  cnh text,
  codigo_de_seg_cnh text,

  -- Outros documentos
  certificado text,
  digito_cpf text,

  -- Dados da empresa
  cnpj text,
  situacao_cadastral text,
  data_situacao_cadastral text,
  razao_social text,
  nome_fantasia text,
  data_abertura text,
  capital_social text,
  cep text,
  municipio text,
  uf text,
  bairro text,
  logradouro text,
  complemento text,
  junta text,
  diretorio text,
  pasta text,

  -- Comentarios
  comentarios text,

  -- Campos historicos do sistema antigo (nao usados na UI atual, mantidos para nao perder dado de negocio)
  valido_ate text,
  email_renovacao text,
  tipo text,

  created_at timestamptz not null default now(),

  unique (usuario, pedido)
);

create index if not exists idx_pedidos_usuario on public.pedidos (usuario);
create index if not exists idx_pedidos_pedido on public.pedidos (pedido);
create index if not exists idx_pedidos_cpf on public.pedidos (cpf);
create index if not exists idx_pedidos_status on public.pedidos (status);
create index if not exists idx_pedidos_created_at on public.pedidos (created_at);

-- ==========================================================
-- RLS
--
-- !!! ATENCAO — NAO RODE ESTE BLOCO NUM BANCO JA EM PRODUCAO !!!
--
-- As policies abaixo sao "using (true) with check (true)": liberam leitura e
-- escrita de TUDO para quem tiver a anon key — e a anon key vai empacotada no
-- instalador, ou seja, e publica. Elas existem so como estado inicial do
-- schema historico.
--
-- O estado correto vem de schema-auth.sql (filtra por auth.uid()) e
-- schema-hardening.sql. Rodar este arquivo de novo DERRUBA aquelas policies e
-- reabre o banco inteiro. Para um ambiente novo, rode na ordem:
--   1) schema.sql   2) schema-auth.sql   3) schema-hardening.sql
-- ==========================================================
alter table public.usuarios enable row level security;
alter table public.configuracoes enable row level security;
alter table public.certificados enable row level security;
alter table public.pedidos enable row level security;

drop policy if exists "usuarios_all" on public.usuarios;
create policy "usuarios_all" on public.usuarios for all using (true) with check (true);

drop policy if exists "configuracoes_all" on public.configuracoes;
create policy "configuracoes_all" on public.configuracoes for all using (true) with check (true);

drop policy if exists "certificados_all" on public.certificados;
create policy "certificados_all" on public.certificados for all using (true) with check (true);

drop policy if exists "pedidos_all" on public.pedidos;
create policy "pedidos_all" on public.pedidos for all using (true) with check (true);
