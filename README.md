# Companion App

Aplicativo Electron que fica fixado na lateral direita da tela.

## Funcionalidades

- ✅ Fixado na borda direita da tela
- ✅ Abre ao passar o mouse sobre a área de gatilho
- ✅ Fecha automaticamente ao tirar o mouse (se não estiver travado)
- ✅ Sempre visível acima de outras janelas
- ✅ Botão de cadeado para manter a janela aberta
- ✅ Interface moderna com tema escuro

## Instalação

```bash
npm install
```

## Executar

```bash
npm start
```

## Como usar

1. Execute o aplicativo
2. Uma barra fina aparecerá na borda direita da tela
3. Passe o mouse sobre a barra para abrir o painel
4. Clique no cadeado para manter o painel aberto
5. Clique no X para fechar o aplicativo

## Ambiente (.env)

Crie o arquivo `.env` na raiz com:

```env
SUPABASE_URL=
SUPABASE_ANON_KEY=
```

Use a URL e a `anon key` do seu projeto Supabase (Project Settings → API). O
login/cadastro é feito pelo Supabase Auth — veja `LOGIN-MULTIUSUARIO.md` para
a arquitetura completa e `database/schema.sql` + `database/schema-auth.sql`
para o schema.
