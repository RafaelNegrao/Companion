// No Windows, dependendo de qual terminal roda o app (conhost, ConPTY da VS
// Code, etc.), acentos escritos em UTF-8 pelo console.log saem virando
// "├ç├úo" e afins — e mudar a code page do console (chcp) nem sempre
// resolve, porque alguns terminais nao decodificam por code page de jeito
// nenhum. A unica forma de garantir que o log sai legivel em qualquer
// terminal e nunca escrever o acento: intercepta console.log/error/warn/info
// aqui em cima, antes de qualquer outro modulo logar algo, e tira os acentos
// de toda string antes de imprimir.
function removerAcentos(texto) {
  // Evita colar os caracteres de acento combinante direto no fonte (o
  // proprio editor/terminal que grava este arquivo pode corromper esse
  // trecho do jeito que estamos tentando corrigir); filtra pela faixa
  // Unicode deles (U+0300-U+036F) em vez disso.
  return Array.from(texto.normalize('NFD'))
    .filter((caractere) => {
      const codigo = caractere.codePointAt(0);
      return codigo < 0x0300 || codigo > 0x036f;
    })
    .join('');
}

['log', 'error', 'warn', 'info'].forEach((metodo) => {
  const original = console[metodo].bind(console);
  console[metodo] = (...args) => {
    original(...args.map((arg) => (typeof arg === 'string' ? removerAcentos(arg) : arg)));
  };
});

const { app, BrowserWindow, screen, ipcMain, shell, safeStorage, desktopCapturer, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Store = require('./store');
const crud = require('./crud');
const { supabase } = require('./supabase-config');
const packageJson = require('../../package.json');
const AppUpdater = require('./updater');

let mainWindow;
let loginWindow;
let obsWindow;
let isLocked = false;
let isLockedPointerIdle = false;
let lockedIdleOpacity = 1;
let isCapturingScreenshot = false;
let hideTimeout;
let store;
let appUpdater; // instancia do AppUpdater; usada tambem no 'will-quit'

const TRIGGER_WIDTH = 50; // Largura da área de gatilho em pixels
const TRIGGER_HEIGHT = 80; // Altura da seta
const ANIMATION_DURATION = 180; // Duração da animação em ms
const ANIMATION_STEPS = 15; // Número de passos da animação

// Função de easing (ease-out cubic)
function easeOutCubic(t) {
  return 1 - Math.pow(1 - t, 3);
}

// Função de easing (ease-in cubic)
function easeInCubic(t) {
  return t * t * t;
}

function normalizarOpacidadePercentual(percentual) {
  const valor = Number(percentual);
  if (!Number.isFinite(valor)) return 1;
  return Math.min(100, Math.max(10, valor)) / 100;
}

function aplicarOpacidadeJanelaPrincipal() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.setOpacity(isLocked && isLockedPointerIdle ? lockedIdleOpacity : 1);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Animação de abrir janela (apenas slide horizontal + fade)
function animateWindowOpen(window, targetBounds, callback) {
  if (!window || window.isDestroyed()) {
    if (callback) callback();
    return;
  }

  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const startX = width + 50; // Começa fora da tela

  let step = 0;
  const interval = ANIMATION_DURATION / ANIMATION_STEPS;

  // Define tamanho final imediatamente, só anima posição
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

// Animação de fechar janela (apenas slide horizontal + fade)
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

function getAutoZoomFactor() {
  const { height } = screen.getPrimaryDisplay().size;
  // Scale down proportionally for screens shorter than 1080p; never scale up.
  return Math.min(1, Math.max(0.6, height / 1080));
}

function createWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const TRIGGER_MARGIN = 4; // Margem sutil da borda lateral
  
  // Cria janela escondida na borda direita (inicialmente só mostra a seta)
  mainWindow = new BrowserWindow({
    width: TRIGGER_WIDTH,
    height: TRIGGER_HEIGHT,
    x: width - TRIGGER_WIDTH - TRIGGER_MARGIN,
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
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: true
    }
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  mainWindow.setAlwaysOnTop(true, 'screen-saver');
  mainWindow.setVisibleOnAllWorkspaces(true);
  
  // Mostra janela diretamente (trigger area não precisa animação)
  mainWindow.once('ready-to-show', () => {
    mainWindow.webContents.setZoomFactor(getAutoZoomFactor());
    mainWindow.show();
  });
}

function expandWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const WINDOW_WIDTH = Math.floor(width * 0.46);
  const MARGIN_RIGHT = 5; // Mais próximo da borda (5px) sem colar totalmente
  const MARGIN_VERT = 8;  // Margem vertical
  
  // Expande instantaneamente (sem animação para evitar problemas de renderização)
  mainWindow.setBounds({
    width: WINDOW_WIDTH,
    height: height - (MARGIN_VERT * 2),
    x: width - WINDOW_WIDTH - MARGIN_RIGHT,
    y: MARGIN_VERT
  }, true);
  
  mainWindow.webContents.send('window-state', 'expanded');
}

function collapseWindow() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const TRIGGER_MARGIN = 4; // Margem sutil da borda lateral
  
  // Colapsa instantaneamente (sem animação para evitar problemas de renderização)
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
  isLockedPointerIdle = false;
  aplicarOpacidadeJanelaPrincipal();
});

ipcMain.on('set-window-idle-opacity', (event, percentual) => {
  lockedIdleOpacity = normalizarOpacidadePercentual(percentual);
  aplicarOpacidadeJanelaPrincipal();
});

ipcMain.on('set-window-pointer-idle', (event, idle) => {
  isLockedPointerIdle = Boolean(idle);
  aplicarOpacidadeJanelaPrincipal();
});

