// login-renderer.js
const { ipcRenderer } = require('electron');

const loginForm = document.getElementById('login-form');
const errorMessage = document.getElementById('error-message');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const rememberCheckbox = document.getElementById('remember');

// Carregar credenciais salvas e versão ao iniciar
window.addEventListener('DOMContentLoaded', async () => {
  // Carrega e exibe a versão atual do aplicativo
  try {
    const version = await ipcRenderer.invoke('get-app-version');
    const versionTags = document.querySelectorAll('.version-info');
    versionTags.forEach(tag => {
      if (tag && version) {
        tag.textContent = `v${version}`;
      }
    });
  } catch (error) {
    console.error('Erro ao carregar a versão do aplicativo:', error);
  }

  // Carregar credenciais salvas (somente email)
  try {
    const savedCredentials = await ipcRenderer.invoke('get-credentials');
    if (savedCredentials && savedCredentials.email) {
      usernameInput.value = savedCredentials.email;
      if (savedCredentials.password) {
        passwordInput.value = savedCredentials.password;
      }
      rememberCheckbox.checked = true;
      if (!passwordInput.value) {
        passwordInput.focus();
      }
    }
  } catch (error) {
    console.error('Erro ao carregar credenciais salvas:', error);
  }
});

// Elementos para alternar entre login e recuperação de senha
const showRecoverBtn = document.getElementById('show-recover');
const showLoginFromRecoverBtn = document.getElementById('show-login-from-recover');
const loginBox = document.querySelector('.login-box:not(.recover-box)');
const recoverBox = document.querySelector('.recover-box');
const loginContainer = document.querySelector('.login-container');

function mostrarApenas(boxParaMostrar) {
  [loginBox, recoverBox].forEach((box) => {
    if (box) box.classList.toggle('hidden', box !== boxParaMostrar);
  });
}

// Alternar para tela de recuperação de senha
showRecoverBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  mostrarApenas(recoverBox);
  document.getElementById('recover-email')?.focus();
});

showLoginFromRecoverBtn?.addEventListener('click', (e) => {
  e.preventDefault();
  mostrarApenas(loginBox);
  usernameInput.focus();
});

// LOGIN
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = usernameInput.value.trim().toLowerCase();
  const password = passwordInput.value;
  const remember = rememberCheckbox.checked;

  if (!email || !password) {
    showError('Por favor, preencha todos os campos');
    return;
  }

  const loginButton = loginForm.querySelector('.login-button');
  const originalButtonText = loginButton.innerHTML;
  loginButton.innerHTML = '<span>Autenticando...</span>';
  loginButton.disabled = true;

  try {
    const resultado = await ipcRenderer.invoke('auth-login', { email, password });
    if (!resultado?.success || !resultado?.data) {
      showError(resultado?.error || 'Email ou senha incorretos');
      passwordInput.value = '';
      passwordInput.focus();
      loginButton.innerHTML = originalButtonText;
      loginButton.disabled = false;
      return;
    }

    errorMessage.classList.remove('show');
    await ipcRenderer.invoke('save-credentials', { email, password, remember });

    const userData = resultado.data;
    localStorage.setItem('user', JSON.stringify(userData));
    ipcRenderer.send('login-success', userData);
  } catch (err) {
    showError('Erro ao conectar com o servidor');
    console.error('Erro de autenticação:', err);
    loginButton.innerHTML = originalButtonText;
    loginButton.disabled = false;
  }
});

// CADASTRO
function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');

  setTimeout(() => {
    errorMessage.classList.remove('show');
  }, 3000);
}

// Limpa mensagem de erro ao digitar
usernameInput.addEventListener('input', () => {
  errorMessage.classList.remove('show');
});

passwordInput.addEventListener('input', () => {
  errorMessage.classList.remove('show');
});

// RECUPERAÇÃO DE SENHA (fluxo em 2 etapas, sem link — só código, ver LOGIN-MULTIUSUARIO.md)
const recoverRequestForm = document.getElementById('recover-request-form');
const recoverConfirmForm = document.getElementById('recover-confirm-form');
const recoverRequestError = document.getElementById('recover-request-error');
const recoverRequestSuccess = document.getElementById('recover-request-success');
const recoverConfirmError = document.getElementById('recover-confirm-error');
const recoverConfirmSuccess = document.getElementById('recover-confirm-success');
const recoverEmailInput = document.getElementById('recover-email');
let emailEmRecuperacao = '';

