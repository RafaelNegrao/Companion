// --- Gestão de Múltiplas Abas de Pedido ---
let pedidoTabIdSeq = Date.now();
function gerarPedidoTabId() {
  pedidoTabIdSeq += 1;
  return pedidoTabIdSeq;
}

let pedidoTabs = [{ id: gerarPedidoTabId(), number: 1, data: {}, baseline: null, dirty: false }];
let activePedidoTabId = pedidoTabs[0].id;
let currentLoggedUser = null;

class ComissaoCalculator {
  constructor({ percentualValidacao = 0, percentualImposto = 0, descontoAdicional = 0 } = {}) {
    this.percentualValidacao = ComissaoCalculator.toNumber(percentualValidacao);
    this.percentualImposto = ComissaoCalculator.toNumber(percentualImposto);
    this.descontoAdicional = ComissaoCalculator.toNumber(descontoAdicional);
  }

  static fromDOM() {
    return new ComissaoCalculator({
      percentualValidacao: document.getElementById('config-porc-validacao')?.value ?? 0,
      percentualImposto: document.getElementById('config-imp-renda')?.value ?? 0,
      descontoAdicional: document.getElementById('config-desc-validacao')?.value ?? 0
    });
  }

  static toNumber(valor) {
    if (valor === null || valor === undefined) return 0;
    if (typeof valor === 'number') return Number.isFinite(valor) ? valor : 0;

    let texto = String(valor).trim();
    if (!texto) return 0;

    texto = texto.replace(/[R$\s]/g, '');
    texto = texto.replace(/[^\d,.-]/g, '');
    if (!texto) return 0;

    const negativos = (texto.match(/-/g) || []).length;
    texto = texto.replace(/-/g, '');

    const pontos = (texto.match(/\./g) || []).length;
    const virgulas = (texto.match(/,/g) || []).length;
    const ultimoPonto = texto.lastIndexOf('.');
    const ultimaVirgula = texto.lastIndexOf(',');

    if (pontos > 0 && virgulas > 0) {
      const separadorDecimal = ultimoPonto > ultimaVirgula ? '.' : ',';
      if (separadorDecimal === '.') {
        texto = texto.replace(/,/g, '');
      } else {
        texto = texto.replace(/\./g, '').replace(',', '.');
      }
    } else if (virgulas > 0) {
      if (virgulas > 1) {
        texto = texto.replace(/\./g, '');
        const idx = texto.lastIndexOf(',');
        texto = `${texto.slice(0, idx).replace(/,/g, '')}.${texto.slice(idx + 1)}`;
      } else {
        texto = texto.replace(',', '.');
      }
    } else if (pontos > 0) {
      if (pontos > 1) {
        const idx = texto.lastIndexOf('.');
        texto = `${texto.slice(0, idx).replace(/\./g, '')}.${texto.slice(idx + 1)}`;
      } else {
        const [inteiro = '', decimal = ''] = texto.split('.');
        if (decimal.length === 3 && inteiro.length >= 1) {
          texto = `${inteiro}${decimal}`;
        }
      }
    }

    const numero = Number(texto);
    if (!Number.isFinite(numero)) return 0;
    return negativos % 2 === 1 ? -numero : numero;
  }

  static formatNumberBR(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
  }

  static formatCurrencyBR(valor) {
    return Number(valor || 0).toLocaleString('pt-BR', {
      style: 'currency',
      currency: 'BRL'
    });
  }

  calcular(valorBase) {
    const base = Math.max(0, ComissaoCalculator.toNumber(valorBase));
    const valorBruto = base * (this.percentualValidacao / 100);
    const valorImposto = valorBruto * (this.percentualImposto / 100);
    const valorLiquido = valorBruto - valorImposto;
    const valorFinal = Math.max(0, valorLiquido - this.descontoAdicional);

    return {
      valorBase: base,
      percentualValidacao: this.percentualValidacao,
      percentualImposto: this.percentualImposto,
      descontoAdicional: this.descontoAdicional,
      valorBruto,
      valorImposto,
      valorLiquido,
      valorFinal
    };
  }
}

class ToastNotifier {
  constructor({ containerId = 'app-toast-container', duration = 2600 } = {}) {
    this.containerId = containerId;
    this.duration = duration;
    this.container = null;
  }

  ensureContainer() {
    if (this.container && document.body.contains(this.container)) return this.container;
    let container = document.getElementById(this.containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = this.containerId;
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    this.container = container;
    return container;
  }

  show(message, type = 'success', duration = this.duration) {
    if (!message) return;
    const container = this.ensureContainer();
    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    toast.innerHTML = `<span class="toast-message">${String(message)}</span>`;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));

