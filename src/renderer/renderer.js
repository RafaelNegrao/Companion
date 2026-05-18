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
    
    pedidoTabs.forEach(tab => {
      const tabEl = document.createElement('div');
      tabEl.className = `pedido-tab ${tab.id === activePedidoTabId ? 'active' : ''}`;
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

  function ocultarAreaDadosPedido() {
    const scrollArea = document.getElementById('form-scrollable-area');
    if (scrollArea) scrollArea.style.setProperty('display', 'none', 'important');
  }

  function temCertificadoPedidoSelecionado() {
    const select = document.getElementById('pedido-certificado-select');
    if (!select) return false;
    const option = select.options?.[select.selectedIndex];
    const valor = String(option?.value || select.value || '').trim();
    const texto = String(option?.textContent || '').trim();
    return Boolean(valor) && !/^selecione/i.test(texto);
  }

  function atualizarVisibilidadeDadosPedidoPorCertificado() {
    const numeroPedido = String(document.getElementById('pedido-numero-input')?.value || '').trim();
    if (numeroPedido) {
      mostrarAreaDadosPedido(true);
    } else if (temCertificadoPedidoSelecionado()) {
      mostrarAreaDadosPedido();
    } else {
      ocultarAreaDadosPedido();
    }
  }

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

    mainContent.addEventListener('mouseleave', () => {
      const modal = document.getElementById('custom-modal');
      const isModalActive = modal && modal.classList.contains('active');
      
      if (isLocked) {
        if (window.electronAPI && window.electronAPI.setWindowPointerIdle) window.electronAPI.setWindowPointerIdle(true);
      } else if (!isModalActive && !deveManterJanelaAbertaPorInteracao()) {
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
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
      </svg>
    ` : `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
        <path d="M7 11V7a5 5 0 0 1 9.9-1"></path>
        <line x1="1" y1="1" x2="23" y2="23"></line>
      </svg>
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

  // Toggle lock
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      isLocked = !isLocked;
      if (window.electronAPI && window.electronAPI.toggleLock) window.electronAPI.toggleLock(isLocked);
      if (window.electronAPI && window.electronAPI.setWindowPointerIdle) window.electronAPI.setWindowPointerIdle(false);
      updateLockIcon(isLocked, true);
    });
  }

  if (mainContent) {
    mainContent.addEventListener('dblclick', (event) => {
      if (event.target?.closest?.('#lock-btn, #close-btn')) return;

      isLocked = !isLocked;
      if (window.electronAPI && window.electronAPI.toggleLock) window.electronAPI.toggleLock(isLocked);
      if (window.electronAPI && window.electronAPI.setWindowPointerIdle) window.electronAPI.setWindowPointerIdle(false);
      updateLockIcon(isLocked, true);
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

    const selectPedido = document.querySelector('.info-row-vertical select');
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
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 20h9"></path>
            <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"></path>
          </svg>
        </span>
        <span class="config-cert-mode-text">UPDATE</span>
      `;
      botao.title = 'Atualizar certificado';
      botao.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M12 20h9"></path>
          <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"></path>
        </svg>
      `;
      return;
    }

    modoEl.innerHTML = `
      <span class="config-cert-mode-icon" aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"></line>
          <line x1="5" y1="12" x2="19" y2="12"></line>
        </svg>
      </span>
      <span class="config-cert-mode-text">NEW</span>
    `;
    botao.title = 'Adicionar certificado';
    botao.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <line x1="12" y1="5" x2="12" y2="19"></line>
        <line x1="5" y1="12" x2="19" y2="12"></line>
      </svg>
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
    const certificadoSelect = document.querySelector('.info-row-vertical select');
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

  const certificadoSelect = document.querySelector('.info-row-vertical select');
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
    if (temCnpj) {
      sectionEmpresa.style.display = 'block';
      return;
    }

    if (temCpf && !temCnpj) {
      sectionEmpresa.style.display = 'none';
      return;
    }

    sectionEmpresa.style.display = 'block';
  }

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

  function inicializarIconesDateTimeComPicker() {
    const wrappers = document.querySelectorAll('.input-icon-embedded');
    wrappers.forEach((wrapper) => {
      const input = wrapper.querySelector('input[type="date"], input[type="time"]');
      const icon = wrapper.querySelector('.icon.icon-embedded');
      if (!input || !icon) return;
      if (icon.dataset.pickerBound === '1') return;
      icon.dataset.pickerBound = '1';

      icon.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
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
      });
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
    });
  });

  // Sistema de seções retráteis (Accordion)
  const docSectionTitles = document.querySelectorAll('.doc-section-title');

  docSectionTitles.forEach(title => {
    title.addEventListener('click', () => {
      const section = title.closest('.doc-section');
      if (section) section.classList.toggle('collapsed');
    });
  });


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
    const normalIcon = document.getElementById('cnpj-icon');
    const warningDiv = document.getElementById('empresa-inapta-warning');
    
    try {
      // Mostrar loading
      if (loadingIcon && normalIcon) {
        normalIcon.style.display = 'none';
        loadingIcon.style.display = 'block';
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
      
      // Verificar se empresa está inapta e atualizar ícone de situação
      const situacao = dados.descricao_situacao_cadastral?.toUpperCase() || '';
      const situacaoIcon = document.getElementById('situacao-icon');
      
      if (warningDiv) {
        if (situacao.includes('INAPTA')) {
          warningDiv.style.display = 'block';
          console.warn('EMPRESA INAPTA!');
        } else {
          warningDiv.style.display = 'none';
        }
      }
      
      // Atualizar ícone de situação cadastral
      if (situacaoIcon) {
        situacaoIcon.style.display = 'block';
        
        if (situacao.includes('ATIVA')) {
          // ÃƒÂcone de check verde para empresa ativa
          situacaoIcon.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#34c759" stroke-width="3">
              <circle cx="12" cy="12" r="10"/>
              <path d="M9 12l2 2 4-4"/>
            </svg>
          `;
          situacaoIcon.style.color = '#34c759';
        } else if (situacao.includes('INAPTA') || situacao.includes('SUSPENSA') || situacao.includes('BAIXADA')) {
          // ÃƒÂcone de X vermelho para empresa inativa
          situacaoIcon.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff3b30" stroke-width="3">
              <circle cx="12" cy="12" r="10"/>
              <line x1="15" y1="9" x2="9" y2="15"/>
              <line x1="9" y1="9" x2="15" y2="15"/>
            </svg>
          `;
          situacaoIcon.style.color = '#ff3b30';
        } else {
          // ÃƒÂcone neutro para outros casos
          situacaoIcon.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ff9500" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          `;
          situacaoIcon.style.color = '#ff9500';
        }
      }
      
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
        normalIcon.style.display = 'block';
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
    });
    
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
      loadingIcon.style.display = 'block';
    }
    
    console.log('[info] Buscando dados do CPF na API:', cpfLimpo);
    
    // Buscar na API da ReceitaWS
    const response = await fetch(`https://www.receitaws.com.br/v1/cpf/${cpfLimpo}`);
    
    if (!response.ok) {
      throw new Error(`Erro na API: ${response.status}`);
    }
    
    const dados = await response.json();
    console.log('[info] Dados recebidos da API:', dados);
    
    // Verificar se encontrou dados válidos
    if (dados.status === 'ERROR' || !dados.nome) {
      console.log('[aviso] CPF não encontrado ou inválido');
      return null;
    }
    
    console.log('[ok] Dados da pessoa encontrados:', dados);
    
    // Preencher o campo nome
    const nomeInput = document.querySelector('#subtab-pessoais .doc-section:nth-child(1) .form-grid-2:nth-child(2) .form-field:nth-child(1) input');
    
    if (nomeInput && dados.nome) {
      nomeInput.value = dados.nome;
      nomeInput.dispatchEvent(new Event('input', { bubbles: true }));
      console.log('[ok] Nome preenchido:', dados.nome);
    }
    
    // Preencher data de nascimento se disponível
    if (dados.nascimento) {
      const nascimentoInput = document.querySelector('#subtab-pessoais .doc-section:nth-child(1) .form-grid-2:nth-child(2) .form-field:nth-child(2) input');
      if (nascimentoInput) {
        // Converter de DD/MM/YYYY para YYYY-MM-DD
        const partes = dados.nascimento.split('/');
        if (partes.length === 3) {
          const dataFormatada = `${partes[2]}-${partes[1]}-${partes[0]}`;
          nascimentoInput.value = dataFormatada;
          nascimentoInput.dispatchEvent(new Event('input', { bubbles: true }));
          console.log('[ok] Data de nascimento preenchida:', dataFormatada);
        }
      }
    }
    
    // Preencher nome da mãe se disponível
    if (dados.nome_mae) {
      const maeInput = document.querySelector('#subtab-pessoais .doc-section:nth-child(1) .form-field.full input');
      if (maeInput) {
        maeInput.value = dados.nome_mae;
        maeInput.dispatchEvent(new Event('input', { bubbles: true }));
        console.log('[ok] Nome da mãe preenchido:', dados.nome_mae);
      }
    }
    
    return dados;
  } catch (error) {
    console.error('[erro] Erro ao buscar dados por CPF:', error);
    return null;
  } finally {
    // Restaurar ícone normal
    if (loadingIcon && normalIcon) {
      loadingIcon.style.display = 'none';
      normalIcon.style.display = 'block';
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

// ÃƒÂcones SVG para diferentes estados
const icons = {
  idle: `<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>`,
  saving: `<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>`,
  saved: `<polyline points="20 6 9 17 4 12"/>`,
  updated: `<path d="M21 12a9 9 0 1 1-2.64-6.36"/><polyline points="21 3 21 9 15 9"/>`,
  dirty: `<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
  cleared: `<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M10 11v6"/><path d="M14 11v6"/>`,
  error: `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`
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
    console.error('Erro ao salvar o pedido: usurio no logado');
    return null;
  }
  
  const data = {
    usuario: currentUser?.email || null,
    pedido: pedidoNumero,
    data: document.querySelector('.pedido-header .pedido-field:nth-child(2) input')?.value || null,
    hora: document.querySelector('.pedido-header .pedido-field:nth-child(3) input')?.value || null,
    versao: document.querySelector('.info-row-vertical select')?.value || null,
    modalidade: document.querySelector('.info-grid .info-item:nth-child(1) select')?.value || null,
    venda: document.querySelector('.info-grid .info-item:nth-child(2) select')?.value === 'sim' ? 'sim' : 'nao',
    preco_certificado: parseMoedaParaNumero(document.getElementById('pedido-preco-input')?.value),
    comissao: parseMoedaParaNumero(document.getElementById('pedido-comissao-input')?.value),
    status: document.querySelector('input[name="status"]:checked')?.value || null,
    
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

    // Comentrios
    comentarios: document.getElementById('pedido-comentarios')?.value || null,
  };

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
  if (isSaving) return false;

  if (!currentUser?.email) {
    await carregarUsuarioLogado();
  }
  
  const dados = coletarDadosFormulario();
  const numPedido = dados?.pedido?.trim();
  const dataPedido = dados?.data?.trim();
  const horaPedido = dados?.hora?.trim();
  const certificadoPedido = dados?.versao?.trim();

  if (!numPedido) {
    if (window.toastNotifier) {
      window.toastNotifier.warning('Por favor, preencha o número do Pedido!');
    }
    atualizarStatusSalvamento('error', 'Informe o número');
    return false;
  }

  if (!dataPedido) {
    if (window.toastNotifier) {
      window.toastNotifier.warning('Por favor, preencha a Data do pedido!');
    }
    atualizarStatusSalvamento('error', 'Informe a data');
    return false;
  }

  if (!horaPedido) {
    if (window.toastNotifier) {
      window.toastNotifier.warning('Por favor, preencha a Hora do pedido!');
    }
    atualizarStatusSalvamento('error', 'Informe a hora');
    return false;
  }

  if (!certificadoPedido) {
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
    const status = dados.status;
    // Se o status for finalizador, pede confirmação ANTES de salvar
    if (status === 'aprovado' || status === 'cancelado') {
      const confirmado = await showCustomModal({
        title: 'Finalizar Pedido',
        message: `Deseja finalizar este pedido como ${status.toUpperCase()}? Isso apagará todos os documentos locais e a pasta do pedido permanentemente.`,
        confirmText: 'Sim, Finalizar',
        cancelText: 'Não, Voltar',
        hideCancel: false
      });

      if (!confirmado) return false;
    }

    console.log('Salvando dados:', JSON.stringify(dados, null, 2));
    const resultado = await window.electronAPI.salvarPedido(dados);
    
    if (resultado.success) {
      console.log('Pedido salvo:', dados.pedido);
      currentPedidoId = resultado.data?.id || currentPedidoId;
      const foiAtualizado = resultado.action === 'updated' || jaExistia;
      
      atualizarStatusSalvamento(foiAtualizado ? 'updated' : 'saved', foiAtualizado ? 'Sobrescrito' : 'Salvo');
      atualizarContadoresStatus();
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
          await window.processPendingAttachments(dados.pedido);
        } catch (err) {
          console.error('Erro ao processar anexos pendentes após salvar pedido:', err);
        }
      }

      // Lógica de finalização (apagar pasta e zerar campos)
      if (status === 'aprovado' || status === 'cancelado') {
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
      console.error('[erro] Erro ao salvar pedido:', resultado.error);
      atualizarStatusSalvamento('error', 'Erro ao salvar', resultado.error);
      return false;
    }
  } catch (error) {
    console.error('[erro] Erro ao salvar pedido:', error);
    atualizarStatusSalvamento('error', 'Erro ao salvar', error.message || String(error));
    return false;
  } finally {
    isSaving = false;
    if (pedidoSaveBtn) pedidoSaveBtn.disabled = false;
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
    atualizarContadoresStatus();
  });
  
  atualizarStatusSalvamento('idle', 'Pronto');
  definirBaselinePedidoAtual();
  atualizarContadoresStatus();
  console.log('[ok] Controle manual de salvamento inicializado em', campos.length, 'campos');
}

