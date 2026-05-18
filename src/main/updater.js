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
   * Obtém os caminhos corretos do executável, suportando executáveis portáteis do Electron.
   * @returns {{currentExePath: string, currentDir: string, exeName: string}}
   */
  getPaths() {
    const tempDir = String(process.env.TEMP || process.env.TMP || '').toLowerCase();
    const isLikelyTempPath = (targetPath) => {
      const p = String(targetPath || '').toLowerCase();
      if (!p) return false;
      if (tempDir && p.startsWith(tempDir)) return true;
      return p.includes('\\appdata\\local\\temp\\');
    };

    const envPortableFile = process.env.PORTABLE_EXECUTABLE_FILE;
    const envPortablePath = process.env.PORTABLE_EXECUTABLE_PATH;
    const envPortableDir = process.env.PORTABLE_EXECUTABLE_DIR;
    const execPath = process.execPath;
    const argv0 = process.argv && process.argv.length > 0 ? process.argv[0] : '';
    const exeBaseName = path.basename(argv0 || execPath || 'Companion.exe');
    const portableDirCandidate = envPortableDir ? path.join(envPortableDir, exeBaseName) : '';
    const cwdCandidate = path.join(process.cwd(), exeBaseName);
    const candidates = [envPortableFile, envPortablePath, portableDirCandidate, cwdCandidate, argv0, execPath].filter(Boolean);

    const nonTempExistingExe = candidates.find((candidate) => {
      const c = String(candidate);
      return c.toLowerCase().endsWith('.exe') && fs.existsSync(c) && !isLikelyTempPath(c);
    });

    const anyExistingExe = candidates.find((candidate) => {
      const c = String(candidate);
      return c.toLowerCase().endsWith('.exe') && fs.existsSync(c);
    });

    const currentExePath = nonTempExistingExe || anyExistingExe || envPortableFile || envPortablePath || portableDirCandidate || cwdCandidate || argv0 || execPath;
    const currentDir = path.dirname(currentExePath);
    const exeName = path.basename(currentExePath);
    return { currentExePath, currentDir, exeName };
  }

  /**
   * Resolve redirecionamentos HTTP (absolutos ou relativos) a partir da URL original.
   * @param {string|undefined} location
   * @param {string} baseUrl
   * @returns {string|null}
   */
  resolveRedirectUrl(location, baseUrl) {
    if (!location) return null;
    try {
      return new URL(location, baseUrl).toString();
    } catch {
      return null;
    }
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
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const redirectUrl = this.resolveRedirectUrl(res.headers.location, url);
          if (!redirectUrl) {
            return reject(new Error('Redirecionamento sem header Location válido.'));
          }
          res.resume();
          return this.fetchJson(redirectUrl).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
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
      const assets = Array.isArray(release.assets) ? release.assets : [];
      const { exeName } = this.getPaths();
      const normalizedExeName = String(exeName || '').toLowerCase();

      this.exeAsset = assets.find(asset => String(asset.name || '').toLowerCase() === normalizedExeName)
        || assets.find(asset => {
          const name = String(asset.name || '').toLowerCase();
          return name.endsWith('.exe') && !name.includes('setup');
        })
        || assets.find(asset => String(asset.name || '').toLowerCase().endsWith('.exe'));
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
      width: 420,
      height: 250,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000', // Previne o bug de pixels pretos nas bordas no Windows DWM
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
        const { currentDir, exeName } = this.getPaths();
        const versionSuffix = String(this.latestVersion || 'latest')
          .trim()
          .replace(/^v/i, '')
          .replace(/[\\/:*?"<>|]/g, '_')
          .replace(/\s+/g, '_');
        const appBaseName = String(this.repoName || path.parse(exeName).name || 'Companion')
          .trim()
          .replace(/[\\/:*?"<>|]/g, '_')
          .replace(/\s+/g, '-');
        const downloadFileName = `${appBaseName}-${versionSuffix}.exe`;
        const downloadDestPath = path.join(currentDir, downloadFileName);

        try {
          fs.unlinkSync(downloadDestPath);
        } catch {
          // Ignora se o arquivo temporário anterior não existir.
        }
        
        await this.downloadFile(this.exeAsset.browser_download_url, downloadDestPath, (progress) => {
          if (this.updateWindow && !this.updateWindow.isDestroyed()) {
            this.updateWindow.webContents.send('update-progress', progress);
          }
        });

        // Etapa 2: remove o executavel antigo e inicia o novo (com versao no nome).
        this.applyUpdate(downloadDestPath);
        return;

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
      const tempPath = `${destPath}.download`;
      const headers = { 'User-Agent': 'Companion-App-Updater' };
      if (process.env.GITHUB_TOKEN && url.includes('api.github.com')) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }
      const options = { headers };

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignora se o temporário não existir.
      }

      https.get(url, options, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const redirectUrl = this.resolveRedirectUrl(res.headers.location, url);
          if (!redirectUrl) {
            return reject(new Error('Redirecionamento sem header Location válido.'));
          }
          res.resume();
          return this.downloadFile(redirectUrl, destPath, progressCallback).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Erro HTTP no download: ${res.statusCode}`));
        }

        const totalBytes = parseInt(res.headers['content-length'], 10) || 0;
        let downloadedBytes = 0;
        let settled = false;

        const fileStream = fs.createWriteStream(tempPath);
        const fail = (err) => {
          if (settled) return;
          settled = true;
          fileStream.destroy();
          fs.unlink(tempPath, () => {});
          reject(err);
        };
        const succeed = () => {
          if (settled) return;
          settled = true;
          try {
            fs.renameSync(tempPath, destPath);
            resolve();
          } catch (err) {
            reject(err);
          }
        };
        
        res.on('data', (chunk) => {
          downloadedBytes += chunk.length;
          if (totalBytes > 0 && progressCallback) {
            const percentage = (downloadedBytes / totalBytes) * 100;
            progressCallback(percentage);
          }
        });

        res.on('aborted', () => fail(new Error('Download interrompido antes da conclusão.')));
        res.on('error', fail);
        res.pipe(fileStream);
        
        fileStream.on('finish', () => {
          fileStream.close(() => {
            if (totalBytes > 0 && downloadedBytes !== totalBytes) {
              return fail(new Error(`Download incompleto: ${downloadedBytes}/${totalBytes} bytes.`));
            }
            succeed();
          });
        });
        
        fileStream.on('error', fail);
      }).on('error', reject);
    });
  }

  /**
   * Fecha o executavel antigo, remove-o e inicia o novo arquivo baixado.
   * O novo arquivo permanece com versao no nome (ex.: Companion-1.2.3.exe).
   * @param {string} newExePath - Caminho completo do novo executavel baixado.
   */
  applyUpdate(newExePath) {
    const { currentExePath, currentDir, exeName } = this.getPaths();
    const batPath = path.join(currentDir, 'atualizar.bat');
    const oldExeEsc = String(currentExePath).replace(/"/g, '""');
    const newExeEsc = String(newExePath).replace(/"/g, '""');
    const oldNameEsc = String(exeName).replace(/"/g, '""');

    const batContent = `@echo off
setlocal EnableExtensions
cd /d "${currentDir}"

set "OLD_EXE=${oldExeEsc}"
set "NEW_EXE=${newExeEsc}"
set "OLD_NAME=${oldNameEsc}"

if not exist "%NEW_EXE%" goto cleanup

timeout /t 2 /nobreak >nul

for /l %%I in (1,1,80) do (
  taskkill /f /t /im "%OLD_NAME%" >nul 2>&1
  if not exist "%OLD_EXE%" goto start_new
  del /f /q "%OLD_EXE%" >nul 2>&1
  if not exist "%OLD_EXE%" goto start_new
  timeout /t 1 /nobreak >nul
)

if exist "%OLD_EXE%" ren "%OLD_EXE%" "%OLD_NAME%.old" >nul 2>&1

:start_new
if exist "%NEW_EXE%" start "" "%NEW_EXE%"

:cleanup
del /f /q "%~f0" >nul 2>&1
`;

    fs.writeFileSync(batPath, batContent, 'utf8');

    spawn('cmd.exe', ['/d', '/c', batPath], {
      cwd: currentDir,
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    }).unref();

    app.quit();
  }
}

module.exports = AppUpdater;