    const close = () => {
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 180);
    };

    const timer = setTimeout(close, Math.max(1200, Number(duration) || this.duration));
    toast.addEventListener('click', () => {
      clearTimeout(timer);
      close();
    });
  }

  success(message, duration) {
    this.show(message, 'success', duration);
  }

  warning(message, duration) {
    this.show(message, 'warning', duration);
  }

  error(message, duration) {
    this.show(message, 'error', duration);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  let isLocked = false;
  const toastNotifier = new ToastNotifier();
  window.toastNotifier = toastNotifier;
  // Anexos (arquivos carregados via dropzone)
  let attachments = [];

  // Elementos
  const lockBtn = document.getElementById('lock-btn');
  const closeBtn = document.getElementById('close-btn');
  const triggerArea = document.getElementById('trigger-area');
  const mainContent = document.getElementById('main-content');

  const tabsContainer = document.getElementById('pedido-tabs-container');
  const addTabBtn = document.getElementById('add-pedido-tab');

  function renderPedidoTabs() {
    if (!tabsContainer) return;
    tabsContainer.innerHTML = '';

    // Com um único pedido aberto a barra de abas some, e o "+" migra pro
    // topo (ao lado dos controles da janela) — a barra só faz sentido
    // quando há mais de uma aba pra escolher entre elas.
    const tabsBarEl = document.querySelector('.pedido-tabs-bar');
    const headerAddBtn = document.getElementById('add-pedido-tab-header');
    const showBar = pedidoTabs.length > 1;
    if (tabsBarEl) tabsBarEl.style.display = showBar ? '' : 'none';
    if (headerAddBtn) headerAddBtn.style.display = showBar ? 'none' : 'flex';

    pedidoTabs.forEach(tab => {
      const tabEl = document.createElement('div');
      tabEl.className = `pedido-tab ${tab.id === activePedidoTabId ? 'active' : ''}`;
      tabEl.dataset.tabId = tab.id;
      const numeroPedido = (tab.data && tab.data.pedido) ? tab.data.pedido : tab.number;
      tabEl.innerHTML = `
        <span class="tab-title" style="white-space: nowrap;">${numeroPedido}</span>
        <span class="close-tab" title="Fechar">&times;</span>
      `;
      
      tabEl.onclick = () => switchPedidoTab(tab.id);
      
      const closeBtn = tabEl.querySelector('.close-tab');
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        closePedidoTab(tab.id);
      };
      
      tabsContainer.appendChild(tabEl);
    });
  }

  function restaurarEstadoPastaPedidoDaAba(tabData) {
    const folderBtn = document.getElementById('folder-pedido-btn');
    const pastaInput = document.getElementById('config-pasta');
    const pastaClienteInput = document.getElementById('config-pasta-cliente');
    const screenshotBtn = document.getElementById('pedido-screenshot-btn');
    if (!folderBtn) return;

    const numeroPedido = String(tabData?.pedido || '').trim();
    const hasPedido = Boolean(numeroPedido);
    const hasPedidoExistente = Boolean(tabData?.id || currentPedidoId);
    const pastaCliente = String(tabData?.pasta || '').trim();
    const pastaInfoExists = Boolean(tabData?.pasta_info?.exists);
    const hasPasta = pastaInfoExists || Boolean(pastaCliente);

    folderBtn.classList.remove('exists', 'missing');

    if (!hasPedido) {
      folderBtn.title = 'Digite um pedido para gerenciar a pasta';
      if (pastaInput) pastaInput.value = '';
      if (pastaClienteInput) pastaClienteInput.value = '';
    } else if (hasPasta) {
      folderBtn.classList.add('exists');
      folderBtn.title = 'Abrir pasta do pedido';
      if (pastaInput && tabData?.diretorio) pastaInput.value = tabData.diretorio;
      if (pastaClienteInput && pastaCliente) pastaClienteInput.value = pastaCliente;
    } else {
      folderBtn.classList.add('missing');
      if (!hasPedidoExistente) {
        folderBtn.title = 'Salve o pedido antes de criar a pasta';
      } else {
        folderBtn.title = 'Criar pasta do pedido (AppData)';
      }
      if (pastaInput) pastaInput.value = tabData?.diretorio || '';
      if (pastaClienteInput) pastaClienteInput.value = '';
    }

    const dropzone = document.getElementById('dropzone');
    if (dropzone) dropzone.classList.toggle('disabled', !Boolean(hasPedido && hasPasta));
    if (screenshotBtn) {
      screenshotBtn.disabled = !Boolean(hasPedido && hasPasta);
      screenshotBtn.title = hasPedido && hasPasta
        ? 'Capturar print da tela e anexar ao pedido'
        : 'Crie a pasta do pedido para capturar um print';
    }
  }

  function switchPedidoTab(newId) {
    if (newId === activePedidoTabId) return;
    
    // Salva dados atuais na aba atual
    const currentTab = pedidoTabs.find(t => t.id === activePedidoTabId);
    if (currentTab) {
      atualizarEstadoAlteracaoPedidoAtual({ updateStatus: false });
      currentTab.data = coletarDadosFormulario(true); // true = permitir vazio
    }
    
    activePedidoTabId = newId;
    const nextTab = pedidoTabs.find(t => t.id === activePedidoTabId);
    
    // Limpa e Preenche
    limparTodosCampos();
    ultimaBuscaPedido = normalizarNumeroPedidoBusca(nextTab?.data?.pedido || '');
    ultimaBuscaMomento = Date.now();
    if (nextTab && nextTab.data && Object.keys(nextTab.data).length > 0) {
      preencherPedidoNaTela(nextTab.data, nextTab.data.pedido);
      
      // Se houver pedido ou certificado, mostra a área
      if (nextTab.data.id || nextTab.data.versao) {
        mostrarAreaDadosPedido(true);
      } else {
        ocultarAreaDadosPedido();
      }

      nextTab.data = clonarDadosPedido(obterSnapshotPedidoAtual());
      if (!nextTab.baseline) {
        nextTab.baseline = clonarDadosPedido(nextTab.data);
      }
      nextTab.dirty = serializarDadosPedidoParaComparacao(nextTab.data) !== serializarDadosPedidoParaComparacao(nextTab.baseline);

      // Restaura o estado visual do salvamento
      if (nextTab.dirty) {
        atualizarStatusSalvamento('dirty', 'Alterado');
      } else {
        atualizarStatusSalvamento('idle', 'Pronto');
      }
    } else {
      const pedidoInput = document.getElementById('pedido-numero-input');
      if (pedidoInput) pedidoInput.value = '';
      ocultarAreaDadosPedido();
      definirBaselinePedidoAtual();
      atualizarStatusSalvamento('idle', 'Pronto');
    }
    
    renderPedidoTabs();
    restaurarEstadoPastaPedidoDaAba(nextTab?.data || {});
    if (typeof atualizarStatusPastaPedido === 'function') {
      atualizarStatusPastaPedido();
    }
  }

  function addPedidoTab() {
    try {
      const maxNumber = Math.max(...pedidoTabs.map(t => t.number), 0);
      const newTab = {
        id: gerarPedidoTabId(),
        number: maxNumber + 1,
        data: {},
        baseline: null,
        dirty: false
      };
      
      // Salva atual antes de trocar
      const currentTab = pedidoTabs.find(t => t.id === activePedidoTabId);
      if (currentTab) {
        atualizarEstadoAlteracaoPedidoAtual({ updateStatus: false });
        currentTab.data = coletarDadosFormulario(true);
      }
      
      pedidoTabs.push(newTab);
      activePedidoTabId = newTab.id;

      try {
        limparTodosCampos();
      } catch (errorLimpeza) {
        console.error('Falha ao limpar campos para nova aba, aplicando fallback:', errorLimpeza);
        const pedidoInputFallback = document.getElementById('pedido-numero-input');
        if (pedidoInputFallback) pedidoInputFallback.value = '';
        const scrollArea = document.getElementById('form-scrollable-area');
        if (scrollArea) scrollArea.style.display = 'none';
      }

      ocultarAreaDadosPedido();
      renderPedidoTabs();
      restaurarEstadoPastaPedidoDaAba(newTab.data);
      
      // Foca e limpa o campo de pedido
      const pedidoInput = document.getElementById('pedido-numero-input');
      if (pedidoInput) {
        pedidoInput.value = '';
        pedidoInput.focus();
      }
      definirBaselinePedidoAtual();
      
      if (typeof atualizarStatusPastaPedido === 'function') {
        atualizarStatusPastaPedido();
      }

      return newTab;
    } catch (error) {
      console.error('Erro ao criar nova aba de pedido:', error);
      if (window.toastNotifier) {
        window.toastNotifier.error(`Erro ao criar nova aba de pedido: ${error?.message || 'falha inesperada'}`);
      }
      return null;
    }
  }
  window.__addPedidoTab = addPedidoTab;

  window.__abrirPedidoConsultaEmNovaAba = async function(numeroPedido) {
    const pedidoNumero = String(numeroPedido || '').trim();
    if (!pedidoNumero) return;

    const tabPedidoBtn = document.querySelector('.tab-btn[data-tab="pedido"]');
    if (tabPedidoBtn) tabPedidoBtn.click();

    const novaTab = addPedidoTab();
    if (!novaTab?.id) return;

    const pedidoInput = document.getElementById('pedido-numero-input');
    if (pedidoInput) {
      pedidoInput.value = pedidoNumero;
    }

    await buscarEPreencherPedido(pedidoNumero);

    const currentTab = pedidoTabs.find(t => t.id === activePedidoTabId);
    if (currentTab) {
      definirBaselinePedidoAtual(coletarDadosFormulario(true));
      renderPedidoTabs();
    }
  };

  async function closePedidoTab(id) {
    if (pedidoTabs.length <= 1) {
      customAppModal({
        title: 'Atenção',
        message: 'Você deve manter pelo menos um pedido aberto.',
        confirmText: 'OK'
      });
      return;
    }

    const tab = pedidoTabs.find(t => t.id === id);
    if (tab && tab.dirty) {
      const confirmado = await showCustomModal({
        title: 'Alterações não salvas',
        message: `O Pedido ${tab.number} possui alterações não salvas. Deseja realmente fechar?`,
        confirmText: 'Fechar mesmo assim',
        cancelText: 'Cancelar',
        hideCancel: false
      });
      if (!confirmado) return;
    }
    
    const index = pedidoTabs.findIndex(t => t.id === id);
    if (index === -1) return;
    
    pedidoTabs.splice(index, 1);
    
    if (activePedidoTabId === id) {
      activePedidoTabId = pedidoTabs[Math.max(0, index - 1)].id;
      const nextTab = pedidoTabs.find(t => t.id === activePedidoTabId);
      limparTodosCampos();
      if (nextTab && nextTab.data && Object.keys(nextTab.data).length > 0) {
        preencherPedidoNaTela(nextTab.data, nextTab.data.pedido);
        if (nextTab.data.id || nextTab.data.versao) mostrarAreaDadosPedido(true);

        nextTab.data = clonarDadosPedido(obterSnapshotPedidoAtual());
        if (!nextTab.baseline) {
          nextTab.baseline = clonarDadosPedido(nextTab.data);
        }
        nextTab.dirty = serializarDadosPedidoParaComparacao(nextTab.data) !== serializarDadosPedidoParaComparacao(nextTab.baseline);
        
        // Restaura o estado visual do salvamento
        if (nextTab.dirty) {
          atualizarStatusSalvamento('dirty', 'Alterado');
        } else {
          atualizarStatusSalvamento('idle', 'Pronto');
        }
      } else {
        const pedidoInput = document.getElementById('pedido-numero-input');
        if (pedidoInput) pedidoInput.value = '';
        ocultarAreaDadosPedido();
        definirBaselinePedidoAtual();
        atualizarStatusSalvamento('idle', 'Pronto');
      }
    }
    
    renderPedidoTabs();
    restaurarEstadoPastaPedidoDaAba(pedidoTabs.find(t => t.id === activePedidoTabId)?.data || {});
    if (typeof atualizarStatusPastaPedido === 'function') {
      atualizarStatusPastaPedido();
    }
  }

  // ocultarAreaDadosPedido, temCertificadoPedidoSelecionado e
  // atualizarVisibilidadeDadosPedidoPorCertificado sao definidas uma unica
  // vez, em escopo de modulo (mais abaixo neste arquivo) — hoisted, entao
  // ja estao disponiveis aqui. Ter uma segunda copia local aqui era a causa
  // de comportamento inconsistente (cada copia com uma regra diferente).

  if (addTabBtn && addTabBtn.dataset.bound !== '1' && !addTabBtn.getAttribute('onclick')) {
    addTabBtn.dataset.bound = '1';
    addTabBtn.addEventListener('click', () => {
      addPedidoTab();
    });
  }
  renderPedidoTabs();
  ocultarAreaDadosPedido();

  // Eventos de hover na área de gatilho
  if (triggerArea) {
    triggerArea.addEventListener('mouseenter', () => {
      if (window.electronAPI && window.electronAPI.expandWindow) window.electronAPI.expandWindow();
    });
  }

  // Eventos de hover no conteúdo principal
  function deveManterJanelaAbertaPorInteracao() {
    const activeEl = document.activeElement;
    if (!activeEl) return false;

    if (activeEl.id === 'config-cert-nome') return true;

    const configAtiva = document.getElementById('configuracoes')?.classList.contains('active');
    const campoEditavel = activeEl.matches?.('input, textarea, select');
    return Boolean(configAtiva && campoEditavel);
  }

  if (mainContent) {
    mainContent.addEventListener('mouseenter', () => {
      if (window.electronAPI && window.electronAPI.cancelHide) window.electronAPI.cancelHide();
      if (window.electronAPI && window.electronAPI.setWindowPointerIdle) window.electronAPI.setWindowPointerIdle(false);
    });

    mainContent.addEventListener('mouseleave', (e) => {
      const modal = document.getElementById('custom-modal');
      const isModalActive = modal && modal.classList.contains('active');
      const isPickerActive = document.querySelector('.picker-overlay') !== null;
      const isPopoverActive = Boolean(statusPopoverAtivo);
      
      // Se o cursor ainda estiver dentro das coordenadas da janela, não colapsa
      if (e.clientX > 0 && e.clientX < window.innerWidth && e.clientY > 0 && e.clientY < window.innerHeight) {
        return;
      }

      if (isLocked) {
        if (window.electronAPI && window.electronAPI.setWindowPointerIdle) window.electronAPI.setWindowPointerIdle(true);
      } else if (!isModalActive && !isPickerActive && !isPopoverActive && !deveManterJanelaAbertaPorInteracao()) {
        if (window.electronAPI && window.electronAPI.collapseWindow) window.electronAPI.collapseWindow();
      }
    });
  }

  // Atualiza o ícone do cadeado
  function animarIconeCadeado() {
    if (!lockBtn) return;
    lockBtn.classList.remove('lock-animate');
    void lockBtn.offsetWidth;
    lockBtn.classList.add('lock-animate');
    setTimeout(() => lockBtn.classList.remove('lock-animate'), 650);
  }

  function updateLockIcon(locked, animar = false) {
    const svg = locked ? `
      <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M208,80H176V56a48,48,0,0,0-96,0V80H48A16,16,0,0,0,32,96V208a16,16,0,0,0,16,16H208a16,16,0,0,0,16-16V96A16,16,0,0,0,208,80ZM96,56a32,32,0,0,1,64,0V80H96ZM208,208H48V96H208V208Zm-68-56a12,12,0,1,1-12-12A12,12,0,0,1,140,152Z"/></svg>
    ` : `
      <svg width="20" height="20" viewBox="0 0 256 256" fill="currentColor"><path d="M53.92,34.62A8,8,0,1,0,42.08,45.38L61.32,66.55C25,88.84,9.38,123.2,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208a127.11,127.11,0,0,0,52.07-10.83l22,24.21a8,8,0,1,0,11.84-10.76Zm47.33,75.84,41.67,45.85a32,32,0,0,1-41.67-45.85ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.16,133.16,0,0,1,25,128c4.69-8.79,19.66-33.39,47.35-49.38l18,19.75a48,48,0,0,0,63.66,70l14.73,16.2A112,112,0,0,1,128,192Zm6-95.43a8,8,0,0,1,3-15.72,48.16,48.16,0,0,1,38.77,42.64,8,8,0,0,1-7.22,8.71,6.39,6.39,0,0,1-.75,0,8,8,0,0,1-8-7.26A32.09,32.09,0,0,0,134,96.57Zm113.28,34.69c-.42.94-10.55,23.37-33.36,43.8a8,8,0,1,1-10.67-11.92A132.77,132.77,0,0,0,231.05,128a133.15,133.15,0,0,0-23.12-30.77C185.67,75.19,158.78,64,128,64a118.37,118.37,0,0,0-19.36,1.57A8,8,0,1,1,106,49.79,134,134,0,0,1,128,48c34.88,0,66.57,13.26,91.66,38.35,18.83,18.83,27.3,37.62,27.65,38.41A8,8,0,0,1,247.31,131.26Z"/></svg>
    `;
    if (lockBtn) {
      lockBtn.innerHTML = svg;
      
      if (locked) {
        lockBtn.classList.add('locked');
        lockBtn.title = 'Liberar janela';
        lockBtn.setAttribute('aria-label', 'Liberar janela');
      } else {
        lockBtn.classList.remove('locked');
        lockBtn.title = 'Fixar janela';
        lockBtn.setAttribute('aria-label', 'Fixar janela');
      }

      if (animar) animarIconeCadeado();
    }
  }

  function alternarFixacaoJanela(animar = true) {
    isLocked = !isLocked;
    if (window.electronAPI && window.electronAPI.toggleLock) window.electronAPI.toggleLock(isLocked);
    if (window.electronAPI && window.electronAPI.setWindowPointerIdle) window.electronAPI.setWindowPointerIdle(false);
    updateLockIcon(isLocked, animar);
  }

  // Toggle lock no botão
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      alternarFixacaoJanela(true);
    });
  }

  // Duplo clique com o botão direito no mainContent para fixar/manter a tela aberta
  if (mainContent) {
    let ultimoCliqueDireito = 0;
    const INTERVALO_DUPLO_CLIQUE = 350;

    mainContent.addEventListener('mousedown', (event) => {
      if (event.button !== 2) return; // 2 = botão direito
      if (event.target?.closest?.('#lock-btn, #close-btn')) return;

      const agora = Date.now();
      if (agora - ultimoCliqueDireito < INTERVALO_DUPLO_CLIQUE) {
        ultimoCliqueDireito = 0;
        event.preventDefault();
        alternarFixacaoJanela(true);
      } else {
        ultimoCliqueDireito = agora;
      }
    });

    mainContent.addEventListener('contextmenu', (event) => {
      if (event.target?.closest?.('#lock-btn, #close-btn')) return;
      event.preventDefault();
    });
  }


  // Fechar app
  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      if (window.electronAPI && window.electronAPI.closeApp) window.electronAPI.closeApp();
    });
  }

  // Escuta mudanças de estado da janela
  if (window.electronAPI && window.electronAPI.onWindowState) {
    window.electronAPI.onWindowState((event, state) => {
      if (state === 'expanded') {
        document.body.classList.add('expanded');
      } else if (state === 'collapsed') {
        document.body.classList.remove('expanded');
      }
    });
  }

  // Inicializa o ícone (se existir o botão)
  if (lockBtn) updateLockIcon(false);

  let certificadosDataCache = [];
  let configCertSuggestionsBound = false;
  let configCertHideSuggestionsTimer = null;
  let configCertActiveSuggestionIndex = -1;

  function listarCertificadosParaConfig() {
    if (Array.isArray(certificadosDataCache) && certificadosDataCache.length > 0) {
      return certificadosDataCache;
    }

    const selectPedido = document.getElementById('pedido-certificado-select');
    if (!selectPedido) return [];

    const fallback = [];
    Array.from(selectPedido.options || []).forEach((opt) => {
      const nome = String(opt.textContent || opt.value || '').trim();
      if (!nome || /selecione/i.test(nome)) return;
      fallback.push({
        nome,
        valor: opt.dataset?.valor || 0,
        link_venda: opt.dataset?.link || ''
      });
    });
    return fallback;
  }

  function esconderSugestoesCertificadoConfig() {
    const lista = document.getElementById('config-cert-suggestions');
    if (!lista) return;
    lista.classList.add('is-hidden');
    configCertActiveSuggestionIndex = -1;
  }

  function obterSugestoesCertificadoConfig(filtro) {
    const base = listarCertificadosParaConfig();
    const termo = normalizarTextoRelatorio(filtro || '');
    if (!termo) return base.slice();

    return base.filter((cert) => normalizarTextoRelatorio(cert.nome || '').includes(termo));
  }

  function mostrarSugestoesCertificadoConfig(filtro) {
    const lista = document.getElementById('config-cert-suggestions');
    if (!lista) return;

    const sugestoes = obterSugestoesCertificadoConfig(filtro);
    lista.innerHTML = '';
    configCertActiveSuggestionIndex = -1;

    if (!sugestoes.length) {
      lista.classList.add('is-hidden');
      return;
    }

    sugestoes.forEach((cert, index) => {
      const item = document.createElement('div');
      item.className = 'config-cert-suggestion-item';
      item.textContent = cert.nome || '';
      item.dataset.index = String(index);
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        const nomeInput = document.getElementById('config-cert-nome');
        if (!nomeInput) return;
        nomeInput.value = cert.nome || '';
        preencherCamposCertificadoConfig(nomeInput.value);
        esconderSugestoesCertificadoConfig();
      });
      lista.appendChild(item);
    });

    lista.classList.remove('is-hidden');
  }

  function destacarSugestaoCertificadoConfig(delta) {
    const lista = document.getElementById('config-cert-suggestions');
    if (!lista || lista.classList.contains('is-hidden')) return;

    const itens = Array.from(lista.querySelectorAll('.config-cert-suggestion-item'));
    if (!itens.length) return;

    configCertActiveSuggestionIndex += delta;
    if (configCertActiveSuggestionIndex < 0) configCertActiveSuggestionIndex = itens.length - 1;
    if (configCertActiveSuggestionIndex >= itens.length) configCertActiveSuggestionIndex = 0;

    itens.forEach((el, idx) => el.classList.toggle('is-active', idx === configCertActiveSuggestionIndex));
    itens[configCertActiveSuggestionIndex]?.scrollIntoView({ block: 'nearest' });
  }

  function selecionarSugestaoAtivaCertificadoConfig() {
    const lista = document.getElementById('config-cert-suggestions');
    const nomeInput = document.getElementById('config-cert-nome');
    if (!lista || !nomeInput || lista.classList.contains('is-hidden')) return false;

    const itens = Array.from(lista.querySelectorAll('.config-cert-suggestion-item'));
    if (!itens.length) return false;
    if (configCertActiveSuggestionIndex < 0 || configCertActiveSuggestionIndex >= itens.length) return false;

    const item = itens[configCertActiveSuggestionIndex];
    nomeInput.value = item.textContent || '';
    preencherCamposCertificadoConfig(nomeInput.value);
    esconderSugestoesCertificadoConfig();
    return true;
  }

  function obterCertificadoPorNome(nome) {
    const alvo = normalizarTextoRelatorio(nome);
    if (!alvo) return null;

    const base = listarCertificadosParaConfig();
    return base.find((cert) => normalizarTextoRelatorio(cert.nome) === alvo) || null;
  }

  function atualizarModoCertificadoConfig(nome) {
    const modoEl = document.getElementById('config-cert-mode');
    const botao = document.getElementById('config-cert-add-btn');
    const deleteBtn = document.getElementById('config-cert-delete-btn');
    if (!modoEl || !botao || !deleteBtn) return;

    const existe = Boolean(obterCertificadoPorNome(nome));
    const modo = existe ? 'update' : 'new';

    deleteBtn.classList.toggle('is-hidden', !existe);

    modoEl.classList.remove('new', 'update');
    modoEl.classList.add(modo);

    if (modo === 'update') {
      modoEl.innerHTML = `
        <span class="config-cert-mode-icon" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/></svg>
        </span>
        <span class="config-cert-mode-text">UPDATE</span>
      `;
      botao.title = 'Atualizar certificado';
      botao.innerHTML = `
        <svg width="16" height="16" aria-hidden="true" viewBox="0 0 256 256" fill="currentColor"><path d="M227.31,73.37,182.63,28.68a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.68,147.31,64l24-24L216,84.68Z"/></svg>
      `;
      return;
    }

    modoEl.innerHTML = `
      <span class="config-cert-mode-icon" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"/></svg>
      </span>
      <span class="config-cert-mode-text">NEW</span>
    `;
    botao.title = 'Adicionar certificado';
    botao.innerHTML = `
      <svg width="16" height="16" aria-hidden="true" viewBox="0 0 256 256" fill="currentColor"><path d="M224,128a8,8,0,0,1-8,8H136v80a8,8,0,0,1-16,0V136H40a8,8,0,0,1,0-16h80V40a8,8,0,0,1,16,0v80h80A8,8,0,0,1,224,128Z"/></svg>
    `;
  }

  function limparCamposCertificadoConfig() {
    const nomeInput = document.getElementById('config-cert-nome');
    const precoInput = document.getElementById('config-cert-preco');
    const linkInput = document.getElementById('config-cert-link');
    const tipoSelect = document.getElementById('config-cert-tipo');
    if (nomeInput) nomeInput.value = '';
    if (precoInput) precoInput.value = '';
    if (linkInput) linkInput.value = '';
    if (tipoSelect) tipoSelect.value = '';
    atualizarModoCertificadoConfig('');
  }

  function preencherCamposCertificadoConfig(nome) {
    const precoInput = document.getElementById('config-cert-preco');
    const linkInput = document.getElementById('config-cert-link');
    const tipoSelect = document.getElementById('config-cert-tipo');
    const certificado = obterCertificadoPorNome(nome);
    if (!precoInput || !linkInput) return;

    atualizarModoCertificadoConfig(nome);

    if (!certificado) {
      return;
    }

    precoInput.value = ComissaoCalculator.formatNumberBR(ComissaoCalculator.toNumber(certificado.valor || 0));
    linkInput.value = certificado.link_venda || '';
    if (tipoSelect) {
      const tipoResolvido = certificado.tipo || obterTipoCertificado(nome);
      tipoSelect.value = (tipoResolvido === 'CPF' || tipoResolvido === 'CNPJ') ? tipoResolvido : '';
    }
  }

  function inicializarCertificadosConfig() {
    const nomeInput = document.getElementById('config-cert-nome');
    const precoInput = document.getElementById('config-cert-preco');
    const linkInput = document.getElementById('config-cert-link');
    const addBtn = document.getElementById('config-cert-add-btn');
    const deleteBtn = document.getElementById('config-cert-delete-btn');
    const clearBtn = document.getElementById('config-cert-clear-btn');
    const caret = document.querySelector('.config-cert-name-wrap .config-cert-caret');
    if (!nomeInput || !precoInput || !linkInput || !addBtn || !deleteBtn) return;
    if (addBtn.dataset.bound === '1') return;

    addBtn.dataset.bound = '1';

    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        limparCamposCertificadoConfig();
        toastNotifier.success('Campos de certificado limpos com sucesso.');
      });
    }

    nomeInput.addEventListener('input', () => {
      atualizarModoCertificadoConfig(nomeInput.value);
      mostrarSugestoesCertificadoConfig(nomeInput.value);
    });

    nomeInput.addEventListener('change', () => {
      preencherCamposCertificadoConfig(nomeInput.value);
    });

    nomeInput.addEventListener('focus', () => {
      if (configCertHideSuggestionsTimer) {
        clearTimeout(configCertHideSuggestionsTimer);
        configCertHideSuggestionsTimer = null;
      }
      if (window.electronAPI?.cancelHide) {
        window.electronAPI.cancelHide();
      }
      mostrarSugestoesCertificadoConfig(nomeInput.value);
    });

    nomeInput.addEventListener('click', () => {
      mostrarSugestoesCertificadoConfig(nomeInput.value);
    });

    nomeInput.addEventListener('blur', () => {
      configCertHideSuggestionsTimer = setTimeout(() => {
        preencherCamposCertificadoConfig(nomeInput.value);
        esconderSugestoesCertificadoConfig();
      }, 120);
    });

    nomeInput.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        mostrarSugestoesCertificadoConfig(nomeInput.value);
        destacarSugestaoCertificadoConfig(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        mostrarSugestoesCertificadoConfig(nomeInput.value);
        destacarSugestaoCertificadoConfig(-1);
      } else if (event.key === 'Enter') {
        if (selecionarSugestaoAtivaCertificadoConfig()) {
          event.preventDefault();
        }
      } else if (event.key === 'Escape') {
        esconderSugestoesCertificadoConfig();
      }
    });

    if (caret) {
      caret.addEventListener('click', () => {
        nomeInput.focus();
        const lista = document.getElementById('config-cert-suggestions');
        if (lista?.classList.contains('is-hidden')) {
          mostrarSugestoesCertificadoConfig(nomeInput.value);
        } else {
          esconderSugestoesCertificadoConfig();
        }
      });
    }

    if (!configCertSuggestionsBound) {
      document.addEventListener('mousedown', (event) => {
        const wrap = document.querySelector('.config-cert-name-wrap');
        if (!wrap) return;
        if (!wrap.contains(event.target)) {
          esconderSugestoesCertificadoConfig();
        }
      });
      configCertSuggestionsBound = true;
    }

    addBtn.addEventListener('click', async () => {
      const nome = String(nomeInput.value || '').trim();
      const valor = ComissaoCalculator.toNumber(precoInput.value || 0);
      const linkVenda = String(linkInput.value || '').trim();
      const tipoSelect = document.getElementById('config-cert-tipo');
      const tipo = tipoSelect ? tipoSelect.value : 'CPF';

      if (!nome) {
        toastNotifier.warning('Informe o nome do certificado.');
        nomeInput.focus();
        return;
      }

      try {
        const resultado = await window.electronAPI.salvarCertificado({
          nome,
          valor,
          link_venda: linkVenda,
          tipo
        });

        if (!resultado?.success) {
          toastNotifier.error(`Nao foi possivel salvar o certificado: ${resultado?.error || 'erro desconhecido'}`);
          return;
        }

        await carregarCertificados();
        toastNotifier.success(
          resultado.action === 'updated'
            ? 'Certificado atualizado com sucesso.'
            : 'Certificado adicionado com sucesso.'
        );
        limparCamposCertificadoConfig();
      } catch (error) {
        console.error('Erro ao salvar certificado:', error);
        toastNotifier.error('Erro ao salvar certificado.');
      }
    });

    deleteBtn.addEventListener('click', async () => {
      const nome = String(nomeInput.value || '').trim();
      if (!nome) {
        toastNotifier.warning('Selecione um certificado para excluir.');
        return;
      }

      const confirmado = await showCustomModal({
        title: 'Excluir Certificado',
        message: `Tem certeza que deseja excluir o certificado "${nome}"?`,
        confirmText: 'Excluir',
        cancelText: 'Cancelar',
        hideCancel: false
      });
      if (!confirmado) return;

      try {
        const resultado = await window.electronAPI.excluirCertificado(nome);
        if (!resultado?.success) {
          toastNotifier.error(`Nao foi possivel excluir: ${resultado?.error || 'erro desconhecido'}`);
          return;
        }

        await carregarCertificados();
        toastNotifier.success('Certificado excluido com sucesso.');
        limparCamposCertificadoConfig();
      } catch (error) {
        console.error('Erro ao excluir certificado:', error);
        toastNotifier.error('Erro ao excluir certificado.');
      }
    });

    atualizarModoCertificadoConfig(nomeInput.value);
  }

  // Carregar certificados no dropdown
  async function carregarCertificados() {
    const certificadoSelect = document.getElementById('pedido-certificado-select');
    if (!certificadoSelect) return;

    try {
      const resultado = window.electronAPI && window.electronAPI.buscarCertificados ? await window.electronAPI.buscarCertificados() : null;
      
      if (resultado && resultado.success && resultado.data) {
        certificadosDataCache = Array.isArray(resultado.data) ? resultado.data : [];
        window.certificadosCacheGlobal = certificadosDataCache;
        certificadosLookup = new Map();

        // Limpa as opções existentes
        certificadoSelect.innerHTML = '';
        
        // Adiciona opção padrão
        const optionDefault = document.createElement('option');
        optionDefault.value = '';
        optionDefault.textContent = 'Selecione um certificado';
        certificadoSelect.appendChild(optionDefault);
        
        // Adiciona cada certificado como opção
        certificadosDataCache.forEach(cert => {
          const option = document.createElement('option');
          option.value = cert.nome;
          option.textContent = cert.nome;
          option.dataset.valor = cert.valor;
          option.dataset.link = cert.link_venda;
          certificadoSelect.appendChild(option);

          const nomeNormalizado = normalizarTextoRelatorio(cert.nome);
          const valorNumerico = parseNumeroMonetario(cert.valor);
          if (nomeNormalizado && valorNumerico > 0) {
            certificadosLookup.set(nomeNormalizado, valorNumerico);
          }
        });

        inicializarCertificadosConfig();
        atualizarDropdownCertificadoPedido();
        const nomeAtual = document.getElementById('config-cert-nome')?.value || '';
        preencherCamposCertificadoConfig(nomeAtual);
        
        console.log(`${certificadosDataCache.length} certificados carregados`);
        atualizarRelatorioConsulta(pedidosData);
      }
    } catch (error) {
      console.error('Erro ao carregar certificados:', error);
    }
  }
  window.carregarCertificados = carregarCertificados;

  // Função para formatar input de moeda (pt-BR) ao perder o foco
  function configurarPadronizacaoMoeda(id) {
    const input = document.getElementById(id);
    if (!input) return;

    input.addEventListener('blur', () => {
      const valor = input.value.trim();
      if (!valor) return;

      // Converte para número e depois formata de volta para pt-BR
      if (typeof window.parseMoedaParaNumero === 'function') {
        const num = window.parseMoedaParaNumero(valor);
        input.value = num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      }
      
      // Recalcula se for o preço
      if (id === 'pedido-preco-input' && typeof calcularComissao === 'function') {
        calcularComissao();
      }
    });

    // Permite apenas números, ponto e vírgula
    input.addEventListener('keypress', (e) => {
      if (!/[\d,.]/.test(e.key)) {
        e.preventDefault();
      }
    });
  }

  configurarPadronizacaoMoeda('pedido-preco-input');
  configurarPadronizacaoMoeda('pedido-comissao-input');
  configurarPadronizacaoMoeda('config-cert-preco');

  // Atualiza o preço ao selecionar certificado
  const pedidoInputMain = document.getElementById('pedido-numero-input');

  const certificadoSelect = document.getElementById('pedido-certificado-select');
  const certLinkCopyBtn = document.getElementById('cert-link-copy-btn');
  const certSelectTrigger = document.getElementById('pedido-cert-trigger');
  const certSelectTriggerText = document.getElementById('pedido-cert-trigger-text');
  const certSelectMenu = document.getElementById('pedido-cert-menu');
  const certSelectWrap = document.getElementById('pedido-cert-select-wrap');
  let certSelectCustomBound = false;

  function fecharDropdownCertificadoPedido() {
    if (!certSelectMenu || !certSelectTrigger) return;
    certSelectMenu.classList.add('is-hidden');
    certSelectTrigger.setAttribute('aria-expanded', 'false');
  }

  function atualizarDropdownCertificadoPedido() {
    if (!certificadoSelect || !certSelectMenu || !certSelectTriggerText) return;

    certSelectMenu.innerHTML = '';

    Array.from(certificadoSelect.options || []).forEach((opt, index) => {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'cert-select-item';
      item.setAttribute('role', 'option');
      item.dataset.index = String(index);
      item.textContent = String(opt.textContent || opt.value || '');

      if (index === certificadoSelect.selectedIndex) {
        item.classList.add('is-active');
        item.setAttribute('aria-selected', 'true');
      } else {
        item.setAttribute('aria-selected', 'false');
      }

      item.addEventListener('click', () => {
        certificadoSelect.selectedIndex = index;
        certificadoSelect.dispatchEvent(new Event('change', { bubbles: true }));
        fecharDropdownCertificadoPedido();
      });

      certSelectMenu.appendChild(item);
    });

    const optSelecionada = certificadoSelect.options?.[certificadoSelect.selectedIndex];
    certSelectTriggerText.textContent = String(
      optSelecionada?.textContent || optSelecionada?.value || 'Selecione um certificado'
    );
  }
  window.atualizarDropdownCertificadoPedido = atualizarDropdownCertificadoPedido;

  function inicializarDropdownCertificadoPedido() {
    if (!certificadoSelect || !certSelectTrigger || !certSelectMenu || !certSelectWrap) return;
    if (certSelectCustomBound) return;
    certSelectCustomBound = true;

    certSelectTrigger.addEventListener('click', () => {
      const fechado = certSelectMenu.classList.contains('is-hidden');
      if (fechado) {
        atualizarDropdownCertificadoPedido();
        certSelectMenu.classList.remove('is-hidden');
        certSelectTrigger.setAttribute('aria-expanded', 'true');
        if (window.electronAPI?.cancelHide) {
          window.electronAPI.cancelHide();
        }
      } else {
        fecharDropdownCertificadoPedido();
      }
    });

    document.addEventListener('mousedown', (event) => {
      if (!certSelectWrap.contains(event.target)) {
        fecharDropdownCertificadoPedido();
      }
    });

    certificadoSelect.addEventListener('change', atualizarDropdownCertificadoPedido);
    atualizarDropdownCertificadoPedido();
  }

  // Carrega certificados ao iniciar
  inicializarDropdownCertificadoPedido();
  carregarCertificados();

  function montarLinkCertificadoComCodRef(linkBase, codRef) {
    const base = String(linkBase || '').trim();
    const codigo = String(codRef || '').trim();
    if (!base) return '';
    if (!codigo) return base;

    if (base.includes('{cod_ref}')) {
      return base.replaceAll('{cod_ref}', encodeURIComponent(codigo));
    }

    if (/cod_(ref|rev)=/i.test(base)) {
      try {
        const url = new URL(base);
        if (url.searchParams.has('cod_ref')) {
          url.searchParams.set('cod_ref', codigo);
        } else if (url.searchParams.has('cod_rev')) {
          url.searchParams.set('cod_rev', codigo);
        } else {
          url.searchParams.set('cod_ref', codigo);
        }
        return url.toString();
      } catch {
        return base.replace(/(cod_(?:ref|rev)=)([^&]*)/i, `$1${encodeURIComponent(codigo)}`);
      }
    }

    if (/[=?]$/.test(base)) {
      return `${base}${encodeURIComponent(codigo)}`;
    }

    return base.includes('?')
      ? `${base}${base.endsWith('&') ? '' : '&'}cod_ref=${encodeURIComponent(codigo)}`
      : `${base}?cod_ref=${encodeURIComponent(codigo)}`;
  }

  async function copiarTextoClipboard(texto) {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
        return true;
      }
    } catch {}

    try {
      const ta = document.createElement('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return Boolean(ok);
    } catch {
      return false;
    }
  }

  function atualizarVisibilidadeSecaoEmpresaPorCertificado(certText) {
    const sectionEmpresa = document.getElementById('section-empresa');
    if (!sectionEmpresa) return;

    const texto = normalizarTextoRelatorio(certText || '');
    const temCnpj = /\b(CNPJ|E[-\s]?CNPJ|PJ)\b/.test(texto);
    const temCpf = /\b(CPF|E[-\s]?CPF|PF)\b/.test(texto);

    // Regra:
    // - Se identificar CNPJ (ou variação), mostra Dados Empresa
    // - Se identificar apenas CPF, oculta Dados Empresa
    // - Sem identificação clara, mantém visível
    const soCpf = temCpf && !temCnpj;
    sectionEmpresa.style.display = soCpf ? 'none' : '';

    // No layout de rotulo a esquerda as secoes nao trocam de coluna: Titular e
    // Empresa descem em lista, e Comentario/Anexos ficam sempre na faixa de
    // baixo. Ocultar Empresa apenas devolve a altura dela para essa faixa.
    window.__attachments?.refresh?.();
  }
  window.atualizarVisibilidadeSecaoEmpresaPorCertificado = atualizarVisibilidadeSecaoEmpresaPorCertificado;

  if (certificadoSelect) {
    certificadoSelect.addEventListener('change', (e) => {
      const selectedOption = e.target.options[e.target.selectedIndex];
      if (!selectedOption) {
        atualizarVisibilidadeSecaoEmpresaPorCertificado('');
        atualizarDropdownCertificadoPedido();
        atualizarVisibilidadeDadosPedidoPorCertificado();
        return;
      }

      const valor = selectedOption.dataset.valor;
      
      if (valor) {
        const precoInput = document.getElementById('pedido-preco-input');
        if (precoInput) {
          precoInput.value = ComissaoCalculator.formatNumberBR(ComissaoCalculator.toNumber(valor));
          // Após atualizar o preço, calcula a comissão
          calcularComissao();
        }
      }

      const certText = selectedOption.textContent || selectedOption.value || '';
      atualizarVisibilidadeSecaoEmpresaPorCertificado(certText);
      atualizarVisibilidadeDadosPedidoPorCertificado();
    });
  }

  if (certLinkCopyBtn && certificadoSelect) {
    certLinkCopyBtn.addEventListener('click', async () => {
      const opt = certificadoSelect.options[certificadoSelect.selectedIndex];
      const linkBase = String(opt?.dataset?.link || '').trim();

      if (!linkBase) {
        toastNotifier.warning('Certificado sem link de compra cadastrado.');
        return;
      }

      const codRef = String(document.getElementById('config-cod-rev')?.value || '').trim();
      const linkFinal = montarLinkCertificadoComCodRef(linkBase, codRef);
      const copiado = await copiarTextoClipboard(linkFinal);

      if (copiado) {
        toastNotifier.success('Link do certificado copiado.');
      } else {
        toastNotifier.error('Não foi possível copiar o link.');
      }
    });
  }

  // Função para calcular comissão baseada nas configurações
  function calcularComissao() {
    const calculadora = ComissaoCalculator.fromDOM();
    const precoInput = document.getElementById('pedido-preco-input');
    const detalhes = calculadora.calcular(precoInput?.value ?? 0);

    const comissaoInput = document.getElementById('pedido-comissao-input');
    if (comissaoInput) {
      comissaoInput.value = ComissaoCalculator.formatNumberBR(detalhes.valorFinal);
      comissaoInput.dispatchEvent(new Event('input', { bubbles: true }));
    }

    // Listener para o botão de informação
    const infoBtn = document.getElementById('ver-calculo-comissao');
    if (infoBtn) {
      // Remove listener antigo para evitar duplicidade
      const newBtn = infoBtn.cloneNode(true);
      infoBtn.parentNode.replaceChild(newBtn, infoBtn);
      
      newBtn.addEventListener('click', () => {
        const html = `
          <div class="calculo-detalhe">
            <div class="row"><span>Valor do certificado:</span> <span>${ComissaoCalculator.formatCurrencyBR(detalhes.valorBase)}</span></div>
            <div class="row"><span>Porcentagem na validação (${detalhes.percentualValidacao.toFixed(1)}%):</span> <span>${ComissaoCalculator.formatCurrencyBR(detalhes.valorBruto)}</span></div>
            <div class="divider"></div>
            <div class="row"><span>(=) Valor Bruto:</span> <span>${ComissaoCalculator.formatCurrencyBR(detalhes.valorBruto)}</span></div>
            <div class="row"><span>(-) Imposto de renda (${detalhes.percentualImposto.toFixed(1)}%):</span> <span style="color: #ff3b30;">-${ComissaoCalculator.formatCurrencyBR(detalhes.valorImposto)}</span></div>
            <div class="row"><span>(=) Valor líquido:</span> <span>${ComissaoCalculator.formatCurrencyBR(detalhes.valorLiquido)}</span></div>
            <div class="row"><span>(-) Desconto adicional:</span> <span style="color: #ff3b30;">-${ComissaoCalculator.formatCurrencyBR(detalhes.descontoAdicional)}</span></div>
            <div class="divider"></div>
            <div class="row total"><span>Valor final:</span> <span>${ComissaoCalculator.formatCurrencyBR(detalhes.valorFinal)}</span></div>
            <div class="obs">*Esse valor é apenas uma aproximação</div>
          </div>
        `;
        showCustomModal({
          title: 'COMO CHEGUEI NESSE VALOR?',
          message: html,
          confirmText: 'Entendido',
          hideCancel: true,
          useHTML: true
        });
      });
    }

    return detalhes.valorFinal;
  }

  // Expor a função globalmente se necessário
  window.calcularComissao = calcularComissao;

  // Atualiza a comissão se o preço for alterado manualmente
  const precoInputManual = document.getElementById('pedido-preco-input');
  if (precoInputManual) {
    precoInputManual.addEventListener('input', () => {
      calcularComissao();
    });
  }

  function abrirPickerMesAnoPersonalizado(inputElement) {
    if (!inputElement || inputElement.disabled) return;

    const valorAtual = inputElement.value || obterMesAtualInput();
    let [anoSelecionado, mesSelecionado] = valorAtual.split('-').map(Number);
    let anoVisualizado = anoSelecionado;

    // Cria o overlay
    const overlay = document.createElement('div');
    overlay.className = 'picker-overlay';

    // Cria o card
    const card = document.createElement('div');
    card.className = 'picker-card';
    overlay.appendChild(card);

    const mesesNomes = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    function renderizarCard() {
      card.innerHTML = `
        <div class="picker-header">
          <button type="button" class="picker-year-btn" id="picker-btn-prev-year">
            <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"/></svg>
          </button>
          <span class="picker-year-title" id="picker-txt-year">${anoVisualizado}</span>
          <button type="button" class="picker-year-btn" id="picker-btn-next-year">
            <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg>
          </button>
        </div>
        <div class="picker-months-grid">
          ${mesesNomes.map((nome, idx) => {
            const mNum = idx + 1;
            const isActive = (anoVisualizado === anoSelecionado && mNum === mesSelecionado);
            return `
              <button type="button" class="picker-month-btn ${isActive ? 'active' : ''}" data-month="${mNum}">
                ${nome.substring(0, 3)}
              </button>
            `;
          }).join('')}
        </div>
      `;

      // Year nav
      card.querySelector('#picker-btn-prev-year').onclick = (e) => {
        e.stopPropagation();
        anoVisualizado -= 1;
        renderizarCard();
      };

      card.querySelector('#picker-btn-next-year').onclick = (e) => {
        e.stopPropagation();
        anoVisualizado += 1;
        renderizarCard();
      };

      // Month select
      card.querySelectorAll('.picker-month-btn').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const m = Number(btn.getAttribute('data-month'));
          const mStr = String(m).padStart(2, '0');
          inputElement.value = `${anoVisualizado}-${mStr}`;
          inputElement.dispatchEvent(new Event('change'));
          fecharPicker();
        };
      });
    }

    function fecharPicker() {
      overlay.remove();
    }

    overlay.onclick = (e) => {
      if (e.target === overlay) {
        fecharPicker();
      }
    };

    // Calcula a posição do popup abaixo do input/wrapper
    const targetEl = inputElement.parentElement || inputElement;
    const rect = targetEl.getBoundingClientRect();
    card.style.position = 'absolute';
    card.style.top = `${rect.bottom + window.scrollY + 6}px`;

    // Alinhamento horizontal inteligente para evitar estourar a tela à direita
    const cardWidth = 280;
    if (rect.left + cardWidth > window.innerWidth) {
      card.style.left = `${rect.right - cardWidth + window.scrollX}px`;
    } else {
      card.style.left = `${rect.left + window.scrollX}px`;
    }

    renderizarCard();
    document.body.appendChild(overlay);
  }

  function abrirPickerDataPersonalizado(inputElement) {
    if (!inputElement || inputElement.disabled) return;

    // Obtém o valor atual (YYYY-MM-DD) ou data de hoje
    const valorAtual = inputElement.value || new Date().toISOString().split('T')[0];
    let [anoSelecionado, mesSelecionado, diaSelecionado] = valorAtual.split('-').map(Number);
    
    let anoVisualizado = anoSelecionado;
    let mesVisualizado = mesSelecionado;

    // Cria o overlay
    const overlay = document.createElement('div');
    overlay.className = 'picker-overlay';

    // Cria o card
    const card = document.createElement('div');
    card.className = 'picker-card';
    overlay.appendChild(card);

    const mesesNomes = [
      'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
      'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'
    ];

    const diasNomes = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];

    function renderizarCard() {
      // Cálculo dos dias do mês
      const primeiroDia = new Date(anoVisualizado, mesVisualizado - 1, 1);
      const diaSemanaInicial = primeiroDia.getDay(); // 0 = Dom, 6 = Sáb
      
      const totalDiasMes = new Date(anoVisualizado, mesVisualizado, 0).getDate();
      const totalDiasMesAnterior = new Date(anoVisualizado, mesVisualizado - 1, 0).getDate();
      
      const dias = [];
      
      // Dias do mês anterior (padded)
      for (let i = diaSemanaInicial - 1; i >= 0; i--) {
        dias.push({
          dia: totalDiasMesAnterior - i,
          outroMes: true,
          mes: mesVisualizado === 1 ? 12 : mesVisualizado - 1,
          ano: mesVisualizado === 1 ? anoVisualizado - 1 : anoVisualizado
        });
      }
      
      // Dias do mês atual
      for (let d = 1; d <= totalDiasMes; d++) {
        dias.push({
          dia: d,
          outroMes: false,
          mes: mesVisualizado,
          ano: anoVisualizado
        });
      }
      
      // Dias do próximo mês (padded)
      const totalSlots = dias.length <= 35 ? 35 : 42;
      const proxDiasPadded = totalSlots - dias.length;
      for (let n = 1; n <= proxDiasPadded; n++) {
        dias.push({
          dia: n,
          outroMes: true,
          mes: mesVisualizado === 12 ? 1 : mesVisualizado + 1,
          ano: mesVisualizado === 12 ? anoVisualizado + 1 : anoVisualizado
        });
      }

      card.innerHTML = `
        <div class="picker-header">
          <button type="button" class="picker-year-btn" id="picker-btn-prev-month">
            <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M165.66,202.34a8,8,0,0,1-11.32,11.32l-80-80a8,8,0,0,1,0-11.32l80-80a8,8,0,0,1,11.32,11.32L91.31,128Z"/></svg>
          </button>
          <span class="picker-year-title" id="picker-txt-title">${mesesNomes[mesVisualizado - 1]} ${anoVisualizado}</span>
          <button type="button" class="picker-year-btn" id="picker-btn-next-month">
            <svg width="12" height="12" viewBox="0 0 256 256" fill="currentColor"><path d="M181.66,133.66l-80,80a8,8,0,0,1-11.32-11.32L164.69,128,90.34,53.66a8,8,0,0,1,11.32-11.32l80,80A8,8,0,0,1,181.66,133.66Z"/></svg>
          </button>
        </div>
        
        <div class="picker-days-header">
          ${diasNomes.map((n) => `<span class="picker-day-name">${n}</span>`).join('')}
        </div>
        
        <div class="picker-days-grid">
          ${dias.map((item) => {
            const isActive = (!item.outroMes && anoSelecionado === item.ano && mesSelecionado === item.mes && diaSelecionado === item.dia);
            return `
              <button type="button" class="picker-day-btn ${item.outroMes ? 'other-month' : ''} ${isActive ? 'active' : ''}" 
                      data-day="${item.dia}" data-month="${item.mes}" data-ano="${item.ano}">
                ${item.dia}
              </button>
            `;
          }).join('')}
        </div>
      `;

      // Navegação de mês anterior
      card.querySelector('#picker-btn-prev-month').onclick = (e) => {
        e.stopPropagation();
        if (mesVisualizado === 1) {
          mesVisualizado = 12;
          anoVisualizado -= 1;
        } else {
          mesVisualizado -= 1;
        }
        renderizarCard();
      };

      // Navegação de próximo mês
      card.querySelector('#picker-btn-next-month').onclick = (e) => {
        e.stopPropagation();
        if (mesVisualizado === 12) {
          mesVisualizado = 1;
          anoVisualizado += 1;
        } else {
          mesVisualizado += 1;
        }
        renderizarCard();
      };

      // Seleção de dia
      card.querySelectorAll('.picker-day-btn').forEach((btn) => {
        btn.onclick = (e) => {
          e.stopPropagation();
          const d = Number(btn.getAttribute('data-day'));
          const m = Number(btn.getAttribute('data-month'));
          const a = Number(btn.getAttribute('data-ano'));
          
          const dStr = String(d).padStart(2, '0');
          const mStr = String(m).padStart(2, '0');
          
          inputElement.value = `${a}-${mStr}-${dStr}`;
          inputElement.dispatchEvent(new Event('change'));
          fecharPicker();
        };
      });
    }

    function fecharPicker() {
      overlay.remove();
    }

    overlay.onclick = (e) => {
      if (e.target === overlay) {
        fecharPicker();
      }
    };

    // Calcula a posição do popup abaixo do input/wrapper
    const targetEl = inputElement.parentElement || inputElement;
    const rect = targetEl.getBoundingClientRect();
    card.style.position = 'absolute';
    card.style.top = `${rect.bottom + window.scrollY + 6}px`;

    // Alinhamento horizontal inteligente para evitar estourar a tela à direita
    const cardWidth = 280;
    if (rect.left + cardWidth > window.innerWidth) {
      card.style.left = `${rect.right - cardWidth + window.scrollX}px`;
    } else {
      card.style.left = `${rect.left + window.scrollX}px`;
    }

    renderizarCard();
    document.body.appendChild(overlay);
  }

  // Campos de data que abrem o calendario proprio do app (o mesmo da Consulta)
  // em vez do seletor nativo do Chromium.
  const CAMPOS_DATA_CALENDARIO = new Set([
    'consulta-data-de',
    'consulta-data-ate',
    'pessoa-nascimento',
    'pedido-data-input',
  ]);

  function inicializarIconesDateTimeComPicker() {
    // '.input-icon-embedded' cobre Consulta/Indicadores; '#pedido .pf-ctl' cobre
    // a aba Dados Pedido, que usa a marcacao propria dela.
    const wrappers = document.querySelectorAll('.input-icon-embedded, #pedido .pf-ctl');
    wrappers.forEach((wrapper) => {
      const input = wrapper.querySelector('input[type="date"], input[type="time"], input[type="month"]');
      const icon = wrapper.querySelector('.icon.icon-embedded, .pf-icon');
      if (!input || !icon) return;
      if (icon.dataset.pickerBound === '1') return;
      icon.dataset.pickerBound = '1';

      const abrirPicker = (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (input.type === 'month') {
          setTimeout(() => {
            abrirPickerMesAnoPersonalizado(input);
          }, 10);
          return;
        }

        if (input.type === 'date' && CAMPOS_DATA_CALENDARIO.has(input.id)) {
          setTimeout(() => {
            abrirPickerDataPersonalizado(input);
          }, 10);
          return;
        }

        try {
          if (typeof input.showPicker === 'function') {
            input.showPicker();
          } else {
            input.focus();
            input.click();
          }
        } catch {
          input.focus();
          input.click();
        }
      };

      icon.addEventListener('click', abrirPicker);

      // Clicar no proprio campo tambem abre o calendario, mas so quando ele e
      // somente leitura — num campo digitavel (ex.: a Data do pedido) isso
      // roubaria o clique de quem quer digitar. Ali vale so o icone.
      const soLeitura = input.readOnly;
      if (input.type === 'month' || (input.type === 'date' && CAMPOS_DATA_CALENDARIO.has(input.id) && soLeitura)) {
        input.addEventListener('click', abrirPicker);
        input.style.cursor = 'pointer';
      }
    });
  }

  inicializarIconesDateTimeComPicker();

  // Sistema de tabs
  const tabBtns = document.querySelectorAll('.tab-btn');
  const tabContents = document.querySelectorAll('.tab-content');

  tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      // Remove active de todos
      tabBtns.forEach(b => b.classList.remove('active'));
      tabContents.forEach(c => c.classList.remove('active'));
      
      // Adiciona active no clicado
      btn.classList.add('active');
      const tabId = btn.getAttribute('data-tab');
      const tabEl = document.getElementById(tabId);
      if (tabEl) tabEl.classList.add('active');

      // Recalcula o estado do botão de pasta ao retornar para Dados Pedido
      if (tabId === 'pedido' && typeof atualizarStatusPastaPedido === 'function') {
        atualizarStatusPastaPedido();
      }

      // Redesenha os gráficos de Indicadores quando a aba se torna ativa (com delay para cálculo de largura preciso)
      if (tabId === 'indicadores' && typeof renderizarIndicadoresUltimoSnapshot === 'function') {
        setTimeout(() => {
          renderizarIndicadoresUltimoSnapshot();
        }, 50);
      }
    });
  });

  // Subabas de Configurações
  const configSubtabBtns = document.querySelectorAll('.config-subtab-btn');
  const configSubtabContents = document.querySelectorAll('.config-subtab-content');

  configSubtabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      configSubtabBtns.forEach((b) => b.classList.remove('active'));
      configSubtabContents.forEach((c) => c.classList.remove('active'));

      btn.classList.add('active');
      const subtabId = btn.getAttribute('data-subtab');
      const subtabEl = document.getElementById(subtabId);
      if (subtabEl) subtabEl.classList.add('active');
    });
  });

  // Alternar visibilidade de campos de senha (Configurações > Conta / Novo usuário)
  const ICONE_OLHO_ABERTO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
  const ICONE_OLHO_FECHADO = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';

  function inicializarToggleSenha(inputId, toggleId) {
    const input = document.getElementById(inputId);
    const toggle = document.getElementById(toggleId);
    if (!input || !toggle) return;
    toggle.addEventListener('click', () => {
      const mostrando = input.type === 'text';
      input.type = mostrando ? 'password' : 'text';
      toggle.title = mostrando ? 'Mostrar senha' : 'Ocultar senha';
      toggle.innerHTML = mostrando ? ICONE_OLHO_ABERTO : ICONE_OLHO_FECHADO;
    });
  }

  inicializarToggleSenha('config-senha-email', 'config-senha-email-toggle');
  inicializarToggleSenha('config-novo-usuario-senha', 'config-novo-usuario-senha-toggle');
  inicializarToggleSenha('config-novo-usuario-senha2', 'config-novo-usuario-senha2-toggle');

  // Máscara para CNPJ
  function maskCNPJ(value) {
    // Remove tudo que não é número
    value = value.replace(/\D/g, '');
    
    // Limita a 14 dígitos
    value = value.substring(0, 14);
    
    // Aplica a máscara
    if (value.length <= 2) {
      return value;
    } else if (value.length <= 5) {
      return value.replace(/(\d{2})(\d{0,3})/, '$1.$2');
    } else if (value.length <= 8) {
      return value.replace(/(\d{2})(\d{3})(\d{0,3})/, '$1.$2.$3');
    } else if (value.length <= 12) {
      return value.replace(/(\d{2})(\d{3})(\d{3})(\d{0,4})/, '$1.$2.$3/$4');
    } else {
      return value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, '$1.$2.$3/$4-$5');
    }
  }

  // Máscara para CPF
  function maskCPF(value) {
    // Remove tudo que não é número
    value = value.replace(/\D/g, '');
    
    // Limita a 11 dígitos
    value = value.substring(0, 11);
    
    // Aplica a máscara
    if (value.length <= 3) {
      return value;
    } else if (value.length <= 6) {
      return value.replace(/(\d{3})(\d{0,3})/, '$1.$2');
    } else if (value.length <= 9) {
      return value.replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3');
    } else {
      return value.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
    }
  }

  // Remove máscara do CPF (retorna apenas números)
  function unmaskCPF(value) {
    return value.replace(/\D/g, '');
  }

  // Remove máscara do CNPJ (retorna apenas números)
  function unmaskCNPJ(value) {
    return value.replace(/\D/g, '');
  }

  // Função para buscar dados da empresa na Receita Federal
  async function buscarDadosEmpresa(cnpj) {
    const cnpjLimpo = unmaskCNPJ(cnpj);
    
    if (cnpjLimpo.length !== 14) {
      console.log('CNPJ inválido:', cnpjLimpo);
      return null;
    }
    
    const loadingIcon = document.getElementById('cnpj-loading-icon');
    // O campo CNPJ tem um unico icone (o atalho para a Receita); durante a
    // consulta ele da lugar ao indicador de carregamento, no mesmo ponto.
    const normalIcon = document.getElementById('cnpj-receita-btn');
    const warningDiv = document.getElementById('empresa-inapta-warning');

    try {
      // Mostrar loading
      if (loadingIcon && normalIcon) {
        normalIcon.style.display = 'none';
        loadingIcon.style.display = 'flex';
      }
      
      console.log('Buscando dados do CNPJ:', cnpjLimpo);
      
      const response = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${cnpjLimpo}`);
      
      if (!response.ok) {
        throw new Error(`Erro na API: ${response.status}`);
      }
      
      const dados = await response.json();
      console.log('Dados da empresa recebidos:', dados);
      
      // Preencher campos
      const campos = {
        'empresa-razao-social': dados.razao_social || '',
        'empresa-nome-fantasia': dados.nome_fantasia || '',
        'empresa-situacao': dados.descricao_situacao_cadastral || '',
        'empresa-data-situacao': dados.data_situacao_cadastral ? formatarData(dados.data_situacao_cadastral) : '',
        'empresa-motivo-situacao': dados.descricao_motivo_situacao_cadastral || '',
        'empresa-porte': dados.porte || '',
        'empresa-natureza-juridica': dados.natureza_juridica || '',
        'empresa-data-abertura': dados.data_inicio_atividade ? formatarData(dados.data_inicio_atividade) : '',
        'empresa-capital-social': dados.capital_social ? `R$ ${parseFloat(dados.capital_social).toLocaleString('pt-BR', {minimumFractionDigits: 2})}` : '',
        'empresa-cep': dados.cep ? dados.cep.replace(/(\d{5})(\d{3})/, '$1-$2') : '',
        'empresa-municipio': dados.municipio || '',
        'empresa-uf': dados.uf || '',
        'empresa-bairro': dados.bairro || '',
        'empresa-logradouro': dados.logradouro || '',
        'empresa-numero': dados.numero || '',
        'empresa-complemento': dados.complemento || '',
        'empresa-telefone': dados.ddd_telefone_1 || '',
        'empresa-email': dados.email || ''
      };
      
      // Preencher os campos
      Object.keys(campos).forEach(id => {
        const input = document.getElementById(id);
        if (input) {
          input.value = campos[id];
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
      
      // Aviso de inapta e icone de situacao saem do valor da situacao
      // cadastral — a mesma funcao roda ao recarregar um pedido salvo.
      atualizarSituacaoEmpresa(dados.descricao_situacao_cadastral);
      
      return dados;
    } catch (error) {
      console.error('Erro ao buscar dados da empresa:', error);
      
      // Esconder warning se houver erro
      if (warningDiv) {
        warningDiv.style.display = 'none';
      }
      
      return null;
    } finally {
      // Restaurar ícone normal
      if (loadingIcon && normalIcon) {
        loadingIcon.style.display = 'none';
        normalIcon.style.display = '';
      }
    }
  }

  // Função auxiliar para formatar data
  function formatarData(dataString) {
    // Espera formato YYYY-MM-DD
    if (!dataString) return '';
    const partes = dataString.split('-');
    if (partes.length === 3) {
      return `${partes[2]}/${partes[1]}/${partes[0]}`;
    }
    return dataString;
  }

  // Aplica máscara no campo CNPJ e busca dados ao terminar
  const cnpjInput = document.getElementById('empresa-cnpj');
  if (cnpjInput) {
    cnpjInput.addEventListener('input', (e) => {
      const cursorPos = e.target.selectionStart;
      const oldValue = e.target.value;
      const newValue = maskCNPJ(oldValue);
      e.target.value = newValue;
      
      // Ajusta a posição do cursor
      if (newValue.length > oldValue.length) {
        e.target.setSelectionRange(cursorPos + 1, cursorPos + 1);
      } else {
        e.target.setSelectionRange(cursorPos, cursorPos);
      }

      // Apagar o CNPJ apaga a empresa junto: senao razao social, endereco e
      // situacao continuariam na tela pertencendo a um CNPJ que nao esta mais
      // ali, e seriam salvos assim.
      if (unmaskCNPJ(newValue).length === 0) {
        limparCamposEmpresa();
        atualizarBotaoReceitaCnpj();
      }
    });

    // Consulta o cartao CNPJ no site da Receita Federal
    const receitaBtn = document.getElementById('cnpj-receita-btn');

    function atualizarBotaoReceitaCnpj() {
      if (!receitaBtn) return;
      const valido = unmaskCNPJ(cnpjInput.value).length === 14;
      receitaBtn.classList.toggle('is-disabled', !valido);
      receitaBtn.title = valido
        ? 'Consultar o cartão CNPJ na Receita Federal'
        : 'Preencha o CNPJ para consultar na Receita Federal';
    }

    async function abrirCartaoCnpjReceita() {
      const cnpjLimpo = unmaskCNPJ(cnpjInput.value);
      if (cnpjLimpo.length !== 14) return;
      const url = `https://solucoes.receita.fazenda.gov.br/Servicos/cnpjreva/Cnpjreva_Solicitacao.asp?cnpj=${cnpjLimpo}`;
      try {
        await window.electronAPI?.abrirLinkExterno?.(url);
      } catch (error) {
        console.error('Erro ao abrir consulta de CNPJ na Receita:', error);
      }
    }

    if (receitaBtn) {
      receitaBtn.addEventListener('click', abrirCartaoCnpjReceita);
      receitaBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          abrirCartaoCnpjReceita();
        }
      });
      cnpjInput.addEventListener('input', atualizarBotaoReceitaCnpj);
      atualizarBotaoReceitaCnpj();
    }


    // Buscar dados ao sair do campo (blur)
    cnpjInput.addEventListener('blur', async () => {
      const cnpj = cnpjInput.value;
      const cnpjLimpo = unmaskCNPJ(cnpj);
      
      if (cnpjLimpo.length === 14) {
        await buscarDadosEmpresa(cnpj);
      }
    });
    
    // Buscar dados ao pressionar Enter
    cnpjInput.addEventListener('keypress', async (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const cnpj = cnpjInput.value;
        const cnpjLimpo = unmaskCNPJ(cnpj);
        
        if (cnpjLimpo.length === 14) {
          await buscarDadosEmpresa(cnpj);
        }
        cnpjInput.blur();
      }
    });
    
    // Aplica máscara no valor inicial se existir
    if (cnpjInput.value) {
      cnpjInput.value = maskCNPJ(cnpjInput.value);
    }
  }

});

// Helpers globais usados por carregamento/salvamento do pedido.
// As mesmas máscaras também existem no inicializador da tela; manter aqui evita
// ReferenceError quando as rotinas abaixo rodam fora daquele escopo.
function maskCNPJ(value) {
  value = String(value || '').replace(/\D/g, '').substring(0, 14);

  if (value.length <= 2) {
    return value;
  } else if (value.length <= 5) {
    return value.replace(/(\d{2})(\d{0,3})/, '$1.$2');
  } else if (value.length <= 8) {
    return value.replace(/(\d{2})(\d{3})(\d{0,3})/, '$1.$2.$3');
  } else if (value.length <= 12) {
    return value.replace(/(\d{2})(\d{3})(\d{3})(\d{0,4})/, '$1.$2.$3/$4');
  }

  return value.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{0,2})/, '$1.$2.$3/$4-$5');
}

function maskCPF(value) {
  value = String(value || '').replace(/\D/g, '').substring(0, 11);

  if (value.length <= 3) {
    return value;
  } else if (value.length <= 6) {
    return value.replace(/(\d{3})(\d{0,3})/, '$1.$2');
  } else if (value.length <= 9) {
    return value.replace(/(\d{3})(\d{3})(\d{0,3})/, '$1.$2.$3');
  }

  return value.replace(/(\d{3})(\d{3})(\d{3})(\d{0,2})/, '$1.$2.$3-$4');
}

function unmaskCPF(value) {
  return String(value || '').replace(/\D/g, '');
}

function unmaskCNPJ(value) {
  return String(value || '').replace(/\D/g, '');
}