// Inicializa o controle manual quando a aba for carregada
setTimeout(inicializarControleManualPedido, 500);

// Função para limpar todos os campos do formulário
function limparTodosCampos() {
  console.log('[info] Limpando todos os campos...');
  
  // Limpar campos do cabeçalho (exceto número do pedido)
  const dataInput = document.querySelector('.pedido-header .pedido-field:nth-child(2) input');
  const horaInput = document.querySelector('.pedido-header .pedido-field:nth-child(3) input');
  const certificadoSelect = document.querySelector('.info-row-vertical select');
  const atendimentoSelect = document.querySelector('.info-grid .info-item:nth-child(1) select');
  const vendaSelect = document.querySelector('.info-grid .info-item:nth-child(2) select');
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

  // Reseta visibilidade da seção empresa
  const sectionEmpresa = document.getElementById('section-empresa');
  if (sectionEmpresa) sectionEmpresa.style.display = 'block';
  
  // Limpar status - volta para digitação
  const digitacaoRadio = document.querySelector('input[name="status"][value="digitacao"]');
  if (digitacaoRadio) {
    digitacaoRadio.checked = true;
  }
  
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
  
  // Limpar todos os inputs de dados empresa
  const camposEmpresaIds = [
    'empresa-cnpj', 'empresa-situacao', 'empresa-data-situacao', 'empresa-motivo-situacao',
    'empresa-razao-social', 'empresa-nome-fantasia', 'empresa-porte', 'empresa-natureza-juridica',
    'empresa-data-abertura', 'empresa-capital-social', 'empresa-cep', 'empresa-municipio',
    'empresa-uf', 'empresa-bairro', 'empresa-logradouro', 'empresa-numero', 'empresa-complemento',
    'empresa-junta', 'empresa-telefone', 'empresa-email'
  ];
  
  camposEmpresaIds.forEach(id => {
    const input = document.getElementById(id);
    if (input) input.value = '';
  });
  
  // Esconder aviso de empresa inapta
  const warningDiv = document.getElementById('empresa-inapta-warning');
  if (warningDiv) warningDiv.style.display = 'none';
  
  // Esconder ícone de situação cadastral
  const situacaoIcon = document.getElementById('situacao-icon');
  if (situacaoIcon) situacaoIcon.style.display = 'none';
  
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

function atualizarVisibilidadeDadosPedidoPorCertificado() {
  if (currentPedidoId || temCertificadoPedidoSelecionado()) {
    mostrarAreaDadosPedido(true);
  } else {
    ocultarAreaDadosPedido();
  }
}
window.atualizarVisibilidadeDadosPedidoPorCertificado = atualizarVisibilidadeDadosPedidoPorCertificado;

// Função para buscar e preencher pedido
function mostrarAreaDadosPedido(force = false) {
  const scrollArea = document.getElementById('form-scrollable-area');
  if (!force && !temCertificadoPedidoSelecionado()) {
    ocultarAreaDadosPedido();
    return;
  }
  if (scrollArea) scrollArea.style.setProperty('display', 'flex', 'important');
}
window.mostrarAreaDadosPedido = mostrarAreaDadosPedido;

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

  escreverValorCampo(document.querySelector('.pedido-header .pedido-field:nth-child(2) input'), normalizarDataInput(pedido.data));
  escreverValorCampo(document.querySelector('.pedido-header .pedido-field:nth-child(3) input'), pedido.hora || '');
  const selectCertificado = document.querySelector('.info-row-vertical select');
  garantirOpcaoVaziaSelect(selectCertificado, 'Selecione um certificado');
  escreverValorSelect(selectCertificado, pedido.versao || '');
  if (typeof window.atualizarDropdownCertificadoPedido === 'function') {
    window.atualizarDropdownCertificadoPedido();
  }
  // Mostra ou oculta containers conforme o certificado preenchido
  if (typeof window.atualizarVisibilidadeDadosPedidoPorCertificado === 'function') {
    window.atualizarVisibilidadeDadosPedidoPorCertificado();
  }
  if (selectCertificado) {
    const opt = selectCertificado.options[selectCertificado.selectedIndex];
    const certTextAtual = opt?.textContent || selectCertificado.value || '';
    const sectionEmpresa = document.getElementById('section-empresa');
    if (sectionEmpresa) {
      const texto = normalizarTextoRelatorio(certTextAtual);
      const temCnpj = /\b(CNPJ|E[-\s]?CNPJ|PJ)\b/.test(texto);
      const temCpf = /\b(CPF|E[-\s]?CPF|PF)\b/.test(texto);
      sectionEmpresa.style.display = temCnpj ? 'block' : (temCpf ? 'none' : 'block');
    }
  }
  escreverValorSelect(document.querySelector('.info-grid .info-item:nth-child(1) select'), pedido.modalidade || '');
  escreverValorSelect(document.querySelector('.info-grid .info-item:nth-child(2) select'), ehVendaSim(pedido.venda) ? 'sim' : 'nao');
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

  const statusValue = String(pedido.status || 'digitacao').toLowerCase().replace(/ /g, '_');
  const statusRadio = document.querySelector(`input[name="status"][value="${statusValue}"]`);
  if (statusRadio) {
    statusRadio.checked = true;
  }

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

  
  atualizarStatusSalvamento('saved', 'Salvo');

  const dropzone = document.getElementById('dropzone');
  if (dropzone) dropzone.classList.remove('disabled');

  console.log('[ok] Pedido preenchido na tela:', pedido.pedido || numeroPedido);
}

