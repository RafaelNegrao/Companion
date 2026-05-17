const { app, BrowserWindow, screen, ipcMain, shell, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const Store = require('./store');
const crud = require('./crud');

let mainWindow;
let loginWindow;
let obsWindow;
let isLocked = false;
let hideTimeout;
let store;

const TRIGGER_WIDTH = 50; // Largura da Ã¡rea de gatilho em pixels
const TRIGGER_HEIGHT = 80; // Altura da seta
const ANIMATION_DURATION = 180; // DuraÃ§Ã£o da animaÃ§Ã£o em ms
const ANIMATION_STEPS = 15; // NÃºmero de passos da animaÃ§Ã£o

// FunÃ§Ã£o de easing (ease-out cubic)
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// FunÃ§Ã£o de easing (ease-in cubic)
function easeInCubic(t) {
  return t * t * t;
}

// AnimaÃ§Ã£o de abrir janela (apenas slide horizontal + fade)
function animateWindowOpen(window, targetBounds, callback) {
  if (!window || window.isDestroyed()) {
    if (callback) callback();
    return;
  }

  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const startX = width + 50; // ComeÃ§a fora da tela

  let step = 0;
  const interval = ANIMATION_DURATION / ANIMATION_STEPS;

  // Define tamanho final imediatamente, sÃ³ anima posiÃ§Ã£o
  window.setBounds({
    x: startX,
    y: targetBounds.y,
    width: targetBounds.width,
    height: targetBounds.height
  });
  window.setOpacity(0);

  const animate = setInterval(() => {
    step++;
    const progress = easeOutCubic(step / ANIMATION_STEPS);

    const currentX = Math.floor(startX + (targetBounds.x - startX) * progress);

    window.setOpacity(progress);
    window.setBounds({
      x: currentX,
      y: targetBounds.y,
      width: targetBounds.width,
      height: targetBounds.height
    });

    if (step >= ANIMATION_STEPS) {
      clearInterval(animate);
      window.setOpacity(1);
      window.setBounds(targetBounds);
      if (callback) callback();
    }
  }, interval);
}

// AnimaÃ§Ã£o de fechar janela (apenas slide horizontal + fade)
function animateWindowClose(window, callback) {
  if (!window || window.isDestroyed()) {
    if (callback) callback();
    return;
  }

  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const startBounds = window.getBounds();
  const endX = width + 50;

  let step = 0;
  const interval = ANIMATION_DURATION / ANIMATION_STEPS;

  const animate = setInterval(() => {
    step++;
    const progress = easeInCubic(step / ANIMATION_STEPS);

    const currentX = Math.floor(startBounds.x + (endX - startBounds.x) * progress);

    window.setOpacity(1 - progress);
    window.setBounds({
      x: currentX,
      y: startBounds.y,
      width: startBounds.width,
      height: startBounds.height
    });

    if (step >= ANIMATION_STEPS) {
      clearInterval(animate);
      window.setOpacity(0);
      if (callback) callback();
    }
  }, interval);
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const TRIGGER_MARGIN = 10; // Margem do trigger em relaÃ§Ã£o Ã  borda
  
  // Cria janela escondida na borda direita (inicialmente sÃ³ mostra a seta)
  mainWindow = new BrowserWindow({
    width: TRIGGER_WIDTH,
    height: TRIGGER_HEIGHT,
    x: width - TRIGGER_WIDTH - TRIGGER_MARGIN, // Com margem da borda
    y: Math.floor((height - TRIGGER_HEIGHT) / 2), // Centraliza verticalmente
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // Fundo totalmente transparente
    hasShadow: false, // Remove sombra do sistema
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true
    }
  });

  mainWindow.loadFile('index.html');
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true);
  
  // Mostra janela diretamente (trigger area nÃ£o precisa animaÃ§Ã£o)
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
}

function expandWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const WINDOW_WIDTH = Math.floor(width * 0.4);
  const MARGIN = 15; // Margem das bordas da tela
  
  // Expande instantaneamente (sem animaÃ§Ã£o para evitar problemas de renderizaÃ§Ã£o)
  mainWindow.setBounds({
    width: WINDOW_WIDTH,
    height: height - (MARGIN * 2),
    x: width - WINDOW_WIDTH - MARGIN,
    y: MARGIN
  }, true);
  
  mainWindow.webContents.send('window-state', 'expanded');
}

function collapseWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const TRIGGER_MARGIN = 10;
  
  // Colapsa instantaneamente (sem animaÃ§Ã£o para evitar problemas de renderizaÃ§Ã£o)
  mainWindow.setBounds({
    width: TRIGGER_WIDTH,
    height: TRIGGER_HEIGHT,
    x: width - TRIGGER_WIDTH - TRIGGER_MARGIN,
    y: Math.floor((height - TRIGGER_HEIGHT) / 2)
  }, true);
  
  mainWindow.webContents.send('window-state', 'collapsed');
}

// IPC para controlar o lock
ipcMain.on('toggle-lock', (event, locked) => {
  isLocked = locked;
  if (!locked) {
    collapseWindow();
  }
});

ipcMain.on('expand-window', () => {
  if (!isLocked) {
    clearTimeout(hideTimeout);
    expandWindow();
  }
});

ipcMain.on('collapse-window', () => {
  if (!isLocked) {
    hideTimeout = setTimeout(() => {
      collapseWindow();
    }, 300);
  }
});

ipcMain.on('cancel-hide', () => {
  clearTimeout(hideTimeout);
});

ipcMain.on('close-app', () => {
  app.quit();
});

ipcMain.handle('set-console-enabled', (event, enabled) => {
  const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  if (!targetWindow || targetWindow.isDestroyed()) {
    return { success: false, error: 'Janela principal indisponivel' };
  }

  if (enabled) {
    if (!targetWindow.webContents.isDevToolsOpened()) {
      targetWindow.webContents.openDevTools({ mode: 'detach' });
    }
  } else if (targetWindow.webContents.isDevToolsOpened()) {
    targetWindow.webContents.closeDevTools();
  }

  return { success: true, enabled: Boolean(enabled) };
});

// Criar janela de login
function createLoginWindow() {
  const loginWidth = 800;
  const loginHeight = 700;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  
  loginWindow = new BrowserWindow({
    width: loginWidth,
    height: loginHeight,
    x: Math.floor((width - loginWidth) / 2),
    y: Math.floor((height - loginHeight) / 2),
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      contextIsolation: false,
      nodeIntegration: true
    }
  });

  loginWindow.loadFile('login.html');
  
  // Mostra janela diretamente
  loginWindow.once('ready-to-show', () => {
    loginWindow.show();
  });
}