// Função para buscar dados da pessoa por CPF
async function buscarDadosPorCPF(cpf) {
  const cpfLimpo = unmaskCPF(cpf);
  
  if (cpfLimpo.length !== 11) {
    console.log('CPF inválido:', cpfLimpo);
    return null;
  }
  
  const loadingIcon = document.getElementById('cpf-loading-icon');
  const normalIcon = document.getElementById('cpf-icon');
  
  try {
    // Mostrar loading
    if (loadingIcon && normalIcon) {
      normalIcon.style.display = 'none';
      // 'flex' e nao 'block': .pf-icon centraliza o conteudo com inline-flex, e
      // com display:block o anel do spinner ficava fora de centro.
      loadingIcon.style.display = 'flex';
    }
    
    console.log('[info] Buscando histórico do CPF no banco de dados:', cpfLimpo);
    
    // Busca pedidos anteriores deste CPF no banco de dados
    const resultado = await window.electronAPI.buscarPedidos({ busca: cpfLimpo });
    
    if (resultado?.success && resultado.data?.length) {
      // Pega o pedido mais recente com esse CPF
      const pedidosOrdenados = [...resultado.data].sort((a, b) => (b.id || 0) - (a.id || 0));
      const p = pedidosOrdenados[0];
      
      console.log('[ok] Dados do cliente encontrados no banco:', p);
      
      // Preencher o campo nome
      const nomeInput = document.getElementById('pessoa-nome');
      if (nomeInput && p.nome && !nomeInput.value) {
        nomeInput.value = p.nome;
        nomeInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      // Preencher data de nascimento
      const nascimentoInput = document.getElementById('pessoa-nascimento');
      if (nascimentoInput && p.nascimento && !nascimentoInput.value) {
        nascimentoInput.value = formatarDataISO(p.nascimento) || p.nascimento;
        nascimentoInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      
      // Preencher nome da mãe
      const maeInput = document.getElementById('pessoa-mae');
      if (maeInput && p.nome_mae && !maeInput.value) {
        maeInput.value = p.nome_mae;
        maeInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Preencher telefone
      const telInput = document.getElementById('pessoa-telefone');
      if (telInput && p.telefone && !telInput.value) {
        telInput.value = maskTelefone(p.telefone);
        telInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Preencher e-mail
      const emailInput = document.getElementById('pessoa-email');
      if (emailInput && p.email && !emailInput.value) {
        emailInput.value = p.email;
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Preencher RG
      const rgInput = document.getElementById('pessoa-rg');
      if (rgInput && p.rg && !rgInput.value) {
        rgInput.value = p.rg;
        rgInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Preencher Órgão RG
      const orgaoInput = document.getElementById('pessoa-orgao-rg');
      if (orgaoInput && p.orgao_rg && !orgaoInput.value) {
        orgaoInput.value = p.orgao_rg;
        orgaoInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Preencher CNH
      const cnhInput = document.getElementById('pessoa-cnh');
      if (cnhInput && p.cnh && !cnhInput.value) {
        cnhInput.value = p.cnh;
        cnhInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Preencher Código de Segurança CNH
      const codSegInput = document.getElementById('pessoa-cod-seg-cnh');
      if (codSegInput && p.cod_seg_cnh && !codSegInput.value) {
        codSegInput.value = p.cod_seg_cnh;
        codSegInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      // Preencher PIS / CEI
      const pisInput = document.getElementById('pessoa-pis');
      if (pisInput && (p.pis_cei || p.pis) && !pisInput.value) {
        pisInput.value = p.pis_cei || p.pis;
        pisInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      return p;
    } else {
      console.log('[aviso] Nenhum cadastro anterior encontrado para este CPF no banco.');
      return null;
    }
  } catch (error) {
    console.error('[erro] Erro ao buscar dados do CPF no banco:', error);
    return null;
  } finally {
    // Restaurar ícone normal
    if (loadingIcon && normalIcon) {
      loadingIcon.style.display = 'none';
      normalIcon.style.display = '';
    }
  }
}

// Aplica máscara no campo CPF com busca automática
const cpfInput = document.getElementById('pessoa-cpf');
console.log('[info] Campo CPF encontrado:', !!cpfInput);

if (cpfInput) {
  cpfInput.addEventListener('input', (e) => {
    const cursorPos = e.target.selectionStart;
    const oldValue = e.target.value;
    const newValue = maskCPF(oldValue);
    e.target.value = newValue;
    
    // Ajusta a posição do cursor
    if (newValue.length > oldValue.length) {
      e.target.setSelectionRange(cursorPos + 1, cursorPos + 1);
    } else {
      e.target.setSelectionRange(cursorPos, cursorPos);
    }
  });
  
  // Buscar dados ao sair do campo (blur)
  cpfInput.addEventListener('blur', async () => {
    console.log('[info] Evento blur disparado no CPF');
    const cpf = cpfInput.value;
    const cpfLimpo = unmaskCPF(cpf);
    console.log('CPF digitado:', cpf, 'CPF limpo:', cpfLimpo, 'Tamanho:', cpfLimpo.length);
    
    if (cpfLimpo.length === 11) {
      console.log('[ok] CPF válido, iniciando busca...');
      await buscarDadosPorCPF(cpf);
    } else {
      console.log('[aviso] CPF incompleto, busca não realizada');
    }
  });
  
  // Buscar dados ao pressionar Enter
  cpfInput.addEventListener('keypress', async (e) => {
    if (e.key === 'Enter') {
      console.log('[info] Enter pressionado no CPF');
      e.preventDefault();
      const cpf = cpfInput.value;
      const cpfLimpo = unmaskCPF(cpf);
      
      if (cpfLimpo.length === 11) {
        await buscarDadosPorCPF(cpf);
      }
      cpfInput.blur();
    }
  });
  
  // Aplica máscara no valor inicial se existir
  if (cpfInput.value) {
    cpfInput.value = maskCPF(cpfInput.value);
  }
  
  console.log('[ok] Listeners de busca por CPF configurados');
} else {
  console.error('[erro] Campo CPF não encontrado! ID: pessoa-cpf');
}

// Fallback: se o seletor antigo ainda existir, remover listener
const oldCpfInput = document.querySelector('#subtab-pessoais .doc-section:nth-child(2) .form-grid-3 .form-field:nth-child(1) .input-icon input');
if (oldCpfInput && oldCpfInput !== cpfInput && oldCpfInput.id !== 'pessoa-cpf') {
  oldCpfInput.addEventListener('input', (e) => {
    const cursorPos = e.target.selectionStart;
    const oldValue = e.target.value;
    const newValue = maskCPF(oldValue);
    e.target.value = newValue;
    
    // Ajusta a posição do cursor
    if (newValue.length > oldValue.length) {
      e.target.setSelectionRange(cursorPos + 1, cursorPos + 1);
    } else {
      e.target.setSelectionRange(cursorPos, cursorPos);
    }
  });
  
  // Aplica máscara no valor inicial se existir
  if (oldCpfInput.value) {
    oldCpfInput.value = maskCPF(oldCpfInput.value);
  }
}

// =============================================
// SISTEMA DE SALVAMENTO MANUAL
// =============================================

let currentPedidoId = null;
let isSaving = false;
let currentUser = null; // Armazena o usuário logado
let isLoadingPedido = false; // Flag para evitar marcar alterações durante carregamento

// Buscar usuário logado ao iniciar
async function carregarUsuarioLogado() {
  try {
    // Tenta buscar do processo principal
    const userData = await window.electronAPI.getCurrentUser();
    if (userData) {
      currentUser = userData;
      console.log('[ok] usuário carregado:', currentUser.email);
      return;
    }
    
    // Se não encontrar, tenta do localStorage
    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      currentUser = JSON.parse(storedUser);
      console.log('[ok] usuário carregado do localStorage:', currentUser.email);
    } else {
      console.warn('[aviso] Nenhum usuário encontrado');
    }
  } catch (error) {
    console.error('[erro] Erro ao carregar usuário:', error);
  }
}

// Carregar usuário e configurações ao iniciar
carregarUsuarioLogado().then(() => {
  carregarConfiguracoes();
});

// Elementos do status de salvamento manual
const statusElement = document.getElementById('pedido-save-status');
const statusIcon = statusElement?.querySelector('.status-icon');
const statusText = statusElement?.querySelector('.status-text');
const pedidoSaveBtn = document.getElementById('pedido-save-btn');
const pedidoClearBtn = document.getElementById('pedido-clear-btn');

// Ícones SVG Phosphor para diferentes estados (viewBox 0 0 256 256)
const icons = {
  idle: `<path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/>`,
  saving: `<path d="M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z"/>`,
  saved: `<path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/>`,
  updated: `<path d="M224,48V96a8,8,0,0,1-8,8H168a8,8,0,0,1,0-16h28.69L182.06,73.37a79.56,79.56,0,0,0-56.13-23.43h-.45A79.52,79.52,0,0,0,69.59,72.71,8,8,0,0,1,58.41,61.27a96,96,0,0,1,135,.79L208,76.69V48a8,8,0,0,1,16,0ZM186.41,183.29a80,80,0,0,1-112.47-.66L59.31,168H88a8,8,0,0,0,0-16H40a8,8,0,0,0-8,8v48a8,8,0,0,0,16,0V179.31l14.63,14.63A95.43,95.43,0,0,0,130,222.06h.53a95.36,95.36,0,0,0,67.07-27.33,8,8,0,0,0-11.18-11.44Z"/>`,
  dirty: `<path d="M227.31,73.37,182.63,28.69a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.69,147.31,64l24-24L216,84.69Z"/>`,
  cleared: `<path d="M225,80.4,183.6,39a24,24,0,0,0-33.94,0L31,157.66a24,24,0,0,0,0,33.94l30.06,30.06A8,8,0,0,0,66.74,224H216a8,8,0,0,0,0-16h-84.7L225,114.34A24,24,0,0,0,225,80.4ZM108.68,208H70.05L42.33,180.28a8,8,0,0,1,0-11.31L96,115.31,148.69,168Zm105-105L160,156.69,107.31,104,161,50.34a8,8,0,0,1,11.32,0l41.38,41.38a8,8,0,0,1,0,11.31Z"/>`,
  error: `<path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z"/>`
};

let ultimoErroSalvamento = '';

// Função para atualizar o status visual
function atualizarStatusSalvamento(estado, mensagem, detalhesErro = '') {
  if (!statusElement || !statusIcon) return;
  
  const infoBtn = document.getElementById('ver-erro-salvamento');
  if (estado === 'error' && detalhesErro) {
    ultimoErroSalvamento = detalhesErro;
    if (infoBtn) {
      infoBtn.style.display = 'flex';
      // Garante que o listener seja adicionado apenas uma vez
      if (!infoBtn.dataset.listener) {
        infoBtn.onclick = () => {
          showCustomModal({
            title: 'Log de Erro',
            message: ultimoErroSalvamento,
            confirmText: 'Fechar',
            hideCancel: true
          });
        };
        infoBtn.dataset.listener = 'true';
      }
    }
  } else if (estado !== 'error') {
    if (infoBtn) infoBtn.style.display = 'none';
  }
  
  // Remove todas as classes de estado
  statusElement.classList.remove('idle', 'saving', 'saved', 'updated', 'dirty', 'cleared', 'error');
  
  // Adiciona a classe do novo estado
  statusElement.classList.add(estado);
  
  // Atualiza o ícone
  statusIcon.innerHTML = icons[estado] || icons.idle;
  if (statusText) statusText.textContent = mensagem;
  
  // Atualiza o tooltip
  statusElement.title = mensagem;
  
  // Atualiza cor do botão de salvar se houver alterações
  if (pedidoSaveBtn) {
    if (estado === 'dirty') {
      pedidoSaveBtn.classList.add('dirty');
    } else {
      pedidoSaveBtn.classList.remove('dirty');
    }
  }
}

// Auxiliar para converter valores monetários (BRL) para número (DB)
window.parseMoedaParaNumero = function(valor) {
  return ComissaoCalculator.toNumber(valor);
};

function parseMoedaParaNumero(valor) {
  return window.parseMoedaParaNumero(valor);
}

function coletarDadosFormulario(allowEmpty = false) {
  const pedidoInput = document.getElementById('pedido-numero-input') || document.querySelector('.pedido-field input[type="text"]');
  const pedidoNumero = pedidoInput?.value?.trim();
  
  if (!pedidoNumero && !allowEmpty) return null;
  
  if ((!currentUser || !currentUser.email) && !allowEmpty) {
    console.error('[coletarDadosFormulario] Erro ao coletar pedido: usuário não logado');
    return null;
  }

  let statusColetado = 'DIGITAÇÃO';
  const radios = document.querySelectorAll('#pedido input[name="status"]');
  for (const r of radios) {
    if (r.checked) {
      statusColetado = normalizarStatus(r.value);
      break;
    }
  }
  
  const data = {
    usuario: currentUser?.email || null,
    pedido: pedidoNumero,
    data: document.getElementById('pedido-data-input')?.value || null,
    hora: document.getElementById('pedido-hora-input')?.value || null,
    versao: document.getElementById('pedido-certificado-select')?.value || null,
    modalidade: document.getElementById('pedido-modalidade-select')?.value || null,
    venda: document.getElementById('pedido-venda-select')?.value === 'sim' ? 'sim' : 'nao',
    preco_certificado: parseMoedaParaNumero(document.getElementById('pedido-preco-input')?.value),
    comissao: parseMoedaParaNumero(document.getElementById('pedido-comissao-input')?.value),
    status: statusColetado,
    
    // Dados Pessoais
    nome: document.getElementById('pessoa-nome')?.value || null,
    nascimento: document.getElementById('pessoa-nascimento')?.value || null,
    email: document.getElementById('pessoa-email')?.value || null,
    telefone: document.getElementById('pessoa-telefone')?.value || null,
    mae: document.getElementById('pessoa-mae')?.value || null,
    cpf: unmaskCPF(document.getElementById('pessoa-cpf')?.value || ''),
    rg: document.getElementById('pessoa-rg')?.value || null,
    orgao_rg: document.getElementById('pessoa-orgao-rg')?.value || null,
    cnh: document.getElementById('pessoa-cnh')?.value || null,
    codigo_de_seg_cnh: document.getElementById('pessoa-cnh-seguranca')?.value || null,
    
    // Outros Documentos
    certificado: document.getElementById('pessoa-funcional')?.value || null,
    digito_cpf: document.getElementById('pessoa-pis')?.value || null,
    
    // Dados da Empresa
    cnpj: unmaskCNPJ(document.getElementById('empresa-cnpj')?.value || ''),
    situacao_cadastral: document.getElementById('empresa-situacao')?.value || null,
    data_situacao_cadastral: document.getElementById('empresa-data-situacao')?.value || null,
    razao_social: document.getElementById('empresa-razao-social')?.value || null,
    nome_fantasia: document.getElementById('empresa-nome-fantasia')?.value || null,
    data_abertura: document.getElementById('empresa-data-abertura')?.value || null,
    capital_social: document.getElementById('empresa-capital-social')?.value || null,
    cep: document.getElementById('empresa-cep')?.value || null,
    municipio: document.getElementById('empresa-municipio')?.value || null,
    uf: document.getElementById('empresa-uf')?.value || null,
    bairro: document.getElementById('empresa-bairro')?.value || null,
    logradouro: document.getElementById('empresa-logradouro')?.value || null,
    complemento: document.getElementById('empresa-complemento')?.value || null,
    junta: document.getElementById('empresa-junta')?.value || null,
    diretorio: document.getElementById('config-pasta')?.value || null,
    pasta: document.getElementById('config-pasta-cliente')?.value || null,

    // Comentarios
    comentarios: document.getElementById('pedido-comentarios')?.value || null,
  };

  console.log('[coletarDadosFormulario] Dados coletados com sucesso:', {
    pedido: data.pedido,
    usuario: data.usuario,
    status: data.status
  });

  return data;
}





// Função para salvar pedido
function normalizarDadosPedidoParaComparacao(valor) {
  if (valor === undefined || valor === '') return null;
  if (valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map(normalizarDadosPedidoParaComparacao);

  return Object.keys(valor)
    .filter((chave) => chave !== 'usuario')
    .sort()
    .reduce((normalizado, chave) => {
      normalizado[chave] = normalizarDadosPedidoParaComparacao(valor[chave]);
      return normalizado;
    }, {});
}

function serializarDadosPedidoParaComparacao(dados) {
  return JSON.stringify(normalizarDadosPedidoParaComparacao(dados || {}));
}

function clonarDadosPedido(dados) {
  return JSON.parse(JSON.stringify(normalizarDadosPedidoParaComparacao(dados || {})));
}

function obterAbaPedidoAtiva() {
  return pedidoTabs.find(t => t.id === activePedidoTabId);
}

function obterSnapshotPedidoAtual() {
  return coletarDadosFormulario(true) || {};
}

function definirBaselinePedidoAtual(dados = obterSnapshotPedidoAtual()) {
  const currentTab = obterAbaPedidoAtiva();
  if (!currentTab) return;

  const snapshot = clonarDadosPedido(dados);
  currentTab.baseline = snapshot;
  currentTab.data = snapshot;
  currentTab.dirty = false;
  atualizarStatusSalvamento(currentPedidoId ? 'saved' : 'idle', currentPedidoId ? 'Salvo' : 'Pronto');
}

function atualizarEstadoAlteracaoPedidoAtual({ updateStatus = true } = {}) {
  const currentTab = obterAbaPedidoAtiva();
  if (!currentTab) return false;

  const snapshot = clonarDadosPedido(obterSnapshotPedidoAtual());
  if (!currentTab.baseline) {
    currentTab.baseline = clonarDadosPedido(snapshot);
  }

  const alterado = serializarDadosPedidoParaComparacao(snapshot) !== serializarDadosPedidoParaComparacao(currentTab.baseline);
  currentTab.data = snapshot;
  currentTab.dirty = alterado;

  if (updateStatus) {
    if (alterado) {
      atualizarStatusSalvamento('dirty', 'Alterado');
    } else {
      atualizarStatusSalvamento(currentPedidoId ? 'saved' : 'idle', currentPedidoId ? 'Salvo' : 'Pronto');
    }
  }

  return alterado;
}

function possuiAlteracoesPendentesExcetoPedido() {
  const currentTab = obterAbaPedidoAtiva();
  if (!currentTab) return false;

  const atual = clonarDadosPedido(obterSnapshotPedidoAtual());
  const baseline = clonarDadosPedido(currentTab.baseline || {});

  delete atual.pedido;
  delete baseline.pedido;

  return serializarDadosPedidoParaComparacao(atual) !== serializarDadosPedidoParaComparacao(baseline);
}

async function salvarPedido(options = {}) {
  const { force = false } = options;
  console.log('[salvarPedido] Tentativa de salvar pedido iniciada.', {
    force,
    isSaving,
    currentPedidoId,
    currentUser: currentUser?.email
  });

  if (isSaving) {
    console.warn('[salvarPedido] Salvamento já em andamento. Ignorando clique duplicado.');
    return false;
  }

  if (!currentUser?.email) {
    console.log('[salvarPedido] Usuário atual não carregado. Tentando obter sessão...');
    await carregarUsuarioLogado();
    console.log('[salvarPedido] Sessão após recarga:', currentUser?.email);
  }
  
  const dados = coletarDadosFormulario();
  console.log('[salvarPedido] Dados obtidos do formulário:', dados);

  if (!dados) {
    console.error('[salvarPedido] Falha na coleta de dados: formulário retornou null.');
    atualizarStatusSalvamento('error', 'Preencha o pedido');
    return false;
  }

  const numPedido = dados?.pedido?.trim();
  const dataPedido = dados?.data?.trim();
  const horaPedido = dados?.hora?.trim();
  const certificadoPedido = dados?.versao?.trim();

  if (!numPedido) {
    console.warn('[salvarPedido] Validação falhou: Número do pedido vazio.');
    if (window.toastNotifier) {
      window.toastNotifier.warning('Por favor, preencha o número do Pedido!');
    }
    atualizarStatusSalvamento('error', 'Informe o número');
    return false;
  }

  if (!dataPedido) {
    console.warn('[salvarPedido] Validação falhou: Data do pedido vazia.');
    if (window.toastNotifier) {
      window.toastNotifier.warning('Por favor, preencha a Data do pedido!');
    }
    atualizarStatusSalvamento('error', 'Informe a data');
    return false;
  }

  if (!horaPedido) {
    console.warn('[salvarPedido] Validação falhou: Hora do pedido vazia.');
    if (window.toastNotifier) {
      window.toastNotifier.warning('Por favor, preencha a Hora do pedido!');
    }
    atualizarStatusSalvamento('error', 'Informe a hora');
    return false;
  }

  if (!certificadoPedido) {
    console.warn('[salvarPedido] Validação falhou: Certificado não selecionado.');
    if (window.toastNotifier) {
      window.toastNotifier.warning('Por favor, selecione o Certificado!');
    }
    atualizarStatusSalvamento('error', 'Selecione o certificado');
    return false;
  }
  
  const jaExistia = Boolean(currentPedidoId);
  isSaving = true;
  atualizarStatusSalvamento('saving', 'Salvando...');
  if (pedidoSaveBtn) pedidoSaveBtn.disabled = true;
  
  try {
    const status = normalizarStatus(dados.status);
    console.log(`[salvarPedido] Status processado: "${status}" (original: "${dados.status}")`);

    // Se o status for finalizador, pede confirmação ANTES de salvar
    if (status === 'APROVADO' || status === 'CANCELADO') {
      console.log(`[salvarPedido] Exibindo modal de confirmação para status finalizador: ${status}`);
      const confirmado = await showCustomModal({
        title: 'Finalizar Pedido',
        message: `Deseja finalizar este pedido como ${status}? Isso apagará todos os documentos locais e a pasta do pedido permanentemente.`,
        confirmText: 'Sim, Finalizar',
        cancelText: 'Não, Voltar',
        hideCancel: false
      });

      if (!confirmado) {
        console.log('[salvarPedido] Salvamento cancelado pelo usuário no modal.');
        atualizarStatusSalvamento('idle', 'Pronto');
        return false;
      }
    }

    console.log('[salvarPedido] Enviando payload para electronAPI.salvarPedido:', dados);
    const resultado = await window.electronAPI.salvarPedido(dados);
    console.log('[salvarPedido] Resposta de electronAPI.salvarPedido:', resultado);
    
    if (resultado && resultado.success) {
      console.log('[salvarPedido] Pedido gravado com sucesso no backend:', dados.pedido, resultado);
      currentPedidoId = resultado.data?.id || currentPedidoId;
      const foiAtualizado = resultado.action === 'updated' || jaExistia;
      
      atualizarStatusSalvamento(foiAtualizado ? 'updated' : 'saved', foiAtualizado ? 'Sobrescrito' : 'Salvo');
      if (typeof window.atualizarContadoresStatus === 'function') {
        window.atualizarContadoresStatus();
      }
      if (typeof atualizarStatusPastaPedido === 'function') {
        atualizarStatusPastaPedido();
      }
      
      // Limpa o estado dirty da aba ativa
      const currentTab = pedidoTabs.find(t => t.id === activePedidoTabId);
      if (currentTab) {
        definirBaselinePedidoAtual(dados);
      }

      // Processar anexos pendentes
      if (typeof window.processPendingAttachments === 'function') {
        try {
          console.log('[salvarPedido] Processando anexos pendentes para pedido:', dados.pedido);
          await window.processPendingAttachments(dados.pedido);
        } catch (err) {
          console.error('[salvarPedido] Erro ao processar anexos pendentes após salvar pedido:', err);
        }
      }

      // Lógica de finalização (apagar pasta e zerar campos)
      if (status === 'APROVADO' || status === 'CANCELADO') {
        console.log(`[salvarPedido] Finalizando pedido (${status}): limpando pasta local e campos...`);
        const usuario = currentUser?.email;
        const pedidoNum = dados.pedido;

        if (usuario && pedidoNum) {
          await window.electronAPI.excluirPastaPedido({ usuario, pedido: pedidoNum });
          if (typeof window.__attachments?.clear === 'function') {
            window.__attachments.clear();
          }
          if (typeof atualizarStatusPastaPedido === 'function') {
            atualizarStatusPastaPedido();
          }
        }

        limparTodosCampos();

        const pedidoInput = document.getElementById('pedido-numero-input');
        if (pedidoInput) {
          pedidoInput.value = '';
          pedidoInput.focus();
        }
        atualizarTituloAbaPedidoAtiva('');
        currentPedidoId = null;
        definirBaselinePedidoAtual();
      }

      return true;
    } else {
      const erroMsg = resultado?.error || 'Erro desconhecido retornado pelo servidor.';
      console.error('[salvarPedido] Falha retornada pelo backend:', erroMsg, resultado);
      atualizarStatusSalvamento('error', 'Erro ao salvar', erroMsg);
      if (window.toastNotifier) {
        window.toastNotifier.error(`Erro ao salvar pedido: ${erroMsg}`);
      }
      return false;
    }
  } catch (error) {
    console.error('[salvarPedido] Exceção inesperada capturada:', error);
    const erroMsg = error?.message || String(error);
    atualizarStatusSalvamento('error', 'Erro ao salvar', erroMsg);
    if (window.toastNotifier) {
      window.toastNotifier.error(`Erro inesperado ao salvar: ${erroMsg}`);
    }
    return false;
  } finally {
    isSaving = false;
    if (pedidoSaveBtn) pedidoSaveBtn.disabled = false;
    console.log('[salvarPedido] Finalizado ciclo de salvamento.');
  }
}

window.salvarPedido = salvarPedido;

function marcarPedidoAlterado() {
  if (isLoadingPedido || isSaving) return;
  atualizarEstadoAlteracaoPedidoAtual();
}

// Marca alterações sem salvar automaticamente
function inicializarControleManualPedido() {
  const tab = document.getElementById('pedido');
  if (!tab) return;
  
  const campos = tab.querySelectorAll('input, select, textarea');
  
  campos.forEach(campo => {
    if (campo.id === 'attachments-input') return;
    campo.addEventListener('input', marcarPedidoAlterado);
    campo.addEventListener('change', marcarPedidoAlterado);
  });

  pedidoSaveBtn?.addEventListener('click', () => salvarPedido({ force: true }));
  pedidoClearBtn?.addEventListener('click', async () => {
    const confirmado = await showCustomModal({
      title: 'Apagar Tudo',
      message: 'Deseja limpar todos os campos deste pedido?',
      confirmText: 'Apagar Tudo',
      cancelText: 'Cancelar',
      hideCancel: false
    });

    if (!confirmado) return;

    const pedidoInput = document.getElementById('pedido-numero-input');
    if (pedidoInput) pedidoInput.value = '';
    pedidoBuscaRequestId += 1;
    limparTodosCampos();
    
    // Sincroniza com a aba ativa
    const currentTab = pedidoTabs.find(t => t.id === activePedidoTabId);
    if (currentTab) {
      currentTab.data = {};
      currentTab.baseline = clonarDadosPedido(obterSnapshotPedidoAtual());
      currentTab.dirty = false;
    }
    atualizarTituloAbaPedidoAtiva('');

    currentPedidoId = null;
    if (typeof atualizarStatusPastaPedido === 'function') {
      atualizarStatusPastaPedido();
    }
    ocultarAreaDadosPedido();
    atualizarStatusSalvamento('cleared', 'Campos limpos');
    if (typeof window.atualizarContadoresStatus === 'function') {
      window.atualizarContadoresStatus();
    }
  });
  
  atualizarStatusSalvamento('idle', 'Pronto');
  definirBaselinePedidoAtual();
  if (typeof window.atualizarContadoresStatus === 'function') {
    window.atualizarContadoresStatus();
  } else {
    // Se não estiver definida ainda, retry após 2s (quando todo o script tiver carregado)
    setTimeout(() => {
      if (typeof window.atualizarContadoresStatus === 'function') {
        window.atualizarContadoresStatus();
      }
    }, 2000);
  }
  console.log('[ok] Controle manual de salvamento inicializado em', campos.length, 'campos');
}

// Inicializa o controle manual quando a aba for carregada
setTimeout(inicializarControleManualPedido, 500);

// Função para limpar todos os campos do formulário
// Todos os campos preenchidos a partir de uma consulta de CNPJ. Nem todos
// existem na tela hoje (varios vieram do layout antigo), mas continuam na lista
// para que uma limpeza nunca deixe residuo de outra empresa para tras.
const CAMPOS_EMPRESA_IDS = [
  'empresa-situacao', 'empresa-data-situacao', 'empresa-motivo-situacao',
  'empresa-razao-social', 'empresa-nome-fantasia', 'empresa-porte', 'empresa-natureza-juridica',
  'empresa-data-abertura', 'empresa-capital-social', 'empresa-cep', 'empresa-municipio',
  'empresa-uf', 'empresa-bairro', 'empresa-logradouro', 'empresa-numero', 'empresa-complemento',
  'empresa-junta', 'empresa-telefone', 'empresa-email'
];

// Reflete a situacao cadastral na tela: aviso de empresa inapta + icone ao lado
// do campo. Roda tanto ao consultar o CNPJ quanto ao recarregar um pedido ja
// salvo — antes so a consulta acendia o aviso, e quem reabria um pedido de
// empresa inapta nao via nada.
function atualizarSituacaoEmpresa(situacaoTexto) {
  const situacao = String(situacaoTexto || '').toUpperCase();
  const warningDiv = document.getElementById('empresa-inapta-warning');
  const situacaoIcon = document.getElementById('situacao-icon');

  if (warningDiv) {
    warningDiv.style.display = situacao.includes('INAPTA') ? 'flex' : 'none';
  }

  if (!situacaoIcon) return;

  if (!situacao) {
    situacaoIcon.style.display = 'none';
    situacaoIcon.innerHTML = '';
    return;
  }

  situacaoIcon.style.display = 'flex';

  if (situacao.includes('ATIVA')) {
    situacaoIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M173.66,98.34a8,8,0,0,1,0,11.32l-56,56a8,8,0,0,1-11.32,0l-24-24a8,8,0,0,1,11.32-11.32L112,148.69l50.34-50.35A8,8,0,0,1,173.66,98.34ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"/></svg>`;
    situacaoIcon.style.color = '#34c759';
  } else if (situacao.includes('INAPTA') || situacao.includes('SUSPENSA') || situacao.includes('BAIXADA')) {
    situacaoIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M165.66,101.66,139.31,128l26.35,26.34a8,8,0,0,1-11.32,11.32L128,139.31l-26.34,26.35a8,8,0,0,1-11.32-11.32L116.69,128,90.34,101.66a8,8,0,0,1,11.32-11.32L128,116.69l26.34-26.35a8,8,0,0,1,11.32,11.32ZM232,128A104,104,0,1,1,128,24,104.11,104.11,0,0,1,232,128Zm-16,0a88,88,0,1,0-88,88A88.1,88.1,0,0,0,216,128Z"/></svg>`;
    situacaoIcon.style.color = '#ff3b30';
  } else {
    situacaoIcon.innerHTML = `<svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor"><path d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z"/></svg>`;
    situacaoIcon.style.color = '#ff9500';
  }
}
window.atualizarSituacaoEmpresa = atualizarSituacaoEmpresa;

// Zera os dados da empresa e os indicadores visuais que dependem deles.
// 'incluirCnpj' fica de fora quando o usuario esta editando o proprio campo.
function limparCamposEmpresa({ incluirCnpj = false } = {}) {
  const ids = incluirCnpj ? ['empresa-cnpj', ...CAMPOS_EMPRESA_IDS] : CAMPOS_EMPRESA_IDS;
  ids.forEach((id) => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });

  // Sem situação cadastral, some o aviso de inapta e o ícone do campo
  atualizarSituacaoEmpresa('');
}
window.limparCamposEmpresa = limparCamposEmpresa;

function limparTodosCampos() {
  console.log('[info] Limpando todos os campos...');
  ultimaBuscaPedido = '';
  ultimaBuscaMomento = 0;
  
  // Limpar campos do cabeçalho (exceto número do pedido)
  const dataInput = document.getElementById('pedido-data-input');
  const horaInput = document.getElementById('pedido-hora-input');
  const certificadoSelect = document.getElementById('pedido-certificado-select');
  const atendimentoSelect = document.getElementById('pedido-modalidade-select');
  const vendaSelect = document.getElementById('pedido-venda-select');
  const precoInput = document.getElementById('pedido-preco-input');
  const comissaoInput = document.getElementById('pedido-comissao-input');
  
  if (dataInput) dataInput.value = '';
  if (horaInput) horaInput.value = '';
  if (certificadoSelect) certificadoSelect.selectedIndex = 0;
  if (typeof window.atualizarDropdownCertificadoPedido === 'function') {
    window.atualizarDropdownCertificadoPedido();
  }
  // Mostra ou oculta containers conforme o certificado preenchido
  if (typeof window.atualizarVisibilidadeDadosPedidoPorCertificado === 'function') {
    window.atualizarVisibilidadeDadosPedidoPorCertificado();
  }
  if (atendimentoSelect) atendimentoSelect.selectedIndex = 0;
  if (vendaSelect) vendaSelect.selectedIndex = 0;
  if (precoInput) precoInput.value = '';
  if (comissaoInput) comissaoInput.value = '';

  // A visibilidade da seção Empresa já foi recalculada acima, junto com o
  // resto da área, por atualizarVisibilidadeDadosPedidoPorCertificado().

  // Limpar status - volta para DIGITAÇÃO
  const todosRadios = document.querySelectorAll('#pedido input[name="status"]');
  todosRadios.forEach(r => {
    r.checked = (normalizarStatus(r.value) === 'DIGITAÇÃO');
  });
  sincronizarVisualRadiosStatus();
  
  // Limpar todos os campos com ID
  const idsParaLimpar = [
    'pessoa-nome', 'pessoa-nascimento', 'pessoa-email', 'pessoa-telefone', 'pessoa-mae',
    'pessoa-cpf', 'pessoa-rg', 'pessoa-orgao-rg', 'pessoa-cnh', 'pessoa-cnh-seguranca',
    'pessoa-funcional', 'pessoa-pis', 'pedido-comentarios'
  ];
  
  idsParaLimpar.forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  
  // Limpar todos os inputs de dados empresa (inclusive o proprio CNPJ)
  limparCamposEmpresa({ incluirCnpj: true });

  console.log('[ok] Todos os campos foram limpos');
  
  // Limpar status da pasta
  const folderPedidoBtn = document.getElementById('folder-pedido-btn');
  if (folderPedidoBtn) {
    folderPedidoBtn.classList.remove('exists', 'missing');
    folderPedidoBtn.title = 'Gerenciar pasta do pedido';
  }
  const screenshotBtn = document.getElementById('pedido-screenshot-btn');
  if (screenshotBtn) {
    screenshotBtn.disabled = true;
    screenshotBtn.title = 'Crie a pasta do pedido para capturar um print';
  }

  const pastaInput = document.getElementById('config-pasta');
  const pastaClienteInput = document.getElementById('config-pasta-cliente');
  if (pastaInput) pastaInput.value = '';
  if (pastaClienteInput) pastaClienteInput.value = '';
  
  // Resetar estado do dropzone
  const dropzone = document.getElementById('dropzone');
  if (dropzone) {
    dropzone.classList.add('disabled');
  }
  if (typeof window.__attachments?.clear === 'function') {
    window.__attachments.clear();
  } else {
    attachments = [];
  }
  const attachmentsInput = document.getElementById('attachments-input');
  if (attachmentsInput) attachmentsInput.value = '';
  const previewList = document.getElementById('preview-list');
  if (previewList) {
    previewList.innerHTML = '';
    previewList.style.display = 'none';
  }
  const dropzonePlaceholder = document.getElementById('dropzone-placeholder');
  if (dropzonePlaceholder) dropzonePlaceholder.style.display = 'flex';
  
  if (typeof ocultarAreaDadosPedido === 'function') {
    ocultarAreaDadosPedido();
  }
}

// Regra unica de visibilidade da aba Dados Pedido:
// - A secao "Pedido" (numero/data/hora/certificado/preco/comissao) e a UNICA
//   sempre visivel — e onde se digita o numero pra trazer um pedido existente
//   ou se prepara um novo.
// - Todo o resto (Status, Titular, Empresa, Anexos, Comentarios) so aparece
//   depois que um certificado for selecionado.
// - Dentro disso, "Empresa" tem uma regra a mais: só aparece se o certificado
//   selecionado for um e-CNPJ (ver atualizarVisibilidadeSecaoEmpresaPorCertificado).
function ocultarAreaDadosPedido() {
  const scrollArea = document.getElementById('form-scrollable-area');
  if (scrollArea) scrollArea.style.setProperty('display', 'none', 'important');
}
window.ocultarAreaDadosPedido = ocultarAreaDadosPedido;

function temCertificadoPedidoSelecionado() {
  const select = document.getElementById('pedido-certificado-select');
  if (!select) return false;
  const option = select.options?.[select.selectedIndex];
  const valor = String(option?.value || select.value || '').trim();
  const texto = String(option?.textContent || '').trim();
  return Boolean(valor) && !/^selecione/i.test(texto);
}
window.temCertificadoPedidoSelecionado = temCertificadoPedidoSelecionado;

function mostrarAreaDadosPedido(force = false) {
  const scrollArea = document.getElementById('form-scrollable-area');
  if (!force && !temCertificadoPedidoSelecionado()) {
    ocultarAreaDadosPedido();
    return;
  }
  if (scrollArea) scrollArea.style.setProperty('display', 'flex', 'important');
}
window.mostrarAreaDadosPedido = mostrarAreaDadosPedido;

function atualizarVisibilidadeDadosPedidoPorCertificado() {
  if (!temCertificadoPedidoSelecionado()) {
    ocultarAreaDadosPedido();
    return;
  }

  mostrarAreaDadosPedido(true);

  // Dentro da area ja visivel, Empresa segue a propria regra (so e-CNPJ).
  const select = document.getElementById('pedido-certificado-select');
  const opt = select?.options?.[select.selectedIndex];
  const certText = opt?.textContent || select?.value || '';
  if (typeof window.atualizarVisibilidadeSecaoEmpresaPorCertificado === 'function') {
    window.atualizarVisibilidadeSecaoEmpresaPorCertificado(certText);
  }
}
window.atualizarVisibilidadeDadosPedidoPorCertificado = atualizarVisibilidadeDadosPedidoPorCertificado;

function normalizarDataInput(valor) {
  if (!valor) return '';
  const data = String(valor).split('T')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(data) ? data : '';
}

function definirValorCampo(elemento, valor, evento = 'input') {
  if (!elemento) return false;

  elemento.value = valor === null || valor === undefined ? '' : String(valor);
  elemento.dispatchEvent(new Event(evento, { bubbles: true }));
  return true;
}

function definirValorSelect(select, valor) {
  if (!select) return false;

  if (valor === null || valor === undefined || valor === '') {
    select.value = '';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  const valorTexto = String(valor);
  const valorNormalizado = valorTexto.toLowerCase();
  const option = Array.from(select.options).find(opt =>
    opt.value === valorTexto ||
    opt.value.toLowerCase() === valorNormalizado ||
    opt.textContent.trim() === valorTexto ||
    opt.textContent.trim().toLowerCase() === valorNormalizado
  );

  select.value = option ? option.value : valorTexto;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}

function definirValorCampoPorId(id, valor, transformador) {
  const elemento = document.getElementById(id);
  const valorFinal = typeof transformador === 'function' ? transformador(valor) : valor;
  return definirValorCampo(elemento, valorFinal);
}

function escreverValorCampo(elemento, valor) {
  if (!elemento) return false;
  elemento.value = valor === null || valor === undefined ? '' : String(valor);
  return true;
}

function escreverValorPorId(id, valor) {
  return escreverValorCampo(document.getElementById(id), valor);
}

function garantirOpcaoVaziaSelect(select, texto = 'Selecione') {
  if (!select) return false;

  const existeOpcaoVazia = Array.from(select.options).some((opt) => opt.value === '');
  if (existeOpcaoVazia) return true;

  const option = document.createElement('option');
  option.value = '';
  option.textContent = texto;
  select.insertBefore(option, select.firstChild);
  return true;
}

function escreverValorSelect(select, valor) {
  if (!select) return false;

  const valorTexto = valor === null || valor === undefined ? '' : String(valor);
  const valorNormalizado = valorTexto.toLowerCase();

  if (valorTexto === '') {
    select.selectedIndex = select.options.length > 0 ? 0 : -1;
    return true;
  }

  const option = Array.from(select.options).find(opt =>
    opt.value === valorTexto ||
    opt.value.toLowerCase() === valorNormalizado ||
    opt.textContent.trim() === valorTexto ||
    opt.textContent.trim().toLowerCase() === valorNormalizado
  );

  if (option) {
    select.value = option.value;
  } else if (select.options.length > 0) {
    select.selectedIndex = 0;
  }

  return true;
}

function preencherPedidoNaTela(pedido, numeroPedido, pedidoInput) {
  if (!pedido) return;
  currentPedidoId = pedido.id || null;

  console.log('[debug] Preenchendo pedido na tela:', pedido.pedido || numeroPedido, pedido);

  if (pedidoInput) {
    pedidoInput.style.borderColor = '#34c759';
    setTimeout(() => {
      pedidoInput.style.borderColor = '';
    }, 800);
  }

  escreverValorPorId('pedido-numero-input', pedido.pedido || numeroPedido);
  atualizarTituloAbaPedidoAtiva(pedido.pedido || numeroPedido);

  const campos = {
    'pessoa-nome': pedido.nome,
    'pessoa-nascimento': normalizarDataInput(pedido.nascimento),
    'pessoa-email': pedido.email,
    'pessoa-telefone': pedido.telefone,
    'pessoa-mae': pedido.mae,
    'pessoa-cpf': pedido.cpf ? maskCPF(pedido.cpf) : '',
    'pessoa-rg': pedido.rg,
    'pessoa-orgao-rg': pedido.orgao_rg,
    'pessoa-cnh': pedido.cnh,
    'pessoa-cnh-seguranca': pedido.codigo_de_seg_cnh,
    'pessoa-funcional': pedido.certificado,
    'pessoa-pis': pedido.digito_cpf,
    'empresa-cnpj': pedido.cnpj ? maskCNPJ(pedido.cnpj) : '',
    'empresa-situacao': pedido.situacao_cadastral,
    'empresa-data-situacao': normalizarDataInput(pedido.data_situacao_cadastral),
    'empresa-motivo-situacao': pedido.motivo_situacao_cadastral,
    'empresa-razao-social': pedido.razao_social,
    'empresa-nome-fantasia': pedido.nome_fantasia,
    'empresa-porte': pedido.porte,
    'empresa-natureza-juridica': pedido.natureza_juridica,
    'empresa-data-abertura': normalizarDataInput(pedido.data_abertura),
    'empresa-capital-social': pedido.capital_social,
    'empresa-cep': pedido.cep,
    'empresa-municipio': pedido.municipio,
    'empresa-uf': pedido.uf,
    'empresa-bairro': pedido.bairro,
    'empresa-logradouro': pedido.logradouro,
    'empresa-numero': pedido.numero,
    'empresa-complemento': pedido.complemento,
    'empresa-junta': pedido.junta,
    'empresa-telefone': pedido.telefone_empresa,
    'empresa-email': pedido.email_empresa,
    'pedido-comentarios': pedido.comentarios
  };

  Object.entries(campos).forEach(([id, valor]) => escreverValorPorId(id, valor));

  // A situacao cadastral vem salva junto do pedido, entao o aviso de empresa
  // inapta e o icone sao reconstruidos aqui — sem depender de uma nova consulta
  // ao CNPJ, que pode nem acontecer ao reabrir o pedido.
  atualizarSituacaoEmpresa(pedido.situacao_cadastral);

  escreverValorCampo(document.getElementById('pedido-data-input'), normalizarDataInput(pedido.data));
  escreverValorCampo(document.getElementById('pedido-hora-input'), pedido.hora || '');
  const selectCertificado = document.getElementById('pedido-certificado-select');
  garantirOpcaoVaziaSelect(selectCertificado, 'Selecione um certificado');
  escreverValorSelect(selectCertificado, pedido.versao || '');
  if (typeof window.atualizarDropdownCertificadoPedido === 'function') {
    window.atualizarDropdownCertificadoPedido();
  }
  // Mostra/oculta a area toda e, dentro dela, a secao Empresa conforme o
  // certificado preenchido (regra unica, ver atualizarVisibilidadeDadosPedidoPorCertificado).
  if (typeof window.atualizarVisibilidadeDadosPedidoPorCertificado === 'function') {
    window.atualizarVisibilidadeDadosPedidoPorCertificado();
  }
  escreverValorSelect(document.getElementById('pedido-modalidade-select'), pedido.modalidade || '');
  escreverValorSelect(document.getElementById('pedido-venda-select'), ehVendaSim(pedido.venda) ? 'sim' : 'nao');
  const precoRaw = pedido.preco_certificado ?? '';
  const comissaoRaw = pedido.comissao ?? '';
  escreverValorCampo(
    document.getElementById('pedido-preco-input'),
    precoRaw === '' || precoRaw === null || precoRaw === undefined
      ? ''
      : ComissaoCalculator.formatNumberBR(ComissaoCalculator.toNumber(precoRaw))
  );
  escreverValorCampo(
    document.getElementById('pedido-comissao-input'),
    comissaoRaw === '' || comissaoRaw === null || comissaoRaw === undefined
      ? ''
      : ComissaoCalculator.formatNumberBR(ComissaoCalculator.toNumber(comissaoRaw))
  );
  
  // Inicializa o cálculo e o botão de info
  calcularComissao();

  const statusValue = normalizarStatus(pedido.status || 'DIGITAÇÃO');
  const todosRadios = document.querySelectorAll('#pedido input[name="status"]');
  let radioMarcado = false;
  todosRadios.forEach(r => {
    const corresponde = (normalizarStatus(r.value) === statusValue);
    r.checked = corresponde;
    if (corresponde) radioMarcado = true;
  });
  if (!radioMarcado) {
    const defaultRadio = document.querySelector('#pedido input[name="status"][value="DIGITAÇÃO"]') || todosRadios[0];
    if (defaultRadio) defaultRadio.checked = true;
  }
  sincronizarVisualRadiosStatus();

  try {
    const pastaInfo = pedido.pasta_info;
    if (pastaInfo) {
      atualizarVisualPastaUsuario(pastaInfo.rootExists, pastaInfo.rootPath);
      atualizarVisualPastaCliente(pastaInfo.clientPath);
      atualizarVisualPastaPedido(pastaInfo.exists);
    } else {
      if (pedido.diretorio) atualizarVisualPastaUsuario(true, pedido.diretorio);
      atualizarVisualPastaCliente(pedido.pasta || '');
      atualizarVisualPastaPedido(Boolean(pedido.pasta));
    }
  } catch (error) {
    console.error('[erro] Erro ao atualizar visual da pasta:', error);
  }

  
  console.log('[ok] Pedido preenchido na tela:', pedido.pedido || numeroPedido);
  if (typeof window.atualizarContadoresStatus === 'function') {
    window.atualizarContadoresStatus();
  }
}

let pedidoBuscaRequestId = 0;
let ultimaBuscaPedido = '';
let ultimaBuscaMomento = 0;

function normalizarNumeroPedidoBusca(numeroPedido) {
  return String(numeroPedido || '').trim();
}

function pedidoBuscaAindaAtual(numeroPedido, requestId) {
  const pedidoAtual = normalizarNumeroPedidoBusca(document.getElementById('pedido-numero-input')?.value);
  return requestId === pedidoBuscaRequestId && pedidoAtual === numeroPedido;
}

async function buscarEPreencherPedido(numeroPedido) {
  const numeroPedidoNormalizado = normalizarNumeroPedidoBusca(numeroPedido);
  if (!numeroPedidoNormalizado) return;
  
  ultimaBuscaPedido = numeroPedidoNormalizado;
  ultimaBuscaMomento = Date.now();
  
  const pedidoInput = document.getElementById('pedido-numero-input');
  const requestId = ++pedidoBuscaRequestId;
  
  // Marca que está carregando para evitar marcar alterações durante preenchimento
  isLoadingPedido = true;
  
  // Feedback visual - loading
  if (pedidoInput) {
    pedidoInput.style.borderColor = '#007aff';
  }
  
  let resultado = null;

  try {
    resultado = await window.electronAPI.buscarPedido(numeroPedidoNormalizado);

    if (!pedidoBuscaAindaAtual(numeroPedidoNormalizado, requestId)) {
      return;
    }

    if (!resultado?.success) {
      console.error('[erro] Erro retornado ao buscar pedido:', resultado?.error);
      atualizarStatusSalvamento('error', 'Erro ao buscar');
      return;
    }

    if (resultado.data) {
      preencherPedidoNaTela(resultado.data, numeroPedidoNormalizado, pedidoInput);
      definirBaselinePedidoAtual();
    } else {
      // Pedido não encontrado - preparar para novo cadastro do zero
      if (pedidoInput) {
        pedidoInput.style.borderColor = '#ff9500';
        setTimeout(() => {
          pedidoInput.style.borderColor = '';
        }, 1200);
      }
      
      console.log('[aviso] Pedido não encontrado. Limpando campos para novo cadastro:', numeroPedidoNormalizado);
      
      // Limpar todos os dados e deixar os campos vazios
      limparTodosCampos();
      
      // Restaurar o número do pedido que o usuário digitou
      const pedidoNumeroInput = document.getElementById('pedido-numero-input');
      if (pedidoNumeroInput) {
        pedidoNumeroInput.value = numeroPedidoNormalizado;
      }
      
      currentPedidoId = null;
      definirBaselinePedidoAtual();
      atualizarStatusSalvamento('idle', 'Novo pedido');
      
      // Atualizar ícone da pasta para vermelho (missing) porque é um pedido novo sem pasta
      atualizarVisualPastaPedido(false);
      
      // Pedido novo: so mostra os containers apos selecionar certificado.
      ocultarAreaDadosPedido();
    }
  } catch (error) {
    if (!pedidoBuscaAindaAtual(numeroPedidoNormalizado, requestId)) {
      return;
    }

    // Feedback visual - erro
    if (pedidoInput) {
      pedidoInput.style.borderColor = '#ff3b30';
      setTimeout(() => {
        pedidoInput.style.borderColor = '';
      }, 1200);
    }
    console.error('[erro] Erro ao buscar pedido:', error);
  } finally {
    // Marca que terminou de carregar
    if (requestId === pedidoBuscaRequestId) {
      isLoadingPedido = false;
    }

    if (!pedidoBuscaAindaAtual(numeroPedidoNormalizado, requestId)) {
      return;
    }

    // Atualiza o status da pasta do pedido
    if (typeof atualizarStatusPastaPedido === 'function' && !resultado?.data?.pasta_info) {
      await atualizarStatusPastaPedido();
    }

    // Carregar anexos da pasta física
    const numeroPedido = document.getElementById('pedido-numero-input')?.value?.trim();
    if (numeroPedido && typeof carregarAnexosDaPasta === 'function') {
      carregarAnexosDaPasta(numeroPedido);
    }
  }
}

// Função para limpar campos e preparar para novo pedido
function limparCamposParaNovoPedido(numeroPedido) {
  // Mantém o número do pedido e reseta o ID
  currentPedidoId = null;
  
  // Limpar campos do cabeçalho (exceto pedido)
  const dataInput = document.getElementById('pedido-data-input');
  const horaInput = document.getElementById('pedido-hora-input');
  
  // Define data e hora atuais
  if (dataInput) {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const dia = String(hoje.getDate()).padStart(2, '0');
    dataInput.value = `${ano}-${mes}-${dia}`;
  }
  
  if (horaInput) {
    const agora = new Date();
    const hora = String(agora.getHours()).padStart(2, '0');
    const minuto = String(agora.getMinutes()).padStart(2, '0');
    horaInput.value = `${hora}:${minuto}`;
  }
  
  // Reset status para DIGITAÇÃO
  const digitacaoRadio = document.querySelector('input[name="status"][value="DIGITAÇÃO"]') ||
                         document.querySelector('input[name="status"][value="digitacao"]');
  if (digitacaoRadio) {
    digitacaoRadio.checked = true;
  }
  
  // Não limpar os outros campos para permitir preenchimento rápido
  // Inicializa o cálculo e o botão de info para novos pedidos
  calcularComissao();

  console.log('[debug] Campos preparados para novo pedido:', numeroPedido);
}

// Buscar pedido ao sair do campo PEDIDO ou pressionar Enter
const pedidoInput = document.getElementById('pedido-numero-input');
if (pedidoInput) {
  async function executarBuscaPedidoAtual(force = false) {
    const numeroPedido = normalizarNumeroPedidoBusca(pedidoInput.value);
    if (!numeroPedido) {
      pedidoBuscaRequestId += 1;
      currentPedidoId = null;
      ultimaBuscaPedido = '';
      limparTodosCampos();
      definirBaselinePedidoAtual();
      atualizarTituloAbaPedidoAtiva('');
      atualizarStatusSalvamento('idle', 'Pronto');
      return;
    }

    if (!force && numeroPedido === ultimaBuscaPedido) {
      return;
    }

    ultimaBuscaPedido = numeroPedido;
    ultimaBuscaMomento = Date.now();
    console.log('[executarBuscaPedidoAtual] Disparando busca para pedido:', numeroPedido);
    await buscarEPreencherPedido(numeroPedido);
  }

  // Ao perder o foco (blur) - busca apenas se o número digitado for diferente do atual
  pedidoInput.addEventListener('blur', async () => {
    await executarBuscaPedidoAtual(false);
  });
  
  // Ao pressionar Enter - força a busca mesmo se o número for o mesmo
  pedidoInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await executarBuscaPedidoAtual(true);
      pedidoInput.blur();
    }
  });
}

// Carregar configurações
let isCarregandoConfiguracoes = false;
let configuracoesAlteradas = false;
const TRANSLUCIDEZ_JANELA_PADRAO = 100;

function normalizarTranslucidezJanela(valor) {
  const numero = Number(valor);
  if (!Number.isFinite(numero)) return TRANSLUCIDEZ_JANELA_PADRAO;
  return Math.min(100, Math.max(10, Math.round(numero)));
}

function obterChaveTranslucidezJanela(usuario = currentUser?.email) {
  return `companion-window-translucency:${usuario || 'local'}`;
}

function lerTranslucidezJanela(usuario = currentUser?.email) {
  return normalizarTranslucidezJanela(
    localStorage.getItem(obterChaveTranslucidezJanela(usuario)) ?? TRANSLUCIDEZ_JANELA_PADRAO
  );
}

function salvarTranslucidezJanela(percentual, usuario = currentUser?.email) {
  localStorage.setItem(
    obterChaveTranslucidezJanela(usuario),
    String(normalizarTranslucidezJanela(percentual))
  );
}

function atualizarControlesTranslucidezJanela(percentual) {
  const valor = normalizarTranslucidezJanela(percentual);
  const range = document.getElementById('config-window-translucency');
  const number = document.getElementById('config-window-translucency-number');
  const label = document.getElementById('config-window-translucency-label');

  if (range) {
    range.value = String(valor);
    range.style.setProperty('--translucency-fill', `${((valor - 10) / 90) * 100}%`);
  }
  if (number) number.value = String(valor);
  if (label) label.textContent = `${valor}%`;
}

function aplicarTranslucidezJanela(percentual) {
  const valor = normalizarTranslucidezJanela(percentual);
  atualizarControlesTranslucidezJanela(valor);
  if (window.electronAPI?.setWindowIdleOpacity) {
    window.electronAPI.setWindowIdleOpacity(valor);
  }
}

function inicializarTranslucidezJanela(usuario = currentUser?.email) {
  const range = document.getElementById('config-window-translucency');
  const number = document.getElementById('config-window-translucency-number');
  if (!range || !number) return;

  aplicarTranslucidezJanela(lerTranslucidezJanela(usuario));

  if (range.dataset.boundTranslucency === '1') return;
  range.dataset.boundTranslucency = '1';
  number.dataset.boundTranslucency = '1';

  const sincronizar = (event) => {
    aplicarTranslucidezJanela(event.target.value);
  };

  range.addEventListener('input', sincronizar);
  number.addEventListener('input', sincronizar);
  number.addEventListener('blur', () => {
    aplicarTranslucidezJanela(number.value);
  });
}

function garantirBarraInferiorConfiguracoes() {
  const saveSection = document.querySelector('#configuracoes > .section:last-child');
  const saveBtn = document.getElementById('salvar-config-btn');
  if (!saveSection || !saveBtn) return;

  saveSection.classList.add('config-bottom-bar');
  saveBtn.classList.add('config-save-btn');

  let statusEl = document.getElementById('config-save-status');
  if (!statusEl) {
    statusEl = document.createElement('div');
    statusEl.id = 'config-save-status';
    statusEl.className = 'config-save-status idle';
    statusEl.innerHTML = `
      <svg class="status-icon" width="16" height="16" viewBox="0 0 256 256" fill="currentColor"><path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/></svg>
      <span class="status-text">Sem alteracoes</span>
    `;
    saveSection.insertBefore(statusEl, saveSection.firstChild);
  }
}

function atualizarStatusConfiguracoes(estado = 'idle', mensagem = 'Sem alteracoes') {
  garantirBarraInferiorConfiguracoes();

  const statusEl = document.getElementById('config-save-status');
  if (!statusEl) return;

  const iconEl = statusEl.querySelector('.status-icon');
  const textEl = statusEl.querySelector('.status-text');

  const icons = {
    idle: '<path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/>',
    dirty: '<path d="M227.31,73.37,182.63,28.69a16,16,0,0,0-22.63,0L36.69,152A15.86,15.86,0,0,0,32,163.31V208a16,16,0,0,0,16,16H92.69A15.86,15.86,0,0,0,104,219.31L227.31,96a16,16,0,0,0,0-22.63ZM92.69,208H48V163.31l88-88L180.69,120ZM192,108.69,147.31,64l24-24L216,84.69Z"/>',
    saving: '<path d="M232,128a104,104,0,0,1-208,0c0-41,23.81-78.36,60.66-95.27a8,8,0,0,1,6.68,14.54C60.15,61.59,40,93.27,40,128a88,88,0,0,0,176,0c0-34.73-20.15-66.41-51.34-80.73a8,8,0,0,1,6.68-14.54C208.19,49.64,232,87,232,128Z"/>',
    saved: '<path d="M229.66,77.66l-128,128a8,8,0,0,1-11.32,0l-56-56a8,8,0,0,1,11.32-11.32L96,188.69,218.34,66.34a8,8,0,0,1,11.32,11.32Z"/>',
    error: '<path d="M128,24A104,104,0,1,0,232,128,104.11,104.11,0,0,0,128,24Zm0,192a88,88,0,1,1,88-88A88.1,88.1,0,0,1,128,216Zm-8-80V80a8,8,0,0,1,16,0v56a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,172Z"/>'
  };

  statusEl.classList.remove('idle', 'dirty', 'saving', 'saved', 'error');
  statusEl.classList.add(estado);
  statusEl.title = mensagem;

  if (iconEl) iconEl.innerHTML = icons[estado] || icons.idle;
  if (textEl) textEl.textContent = mensagem;
}

function marcarConfiguracoesAlteradas() {
  if (isCarregandoConfiguracoes) return;
  configuracoesAlteradas = true;
  atualizarStatusConfiguracoes('dirty', 'Alteracoes nao salvas');
}

function inicializarMonitoramentoConfiguracoes() {
  const container = document.getElementById('configuracoes');
  if (!container || container.dataset.monitorConfigInit === '1') return;
  container.dataset.monitorConfigInit = '1';

  const camposIgnorados = new Set([
    'salvar-config-btn',
    'config-cert-add-btn'
  ]);

  const handlerAlteracao = (event) => {
    const el = event.target;
    if (!el || !el.id) return;
    if (camposIgnorados.has(el.id)) return;
    if (el.closest('.config-bottom-bar')) return;
    if (el.readOnly || el.disabled) return;
    marcarConfiguracoesAlteradas();
  };

  container.addEventListener('input', handlerAlteracao);
  container.addEventListener('change', handlerAlteracao);
}

garantirBarraInferiorConfiguracoes();
inicializarMonitoramentoConfiguracoes();
inicializarTranslucidezJanela();
atualizarStatusConfiguracoes('idle', 'Sem alteracoes');

function obterChaveConsoleConfiguracoes(usuario = currentUser?.email) {
  return `companion-console-enabled:${usuario || 'local'}`;
}

function lerConsoleHabilitado(usuario = currentUser?.email) {
  return localStorage.getItem(obterChaveConsoleConfiguracoes(usuario)) === '1';
}

function salvarConsoleHabilitado(habilitado, usuario = currentUser?.email) {
  localStorage.setItem(obterChaveConsoleConfiguracoes(usuario), habilitado ? '1' : '0');
}

async function aplicarConsoleConfiguracoes(habilitado) {
  try {
    await window.electronAPI?.setConsoleEnabled?.(Boolean(habilitado));
  } catch (error) {
    console.error('Erro ao alternar console:', error);
  }
}

function sincronizarSwitchConsoleConfiguracoes(usuario = currentUser?.email) {
  const checkbox = document.getElementById('config-console-enabled');
  if (!checkbox) return;

  checkbox.checked = lerConsoleHabilitado(usuario);
  aplicarConsoleConfiguracoes(checkbox.checked);

  if (checkbox.dataset.bound === '1') return;
  checkbox.dataset.bound = '1';
  checkbox.addEventListener('change', () => {
    salvarConsoleHabilitado(checkbox.checked, currentUser?.email);
    aplicarConsoleConfiguracoes(checkbox.checked);
  });
}

async function carregarConfiguracoes() {
  try {
    garantirBarraInferiorConfiguracoes();
    inicializarMonitoramentoConfiguracoes();
    inicializarTranslucidezJanela();
    isCarregandoConfiguracoes = true;

    if (!currentUser) {
      await carregarUsuarioLogado();
    }

    const usuario = currentUser?.email;

    if (!usuario) {
      console.warn('Não foi possível carregar configurações: usuário logado não encontrado');
      atualizarStatusConfiguracoes('idle', 'Sem alteracoes');
      return;
    }

    const resultado = await window.electronAPI.buscarConfiguracoes(usuario);
    
    if (!resultado.success) {
      console.error('Erro ao carregar configurações:', resultado.error);
      atualizarStatusConfiguracoes('idle', 'Sem alteracoes');
      return;
    }

    const config = resultado.data || {};
    const setField = (id, value) => {
      const field = document.getElementById(id);
      if (field && value !== undefined && value !== null) {
        field.value = value;
      }
    };

    const usuarioConfigurado = config.usuario || usuario;

    setField('config-login-email', config.usuario || usuario || '');
    setField('config-login-nome', config.nome_usuario || '');
    setField('config-login-privilegio', config.privilegio || '');

    setField('config-agente', config.agente || '');
    setField('config-cod-rev', config.cod_rev || '');
    setField('config-email', config.email || '');
    setField('config-senha-email', config.senha_email || '');
    setField('config-telefone-agente', config.telefone_agente || '');
    setField('config-pasta', config.pasta_principal || '');
    setField('config-modo', config.modo_pasta || 'PEDIDO');
    setField('config-sac', config.sac_cliente || '11 4003 5598 ou 0800 838 051');
    setField('config-tela-cheia', config.tela_cheia || '4003 5596');
    setField('config-porc-validacao', config.porcentagem_validacao ?? 15);
    setField('config-porc-venda', config.porcentagem_venda ?? 10);
    setField('config-desc-total', config.desconto_total ?? 20);
    setField('config-imp-renda', config.imposto_validacao ?? 15);
    setField('config-desc-validacao', config.desconto_validacao ?? 2.75);
    inicializarTranslucidezJanela(usuarioConfigurado);
    sincronizarSwitchConsoleConfiguracoes(usuarioConfigurado);
    await atualizarStatusPastaUsuario();
    configuracoesAlteradas = false;
    atualizarStatusConfiguracoes('idle', 'Sem alteracoes');

    console.log('Configurações carregadas com sucesso!');
  } catch (error) {
    console.error('Erro ao carregar configurações:', error);
    atualizarStatusConfiguracoes('idle', 'Sem alteracoes');
  } finally {
    isCarregandoConfiguracoes = false;
  }
}

// Salvar configurações
const salvarConfigBtn = document.getElementById('salvar-config-btn');
if (salvarConfigBtn) {
  salvarConfigBtn.addEventListener('click', async () => {
    atualizarStatusConfiguracoes('saving', 'Salvando...');

    if (!currentUser) {
      await carregarUsuarioLogado();
    }

    const usuario = currentUser?.email;

    if (!usuario) {
      atualizarStatusConfiguracoes('idle', 'Sem alteracoes');
      showCustomModal({
        title: 'Erro',
        message: 'Usuário logado não encontrado.',
        confirmText: 'Entendido',
        hideCancel: true
      });
      return;
    }

    const config = {
      usuario: usuario,
      agente: document.getElementById('config-agente')?.value,
      cod_rev: document.getElementById('config-cod-rev')?.value,
      email: document.getElementById('config-email')?.value,
      senha_email: document.getElementById('config-senha-email')?.value,
      telefone_agente: document.getElementById('config-telefone-agente')?.value,
      pasta_principal: document.getElementById('config-pasta')?.value,
      modo_pasta: document.getElementById('config-modo')?.value,
      sac_cliente: document.getElementById('config-sac')?.value,
      tela_cheia: document.getElementById('config-tela-cheia')?.value,
      porcentagem_validacao: parseFloat(document.getElementById('config-porc-validacao')?.value) || 0,
      porcentagem_venda: parseFloat(document.getElementById('config-porc-venda')?.value) || 0,
      desconto_total: parseFloat(document.getElementById('config-desc-total')?.value) || 0,
      imposto_validacao: parseFloat(document.getElementById('config-imp-renda')?.value) || 0,
      desconto_validacao: parseFloat(document.getElementById('config-desc-validacao')?.value) || 0
    };
    salvarConsoleHabilitado(Boolean(document.getElementById('config-console-enabled')?.checked), usuario);
    salvarTranslucidezJanela(document.getElementById('config-window-translucency')?.value, usuario);
    aplicarTranslucidezJanela(document.getElementById('config-window-translucency')?.value);
    
    try {
      const resultado = await window.electronAPI.salvarConfiguracoes(config);
      
      if (resultado.success) {
        currentUser = {
          ...(currentUser || {}),
          email: resultado.data?.usuario || usuario
        };
        localStorage.setItem('user', JSON.stringify(currentUser));
        if (window.toastNotifier) window.toastNotifier.success('Configurações salvas com sucesso.');
        configuracoesAlteradas = false;
        atualizarStatusConfiguracoes('saved', 'Configuracoes salvas');
        console.log('Configurações salvas:', resultado.data);
      } else {
        atualizarStatusConfiguracoes('error', 'Erro ao salvar configuracoes');
        if (window.toastNotifier) window.toastNotifier.error('Erro ao salvar configurações: ' + resultado.error);
      }
    } catch (error) {
      console.error('Erro ao salvar configurações:', error);
      atualizarStatusConfiguracoes('error', 'Erro ao salvar configuracoes');
      if (window.toastNotifier) window.toastNotifier.error('Erro ao salvar configurações.');
    }
  });
}

// Sair da conta
const logoutBtn = document.getElementById('logout-btn');
if (logoutBtn) {
  logoutBtn.addEventListener('click', async () => {
    const confirmado = await showCustomModal({
      title: 'Sair',
      message: 'Deseja sair da sua conta?',
      confirmText: 'Sim, sair',
      cancelText: 'Cancelar',
      hideCancel: false
    });

    if (!confirmado) return;

    try {
      await window.electronAPI.authLogout();
    } catch (error) {
      console.error('Erro ao sair:', error);
    }
  });
}

// Carregar configurações ao abrir a aba
const configTab = document.querySelector('[data-tab="configuracoes"]');
let configTabJaInicializada = false;
if (configTab) {
  configTab.addEventListener('click', () => {
    if (!configTabJaInicializada) {
      carregarConfiguracoes();
      if (typeof window.carregarCertificados === 'function') {
        window.carregarCertificados();
      }
      configTabJaInicializada = true;
    }
    atualizarStatusPastaUsuario();
  });
}

// =============================================
// CONSULTA TAB - Tabela e Linha do Tempo
// =============================================

// Dados e configurações da linha do tempo
let pedidosData = [];
// Registros completos (todas as colunas do Supabase) por trás do pedidosData
// exibido na tabela — usado para a exportação em Excel, que precisa de campos
// (email, CPF, CNPJ, etc.) que a tabela não mostra.
let pedidosDataCompleto = [];
let timelineRange = { inicio: 6, fim: 24 }; // Padrão 06:00 - 00:00
let currentDateRange = { dataDe: null, dataAte: null }; // Range de datas atual
let certificadosLookup = new Map();
let abrindoPedidoDaConsulta = false;

function normalizarTextoRelatorio(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function obterTipoCertificado(nomeVersao) {
  const chave = normalizarTextoRelatorio(nomeVersao);
  if (!chave) return 'OUTROS';

  // 1. Tentar buscar no cache global dos certificados cadastrados
  if (window.certificadosCacheGlobal && Array.isArray(window.certificadosCacheGlobal)) {
    const cert = window.certificadosCacheGlobal.find(c => normalizarTextoRelatorio(c.nome) === chave);
    if (cert && cert.tipo) {
      const t = String(cert.tipo).trim().toUpperCase();
      if (t === 'CPF' || t === 'CNPJ') {
        return t;
      }
    }
  }

  // 2. Opção Legado: diferenciação por substring para pedidos antigos ou sem campo definido
  if (chave.includes('CNPJ')) {
    return 'CNPJ';
  } else if (chave.includes('CPF')) {
    return 'CPF';
  }

  return 'OUTROS';
}

function obterPrecoPorVersao(versao) {
  const chave = normalizarTextoRelatorio(versao);
  if (!chave) return 0;

  if (certificadosLookup.has(chave)) {
    return certificadosLookup.get(chave);
  }

  for (const [nome, valor] of certificadosLookup.entries()) {
    if (chave.includes(nome) || nome.includes(chave)) {
      return valor;
    }
  }

  return 0;
}

function calcularComissaoPorPrecoCertificado(precoCertificado) {
  const calculadora = ComissaoCalculator.fromDOM();
  return calculadora.calcular(precoCertificado).valorFinal;
}

function obterPrecoCertificado(pedido) {
  if (!pedido) return 0;
  const precoCertificado = parseNumeroMonetario(
    pedido.preco_certificado ?? pedido.precoCertificado ?? pedido.preco_cert ?? pedido.valor_certificado ?? pedido['PRECO CERTIFICADO'] ?? 0
  );
  if (precoCertificado > 0) return precoCertificado;

  const precoBasePedido = parseNumeroMonetario(pedido.preco ?? pedido.valor ?? pedido.preco_total ?? pedido['PRECO'] ?? 0);
  const precoFallback = precoBasePedido > 0
    ? precoBasePedido
    : obterPrecoPorVersao(pedido.versao || pedido.certificado || '');
  return precoFallback;
}

function obterComissaoPedido(pedido) {
  const comissaoDireta = parseNumeroMonetario(
    pedido?.comissao ?? pedido?.valor_comissao ?? pedido?.comissao_validacao ?? pedido?.['COMISSAO'] ?? 0
  );
  if (comissaoDireta > 0) return comissaoDireta;

  const preco = obterPrecoCertificado(pedido);
  if (preco > 0) {
    return calcularComissaoPorPrecoCertificado(preco);
  }

  return 0;
}

function parseNumeroMonetario(valor) {
  return ComissaoCalculator.toNumber(valor);
}

function formatarMoedaBR(valor) {
  return ComissaoCalculator.formatNumberBR(valor);
}

function ehVendaSim(venda) {
  const valor = String(venda || '').trim().toLowerCase();
  return valor === 'sim' || valor === 'true' || valor === '1';
}

function escaparHtml(texto) {
  return String(texto || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function atualizarRelatorioConsulta(dados) {
  const relatorioEl = document.getElementById('consulta-relatorio');
  if (!relatorioEl) return;

  const pedidos = Array.isArray(dados) ? dados : [];
  const descontoPercent = parseNumeroMonetario(document.getElementById('config-desc-total')?.value ?? '20');
  const porcVenda = parseNumeroMonetario(document.getElementById('config-porc-venda')?.value ?? '10');

  let valorCnpj = 0;
  let valorCpf = 0;
  let qtdCnpj = 0;
  let qtdCpf = 0;
  let qtdVendas = 0;
  let valorVenda = 0;

  pedidos.forEach((p) => {
    if (String(p.status).toLowerCase() === 'cancelado') {
      return;
    }
    const comissaoBase = obterComissaoPedido(p);
    const tipo = obterTipoCertificado(p.versao || p.certificado);
    if (tipo === 'CNPJ') {
      valorCnpj += comissaoBase;
      qtdCnpj += 1;
    } else if (tipo === 'CPF') {
      valorCpf += comissaoBase;
      qtdCpf += 1;
    }

    if (ehVendaSim(p.venda)) {
      qtdVendas += 1;
      const precoCertificado = obterPrecoCertificado(p);
      valorVenda += precoCertificado * (porcVenda / 100);
    }
  });

  const totalVenda = valorCnpj + valorCpf;
  const descontoValor = totalVenda * (descontoPercent / 100);
  const totalEsperado = totalVenda - descontoValor;
  const totalGeral = totalEsperado + valorVenda;

  const valorCnpjFmt = `R$ ${formatarMoedaBR(valorCnpj)}`;
  const valorCpfFmt = `R$ ${formatarMoedaBR(valorCpf)}`;
  const totalVendaFmt = `R$ ${formatarMoedaBR(totalVenda)}`;
  const descontoValorFmt = `R$ ${formatarMoedaBR(descontoValor)}`;
  const totalEsperadoFmt = `R$ ${formatarMoedaBR(totalEsperado)}`;
  const valorVendaFmt = `R$ ${formatarMoedaBR(valorVenda)}`;
  const totalGeralFmt = `R$ ${formatarMoedaBR(totalGeral)}`;

  relatorioEl.innerHTML = `
    <div class="relatorio-custom-card">
      <div class="relatorio-group">
        <div class="relatorio-row">
          <div class="relatorio-item-label">
            <span class="relatorio-bullet bullet-cnpj"></span>
            <span class="label-text">e-CNPJ <span class="label-count">${qtdCnpj}</span></span>
          </div>
          <div class="relatorio-item-value">${valorCnpjFmt}</div>
        </div>
        
        <div class="relatorio-row">
          <div class="relatorio-item-label">
            <span class="relatorio-bullet bullet-cpf"></span>
            <span class="label-text">e-CPF <span class="label-count">${qtdCpf}</span></span>
          </div>
          <div class="relatorio-item-value">${valorCpfFmt}</div>
        </div>

        <div class="relatorio-row relatorio-row-total-venda">
          <div class="relatorio-item-label">
            <span class="label-text font-bold">Subtotal de Vendas</span>
          </div>
          <div class="relatorio-item-value font-bold">${totalVendaFmt}</div>
        </div>
      </div>

      <div class="relatorio-group-divider"></div>

      <div class="relatorio-group">
        <div class="relatorio-row text-red">
          <div class="relatorio-item-label">
            <span class="relatorio-bullet bullet-desconto"></span>
            <span class="label-text">Desconto Total (${descontoPercent}%)</span>
          </div>
          <div class="relatorio-item-value font-semibold">- ${descontoValorFmt}</div>
        </div>

        <div class="relatorio-row relatorio-row-total-esperado">
          <div class="relatorio-item-label">
            <span class="label-text">Total Esperado</span>
          </div>
          <div class="relatorio-item-value">${totalEsperadoFmt}</div>
        </div>

        <div class="relatorio-row text-blue">
          <div class="relatorio-item-label">
            <span class="relatorio-bullet bullet-venda-extra"></span>
            <span class="label-text">Comissão de Vendas Extras <span class="label-count">${qtdVendas}</span></span>
          </div>
          <div class="relatorio-item-value font-semibold">+ ${valorVendaFmt}</div>
        </div>
      </div>

      <div class="relatorio-net-result">
        <div class="relatorio-row-result">
          <div class="result-label">
            <span class="label-title">TOTAL LÍQUIDO ESPERADO</span>
            <span class="label-desc">Validações + Vendas</span>
          </div>
          <div class="result-value-badge">${totalGeralFmt}</div>
        </div>
      </div>
    </div>
  `;
}

// Calcula diferença em dias entre duas datas
function calcularDiferencaDias(dataInicio, dataFim) {
  if (!dataInicio || !dataFim) return 0;
  const inicio = new Date(dataInicio);
  const fim = new Date(dataFim);
  const diffTime = Math.abs(fim - inicio);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  return diffDays;
}

// Verifica se é modo multi-dias
function isModoMultiDias() {
  return calcularDiferencaDias(currentDateRange.dataDe, currentDateRange.dataAte) > 0;
}

function obterDataHojeLocalISO() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mes = String(agora.getMonth() + 1).padStart(2, '0');
  const dia = String(agora.getDate()).padStart(2, '0');
  return `${ano}-${mes}-${dia}`;
}

// Inicializa a data atual nos campos de filtro
function initConsultaFilters() {
  const hoje = obterDataHojeLocalISO();
  const dataDeInput = document.getElementById('consulta-data-de');
  const dataAteInput = document.getElementById('consulta-data-ate');
  
  if (dataDeInput) dataDeInput.value = hoje;
  if (dataAteInput) dataAteInput.value = hoje;
  
  // Armazena o range atual
  currentDateRange = { dataDe: hoje, dataAte: hoje };
  
  // Atualiza o header da linha do tempo
  atualizarHeaderTimeline();
  atualizarRelatorioConsulta(pedidosData);
}

// Atualiza o header da linha do tempo baseado no range
function atualizarHeaderTimeline() {
  const timelineTitleSpan = document.querySelector('#consulta .timeline-title');
  const timelineDateSpan = document.getElementById('timeline-date');

  if (!currentDateRange.dataDe || !currentDateRange.dataAte) {
    if (timelineTitleSpan) timelineTitleSpan.textContent = 'Linha do Tempo - Sem data';
    if (timelineDateSpan) timelineDateSpan.textContent = 'Selecione um periodo';
    return;
  }
  
  if (isModoMultiDias()) {
    // Modo multi-dias
    const dataInicio = new Date(currentDateRange.dataDe + 'T00:00:00');
    const dataFim = new Date(currentDateRange.dataAte + 'T00:00:00');
    const numDias = calcularDiferencaDias(currentDateRange.dataDe, currentDateRange.dataAte) + 1;
    const escala = obterEscalaTimelinePeriodo();
    const totalMeses = obterMesesEntreDatas(dataInicio, dataFim);
    const totalAnos = dataFim.getFullYear() - dataInicio.getFullYear() + 1;
    const unidade = escala === 'ano'
      ? `${totalAnos} ${totalAnos === 1 ? 'ano' : 'anos'}`
      : escala === 'mes'
        ? `${totalMeses} ${totalMeses === 1 ? 'mes' : 'meses'}`
        : `${numDias} dias`;
    
    if (timelineTitleSpan) timelineTitleSpan.textContent = `Linha do Tempo - ${unidade}`;
    if (timelineDateSpan) {
      timelineDateSpan.textContent = `${dataInicio.toLocaleDateString('pt-BR')} a ${dataFim.toLocaleDateString('pt-BR')}`;
    }
  } else {
    // Modo dia único
    const dataSelecionada = new Date(currentDateRange.dataDe + 'T00:00:00');
    const dataFormatada = dataSelecionada.toLocaleDateString('pt-BR', {
      weekday: 'long',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });

    if (timelineTitleSpan) timelineTitleSpan.textContent = `Linha do Tempo - ${dataFormatada}`;
    if (timelineDateSpan) {
      timelineDateSpan.textContent = dataSelecionada.toLocaleDateString('pt-BR');
    }
  }
}

// Extrai hora de um timestamp
function extrairHora(timestamp) {
  if (!timestamp) return '00:00';
  const data = new Date(timestamp);
  return `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`;
}

// Converte um valor de data do banco num Date no fuso LOCAL.
//
// Cuidado com 'YYYY-MM-DD' puro: o JS especifica que data-sem-hora e lida como
// meia-noite UTC. No Brasil (UTC-3) isso vira 21h do dia anterior, e a tela
// mostrava o pedido um dia atras do que foi salvo. Por isso a data-so-dia e
// montada campo a campo, que sempre cai no fuso local.
function dataLocalDoBanco(valor) {
  if (!valor) return null;
  const s = String(valor).trim();
  const soDia = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (soDia) {
    return new Date(Number(soDia[1]), Number(soDia[2]) - 1, Number(soDia[3]));
  }
  // Com hora junto ('2026-09-02T14:30:00') o JS ja usa o fuso local quando nao
  // ha 'Z' nem offset, entao o construtor normal serve.
  const data = new Date(s);
  return Number.isNaN(data.getTime()) ? null : data;
}

// Formata data para exibição
function formatarData(timestamp) {
  const data = dataLocalDoBanco(timestamp);
  return data ? data.toLocaleDateString('pt-BR') : '-';
}

// Formata data ISO para exibição
function formatarDataISO(dataISO) {
  const data = dataLocalDoBanco(dataISO);
  return data ? data.toLocaleDateString('pt-BR') : '-';
}

// Calcula o range dinâmico baseado nos horários dos pedidos
function calcularRangeDinamico() {
  if (pedidosData.length === 0) {
    timelineRange = { inicio: 6, fim: 24 };
    return;
  }
  
  // Extrair todas as horas
  const horas = pedidosData.map(p => {
    const [h] = p.hora.split(':').map(Number);
    return h;
  });
  
  const minHora = Math.min(...horas);
  const maxHora = Math.max(...horas);
  
  // Adicionar 1 hora antes e depois
  timelineRange.inicio = Math.max(0, minHora - 1);
  timelineRange.fim = Math.min(24, maxHora + 1);
}

// Gera as marcações de hora dinamicamente
function gerarMarcacoesHora() {
  const hoursContainer = document.querySelector('#consulta .timeline-hours');
  if (!hoursContainer) return;
  
  hoursContainer.innerHTML = '';
  
  const range = timelineRange.fim - timelineRange.inicio;
  const numMarcacoes = Math.min(7, range + 1); // Máximo 7 marcações
  
  for (let i = 0; i < numMarcacoes; i++) {
    const percent = (i / (numMarcacoes - 1)) * 100;
    const hora = timelineRange.inicio + (range * i / (numMarcacoes - 1));
    const horaInt = Math.floor(hora);
    const horaFormatada = `${String(horaInt).padStart(2, '0')}:00`;
    
    const mark = document.createElement('span');
    mark.className = 'hour-mark';
    mark.style.left = `${percent}%`;
    mark.textContent = horaFormatada;
    
    hoursContainer.appendChild(mark);
  }
}

// Gera as marcações de dias para modo multi-dias
function gerarMarcacoesDias() {
  const hoursContainer = document.querySelector('#consulta .timeline-hours');
  if (!hoursContainer) return;
  
  hoursContainer.innerHTML = '';
  
  const dataInicio = new Date(currentDateRange.dataDe + 'T00:00:00');
  const dataFim = new Date(currentDateRange.dataAte + 'T00:00:00');
  const numDias = calcularDiferencaDias(currentDateRange.dataDe, currentDateRange.dataAte) + 1;
  
  // Limitar a 10 marcações para não ficar muito cheio
  const step = numDias <= 10 ? 1 : Math.ceil(numDias / 10);
  
  for (let i = 0; i < numDias; i += step) {
    const percent = numDias === 1 ? 50 : (i / (numDias - 1)) * 100;
    const dataAtual = new Date(dataInicio);
    dataAtual.setDate(dataAtual.getDate() + i);
    
    const mark = document.createElement('span');
    mark.className = 'hour-mark day-mark';
    mark.style.left = `${percent}%`;
    mark.textContent = dataAtual.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
    
    hoursContainer.appendChild(mark);
  }
}

// Agrupa pedidos por data
function agruparPedidosPorData() {
  const grupos = {};
  
  pedidosData.forEach(pedido => {
    const data = pedido.data || 'Sem data';
    if (!grupos[data]) {
      grupos[data] = [];
    }
    grupos[data].push(pedido);
  });
  
  return grupos;
}

// Calcula posição do dia na timeline multi-dias
function calcularPosicaoDia(dataStr) {
  if (!currentDateRange.dataDe || !currentDateRange.dataAte) return 50;
  
  // Converter data no formato dd/mm/yyyy para Date
  const partes = dataStr.split('/');
  if (partes.length !== 3) return 50;
  
  const dataAtual = new Date(partes[2], partes[1] - 1, partes[0]);
  const dataInicio = new Date(currentDateRange.dataDe + 'T00:00:00');
  const dataFim = new Date(currentDateRange.dataAte + 'T00:00:00');
  
  const totalDias = calcularDiferencaDias(currentDateRange.dataDe, currentDateRange.dataAte);
  if (totalDias === 0) return 50;
  
  const diasDesdeInicio = Math.ceil((dataAtual - dataInicio) / (1000 * 60 * 60 * 24));
  
  let posicao = (diasDesdeInicio / totalDias) * 100;
  if (posicao < 3) posicao = 3;
  if (posicao > 97) posicao = 97;
  
  return posicao;
}

function parseDataTimeline(dataStr) {
  if (!dataStr) return null;
  const texto = String(dataStr).trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(texto)) {
    return new Date(`${texto}T00:00:00`);
  }

  const partes = texto.split('/');
  if (partes.length === 3) {
    const [dia, mes, ano] = partes.map(Number);
    if (dia && mes && ano) return new Date(ano, mes - 1, dia);
  }

  return null;
}

function obterMesesEntreDatas(inicio, fim) {
  return ((fim.getFullYear() - inicio.getFullYear()) * 12) + (fim.getMonth() - inicio.getMonth()) + 1;
}

function obterEscalaTimelinePeriodo() {
  if (!currentDateRange.dataDe || !currentDateRange.dataAte) return 'dia';

  const inicio = parseDataTimeline(currentDateRange.dataDe);
  const fim = parseDataTimeline(currentDateRange.dataAte);
  if (!inicio || !fim) return 'dia';

  const meses = obterMesesEntreDatas(inicio, fim);
  if (meses > 24) return 'ano';
  if (meses > 1) return 'mes';
  return 'dia';
}

function obterNomeMesCurtoTimeline(mesIndex) {
  return ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'][mesIndex] || '';
}

function obterNomeMesLongoTimeline(mesIndex) {
  return ['Janeiro', 'Fevereiro', 'Marco', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][mesIndex] || '';
}

function formatarPeriodoTimeline(data, escala) {
  if (escala === 'ano') {
    const ano = data.getFullYear();
    return {
      key: String(ano),
      label: String(ano),
      detail: String(ano),
      start: new Date(ano, 0, 1),
      end: new Date(ano, 11, 31)
    };
  }

  if (escala === 'mes') {
    const ano = data.getFullYear();
    const mes = data.getMonth();
    const anoCurto = String(ano).slice(-2);
    return {
      key: `${ano}-${String(mes + 1).padStart(2, '0')}`,
      label: `${obterNomeMesCurtoTimeline(mes)}/${anoCurto}`,
      detail: `${obterNomeMesLongoTimeline(mes)} de ${ano}`,
      start: new Date(ano, mes, 1),
      end: new Date(ano, mes + 1, 0)
    };
  }

  const dia = String(data.getDate()).padStart(2, '0');
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const ano = data.getFullYear();
  return {
    key: `${ano}-${mes}-${dia}`,
    label: `${dia}/${mes}`,
    detail: `${dia}/${mes}/${ano}`,
    start: new Date(ano, data.getMonth(), data.getDate()),
    end: new Date(ano, data.getMonth(), data.getDate())
  };
}

function calcularPosicaoDataTimeline(data) {
  const dataInicio = parseDataTimeline(currentDateRange.dataDe);
  const dataFim = parseDataTimeline(currentDateRange.dataAte);
  if (!dataInicio || !dataFim || !data) return 50;

  const total = dataFim - dataInicio;
  if (total <= 0) return 50;

  let posicao = ((data - dataInicio) / total) * 100;
  if (posicao < 3) posicao = 3;
  if (posicao > 97) posicao = 97;
  return posicao;
}

function gerarMarcacoesPeriodoTimeline(escala = obterEscalaTimelinePeriodo()) {
  const hoursContainer = document.querySelector('#consulta .timeline-hours');
  if (!hoursContainer) return;

  hoursContainer.innerHTML = '';

  const dataInicio = parseDataTimeline(currentDateRange.dataDe);
  const dataFim = parseDataTimeline(currentDateRange.dataAte);
  if (!dataInicio || !dataFim) return;

  const marcacoes = [];
  if (escala === 'ano') {
    for (let ano = dataInicio.getFullYear(); ano <= dataFim.getFullYear(); ano += 1) {
      marcacoes.push(formatarPeriodoTimeline(new Date(ano, 0, 1), escala));
    }
  } else if (escala === 'mes') {
    const totalMeses = obterMesesEntreDatas(dataInicio, dataFim);
    for (let i = 0; i < totalMeses; i += 1) {
      marcacoes.push(formatarPeriodoTimeline(new Date(dataInicio.getFullYear(), dataInicio.getMonth() + i, 1), escala));
    }
  } else {
    const numDias = calcularDiferencaDias(currentDateRange.dataDe, currentDateRange.dataAte) + 1;
    for (let i = 0; i < numDias; i += 1) {
      const dataAtual = new Date(dataInicio);
      dataAtual.setDate(dataAtual.getDate() + i);
      marcacoes.push(formatarPeriodoTimeline(dataAtual, escala));
    }
  }

  const step = marcacoes.length <= 10 ? 1 : Math.ceil(marcacoes.length / 10);
  marcacoes.forEach((periodo, index) => {
    if (index % step !== 0 && index !== marcacoes.length - 1) return;

    const inicioPeriodo = periodo.start < dataInicio ? dataInicio : periodo.start;
    const fimPeriodo = periodo.end > dataFim ? dataFim : periodo.end;
    const centroPeriodo = new Date((inicioPeriodo.getTime() + fimPeriodo.getTime()) / 2);

    const mark = document.createElement('span');
    mark.className = 'hour-mark day-mark';
    mark.style.left = `${calcularPosicaoDataTimeline(centroPeriodo)}%`;
    mark.textContent = periodo.label;
    hoursContainer.appendChild(mark);
  });
}

function agruparPedidosPorPeriodoTimeline(escala = obterEscalaTimelinePeriodo()) {
  const grupos = new Map();
  const dataInicio = parseDataTimeline(currentDateRange.dataDe);
  const dataFim = parseDataTimeline(currentDateRange.dataAte);

  pedidosData.forEach((pedido) => {
    const dataPedido = parseDataTimeline(pedido.data);
    if (!dataPedido) return;

    const periodoBase = formatarPeriodoTimeline(dataPedido, escala);
    const grupo = grupos.get(periodoBase.key) || {
      ...periodoBase,
      pedidos: []
    };
    grupo.pedidos.push(pedido);
    grupos.set(periodoBase.key, grupo);
  });

  return Array.from(grupos.values())
    .map((periodo) => {
      const inicioPeriodo = dataInicio && periodo.start < dataInicio ? dataInicio : periodo.start;
      const fimPeriodo = dataFim && periodo.end > dataFim ? dataFim : periodo.end;
      const centroPeriodo = new Date((inicioPeriodo.getTime() + fimPeriodo.getTime()) / 2);
      return {
        ...periodo,
        posicao: calcularPosicaoDataTimeline(centroPeriodo)
      };
    })
    .sort((a, b) => a.start - b.start);
}

// Dados de exemplo para demonstração
function carregarDadosExemplo() {
  pedidosData = [
    { num_pedido: '1234', hora: '08:30', nome: 'João Silva', status: 'aprovado', versao: 'A1', data: '19/12/2025' },
    { num_pedido: '1235', hora: '09:15', nome: 'Maria Santos', status: 'digitacao', versao: 'A3', data: '19/12/2025' },
    { num_pedido: '1236', hora: '10:45', nome: 'Carlos Oliveira', status: 'video', versao: 'A1', data: '19/12/2025' },
    { num_pedido: '1237', hora: '14:00', nome: 'Ana Costa', status: 'cancelado', versao: 'A3', data: '19/12/2025' },
    { num_pedido: '1238', hora: '15:30', nome: 'Pedro Lima', status: 'verificacao', versao: 'A1', data: '19/12/2025' },
    { num_pedido: '1239', hora: '17:00', nome: 'Lucia Ferreira', status: 'aprovado', versao: 'A3', data: '19/12/2025' }
  ];
  
  calcularRangeDinamico();
  renderizarTimeline();
  renderizarTabela(pedidosData);
}

function normalizarStatus(status) {
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

function getStatusSlug(status) {
  const norm = normalizarStatus(status);
  switch (norm) {
    case 'APROVADO': return 'aprovado';
    case 'CANCELADO': return 'cancelado';
    case 'VIDEO REALIZADA': return 'video';
    case 'VERIFICAÇÃO': return 'verificacao';
    case 'DIGITAÇÃO':
    default:
      return 'digitacao';
  }
}

function getStatusLabel(status) {
  switch (normalizarStatus(status)) {
    case 'APROVADO':
      return 'Aprovado';
    case 'CANCELADO':
      return 'Cancelado';
    case 'VIDEO REALIZADA':
      return 'Vídeo realizada';
    case 'VERIFICAÇÃO':
      return 'Verificação';
    case 'DIGITAÇÃO':
    default:
      return 'Digitação';
  }
}

function deduplicarPedidosMaisRecentes(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return [];

  // Garante ordenação decrescente por ID para pegar a versão mais recente de cada pedido
  const ordenada = [...lista].sort((a, b) => {
    const idA = Number(a?.id || 0);
    const idB = Number(b?.id || 0);
    return idB - idA;
  });

  const vistos = new Set();
  const resultado = [];

  ordenada.forEach((pedido) => {
    const numero = String(pedido?.pedido ?? pedido?.num_pedido ?? '').trim();
    if (!numero) {
      resultado.push(pedido);
      return;
    }
    if (vistos.has(numero)) return;
    vistos.add(numero);
    resultado.push(pedido);
  });

  return resultado;
}

// Renderiza a linha do tempo
function renderizarTimeline() {
  const container = document.getElementById('timeline-pedidos');
  const bottomContainer = document.querySelector('#consulta .consulta-bottom');
  const timelineContainer = document.querySelector('#consulta .timeline-container');
  if (!container || !timelineContainer || !bottomContainer) return;
  
  // Remove existing empty state if any
  const existingEmpty = timelineContainer.querySelector('.empty-state-box');
  if (existingEmpty) existingEmpty.remove();
  
  bottomContainer.classList.remove('is-empty');
  timelineContainer.classList.remove('is-empty');
  container.innerHTML = '';
  
  // Atualiza o header
  atualizarHeaderTimeline();
  
  if (!pedidosData || pedidosData.length === 0) {
    bottomContainer.classList.add('is-empty');
    timelineContainer.classList.add('is-empty');
    
    const emptyBox = document.createElement('div');
    emptyBox.className = 'empty-state-box';
    emptyBox.innerHTML = `
      <div class="empty-state-icon">
        <svg width="32" height="32" viewBox="0 0 256 256" fill="currentColor"><path d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z"/></svg>
      </div>
      <div class="empty-state-text">Nenhum pedido encontrado para o período selecionado.</div>
    `;
    timelineContainer.appendChild(emptyBox);
    return;
  }
  
  if (isModoMultiDias()) {
    // Modo multi-dias: agrupa por data
    renderizarTimelineMultiDias(container, timelineContainer);
  } else {
    // Modo dia único: por hora
    renderizarTimelineDiaUnicoAgrupado(container, timelineContainer);
  }
}

function horaParaMinutos(horaStr) {
  const [h, m] = String(horaStr || '00:00')
    .slice(0, 5)
    .split(':')
    .map((n) => Number(n) || 0);
  return (h * 60) + m;
}

function minutosParaHora(totalMinutos) {
  const minutosNormalizados = Math.max(0, Math.min(24 * 60, Number(totalMinutos) || 0));
  const h = Math.floor(minutosNormalizados / 60);
  const m = minutosNormalizados % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function obterStatusDominante(pedidos) {
  const statusCount = {
    aprovado: 0,
    digitacao: 0,
    video: 0,
    verificacao: 0,
    cancelado: 0
  };

  pedidos.forEach((p) => {
    const slug = getStatusSlug(p.status);
    if (statusCount[slug] !== undefined) statusCount[slug]++;
  });

  let statusDominante = 'digitacao';
  let maxCount = 0;
  for (const [status, count] of Object.entries(statusCount)) {
    if (count > maxCount) {
      maxCount = count;
      statusDominante = status;
    }
  }
  return statusDominante;
}

function montarTooltipGrupoTimeline(grupo) {
  const faixa = grupo.horaInicio === grupo.horaFim
    ? grupo.horaInicio
    : `${grupo.horaInicio} - ${grupo.horaFim}`;
  const pedidos = grupo.pedidos
    .map((p) => String(p.num_pedido || '').trim())
    .filter(Boolean);
  const limite = 24;
  const pedidosPreview = pedidos.slice(0, limite).join(', ');
  const sufixo = pedidos.length > limite ? ', ...' : '';
  return `Horario: ${faixa}\nPedidos: ${grupo.pedidos.length}\n${pedidosPreview}${sufixo}`;
}

function compactarGruposTimeline(gruposOrdenados, maxClusters = 18) {
  const gruposConvertidos = gruposOrdenados.map(([hora, pedidos]) => ({
    hora,
    minutos: horaParaMinutos(hora),
    pedidos
  }));

  if (gruposConvertidos.length <= maxClusters) {
    return gruposConvertidos.map((g) => ({
      horaInicio: g.hora,
      horaFim: g.hora,
      minutosCentro: g.minutos,
      pedidos: g.pedidos
    }));
  }

  const rangeMinutos = Math.max(60, (timelineRange.fim - timelineRange.inicio) * 60);

  function gerarClusters(janelaMinutos) {
    const clusters = [];
    let atual = null;

    gruposConvertidos.forEach((grupo) => {
      if (!atual) {
        atual = {
          minutosInicio: grupo.minutos,
          minutosFim: grupo.minutos,
          somaMinutos: grupo.minutos,
          totalGrupos: 1,
          pedidos: [...grupo.pedidos]
        };
        return;
      }

      const distancia = grupo.minutos - atual.minutosFim;
      if (distancia <= janelaMinutos) {
        atual.minutosFim = grupo.minutos;
        atual.somaMinutos += grupo.minutos;
        atual.totalGrupos += 1;
        atual.pedidos.push(...grupo.pedidos);
      } else {
        clusters.push(atual);
        atual = {
          minutosInicio: grupo.minutos,
          minutosFim: grupo.minutos,
          somaMinutos: grupo.minutos,
          totalGrupos: 1,
          pedidos: [...grupo.pedidos]
        };
      }
    });

    if (atual) clusters.push(atual);

    return clusters.map((c) => ({
      horaInicio: minutosParaHora(c.minutosInicio),
      horaFim: minutosParaHora(c.minutosFim),
      minutosCentro: Math.round(c.somaMinutos / c.totalGrupos),
      pedidos: c.pedidos
    }));
  }

  let janela = Math.max(8, Math.ceil(rangeMinutos / maxClusters));
  let clusters = gerarClusters(janela);
  let tentativas = 0;

  while (clusters.length > maxClusters && tentativas < 6) {
    janela = Math.ceil(janela * 1.4);
    clusters = gerarClusters(janela);
    tentativas += 1;
  }

  return clusters;
}

function obterClasseFaixaTimeline(index, modoCompacto) {
  if (!modoCompacto) return index % 2 === 0 ? 'timeline-above' : 'timeline-below';
  const classes = ['timeline-above', 'timeline-below', 'timeline-above-alt', 'timeline-below-alt'];
  return classes[index % classes.length];
}

// Renderiza timeline para um único dia (por hora)
function renderizarTimelineDiaUnicoAgrupado(container, timelineContainer) {
  if (timelineContainer) timelineContainer.classList.add('multi-dias');
  gerarMarcacoesHora();

  const gruposPorHora = new Map();
  pedidosData.forEach((pedido) => {
    const hora = String(pedido.hora || '00:00').slice(0, 5);
    if (!gruposPorHora.has(hora)) gruposPorHora.set(hora, []);
    gruposPorHora.get(hora).push(pedido);
  });

  const gruposOrdenados = Array.from(gruposPorHora.entries()).sort((a, b) => a[0].localeCompare(b[0]));
  const gruposRender = compactarGruposTimeline(gruposOrdenados, 18);
  const modoCompacto = gruposRender.length < gruposOrdenados.length || gruposOrdenados.length > 18 || pedidosData.length > 80;

  gruposRender.forEach((grupo, index) => {
    const horaCentro = minutosParaHora(grupo.minutosCentro);
    const posicao = calcularPosicaoHoraDinamica(horaCentro);
    const isAbove = index % 2 === 0;
    const statusDominante = obterStatusDominante(grupo.pedidos);

    const pedidosIds = grupo.pedidos
      .map((p) => String(p.num_pedido || '').trim())
      .filter(Boolean);

    const totalPedidos = grupo.pedidos.length;
    const faixaHorario = grupo.horaInicio === grupo.horaFim
      ? grupo.horaInicio
      : `${grupo.horaInicio}-${grupo.horaFim}`;

    const classeStatusBalao = ` status-${statusDominante}`;

    let alignClass = '';
    if (posicao < 30) {
      alignClass = ' align-left';
    } else if (posicao > 70) {
      alignClass = ' align-right';
    }

    const dayGroup = document.createElement('div');
    dayGroup.className = `timeline-day-group ${isAbove ? 'timeline-above' : 'timeline-below'}`;
    dayGroup.style.left = `${posicao}%`;
    dayGroup.dataset.pedidos = pedidosIds.join(',');

    dayGroup.innerHTML = `
      <div class="day-balloon${classeStatusBalao}">
        <div class="day-count">${totalPedidos}</div>
        <div class="day-details${alignClass}">
          <div class="day-details-header">${escaparHtml(faixaHorario)}</div>
          <div class="day-pedidos-list">
            ${grupo.pedidos.map(p => `
              <div class="day-pedido-item">
                <span>#${p.num_pedido}</span>
                <span>${p.hora}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;

    container.appendChild(dayGroup);
  });
}

function renderizarTimelineDiaUnico(container, timelineContainer) {
  return renderizarTimelineDiaUnicoAgrupado(container, timelineContainer);
}

function limparDestaqueTimeline() {
  document.querySelectorAll('#consulta .timeline-pedido.is-highlight, #consulta .timeline-day-group.is-highlight').forEach((el) => {
    el.classList.remove('is-highlight');
  });
}

function destacarBaloesTimelinePorPedido(numeroPedido) {
  limparDestaqueTimeline();
  const pedidoAlvo = String(numeroPedido || '').trim();
  if (!pedidoAlvo) return;

  const baloes = document.querySelectorAll('#consulta .timeline-pedido[data-pedidos], #consulta .timeline-day-group[data-pedidos]');
  baloes.forEach((balao) => {
    const pedidos = String(balao.dataset.pedidos || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);
    if (pedidos.includes(pedidoAlvo)) {
      balao.classList.add('is-highlight');
    }
  });
}

// Renderiza timeline para múltiplos dias (agrupado por data)
function renderizarTimelineMultiDias(container, timelineContainer) {
  if (timelineContainer) timelineContainer.classList.add('multi-dias');
  const escala = obterEscalaTimelinePeriodo();
  gerarMarcacoesPeriodoTimeline(escala);
  
  const periodos = agruparPedidosPorPeriodoTimeline(escala);
  
  periodos.forEach((periodo, index) => {
    const pedidosDoDia = periodo.pedidos;
    const posicaoX = periodo.posicao;
    
    // Criar grupo do dia
    const isAbove = index % 2 === 0;
    const dayGroup = document.createElement('div');
    dayGroup.className = `timeline-day-group ${isAbove ? 'timeline-above' : 'timeline-below'}`;
    dayGroup.style.left = `${posicaoX}%`;
    
    // Contar status para o resumo
    const statusCount = {
      aprovado: 0,
      digitacao: 0,
      video: 0,
      verificacao: 0,
      cancelado: 0
    };
    
    pedidosDoDia.forEach(p => {
      const slug = getStatusSlug(p.status);
      if (statusCount[slug] !== undefined) {
        statusCount[slug]++;
      }
    });
    
    // Determinar cor dominante
    let corDominante = 'digitacao';
    let maxCount = 0;
    for (const [status, count] of Object.entries(statusCount)) {
      if (count > maxCount) {
        maxCount = count;
        corDominante = status;
      }
    }
    
    const classeStatusBalao = escala === 'dia' ? ` status-${corDominante}` : '';

    let alignClass = '';
    if (posicaoX < 30) {
      alignClass = ' align-left';
    } else if (posicaoX > 70) {
      alignClass = ' align-right';
    }

    dayGroup.innerHTML = `
      <div class="day-balloon${classeStatusBalao}">
        <div class="day-count">${pedidosDoDia.length}</div>
        <div class="day-details${alignClass}">
          <div class="day-details-header">${escaparHtml(periodo.detail)}</div>
          <div class="day-pedidos-list">
            ${pedidosDoDia.map(p => `
              <div class="day-pedido-item">
                <span>#${p.num_pedido}</span>
                <span>${p.hora}</span>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    `;
    
    container.appendChild(dayGroup);
  });
}

function calcularPosicaoHoraDinamica(horaStr) {
  const [horas, minutos] = horaStr.split(':').map(Number);
  const totalMinutos = horas * 60 + minutos;
  
  const minutoInicio = timelineRange.inicio * 60;
  const minutoFim = timelineRange.fim * 60;
  const range = minutoFim - minutoInicio;
  
  let posicao = ((totalMinutos - minutoInicio) / range) * 100;
  
  // Ajustar limites
  if (posicao < 3) posicao = 3;
  if (posicao > 97) posicao = 97;
  
  return posicao;
}

// Renderiza a tabela de consulta
function renderizarTabela(dados) {
  const tbody = document.getElementById('consulta-table-body');
  const tableWrapper = document.querySelector('#consulta .consulta-table-wrapper');
  if (!tbody || !tableWrapper) return;

  const total = Array.isArray(dados) ? dados.length : 0;
  const footer = document.getElementById('consulta-resultado-count');
  if (footer) {
    footer.textContent = total === 0
      ? 'Nenhum pedido encontrado'
      : `${total} pedido${total === 1 ? '' : 's'} encontrado${total === 1 ? '' : 's'}`;
  }

  // Remove existing empty state if any
  const existingEmpty = tableWrapper.querySelector('.empty-state-box');
  if (existingEmpty) existingEmpty.remove();

  const table = tableWrapper.querySelector('table');
  if (table) table.style.display = '';
  tableWrapper.classList.remove('is-empty');

  tbody.innerHTML = '';

  if (!dados || dados.length === 0) {
    tableWrapper.classList.add('is-empty');
    if (table) table.style.display = 'none';
    
    const emptyBox = document.createElement('div');
    emptyBox.className = 'empty-state-box';
    emptyBox.innerHTML = `
      <div class="empty-state-icon">
        <svg width="40" height="40" viewBox="0 0 256 256" fill="currentColor"><path d="M236.8,188.09,149.35,36.22h0a24.76,24.76,0,0,0-42.7,0L19.2,188.09a23.51,23.51,0,0,0,0,23.72A24.35,24.35,0,0,0,40.55,224h174.9a24.35,24.35,0,0,0,21.33-12.19A23.51,23.51,0,0,0,236.8,188.09ZM222.93,203.8a8.5,8.5,0,0,1-7.48,4.2H40.55a8.5,8.5,0,0,1-7.48-4.2,7.59,7.59,0,0,1,0-7.72L120.52,44.21a8.75,8.75,0,0,1,15,0l87.45,151.87A7.59,7.59,0,0,1,222.93,203.8ZM120,144V104a8,8,0,0,1,16,0v40a8,8,0,0,1-16,0Zm20,36a12,12,0,1,1-12-12A12,12,0,0,1,140,180Z"/></svg>
      </div>
      <div class="empty-state-text">Nenhum pedido encontrado para o período selecionado.</div>
    `;
    tableWrapper.appendChild(emptyBox);
    return;
  }

  dados.forEach(pedido => {
    const tr = document.createElement('tr');
    const numeroPedido = String(pedido.num_pedido || '').trim();
    
    const statusIcon = getStatusIcon(pedido.status);
    
    tr.innerHTML = `
      <td>${statusIcon}</td>
      <td>${pedido.num_pedido || '-'}</td>
      <td>${pedido.data || '-'}</td>
      <td>${pedido.hora || '-'}</td>
      <td>${pedido.nome || '-'}</td>
      <td>${pedido.versao || '-'}</td>
    `;

    if (numeroPedido) {
      tr.style.cursor = 'pointer';
      tr.title = `Abrir pedido ${numeroPedido} em nova aba`;
      tr.addEventListener('mouseenter', () => {
        destacarBaloesTimelinePorPedido(numeroPedido);
      });
      tr.addEventListener('mouseleave', () => {
        limparDestaqueTimeline();
      });
      tr.addEventListener('dblclick', async () => {
        if (abrindoPedidoDaConsulta) return;
        abrindoPedidoDaConsulta = true;
        try {
          if (typeof window.__abrirPedidoConsultaEmNovaAba === 'function') {
            await window.__abrirPedidoConsultaEmNovaAba(numeroPedido);
          }
        } catch (error) {
          console.error('Erro ao abrir pedido da consulta em nova aba:', error);
        } finally {
          abrindoPedidoDaConsulta = false;
        }
      });
    }
    
    tbody.appendChild(tr);
  });
}

// Retorna o ícone de status
function getStatusIcon(status) {
  const statusNormalizado = normalizarStatus(status);
  const slug = getStatusSlug(statusNormalizado);
  return `<span class="status-badge status-${slug}">
    <span class="status-badge-dot"></span>
    <span>${getStatusLabel(statusNormalizado)}</span>
  </span>`;
}

// Busca pedidos com os filtros atuais da aba Consulta. Nao ha botao de
// buscar: isso roda sempre que a aba abre e sempre que qualquer filtro muda
// (texto, datas, status, tipo, atendimento, venda).
async function executarBuscaConsulta() {
    const dataDe = document.getElementById('consulta-data-de')?.value;
    const dataAte = document.getElementById('consulta-data-ate')?.value;
    const statusFiltro = document.getElementById('consulta-status')?.value?.trim();
    
    // Atualiza o range de datas atual
    currentDateRange = { dataDe: dataDe || null, dataAte: dataAte || null };
    
    try {
      const buscaTexto = document.getElementById('consulta-busca')?.value?.trim().toLowerCase();

      // Se o usuário digitou uma busca específica (pedido, CPF, cliente), não restringe por data e filtra no banco
      const resultado = await window.electronAPI.buscarPedidos({
        busca: buscaTexto || undefined,
        dataDe: buscaTexto ? undefined : (dataDe || undefined),
        dataAte: buscaTexto ? undefined : (dataAte || undefined),
        usuario: currentUser?.email || undefined
      });
      
      if (resultado.success && resultado.data) {
        let dadosFiltrados = deduplicarPedidosMaisRecentes(resultado.data);
        
        // Filtro de Status Insensível a maiúsculas/minúsculas e acentos
        if (statusFiltro) {
          const statusEsperado = normalizarStatus(statusFiltro);
          dadosFiltrados = dadosFiltrados.filter(p => normalizarStatus(p.status) === statusEsperado);
        }

        // Filtro de Venda
        const vendaFiltro = document.getElementById('consulta-venda')?.value;
        if (vendaFiltro === 'sim') {
          dadosFiltrados = dadosFiltrados.filter(p => ehVendaSim(p.venda ?? p.VENDA));
        } else if (vendaFiltro === 'nao') {
          dadosFiltrados = dadosFiltrados.filter(p => !ehVendaSim(p.venda ?? p.VENDA));
        }

        // Filtro de Tipo (CPF / CNPJ)
        const tipoFiltro = document.getElementById('consulta-tipo')?.value?.trim().toUpperCase();
        if (tipoFiltro) {
          dadosFiltrados = dadosFiltrados.filter(p => {
            const versao = String(p.versao || p.certificado || '').toUpperCase();
            const tipo = String(p.tipo || '').toUpperCase();
            return versao.includes(tipoFiltro) || tipo.includes(tipoFiltro);
          });
        }

        // Filtro de Atendimento (Video / Presencial)
        const atendimentoFiltro = document.getElementById('consulta-atendimento')?.value?.trim().toLowerCase();
        if (atendimentoFiltro) {
          dadosFiltrados = dadosFiltrados.filter(p => {
            const atend = String(p.atendimento || p.modalidade || '').trim().toLowerCase();
            return atend.includes(atendimentoFiltro);
          });
        }

        // Barra de Pesquisa de Pedidos (Busca por Número, Cliente, CPF, CNPJ, E-mail, Certificado ou Observação)
        if (buscaTexto) {
          const buscaDigitos = buscaTexto.replace(/\D/g, '');
          dadosFiltrados = dadosFiltrados.filter(p => {
            const numPedido = String(p.pedido || p.id || '').toLowerCase();
            const numPedidoDigitos = numPedido.replace(/\D/g, '');
            const nomeCliente = String(p.nome || p.razao_social || '').toLowerCase();
            const emailCliente = String(p.email || '').toLowerCase();
            const versaoCert = String(p.versao || p.certificado || '').toLowerCase();
            const obs = String(p.obs || p.observacao || p.comentarios || '').toLowerCase();
            const cpf = String(p.cpf || p.CPF || p.documento || '').toLowerCase();
            const cpfDigitos = cpf.replace(/\D/g, '');
            const cnpj = String(p.cnpj || p.CNPJ || '').toLowerCase();
            const cnpjDigitos = cnpj.replace(/\D/g, '');

            const matchTexto = numPedido.includes(buscaTexto) ||
              nomeCliente.includes(buscaTexto) ||
              emailCliente.includes(buscaTexto) ||
              versaoCert.includes(buscaTexto) ||
              obs.includes(buscaTexto) ||
              cpf.includes(buscaTexto) ||
              cnpj.includes(buscaTexto);

            const matchDigitos = Boolean(buscaDigitos.length >= 2 && (
              (cpfDigitos && cpfDigitos.includes(buscaDigitos)) ||
              (cnpjDigitos && cnpjDigitos.includes(buscaDigitos)) ||
              (numPedidoDigitos && numPedidoDigitos.includes(buscaDigitos))
            ));

            return matchTexto || matchDigitos;
          });
        }

        pedidosDataCompleto = dadosFiltrados;
        pedidosData = dadosFiltrados.map(p => ({
          num_pedido: p.pedido || p.id,
          hora: p.hora || '00:00',
          nome: p.nome || 'N/A',
          status: normalizarStatus(p.status),
          versao: p.versao || p.certificado || '-',
          data: formatarDataISO(p.data),
          comissao: p.comissao ?? p.COMISSAO ?? p.valor_comissao ?? p['COMISSAO'] ?? 0,
          preco: p.preco ?? p.PRECO ?? p['PRECO'] ?? 0,
          preco_certificado: p.preco_certificado ?? p.precoCertificado ?? p.PRECO_CERTIFICADO ?? p['PRECO CERTIFICADO'] ?? 0,
          venda: p.venda ?? p.VENDA ?? '',
          atendimento: p.atendimento ?? p.modalidade ?? ''
        }));
      } else {
        pedidosData = [];
        pedidosDataCompleto = [];
      }
      
      calcularRangeDinamico();
      renderizarTimeline();
      renderizarTabela(pedidosData);
      atualizarRelatorioConsulta(pedidosData);
    } catch (error) {
      console.error('Erro ao buscar pedidos:', error);
      atualizarRelatorioConsulta([]);
    }
}

// Exporta os pedidos atualmente listados na Consulta para uma planilha Excel
const btnConsultaExportar = document.getElementById('btn-consulta-exportar');
if (btnConsultaExportar) {
  btnConsultaExportar.addEventListener('click', async () => {
    if (!pedidosDataCompleto || pedidosDataCompleto.length === 0) {
      if (window.toastNotifier) {
        window.toastNotifier.warning('Nenhum pedido para exportar. Ajuste os filtros da busca.');
      }
      return;
    }

    btnConsultaExportar.disabled = true;
    try {
      const linhas = pedidosDataCompleto.map(p => ({
        'Pedido': p.pedido || p.id || '',
        'Status': getStatusLabel(p.status),
        'Data': formatarDataISO(p.data),
        'Hora': p.hora || '',
        'Nome': p.nome || '',
        'E-mail': p.email || '',
        'Telefone': p.telefone || '',
        'Nascimento': p.nascimento || '',
        'Mãe': p.mae || '',
        'CPF': p.cpf || '',
        'RG': p.rg || '',
        'Órgão RG': p.orgao_rg || '',
        'CNH': p.cnh || '',
        'Código Seg. CNH': p.codigo_de_seg_cnh || '',
        'CNPJ': p.cnpj || '',
        'Razão Social': p.razao_social || '',
        'Nome Fantasia': p.nome_fantasia || '',
        'Situação Cadastral': p.situacao_cadastral || '',
        'Data Situação Cadastral': p.data_situacao_cadastral || '',
        'Data Abertura': p.data_abertura || '',
        'Capital Social': p.capital_social || '',
        'CEP': p.cep || '',
        'Município': p.municipio || '',
        'UF': p.uf || '',
        'Bairro': p.bairro || '',
        'Logradouro': p.logradouro || '',
        'Complemento': p.complemento || '',
        'Junta': p.junta || '',
        'Diretório': p.diretorio || '',
        'Certificado': p.versao || p.certificado || '',
        'Tipo': p.tipo || '',
        'Atendimento': p.atendimento || p.modalidade || '',
        'Venda': ehVendaSim(p.venda ?? p.VENDA) ? 'Sim' : 'Não',
        'Preço Certificado': p.preco_certificado ?? p.precoCertificado ?? p.PRECO_CERTIFICADO ?? 0,
        'Comissão': p.comissao ?? p.COMISSAO ?? p.valor_comissao ?? 0,
        'Pasta': p.pasta || '',
        'Comentários': p.comentarios || ''
      }));

      const hoje = new Date();
      const carimbo = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}-${String(hoje.getDate()).padStart(2, '0')}`;
      const resultado = await window.electronAPI.exportarPedidosExcel({
        linhas,
        sheetName: 'Pedidos',
        nomeArquivoSugerido: `pedidos-${carimbo}.xlsx`
      });

      if (resultado?.canceled) {
        return;
      }

      if (resultado?.success) {
        if (window.toastNotifier) {
          window.toastNotifier.success(`Planilha exportada com sucesso (${linhas.length} pedido${linhas.length === 1 ? '' : 's'}).`);
        }
      } else if (window.toastNotifier) {
        window.toastNotifier.error(`Não foi possível exportar: ${resultado?.error || 'erro desconhecido'}`);
      }
    } catch (error) {
      console.error('Erro ao exportar pedidos para Excel:', error);
      if (window.toastNotifier) {
        window.toastNotifier.error('Erro ao exportar pedidos para Excel.');
      }
    } finally {
      btnConsultaExportar.disabled = false;
    }
  });
}

// Live search ao digitar na barra de busca
const inputBuscaConsulta = document.getElementById('consulta-busca');
if (inputBuscaConsulta) {
  let debounceTimeout = null;
  inputBuscaConsulta.addEventListener('input', () => {
    clearTimeout(debounceTimeout);
    debounceTimeout = setTimeout(() => {
      executarBuscaConsulta();
    }, 250);
  });
  inputBuscaConsulta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      clearTimeout(debounceTimeout);
      executarBuscaConsulta();
    }
  });
}

// Atualização automática ao trocar os selects de filtro
['consulta-status', 'consulta-tipo', 'consulta-atendimento', 'consulta-venda'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('change', () => {
      executarBuscaConsulta();
    });
  }
});

// Atualização automática ao trocar as datas (digitação, navegação por
// teclado ou seleção no calendário — o calendário proprio dispara 'change'
// no input depois de escolher o dia).
['consulta-data-de', 'consulta-data-ate'].forEach(id => {
  const el = document.getElementById(id);
  if (el) {
    el.addEventListener('change', () => {
      if (id === 'consulta-data-de') {
        currentDateRange.dataDe = el.value;
      } else {
        currentDateRange.dataAte = el.value;
      }
      executarBuscaConsulta();
    });
  }
});

// Botão Limpar Filtros
const btnConsultaLimpar = document.getElementById('btn-consulta-limpar');
if (btnConsultaLimpar) {
  btnConsultaLimpar.addEventListener('click', () => {
    const inputBusca = document.getElementById('consulta-busca');
    const selectStatus = document.getElementById('consulta-status');
    const selectTipo = document.getElementById('consulta-tipo');
    const selectAtendimento = document.getElementById('consulta-atendimento');
    const selectVenda = document.getElementById('consulta-venda');

    if (inputBusca) inputBusca.value = '';
    if (selectStatus) selectStatus.value = '';
    if (selectTipo) selectTipo.value = '';
    if (selectAtendimento) selectAtendimento.value = '';
    if (selectVenda) selectVenda.value = '';

    executarBuscaConsulta();
  });
}

const btnConsultaHoje = document.getElementById('btn-consulta-hoje');
if (btnConsultaHoje) {
  btnConsultaHoje.addEventListener('click', () => {
    const hoje = obterDataHojeLocalISO();
    const dataDeInput = document.getElementById('consulta-data-de');
    const dataAteInput = document.getElementById('consulta-data-ate');

    if (dataDeInput) dataDeInput.value = hoje;
    if (dataAteInput) dataAteInput.value = hoje;
    currentDateRange = { dataDe: hoje, dataAte: hoje };
    executarBuscaConsulta();
  });
}

// Navegação de Dias nos Filtros de Consulta
function ajustarDiasConsulta(inputId, delta) {
  const input = document.getElementById(inputId);
  if (!input) return;

  const valorAtual = input.value || obterDataHojeLocalISO();
  const [ano, mes, dia] = valorAtual.split('-').map(Number);
  const dataObj = new Date(ano, mes - 1, dia);

  dataObj.setDate(dataObj.getDate() + delta);

  const novoAno = dataObj.getFullYear();
  const novoMes = String(dataObj.getMonth() + 1).padStart(2, '0');
  const novoDia = String(dataObj.getDate()).padStart(2, '0');

  input.value = `${novoAno}-${novoMes}-${novoDia}`;

  if (inputId === 'consulta-data-de') {
    currentDateRange.dataDe = input.value;
  } else if (inputId === 'consulta-data-ate') {
    currentDateRange.dataAte = input.value;
  }

  executarBuscaConsulta();
}

const dePrevBtn = document.getElementById('consulta-data-de-prev');
const deNextBtn = document.getElementById('consulta-data-de-next');
const atePrevBtn = document.getElementById('consulta-data-ate-prev');
const ateNextBtn = document.getElementById('consulta-data-ate-next');

if (dePrevBtn) dePrevBtn.addEventListener('click', () => ajustarDiasConsulta('consulta-data-de', -1));
if (deNextBtn) deNextBtn.addEventListener('click', () => ajustarDiasConsulta('consulta-data-de', 1));
if (atePrevBtn) atePrevBtn.addEventListener('click', () => ajustarDiasConsulta('consulta-data-ate', -1));
if (ateNextBtn) ateNextBtn.addEventListener('click', () => ajustarDiasConsulta('consulta-data-ate', 1));

// Inicializa a aba Consulta ao clicar. Na primeira vez, define o range de
// datas padrao (hoje) antes de buscar; nas vezes seguintes so refaz a busca
// com os filtros atuais — sem isso, voltar pra aba depois de editar um
// pedido em Dados Pedido mostrava a tabela desatualizada (dados so em
// memoria da ultima busca).
const consultaTab = document.querySelector('[data-tab="consulta"]');
let consultaTabJaInicializada = false;
if (consultaTab) {
  consultaTab.addEventListener('click', () => {
    if (!consultaTabJaInicializada) {
      initConsultaFilters();
      consultaTabJaInicializada = true;
    }
    executarBuscaConsulta();
  });
}

// Indicadores
let indicadoresJaInicializado = false;
let indicadoresCarregando = false;
let indicadoresUltimoSnapshot = null;
let indicadoresTodosPedidos = [];

function obterMesAtualInput() {
  const hoje = new Date();
  return `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`;
}

function obterLimitesMesIndicadores(mesInput) {
  const [anoRaw, mesRaw] = String(mesInput || obterMesAtualInput()).split('-').map(Number);
  const ano = anoRaw || new Date().getFullYear();
  const mes = mesRaw || (new Date().getMonth() + 1);
  const inicio = `${ano}-${String(mes).padStart(2, '0')}-01`;
  const ultimoDia = new Date(ano, mes, 0).getDate();
  const fim = `${ano}-${String(mes).padStart(2, '0')}-${String(ultimoDia).padStart(2, '0')}`;
  return { ano, mes, inicio, fim, ultimoDia };
}

function obterNomeMesIndicadores(ano, mes) {
  return new Date(ano, mes - 1, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
}

function normalizarDataISOIndicador(valor) {
  if (!valor) return '';
  const texto = String(valor).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(texto)) return texto.slice(0, 10);
  if (/^\d{4}\/\d{2}\/\d{2}/.test(texto)) return texto.slice(0, 10).replace(/\//g, '-');
  if (/^\d{2}\/\d{2}\/\d{4}/.test(texto)) {
    const [dia, mes, ano] = texto.slice(0, 10).split('/');
    return `${ano}-${mes}-${dia}`;
  }
  if (/^\d{2}-\d{2}-\d{4}/.test(texto)) {
    const [dia, mes, ano] = texto.slice(0, 10).split('-');
    return `${ano}-${mes}-${dia}`;
  }
  if (/^\d{10,13}$/.test(texto)) {
    const numero = Number(texto);
    const ts = texto.length === 10 ? numero * 1000 : numero;
    const dataTs = new Date(ts);
    if (!Number.isNaN(dataTs.getTime())) {
      return `${dataTs.getFullYear()}-${String(dataTs.getMonth() + 1).padStart(2, '0')}-${String(dataTs.getDate()).padStart(2, '0')}`;
    }
  }
  const data = new Date(texto);
  if (Number.isNaN(data.getTime())) return '';
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, '0')}-${String(data.getDate()).padStart(2, '0')}`;
}

function obterHoraIndicador(pedido) {
  const hora = String(pedido?.hora || '').slice(0, 5);
  if (/^\d{2}:\d{2}$/.test(hora)) return hora;
  if (pedido?.updated_at) return extrairHora(pedido.updated_at);
  if (pedido?.created_at) return extrairHora(pedido.created_at);
  return '00:00';
}

function obterValorIndicador(pedido) {
  return obterComissaoPedido(pedido);
}

function mapearPedidoIndicador(pedido) {
  // Usa `data` como principal (mesma base da Consulta), com fallback para registros antigos.
  const dataISO = normalizarDataISOIndicador(
    pedido?.data
    || pedido?.DATA
    || pedido?.data_pedido
    || pedido?.DATA_PEDIDO
    || pedido?.updated_at
    || pedido?.created_at
  );
  const data = dataISO ? new Date(`${dataISO}T00:00:00`) : null;
  const statusOrigem = pedido?.status
    ?? pedido?.STATUS
    ?? pedido?.status_pedido
    ?? pedido?.STATUS_PEDIDO
    ?? pedido?.situacao
    ?? pedido?.SITUACAO
    ?? pedido?.etapa
    ?? pedido?.ETAPA;
  const status = normalizarStatus(statusOrigem);
  const versao = String(pedido?.versao || pedido?.certificado || '').trim();
  const uf = String(pedido?.uf || pedido?.estado || '').trim().toUpperCase().slice(0, 2);

  return {
    raw: pedido,
    pedido: pedido?.pedido || pedido?.id || '',
    dataISO,
    dia: data ? data.getDate() : 0,
    mes: data ? data.getMonth() + 1 : 0,
    ano: data ? data.getFullYear() : 0,
    hora: obterHoraIndicador(pedido),
    status,
    versao,
    uf,
    modalidade: String(pedido?.modalidade || pedido?.atendimento || '').trim().toLowerCase(),
    venda: pedido?.venda,
    valor: obterValorIndicador(pedido)
  };
}

function pedidosValidosIndicadores(pedidos) {
  return pedidos.filter((pedido) => normalizarStatus(pedido.status) === 'APROVADO');
}

function somarValoresIndicadores(pedidos) {
  return pedidos.reduce((total, pedido) => total + (Number(pedido.valor) || 0), 0);
}

function formatarMoedaIndicador(valor) {
  return `R$ ${formatarMoedaBR(valor)}`;
}

function carregarMetasIndicadores() {
  const chave = `companion-indicadores-metas:${currentUser?.email || 'local'}`;
  try {
    const salvo = JSON.parse(localStorage.getItem(chave) || '{}');
    return {
      semana: Number(salvo.semana) || 800,
      mes: Number(salvo.mes) || 4000
    };
  } catch {
    return { semana: 800, mes: 4000 };
  }
}

function agruparPorIndicador(lista, obterChave) {
  return lista.reduce((mapa, item) => {
    const chave = obterChave(item);
    if (!chave) return mapa;
    mapa.set(chave, (mapa.get(chave) || 0) + 1);
    return mapa;
  }, new Map());
}

function obterTopEntradaMapa(mapa) {
  let melhor = ['', 0];
  mapa.forEach((valor, chave) => {
    if (valor > melhor[1]) melhor = [chave, valor];
  });
  return melhor;
}

function renderizarKPIsIndicadores(container, resumo) {
  if (!container) return;
  const cards = [
    { label: 'Total do mês', value: formatarMoedaIndicador(resumo.totalMes), sub: `${resumo.validos.length} pedidos válidos`, color: 'rgba(10, 132, 255, 0.42)' },
    { label: 'Aprovados', value: String(resumo.aprovados.length), sub: `${resumo.taxaAprovacao.toFixed(0)}% de aprovação`, color: 'rgba(52, 199, 89, 0.42)' },
    { label: 'Ticket médio', value: formatarMoedaIndicador(resumo.ticketMedio), sub: 'por pedido válido', color: 'rgba(255, 149, 0, 0.42)' },
    { label: 'Melhor dia', value: resumo.melhorDiaLabel, sub: formatarMoedaIndicador(resumo.melhorDiaValor), color: 'rgba(175, 82, 222, 0.42)' }
  ];

  container.innerHTML = cards.map((card) => `
    <div class="indicador-kpi" style="--kpi-color:${card.color}">
      <div class="kpi-label">${escaparHtml(card.label)}</div>
      <div class="kpi-value">${escaparHtml(card.value)}</div>
      <div class="kpi-sub">${escaparHtml(card.sub)}</div>
    </div>
  `).join('');
}

function renderizarMetasIndicadores(resumo) {
  const container = document.getElementById('indicadores-meta-bars');
  const chip = document.getElementById('indicadores-meta-chip');
  if (!container) return;

  const metaSemana = Number(document.getElementById('indicadores-meta-semana')?.value) || 0;
  const metaMes = Number(document.getElementById('indicadores-meta-mes')?.value) || 0;
  const linhas = [];

  for (let semana = 1; semana <= 5; semana += 1) {
    const valor = resumo.valoresPorSemana[semana] || 0;
    const pct = metaSemana > 0 ? Math.min(100, (valor / metaSemana) * 100) : 0;
    linhas.push({ nome: `Semana ${semana}`, valor, meta: metaSemana, pct });
  }

  const pctMes = metaMes > 0 ? Math.min(100, (resumo.totalMes / metaMes) * 100) : 0;
  linhas.push({ nome: 'Mensal', valor: resumo.totalMes, meta: metaMes, pct: pctMes });

  container.innerHTML = linhas.map((linha) => `
    <div class="meta-row">
      <div class="meta-value">${formatarMoedaIndicador(linha.valor)}</div>
      <div class="meta-track" title="${escaparHtml(linha.nome)} | ${formatarMoedaIndicador(linha.valor)}">
        <div class="meta-fill" style="height:${linha.pct}%"></div>
      </div>
      <div class="meta-name">${escaparHtml(linha.nome)}</div>
    </div>
  `).join('');

  if (chip) {
    const falta = Math.max(0, metaMes - resumo.totalMes);
    chip.textContent = falta > 0 ? `Faltam ${formatarMoedaIndicador(falta)}` : 'Meta mensal batida';
  }
}

function renderizarEmptyChart(container, texto = 'Sem dados para o período') {
  if (!container) return;
  container.innerHTML = `<div class="chart-empty">${escaparHtml(texto)}</div>`;
}

function getRoundedBarPath(x, y, w, h, rxTop, rxBottom) {
  const r = Math.min(6, w / 2, h / 2);
  if (r <= 0) {
    return `M ${x} ${y} L ${x + w} ${y} L ${x + w} ${y + h} L ${x} ${y + h} Z`;
  }
  
  let path = `M ${x} ${y + (rxTop ? r : 0)}`;
  
  if (rxTop) {
    path += ` a ${r} ${r} 0 0 1 ${r} -${r}`;
  } else {
    path += ` L ${x} ${y}`;
  }
  
  path += ` L ${x + w - (rxTop ? r : 0)} ${y}`;
  
  if (rxTop) {
    path += ` a ${r} ${r} 0 0 1 ${r} ${r}`;
  } else {
    path += ` L ${x + w} ${y}`;
  }
  
  path += ` L ${x + w} ${y + h - (rxBottom ? r : 0)}`;
  
  if (rxBottom) {
    path += ` a ${r} ${r} 0 0 1 -${r} ${r}`;
  } else {
    path += ` L ${x + w} ${y + h}`;
  }
  
  path += ` L ${x + (rxBottom ? r : 0)} ${y + h}`;
  
  if (rxBottom) {
    path += ` a ${r} ${r} 0 0 1 -${r} -${r}`;
  } else {
    path += ` L ${x} ${y + h}`;
  }
  
  path += ' Z';
  return path;
}

let modoGraficoIndicadores = 'valor';
let ultimoResumoIndicadores = null;

function desenharGraficoUnificado(resumo) {
  const container = document.getElementById('indicadores-chart-dia');
  if (!container) return;
  
  if (!resumo) {
    renderizarEmptyChart(container);
    return;
  }
  
  // O valor máximo e valores diários devem incluir a soma de CPF + CNPJ + Vendas
  const valores = modoGraficoIndicadores === 'valor'
    ? resumo.valoresPorDia.map((_, idx) => (resumo.valoresPorDiaCNPJ[idx] || 0) + (resumo.valoresPorDiaCPF[idx] || 0) + (resumo.valoresPorDiaVenda[idx] || 0))
    : resumo.qtdPorDia.map((_, idx) => (resumo.qtdPorDiaCNPJ[idx] || 0) + (resumo.qtdPorDiaCPF[idx] || 0) + (resumo.qtdPorDiaVenda[idx] || 0));

  if (!valores.some((v) => v > 0)) {
    renderizarEmptyChart(container);
    return;
  }
  
  const largura = container.clientWidth || 760;
  const altura = 220;
  const margem = { top: 15, right: 20, bottom: 28, left: 20 };
  const plotW = largura - margem.left - margem.right;
  const plotH = altura - margem.top - margem.bottom;
  const maxValor = Math.max(...valores, 1);

  // 1. Encontra todos os índices dos dias com dados válidos no mês
  const diasComDados = [];
  valores.forEach((v, idx) => {
    if (v > 0) diasComDados.push(idx);
  });

  let minIdx = Math.min(...diasComDados);
  let maxIdx = Math.max(...diasComDados);

  // Fallback: se houver apenas 1 dia com dados, expande para os vizinhos
  if (minIdx === maxIdx) {
    minIdx = Math.max(0, minIdx - 1);
    maxIdx = Math.min(valores.length - 1, maxIdx + 1);
  }

  // Gera o subset de dias ativos entre a data mínima e máxima com dados
  const subsetDias = Array.from({ length: maxIdx - minIdx + 1 }, (_, i) => minIdx + i);
  const numDias = subsetDias.length;

  const slotW = plotW / Math.max(1, numDias);
  
  // Largura dinâmica proporcional ao número de dias exibidos
  const barW = Math.max(10, Math.min(30, slotW * 0.45));
  
  const barras = subsetDias.map((diaIdx, subIdx) => {
    const centerX = margem.left + (slotW * (subIdx + 0.5));
    const x = centerX - (barW / 2);
    
    // Obter dados dinamicamente com base no modo
    const isValor = modoGraficoIndicadores === 'valor';
    const vCNPJ = isValor ? (resumo.valoresPorDiaCNPJ[diaIdx] || 0) : (resumo.qtdPorDiaCNPJ[diaIdx] || 0);
    const vCPF = isValor ? (resumo.valoresPorDiaCPF[diaIdx] || 0) : (resumo.qtdPorDiaCPF[diaIdx] || 0);
    const vVenda = isValor ? (resumo.valoresPorDiaVenda[diaIdx] || 0) : (resumo.qtdPorDiaVenda[diaIdx] || 0);
    
    const hCNPJ = (vCNPJ / maxValor) * plotH;
    const hCPF = (vCPF / maxValor) * plotH;
    const hVenda = (vVenda / maxValor) * plotH;
    const totalDia = valores[diaIdx];
    let rects = [];
    let currentY = margem.top + plotH;
    
    // Gera o conteúdo do tooltip unificado (HTML estilizado) para este dia específico
    const tooltipHtml = `
      <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px; min-width: 140px;">
        <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 11px;">
          <span style="color: var(--ui-text-muted); font-weight: 500;">e-CPF:</span>
          <span style="color: var(--ui-blue); font-weight: 700;">${isValor ? formatarMoedaIndicador(vCPF) : vCPF}</span>
        </div>
        <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 11px;">
          <span style="color: var(--ui-text-muted); font-weight: 500;">e-CNPJ:</span>
          <span style="color: var(--ui-orange); font-weight: 700;">${isValor ? formatarMoedaIndicador(vCNPJ) : vCNPJ}</span>
        </div>
        <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 11px;">
          <span style="color: var(--ui-text-muted); font-weight: 500;">Vendas:</span>
          <span style="color: #10b981; font-weight: 700;">${isValor ? formatarMoedaIndicador(vVenda) : vVenda}</span>
        </div>
        <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 11px; margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--ui-border);">
          <span style="color: var(--ui-text); font-weight: 600;">Total do Dia:</span>
          <span style="color: var(--ui-text); font-weight: 700;">${isValor ? formatarMoedaIndicador(totalDia) : totalDia}</span>
        </div>
      </div>
    `.trim().replace(/\s+/g, ' ').replace(/"/g, '&quot;');

    // Determina quais barras estão ativas para este dia específico
    const activeBars = [];
    if (vCPF > 0) activeBars.push({ fill: 'var(--ui-blue)', h: hCPF });
    if (vCNPJ > 0) activeBars.push({ fill: 'var(--ui-orange)', h: hCNPJ });
    if (vVenda > 0) activeBars.push({ fill: '#10b981', h: hVenda });

    activeBars.forEach((bar, index) => {
      const hFinal = Math.max(1, bar.h);
      currentY -= hFinal;
      
      const rxTop = (index === activeBars.length - 1);
      const rxBottom = (index === 0);
      
      const pathD = getRoundedBarPath(x, currentY, barW, hFinal, rxTop, rxBottom);
      
      rects.push(`
        <path d="${pathD}" fill="${bar.fill}"
          data-tooltip-title="Dia ${diaIdx + 1} - Detalhes"
          data-tooltip-html="${tooltipHtml}">
        </path>
      `);
    });
    
    return rects.join('');
  }).join('');

  const labelsX = subsetDias.map((diaIdx, subIdx) => {
    const diaReal = diaIdx + 1;
    const x = margem.left + (slotW * (subIdx + 0.5));
    // Para manter excelente visualização em telas de todos os tamanhos:
    if (numDias > 15 && diaReal % 2 !== 0 && diaReal !== minIdx + 1 && diaReal !== maxIdx + 1) {
      return '';
    }
    return `<text x="${x.toFixed(1)}" y="${altura - 9}" fill="var(--ui-text-muted)" font-size="8.5px" font-weight="600" text-anchor="middle">${diaReal}</text>`;
  }).join('');
  
  // Geração inteligente de ticks para o Eixo Y
  let ticks = [];
  if (modoGraficoIndicadores === 'valor') {
    // Para valores financeiros, 5 divisões uniformes
    ticks = [0, 0.25, 0.5, 0.75, 1].map((pct) => pct * maxValor);
  } else {
    // Para quantidade de itens (inteiros)
    if (maxValor <= 4) {
      // Se a quantidade máxima for pequena (ex: 2), cria ticks discretos inteiros (0, 1, 2)
      for (let i = 0; i <= maxValor; i++) {
        ticks.push(i);
      }
    } else {
      // Se for maior, cria 5 subdivisões inteiras arredondadas para cima para evitar decimais
      const passo = Math.ceil(maxValor / 4);
      for (let i = 0; i <= 4; i++) {
        ticks.push(Math.min(maxValor, i * passo));
      }
      // Remove duplicados e ordena de forma crescente
      ticks = Array.from(new Set(ticks)).sort((a, b) => a - b);
    }
  }

  const ticksHTML = ticks.map((valorTick) => {
    const pct = maxValor > 0 ? valorTick / maxValor : 0;
    const y = margem.top + plotH - (pct * plotH);
    let labelText = '';
    
    if (modoGraficoIndicadores === 'valor') {
      if (valorTick === 0) {
        labelText = 'R$ 0';
      } else if (valorTick >= 1000) {
        labelText = `R$ ${(valorTick / 1000).toFixed(1)}k`;
      } else {
        labelText = `R$ ${valorTick.toFixed(0)}`;
      }
    } else {
      labelText = `${valorTick}`;
    }
    
    return `
      <g class="y-axis-tick">
        <line x1="${margem.left}" x2="${largura - margem.right}" y1="${y}" y2="${y}" stroke="var(--ui-border)" stroke-dasharray="3 3" />
      </g>
    `;
  }).join('');
  
  const legendaLegivel = `
    <g transform="translate(${largura - margem.right - 180}, 2)">
      <rect x="0" y="0" width="8" height="8" rx="1.5" fill="var(--ui-orange)" />
      <text x="12" y="8" fill="var(--ui-text-muted)" font-size="var(--ui-font-xs)" font-weight="600">e-CNPJ</text>
      
      <rect x="60" y="0" width="8" height="8" rx="1.5" fill="var(--ui-blue)" />
      <text x="72" y="8" fill="var(--ui-text-muted)" font-size="var(--ui-font-xs)" font-weight="600">CPF</text>
      
      <rect x="110" y="0" width="8" height="8" rx="1.5" fill="#10b981" />
      <text x="122" y="8" fill="var(--ui-text-muted)" font-size="var(--ui-font-xs)" font-weight="600">Venda</text>
    </g>
  `;
  
  container.innerHTML = `
    <svg class="indicador-svg" viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Estatísticas diárias">
      ${ticksHTML}
      ${barras}
      ${labelsX}
      ${legendaLegivel}
    </svg>
  `;
}

function renderizarGraficoDiasIndicadores(container, resumo) {
  ultimoResumoIndicadores = resumo;
  desenharGraficoUnificado(resumo);
}

function renderizarGraficoQtdDiasIndicadores(container, resumo) {
  // Mantida apenas para compatibilidade de chamadas herdadas
}

function renderizarGraficoHorariosIndicadores(container, resumo) {
  if (!container) return;
  const buckets = resumo.pedidosPorHora;
  const horasAtivas = Object.entries(buckets).filter(([, valor]) => valor > 0);
  if (!horasAtivas.length) {
    renderizarEmptyChart(container);
    return;
  }

  const horas = Array.from({ length: 14 }, (_, i) => i + 7);
  const max = Math.max(...horas.map((hora) => buckets[hora] || 0), 1);
  
  const largura = container.clientWidth || 760;
  const altura = 190;
  const margem = { top: 22, right: 24, bottom: 30, left: 24 };
  const plotW = largura - margem.left - margem.right;
  const plotH = altura - margem.top - margem.bottom;
  const passoX = plotW / Math.max(1, horas.length - 1);
  const barW = Math.max(8, (plotW / horas.length) * 0.55);

  const barras = horas.map((hora, index) => {
    const valor = buckets[hora] || 0;
    const h = (valor / max) * plotH;
    const x = margem.left + (index * passoX) - (barW / 2);
    const y = margem.top + plotH - h;
    const labelX = margem.left + (index * passoX);
    const labelHora = String(hora).padStart(2, '0');
    
    const hFinal = Math.max(4, h);
    const yFinal = margem.top + plotH - hFinal;

    return `
      <rect x="${x.toFixed(1)}" y="${yFinal.toFixed(1)}" width="${barW.toFixed(1)}" height="${hFinal.toFixed(1)}" rx="7" fill="var(--ui-blue)"
        data-tooltip-title="Atendimento às ${labelHora}:00"
        data-tooltip-value="${valor} atendimento${valor !== 1 ? 's' : ''}"
        data-tooltip-detail="Pedidos processados entre ${labelHora}:00 e ${String(hora + 1).padStart(2, '0')}:00"
        data-tooltip-color="var(--ui-blue)">
      </rect>
      <text x="${labelX.toFixed(1)}" y="${altura - 9}" fill="var(--ui-text-muted)" font-size="var(--ui-font-xs)" font-weight="500" text-anchor="middle">${labelHora}</text>
    `;
  }).join('');

  const grid = [0, 0.5, 1].map((pct) => {
    const y = margem.top + plotH - (pct * plotH);
    return `<line x1="${margem.left}" x2="${largura - margem.right}" y1="${y}" y2="${y}" stroke="var(--ui-border)" stroke-dasharray="3 3" />`;
  }).join('');

  container.innerHTML = `
    <svg class="indicador-svg" viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Picos de atendimento">
      ${grid}
      ${barras}
      <text x="${margem.left}" y="12" fill="var(--ui-text)" font-size="var(--ui-font-sm)" font-weight="600">Total por hora</text>
    </svg>
  `;
}

function desenharBarrasAnoMes(container, valores, ano, escalaMaxima = null) {
  if (!container) return;
  const largura = 760;
  const altura = 230; // Aumentado para 230px
  const margem = { top: 32, right: 8, bottom: 32, left: 8 };
  const plotW = largura - margem.left - margem.right;
  const plotH = altura - margem.top - margem.bottom;
  const maxValor = Math.max(Number(escalaMaxima) || 0, ...valores.total, 1);
  const barW = Math.max(8, (plotW / 12) * 0.55);
  const innerPlotW = plotW - barW;
  const passoX = innerPlotW / Math.max(1, 11);
  const labels = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

  const barras = Array.from({ length: 12 }, (_, index) => {
    const vCPF = valores.cpf[index] || 0;
    const vCNPJ = valores.cnpj[index] || 0;
    const vVenda = valores.venda[index] || 0;
    const totalMes = valores.total[index] || 0;

    const hCPF = (vCPF / maxValor) * plotH;
    const hCNPJ = (vCNPJ / maxValor) * plotH;
    const hVenda = (vVenda / maxValor) * plotH;

    const tooltipHtml = `
      <div style="display: flex; flex-direction: column; gap: 4px; margin-top: 4px; min-width: 140px;">
        <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 11px;">
          <span style="color: var(--ui-text-muted); font-weight: 500;">e-CPF:</span>
          <span style="color: var(--ui-blue); font-weight: 700;">${formatarMoedaIndicador(vCPF)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 11px;">
          <span style="color: var(--ui-text-muted); font-weight: 500;">e-CNPJ:</span>
          <span style="color: var(--ui-orange); font-weight: 700;">${formatarMoedaIndicador(vCNPJ)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 11px;">
          <span style="color: var(--ui-text-muted); font-weight: 500;">Vendas:</span>
          <span style="color: #10b981; font-weight: 700;">${formatarMoedaIndicador(vVenda)}</span>
        </div>
        <div style="display: flex; justify-content: space-between; gap: 12px; font-size: 11px; margin-top: 4px; padding-top: 4px; border-top: 1px dashed var(--ui-border);">
          <span style="color: var(--ui-text); font-weight: 600;">Total do Mês:</span>
          <span style="color: var(--ui-text); font-weight: 700;">${formatarMoedaIndicador(totalMes)}</span>
        </div>
      </div>
    `.trim().replace(/\s+/g, ' ').replace(/"/g, '&quot;');

    const activeBars = [];
    if (vCPF > 0) activeBars.push({ fill: 'var(--ui-blue)', h: hCPF });
    if (vCNPJ > 0) activeBars.push({ fill: 'var(--ui-orange)', h: hCNPJ });
    if (vVenda > 0) activeBars.push({ fill: '#10b981', h: hVenda });

    const x = margem.left + (index * passoX);
    const labelX = x + (barW / 2);
    let currentY = margem.top + plotH;
    let paths = [];

    activeBars.forEach((bar, bIdx) => {
      const hFinal = Math.max(1, bar.h);
      currentY -= hFinal;
      const rxTop = (bIdx === activeBars.length - 1);
      const rxBottom = (bIdx === 0);
      const pathD = getRoundedBarPath(x, currentY, barW, hFinal, rxTop, rxBottom);
      paths.push(`
        <path d="${pathD}" fill="${bar.fill}"
          data-tooltip-title="${['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'][index]} de ${ano}"
          data-tooltip-html="${tooltipHtml}">
        </path>
      `);
    });

    paths.push(`<text x="${labelX.toFixed(1)}" y="${altura - 8}" fill="var(--ui-text-muted)" font-size="var(--ui-font-xs)" font-weight="500" text-anchor="middle">${labels[index]}</text>`);

    return paths.join('');
  }).join('');

  const grid = [0, 0.5, 1].map((pct) => {
    const y = margem.top + plotH - (pct * plotH);
    return `<line x1="${margem.left}" x2="${largura - margem.right}" y1="${y}" y2="${y}" stroke="var(--ui-border)" stroke-dasharray="3 3" />`;
  }).join('');

  container.innerHTML = `
    <svg class="indicador-svg" viewBox="0 0 ${largura} ${altura}" role="img" aria-label="Comparativo mês a mês">
      ${grid}
      ${barras}
      <text x="${margem.left}" y="12" fill="var(--ui-text)" font-size="var(--ui-font-sm)" font-weight="600">Total mensal</text>
    </svg>
  `;
}

function renderizarGraficoMesesDinamico() {
  const container = document.getElementById('indicadores-chart-meses');
  if (!container) return;

  const btnTodos = document.getElementById('btn-comp-todos-anos');
  const mostrarTodos = btnTodos && btnTodos.classList.contains('active');

  const descontoPercent = parseNumeroMonetario(document.getElementById('config-desc-total')?.value ?? '20');
  const multiplicadorDesc = 1 - (descontoPercent / 100);

  // Filtra pedidos aprovados
  const pedidosAprovados = (indicadoresTodosPedidos || []).filter(p => normalizarStatus(p.status) === 'APROVADO');

  // Coleta os anos a serem exibidos
  let anosExibir = [];
  if (mostrarTodos) {
    anosExibir = Array.from(new Set(pedidosAprovados.map(p => p.ano).filter(Boolean))).sort((a, b) => a - b);
    if (anosExibir.length === 0) {
      anosExibir = [new Date().getFullYear()];
    }
  } else {
    // Ano selecionado no input
    const mesInput = document.getElementById('indicadores-mes');
    const limites = obterLimitesMesIndicadores(mesInput?.value || obterMesAtualInput());
    anosExibir = [limites.ano];
  }

  // Limpa o contêiner e inicializa a verificação de dados
  container.innerHTML = '';
  let temDadosQualquerAno = false;

  // Controla se exibe scrollbar com base no modo selecionado
  if (mostrarTodos) {
    container.style.setProperty('overflow-x', 'auto', 'important');
  } else {
    container.style.setProperty('overflow-x', 'hidden', 'important');
  }

  // Em "Todos os anos", usa uma escala unica para todas as colunas.
  let escalaGlobalTodosAnos = null;
  if (mostrarTodos) {
    const totaisMensaisTodosAnos = [];
    anosExibir.forEach((anoEscala) => {
      const totaisMesAnoEscala = Array.from({ length: 12 }, () => 0);
      const pedidosAnoEscala = pedidosAprovados.filter((p) => p.ano === anoEscala);

      pedidosAnoEscala.forEach((pedido) => {
        if (pedido.mes < 1 || pedido.mes > 12) return;

        let valorVenda = 0;
        if (ehVendaSim(pedido.venda)) {
          const porcVenda = parseNumeroMonetario(document.getElementById('config-porc-venda')?.value ?? '10');
          const precoCertificado = obterPrecoCertificado(pedido.raw);
          valorVenda = precoCertificado * (porcVenda / 100);
        }

        const valorDescontado = pedido.valor * multiplicadorDesc;
        totaisMesAnoEscala[pedido.mes - 1] += valorDescontado + valorVenda;
      });

      totaisMensaisTodosAnos.push(...totaisMesAnoEscala);
    });

    escalaGlobalTodosAnos = Math.max(1, ...totaisMensaisTodosAnos);
  }

  anosExibir.forEach(ano => {
    // Calcula comissão mês a mês para o ano segmentando por categorias
    const valoresCPF = Array.from({ length: 12 }, () => 0);
    const valoresCNPJ = Array.from({ length: 12 }, () => 0);
    const valoresVenda = Array.from({ length: 12 }, () => 0);
    const valoresTotal = Array.from({ length: 12 }, () => 0);

    const pedidosAno = pedidosAprovados.filter(p => p.ano === ano);

    pedidosAno.forEach(pedido => {
      if (pedido.mes >= 1 && pedido.mes <= 12) {
        let valorVenda = 0;
        if (ehVendaSim(pedido.venda)) {
          const porcVenda = parseNumeroMonetario(document.getElementById('config-porc-venda')?.value ?? '10');
          const precoCertificado = obterPrecoCertificado(pedido.raw);
          valorVenda = precoCertificado * (porcVenda / 100);
          valoresVenda[pedido.mes - 1] += valorVenda;
        }
        
        const valorDescontado = pedido.valor * multiplicadorDesc;
        const tipo = obterTipoCertificado(pedido.versao);
        if (tipo === 'CNPJ') {
          valoresCNPJ[pedido.mes - 1] += valorDescontado;
        } else if (tipo === 'CPF') {
          valoresCPF[pedido.mes - 1] += valorDescontado;
        } else {
          valoresCPF[pedido.mes - 1] += valorDescontado;
        }

        valoresTotal[pedido.mes - 1] += valorDescontado + valorVenda;
      }
    });

    const totalAno = valoresTotal.reduce((a, b) => a + b, 0);

    // Se "Todos" estiver selecionado, mantem todos os anos exibidos; apenas a escala do eixo Y e compartilhada
    temDadosQualquerAno = true;

    const anoRow = document.createElement('div');
    anoRow.className = 'year-chart-column';
    anoRow.style.padding = '4px 8px';

    if (mostrarTodos) {
      anoRow.style.flex = '0 0 760px';
      anoRow.style.width = '760px';
      anoRow.style.maxWidth = '760px';
      anoRow.style.borderRight = '1px dashed rgba(255, 255, 255, 0.08)';
      anoRow.style.paddingRight = '24px';
    } else {
      anoRow.style.flex = '1';
      anoRow.style.width = '100%';
      anoRow.style.maxWidth = '100%';
      anoRow.style.borderRight = 'none';
      anoRow.style.paddingRight = '8px';
    }

    anoRow.innerHTML = `
      <div style="font-size: 11px; font-weight: 700; color: var(--ui-text-soft); padding: 4px 6px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; border-left: 3px solid var(--ui-purple); padding-left: 8px;">
        <span>ANO ${ano}</span>
        <span style="color: var(--ui-purple); font-weight: 800;">${formatarMoedaIndicador(totalAno)}</span>
      </div>
      <div class="year-chart-bars-container" style="height: 230px; width: 100%;"></div>
    `;

    container.appendChild(anoRow);

    const barsContainer = anoRow.querySelector('.year-chart-bars-container');
    desenharBarrasAnoMes(
      barsContainer,
      { cpf: valoresCPF, cnpj: valoresCNPJ, venda: valoresVenda, total: valoresTotal },
      ano,
      escalaGlobalTodosAnos
    );
  });

  if (!temDadosQualquerAno) {
    renderizarEmptyChart(container, 'Sem dados acumulados para exibir');
  }
}

function renderizarGraficoMesesIndicadores(container, resumo) {
  renderizarGraficoMesesDinamico();
}

function renderizarDonutIndicadores(container, itens, cores) {
  if (!container) return;
  const entradas = itens.filter((item) => item.valor > 0);
  const total = entradas.reduce((acc, item) => acc + item.valor, 0);
  if (!total) {
    renderizarEmptyChart(container);
    return;
  }

  let acumulado = 0;
  const raio = 42;
  const circ = 2 * Math.PI * raio;
  const segmentos = entradas.map((item, index) => {
    const pct = item.valor / total;
    const dash = pct * circ;
    const gap = circ - dash;
    const offset = -acumulado * circ;
    acumulado += pct;
    return `<circle cx="58" cy="58" r="${raio}" fill="none" stroke="${cores[index % cores.length]}" stroke-width="11" stroke-dasharray="${dash} ${gap}" stroke-dashoffset="${offset}" transform="rotate(-90 58 58)" />`;
  }).join('');

  const legenda = entradas.map((item, index) => {
    const pct = ((item.valor / total) * 100).toFixed(1);
    const cor = cores[index % cores.length];
    return `
      <div class="donut-legend-item">
        <span class="legend-dot" style="background:${cor}; --dot-color:${cor}"></span>
        <span><strong>${escaparHtml(item.label)}</strong>: ${item.valor} (${pct}%)</span>
      </div>
    `;
  }).join('');

  container.innerHTML = `
    <div class="donut-wrap">
      <svg class="donut-svg" viewBox="0 0 116 116" aria-hidden="true">
        <circle cx="58" cy="58" r="${raio}" fill="none" stroke="var(--ui-border)" stroke-width="11" />
        ${segmentos}
        <text x="58" y="52" text-anchor="middle" fill="var(--ui-text-muted)" font-size="8" font-weight="600" letter-spacing="0.5">TOTAL</text>
        <text x="58" y="69" text-anchor="middle" fill="var(--ui-text)" font-size="16" font-weight="700">${total}</text>
      </svg>
      <div class="donut-legend">${legenda}</div>
    </div>
  `;
}

function montarResumoIndicadores(pedidosMes, pedidosAno, limites) {
  const todosMes = pedidosMes || [];
  const aprovados = todosMes.filter((pedido) => normalizarStatus(pedido.status) === 'APROVADO');
  const validos = aprovados; // A análise de valores e vendas é estritamente sobre pedidos aprovados
  
  const descontoPercent = parseNumeroMonetario(document.getElementById('config-desc-total')?.value ?? '20');
  const multiplicadorDesc = 1 - (descontoPercent / 100);

  const valoresPorDia = Array.from({ length: limites.ultimoDia }, () => 0);
  const valoresPorDiaCNPJ = Array.from({ length: limites.ultimoDia }, () => 0);
  const valoresPorDiaCPF = Array.from({ length: limites.ultimoDia }, () => 0);
  const valoresPorDiaOutros = Array.from({ length: limites.ultimoDia }, () => 0);
  const valoresPorDiaVenda = Array.from({ length: limites.ultimoDia }, () => 0);
  const qtdPorDia = Array.from({ length: limites.ultimoDia }, () => 0);
  const qtdPorDiaCNPJ = Array.from({ length: limites.ultimoDia }, () => 0);
  const qtdPorDiaCPF = Array.from({ length: limites.ultimoDia }, () => 0);
  const qtdPorDiaOutros = Array.from({ length: limites.ultimoDia }, () => 0);
  const qtdPorDiaVenda = Array.from({ length: limites.ultimoDia }, () => 0);
  const valoresPorSemana = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  const pedidosPorHora = {};

  validos.forEach((pedido) => {
    let valorVenda = 0;
    const ehVenda = ehVendaSim(pedido.venda);
    const valorDescontado = pedido.valor * multiplicadorDesc;

    if (pedido.dia >= 1 && pedido.dia <= limites.ultimoDia) {
      if (ehVenda) {
        qtdPorDia[pedido.dia - 1] += 1;
        qtdPorDiaVenda[pedido.dia - 1] += 1;
        
        // Comissão da venda (com base no preço do certificado completo)
        const porcVenda = parseNumeroMonetario(document.getElementById('config-porc-venda')?.value ?? '10');
        const precoCertificado = obterPrecoCertificado(pedido.raw);
        valorVenda = precoCertificado * (porcVenda / 100);
        valoresPorDiaVenda[pedido.dia - 1] += valorVenda;
      }

      valoresPorDia[pedido.dia - 1] += valorDescontado + valorVenda;

      const tipo = obterTipoCertificado(pedido.versao);
      if (tipo === 'CNPJ') {
        valoresPorDiaCNPJ[pedido.dia - 1] += valorDescontado;
        qtdPorDiaCNPJ[pedido.dia - 1] += 1;
      } else if (tipo === 'CPF') {
        valoresPorDiaCPF[pedido.dia - 1] += valorDescontado;
        qtdPorDiaCPF[pedido.dia - 1] += 1;
      } else {
        valoresPorDiaOutros[pedido.dia - 1] += valorDescontado;
        qtdPorDiaOutros[pedido.dia - 1] += 1;
      }

      const diaSemanaPrimeiro = new Date(limites.ano, limites.mes - 1, 1).getDay();
      const semana = Math.min(5, Math.ceil((pedido.dia + diaSemanaPrimeiro) / 7));
      valoresPorSemana[semana] += valorDescontado + valorVenda;
    }
    const hora = Number(String(pedido.hora || '00:00').slice(0, 2)) || 0;
    pedidosPorHora[hora] = (pedidosPorHora[hora] || 0) + 1;
  });

  const totalMes = valoresPorDia.reduce((a, b) => a + b, 0);
  const ticketMedio = validos.length ? totalMes / validos.length : 0;
  const taxaAprovacao = todosMes.length ? (aprovados.length / todosMes.length) * 100 : 0;

  const valoresPorMesAno = Array.from({ length: 12 }, () => 0);
  const aprovadosAno = (pedidosAno || []).filter((pedido) => normalizarStatus(pedido.status) === 'APROVADO');
  aprovadosAno.forEach((pedido) => {
    if (pedido.mes >= 1 && pedido.mes <= 12) {
      let valorVenda = 0;
      if (ehVendaSim(pedido.venda)) {
        const porcVenda = parseNumeroMonetario(document.getElementById('config-porc-venda')?.value ?? '10');
        const precoCertificado = obterPrecoCertificado(pedido.raw);
        valorVenda = precoCertificado * (porcVenda / 100);
      }
      const valorDescontado = pedido.valor * multiplicadorDesc;
      valoresPorMesAno[pedido.mes - 1] += valorDescontado + valorVenda;
    }
  });

  const porUF = agruparPorIndicador(validos, (pedido) => pedido.uf || '');
  const porValorDia = new Map(valoresPorDia.map((valor, index) => [index + 1, valor]));
  const [melhorDia, melhorDiaValor] = obterTopEntradaMapa(porValorDia);
  const [melhorHora, melhorHoraTotal] = obterTopEntradaMapa(new Map(Object.entries(pedidosPorHora)));
  const [topUF, topUFQtd] = obterTopEntradaMapa(porUF);

  return {
    validos,
    aprovados,
    totalMes,
    ticketMedio,
    taxaAprovacao,
    valoresPorDia,
    valoresPorDiaCNPJ,
    valoresPorDiaCPF,
    valoresPorDiaOutros,
    valoresPorDiaVenda,
    qtdPorDia,
    qtdPorDiaCNPJ,
    qtdPorDiaCPF,
    qtdPorDiaOutros,
    qtdPorDiaVenda,
    valoresPorSemana,
    pedidosPorHora,
    valoresPorMesAno,
    porUF,
    melhorDiaLabel: melhorDiaValor > 0 ? `Dia ${melhorDia}` : '-',
    melhorDiaValor,
    melhorHora: melhorHoraTotal > 0 ? `${String(melhorHora).padStart(2, '0')}:00` : '-',
    melhorHoraTotal,
    topUF,
    topUFQtd
  };
}

function renderizarStoryIndicadores(resumo, limites) {
  const storyList = document.getElementById('indicadores-story-list');
  const nomeMes = obterNomeMesIndicadores(limites.ano, limites.mes);
  const metaMes = Number(document.getElementById('indicadores-meta-mes')?.value) || 0;
  const faltaMeta = Math.max(0, metaMes - resumo.totalMes);
  const pctMeta = metaMes > 0 ? (resumo.totalMes / metaMes) * 100 : 0;

  if (!storyList) return;

  const tendenciaMeses = resumo.valoresPorMesAno[limites.mes - 1] - (resumo.valoresPorMesAno[limites.mes - 2] || 0);
  const tendenciaTexto = tendenciaMeses >= 0
    ? `cresceu ${formatarMoedaIndicador(tendenciaMeses)} contra o mês anterior`
    : `caiu ${formatarMoedaIndicador(Math.abs(tendenciaMeses))} contra o mês anterior`;

  const itens = [
    `<strong>Meta:</strong> ${pctMeta.toFixed(0)}% da meta mensal. ${faltaMeta > 0 ? `Faltam ${formatarMoedaIndicador(faltaMeta)}.` : 'Meta batida, agora é ampliar margem.'}`,
    `<strong>Pico operacional:</strong> ${resumo.melhorHora !== '-' ? `${resumo.melhorHora} concentrou ${resumo.melhorHoraTotal} atendimentos.` : 'ainda não há horário dominante.'}`,
    `<strong>Geografia:</strong> ${resumo.topUF ? `${resumo.topUF} lidera com ${resumo.topUFQtd} certificados.` : 'nenhum estado informado nos pedidos do período.'}`,
    `<strong>Comparativo:</strong> ${nomeMes} ${tendenciaTexto}.`,
    `<strong>Melhor dia:</strong> ${resumo.melhorDiaLabel !== '-' ? `${resumo.melhorDiaLabel} gerou ${formatarMoedaIndicador(resumo.melhorDiaValor)}.` : 'sem produção registrada.'}`
  ];

  storyList.innerHTML = itens.map((item) => `<div class="story-item">${item}</div>`).join('');
}

function renderizarIndicadoresUltimoSnapshot() {
  if (!indicadoresUltimoSnapshot) return;
  renderizarIndicadores(indicadoresUltimoSnapshot.pedidosMes, indicadoresUltimoSnapshot.pedidosAno, indicadoresUltimoSnapshot.limites);
}

// Redesenha os gráficos de forma responsiva ao redimensionar a janela
window.addEventListener('resize', () => {
  if (typeof renderizarIndicadoresUltimoSnapshot === 'function') {
    renderizarIndicadoresUltimoSnapshot();
  }
});

function renderizarIndicadores(pedidosMes, pedidosAno, limites) {
  const resumo = montarResumoIndicadores(pedidosMes, pedidosAno, limites);
  renderizarKPIsIndicadores(document.getElementById('indicadores-kpis'), resumo);
  renderizarMetasIndicadores(resumo);
  renderizarStoryIndicadores(resumo, limites);
  renderizarGraficoDiasIndicadores(document.getElementById('indicadores-chart-dia'), resumo);
  renderizarGraficoQtdDiasIndicadores(document.getElementById('indicadores-chart-qtd-dia'), resumo);
  renderizarGraficoHorariosIndicadores(document.getElementById('indicadores-chart-horarios'), resumo);
  renderizarGraficoMesesIndicadores(document.getElementById('indicadores-chart-meses'), resumo);

  const porCertificado = agruparPorIndicador(resumo.validos, (pedido) => {
    const tipo = obterTipoCertificado(pedido.versao);
    if (tipo === 'CNPJ') return 'CNPJ';
    if (tipo === 'CPF') return 'CPF';
    return 'Outros';
  });
  const porAtendimento = agruparPorIndicador(resumo.validos, (pedido) => {
    if (pedido.modalidade.includes('pres')) return 'Presencial';
    if (pedido.modalidade.includes('video') || pedido.modalidade.includes('vídeo')) return 'Vídeo';
    return 'Não informado';
  });
  const porVersao = agruparPorIndicador(resumo.validos, (pedido) => {
    const texto = pedido.versao.toUpperCase();
    if (texto.includes('A3') || texto.includes('TOKEN')) return 'A3';
    if (texto.includes('A1') || texto.includes('NUVEM')) return 'A1';
    return 'Outros';
  });
  const porStatus = agruparPorIndicador(pedidosMes, (pedido) => getStatusLabel(pedido.status));

  renderizarDonutIndicadores(document.getElementById('indicadores-donut-certificado'), Array.from(porCertificado.entries()).map(([label, valor]) => ({ label, valor })), ['#3b82f6', '#10b981', '#64748b']);
  renderizarDonutIndicadores(document.getElementById('indicadores-donut-atendimento'), Array.from(porAtendimento.entries()).map(([label, valor]) => ({ label, valor })), ['#06b6d4', '#8b5cf6', '#64748b']);
  renderizarDonutIndicadores(document.getElementById('indicadores-donut-versao'), Array.from(porVersao.entries()).map(([label, valor]) => ({ label, valor })), ['#f59e0b', '#6366f1', '#64748b']);
  renderizarDonutIndicadores(document.getElementById('indicadores-donut-status'), Array.from(porStatus.entries()).map(([label, valor]) => ({ label, valor })), ['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981']);
}

function exibirSkeletonsIndicadores() {
  const kpis = document.getElementById('indicadores-kpis');
  const metas = document.getElementById('indicadores-meta-bars');
  const chartDia = document.getElementById('indicadores-chart-dia');
  const chartMeses = document.getElementById('indicadores-chart-meses');
  const chartHorarios = document.getElementById('indicadores-chart-horarios');
  const donutCert = document.getElementById('indicadores-donut-certificado');
  const donutAtend = document.getElementById('indicadores-donut-atendimento');
  const donutVersao = document.getElementById('indicadores-donut-versao');
  const donutStatus = document.getElementById('indicadores-donut-status');
  const storyList = document.getElementById('indicadores-story-list');

  if (kpis) {
    kpis.innerHTML = Array.from({ length: 4 }).map(() => `
      <div class="indicador-kpi skeleton-kpi" style="--kpi-color: rgba(255, 255, 255, 0.08)">
        <div class="skeleton-block skeleton-shimmer" style="width: 50%; height: 12px; margin-bottom: 8px;"></div>
        <div class="skeleton-block skeleton-shimmer" style="width: 80%; height: 24px; margin-bottom: 8px;"></div>
        <div class="skeleton-block skeleton-shimmer" style="width: 40%; height: 10px;"></div>
      </div>
    `).join('');
  }

  if (metas) {
    metas.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px; width: 100%; padding: 8px 0;">
        ${Array.from({ length: 6 }).map(() => `
          <div style="display: flex; align-items: center; gap: 12px; width: 100%;">
            <div class="skeleton-block skeleton-shimmer" style="width: 70px; height: 12px; flex-shrink: 0;"></div>
            <div class="skeleton-block skeleton-shimmer" style="flex: 1; height: 10px;"></div>
            <div class="skeleton-block skeleton-shimmer" style="width: 50px; height: 12px; flex-shrink: 0;"></div>
          </div>
        `).join('')}
      </div>
    `;
  }

  const skeletonBarChart = `
    <div style="display: flex; flex-direction: column; gap: 8px; width: 100%; height: 100%; justify-content: flex-end; padding: 16px 12px 10px 12px; box-sizing: border-box;">
      <div style="display: flex; align-items: flex-end; justify-content: space-between; height: 130px; width: 100%; gap: 10px;">
        ${Array.from({ length: 15 }).map((_, idx) => {
          const heights = [30, 45, 60, 40, 75, 50, 65, 35, 80, 55, 70, 45, 60, 30, 50];
          const h = heights[idx % heights.length];
          return `<div class="skeleton-block skeleton-shimmer" style="width: 5%; height: ${h}%; border-radius: 4px;"></div>`;
        }).join('')}
      </div>
      <div style="display: flex; justify-content: space-between; width: 100%; padding-top: 4px;">
        ${Array.from({ length: 6 }).map(() => `<div class="skeleton-block skeleton-shimmer" style="width: 30px; height: 10px;"></div>`).join('')}
      </div>
    </div>
  `;

  if (chartDia) chartDia.innerHTML = skeletonBarChart;
  if (chartMeses) chartMeses.innerHTML = skeletonBarChart;
  if (chartHorarios) chartHorarios.innerHTML = skeletonBarChart;

  const skeletonDonut = `
    <div style="display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; gap: 16px; padding: 12px; box-sizing: border-box;">
      <div class="skeleton-block skeleton-shimmer" style="width: 76px; height: 76px; border-radius: 50%; flex-shrink: 0;"></div>
      <div style="display: flex; flex-direction: column; gap: 8px; flex: 1;">
        <div class="skeleton-block skeleton-shimmer" style="width: 80%; height: 10px;"></div>
        <div class="skeleton-block skeleton-shimmer" style="width: 60%; height: 10px;"></div>
        <div class="skeleton-block skeleton-shimmer" style="width: 70%; height: 10px;"></div>
      </div>
    </div>
  `;

  if (donutCert) donutCert.innerHTML = skeletonDonut;
  if (donutAtend) donutAtend.innerHTML = skeletonDonut;
  if (donutVersao) donutVersao.innerHTML = skeletonDonut;
  if (donutStatus) donutStatus.innerHTML = skeletonDonut;

  if (storyList) {
    storyList.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 12px; padding: 10px; box-sizing: border-box; width: 100%;">
        <div class="skeleton-block skeleton-shimmer" style="width: 95%; height: 12px;"></div>
        <div class="skeleton-block skeleton-shimmer" style="width: 85%; height: 12px;"></div>
        <div class="skeleton-block skeleton-shimmer" style="width: 90%; height: 12px;"></div>
        <div class="skeleton-block skeleton-shimmer" style="width: 80%; height: 12px;"></div>
      </div>
    `;
  }
}

// Colunas que os indicadores realmente consomem (ver mapearPedidoIndicador e
// deduplicarPedidosMaisRecentes). A tabela tem 40+ colunas, quase todas de dados
// pessoais que nao entram em nenhum grafico — trazer '*' de todo o historico era
// o grosso do tempo de espera desta aba.
const COLUNAS_INDICADORES =
  'id,pedido,data,hora,status,versao,certificado,uf,modalidade,venda,comissao,preco_certificado';

// 'reaproveitarCache' evita ir ao banco quando so mudou o mes selecionado: o
// historico completo ja esta em memoria e o recorte e feito por filtro.
async function carregarIndicadores({ reaproveitarCache = false } = {}) {
  if (indicadoresCarregando) return;
  indicadoresCarregando = true;

  const mesInput = document.getElementById('indicadores-mes');
  const mesPrevBtn = document.getElementById('indicadores-mes-prev');
  const mesNextBtn = document.getElementById('indicadores-mes-next');

  if (mesInput) mesInput.disabled = true;
  if (mesPrevBtn) mesPrevBtn.disabled = true;
  if (mesNextBtn) mesNextBtn.disabled = true;

  const limites = obterLimitesMesIndicadores(mesInput?.value || obterMesAtualInput());
  if (mesInput && !mesInput.value) mesInput.value = `${limites.ano}-${String(limites.mes).padStart(2, '0')}`;

  const atualizarBtn = document.getElementById('indicadores-atualizar');
  if (atualizarBtn) atualizarBtn.disabled = true;

  // Trocar de mês só recorta o que já está em memória — sem skeleton, sem rede.
  const usarCache = reaproveitarCache && Array.isArray(indicadoresTodosPedidos) && indicadoresTodosPedidos.length > 0;
  if (!usarCache) exibirSkeletonsIndicadores();

  try {
    let todosMapped;

    if (usarCache) {
      todosMapped = indicadoresTodosPedidos;
    } else {
      // Mesma origem da aba Consulta, com paginação para incluir dados antigos.
      const todosPedidos = [];
      const tamanhoLote = 1000;
      const maxPaginas = 200;
      let offset = 0;

      for (let pagina = 0; pagina < maxPaginas; pagina += 1) {
        const resultado = await window.electronAPI.buscarPedidos({
          usuario: currentUser?.email || undefined,
          colunas: COLUNAS_INDICADORES,
          limit: tamanhoLote,
          offset
        });

        if (!resultado?.success) {
          throw new Error(resultado?.error || 'Falha ao buscar pedidos para indicadores');
        }

        const lote = Array.isArray(resultado.data) ? resultado.data : [];
        if (lote.length === 0) break;

        todosPedidos.push(...lote);
        if (lote.length < tamanhoLote) break;
        offset += lote.length;
      }

      const todosDeduplicados = deduplicarPedidosMaisRecentes(todosPedidos);
      todosMapped = todosDeduplicados.map(mapearPedidoIndicador);
      indicadoresTodosPedidos = todosMapped;
    }

    // Filtra em memória os pedidos do mês e do ano selecionado
    const pedidosMes = todosMapped.filter((p) => p.dataISO >= limites.inicio && p.dataISO <= limites.fim);
    const pedidosAno = todosMapped.filter((p) => p.ano === limites.ano);

    indicadoresUltimoSnapshot = { pedidosMes, pedidosAno, limites };
    renderizarIndicadores(pedidosMes, pedidosAno, limites);
  } catch (error) {
    console.error('Erro ao carregar indicadores:', error);
    ['indicadores-chart-dia', 'indicadores-chart-qtd-dia', 'indicadores-chart-horarios', 'indicadores-chart-meses'].forEach((id) => {
      renderizarEmptyChart(document.getElementById(id), 'Erro ao carregar indicadores');
    });
  } finally {
    if (atualizarBtn) atualizarBtn.disabled = false;
    if (mesInput) mesInput.disabled = false;
    if (mesPrevBtn) mesPrevBtn.disabled = false;
    if (mesNextBtn) mesNextBtn.disabled = false;
    indicadoresCarregando = false;
  }
}

function salvarMetasIndicadores() {
  const metaSemana = Number(document.getElementById('indicadores-meta-semana')?.value) || 0;
  const metaMes = Number(document.getElementById('indicadores-meta-mes')?.value) || 0;
  const chave = `companion-indicadores-metas:${currentUser?.email || 'local'}`;
  localStorage.setItem(chave, JSON.stringify({ semana: metaSemana, mes: metaMes }));
  renderizarIndicadoresUltimoSnapshot();
  if (window.toastNotifier) {
    window.toastNotifier.success('Metas salvas com sucesso.');
  }
}

function inicializarIndicadores() {
  const mesInput = document.getElementById('indicadores-mes');
  const metaSemana = document.getElementById('indicadores-meta-semana');
  const metaMes = document.getElementById('indicadores-meta-mes');
  const salvarMetaBtn = document.getElementById('indicadores-salvar-meta');
  const atualizarBtn = document.getElementById('indicadores-atualizar');
  const metas = carregarMetasIndicadores();

  if (mesInput && !mesInput.value) mesInput.value = obterMesAtualInput();
  if (metaSemana) metaSemana.value = metas.semana;
  if (metaMes) metaMes.value = metas.mes;

  // Mudar o mês é só um recorte do histórico que já está carregado; o botão
  // "atualizar" continua indo ao banco.
  mesInput?.addEventListener('change', () => carregarIndicadores({ reaproveitarCache: true }));
  metaSemana?.addEventListener('input', renderizarIndicadoresUltimoSnapshot);
  metaMes?.addEventListener('input', renderizarIndicadoresUltimoSnapshot);
  salvarMetaBtn?.addEventListener('click', salvarMetasIndicadores);
  atualizarBtn?.addEventListener('click', carregarIndicadores);

  const btnCompAnoSel = document.getElementById('btn-comp-ano-sel');
  const btnCompTodosAnos = document.getElementById('btn-comp-todos-anos');
  
  btnCompAnoSel?.addEventListener('click', () => {
    btnCompAnoSel.classList.add('active');
    btnCompTodosAnos?.classList.remove('active');
    renderizarGraficoMesesDinamico();
  });

  btnCompTodosAnos?.addEventListener('click', () => {
    btnCompTodosAnos.classList.add('active');
    btnCompAnoSel?.classList.remove('active');
    renderizarGraficoMesesDinamico();
  });

  // Navegação do Seletor Mensal ("Slider")
  const mesPrevBtn = document.getElementById('indicadores-mes-prev');
  const mesNextBtn = document.getElementById('indicadores-mes-next');

  if (mesPrevBtn && mesNextBtn && mesInput) {
    mesPrevBtn.onclick = () => {
      if (!mesInput.value) mesInput.value = obterMesAtualInput();
      const [ano, mes] = mesInput.value.split('-').map(Number);
      const novaData = new Date(ano, mes - 2, 1);
      mesInput.value = `${novaData.getFullYear()}-${String(novaData.getMonth() + 1).padStart(2, '0')}`;
      mesInput.dispatchEvent(new Event('change'));
    };

    mesNextBtn.onclick = () => {
      if (!mesInput.value) mesInput.value = obterMesAtualInput();
      const [ano, mes] = mesInput.value.split('-').map(Number);
      const novaData = new Date(ano, mes, 1);
      mesInput.value = `${novaData.getFullYear()}-${String(novaData.getMonth() + 1).padStart(2, '0')}`;
      mesInput.dispatchEvent(new Event('change'));
    };
  }

  // Inicializa o Tooltip Customizado para Gráficos
  let tooltip = document.getElementById('chart-tooltip');
  if (!tooltip) {
    tooltip = document.createElement('div');
    tooltip.id = 'chart-tooltip';
    tooltip.className = 'chart-tooltip';
    document.body.appendChild(tooltip);
  }

  document.body.onmouseover = (e) => {
    const target = e.target.closest('[data-tooltip-title]');
    if (!target) return;

    const title = target.getAttribute('data-tooltip-title');
    const htmlContent = target.getAttribute('data-tooltip-html');
    let newContent = '';

    if (htmlContent) {
      newContent = `
        <div class="chart-tooltip-title">${title}</div>
        ${htmlContent}
      `;
    } else {
      const value = target.getAttribute('data-tooltip-value');
      const detail = target.getAttribute('data-tooltip-detail');
      const color = target.getAttribute('data-tooltip-color') || 'var(--ui-blue)';

      newContent = `
        <div class="chart-tooltip-title">${title}</div>
        <div class="chart-tooltip-value" style="color: ${color}">${value}</div>
        ${detail ? `<div class="chart-tooltip-detail">${detail}</div>` : ''}
      `;
    }

    if (tooltip.innerHTML !== newContent) {
      tooltip.innerHTML = newContent;
    }
    tooltip.classList.add('visible');
  };

  document.body.onmousemove = (e) => {
    if (!tooltip.classList.contains('visible')) return;
    
    // Margem de offset para não colar no ponteiro
    tooltip.style.left = `${e.pageX}px`;
    tooltip.style.top = `${e.pageY}px`;
  };

  document.body.onmouseout = (e) => {
    const target = e.target.closest('[data-tooltip-title]');
    if (target) {
      const related = e.relatedTarget ? e.relatedTarget.closest('[data-tooltip-title]') : null;
      if (!related || related.getAttribute('data-tooltip-title') !== target.getAttribute('data-tooltip-title')) {
        tooltip.classList.remove('visible');
      }
    }
  };

  const toggleValorBtn = document.getElementById('chart-toggle-valor');
  const toggleQtdBtn = document.getElementById('chart-toggle-qtd');
  
  if (toggleValorBtn && toggleQtdBtn) {
    toggleValorBtn.addEventListener('click', () => {
      if (modoGraficoIndicadores === 'valor') return;
      modoGraficoIndicadores = 'valor';
      toggleValorBtn.classList.add('active');
      toggleQtdBtn.classList.remove('active');
      
      const label = document.getElementById('indicador-label-dinamico');
      const subtitulo = document.getElementById('indicador-subtitulo-dinamico');
      if (label) label.textContent = 'VALORES POR DIA';
      if (subtitulo) subtitulo.textContent = 'Linha do mês';
      
      desenharGraficoUnificado(ultimoResumoIndicadores);
    });
    
    toggleQtdBtn.addEventListener('click', () => {
      if (modoGraficoIndicadores === 'qtd') return;
      modoGraficoIndicadores = 'qtd';
      toggleQtdBtn.classList.add('active');
      toggleValorBtn.classList.remove('active');
      
      const label = document.getElementById('indicador-label-dinamico');
      const subtitulo = document.getElementById('indicador-subtitulo-dinamico');
      if (label) label.textContent = 'VENDAS POR DIA';
      if (subtitulo) subtitulo.textContent = 'Quantidade de vendas';
      
      desenharGraficoUnificado(ultimoResumoIndicadores);
    });
  }
}

const indicadoresTab = document.querySelector('[data-tab="indicadores"]');
if (indicadoresTab) {
  indicadoresTab.addEventListener('click', () => {
    if (!indicadoresJaInicializado) {
      inicializarIndicadores();
      indicadoresJaInicializado = true;
    }
    carregarIndicadores();
  });
}

const pedidoNumeroInput = document.getElementById('pedido-numero-input');
const folderPedidoBtn = document.getElementById('folder-pedido-btn');
const configPastaInput = document.getElementById('config-pasta');
const configPastaClienteInput = document.getElementById('config-pasta-cliente');
const configFolderBtn = document.getElementById('config-folder-btn');

function atualizarTituloAbaPedidoAtiva(numeroPedidoInformado) {
  const activeTab = pedidoTabs.find((t) => t.id === activePedidoTabId);
  if (!activeTab) return;

  const numeroPedido = String(
    numeroPedidoInformado !== undefined
      ? numeroPedidoInformado
      : (pedidoNumeroInput?.value || '')
  ).trim();

  if (!activeTab.data) activeTab.data = {};
  activeTab.data.pedido = numeroPedido;

  const tabTitleEl = document.querySelector(`.pedido-tab[data-tab-id="${activeTab.id}"] .tab-title`) ||
                     document.querySelector('.pedido-tab.active .tab-title');
  if (tabTitleEl) {
    tabTitleEl.textContent = numeroPedido || activeTab.number || 'Novo Pedido';
  }
}

// =============================================
// ANEXOS - dropzone, previews e gerenciamento
// =============================================

(function initAttachments() {
  const dropzone = document.getElementById('dropzone');
  const attachmentsInput = document.getElementById('attachments-input');
  const attachBtn = document.getElementById('attach-btn');
  const previewList = document.getElementById('preview-list');
  const screenshotBtn = document.getElementById('pedido-screenshot-btn');
  let attachments = [];

  console.log('Iniciando sistema de anexos...');
  console.log('Dropzone encontrado:', !!dropzone);
  console.log('Attachments input encontrado:', !!attachmentsInput);
  console.log('Attach btn encontrado:', !!attachBtn);
  console.log('Preview list encontrado:', !!previewList);

  if (!dropzone || !attachmentsInput || !previewList) {
    return;
  }

  function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

  async function obterUsuarioAnexo() {
    if (currentUser?.email) return currentUser;

    try {
      const user = await window.electronAPI.getCurrentUser();
      if (user?.email) {
        currentUser = user;
        return currentUser;
      }
    } catch (error) {
      console.error('Erro ao buscar usuário para anexo:', error);
    }

    try {
      const storedUser = JSON.parse(localStorage.getItem('user') || 'null');
      if (storedUser?.email) {
        currentUser = storedUser;
        return currentUser;
      }
    } catch (error) {
      console.error('Erro ao ler usuário salvo para anexo:', error);
    }

    return null;
  }


  ['dragenter','dragover','dragleave','drop'].forEach(evt => dropzone.addEventListener(evt, preventDefaults));
  ['dragenter','dragover'].forEach(evt => dropzone.addEventListener(evt, () => {
    console.log('Dragover event detectado');
    dropzone.classList.add('dragover');
  }));
  ['dragleave','drop'].forEach(evt => dropzone.addEventListener(evt, () => dropzone.classList.remove('dragover')));

  dropzone.addEventListener('drop', (e) => {
    console.log('Drop event detectado, arquivos:', e.dataTransfer?.files?.length);
    const dt = e.dataTransfer;
    const files = dt?.files || [];
    handleFiles(files);
  });

  dropzone.addEventListener('click', () => {
    console.log('Dropzone clicado');
    attachmentsInput.click();
  });
  dropzone.addEventListener('keydown', (e) => { 
    if (e.key === 'Enter' || e.key === ' ') { 
      console.log('Tecla Enter/Space no dropzone');
      e.preventDefault(); 
      attachmentsInput.click(); 
    } 
  });

  if (attachBtn) attachBtn.addEventListener('click', (e) => {
    console.log('Botão de anexar clicado');
    e.preventDefault();
    e.stopPropagation(); // Evita clicar duas vezes (no botão e no dropzone pai)
    attachmentsInput.click();
  });

  // Botao "Anexar" da barra inferior: unica forma de anexar o primeiro
  // documento, ja que a secao de Anexos fica oculta enquanto nao houver nenhum.
  const attachBarBtn = document.getElementById('pedido-attach-btn');
  if (attachBarBtn) {
    attachBarBtn.addEventListener('click', (e) => {
      e.preventDefault();
      attachmentsInput.click();
    });
  }

  // Arrastar sobre qualquer ponto da aba tambem anexa — sem isso, com a secao
  // de Anexos oculta nao haveria area de drop visivel para o primeiro arquivo.
  const dropzonePanel = document.getElementById('pedido');
  if (dropzonePanel) {
    // Contador de dragenter/dragleave: com filhos aninhados, um simples
    // dragleave dispara ao passar de um filho pra outro mesmo dentro da
    // area do painel — o contador evita o highlight piscando.
    let panelDragDepth = 0;

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((evt) => {
      dropzonePanel.addEventListener(evt, preventDefaults);
    });
    dropzonePanel.addEventListener('dragenter', () => {
      panelDragDepth++;
      dropzone.classList.add('dragover');
      dropzonePanel.classList.add('pf6-panel-dragover');
    });
    dropzonePanel.addEventListener('dragleave', () => {
      panelDragDepth = Math.max(0, panelDragDepth - 1);
      if (panelDragDepth === 0) {
        dropzone.classList.remove('dragover');
        dropzonePanel.classList.remove('pf6-panel-dragover');
      }
    });
    dropzonePanel.addEventListener('drop', (e) => {
      panelDragDepth = 0;
      dropzone.classList.remove('dragover');
      dropzonePanel.classList.remove('pf6-panel-dragover');
      handleFiles(e.dataTransfer?.files || []);
    });
  }
  if (screenshotBtn) {
    screenshotBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (screenshotBtn.disabled || screenshotBtn.classList.contains('capturing')) return;

      const pedidoNumero = document.getElementById('pedido-numero-input')?.value?.trim();
      const usuarioAnexo = await obterUsuarioAnexo();
      const pastaCriada = document.getElementById('folder-pedido-btn')?.classList.contains('exists');

      if (!pedidoNumero || !usuarioAnexo?.email || !pastaCriada) {
        showCustomModal({
          title: 'Pasta do pedido necessaria',
          message: 'Crie a pasta do pedido antes de capturar um print.',
          confirmText: 'Entendi',
          hideCancel: true
        });
        return;
      }

      screenshotBtn.classList.add('capturing');
      screenshotBtn.disabled = true;

      try {
        const resultado = await window.electronAPI.capturarPrintPedido({
          usuario: usuarioAnexo.email,
          pedido: pedidoNumero
        });

        if (resultado?.success) {
          addAttachment({
            name: resultado.fileName,
            type: resultado.type || 'image/png',
            path: resultado.path,
            file: null
          });
          atualizarVisualPastaUsuario(true, resultado.rootPath);
          atualizarVisualPastaCliente(resultado.clientPath || resultado.path);
          atualizarVisualPastaPedido(true);
        } else {
          showCustomModal({
            title: 'Erro ao Capturar Print',
            message: resultado?.error || 'Nao foi possivel capturar a tela.',
            confirmText: 'OK',
            hideCancel: true
          });
        }
      } catch (error) {
        console.error('Erro ao capturar print:', error);
        showCustomModal({
          title: 'Erro ao Capturar Print',
          message: error.message || 'Erro inesperado ao capturar a tela.',
          confirmText: 'OK',
          hideCancel: true
        });
      } finally {
        screenshotBtn.classList.remove('capturing');
        atualizarVisualPastaPedido(true);
      }
    });
  }

  attachmentsInput.addEventListener('change', (e) => { 
    console.log('Arquivo selecionado via input, arquivos:', e.target.files?.length);
    handleFiles(e.target.files); 
    attachmentsInput.value = ''; 
  });

  async function handleFiles(fileList) {
    console.log('=== HANDLEFILES CHAMADA ===');
    console.log('Arquivos recebidos:', fileList?.length);
    
    const files = Array.from(fileList || []);
    console.log('Arquivos após Array.from:', files.length);
    
    const pedidoNumero = document.getElementById('pedido-numero-input')?.value?.trim();
    console.log('Pedido número:', pedidoNumero);
    
    const usuarioAnexo = await obterUsuarioAnexo();
    console.log('Usuário para anexo:', usuarioAnexo?.email);
    
    if (!pedidoNumero || !usuarioAnexo?.email) {
      console.log('Modo pendente ativado - pedido ou usuário não disponí­vel');
      // Se não houver número do pedido ou usuário, adiciona como anexo pendente
      for (const file of files) {
        console.log('Adicionando arquivo em modo pendente:', file.name);
        addAttachment({ name: file.name, type: file.type, file, pending: true });
      }
      renderAttachments();

      // Informa o usuário que os arquivos ficaram em modo pendente
      showCustomModal({
        title: 'Arquivos adicionados',
        message: 'Os arquivos foram adicionados localmente. Informe o número do pedido e salve o pedido para gravá-los na pasta do pedido.',
        confirmText: 'Entendi',
        hideCancel: true
      });

      return;
    }

    for (const file of files) {
      try {
        console.log('Processando arquivo:', file.name, 'Tipo:', file.type);
        // Ler arquivo como ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const conteudo = Array.from(uint8Array);
        
        console.log('Arquivo lido, tamanho:', conteudo.length, 'bytes');
        console.log('Chamando salvarAnexoPedidoComConteudo...');
        
        const resultado = await window.electronAPI.salvarAnexoPedidoComConteudo({
          usuario: usuarioAnexo.email,
          pedido: pedidoNumero,
          fileName: file.name,
          conteudo
        });

        console.log('Resposta salvarAnexoPedidoComConteudo:', resultado);

        if (resultado && resultado.success) {
          console.log('Arquivo salvo com sucesso:', resultado.path);
          addAttachment({
            name: resultado.fileName || file.name,
            type: file.type,
            path: resultado.path,
            file: null
          });
          atualizarVisualPastaUsuario(true, resultado.rootPath);
          atualizarVisualPastaCliente(resultado.clientPath || resultado.path);
          atualizarVisualPastaPedido(true);
        } else {
          console.error('Erro ao salvar anexo:', resultado?.error);
          showCustomModal({
            title: 'Erro ao Anexar',
            message: 'Não foi possí­vel salvar o anexo: ' + (resultado?.error || 'erro desconhecido'),
            confirmText: 'OK',
            hideCancel: true
          });
        }
      } catch (err) {
        console.error('Erro ao anexar arquivo:', err);
        showCustomModal({
          title: 'Erro ao Anexar',
          message: 'Erro ao processar arquivo: ' + err.message,
          confirmText: 'OK',
          hideCancel: true
        });
      }
    }
  }

  function addAttachment(file) {
    console.log('addAttachment chamada com:', file.name, 'Tipo:', file.type);
    const id = Date.now() + '-' + Math.random().toString(36).slice(2,6);
    const sourceFile = file.file || file;
    const att = { id, name: file.name, type: file.type || sourceFile.type, path: file.path, file: sourceFile };
    attachments.push(att);
    console.log('Arquivo adicionado ao array, total de anexos:', attachments.length);

    if (att.type && att.type.startsWith('image/') && sourceFile instanceof Blob) {
      const reader = new FileReader();
      reader.onload = () => { att.dataUrl = reader.result; renderAttachments(); };
      reader.readAsDataURL(sourceFile);
    } else {
      if (att.type && att.type.startsWith('image/') && att.path) {
        att.dataUrl = att.path;
      }
      renderAttachments();
    }
  }

  // Função para carregar anexos existentes da pasta
  window.carregarAnexosDaPasta = async function(pedidoNumero) {
    const usuarioAnexo = await obterUsuarioAnexo();
    if (!pedidoNumero || !usuarioAnexo?.email) return;
    
    try {
      const arquivos = await window.electronAPI.listarAnexosPedido({
        usuario: usuarioAnexo.email,
        pedido: pedidoNumero
      });

      attachments = arquivos.map(arq => ({
        id: Math.random(),
        name: arq.name,
        type: arq.type,
        path: arq.path,
        dataUrl: arq.type.startsWith('image/') ? arq.path : null
      }));

      renderAttachments();
    } catch (err) {
      console.error('Erro ao carregar anexos da pasta:', err);
    }
  };

  function renderAttachments() {
    console.log('renderAttachments chamada, total de anexos:', attachments.length);
    previewList.innerHTML = '';

    // A secao de Anexos so aparece quando ha algum documento anexado.
    // Sem anexos, o usuario anexa pelo botao da barra inferior ou arrastando
    // o arquivo sobre a aba (ver dropzonePanel abaixo).
    const secaoDocs = document.getElementById('section-docs');
    if (secaoDocs) {
      secaoDocs.classList.toggle('is-hidden', attachments.length === 0);
    }

    // Mostra/Esconde o placeholder e a lista dependendo de ter anexos
    const placeholder = document.getElementById('dropzone-placeholder');
    if (placeholder) {
      placeholder.style.display = attachments.length > 0 ? 'none' : 'flex';
    }

    if (previewList) {
      previewList.style.display = attachments.length > 0 ? 'flex' : 'none';
    }

    attachments.forEach((att) => {
      const item = document.createElement('div');
      item.className = 'attachment-row-item';

      item.innerHTML = `
        <span class="attachment-row-name" title="${att.name}">${att.name}</span>
        <div class="attachment-row-actions">
          <button type="button" class="attachment-btn-action view-btn" title="Abrir / Visualizar">
            <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor"><path d="M247.31,124.76c-.35-.79-8.82-19.58-27.65-38.41C194.57,61.26,162.88,48,128,48S61.43,61.26,36.34,86.35C17.51,105.18,9,124,8.69,124.76a8,8,0,0,0,0,6.5c.35.79,8.82,19.57,27.65,38.4C61.43,194.74,93.12,208,128,208s66.57-13.26,91.66-38.34c18.83-18.83,27.3-37.61,27.65-38.4A8,8,0,0,0,247.31,124.76ZM128,192c-30.78,0-57.67-11.19-79.93-33.25A133.47,133.47,0,0,1,25,128,133.33,133.33,0,0,1,48.07,97.25C70.33,75.19,97.22,64,128,64s57.67,11.19,79.93,33.25A133.46,133.46,0,0,1,231.05,128C223.84,141.46,192.43,192,128,192Zm0-112a48,48,0,1,0,48,48A48.05,48.05,0,0,0,128,80Zm0,80a32,32,0,1,1,32-32A32,32,0,0,1,128,160Z"/></svg>
          </button>
          <button type="button" class="attachment-btn-action delete-btn" title="Excluir anexo">
            <svg width="15" height="15" viewBox="0 0 256 256" fill="currentColor"><path d="M216,48H176V40a24,24,0,0,0-24-24H104A24,24,0,0,0,80,40v8H40a8,8,0,0,0,0,16h8V208a16,16,0,0,0,16,16H192a16,16,0,0,0,16-16V64h8a8,8,0,0,0,0-16ZM96,40a8,8,0,0,1,8-8h48a8,8,0,0,1,8,8v8H96Zm96,168H64V64H192ZM112,104v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Zm48,0v64a8,8,0,0,1-16,0V104a8,8,0,0,1,16,0Z"/></svg>
          </button>
        </div>
      `;

      item.querySelector('.view-btn')?.addEventListener('click', (e) => {
        e.stopPropagation();
        if (att.path) {
          window.electronAPI.abrirArquivo(att.path);
        } else if (att.file && att.file.path) {
          window.electronAPI.abrirArquivo(att.file.path);
        }
      });

      item.querySelector('.delete-btn')?.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (att.path) {
          try {
            await window.electronAPI.excluirAnexoPedido({ filePath: att.path });
          } catch (err) {
            console.error('Falha ao excluir anexo:', err);
          }
        }
        attachments = attachments.filter(a => a.id !== att.id);
        renderAttachments();
      });

      previewList.appendChild(item);
    });
  }

  // Processa anexos que foram adicionados em modo pendente (antes do pedido existir)
  async function processPendingAttachments(pedidoNumero) {
    if (!pedidoNumero) return;
    const pendentes = attachments.filter(a => a.pending && a.file);
    if (!pendentes.length) return;

    const usuarioAnexo = await obterUsuarioAnexo();
    if (!usuarioAnexo?.email) return;

    for (const att of pendentes) {
      try {
        const sourceFile = att.file;
        const arrayBuffer = await sourceFile.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        const conteudo = Array.from(uint8Array);

        const resultado = await window.electronAPI.salvarAnexoPedidoComConteudo({
          usuario: usuarioAnexo.email,
          pedido: pedidoNumero,
          fileName: att.name,
          conteudo
        });

        if (resultado && resultado.success) {
          att.path = resultado.path;
          att.pending = false;
          att.saved = true;
          att.file = null;
        } else {
          console.error('Erro ao salvar anexo pendente:', resultado?.error);
        }
      } catch (err) {
        console.error('Erro ao processar anexo pendente:', err);
      }
    }

    renderAttachments();
    atualizarVisualPastaPedido(true);
  }

  window.processPendingAttachments = processPendingAttachments;

  window.__attachments = {
    list: () => attachments,
    clear: () => { attachments = []; renderAttachments(); },
    refresh: () => renderAttachments()
  };

  renderAttachments();

})();

function showCustomModal({ title = 'Aviso', message = '', confirmText = 'Confirmar', cancelText = 'Cancelar', hideCancel = false, useHTML = false }) {
  return new Promise((resolve) => {
    const modal = document.getElementById('custom-modal');
    const titleEl = document.getElementById('modal-title');
    const messageEl = document.getElementById('modal-message');
    const confirmBtn = document.getElementById('modal-confirm-btn');
    const cancelBtn = document.getElementById('modal-cancel-btn');
    const closeBtn = document.getElementById('modal-close-btn');

    titleEl.textContent = title;
    if (useHTML) {
      messageEl.innerHTML = message;
    } else {
      messageEl.textContent = message;
    }
    confirmBtn.textContent = confirmText;
    cancelBtn.textContent = cancelText;
    
    cancelBtn.style.display = hideCancel ? 'none' : 'block';

    const hide = (result) => {
      modal.classList.remove('active');
      setTimeout(() => {
        modal.style.display = 'none';
        resolve(result);
      }, 300);
    };

    confirmBtn.onclick = () => hide(true);
    cancelBtn.onclick = () => hide(false);
    closeBtn.onclick = () => hide(false);
    
    modal.style.display = 'flex';
    setTimeout(() => modal.classList.add('active'), 10);
  });
}

window.showCustomModal = showCustomModal;

// Função para buscar usuário logado
async function buscarUsuarioLogado() {
  try {
    const user = await window.electronAPI.getCurrentUser();
    if (user) {
      currentLoggedUser = user;
      console.log('[debug] usuário atual para pastas:', currentLoggedUser.email);
      atualizarStatusPastaPedido();
      atualizarStatusPastaUsuario();
      return;
    }

    if (currentUser?.email) {
      currentLoggedUser = currentUser;
      atualizarStatusPastaPedido();
      atualizarStatusPastaUsuario();
      return;
    }

    const storedUser = localStorage.getItem('user');
    if (storedUser) {
      currentLoggedUser = JSON.parse(storedUser);
      atualizarStatusPastaPedido();
      atualizarStatusPastaUsuario();
    }
  } catch (err) {
    console.error('Erro ao buscar usuário logado:', err);
  }
}

// Inicializa busca do usuário
buscarUsuarioLogado();


function atualizarVisualPastaUsuario(exists, path) {
  if (!configFolderBtn) return;

  configFolderBtn.classList.toggle('exists', Boolean(exists));
  configFolderBtn.classList.toggle('missing', !exists);
  configFolderBtn.title = exists
    ? 'Abrir pasta raiz do usuário'
    : 'Pasta raiz do usuário não encontrada';

  if (configPastaInput && path) {
    configPastaInput.value = path;
  }
}

function atualizarVisualPastaPedido(exists) {
  const dropzone = document.getElementById('dropzone');
  const screenshotBtn = document.getElementById('pedido-screenshot-btn');
  const pedidoNumeroInput = document.getElementById('pedido-numero-input');
  const temPedido = Boolean(pedidoNumeroInput && pedidoNumeroInput.value.trim().length > 0);

  if (folderPedidoBtn) {
    folderPedidoBtn.classList.remove('exists', 'missing');
    if (!temPedido) {
      folderPedidoBtn.title = 'Digite um pedido para gerenciar a pasta';
      if (configPastaClienteInput) configPastaClienteInput.value = '';
    } else if (exists) {
      folderPedidoBtn.classList.add('exists');
      folderPedidoBtn.title = 'Abrir pasta do pedido';
    } else {
      folderPedidoBtn.classList.add('missing');
      if (!currentPedidoId) {
        folderPedidoBtn.title = 'Salve o pedido antes de criar a pasta';
      } else {
        folderPedidoBtn.title = 'Criar pasta do pedido (AppData)';
      }
      if (configPastaClienteInput) configPastaClienteInput.value = '';
    }
    void folderPedidoBtn.offsetWidth;
  }

  dropzone?.classList.toggle('disabled', !Boolean(temPedido && exists));
  if (screenshotBtn) {
    const enabled = Boolean(temPedido && exists);
    screenshotBtn.disabled = !enabled;
    screenshotBtn.title = enabled
      ? 'Capturar print da tela e anexar ao pedido'
      : 'Crie a pasta do pedido para capturar um print';
  }
}

function atualizarVisualPastaCliente(path) {
  if (configPastaClienteInput) {
    configPastaClienteInput.value = path || '';
  }
}

async function atualizarStatusPastaUsuario() {
  const usuario = currentLoggedUser?.email || currentUser?.email;

  if (!usuario) {
    atualizarVisualPastaUsuario(false);
    return;
  }

  try {
    const resultado = await window.electronAPI.obterPastaUsuario({ usuario });

    if (!resultado?.success) {
      atualizarVisualPastaUsuario(false);
      return;
    }

    atualizarVisualPastaUsuario(resultado.exists, resultado.path);
  } catch (err) {
    console.error('Erro ao verificar pasta do usuário:', err);
    atualizarVisualPastaUsuario(false);
  }
}

// Função para atualizar visual do ícone da pasta
async function atualizarStatusPastaPedido() {
  const numeroPedido = pedidoNumeroInput?.value?.trim();
  const usuario = currentLoggedUser?.email || currentUser?.email;
  
  if (!usuario || !numeroPedido) {
    if (folderPedidoBtn) {
      folderPedidoBtn.classList.remove('exists', 'missing');
      folderPedidoBtn.title = 'Digite um pedido para gerenciar a pasta';
    }
    atualizarVisualPastaCliente('');
    return;
  }

  try {
    const infoPasta = await window.electronAPI.obterPastaPedido({
      usuario,
      pedido: numeroPedido
    });
    const existe = Boolean(infoPasta?.exists);

    if (infoPasta?.success) {
      atualizarVisualPastaUsuario(infoPasta.rootExists, infoPasta.rootPath);
      atualizarVisualPastaCliente(infoPasta.clientPath);
    }

    if (existe) {
      atualizarVisualPastaPedido(true);
    } else {
      atualizarVisualPastaPedido(false);
    }
  } catch (err) {
    console.error('Erro ao verificar pasta:', err);
  }
}

// Listeners para o campo de pedido
pedidoNumeroInput?.addEventListener('input', (e) => {
  clearTimeout(window.folderCheckTimeout);
  window.folderCheckTimeout = setTimeout(atualizarStatusPastaPedido, 500);
  atualizarTituloAbaPedidoAtiva(e.target.value);
});

pedidoNumeroInput?.addEventListener('blur', (e) => {
  atualizarTituloAbaPedidoAtiva(e.target.value);
});

pedidoNumeroInput?.addEventListener('change', (e) => {
  atualizarTituloAbaPedidoAtiva(e.target.value);
});

// O evento de clique do folderPedidoBtn está gerenciado pela função __openPedidoFolder no index.html


function sincronizarVisualRadiosStatus() {
  const radios = document.querySelectorAll('#pedido input[name="status"]');
  radios.forEach(r => {
    const parent = r.closest('.pf-st') || r.parentElement;
    if (parent) {
      parent.setAttribute('data-status', normalizarStatus(r.value));
      if (r.checked) {
        parent.classList.add('active', 'selected');
      } else {
        parent.classList.remove('active', 'selected');
      }
    }
  });
}
window.sincronizarVisualRadiosStatus = sincronizarVisualRadiosStatus;

// Inicializar listeners de status
function inicializarStatusListeners() {
  const statusContainer = document.querySelector('.pf-status') || document.querySelector('.status-list');
  if (!statusContainer) return;
  
  if (statusContainer.dataset.listenersInicializados !== '1') {
    statusContainer.dataset.listenersInicializados = '1';
    
    statusContainer.addEventListener('change', (e) => {
      if (e.target.name === 'status') {
        console.log('[statusListener] Mudança de status detectada:', e.target.value);
        sincronizarVisualRadiosStatus();
        marcarPedidoAlterado();
      }
    });
  }

  sincronizarVisualRadiosStatus();
}

// Chamar inicialização
setTimeout(inicializarStatusListeners, 300);
setTimeout(inicializarStatusListeners, 1000);

// ---- Mini modal de pedidos por status (chips do topo) ----

let statusPopoverAtivo = null;

function fecharStatusPopover() {
  if (statusPopoverAtivo) {
    statusPopoverAtivo.remove();
    statusPopoverAtivo = null;
  }
}

document.addEventListener('click', (e) => {
  if (statusPopoverAtivo && !statusPopoverAtivo.contains(e.target) && !e.target.closest('.status-pill')) {
    fecharStatusPopover();
  }
}, true);

async function abrirStatusPopover(status, chipEl) {
  fecharStatusPopover();

  const popover = document.createElement('div');
  popover.className = 'status-popover';
  popover.innerHTML = `<div class="status-popover-loading">Carregando...</div>`;
  document.body.appendChild(popover);
  statusPopoverAtivo = popover;

  // Posiciona abaixo do chip com contenção de borda
  const rect = chipEl.getBoundingClientRect();
  popover.style.top = (rect.bottom + 6) + 'px';
  
  // Se ultrapassar a margem direita da janela, alinha pela direita do chip
  const larguraEstimada = 320;
  if (rect.left + larguraEstimada > window.innerWidth - 12) {
    popover.style.left = 'auto';
    popover.style.right = Math.max(10, window.innerWidth - rect.right) + 'px';
  } else {
    popover.style.left = rect.left + 'px';
    popover.style.right = 'auto';
  }

  try {
    const resultado = await window.electronAPI.buscarPedidos({ status });

    if (!resultado?.success || !resultado.data?.length) {
      popover.innerHTML = `<div class="status-popover-empty">Nenhum pedido encontrado.</div>`;
      return;
    }

    const pedidosUnicos = deduplicarPedidosMaisRecentes(resultado.data || []);
    if (!pedidosUnicos.length) {
      popover.innerHTML = `<div class="status-popover-empty">Nenhum pedido encontrado.</div>`;
      return;
    }

    const rows = pedidosUnicos.map(p => {
      const numero = p.pedido || '—';
      const nome = p.nome || p.razao_social || p.email || '—';
      return `
        <div class="sp-row">
          <div class="sp-info">
            <span class="sp-num">${numero}</span>
            <span class="sp-sep">-</span>
            <span class="sp-nome" title="${nome}">${nome}</span>
          </div>
          <button class="sp-open-btn" data-pedido="${numero}" title="Abrir pedido ${numero} em nova aba" aria-label="Abrir pedido">
            <svg width="14" height="14" viewBox="0 0 256 256" fill="currentColor">
              <path d="M224,104a8,8,0,0,1-16,0V59.32l-82.34,82.35a8,8,0,0,1-11.32-11.32L196.68,48H152a8,8,0,0,1,0-16h64a8,8,0,0,1,8,8Zm-40,24a8,8,0,0,0-8,8v72H48V80h72a8,8,0,0,0,0-16H48A16,16,0,0,0,32,80V208a16,16,0,0,0,16,16H176a16,16,0,0,0,16-16V136A8,8,0,0,0,184,128Z"/>
            </svg>
          </button>
        </div>
      `;
    }).join('');

    popover.innerHTML = `
      <div class="sp-header">${status} <span class="sp-count">${pedidosUnicos.length}</span></div>
      <div class="sp-list">${rows}</div>
    `;

    // Eventos dos botões
    popover.querySelectorAll('.sp-open-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const numeroPedido = btn.dataset.pedido;
        fecharStatusPopover();
        if (numeroPedido && typeof window.__abrirPedidoConsultaEmNovaAba === 'function') {
          await window.__abrirPedidoConsultaEmNovaAba(numeroPedido);
        } else if (numeroPedido && typeof window.__addPedidoTab === 'function') {
          window.__addPedidoTab();
          const pInput = document.getElementById('pedido-numero-input');
          if (pInput) {
            pInput.value = numeroPedido;
            pInput.dispatchEvent(new Event('input', { bubbles: true }));
          }
          if (typeof buscarEPreencherPedido === 'function') {
            await buscarEPreencherPedido(numeroPedido);
          }
        }
      });
    });

  } catch (err) {
    popover.innerHTML = `<div class="status-popover-empty">Erro ao carregar pedidos.</div>`;
    console.error('[statusPopover] Erro:', err);
  }
}

async function atualizarContadoresStatus() {
  const container = document.getElementById('pedido-status-counts');
  if (!container) return;

  try {
    const resultado = await window.electronAPI.contarStatusPedidos();
    if (!resultado || !resultado.success) return;

    const countVideo = resultado.video || 0;
    const countVerificacao = resultado.verificacao || 0;

    container.innerHTML = `
      <div class="pedido-status-pills">
        <span class="status-pill status-vid" title="Vídeo Realizada" data-status="VIDEO REALIZADA" style="cursor:pointer;">
          <span class="status-pill-dot"></span>
          VÍDEO <strong class="status-pill-val">${countVideo}</strong>
        </span>
        <span class="status-pill status-ver" title="Verificação" data-status="VERIFICAÇÃO" style="cursor:pointer;">
          <span class="status-pill-dot"></span>
          VERIFICAÇÃO <strong class="status-pill-val">${countVerificacao}</strong>
        </span>
      </div>
    `;

    // Registra click em cada chip
    container.querySelectorAll('.status-pill').forEach(pill => {
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        const status = pill.dataset.status;
        if (statusPopoverAtivo) {
          fecharStatusPopover();
        } else {
          abrirStatusPopover(status, pill);
        }
      });
    });

  } catch (error) {
    console.error('Erro ao atualizar contadores de status:', error);
  }
}
window.atualizarContadoresStatus = atualizarContadoresStatus;

// Inicializa contadores imediatamente
setTimeout(() => window.atualizarContadoresStatus(), 300);
setTimeout(() => window.atualizarContadoresStatus(), 1200);


// ── Atualização silenciosa ──────────────────────────────────────────────────
// O processo principal baixa a nova versão sozinho e só publica o estado aqui.
// A interface nunca interrompe o usuário: mostra um ícone discreto no topo e,
// se ele clicar depois de pronto, explica que a troca acontece ao reabrir.
(() => {
  const botao = document.getElementById('update-btn');
  if (!botao || !window.electronAPI?.onUpdateStatus) return;

  let versaoPronta = null;

  window.electronAPI.onUpdateStatus((info) => {
    const estado = info?.estado;

    if (estado === 'baixando') {
      const pct = Number.isFinite(info?.progresso) ? ` (${info.progresso}%)` : '';
      botao.hidden = false;
      botao.classList.add('baixando');
      botao.classList.remove('pronta');
      botao.title = `Baixando atualização${pct}`;
      return;
    }

    if (estado === 'pronta') {
      versaoPronta = info?.versao || null;
      botao.hidden = false;
      botao.classList.remove('baixando');
      botao.classList.add('pronta');
      botao.title = 'Atualização pronta — clique para saber mais';
      return;
    }

    // 'erro' ou qualquer outro estado: some sem alarde. Uma falha de rede não é
    // problema do usuário, e o app segue funcionando na versão atual.
    botao.hidden = true;
    botao.classList.remove('baixando', 'pronta');
  });

  botao.addEventListener('click', () => {
    if (!botao.classList.contains('pronta')) return;
    const versao = versaoPronta ? ` <strong>${versaoPronta}</strong>` : '';
    showCustomModal({
      title: 'Atualização pronta',
      message: `A versão${versao} já foi baixada.<br><br>`
        + 'O Companion será atualizado automaticamente na próxima inicialização — '
        + 'basta fechar e abrir o aplicativo quando for conveniente.',
      confirmText: 'Entendi',
      hideCancel: true,
      useHTML: true
    });
  });
})();

// ── Criação de contas (Configurações → Usuários) ────────────────────────────
// Saiu da tela de login: só quem já está autenticado cria conta para outra
// pessoa. O processo principal recusa a chamada sem sessão ativa.
(() => {
  const btn = document.getElementById('config-criar-usuario-btn');
  if (!btn) return;

  const campoNome = document.getElementById('config-novo-usuario-nome');
  const campoEmail = document.getElementById('config-novo-usuario-email');
  const campoSenha = document.getElementById('config-novo-usuario-senha');
  const campoSenha2 = document.getElementById('config-novo-usuario-senha2');
  const msg = document.getElementById('config-novo-usuario-msg');

  const avisar = (texto, tipo) => {
    if (!msg) return;
    msg.textContent = texto;
    msg.className = `config-usuario-msg ${tipo || ''}`.trim();
    if (texto) setTimeout(() => { if (msg.textContent === texto) msg.textContent = ''; }, 6000);
  };

  [campoNome, campoEmail, campoSenha, campoSenha2].forEach((c) => {
    c?.addEventListener('input', () => avisar(''));
  });

  btn.addEventListener('click', async () => {
    const nome = campoNome?.value.trim() || '';
    const email = campoEmail?.value.trim() || '';
    const senha = campoSenha?.value || '';
    const senha2 = campoSenha2?.value || '';

    if (!nome || !email || !senha) return avisar('Preencha nome, e-mail e senha.', 'erro');
    if (senha.length < 6) return avisar('A senha precisa ter no mínimo 6 caracteres.', 'erro');
    if (senha !== senha2) return avisar('As senhas não coincidem.', 'erro');

    btn.disabled = true;
    avisar('Criando conta...', '');
    try {
      const resultado = await window.electronAPI?.criarUsuario?.({ nome, email, senha });
      if (!resultado?.success) {
        avisar(resultado?.error || 'Não foi possível criar a conta.', 'erro');
        return;
      }
      avisar(`Conta criada para ${email}.`, 'ok');
      [campoNome, campoEmail, campoSenha, campoSenha2].forEach((c) => { if (c) c.value = ''; });
    } catch (error) {
      console.error('Erro ao criar usuário:', error);
      avisar('Falha de comunicação ao criar a conta.', 'erro');
    } finally {
      btn.disabled = false;
    }
  });
})();
