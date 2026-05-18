// update-renderer.js - Lógica interativa da janela de atualização customizada

document.addEventListener('DOMContentLoaded', () => {
  const btnUpdate = document.getElementById('btnUpdate');
  const btnCancel = document.getElementById('btnCancel');
  const messageText = document.getElementById('messageText');
  const versionText = document.getElementById('versionText');
  const actionButtons = document.getElementById('actionButtons');
  const progressContainer = document.getElementById('progressContainer');
  const progressBar = document.getElementById('progressBar');
  const progressPercent = document.getElementById('progressPercent');

  // Recebe as informações do release e preenche na tela
  window.electronAPI.onUpdateMetadata((metadata) => {
    if (metadata && metadata.version) {
      versionText.textContent = `VERSÃO ${metadata.version} DISPONÍVEL`;
      messageText.textContent = `Uma nova versão (${metadata.version}) do Companion está disponível! Deseja baixar e instalar agora?`;
    }
  });

  // Clique em Cancelar -> Fecha o app imediatamente
  btnCancel.addEventListener('click', () => {
    window.electronAPI.cancelUpdate();
  });

  // Clique em Atualizar -> Inicia o download e transiciona o layout suavemente
  btnUpdate.addEventListener('click', () => {
    actionButtons.style.display = 'none';
    messageText.style.display = 'none';
    progressContainer.style.display = 'flex';
    
    // Adiciona classe para iniciar a animação do ícone de download
    const iconWrapper = document.querySelector('.update-icon-wrapper');
    if (iconWrapper) {
      iconWrapper.classList.add('downloading');
    }
    
    // Dispara sinal para o Main iniciar download
    window.electronAPI.startUpdateDownload();
  });

  // Recebe e renderiza o progresso do download em tempo real
  window.electronAPI.onUpdateProgress((percentage) => {
    const pct = Math.min(100, Math.max(0, Math.round(percentage)));
    progressBar.style.width = `${pct}%`;
    progressPercent.textContent = `${pct}%`;
  });
});