// Criar janela de observaÃ§Ãµes
function createObsWindow() {
  if (obsWindow) {
    obsWindow.focus();
    return;
  }

  const obsWidth = 600;
  const obsHeight = 500;
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;

  obsWindow = new BrowserWindow({
    width: obsWidth,
    height: obsHeight,
    x: Math.floor((width - obsWidth) / 2),
    y: Math.floor((height - obsHeight) / 2),
    frame: false,
    transparent: true,
    resizable: true,
    alwaysOnTop: true,
    parent: mainWindow,
    modal: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  obsWindow.loadFile('observacoes.html');
  
  // Mostra janela diretamente
  obsWindow.once('ready-to-show', () => {
    obsWindow.show();
  });

  obsWindow.on('closed', () => {
    obsWindow = null;
  });
}

// Handler para abrir janela de observaÃ§Ãµes
ipcMain.on('open-obs-window', () => {
  createObsWindow();
});

// Handler para fechar janela de observaÃ§Ãµes
ipcMain.on('close-obs-window', (event, content) => {
  if (obsWindow) {
    obsWindow.close();
    obsWindow = null;
  }
  // Notifica a janela principal sobre o conteÃºdo
  if (mainWindow) {
    mainWindow.webContents.send('obs-content-updated', content);
  }
});

// Handler para login bem-sucedido
let currentUser = null; // Armazena dados do usuÃ¡rio logado

ipcMain.on('login-success', (event, userData) => {
  currentUser = sanitizeUser(userData) || userData; // Salva dados minimizados
  console.log('UsuÃ¡rio logado:', currentUser);
  
  if (loginWindow) {
    loginWindow.close();
    loginWindow = null;
  }
  createWindow();
});

// Handler para obter dados do usuÃ¡rio atual
ipcMain.handle('get-current-user', async () => {
  return currentUser;
});

function getUsuarioSessao(usuarioInformado) {
  if (typeof usuarioInformado === 'string' && usuarioInformado.trim()) {
    return usuarioInformado.trim();
  }

  if (usuarioInformado && typeof usuarioInformado === 'object' && usuarioInformado.email) {
    return usuarioInformado.email.trim();
  }

  return currentUser?.email || null;
}

function timingSafeStringEqual(a, b) {
  const aBuf = Buffer.from(String(a || ''), 'utf8');
  const bBuf = Buffer.from(String(b || ''), 'utf8');
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

function getAuthPepper() {
  return process.env.APP_AUTH_PEPPER || '';
}

function hashPassword(password, saltHex = null) {
  const salt = saltHex ? Buffer.from(saltHex, 'hex') : crypto.randomBytes(16);
  const peppered = `${String(password)}${getAuthPepper()}`;
  const key = crypto.scryptSync(peppered, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  });

  return `scrypt$16384$8$1$${salt.toString('hex')}$${key.toString('hex')}`;
}

function verifyPassword(password, storedPassword) {
  const stored = String(storedPassword || '');
  if (!stored) return false;

  if (!stored.startsWith('scrypt$')) {
    return timingSafeStringEqual(stored, password);
  }

  const parts = stored.split('$');
  if (parts.length !== 6) return false;

  const [, nStr, rStr, pStr, saltHex, hashHex] = parts;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (!N || !r || !p || !saltHex || !hashHex) return false;

  const peppered = `${String(password)}${getAuthPepper()}`;
  const computed = crypto.scryptSync(peppered, Buffer.from(saltHex, 'hex'), 64, {
    N,
    r,
    p,
    maxmem: 64 * 1024 * 1024
  });

  const storedHash = Buffer.from(hashHex, 'hex');
  if (storedHash.length !== computed.length) return false;
  return crypto.timingSafeEqual(storedHash, computed);
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    nome: user.nome,
    email: user.email,
    privilegio: user.privilegio || 'usuario'
  };
}

ipcMain.handle('auth-login', async (event, { email, password }) => {
  try {
    const emailNorm = String(email || '').trim().toLowerCase();
    const senha = String(password || '');

    if (!emailNorm || !senha) {
      return { success: false, error: 'Credenciais invÃ¡lidas' };
    }

    const { data: usuario, error } = await crud.findOne('usuarios', {
      columns: 'id, nome, email, senha, privilegio',
      filters: { email: emailNorm }
    });

    if (error) {
      console.error('Erro ao autenticar usuÃ¡rio:', error);
      return { success: false, error: 'Falha na autenticaÃ§Ã£o' };
    }

    if (!usuario || !verifyPassword(senha, usuario.senha)) {
      return { success: false, error: 'Email ou senha incorretos' };
    }

    if (!String(usuario.senha || '').startsWith('scrypt$')) {
      const senhaHash = hashPassword(senha);
      const { error: migraErro } = await crud.update('usuarios', { senha: senhaHash }, {
        filters: { id: usuario.id },
        columns: false
      });

      if (migraErro) {
        console.warn('Falha ao migrar senha legada para hash:', migraErro.message);
      }
    }

    return { success: true, data: sanitizeUser(usuario) };
  } catch (err) {
    console.error('Erro inesperado no auth-login:', err);
    return { success: false, error: 'Falha na autenticaÃ§Ã£o' };
  }
});

ipcMain.handle('auth-register', async (event, { nome, email, senha, privilegio = 'usuario' }) => {
  try {
    const nomeNorm = String(nome || '').trim();
    const emailNorm = String(email || '').trim().toLowerCase();
    const senhaNorm = String(senha || '');
    const privNorm = String(privilegio || 'usuario').trim().toLowerCase() || 'usuario';

    if (!nomeNorm || !emailNorm || !senhaNorm) {
      return { success: false, error: 'Dados obrigatÃ³rios ausentes' };
    }

    const { data: existente, error: erroBusca } = await crud.findOne('usuarios', {
      columns: 'id',
      filters: { email: emailNorm }
    });

    if (erroBusca) {
      console.error('Erro ao verificar e-mail existente:', erroBusca);
      return { success: false, error: 'Falha ao cadastrar usuÃ¡rio' };
    }

    if (existente) {
      return { success: false, error: 'Este email jÃ¡ estÃ¡ cadastrado' };
    }

    const senhaHash = hashPassword(senhaNorm);
    const { data: novoUsuario, error: erroInsert } = await crud.insert('usuarios', {
        nome: nomeNorm,
        email: emailNorm,
        senha: senhaHash,
        privilegio: privNorm
      }, {
        columns: 'id, nome, email, privilegio',
        single: true
      });

    if (erroInsert) {
      console.error('Erro ao criar usuÃ¡rio:', erroInsert);
      return { success: false, error: 'Falha ao cadastrar usuÃ¡rio' };
    }

    return { success: true, data: sanitizeUser(novoUsuario) };
  } catch (err) {
    console.error('Erro inesperado no auth-register:', err);
    return { success: false, error: 'Falha ao cadastrar usuÃ¡rio' };
  }
});

// Handlers para "lembrar-me"
ipcMain.handle('save-credentials', async (event, { email, password, remember }) => {
  if (remember) {
    const emailNorm = String(email || '').trim();
    const senha = String(password || '');

    let passwordEnc = '';
    if (senha && safeStorage?.isEncryptionAvailable?.()) {
      passwordEnc = safeStorage.encryptString(senha).toString('base64');
    } else {
      // Fallback legado para ambientes sem cofre nativo
      passwordEnc = Buffer.from(senha, 'utf8').toString('base64');
    }

    store.set('rememberedUser', {
      email: emailNorm,
      passwordEnc,
      encrypted: Boolean(safeStorage?.isEncryptionAvailable?.()),
      v: 2
    });
  } else {
    store.delete('rememberedUser');
  }
  return true;
});

ipcMain.handle('get-credentials', async () => {
  const saved = store.get('rememberedUser') || null;
  if (!saved) return null;

  // Compatibilidade com formato antigo
  if (saved.email && saved.password) {
    return { email: saved.email, password: saved.password };
  }

  const email = String(saved.email || '').trim();
  const encoded = String(saved.passwordEnc || '');
  if (!email || !encoded) return { email };

  try {
    const raw = Buffer.from(encoded, 'base64');
    const password = saved.encrypted && safeStorage?.isEncryptionAvailable?.()
      ? safeStorage.decryptString(raw)
      : raw.toString('utf8');

    return { email, password };
  } catch (err) {
    console.warn('Falha ao descriptografar credenciais salvas:', err.message);
    return { email };
  }
});

ipcMain.handle('clear-credentials', async () => {
  store.delete('rememberedUser');
  return true;
});

// Handler para buscar pedido no Supabase
ipcMain.handle('buscar-pedido', async (event, numeroPedido) => {
  try {
    const { data, error } = await crud.select('pedidos', {
      columns: '*',
      filters: { pedido: numeroPedido },
      order: { column: 'id', ascending: false },
      limit: 1
    });

    if (error) {
      console.error('Erro ao buscar pedido:', error);
      return { success: false, error: error.message };
    }

    const pedido = data?.[0] || null;
    if (!pedido) {
      console.log('Pedido nÃ£o encontrado:', numeroPedido);
      return { success: true, data: null };
    }

    console.log('Pedido encontrado:', pedido);
    const usuarioPedido = pedido.usuario || currentUser?.email;
    let pastaInfo = null;

    if (usuarioPedido) {
      const rootPath = pedido.diretorio || getPastaRaizUsuario(usuarioPedido);
      const clientPath = pedido.pasta || getPastaClientePedido(usuarioPedido, pedido.pedido);

      pastaInfo = {
        rootPath,
        clientPath,
        rootExists: fs.existsSync(rootPath),
        exists: fs.existsSync(clientPath)
      };
    }

    return { success: true, data: { ...pedido, pasta_info: pastaInfo } };
  } catch (err) {
    console.error('Erro na busca:', err);
    return { success: false, error: err.message };
  }
});

// Handler para buscar pessoa por CPF no Supabase
ipcMain.handle('buscar-por-cpf', async (event, cpf) => {
  try {
    console.log('ðŸ” Buscando CPF no banco:', cpf);
    
    const { data, error } = await crud.select('pedidos', {
      columns: 'nome, nascimento, email, telefone, mae',
      filters: { cpf },
      order: { column: 'created_at', ascending: false },
      limit: 1
    });

    if (error) {
      console.error('Erro ao buscar por CPF:', error);
      return { success: false, error: error.message };
    }

    if (!data || data.length === 0) {
      console.log('Nenhum registro encontrado para o CPF:', cpf);
      return { success: true, data: null };
    }

    console.log('âœ… Dados encontrados para CPF:', data[0]);
    return { success: true, data: data[0] };
  } catch (err) {
    console.error('Erro na busca por CPF:', err);
    return { success: false, error: err.message };
  }
});

// Handler para salvar/atualizar pedido no Supabase
ipcMain.handle('salvar-pedido', async (event, pedidoData) => {
  try {
    const { data: existente, error: existeError } = await crud.select('pedidos', {
      columns: 'id',
      filters: { pedido: pedidoData.pedido },
      limit: 1
    });

    if (existeError) {
      console.error('Erro ao verificar pedido antes de salvar:', existeError);
      return { success: false, error: existeError.message };
    }

    let data, error;
    
    if (existente && existente.length > 0) {
      pedidoData.id = existente[0].id;
      const result = await crud.update('pedidos', pedidoData, {
        filters: { id: pedidoData.id },
        single: true
      });
      data = result.data;
      error = result.error;
    } else {
      const result = await crud.insert('pedidos', pedidoData, {
        single: true
      });
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error('Erro ao salvar pedido:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data, action: existente?.length ? 'updated' : 'created' };
  } catch (err) {
    console.error('Erro ao salvar pedido:', err);
    return { success: false, error: err.message };
  }
});

// Handler para buscar certificados do Supabase
ipcMain.handle('buscar-certificados', async () => {
  try {
    const { data, error } = await crud.select('certificados', {
      columns: 'nome, valor, link_venda',
      order: { column: 'nome', ascending: true }
    });

    if (error) {
      console.error('Erro ao buscar certificados:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    console.error('Erro na busca de certificados:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('salvar-certificado', async (event, certificado) => {
  try {
    const nome = String(certificado?.nome || '').trim();
    const linkVenda = String(certificado?.link_venda || '').trim() || null;
    const valorNumerico = Number(certificado?.valor || 0);
    const valor = Number.isFinite(valorNumerico) ? valorNumerico : 0;

    if (!nome) {
      return { success: false, error: 'Nome do certificado Ã© obrigatÃ³rio.' };
    }

    const { data: existente, error: erroBusca } = await crud.findOne('certificados', {
      columns: 'nome',
      filters: { nome }
    });

    if (erroBusca) {
      console.error('Erro ao verificar certificado existente:', erroBusca);
      return { success: false, error: erroBusca.message };
    }

    const tipo = String(certificado?.tipo || '').trim() || null;

    const payload = {
      nome,
      valor,
      link_venda: linkVenda,
      tipo
    };

    const { data, error } = await crud.upsert('certificados', payload, {
      onConflict: 'nome',
      maybeSingle: true
    });

    if (error) {
      console.error('Erro ao salvar certificado:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data,
      action: existente ? 'updated' : 'created'
    };
  } catch (err) {
    console.error('Erro geral ao salvar certificado:', err);
    return { success: false, error: err.message };
  }
});

// Handler para buscar configuraÃ§Ãµes do Supabase
ipcMain.handle('excluir-certificado', async (event, nomeCertificado) => {
  try {
    const nome = String(nomeCertificado || '').trim();
    if (!nome) {
      return { success: false, error: 'Nome do certificado Ã© obrigatÃ³rio.' };
    }

    const { error } = await crud.remove('certificados', {
      filters: { nome }
    });

    if (error) {
      console.error('Erro ao excluir certificado:', error);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    console.error('Erro geral ao excluir certificado:', err);
    return { success: false, error: err.message };
  }
});

ipcMain.handle('buscar-configuracoes', async (event, usuario) => {
  try {
    const usuarioSessao = getUsuarioSessao(usuario);

    if (!usuarioSessao) {
      return { success: false, error: 'UsuÃ¡rio logado nÃ£o encontrado' };
    }

    const usuarioFiltro = currentUser?.id
      ? { id: currentUser.id }
      : { email: usuarioSessao };

    const { data: usuarioData, error: usuarioError } = await crud.findOne('usuarios', {
      columns: 'id, nome, email, privilegio',
      filters: usuarioFiltro
    });

    if (usuarioError) {
      console.error('Erro ao buscar usuÃ¡rio:', usuarioError);
      return { success: false, error: usuarioError.message };
    }

    const usuarioEmail = usuarioData?.email || usuarioSessao;

    const { data, error } = await crud.findOne('configuracoes', {
      columns: '*',
      filters: { usuario: usuarioEmail }
    });

    if (error) {
      console.error('Erro ao buscar configuraÃ§Ãµes:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        ...(data || {}),
        usuario: usuarioEmail,
        senha: '',
        nome_usuario: usuarioData?.nome || currentUser?.nome || '',
        privilegio: usuarioData?.privilegio || currentUser?.privilegio || ''
      }
    };
  } catch (err) {
    console.error('Erro na busca de configuraÃ§Ãµes:', err);
    return { success: false, error: err.message };
  }
});

// Handler para salvar configuraÃ§Ãµes no Supabase
ipcMain.handle('salvar-configuracoes', async (event, config) => {
  try {
    const usuarioSessao = getUsuarioSessao();
    const usuarioConfig = config?.usuario?.trim() || usuarioSessao;

    if (!usuarioSessao || !usuarioConfig) {
      return { success: false, error: 'UsuÃ¡rio logado nÃ£o encontrado' };
    }

    const senhaLogin = String(config?.senha || '').trim();
    const usuarioUpdate = { email: usuarioConfig };

    if (senhaLogin) {
      usuarioUpdate.senha = hashPassword(senhaLogin);
    }

    const usuarioFiltro = currentUser?.id
      ? { id: currentUser.id }
      : { email: usuarioSessao };

    const { data: usuarioAtualizado, error: usuarioError } = await crud.update('usuarios', usuarioUpdate, {
      filters: usuarioFiltro,
      columns: 'id, nome, email, privilegio',
      single: true
    });

    if (usuarioError) {
      console.error('Erro ao atualizar usuÃ¡rio:', usuarioError);
      return { success: false, error: usuarioError.message };
    }

    currentUser = {
      ...(currentUser || {}),
      ...usuarioAtualizado
    };

    const { senha, nome_usuario, privilegio, ...configuracao } = config;
    const configToSave = {
      ...configuracao,
      usuario: usuarioAtualizado.email
    };

    const { data, error } = await crud.upsert('configuracoes', configToSave, {
      onConflict: 'usuario',
      single: true
    });

    if (error) {
      console.error('Erro ao salvar configuraÃ§Ãµes:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    console.error('Erro ao salvar configuraÃ§Ãµes:', err);
    return { success: false, error: err.message };
  }
});

// Handler para buscar pedidos do Supabase
ipcMain.handle('buscar-pedidos', async (event, filtros = {}) => {
  try {
    const filters = [];

    // Normaliza uma data (YYYY-MM-DD) para o inÃ­cio do dia em UTC
    const normalizarInicioDia = (data) => {
      if (!data) return null;
      const s = String(data).trim().slice(0, 10); // garante apenas YYYY-MM-DD
      return `${s}T00:00:00`;
    };

    // Normaliza uma data (YYYY-MM-DD) para o final do dia em UTC
    const normalizarFimDia = (data) => {
      if (!data) return null;
      const s = String(data).trim().slice(0, 10);
      return `${s}T23:59:59`;
    };

    // Aplicar filtros de data com cobertura total do dia
    if (filtros.dataDe) {
      filters.push({ column: 'data', op: 'gte', value: normalizarInicioDia(filtros.dataDe) });
    }
    if (filtros.dataAte) {
      filters.push({ column: 'data', op: 'lte', value: normalizarFimDia(filtros.dataAte) });
    }
    if (filtros.status) {
      filters.push({ column: 'status', op: 'eq', value: filtros.status });
    }
    
    // Filtra pelo usuario logado (email da aba login)
    const usuarioEmail = filtros.usuario || (currentUser ? currentUser.email : null);
    if (usuarioEmail) {
      filters.push({ column: 'usuario', op: 'eq', value: usuarioEmail });
    }

    const { data, error } = await crud.select('pedidos', {
      columns: '*',
      filters,
      order: { column: 'data', ascending: false }
    });

    if (error) {
      console.error('Erro ao buscar pedidos:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    console.error('Erro na busca de pedidos:', err);
    return { success: false, error: err.message };
  }
});

// Handlers para gerenciamento de pastas de pedidos
function getPastaRaizUsuario(usuario) {
  const usernameLimpo = usuario.split('@')[0];
  return path.join(app.getPath('userData'), 'pedidos', usernameLimpo);
}

function getPastaClientePedido(usuario, pedido) {
  return path.join(getPastaRaizUsuario(usuario), String(pedido).trim());
}

function criarPastaRaizUsuario(usuario) {
  const pastaRaiz = getPastaRaizUsuario(usuario);

  if (!fs.existsSync(pastaRaiz)) {
    fs.mkdirSync(pastaRaiz, { recursive: true });
  }

  return pastaRaiz;
}

function criarPastaClientePedido(usuario, pedido) {
  const pastaRaiz = criarPastaRaizUsuario(usuario);
  const pastaCliente = getPastaClientePedido(usuario, pedido);

  if (!fs.existsSync(pastaCliente)) {
    fs.mkdirSync(pastaCliente, { recursive: true });
  }

  return { pastaRaiz, pastaCliente };
}

async function salvarCaminhosPedidoNoBanco({ usuario, pedido, pastaRaiz, pastaCliente }) {
  const payload = {
    usuario,
    pedido,
    diretorio: pastaRaiz,
    pasta: pastaCliente
  };

  try {
    const { data: existente } = await crud.select('pedidos', {
      columns: 'id',
      filters: { pedido },
      limit: 1
    });

    let data, error;
    if (existente && existente.length > 0) {
      payload.id = existente[0].id;
      const result = await crud.update('pedidos', payload, {
        filters: { id: payload.id },
        single: true
      });
      data = result.data;
      error = result.error;
    } else {
      const result = await crud.insert('pedidos', payload, {
        single: true
      });
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error('Erro ao salvar caminhos da pasta no pedido:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data };
  } catch (err) {
    console.error('Erro ao buscar/salvar pedido existente antes de salvar caminhos:', err);
    return { success: false, error: err.message };
  }
}

ipcMain.handle('verificar-pasta-pedido', async (event, { usuario, pedido }) => {
  if (!usuario || !pedido) return false;
  let pastaCliente = getPastaClientePedido(usuario, pedido);

  try {
    const { data } = await crud.select('pedidos', {
      columns: 'pasta',
      filters: { pedido },
      limit: 1
    });

    pastaCliente = data?.[0]?.pasta || pastaCliente;
  } catch (error) {
    console.error('Erro ao buscar pasta salva para verificaÃƒÂ§ÃƒÂ£o:', error);
  }

  return fs.existsSync(pastaCliente);
});

ipcMain.handle('criar-pasta-pedido', async (event, { usuario, pedido }) => {
  if (!usuario || !pedido) return { success: false, error: 'UsuÃ¡rio ou pedido nÃ£o informado' };
  
  try {
    const { pastaRaiz, pastaCliente } = criarPastaClientePedido(usuario, pedido);
    const dbResult = await salvarCaminhosPedidoNoBanco({ usuario, pedido, pastaRaiz, pastaCliente });

    if (!dbResult.success) {
      return {
        success: false,
        path: pastaCliente,
        rootPath: pastaRaiz,
        clientPath: pastaCliente,
        error: dbResult.error
      };
    }

    return {
      success: true,
      path: pastaCliente,
      rootPath: pastaRaiz,
      clientPath: pastaCliente,
      data: dbResult.data
    };
  } catch (error) {
    console.error('Erro ao criar pasta:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('abrir-pasta-pedido', async (event, { usuario, pedido }) => {
  if (!usuario || !pedido) return false;
  let baseDir = getPastaClientePedido(usuario, pedido);

  try {
    const { data } = await crud.select('pedidos', {
      columns: 'pasta',
      filters: { pedido },
      limit: 1
    });

    baseDir = data?.[0]?.pasta || baseDir;
  } catch (error) {
    console.error('Erro ao buscar pasta salva para abrir:', error);
  }
  
  if (fs.existsSync(baseDir)) {
    shell.openPath(baseDir);
    return true;
  }
  return false;
});

ipcMain.handle('obter-pasta-pedido', async (event, { usuario, pedido }) => {
  if (!usuario || !pedido) return { success: false, error: 'UsuÃ¡rio ou pedido nÃ£o informado' };

  let pastaRaiz = getPastaRaizUsuario(usuario);
  let pastaCliente = getPastaClientePedido(usuario, pedido);

  try {
    const { data } = await crud.select('pedidos', {
      columns: 'diretorio, pasta',
      filters: { pedido },
      limit: 1
    });

    const pedidoDb = data?.[0];
    pastaRaiz = pedidoDb?.diretorio || pastaRaiz;
    pastaCliente = pedidoDb?.pasta || pastaCliente;
  } catch (error) {
    console.error('Erro ao buscar caminho salvo do pedido:', error);
  }

  return {
    success: true,
    path: pastaCliente,
    rootPath: pastaRaiz,
    clientPath: pastaCliente,
    rootExists: fs.existsSync(pastaRaiz),
    exists: fs.existsSync(pastaCliente)
  };
});

ipcMain.handle('obter-pasta-usuario', async (event, { usuario }) => {
  if (!usuario) return { success: false, error: 'UsuÃ¡rio nÃ£o informado' };

  const baseDir = getPastaRaizUsuario(usuario);
  return {
    success: true,
    path: baseDir,
    exists: fs.existsSync(baseDir)
  };
});

ipcMain.handle('abrir-pasta-usuario', async (event, { usuario }) => {
  if (!usuario) return { success: false, error: 'UsuÃ¡rio nÃ£o informado' };

  try {
    const baseDir = criarPastaRaizUsuario(usuario);
    const errorMessage = await shell.openPath(baseDir);
    return {
      success: !errorMessage,
      exists: true,
      path: baseDir,
      error: errorMessage || null
    };
  } catch (error) {
    console.error('Erro ao criar pasta do usuÃ¡rio:', error);
    return { success: false, exists: false, path: getPastaRaizUsuario(usuario), error: error.message };
  }
});

ipcMain.handle('salvar-anexo-pedido', async (event, { usuario, pedido, filePath, fileName }) => {
  if (!usuario || !pedido || !filePath) return { success: false, error: 'Dados incompletos' };
  
  try {
    const { pastaRaiz, pastaCliente: baseDir } = criarPastaClientePedido(usuario, pedido);
    const dbResult = await salvarCaminhosPedidoNoBanco({
      usuario,
      pedido,
      pastaRaiz,
      pastaCliente: baseDir
    });

    if (!dbResult.success) {
      return { success: false, error: dbResult.error };
    }

    const destPath = path.join(baseDir, fileName);
    fs.copyFileSync(filePath, destPath);
    return {
      success: true,
      fileName,
      path: destPath,
      rootPath: pastaRaiz,
      clientPath: baseDir
    };
  } catch (error) {
    console.error('Erro ao salvar anexo:', error);
    return { success: false, error: error.message };
  }
});

// Nova funÃ§Ã£o que aceita conteÃºdo de arquivo como Buffer
ipcMain.handle('salvar-anexo-pedido-conteudo', async (event, { usuario, pedido, fileName, conteudo }) => {
  if (!usuario || !pedido || !fileName) return { success: false, error: 'Dados incompletos' };
  
  try {
    const { pastaRaiz, pastaCliente: baseDir } = criarPastaClientePedido(usuario, pedido);
    const dbResult = await salvarCaminhosPedidoNoBanco({
      usuario,
      pedido,
      pastaRaiz,
      pastaCliente: baseDir
    });

    if (!dbResult.success) {
      return { success: false, error: dbResult.error };
    }

    const destPath = path.join(baseDir, fileName);
    
    // Se conteudo for string base64, converte
    let buffer = conteudo;
    if (typeof conteudo === 'string') {
      buffer = Buffer.from(conteudo, 'base64');
    } else if (Array.isArray(conteudo)) {
      buffer = Buffer.from(conteudo);
    }
    
    fs.writeFileSync(destPath, buffer);
    return {
      success: true,
      fileName,
      path: destPath,
      rootPath: pastaRaiz,
      clientPath: baseDir
    };
  } catch (error) {
    console.error('Erro ao salvar anexo com conteÃºdo:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('listar-anexos-pedido', async (event, { usuario, pedido }) => {
  if (!usuario || !pedido) return [];
  let baseDir = getPastaClientePedido(usuario, pedido);

  try {
    const { data } = await crud.select('pedidos', {
      columns: 'pasta',
      filters: { pedido },
      limit: 1
    });

    baseDir = data?.[0]?.pasta || baseDir;
  } catch (error) {
    console.error('Erro ao buscar pasta salva para listar anexos:', error);
  }
  
  try {
    if (fs.existsSync(baseDir)) {
      const files = fs.readdirSync(baseDir);
      return files.map(file => ({
        name: file,
        path: path.join(baseDir, file),
        type: path.extname(file).toLowerCase() === '.pdf' ? 'application/pdf' : 'image/jpeg'
      }));
    }
    return [];
  } catch (error) {
    console.error('Erro ao listar anexos:', error);
    return [];
  }
});

ipcMain.handle('excluir-anexo-pedido', async (event, { filePath }) => {
  if (!filePath) return { success: false, error: 'Caminho do arquivo nÃ£o informado' };
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { success: false, error: 'Arquivo nÃ£o encontrado no disco' };
  } catch (error) {
    console.error('Erro ao excluir arquivo:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('excluir-pasta-pedido', async (event, { usuario, pedido }) => {
  if (!usuario || !pedido) return { success: false, error: 'Dados incompletos' };
  const baseDir = getPastaClientePedido(usuario, pedido);
  
  try {
    if (fs.existsSync(baseDir)) {
      fs.rmSync(baseDir, { recursive: true, force: true });
      return { success: true };
    }
    return { success: true, message: 'Pasta nÃ£o existia' };
  } catch (error) {
    console.error('Erro ao excluir pasta:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('abrir-arquivo', async (event, filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return false;
  try {
    shell.openPath(filePath);
    return true;
  } catch (error) {
    console.error('Erro ao abrir arquivo:', error);
    return false;
  }
});

app.whenReady().then(() => {
  store = new Store();
  createLoginWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createLoginWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});