ipcMain.on('expand-window', () => {
  if (!isLocked) {
    clearTimeout(hideTimeout);
    expandWindow();
  }
});

ipcMain.on('collapse-window', () => {
  if (isCapturingScreenshot) return;
  if (!isLocked) {
    hideTimeout = setTimeout(() => {
      if (isCapturingScreenshot) return;
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
  const loginWidth = 900;
  const loginHeight = 580;
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

  loginWindow.loadFile(path.join(__dirname, '../renderer/login.html'));
  
  // Mostra janela diretamente
  loginWindow.once('ready-to-show', () => {
    loginWindow.show();
  });
}

// Criar janela de observações
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
      preload: path.join(__dirname, '../preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  obsWindow.loadFile(path.join(__dirname, '../renderer/observacoes.html'));
  
  // Mostra janela diretamente
  obsWindow.once('ready-to-show', () => {
    obsWindow.show();
  });

  obsWindow.on('closed', () => {
    obsWindow = null;
  });
}

// Handler para abrir janela de observações
ipcMain.on('open-obs-window', () => {
  createObsWindow();
});

// Handler para fechar janela de observações
ipcMain.on('close-obs-window', (event, content) => {
  if (obsWindow) {
    obsWindow.close();
    obsWindow = null;
  }
  // Notifica a janela principal sobre o conteúdo
  if (mainWindow) {
    mainWindow.webContents.send('obs-content-updated', content);
  }
});

// Handler para login bem-sucedido
let currentUser = null; // Armazena dados do usuário logado

ipcMain.on('login-success', (event, userData) => {
  currentUser = sanitizeUser(userData) || userData; // Salva dados minimizados
  console.log('Usuário logado:', currentUser);
  
  if (loginWindow) {
    loginWindow.close();
    loginWindow = null;
  }
  createWindow();
});

// Handler para obter dados do usuário atual
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

// Filtros padrao pra buscar um pedido especifico, sempre restritos ao
// usuario logado (user_id) — evita pegar pedido de outra conta pelo mesmo
// numero (numero de pedido nao e globalmente unico, so por usuario).
function filtrosPedidoAtual(pedido) {
  const filtros = [{ column: 'pedido', op: 'eq', value: pedido }];
  if (currentUser?.id) {
    filtros.push({ column: 'user_id', op: 'eq', value: currentUser.id });
  }
  return filtros;
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

// Traduz os erros tecnicos do Supabase Auth (em ingles) pra mensagens legiveis.
// Ver LOGIN-MULTIUSUARIO.md secao 8.
function traduzirErroAuth(mensagem) {
  const texto = `${mensagem}`.toLowerCase();
  if (texto.includes('invalid login credentials')) return 'Email ou senha incorretos.';
  if (texto.includes('user already registered') || texto.includes('already been registered')) {
    return 'Já existe uma conta com esse e-mail.';
  }
  if (texto.includes('password should be at least')) return 'A senha precisa ter pelo menos 6 caracteres.';
  if (texto.includes('unable to validate email') || texto.includes('invalid format')) return 'E-mail inválido.';
  if (texto.includes('missing email or phone')) return 'Preencha o e-mail.';
  if (texto.includes('token') && (texto.includes('expired') || texto.includes('invalid'))) {
    return 'Código inválido ou expirado - peça um novo.';
  }
  return mensagem;
}

// Busca o perfil (nome/privilegio) na tabela "usuarios", vinculado ao id do
// Supabase Auth. Cai num fallback minimo se o perfil ainda nao existir.
async function carregarPerfilUsuario(authUser) {
  const { data: perfil, error } = await crud.findOne('usuarios', {
    columns: 'id, nome, privilegio',
    filters: { id: authUser.id }
  });

  if (error) {
    console.error('Erro ao carregar perfil do usuário:', error);
  }

  return sanitizeUser({
    id: authUser.id,
    email: authUser.email,
    nome: perfil?.nome || authUser.email,
    privilegio: perfil?.privilegio || 'usuario'
  });
}

ipcMain.handle('auth-login', async (event, { email, password }) => {
  try {
    const emailNorm = String(email || '').trim().toLowerCase();
    const senha = String(password || '');

    if (!emailNorm || !senha) {
      return { success: false, error: 'Credenciais inválidas' };
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: emailNorm,
      password: senha
    });

    if (error || !data?.user) {
      return { success: false, error: traduzirErroAuth(error?.message || 'Falha na autenticação') };
    }

    const usuarioSanitizado = await carregarPerfilUsuario(data.user);
    return { success: true, data: usuarioSanitizado };
  } catch (err) {
    console.error('Erro inesperado no auth-login:', err);
    return { success: false, error: 'Falha na autenticação' };
  }
});

// Cadastro de usuarios. Deixou de ser publico na tela de login: agora so quem
// ja esta autenticado cria conta para outra pessoa, pela aba Configuracoes.
ipcMain.handle('auth-register', async (event, { nome, email, senha }) => {
  try {
    // Sem sessao ativa nao ha cadastro. A tela de login nao chama mais este
    // canal, mas a checagem mora aqui: proteger so na interface nao protege.
    if (!currentUser?.id && !currentUser?.email) {
      return { success: false, error: 'É preciso estar autenticado para criar uma conta.' };
    }

    const nomeNorm = String(nome || '').trim();
    const emailNorm = String(email || '').trim().toLowerCase();
    const senhaNorm = String(senha || '');
    // O privilegio NAO vem mais do renderer. Ele ia parar no user_metadata do
    // signUp, que e controlado pelo cliente — quem tivesse o app instalado
    // poderia criar uma conta 'admin'. Toda conta nova nasce como 'usuario';
    // promover e acao manual no banco (ver database/schema-hardening.sql).
    const privNorm = 'usuario';

    if (!nomeNorm || !emailNorm || !senhaNorm) {
      return { success: false, error: 'Dados obrigatórios ausentes' };
    }

    // signUp() troca a sessao persistida pela do usuario recem-criado — quem
    // estava logado seria deslogado e cairia na conta nova. Guarda os tokens
    // atuais para devolver a sessao logo em seguida.
    const { data: sessaoAntes } = await supabase.auth.getSession();
    const sessaoOperador = sessaoAntes?.session || null;

    const { data, error } = await supabase.auth.signUp({
      email: emailNorm,
      password: senhaNorm,
      options: {
        data: { nome: nomeNorm, privilegio: privNorm }
      }
    });

    if (sessaoOperador?.access_token && sessaoOperador?.refresh_token) {
      try {
        await supabase.auth.setSession({
          access_token: sessaoOperador.access_token,
          refresh_token: sessaoOperador.refresh_token
        });
      } catch (erroSessao) {
        console.error('[auth-register] Falha ao restaurar a sessão do operador:', erroSessao.message);
      }
    }

    if (error || !data?.user) {
      return { success: false, error: traduzirErroAuth(error?.message || 'Falha ao cadastrar usuário') };
    }

    // A linha de perfil em "usuarios" e criada automaticamente por um trigger
    // no banco (on_auth_user_created, ver database/schema-auth.sql), a partir
    // do user_metadata passado acima — funciona mesmo sem sessao ativa ainda
    // (ex: confirmacao de e-mail pendente).

    return {
      success: true,
      data: sanitizeUser({ id: data.user.id, email: emailNorm, nome: nomeNorm, privilegio: privNorm })
    };
  } catch (err) {
    console.error('Erro inesperado no auth-register:', err);
    return { success: false, error: 'Falha ao cadastrar usuário' };
  }
});

ipcMain.handle('auth-logout', async () => {
  try {
    await supabase.auth.signOut();
    currentUser = null;

    if (mainWindow) {
      mainWindow.close();
      mainWindow = null;
    }
    createLoginWindow();

    return { success: true };
  } catch (err) {
    console.error('Erro ao sair:', err);
    return { success: false, error: 'Falha ao sair' };
  }
});

ipcMain.handle('auth-recuperar-senha', async (event, { email }) => {
  try {
    const emailNorm = String(email || '').trim().toLowerCase();
    if (!emailNorm) return { success: false, error: 'Informe o e-mail.' };

    const { error } = await supabase.auth.resetPasswordForEmail(emailNorm);
    if (error) {
      return { success: false, error: traduzirErroAuth(error.message) };
    }
    return { success: true };
  } catch (err) {
    console.error('Erro ao solicitar recuperação de senha:', err);
    return { success: false, error: 'Falha ao solicitar recuperação de senha' };
  }
});

ipcMain.handle('auth-confirmar-recuperacao', async (event, { email, codigo, novaSenha }) => {
  try {
    const emailNorm = String(email || '').trim().toLowerCase();
    const token = String(codigo || '').trim();
    const senhaNova = String(novaSenha || '');

    if (!emailNorm || !token || !senhaNova) {
      return { success: false, error: 'Preencha todos os campos.' };
    }

    const { error: erroVerificar } = await supabase.auth.verifyOtp({
      email: emailNorm,
      token,
      type: 'recovery'
    });

    if (erroVerificar) {
      return { success: false, error: traduzirErroAuth(erroVerificar.message) };
    }

    const { error: erroSenha } = await supabase.auth.updateUser({ password: senhaNova });
    if (erroSenha) {
      return { success: false, error: traduzirErroAuth(erroSenha.message) };
    }

    return { success: true };
  } catch (err) {
    console.error('Erro ao confirmar recuperação de senha:', err);
    return { success: false, error: 'Falha ao confirmar recuperação de senha' };
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

ipcMain.handle('get-app-version', () => {
  return packageJson.version;
});

// Handler para buscar pedido no Supabase
ipcMain.handle('buscar-pedido', async (event, numeroPedido) => {
  try {
    const pedidoNumero = String(numeroPedido || '').trim();
    const usuarioSessao = getUsuarioSessao();
    const filtros = [{ column: 'pedido', op: 'eq', value: pedidoNumero }];
    if (currentUser?.id) {
      filtros.push({ column: 'user_id', op: 'eq', value: currentUser.id });
    }

    let { data, error } = await crud.select('pedidos', {
      columns: '*',
      filters: filtros,
      order: { column: 'id', ascending: false },
      limit: 1
    });

    // Se não encontrou por user_id, tenta buscar pelo e-mail do usuário (registros legados)
    if (!error && (!data || data.length === 0) && usuarioSessao) {
      const { data: dataLegada, error: erroLegado } = await crud.select('pedidos', {
        columns: '*',
        filters: [
          { column: 'pedido', op: 'eq', value: pedidoNumero },
          { column: 'usuario', op: 'eq', value: usuarioSessao }
        ],
        order: { column: 'id', ascending: false },
        limit: 1
      });
      if (!erroLegado && dataLegada?.length) {
        data = dataLegada;
      }
    }

    if (error) {
      console.error('Erro ao buscar pedido:', error);
      return { success: false, error: error.message };
    }

    const pedido = data?.[0] || null;
    if (!pedido) {
      console.log('Pedido não encontrado:', numeroPedido);
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
    console.log('ÃƒÆ’Ã†â€™Ãƒâ€šÃ‚Â°ÃƒÆ’Ã¢â‚¬Â¦Ãƒâ€šÃ‚Â¸ÃƒÆ’Ã‚Â¢ÃƒÂ¢Ã¢â‚¬Å¡Ã‚Â¬Ãƒâ€šÃ‚ÂÃƒÆ’Ã¢â‚¬Å¡Ãƒâ€šÃ‚Â Buscando CPF no banco:', cpf);
    
    const filtrosCpf = [{ column: 'cpf', op: 'eq', value: cpf }];
    if (currentUser?.id) {
      filtrosCpf.push({ column: 'user_id', op: 'eq', value: currentUser.id });
    }

    const { data, error } = await crud.select('pedidos', {
      columns: 'nome, nascimento, email, telefone, mae',
      filters: filtrosCpf,
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

    console.log('✅ Dados encontrados para CPF:', data[0]);
    return { success: true, data: data[0] };
  } catch (err) {
    console.error('Erro na busca por CPF:', err);
    return { success: false, error: err.message };
  }
});

function normalizarStatusBanco(status) {
  const bruto = String(status || 'DIGITAÇÃO')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim();

  if (bruto.includes('APROV')) return 'APROVADO';
  if (bruto.includes('CANCEL')) return 'CANCELADO';
  if (bruto.includes('VIDEO')) return 'VIDEO REALIZADA';
  if (bruto.includes('VERIFIC')) return 'VERIFICAÇÃO';
  if (bruto.includes('DIGIT')) return 'DIGITAÇÃO';

  return 'DIGITAÇÃO';
}

// Handler para salvar/atualizar pedido no Supabase
ipcMain.handle('salvar-pedido', async (event, pedidoData) => {
  try {
    console.log('[main:salvar-pedido] Início do processamento. Payload recebido:', JSON.stringify(pedidoData, null, 2));

    const pedidoNumero = String(pedidoData?.pedido || '').trim();
    if (!pedidoNumero) {
      console.warn('[main:salvar-pedido] Validação falhou: Número do pedido vazio.');
      return { success: false, error: 'Número do pedido é obrigatório.' };
    }

    const usuarioPedido = getUsuarioSessao(pedidoData?.usuario);
    console.log('[main:salvar-pedido] Verificação de usuário:', {
      usuarioPedido,
      currentUserId: currentUser?.id,
      currentUserEmail: currentUser?.email
    });

    if (!usuarioPedido || !currentUser?.id) {
      console.warn('[main:salvar-pedido] Validação falhou: Usuário não autenticado na sessão.');
      return { success: false, error: 'Usuário não identificado para salvar o pedido.' };
    }

    const statusFinal = normalizarStatusBanco(pedidoData?.status);

    const payload = {
      ...pedidoData,
      pedido: pedidoNumero,
      status: statusFinal,
      usuario: usuarioPedido,
      user_id: currentUser.id
    };
    delete payload.id;

    console.log(`[main:salvar-pedido] Gravando pedido #${pedidoNumero} com status normalizado "${payload.status}"`);

    const filtrosExistencia = [
      { column: 'pedido', op: 'eq', value: pedidoNumero },
      { column: 'user_id', op: 'eq', value: currentUser.id }
    ];

    console.log('[main:salvar-pedido] Consultando existência prévia no banco com filtros:', filtrosExistencia);
    const { data: existente, error: existeError } = await crud.select('pedidos', {
      columns: 'id',
      filters: filtrosExistencia,
      order: { column: 'id', ascending: false },
      limit: 1
    });

    if (existeError) {
      console.error('[main:salvar-pedido] Erro ao consultar existência do pedido no banco:', existeError);
      return { success: false, error: existeError.message };
    }

    let data, error;

    if (existente && existente.length > 0) {
      const idExistente = existente[0].id;
      const filters = [
        { column: 'user_id', op: 'eq', value: currentUser.id },
        { column: 'id', op: 'eq', value: idExistente }
      ];
      console.log(`[main:salvar-pedido] Executando UPDATE no registro existente (id=${idExistente})...`);
      const result = await crud.update('pedidos', payload, {
        filters: filters,
        single: false
      });
      console.log('[main:salvar-pedido] Resultado do UPDATE:', result);
      data = Array.isArray(result.data) && result.data.length > 0 ? result.data[0] : result.data;
      error = result.error;
    } else {
      console.log('[main:salvar-pedido] Executando INSERT de novo pedido...');
      const result = await crud.insert('pedidos', payload, {
        single: true
      });
      console.log('[main:salvar-pedido] Resultado do INSERT:', result);
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error('[main:salvar-pedido] Erro retornado pelo Supabase:', error);
      return { success: false, error: error.message };
    }

    console.log(`[main:salvar-pedido] Pedido #${pedidoNumero} salvo com sucesso! Ação: ${existente?.length ? 'updated' : 'created'}`);
    return { success: true, data, action: existente?.length ? 'updated' : 'created' };
  } catch (err) {
    console.error('[main:salvar-pedido] Exceção capturada no handler:', err);
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
      return { success: false, error: 'Nome do certificado é obrigatório.' };
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

// Handler para buscar configurações do Supabase
ipcMain.handle('excluir-certificado', async (event, nomeCertificado) => {
  try {
    const nome = String(nomeCertificado || '').trim();
    if (!nome) {
      return { success: false, error: 'Nome do certificado é obrigatório.' };
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

    if (!usuarioSessao || !currentUser?.id) {
      return { success: false, error: 'Usuário logado não encontrado' };
    }

    const { data: usuarioData, error: usuarioError } = await crud.findOne('usuarios', {
      columns: 'id, nome, privilegio',
      filters: { id: currentUser.id }
    });

    if (usuarioError) {
      console.error('Erro ao buscar usuário:', usuarioError);
      return { success: false, error: usuarioError.message };
    }

    const { data, error } = await crud.findOne('configuracoes', {
      columns: '*',
      filters: { user_id: currentUser.id }
    });

    if (error) {
      console.error('Erro ao buscar configurações:', error);
      return { success: false, error: error.message };
    }

    return {
      success: true,
      data: {
        ...(data || {}),
        usuario: usuarioSessao,
        senha: '',
        nome_usuario: usuarioData?.nome || currentUser?.nome || '',
        privilegio: usuarioData?.privilegio || currentUser?.privilegio || ''
      }
    };
  } catch (err) {
    console.error('Erro na busca de configurações:', err);
    return { success: false, error: err.message };
  }
});

// Handler para salvar configurações no Supabase
ipcMain.handle('salvar-configuracoes', async (event, config) => {
  try {
    const usuarioSessao = getUsuarioSessao();

    if (!usuarioSessao || !currentUser?.id) {
      return { success: false, error: 'Usuário logado não encontrado' };
    }

    const senhaLogin = String(config?.senha || '').trim();
    if (senhaLogin) {
      const { error: erroSenha } = await supabase.auth.updateUser({ password: senhaLogin });
      if (erroSenha) {
        console.error('Erro ao atualizar senha:', erroSenha);
        return { success: false, error: traduzirErroAuth(erroSenha.message) };
      }
    }

    const { senha, nome_usuario, privilegio, usuario, ...configuracao } = config;
    const configToSave = {
      ...configuracao,
      usuario: usuarioSessao,
      user_id: currentUser.id
    };

    const { data, error } = await crud.upsert('configuracoes', configToSave, {
      onConflict: 'usuario',
      single: true
    });

    if (error) {
      console.error('Erro ao salvar configurações:', error);
      return { success: false, error: error.message };
    }

    return { success: true, data: { ...data, usuario: usuarioSessao } };
  } catch (err) {
    console.error('Erro ao salvar configurações:', err);
    return { success: false, error: err.message };
  }
});

// Handler para buscar pedidos do Supabase
ipcMain.handle('buscar-pedidos', async (event, filtros = {}) => {
  try {
    console.log('[buscar-pedidos] CHAMADO! Filtros recebidos:', JSON.stringify(filtros));
    const filters = [];

    // A coluna 'data' e TEXT no formato YYYY-MM-DD (ver database/schema.sql),
    // entao gte/lte fazem comparacao de STRING, nao de data.
    //
    // O limite inferior tem que ser a data pura: '2026-09-02T00:00:00' e MAIOR
    // que '2026-09-02' (o prefixo mais curto ordena antes), entao acrescentar a
    // hora aqui excluia justamente os pedidos do primeiro dia do intervalo.
    const normalizarInicioDia = (data) => {
      if (!data) return null;
      return String(data).trim().slice(0, 10); // garante apenas YYYY-MM-DD
    };

    // No limite superior a hora e necessaria: mantem dentro do intervalo tanto
    // '2026-09-02' quanto registros legados gravados com hora junto.
    const normalizarFimDia = (data) => {
      if (!data) return null;
      const s = String(data).trim().slice(0, 10);
      return `${s}T23:59:59`;
    };

    // Aplicar filtros de data (apenas se não houver termo de busca específico)
    if (!filtros.busca) {
      if (filtros.dataDe) {
        filters.push({ column: 'data', op: 'gte', value: normalizarInicioDia(filtros.dataDe) });
      }
      if (filtros.dataAte) {
        filters.push({ column: 'data', op: 'lte', value: normalizarFimDia(filtros.dataAte) });
      }
    }

    if (filtros.status) {
      filters.push({ column: 'status', op: 'ilike', value: `%${String(filtros.status).trim()}%` });
    }

    // Busca livre: apesar do comentario antigo dizer "filtra no banco", o
    // filtro nunca ia alem de desligar o filtro de data — a busca inteira
    // acontecia so depois, no cliente, sobre os pedidos ja trazidos. Pra uma
    // conta com muito historico isso faz pedidos antigos (fora do topo mais
    // recente) nunca aparecerem numa busca por CPF/CNPJ, mesmo existindo.
    // Filtra de verdade aqui, com OR entre as colunas pesquisaveis.
    const termoBusca = String(filtros.busca || '').trim();
    if (termoBusca) {
      const escaparValorOr = (valor) => String(valor).replace(/[\\"]/g, '\\$&');
      const termoEsc = escaparValorOr(termoBusca);
      const colunasTexto = ['pedido', 'nome', 'razao_social', 'email', 'versao', 'certificado', 'comentarios'];
      const condicoes = colunasTexto.map((coluna) => `${coluna}.ilike."%${termoEsc}%"`);

      // CPF/CNPJ sao salvos so com digitos (ver unmaskCPF/unmaskCNPJ no
      // renderer), entao busca pelos digitos do termo — funciona tanto
      // digitando com pontuacao (111.444.777-35) quanto sem.
      const termoDigitos = termoBusca.replace(/\D/g, '');
      const termoDocumento = escaparValorOr(termoDigitos || termoBusca);
      condicoes.push(`cpf.ilike."%${termoDocumento}%"`);
      condicoes.push(`cnpj.ilike."%${termoDocumento}%"`);

      filters.push({ op: 'or', value: condicoes.join(',') });
    }

    // Filtra pelo usuario logado
    const emailUsuario = filtros.usuario || currentUser?.email;
    if (currentUser?.id) {
      filters.push({ column: 'user_id', op: 'eq', value: currentUser.id });
    } else if (emailUsuario) {
      filters.push({ column: 'usuario', op: 'eq', value: emailUsuario });
    }

    // Quem chama pode pedir só as colunas que vai usar (os indicadores fazem
    // isso). Aceita apenas nomes simples separados por vírgula — nada vindo
    // daqui pode virar SQL arbitrário. Se o banco nao tiver alguma das colunas
    // pedidas, o retry mais abaixo refaz a consulta com '*'.
    const colunasPedidas = typeof filtros.colunas === 'string'
      && /^[a-z0-9_]+(,[a-z0-9_]+)*$/i.test(filtros.colunas.trim())
      ? filtros.colunas.trim()
      : null;

    let { data, error } = await crud.select('pedidos', {
      columns: colunasPedidas || '*',
      filters,
      order: [
        { column: 'id', ascending: false }
      ],
      limit: filtros.limit || 10000,
      offset: Number.isInteger(filtros.offset) ? filtros.offset : undefined
    });

    // Se a lista enxuta de colunas nao existir neste banco, a consulta falha por
    // inteiro. Refaz com '*' para nao derrubar a tela por causa da otimizacao.
    if (error && colunasPedidas) {
      console.warn('[buscar-pedidos] Colunas especificas recusadas, repetindo com "*":', error.message);
      ({ data, error } = await crud.select('pedidos', {
        columns: '*',
        filters,
        order: [
          { column: 'id', ascending: false }
        ],
        limit: filtros.limit || 10000,
        offset: Number.isInteger(filtros.offset) ? filtros.offset : undefined
      }));
    }

    // Se nenhum pedido foi retornado com user_id, tenta buscar pelo usuario/email (legado)
    if (!error && (!data || data.length === 0) && emailUsuario) {
      const legacyFilters = filters.filter(f => f.column !== 'user_id');
      legacyFilters.push({ column: 'usuario', op: 'eq', value: emailUsuario });

      const { data: dataLegada, error: erroLegado } = await crud.select('pedidos', {
        columns: '*',
        filters: legacyFilters,
        order: [
          { column: 'id', ascending: false }
        ],
        limit: filtros.limit || 10000,
        offset: Number.isInteger(filtros.offset) ? filtros.offset : undefined
      });
      if (!erroLegado && dataLegada?.length) {
        data = dataLegada;
      }
    }

    if (error) {
      console.error('[buscar-pedidos] Erro ao buscar pedidos:', error);
      return { success: false, error: error.message };
    }

    console.log('[buscar-pedidos] Total de pedidos encontrados:', data?.length);
    return { success: true, data };
  } catch (err) {
    console.error('Erro na busca de pedidos:', err);
    return { success: false, error: err.message };
  }
});

// Exporta os pedidos da aba Consulta (ja filtrados no renderer) para uma planilha Excel
ipcMain.handle('exportar-pedidos-excel', async (event, payload = {}) => {
  try {
    const linhas = Array.isArray(payload.linhas) ? payload.linhas : [];
    if (linhas.length === 0) {
      return { success: false, error: 'Nenhum pedido para exportar.' };
    }

    const janela = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePath } = await dialog.showSaveDialog(janela, {
      title: 'Exportar pedidos para Excel',
      defaultPath: payload.nomeArquivoSugerido || 'pedidos.xlsx',
      filters: [{ name: 'Planilha Excel', extensions: ['xlsx'] }]
    });

    if (canceled || !filePath) {
      return { success: false, canceled: true };
    }

    const XLSX = require('xlsx');
    const planilha = XLSX.utils.json_to_sheet(linhas);
    const larguras = Object.keys(linhas[0]).map((chave) => {
      const maiorValor = linhas.reduce((max, linha) => {
        const tamanho = String(linha[chave] ?? '').length;
        return tamanho > max ? tamanho : max;
      }, chave.length);
      return { wch: Math.min(Math.max(maiorValor + 2, 10), 60) };
    });
    planilha['!cols'] = larguras;

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, planilha, payload.sheetName || 'Pedidos');
    XLSX.writeFile(workbook, filePath);

    return { success: true, path: filePath };
  } catch (err) {
    console.error('Erro ao exportar pedidos para Excel:', err);
    return { success: false, error: err.message };
  }
});

// Handler dedicado para contar pedidos por status (evita o limite de 1000 do select geral)
ipcMain.handle('contar-status-pedidos', async (event) => {
  try {
    const { supabase } = require('./supabase-config');
    const userId = currentUser?.id;
    const emailUsuario = currentUser?.email;

    async function contarPorStatus(status) {
      let query = supabase
        .from('pedidos')
        .select('id', { count: 'exact', head: true })
        .eq('status', status);

      if (userId) {
        query = query.eq('user_id', userId);
      } else if (emailUsuario) {
        query = query.eq('usuario', emailUsuario);
      }

      const { count, error } = await query;
      if (error) {
        console.error(`[contar-status] Erro ao contar "${status}":`, error.message);
        return 0;
      }
      return count || 0;
    }

    const [video, verificacao] = await Promise.all([
      contarPorStatus('VIDEO REALIZADA'),
      contarPorStatus('VERIFICAÇÃO')
    ]);

    console.log('[contar-status] VIDEO REALIZADA:', video, '| VERIFICAÇÃO:', verificacao);
    return { success: true, video, verificacao };
  } catch (err) {
    console.error('[contar-status] Erro:', err.message);
    return { success: false, video: 0, verificacao: 0 };
  }
});

// Handler para listar pedidos de um status específico (para o mini modal dos chips)
ipcMain.handle('listar-pedidos-por-status', async (event, status) => {
  try {
    const { supabase } = require('./supabase-config');
    const userId = currentUser?.id;
    const emailUsuario = currentUser?.email;

    let query = supabase
      .from('pedidos')
      .select('pedido, nome, email, cnpj, razao_social, id')
      .eq('status', status)
      .order('id', { ascending: false });

    if (userId) {
      query = query.eq('user_id', userId);
    } else if (emailUsuario) {
      query = query.eq('usuario', emailUsuario);
    }

    const { data, error } = await query;
    if (error) {
      console.error('[listar-pedidos-por-status] Erro:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true, data: data || [] };
  } catch (err) {
    console.error('[listar-pedidos-por-status] Erro:', err.message);
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
  try {
    const filtrosBusca = [{ column: 'pedido', op: 'eq', value: String(pedido).trim() }];
    if (currentUser?.id) {
      filtrosBusca.push({ column: 'user_id', op: 'eq', value: currentUser.id });
    }

    const { data: existente, error: erroBusca } = await crud.select('pedidos', {
      columns: 'id',
      filters: filtrosBusca,
      limit: 1
    });

    if (erroBusca) {
      console.error('Erro ao verificar pedido existente antes de salvar caminhos:', erroBusca);
      return { success: false, error: erroBusca.message };
    }

    if (!existente || existente.length === 0) {
      const novoPedidoPayload = {
        pedido: String(pedido).trim(),
        user_id: currentUser?.id || null,
        usuario: usuario,
        diretorio: pastaRaiz,
        pasta: pastaCliente,
        status: 'DIGITAÇÃO'
      };
      const insertResult = await crud.insert('pedidos', novoPedidoPayload, { single: true });
      if (insertResult.error) {
        console.error('Erro ao inserir caminhos de pasta para novo pedido:', insertResult.error);
        return { success: false, error: insertResult.error.message };
      }
      return { success: true, data: insertResult.data };
    }

    const updateFilters = [];
    const idExistente = existente[0].id;
    if (idExistente) {
      updateFilters.push({ column: 'id', op: 'eq', value: idExistente });
    } else {
      updateFilters.push({ column: 'pedido', op: 'eq', value: String(pedido).trim() });
    }
    if (currentUser?.id) {
      updateFilters.push({ column: 'user_id', op: 'eq', value: currentUser.id });
    }

    const payloadAtualizacao = {
      diretorio: pastaRaiz,
      pasta: pastaCliente
    };

    const result = await crud.update('pedidos', payloadAtualizacao, {
      filters: updateFilters,
      single: false
    });

    if (result.error) {
      console.error('Erro ao salvar caminhos da pasta no pedido:', result.error);
      return { success: false, error: result.error.message };
    }

    const data = result.data && result.data.length > 0 ? result.data[0] : result.data;
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
    const filtrosPasta = [{ column: 'pedido', op: 'eq', value: pedido }];
    if (currentUser?.id) {
      filtrosPasta.push({ column: 'user_id', op: 'eq', value: currentUser.id });
    }

    const { data } = await crud.select('pedidos', {
      columns: 'pasta',
      filters: filtrosPasta,
      limit: 1
    });

    pastaCliente = data?.[0]?.pasta || pastaCliente;
  } catch (error) {
    console.error('Erro ao buscar pasta salva para verificação:', error);
  }

  return fs.existsSync(pastaCliente);
});

ipcMain.handle('criar-pasta-pedido', async (event, { usuario, pedido }) => {
  if (!usuario || !pedido) return { success: false, error: 'Usuário ou pedido não informado' };

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
      filters: filtrosPedidoAtual(pedido),
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
  if (!usuario || !pedido) return { success: false, error: 'Usuário ou pedido não informado' };

  let pastaRaiz = getPastaRaizUsuario(usuario);
  let pastaCliente = getPastaClientePedido(usuario, pedido);

  try {
    const { data } = await crud.select('pedidos', {
      columns: 'diretorio, pasta',
      filters: filtrosPedidoAtual(pedido),
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
  if (!usuario) return { success: false, error: 'Usuário não informado' };

  const baseDir = getPastaRaizUsuario(usuario);
  return {
    success: true,
    path: baseDir,
    exists: fs.existsSync(baseDir)
  };
});

ipcMain.handle('abrir-pasta-usuario', async (event, { usuario }) => {
  if (!usuario) return { success: false, error: 'Usuário não informado' };

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
    console.error('Erro ao criar pasta do usuário:', error);
    return { success: false, exists: false, path: getPastaRaizUsuario(usuario), error: error.message };
  }
});

ipcMain.handle('salvar-anexo-pedido', async (event, { usuario, pedido, filePath, fileName }) => {
  if (!usuario || !pedido || !filePath) return { success: false, error: 'Dados incompletos' };
  
  try {
    const { data: pedidoExistente } = await crud.select('pedidos', {
      columns: 'id',
      filters: filtrosPedidoAtual(pedido),
      limit: 1
    });

    if (!pedidoExistente?.length) {
      return { success: false, error: 'Salve o pedido antes de salvar anexos.' };
    }
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

// Nova função que aceita conteúdo de arquivo como Buffer
ipcMain.handle('salvar-anexo-pedido-conteudo', async (event, { usuario, pedido, fileName, conteudo }) => {
  if (!usuario || !pedido || !fileName) return { success: false, error: 'Dados incompletos' };
  
  try {
    const { data: pedidoExistente } = await crud.select('pedidos', {
      columns: 'id',
      filters: filtrosPedidoAtual(pedido),
      limit: 1
    });

    if (!pedidoExistente?.length) {
      return { success: false, error: 'Salve o pedido antes de salvar anexos.' };
    }
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
    console.error('Erro ao salvar anexo com conteúdo:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('listar-anexos-pedido', async (event, { usuario, pedido }) => {
  if (!usuario || !pedido) return [];
  let baseDir = getPastaClientePedido(usuario, pedido);

  try {
    const { data } = await crud.select('pedidos', {
      columns: 'pasta',
      filters: filtrosPedidoAtual(pedido),
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

ipcMain.handle('capturar-print-pedido', async (event, { usuario, pedido }) => {
  if (!usuario || !pedido) return { success: false, error: 'Usuário ou pedido não informado' };

  let pastaRaiz = getPastaRaizUsuario(usuario);
  let baseDir = getPastaClientePedido(usuario, pedido);

  try {
    const { data } = await crud.select('pedidos', {
      columns: 'diretorio, pasta',
      filters: filtrosPedidoAtual(pedido),
      limit: 1
    });

    const pedidoDb = data?.[0];
    pastaRaiz = pedidoDb?.diretorio || pastaRaiz;
    baseDir = pedidoDb?.pasta || baseDir;
  } catch (error) {
    console.error('Erro ao buscar pasta salva para print:', error);
  }

  if (!fs.existsSync(baseDir)) {
    return { success: false, error: 'A pasta do pedido precisa estar criada antes de capturar o print.' };
  }

  const captureWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow;
  const shouldHideWindow = captureWindow && !captureWindow.isDestroyed() && captureWindow.isVisible();
  const previousOpacity = shouldHideWindow ? captureWindow.getOpacity() : 1;

  try {
    isCapturingScreenshot = true;
    if (shouldHideWindow) {
      captureWindow.setOpacity(0);
      captureWindow.hide();
      await wait(180);
    }

    const display = screen.getPrimaryDisplay();
    const scaleFactor = display.scaleFactor || 1;
    const captureSize = {
      width: Math.round(display.size.width * scaleFactor),
      height: Math.round(display.size.height * scaleFactor)
    };

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: captureSize
    });

    const source = sources.find((item) => String(item.display_id) === String(display.id)) || sources[0];
    if (!source || source.thumbnail.isEmpty()) {
      return { success: false, error: 'Não foi possível capturar a tela.' };
    }

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .replace('T', '_')
      .slice(0, 19);
    const safePedido = String(pedido).replace(/[<>:"/\\|?*\x00-\x1F]/g, '-').slice(0, 80) || 'pedido';
    let fileName = `print-${safePedido}-${timestamp}.png`;
    let destPath = path.join(baseDir, fileName);
    let tentativa = 1;

    while (fs.existsSync(destPath)) {
      fileName = `print-${safePedido}-${timestamp}-${tentativa}.png`;
      destPath = path.join(baseDir, fileName);
      tentativa++;
    }

    fs.writeFileSync(destPath, source.thumbnail.toPNG());

    return {
      success: true,
      fileName,
      path: destPath,
      rootPath: pastaRaiz,
      clientPath: baseDir,
      type: 'image/png'
    };
  } catch (error) {
    console.error('Erro ao capturar print:', error);
    return { success: false, error: error.message };
  } finally {
    if (shouldHideWindow && captureWindow && !captureWindow.isDestroyed()) {
      captureWindow.show();
      captureWindow.setOpacity(previousOpacity || 1);
      captureWindow.focus();
    }
    isCapturingScreenshot = false;
  }
});

ipcMain.handle('excluir-anexo-pedido', async (event, { filePath }) => {
  if (!filePath) return { success: false, error: 'Caminho do arquivo não informado' };
  
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      return { success: true };
    }
    return { success: false, error: 'Arquivo não encontrado no disco' };
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
    return { success: true, message: 'Pasta não existia' };
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

// Abre uma URL no navegador padrao do sistema.
// So http/https passam: shell.openExternal aceita qualquer esquema, e um
// 'file:' ou 'cmd:' vindo daqui executaria algo na maquina do usuario.
ipcMain.handle('abrir-link-externo', async (event, url) => {
  try {
    const alvo = new URL(String(url || ''));
    if (alvo.protocol !== 'http:' && alvo.protocol !== 'https:') {
      console.warn('[abrir-link-externo] Esquema recusado:', alvo.protocol);
      return { success: false, error: 'Somente links http/https' };
    }
    await shell.openExternal(alvo.href);
    return { success: true };
  } catch (error) {
    console.error('Erro ao abrir link externo:', error);
    return { success: false, error: error.message };
  }
});

app.whenReady().then(async () => {
  store = new Store();

  // Limpa silenciosamente executáveis .old remanescentes de atualizações anteriores
  // A atualizacao nunca atrasa a abertura: o app sobe primeiro e a verificacao
  // corre em segundo plano, avisando a interface pelo canal 'update-status'.
  await iniciarJanelaPrincipalOuLogin();

  appUpdater = new AppUpdater(packageJson.version, 'RafaelNegrao', 'Companion');
  appUpdater.checkForUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      iniciarJanelaPrincipalOuLogin();
    }
  });
});

// Ao encerrar, se houver instalador baixado, ele roda em silencio (/S) e a
// proxima abertura ja e da versao nova.
app.on('will-quit', () => {
  if (appUpdater) appUpdater.instalarAoSair();
});

// Tenta restaurar uma sessao Supabase Auth persistida (ver supabase-config.js).
// Se existir sessao valida, pula a tela de login e abre a janela principal
// direto; senao, mostra o login normalmente.
async function iniciarJanelaPrincipalOuLogin() {
  try {
    const { data, error } = await supabase.auth.getSession();
    if (!error && data?.session?.user) {
      currentUser = await carregarPerfilUsuario(data.session.user);
      console.log('Sessão restaurada para:', currentUser?.email);
      createWindow();
      return;
    }
  } catch (err) {
    console.error('Erro ao restaurar sessão Supabase:', err);
  }

  createLoginWindow();
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

if (!app.isPackaged) {
  const rendererDir = path.join(__dirname, '../renderer');
  let reloadTimer = null;
  fs.watch(rendererDir, { recursive: true }, (event, filename) => {
    if (!filename) return;
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      BrowserWindow.getAllWindows().forEach(win => {
        if (!win.isDestroyed()) win.webContents.reload();
      });
    }, 300);
  });
}