let pedidoBuscaRequestId = 0;

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
  const dataInput = document.querySelector('.pedido-header .pedido-field:nth-child(2) input');
  const horaInput = document.querySelector('.pedido-header .pedido-field:nth-child(3) input');
  
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
  
  // Reset status para digitação
  const digitacaoRadio = document.querySelector('input[name="status"][value="digitacao"]');
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
  let ultimaBuscaPedido = '';
  let ultimaBuscaMomento = 0;

  async function executarBuscaPedidoAtual() {
    const numeroPedido = normalizarNumeroPedidoBusca(pedidoInput.value);
    if (!numeroPedido) {
      pedidoBuscaRequestId += 1;
      currentPedidoId = null;
      limparTodosCampos();
      definirBaselinePedidoAtual();
      atualizarTituloAbaPedidoAtiva('');
      atualizarStatusSalvamento('idle', 'Pronto');
      return;
    }

    const abaAtiva = obterAbaPedidoAtiva();
    const pedidoBaseline = normalizarNumeroPedidoBusca(abaAtiva?.baseline?.pedido || '');
    const alteracoesForaPedido = possuiAlteracoesPendentesExcetoPedido();

    // Evita sobrescrever campos já editados quando o pedido não mudou.
    if (alteracoesForaPedido && numeroPedido === pedidoBaseline) {
      return;
    }

    // Sem alterações no número do pedido, não precisa recarregar novamente.
    if (numeroPedido === pedidoBaseline && currentPedidoId) {
      return;
    }

    const agora = Date.now();
    if (numeroPedido === ultimaBuscaPedido && agora - ultimaBuscaMomento < 500) {
      return;
    }

    ultimaBuscaPedido = numeroPedido;
    ultimaBuscaMomento = agora;
    await buscarEPreencherPedido(numeroPedido);
  }

  // Busca ao pressionar Enter ou perder foco
  // (A área de dados será exibida apenas ao finalizar a edição e buscar o pedido)

  // Ao perder o foco (blur) - busca antes de permitir salvamento
  pedidoInput.addEventListener('blur', async () => {
    await executarBuscaPedidoAtual();
  });
  
  // Ao pressionar Enter
  pedidoInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      await executarBuscaPedidoAtual();
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
      <svg class="status-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M20 6 9 17l-5-5"></path>
      </svg>
      <span class="status-text">Sem alteracoes</span>
    `;
    saveSection.insertBefore(statusEl, saveBtn);
  }
}

function atualizarStatusConfiguracoes(estado = 'idle', mensagem = 'Sem alteracoes') {
  garantirBarraInferiorConfiguracoes();

  const statusEl = document.getElementById('config-save-status');
  if (!statusEl) return;

  const iconEl = statusEl.querySelector('.status-icon');
  const textEl = statusEl.querySelector('.status-text');

  const icons = {
    idle: '<path d="M20 6 9 17l-5-5"></path>',
    dirty: '<path d="M12 20h9"></path><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"></path>',
    saving: '<circle cx="12" cy="12" r="10"></circle><path d="M12 6v6l4 2"></path>',
    saved: '<path d="M20 6 9 17l-5-5"></path>',
    error: '<circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line>'
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

function atualizarIconeToggleSenhaConfig(visible) {
  const toggle = document.getElementById('config-senha-toggle');
  if (!toggle) return;

  if (visible) {
    toggle.title = 'Ocultar senha';
    toggle.setAttribute('aria-label', 'Ocultar senha');
    toggle.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
        <path d="m3 3 18 18"></path>
        <path d="M10.58 10.58a2 2 0 0 0 2.83 2.83"></path>
        <path d="M9.88 5.09A10.94 10.94 0 0 1 12 5c7 0 11 7 11 7a21.66 21.66 0 0 1-3.16 4.19"></path>
        <path d="M6.61 6.61A21.69 21.69 0 0 0 1 12s4 7 11 7a10.94 10.94 0 0 0 5.39-1.39"></path>
      </svg>
    `;
    return;
  }

  toggle.title = 'Mostrar senha';
  toggle.setAttribute('aria-label', 'Mostrar senha');
  toggle.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"></path>
      <circle cx="12" cy="12" r="3"></circle>
    </svg>
  `;
}

function inicializarToggleSenhaConfig() {
  const input = document.getElementById('config-senha');
  const toggle = document.getElementById('config-senha-toggle');
  if (!input || !toggle) return;
  if (toggle.dataset.bound === '1') return;
  toggle.dataset.bound = '1';

  const alternar = () => {
    const visivel = input.type === 'password';
    input.type = visivel ? 'text' : 'password';
    atualizarIconeToggleSenhaConfig(visivel);
  };

  toggle.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    alternar();
  });

  toggle.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      alternar();
    }
  });

  atualizarIconeToggleSenhaConfig(input.type === 'text');
}

async function obterSenhaLembradaDoUsuario(emailUsuario) {
  try {
    if (!window.electronAPI?.getCredentials) return '';
    const credenciais = await window.electronAPI.getCredentials();
    const emailCredencial = String(credenciais?.email || '').trim().toLowerCase();
    const emailAtual = String(emailUsuario || '').trim().toLowerCase();

    if (!emailCredencial || !emailAtual || emailCredencial !== emailAtual) {
      return '';
    }

    return String(credenciais?.password || '');
  } catch {
    return '';
  }
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

function inicializarSecoesConfiguracoesRetrateis() {
  const container = document.getElementById('configuracoes');
  if (!container || container.dataset.collapsibleConfigInit === '1') return;
  container.dataset.collapsibleConfigInit = '1';

  const secoes = container.querySelectorAll('.section');
  secoes.forEach((secao) => {
    if (secao.classList.contains('config-bottom-bar')) return;

    const titulo = secao.querySelector(':scope > .section-title');
    if (!titulo) return;

    secao.classList.add('config-collapsible');

    let content = secao.querySelector(':scope > .config-section-content');
    if (!content) {
      content = document.createElement('div');
      content.className = 'config-section-content';

      let nodo = titulo.nextSibling;
      while (nodo) {
        const next = nodo.nextSibling;
        content.appendChild(nodo);
        nodo = next;
      }
      secao.appendChild(content);
    }

    let arrow = titulo.querySelector('.config-section-arrow');
    if (!arrow) {
      arrow = document.createElement('span');
      arrow.className = 'config-section-arrow';
      arrow.innerHTML = `
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"></polyline>
        </svg>
      `;
      titulo.appendChild(arrow);
    }

    // Por padrão, as seções de Configurações iniciam recolhidas
    if (!secao.classList.contains('collapsed')) {
      secao.classList.add('collapsed');
    }

    if (titulo.dataset.boundCollapse === '1') return;
    titulo.dataset.boundCollapse = '1';
    titulo.addEventListener('click', () => {
      secao.classList.toggle('collapsed');
    });
  });
}

garantirBarraInferiorConfiguracoes();
inicializarMonitoramentoConfiguracoes();
inicializarSecoesConfiguracoesRetrateis();
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
    inicializarSecoesConfiguracoesRetrateis();
    inicializarToggleSenhaConfig();
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
    const senhaLembrada = await obterSenhaLembradaDoUsuario(usuarioConfigurado);

    setField('config-usuario', usuarioConfigurado);
    setField('config-senha', config.senha || senhaLembrada || '');
    setField('config-agente', config.agente || '');
    setField('config-cod-rev', config.cod_rev || '');
    setField('config-email', config.email || '');
    setField('config-senha-email', config.senha_email || '');
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

    const usuario = document.getElementById('config-usuario')?.value?.trim() || currentUser?.email;

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
      senha: document.getElementById('config-senha')?.value,
      agente: document.getElementById('config-agente')?.value,
      cod_rev: document.getElementById('config-cod-rev')?.value,
      email: document.getElementById('config-email')?.value,
      senha_email: document.getElementById('config-senha-email')?.value,
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
          email: resultado.data?.usuario || usuario,
          senha: config.senha || currentUser?.senha
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

// Carrega pedidos do servidor
async function carregarPedidosDoServidor() {
  const hoje = obterDataHojeLocalISO();
  const dataDe = currentDateRange.dataDe || hoje;
  const dataAte = currentDateRange.dataAte || hoje;
  
  try {
    const resultado = await window.electronAPI.buscarPedidos({
      dataDe,
      dataAte,
      usuario: currentUser?.email || undefined
    });
    
    if (resultado.success && resultado.data && resultado.data.length > 0) {
      const dadosRecentes = deduplicarPedidosMaisRecentes(resultado.data);
      // Processar dados do servidor (colunas conforme tabela Supabase)
      pedidosData = dadosRecentes.map(p => ({
        num_pedido: p.pedido || p.id,
        hora: p.hora || '00:00',
        nome: p.nome || 'N/A',
        status: (p.status || 'digitacao').toLowerCase(),
        versao: p.versao || p.certificado || '-',
        data: formatarDataISO(p.data),
        comissao: p.comissao ?? p.COMISSAO ?? p.valor_comissao ?? p['COMISSAO'] ?? 0,
        preco: p.preco ?? p.PRECO ?? p['PRECO'] ?? 0,
        preco_certificado: p.preco_certificado ?? p.precoCertificado ?? p.PRECO_CERTIFICADO ?? p['PRECO CERTIFICADO'] ?? 0,
        venda: p.venda ?? p.VENDA ?? ''
      }));
    } else {
      pedidosData = [];
    }

    calcularRangeDinamico();
    renderizarTimeline();
    renderizarTabela(pedidosData);
    atualizarRelatorioConsulta(pedidosData);
  } catch (error) {
    console.error('Erro ao carregar pedidos do servidor:', error);
    pedidosData = [];
    calcularRangeDinamico();
    renderizarTimeline();
    renderizarTabela(pedidosData);
    atualizarRelatorioConsulta(pedidosData);
  }
}

// Extrai hora de um timestamp
function extrairHora(timestamp) {
  if (!timestamp) return '00:00';
  const data = new Date(timestamp);
  return `${String(data.getHours()).padStart(2, '0')}:${String(data.getMinutes()).padStart(2, '0')}`;
}

// Formata data para exibição
function formatarData(timestamp) {
  if (!timestamp) return '-';
  const data = new Date(timestamp);
  return data.toLocaleDateString('pt-BR');
}

// Formata data ISO para exibição
function formatarDataISO(dataISO) {
  if (!dataISO) return '-';
  const data = new Date(dataISO);
  return data.toLocaleDateString('pt-BR');
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
  const bruto = String(status || 'digitacao')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (bruto.includes('aprov')) return 'aprovado';
  if (bruto.includes('cancel')) return 'cancelado';
  if (bruto.includes('video')) return 'video';
  if (bruto.includes('verific')) return 'verificacao';
  if (bruto.includes('digit')) return 'digitacao';

  const statusLimpo = bruto.replace(/\s+/g, '_');
  const statusValidos = ['aprovado', 'cancelado', 'video', 'verificacao', 'digitacao'];
  return statusValidos.includes(statusLimpo) ? statusLimpo : 'digitacao';
}

function getStatusLabel(status) {
  switch (normalizarStatus(status)) {
    case 'aprovado':
      return 'Aprovado';
    case 'cancelado':
      return 'Cancelado';
    case 'video':
      return 'V\u00eddeo realizada';
    case 'verificacao':
      return 'Verifica\u00e7\u00e3o';
    case 'digitacao':
    default:
      return 'Digita\u00e7\u00e3o';
  }
}

function deduplicarPedidosMaisRecentes(lista) {
  if (!Array.isArray(lista) || lista.length === 0) return [];

  const vistos = new Set();
  const resultado = [];

  // Com a consulta ordenada por data/id desc, o primeiro item de cada pedido é o mais recente.
  lista.forEach((pedido) => {
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
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
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
    const status = normalizarStatus(p.status);
    if (statusCount[status] !== undefined) statusCount[status]++;
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
      const status = normalizarStatus(p.status);
      if (statusCount[status] !== undefined) {
        statusCount[status]++;
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
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
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
  return `<span class="status-badge status-${statusNormalizado}">
    <span class="status-badge-dot"></span>
    <span>${getStatusLabel(statusNormalizado)}</span>
  </span>`;
}

// Buscar pedidos com filtros
const btnConsultaBuscar = document.getElementById('btn-consulta-buscar');
if (btnConsultaBuscar) {
  btnConsultaBuscar.addEventListener('click', async () => {
    const dataDe = document.getElementById('consulta-data-de')?.value;
    const dataAte = document.getElementById('consulta-data-ate')?.value;
    const status = document.getElementById('consulta-status')?.value;
    
    // Atualiza o range de datas atual
    currentDateRange = { dataDe: dataDe || null, dataAte: dataAte || null };
    
    try {
      const resultado = await window.electronAPI.buscarPedidos({
        dataDe: dataDe || undefined,
        dataAte: dataAte || undefined,
        status: status || undefined,
        usuario: currentUser?.email || undefined
      });
      
      if (resultado.success && resultado.data) {
        let dadosFiltrados = deduplicarPedidosMaisRecentes(resultado.data);
        const vendaFiltro = document.getElementById('consulta-venda')?.value;
        
        if (vendaFiltro === 'sim') {
          dadosFiltrados = dadosFiltrados.filter(p => ehVendaSim(p.venda ?? p.VENDA));
        } else if (vendaFiltro === 'nao') {
          dadosFiltrados = dadosFiltrados.filter(p => !ehVendaSim(p.venda ?? p.VENDA));
        }

        pedidosData = dadosFiltrados.map(p => ({
          num_pedido: p.pedido || p.id,
          hora: p.hora || '00:00',
          nome: p.nome || 'N/A',
          status: (p.status || 'digitacao').toLowerCase(),
          versao: p.versao || p.certificado || '-',
          data: formatarDataISO(p.data),
          comissao: p.comissao ?? p.COMISSAO ?? p.valor_comissao ?? p['COMISSAO'] ?? 0,
          preco: p.preco ?? p.PRECO ?? p['PRECO'] ?? 0,
          preco_certificado: p.preco_certificado ?? p.precoCertificado ?? p.PRECO_CERTIFICADO ?? p['PRECO CERTIFICADO'] ?? 0,
          venda: p.venda ?? p.VENDA ?? ''
        }));
      } else {
        pedidosData = [];
      }
      
      calcularRangeDinamico();
      renderizarTimeline();
      renderizarTabela(pedidosData);
      atualizarRelatorioConsulta(pedidosData);
    } catch (error) {
      console.error('Erro ao buscar pedidos:', error);
      atualizarRelatorioConsulta([]);
    }
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
    btnConsultaBuscar?.click();
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
  
  const btnConsultaBuscar = document.getElementById('btn-consulta-buscar');
  btnConsultaBuscar?.click();
}

const dePrevBtn = document.getElementById('consulta-data-de-prev');
const deNextBtn = document.getElementById('consulta-data-de-next');
const atePrevBtn = document.getElementById('consulta-data-ate-prev');
const ateNextBtn = document.getElementById('consulta-data-ate-next');

if (dePrevBtn) dePrevBtn.addEventListener('click', () => ajustarDiasConsulta('consulta-data-de', -1));
if (deNextBtn) deNextBtn.addEventListener('click', () => ajustarDiasConsulta('consulta-data-de', 1));
if (atePrevBtn) atePrevBtn.addEventListener('click', () => ajustarDiasConsulta('consulta-data-ate', -1));
if (ateNextBtn) ateNextBtn.addEventListener('click', () => ajustarDiasConsulta('consulta-data-ate', 1));

// Inicializa a aba Consulta ao clicar
const consultaTab = document.querySelector('[data-tab="consulta"]');
let consultaTabJaInicializada = false;
if (consultaTab) {
  consultaTab.addEventListener('click', () => {
    if (!consultaTabJaInicializada) {
      initConsultaFilters();
      carregarPedidosDoServidor();
      consultaTabJaInicializada = true;
    }
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
  return pedidos.filter((pedido) => pedido.status === 'aprovado');
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
  
  const largura = 760;
  const altura = 220;
  const margem = { top: 15, right: 8, bottom: 28, left: 8 };
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
  
  const largura = 760;
  const altura = 190;
  const margem = { top: 22, right: 8, bottom: 30, left: 8 };
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
  const pedidosAprovados = (indicadoresTodosPedidos || []).filter(p => p.status === 'aprovado');

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
  const todosValidos = pedidosValidosIndicadores(pedidosMes);
  const aprovados = todosValidos.filter((pedido) => pedido.status === 'aprovado');
  const validos = aprovados; // A análise deve ser estritamente de pedidos aprovados
  
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

  const totalMes = Object.values(valoresPorSemana).reduce((a, b) => a + b, 0);
  const ticketMedio = validos.length ? totalMes / validos.length : 0;
  const taxaAprovacao = todosValidos.length ? (aprovados.length / todosValidos.length) * 100 : 0;

  const valoresPorMesAno = Array.from({ length: 12 }, () => 0);
  pedidosValidosIndicadores(pedidosAno).filter((pedido) => pedido.status === 'aprovado').forEach((pedido) => {
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

async function carregarIndicadores() {
  if (indicadoresCarregando) return;
  indicadoresCarregando = true;

  const mesInput = document.getElementById('indicadores-mes');
  const limites = obterLimitesMesIndicadores(mesInput?.value || obterMesAtualInput());
  if (mesInput && !mesInput.value) mesInput.value = `${limites.ano}-${String(limites.mes).padStart(2, '0')}`;

  const atualizarBtn = document.getElementById('indicadores-atualizar');
  if (atualizarBtn) atualizarBtn.disabled = true;

  exibirSkeletonsIndicadores();

  try {
    // Mesma origem da aba Consulta, com paginação para incluir dados antigos.
    const todosPedidos = [];
    const tamanhoLote = 1000;
    const maxPaginas = 200;
    let offset = 0;

    for (let pagina = 0; pagina < maxPaginas; pagina += 1) {
      const resultado = await window.electronAPI.buscarPedidos({
        usuario: currentUser?.email || undefined,
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

    const todosMapped = todosPedidos.map(mapearPedidoIndicador);
    const aprovadosMapped = todosMapped.filter((p) => p.status === 'aprovado');
    indicadoresTodosPedidos = aprovadosMapped;

    // Filtra em memória os pedidos do mês e do ano selecionado
    const pedidosMes = aprovadosMapped.filter((p) => p.dataISO >= limites.inicio && p.dataISO <= limites.fim);
    const pedidosAno = aprovadosMapped.filter((p) => p.ano === limites.ano);

    indicadoresUltimoSnapshot = { pedidosMes, pedidosAno, limites };
    renderizarIndicadores(pedidosMes, pedidosAno, limites);
  } catch (error) {
    console.error('Erro ao carregar indicadores:', error);
    ['indicadores-chart-dia', 'indicadores-chart-qtd-dia', 'indicadores-chart-horarios', 'indicadores-chart-meses'].forEach((id) => {
      renderizarEmptyChart(document.getElementById(id), 'Erro ao carregar indicadores');
    });
  } finally {
    if (atualizarBtn) atualizarBtn.disabled = false;
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

  mesInput?.addEventListener('change', carregarIndicadores);
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

  const tabTitleEl = document.querySelector('.pedido-tab.active .tab-title');
  if (tabTitleEl) {
    tabTitleEl.textContent = numeroPedido || activeTab.number;
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
    
    // Mostra/Esconde o placeholder e a lista dependendo de ter anexos
    const placeholder = document.getElementById('dropzone-placeholder');
    if (placeholder) {
      placeholder.style.display = attachments.length > 0 ? 'none' : 'flex';
    }
    
    if (previewList) {
      previewList.style.display = attachments.length > 0 ? 'flex' : 'none';
    }

    attachments.forEach((att) => {
      console.log('Renderizando anexo:', att.name);
      const item = document.createElement('div');
      item.className = 'preview-item';

      if (att.dataUrl) {
        const img = document.createElement('img');
        img.className = 'preview-thumb';
        img.src = att.dataUrl;
        img.alt = att.name;
        item.appendChild(img);
      } else {
        const thumb = document.createElement('div');
        thumb.className = 'preview-thumb';
        thumb.style.display = 'flex';
        thumb.style.alignItems = 'center';
        thumb.style.justifyContent = 'center';
        thumb.innerHTML = `
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
          </svg>
        `;
        item.appendChild(thumb);
      }

      // Tag com o nome do arquivo no topo
      const nameTag = document.createElement('div');
      nameTag.className = 'preview-name-tag';
      nameTag.textContent = att.name;
      item.appendChild(nameTag);

      // Overlay
      const overlay = document.createElement('div');
      overlay.className = 'preview-overlay';

      const info = document.createElement('div');
      info.className = 'preview-overlay-info';
      // Tenta formatar a data se disponível, senão usa o nome truncado
      const hoje = new Date().toLocaleDateString('pt-BR');
      info.textContent = hoje;

      const actions = document.createElement('div');
      actions.className = 'preview-overlay-actions';

      const openBtn = document.createElement('button');
      openBtn.className = 'preview-overlay-btn';
      openBtn.type = 'button';
      openBtn.title = 'Visualizar';
      openBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      `;
      openBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (att.path) {
          window.electronAPI.abrirArquivo(att.path);
        } else if (att.file && att.file.path) {
          window.electronAPI.abrirArquivo(att.file.path);
        }
      });

      const removeBtn = document.createElement('button');
      removeBtn.className = 'preview-overlay-btn remove';
      removeBtn.type = 'button';
      removeBtn.title = 'Remover';
      removeBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"></polyline>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
        </svg>
      `;
      removeBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        
        // Se o arquivo já está no disco, tenta excluir
        if (att.path) {
          try {
            console.log('Solicitando exclusão de arquivo:', att.path);
            const res = await window.electronAPI.excluirAnexoPedido({ filePath: att.path });
            if (!res.success) {
              console.error('Erro ao excluir arquivo :', res.error);
            }
          } catch (err) {
            console.error('Falha ao chamar excluirAnexoPedido:', err);
          }
        }

        attachments = attachments.filter(a => a.id !== att.id);
        renderAttachments();
      });

      actions.appendChild(openBtn);
      actions.appendChild(removeBtn);
      
      overlay.appendChild(info);
      overlay.appendChild(actions);
      
      item.appendChild(overlay);
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
    clear: () => { attachments = []; renderAttachments(); }
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

// O evento de clique do folderPedidoBtn está gerenciado pela função __openPedidoFolder no index.html


// Inicializar listeners de status
function inicializarStatusListeners() {
  const statusList = document.querySelector('.status-list');
  if (!statusList || statusList.dataset.listenersInicializados === '1') return;

  statusList.dataset.listenersInicializados = '1';
  
  statusList.addEventListener('change', (e) => {
    if (e.target.name === 'status') {
      marcarPedidoAlterado();
    }
  });
}

// Chamar inicialização
setTimeout(inicializarStatusListeners, 1000);

async function atualizarContadoresStatus() {
  const container = document.getElementById('pedido-status-counts');
  if (!container) return;

  try {
    const resultado = await window.electronAPI.buscarPedidos({
      usuario: currentUser?.email || undefined
    });
    if (!resultado || !resultado.success) return;

    const pedidos = deduplicarPedidosMaisRecentes(resultado.data || []);
    
    // Contadores
    let counts = {
      digitacao: 0,
      video: 0,
      verificacao: 0,
      aprovado: 0,
      cancelado: 0
    };

    pedidos.forEach(p => {
      const st = String(p.status || '').toLowerCase();
      if (counts.hasOwnProperty(st)) {
        counts[st]++;
      }
    });

    container.innerHTML = `
      <div class="pedido-status-pills">
        <span class="status-pill status-vid" title="Vídeo Realizada">
          <span class="status-pill-dot"></span>
          VÍDEO <strong class="status-pill-val">${counts.video}</strong>
        </span>
        <span class="status-pill status-ver" title="Verificação">
          <span class="status-pill-dot"></span>
          VERIFICAÇÃO <strong class="status-pill-val">${counts.verificacao}</strong>
        </span>
      </div>
    `;
  } catch (error) {
    console.error('Erro ao atualizar contadores de status:', error);
  }
}
window.atualizarContadoresStatus = atualizarContadoresStatus;


