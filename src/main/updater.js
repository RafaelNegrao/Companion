const { app, dialog } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * AppUpdater - Gerencia a verificação de atualizações automáticas via GitHub Releases.
 * Segue os princípios de SOLID e encapsulamento, com foco em simplicidade e robustez para Windows.
 */
class AppUpdater {
  constructor(currentVersion, repoOwner, repoName) {
    this.currentVersion = currentVersion;
    this.repoOwner = repoOwner;
    this.repoName = repoName;
  }

  /**
   * Compara duas versões semânticas para determinar se a última é mais recente que a atual.
   * @param {string} latest - Tag de versão mais recente do GitHub (ex: "v1.1.0" ou "1.1.0").
   * @param {string} current - Versão instalada atualmente (ex: "1.0.0").
   * @returns {boolean}
   */
  isNewerVersion(latest, current) {
    const clean = (v) => String(v).replace(/^v/, '').split('.').map(Number);
    const [lMajor, lMinor, lPatch] = clean(latest);
    const [cMajor, cMinor, cPatch] = clean(current);

    if (lMajor !== cMajor) return lMajor > cMajor;
    if (lMinor !== cMinor) return lMinor > cMinor;
    return lPatch > cPatch;
  }

  /**
   * Faz requisições HTTPS e segue redirecionamentos retornando dados em JSON.
   * @param {string} url - URL para consulta.
   * @returns {Promise<any>}
   */
  fetchJson(url) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: { 'User-Agent': 'Companion-App-Updater' }
      };
      https.get(url, options, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return this.fetchJson(res.headers.location).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Erro HTTP: ${res.statusCode}`));
        }
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Ponto de entrada que roda silenciosamente ao iniciar o aplicativo.
   */
  async checkForUpdates() {
    try {
      const url = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`;
      const release = await this.fetchJson(url);
      
      const latestVersion = release.tag_name;
      if (!latestVersion) return;

      if (!this.isNewerVersion(latestVersion, this.currentVersion)) {
        console.log('[Updater] O Companion já está na versão mais recente:', this.currentVersion);
        return;
      }

      // Procura o asset executável do Windows (.exe)
      const exeAsset = release.assets.find(asset => asset.name.endsWith('.exe'));
      if (!exeAsset) {
        console.warn('[Updater] Nenhum arquivo .exe encontrado no release do GitHub.');
        return;
      }

      // Notifica o usuário e pede permissão para instalar
      const response = await dialog.showMessageBox({
        type: 'question',
        title: 'Atualização Disponível',
        message: `Uma nova versão (${latestVersion}) do Companion está disponível!`,
        detail: 'Deseja baixar e atualizar automaticamente agora?',
        buttons: ['Sim, atualizar', 'Mais tarde'],
        defaultId: 0,
        cancelId: 1
      });

      if (response.response !== 0) return;

      const tempExePath = path.join(app.getPath('temp'), `Companion-New-${latestVersion}.exe`);
      
      // Baixa o novo executável em segundo plano
      await this.downloadFile(exeAsset.browser_download_url, tempExePath);

      // Impede substituição se estiver rodando em ambiente de desenvolvimento (npm start)
      if (!app.isPackaged) {
        dialog.showMessageBox({
          type: 'warning',
          title: 'Modo de Desenvolvimento',
          message: 'Atualização baixada com sucesso!',
          detail: `A substituição do arquivo foi ignorada porque você está rodando no modo dev.\nSalvo em: ${tempExePath}`
        });
        return;
      }

      // Aplica a atualização substituindo o executável principal
      this.applyUpdate(tempExePath);

    } catch (error) {
      console.error('[Updater] Erro ao buscar/aplicar atualizações:', error.message);
    }
  }

  /**
   * Baixa o arquivo do release do GitHub salvando no local especificado.
   * @param {string} url - URL do download do asset.
   * @param {string} destPath - Caminho de destino no disco.
   * @returns {Promise<void>}
   */
  downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const options = {
        headers: { 'User-Agent': 'Companion-App-Updater' }
      };
      https.get(url, options, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return this.downloadFile(res.headers.location, destPath).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Erro HTTP no download: ${res.statusCode}`));
        }
        const fileStream = fs.createWriteStream(destPath);
        res.pipe(fileStream);
        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });
        fileStream.on('error', (err) => {
          fs.unlink(destPath, () => {});
          reject(err);
        });
      }).on('error', reject);
    });
  }

  /**
   * Gera o arquivo .bat de substituição, executa-o de forma desacoplada e fecha a aplicação atual.
   * @param {string} newExePath - Caminho temporário do novo executável baixado.
   */
  applyUpdate(newExePath) {
    const currentExePath = process.execPath;
    const currentDir = path.dirname(currentExePath);
    const batPath = path.join(app.getPath('temp'), 'update-companion.bat');

    // Script batch otimizado que aguarda o encerramento completo do app,
    // move o arquivo novo por cima do atual, reinicia o app e limpa os rastros.
    const batContent = `@echo off
chcp 65001 > nul
title Atualizando Companion...
timeout /t 2 /nobreak > nul

:loop
taskkill /f /im "${path.basename(currentExePath)}" > nul 2>&1
copy /y "${newExePath}" "${currentExePath}" > nul
if errorlevel 1 (
    timeout /t 1 /nobreak > nul
    goto loop
)

start "" "${currentExePath}"
del "${newExePath}" > nul 2>&1
(goto) 2>nul & del "%~f0"
`;

    fs.writeFileSync(batPath, batContent, 'utf8');

    // Inicializa o script desvinculado (detached)
    spawn('cmd.exe', ['/c', batPath], {
      cwd: currentDir,
      detached: true,
      stdio: 'ignore'
    }).unref();

    app.quit();
  }
}

module.exports = AppUpdater;
