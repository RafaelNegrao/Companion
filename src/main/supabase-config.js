// Configuracao segura do Supabase via .env
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { createClient } = require('@supabase/supabase-js');

function carregarEnvLocal() {
  const envPath = path.join(__dirname, '../../.env');
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

// Storage customizado: persiste a sessao do Supabase Auth num arquivo dentro
// da pasta de dados do usuario (nao existe localStorage no processo main).
// Gravacao atomica (arquivo .tmp + rename) porque o autoRefreshToken escreve
// sozinho em background a cada renovacao de token — se o processo morrer no
// meio de um writeFileSync direto, o JSON corrompe e a sessao "some" mesmo
// com o refresh_token ainda valido do lado do Supabase.
const sessionPath = path.join(app.getPath('userData'), 'supabase-session.json');

const fileStorage = {
  getItem(key) {
    try {
      const dados = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
      return Object.prototype.hasOwnProperty.call(dados, key) ? dados[key] : null;
    } catch {
      return null;
    }
  },
  setItem(key, value) {
    let dados = {};
    try {
      dados = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    } catch {
      dados = {};
    }
    dados[key] = value;

    const tmpPath = `${sessionPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(dados));
    fs.renameSync(tmpPath, sessionPath);
  },
  removeItem(key) {
    let dados = {};
    try {
      dados = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));
    } catch {
      return;
    }
    delete dados[key];

    const tmpPath = `${sessionPath}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(dados));
    fs.renameSync(tmpPath, sessionPath);
  }
};

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
    storage: fileStorage
  }
});

module.exports = { supabase };
