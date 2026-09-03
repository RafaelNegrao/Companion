// Importa database/bdpedidos.json (banco antigo) para o Supabase novo.
// Uso: node database/import-legacy.js
//
// Requer no .env (raiz do projeto): SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.
// A service_role key ignora RLS, entao a importacao nao esbarra nas policies.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

function carregarEnvLocal() {
  const envPath = path.join(__dirname, '..', '.env');
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
    if ((valor.startsWith('"') && valor.endsWith('"')) || (valor.startsWith("'") && valor.endsWith("'"))) {
      valor = valor.slice(1, -1);
    }
    if (process.env[chave] === undefined) process.env[chave] = valor;
  });
}

carregarEnvLocal();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const AUTH_PEPPER = process.env.APP_AUTH_PEPPER || '';

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao definidos no .env');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

// Mapa de login antigo ("xxx@aux") -> email real usado como novo login.
// Quando nao ha email real cadastrado nas Configuracoes do usuario, mantem o login antigo.
const EMAIL_OVERRIDE = {
  'fellipe_negrao@aux': 'fellipeakamine1@gmail.com',
  'leonardo_negrao@aux': 'masterplussantaines@gmail.com',
  'rafael_negrao@aux': 'paranagua@acbdigital.com.br'
  // 'clara_negrao@aux' nao tem e-mail real cadastrado no JSON antigo -> mantem '@aux'
};

