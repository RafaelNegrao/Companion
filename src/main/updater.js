const { app, dialog, BrowserWindow, ipcMain } = require('electron');
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
    this.updateWindow = null;
    this.exeAsset = null;
    this.latestVersion = null;
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
      const headers = { 'User-Agent': 'Companion-App-Updater' };
      if (process.env.GITHUB_TOKEN && url.includes('api.github.com')) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }
      const options = { headers };
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
   * @returns {Promise<boolean>} Retorna true se houver uma nova versão e a janela de update foi aberta.
   */
  async checkForUpdates() {
    try {
      const url = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`;
      const release = await this.fetchJson(url);
      
      this.latestVersion = release.tag_name;
      if (!this.latestVersion) return false;

      if (!this.isNewerVersion(this.latestVersion, this.currentVersion)) {
        console.log('[Updater] O Companion já está na versão mais recente:', this.currentVersion);
        return false;
      }

      // Procura o asset executável do Windows (.exe)
      this.exeAsset = release.assets.find(asset => asset.name.endsWith('.exe'));
      if (!this.exeAsset) {
        console.warn('[Updater] Nenhum arquivo .exe encontrado no release do GitHub.');
        return false;
      }

      // Inicializa os listeners de IPC para a janela customizada
      this.setupIpcListeners();

      // Abre a janela customizada e frameless de atualização
      this.createUpdateWindow();

      return true;

    } catch (error) {
      console.error('[Updater] Erro ao buscar/aplicar atualizações:', error.message);
      return false;
    }
  }

  /**
   * Cria a janela de atualização com estilo premium, frameless e transparente.
   */
  createUpdateWindow() {
    this.updateWindow = new BrowserWindow({
      width: 400,
      height: 230,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    });

    this.updateWindow.loadFile(path.join(__dirname, '../renderer/update.html'));

    this.updateWindow.once('ready-to-show', () => {
      this.updateWindow.show();
      // Envia informações do release para popular a janela
      this.updateWindow.webContents.send('update-metadata', {
        version: this.latestVersion
      });
    });
  }

  /**
   * Configura os listeners do processo principal para receber ações da janela customizada.
   */
  setupIpcListeners() {
    // Evita registros duplicados de listeners se a função for chamada mais de uma vez
    ipcMain.removeAllListeners('start-update-download');
    ipcMain.removeAllListeners('cancel-update');

    ipcMain.on('start-update-download', async () => {
      try {
        const tempExePath = path.join(app.getPath('temp'), `Companion-New-${this.latestVersion}.exe`);
        
        // Baixa a atualização informando o progresso para a janela
        await this.downloadFile(this.exeAsset.browser_download_url, tempExePath, (progress) => {
          if (this.updateWindow && !this.updateWindow.isDestroyed()) {
            this.updateWindow.webContents.send('update-progress', progress);
          }
        });

        // Impede a substituição se estiver em ambiente de desenvolvimento (npm start)
        if (!app.isPackaged) {
          dialog.showMessageBox({
            type: 'warning',
            title: 'Modo de Desenvolvimento',
            message: 'Atualização baixada com sucesso!',
            detail: `Como o app está rodando em modo dev, a substituição foi pulada.\nArquivo salvo em: ${tempExePath}`
          }).then(() => app.quit());
          return;
        }

        // Aplica a substituição automática do executável principal
        this.applyUpdate(tempExePath);

      } catch (error) {
        console.error('[Updater] Falha ao efetuar download do update:', error.message);
        dialog.showErrorBox(
          'Falha na Atualização',
          `Não foi possível baixar a nova versão: ${error.message}\nO sistema será encerrado.`
        );
        app.quit();
      }
    });

    ipcMain.on('cancel-update', () => {
      console.log('[Updater] O usuário cancelou a atualização. Encerrando sistema...');
      app.quit();
    });
  }

  /**
   * Baixa o arquivo do release do GitHub salvando no local especificado.
   * @param {string} url - URL do download do asset.
   * @param {string} destPath - Caminho de destino no disco.
   * @param {function} progressCallback - Callback de progresso do download (0-100).
   * @returns {Promise<void>}
   */
  downloadFile(url, destPath, progressCallback) {
    return new Promise((resolve, reject) => {
      const headers = { 'User-Agent': 'Companion-App-Updater' };
      if (process.env.GITHUB_TOKEN && url.includes('api.github.com')) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }
      const options = { headers };

      https.get(url, options, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          return this.downloadFile(res.headers.location, destPath, progressCallback).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`Erro HTTP no download: ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        let downloadedBytes = 0;

        const fileStream = fs.createWriteStream(destPath);
        
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0 && progressCallback) {
            const percentage = (downloadedBytes / totalBytes) * 100;
            progressCallback(percentage);
          }
        });

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
    const exeName = path.basename(currentExePath);
    const batPath = path.join(app.getPath('temp'), 'update-companion.bat');

    // Script batch super robusto que resolve problemas com OneDrive e locks de arquivo.
    // 1. Muda de diretório para a pasta do executável (/d garante mudança de drive).
    // 2. Tenta matar o processo por nome do executável de forma garantida.
    // 3. Renomeia o executável original para .old (permitido pelo Windows mesmo bloqueado pelo OneDrive/indexação).
    // 4. Copia o novo executável da pasta temp para a pasta atual.
    // 5. Inicia a nova versão do Companion.
    // 6. Limpa os arquivos temporários e antigos.
    const batContent = `@echo off
chcp 65001 > nul
title Atualizando Companion...
timeout /t 1 /nobreak > nul

cd /d "${currentDir}"

taskkill /f /im "${exeName}" > nul 2>&1
del /f /q "${exeName}.old" > nul 2>&1

:loop_rename
rename "${exeName}" "${exeName}.old" > nul 2>&1
if errorlevel 1 (
    timeout /t 1 /nobreak > nul
    goto loop_rename
)

:loop_copy
copy /y "${newExePath}" "${exeName}" > nul
if errorlevel 1 (
    timeout /t 1 /nobreak > nul
    goto loop_copy
)

start "" "${exeName}"
del /f /q "${newExePath}" > nul 2>&1

timeout /t 2 /nobreak > nul
del /f /q "${exeName}.old" > nul 2>&1

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