function showRecoverRequestError(message) {
  recoverRequestSuccess.classList.remove('show');
  recoverRequestError.textContent = message;
  recoverRequestError.classList.add('show');
}

function showRecoverConfirmError(message) {
  recoverConfirmSuccess.classList.remove('show');
  recoverConfirmError.textContent = message;
  recoverConfirmError.classList.add('show');
}

// Etapa 1: pede o código por e-mail
recoverRequestForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const email = recoverEmailInput.value.trim().toLowerCase();
  if (!email) {
    showRecoverRequestError('Informe o e-mail.');
    return;
  }

  const btn = recoverRequestForm.querySelector('.login-button');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span>Enviando...</span>';
  btn.disabled = true;

  try {
    const resultado = await ipcRenderer.invoke('auth-recuperar-senha', { email });
    btn.innerHTML = originalText;
    btn.disabled = false;

    if (!resultado?.success) {
      showRecoverRequestError(resultado?.error || 'Erro ao solicitar recuperação de senha');
      return;
    }

    emailEmRecuperacao = email;
    recoverRequestSuccess.textContent = 'Código enviado! Confira seu email.';
    recoverRequestSuccess.classList.add('show');

    setTimeout(() => {
      recoverRequestForm.classList.add('hidden');
      recoverConfirmForm.classList.remove('hidden');
      document.getElementById('recover-code')?.focus();
    }, 900);
  } catch (err) {
    btn.innerHTML = originalText;
    btn.disabled = false;
    showRecoverRequestError('Erro ao conectar com o servidor');
    console.error('Erro ao solicitar recuperação de senha:', err);
  }
});

// Etapa 2: confirma o código e troca a senha
recoverConfirmForm?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const codigo = document.getElementById('recover-code').value.trim();
  const novaSenha = document.getElementById('recover-new-password').value;

  if (!codigo || !novaSenha) {
    showRecoverConfirmError('Preencha o código e a nova senha.');
    return;
  }

  if (novaSenha.length < 6) {
    showRecoverConfirmError('A senha deve ter no mínimo 6 caracteres');
    return;
  }

  const btn = recoverConfirmForm.querySelector('.login-button');
  const originalText = btn.innerHTML;
  btn.innerHTML = '<span>Confirmando...</span>';
  btn.disabled = true;

  try {
    const resultado = await ipcRenderer.invoke('auth-confirmar-recuperacao', {
      email: emailEmRecuperacao,
      codigo,
      novaSenha
    });
    btn.innerHTML = originalText;
    btn.disabled = false;

    if (!resultado?.success) {
      showRecoverConfirmError(resultado?.error || 'Erro ao confirmar recuperação de senha');
      return;
    }

    recoverConfirmSuccess.textContent = 'Senha alterada com sucesso! Faça login.';
    recoverConfirmSuccess.classList.add('show');

    setTimeout(() => {
      recoverConfirmForm.reset();
      recoverConfirmForm.classList.add('hidden');
      recoverRequestForm.classList.remove('hidden');
      recoverRequestForm.reset();
      recoverConfirmSuccess.classList.remove('show');
      mostrarApenas(loginBox);
      usernameInput.value = emailEmRecuperacao;
      passwordInput.focus();
    }, 1200);
  } catch (err) {
    btn.innerHTML = originalText;
    btn.disabled = false;
    showRecoverConfirmError('Erro ao conectar com o servidor');
    console.error('Erro ao confirmar recuperação de senha:', err);
  }
});

// Limpa mensagens de recuperação ao digitar
recoverEmailInput?.addEventListener('input', () => recoverRequestError.classList.remove('show'));
['recover-code', 'recover-new-password'].forEach((id) => {
  document.getElementById(id)?.addEventListener('input', () => recoverConfirmError.classList.remove('show'));
});
