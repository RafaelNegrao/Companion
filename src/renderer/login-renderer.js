// login-renderer.js
const { ipcRenderer } = require('electron');

const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const errorMessage = document.getElementById('error-message');
const registerErrorMessage = document.getElementById('register-error-message');
const registerSuccessMessage = document.getElementById('register-success-message');
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

// Elementos para alternar entre login e cadastro
const showRegisterBtn = document.getElementById('show-register');
const showLoginBtn = document.getElementById('show-login');
const loginBox = document.querySelector('.login-box:not(.register-box)');
const registerBox = document.querySelector('.register-box');
const loginContainer = document.querySelector('.login-container');

// Alternar para tela de cadastro
showRegisterBtn.addEventListener('click', (e) => {
  e.preventDefault();
  loginBox.classList.add('hidden');
  registerBox.classList.remove('hidden');
  loginContainer.classList.add('register-mode');
  document.getElementById('reg-name').focus();
});

// Alternar para tela de login
showLoginBtn.addEventListener('click', (e) => {
  e.preventDefault();
  registerBox.classList.add('hidden');
  loginBox.classList.remove('hidden');
  loginContainer.classList.remove('register-mode');
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
registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const nome = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim().toLowerCase();
  const senha = document.getElementById('reg-password').value;
  const confirmarSenha = document.getElementById('reg-confirm-password').value;
  const privilegio = 'usuario';

  if (!nome || !email || !senha || !confirmarSenha) {
    showRegisterError('Por favor, preencha todos os campos');
    return;
  }

  if (senha !== confirmarSenha) {
    showRegisterError('As senhas não coincidem');
    return;
  }

  if (senha.length < 6) {
    showRegisterError('A senha deve ter no mínimo 6 caracteres');
    return;
  }

  const registerButton = registerForm.querySelector('.login-button');
  const originalButtonText = registerButton.innerHTML;
  registerButton.innerHTML = '<span>Cadastrando...</span>';
  registerButton.disabled = true;

  try {
    const resultado = await ipcRenderer.invoke('auth-register', {
      nome,
      email,
      senha,
      privilegio
    });

    if (!resultado?.success || !resultado?.data) {
      showRegisterError(resultado?.error || 'Erro ao criar conta');
      registerButton.innerHTML = originalButtonText;
      registerButton.disabled = false;
      return;
    }

    showRegisterSuccess('Conta criada com sucesso! Redirecionando...');
    registerForm.reset();

    setTimeout(() => {
      localStorage.setItem('user', JSON.stringify(resultado.data));
      ipcRenderer.send('login-success', resultado.data);
    }, 1200);
  } catch (err) {
    showRegisterError('Erro ao conectar com o servidor');
    console.error('Erro de cadastro:', err);
    registerButton.innerHTML = originalButtonText;
    registerButton.disabled = false;
  }
});

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.classList.add('show');

  setTimeout(() => {
    errorMessage.classList.remove('show');
  }, 3000);
}

function showRegisterError(message) {
  registerSuccessMessage.classList.remove('show');
  registerErrorMessage.textContent = message;
  registerErrorMessage.classList.add('show');

  setTimeout(() => {
    registerErrorMessage.classList.remove('show');
  }, 3000);
}

function showRegisterSuccess(message) {
  registerErrorMessage.classList.remove('show');
  registerSuccessMessage.textContent = message;
  registerSuccessMessage.classList.add('show');
}

// Limpa mensagem de erro ao digitar
usernameInput.addEventListener('input', () => {
  errorMessage.classList.remove('show');
});

passwordInput.addEventListener('input', () => {
  errorMessage.classList.remove('show');
});

// Limpa mensagens do cadastro ao digitar
['reg-name', 'reg-email', 'reg-password', 'reg-confirm-password'].forEach((id) => {
  const input = document.getElementById(id);
  if (!input) return;
  input.addEventListener('input', () => {
    registerErrorMessage.classList.remove('show');
    registerSuccessMessage.classList.remove('show');
  });
});