function hashPassword(password, pepper) {
  const salt = crypto.randomBytes(16);
  const peppered = `${String(password)}${pepper}`;
  const key = crypto.scryptSync(peppered, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}

function numOrNull(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(String(v).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function textOrNull(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function mapConfiguracoes(email, cfg) {
  if (!cfg) return null;
  return {
    usuario: email,
    agente: textOrNull(cfg['AGENTE']),
    cod_rev: textOrNull(cfg['COD REV']),
    email: textOrNull(cfg['E-MAIL']),
    senha_email: textOrNull(cfg['SENHA EMAIL']),
    pasta_principal: textOrNull(cfg['DIRETORIO-RAIZ']),
    modo_pasta: textOrNull(cfg['MODO PASTA']) || 'PEDIDO',
    sac_cliente: textOrNull(cfg['SAC']),
    tela_cheia: textOrNull(cfg['TELEFONE ALO PARCEIRO']),
    porcentagem_validacao: numOrNull(cfg['PORCENTAGEM']),
    porcentagem_venda: numOrNull(cfg['PORCENTAGEM VENDA']),
    desconto_total: numOrNull(cfg['DESCONTO TOTAL']),
    imposto_validacao: numOrNull(cfg['IMPOSTO VALIDACAO']),
    desconto_validacao: numOrNull(cfg['DESCONTO VALIDACAO'])
  };
}

function mapPedido(email, numeroChave, p) {
  const numeroPedido = textOrNull(p['PEDIDO']) || textOrNull(numeroChave);
  if (!numeroPedido) return null;

  return {
    usuario: email,
    pedido: numeroPedido,
    data: textOrNull(p['DATA']),
    hora: textOrNull(p['HORA']),
    versao: textOrNull(p['VERSAO']),
    modalidade: textOrNull(p['MODALIDADE']),
    venda: (textOrNull(p['VENDA']) || 'NAO').toLowerCase() === 'sim' ? 'sim' : 'nao',
    preco_certificado: numOrNull(p['PRECO CERTIFICADO']),
    comissao: numOrNull(p['PRECO']),
    status: textOrNull(p['STATUS']),

    nome: textOrNull(p['NOME']),
    nascimento: textOrNull(p['NASCIMENTO']),
    email: textOrNull(p['EMAIL']),
    telefone: textOrNull(p['TELEFONE']),
    mae: textOrNull(p['MAE']),
    cpf: textOrNull(p['CPF']),
    rg: textOrNull(p['RG']),
    orgao_rg: textOrNull(p['ORGAO RG']),
    cnh: textOrNull(p['CNH']),
    codigo_de_seg_cnh: textOrNull(p['CODIGO DE SEG CNH']),

    certificado: textOrNull(p['CERTIFICADO']),
    digito_cpf: textOrNull(p['DIGITO CPF']),

    cnpj: textOrNull(p['CNPJ']),
    situacao_cadastral: textOrNull(p['SITUACAO CADASTRAL']),
    data_situacao_cadastral: textOrNull(p['DATA SITUACAO CADASTRAL']),
    razao_social: textOrNull(p['RAZAO SOCIAL']),
    nome_fantasia: textOrNull(p['NOME FANTASIA']),
    data_abertura: textOrNull(p['DATA ABERTURA']),
    capital_social: textOrNull(p['CAPITAL SOCIAL']),
    cep: textOrNull(p['CEP']),
    municipio: textOrNull(p['MUNICIPIO']),
    uf: textOrNull(p['UF']),
    bairro: textOrNull(p['BAIRRO']),
    logradouro: textOrNull(p['LOGRADOURO']),
    complemento: textOrNull(p['COMPLEMENTO']),
    junta: textOrNull(p['JUNTA']),
    diretorio: textOrNull(p['DIRETORIO']),
    pasta: textOrNull(p['PASTA']),

    comentarios: textOrNull(p['COMENTARIOS']),

    valido_ate: textOrNull(p['VALIDO ATE']),
    email_renovacao: textOrNull(p['EMAIL RENOVACAO']),
    tipo: textOrNull(p['TIPO'])
  };
}

async function upsertEmLotes(table, rows, onConflict, tamanhoLote = 500) {
  let total = 0;
  for (let i = 0; i < rows.length; i += tamanhoLote) {
    const lote = rows.slice(i, i + tamanhoLote);
    const { error } = await supabase.from(table).upsert(lote, { onConflict });
    if (error) {
      console.error(`Erro ao importar lote ${i}-${i + lote.length} em "${table}":`, error.message);
      throw error;
    }
    total += lote.length;
    console.log(`  -> ${table}: ${total}/${rows.length}`);
  }
}

async function main() {
  const jsonPath = path.join(__dirname, 'bdpedidos.json');
  console.log('Lendo', jsonPath);
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));

  const usuariosAntigos = raw.Usuario || {};
  const certificadosAntigos = raw.Configuracoes?.Certificados || {};

  // 1) USUARIOS
  const usuariosRows = [];
  const loginFinalPorChaveAntiga = {};

  for (const [chaveAntiga, u] of Object.entries(usuariosAntigos)) {
    const emailFinal = EMAIL_OVERRIDE[chaveAntiga] || chaveAntiga;
    loginFinalPorChaveAntiga[chaveAntiga] = emailFinal;

    const nome = textOrNull(u.Dados?.Configuracoes?.['AGENTE']) || chaveAntiga.split('@')[0];
    const senhaPlana = textOrNull(u.Senha) || '123456';
    const privilegio = textOrNull(u.Privilegio) || 'usuario';

    usuariosRows.push({
      nome,
      email: emailFinal,
      senha: hashPassword(senhaPlana, AUTH_PEPPER),
      privilegio
    });
  }

  console.log(`\n1) Importando ${usuariosRows.length} usuarios...`);
  await upsertEmLotes('usuarios', usuariosRows, 'email');

  // 2) CONFIGURACOES
  const configRows = [];
  for (const [chaveAntiga, u] of Object.entries(usuariosAntigos)) {
    const emailFinal = loginFinalPorChaveAntiga[chaveAntiga];
    const cfg = mapConfiguracoes(emailFinal, u.Dados?.Configuracoes);
    if (cfg) configRows.push(cfg);
  }

  console.log(`\n2) Importando ${configRows.length} configuracoes...`);
  await upsertEmLotes('configuracoes', configRows, 'usuario');

  // 3) CERTIFICADOS (catalogo global, vem de Configuracoes.Certificados)
  const certRows = Object.entries(certificadosAntigos).map(([nome, c]) => ({
    nome,
    valor: numOrNull(c['VALOR']) || 0,
    link_venda: textOrNull(c['LINK VENDA'])
  }));

  console.log(`\n3) Importando ${certRows.length} certificados...`);
  await upsertEmLotes('certificados', certRows, 'nome');

  // 4) PEDIDOS
  let totalPedidosIgnorados = 0;
  for (const [chaveAntiga, u] of Object.entries(usuariosAntigos)) {
    const emailFinal = loginFinalPorChaveAntiga[chaveAntiga];
    const pedidosAntigos = u.Dados?.Pedidos || {};
    const pedidosRows = [];
    const numerosVistos = new Set();

    for (const [chavePedido, p] of Object.entries(pedidosAntigos)) {
      const row = mapPedido(emailFinal, chavePedido, p);
      if (!row) {
        totalPedidosIgnorados++;
        continue;
      }
      // Garante unicidade (usuario, pedido) dentro do proprio lote de importacao
      if (numerosVistos.has(row.pedido)) {
        row.pedido = `${row.pedido}-dup${numerosVistos.size}`;
      }
      numerosVistos.add(row.pedido);
      pedidosRows.push(row);
    }

    console.log(`\n4) Importando ${pedidosRows.length} pedidos de ${emailFinal} (era ${chaveAntiga})...`);
    await upsertEmLotes('pedidos', pedidosRows, 'usuario,pedido');
  }

  if (totalPedidosIgnorados > 0) {
    console.log(`\nAviso: ${totalPedidosIgnorados} pedidos sem numero foram ignorados (registros vazios/corrompidos no JSON antigo).`);
  }

  console.log('\nImportacao concluida com sucesso.');
  console.log('\nLogins finais:');
  for (const [antigo, novo] of Object.entries(loginFinalPorChaveAntiga)) {
    console.log(`  ${antigo}  ->  ${novo}`);
  }
  console.log('\nAs senhas foram migradas com o hash scrypt (mesma senha de antes). Use a senha original de cada usuario para logar.');
}

main().catch((err) => {
  console.error('\nFalha na importacao:', err);
  process.exit(1);
});
