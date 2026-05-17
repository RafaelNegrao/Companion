// Configuracao segura do Supabase via .env
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

function carregarEnvLocal() {
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return;

  const conteudo = fs.readFileSync(envPath, 'utf8');
  conteudo.split(/\r?\n/).forEach((linha) => {
    const texto = linha.trim();
    if (!texto || texto.startsWith('#')) return;

    const idx = texto.indexOf('=');
    if (idx < 1) return;

    const chave = texto.slice(0, idx).trim();
    let valor = texto.slice(idx + 1).trim();
    if (!chave) return;

    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }

    if (process.env[chave] === undefined) {
      process.env[chave] = valor;
    }
  });
}

carregarEnvLocal();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error('SUPABASE_URL ou SUPABASE_ANON_KEY nao definidos. Configure no arquivo .env');
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

module.exports = { supabase };
