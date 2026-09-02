const { app, BrowserWindow } = require('electron');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

/**
 * AppUpdater - atualizacao silenciosa via GitHub Releases.
 *
 * Fluxo:
 *  1. Ao abrir o app, consulta o release mais recente sem exibir nada.
 *  2. Havendo versao nova, baixa o INSTALADOR em segundo plano e avisa a
 *     janela principal, que mostra um icone discreto de download no topo.
 *  3. Terminado o download, o icone muda de estado. Clicando nele, a interface
 *     abre um modal dizendo que a atualizacao entra na proxima inicializacao.
 *  4. Ao fechar o app, o instalador roda em modo silencioso (/S). Na proxima
 *     abertura o usuario ja esta na versao nova.
 *
 * Nada aqui bloqueia a inicializacao nem exibe dialogo do sistema: uma falha de
 * rede so deixa o app seguir na versao atual.
 */
class AppUpdater {
  constructor(currentVersion, repoOwner, repoName) {
    this.currentVersion = currentVersion;
    this.repoOwner = repoOwner;
    this.repoName = repoName;
    this.installerAsset = null;
    this.latestVersion = null;
    this.installerPath = null;
    this.estado = 'idle';
  }

  /** Pasta onde o instalador baixado fica ate a hora de rodar. */
  getUpdateDir() {
    return path.join(app.getPath('userData'), 'updates');
  }

  /**
   * Manda o estado atual da atualizacao para todas as janelas abertas.
   * A interface decide o que mostrar; o processo principal nao abre nada.
   * @param {'idle'|'baixando'|'pronta'|'erro'} estado
   * @param {object} extra
   */
  notificar(estado, extra = {}) {
    this.estado = estado;
    const payload = { estado, versao: this.latestVersion, ...extra };
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('update-status', payload);
      }
    });
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
   * Compara duas versoes semanticas.
   * @param {string} latest - Tag do GitHub (ex: "v1.1.0" ou "1.1.0").
   * @param {string} current - Versao instalada (ex: "1.0.0").
   * @returns {boolean}
   */
  isNewerVersion(latest, current) {
    const clean = (v) => String(v).replace(/^v/i, '').split('.').map((n) => Number(n) || 0);
    const [lMajor = 0, lMinor = 0, lPatch = 0] = clean(latest);
    const [cMajor = 0, cMinor = 0, cPatch = 0] = clean(current);

    if (lMajor !== cMajor) return lMajor > cMajor;
    if (lMinor !== cMinor) return lMinor > cMinor;
    return lPatch > cPatch;
  }

  /**
   * Faz requisicoes HTTPS e segue redirecionamentos retornando JSON.
   * @param {string} url
   * @returns {Promise<any>}
   */
  fetchJson(url) {
    return new Promise((resolve, reject) => {
      const headers = { 'User-Agent': 'Companion-App-Updater' };
      if (process.env.GITHUB_TOKEN && url.includes('api.github.com')) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }
      https.get(url, { headers }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const redirectUrl = this.resolveRedirectUrl(res.headers.location, url);
          if (!redirectUrl) return reject(new Error('Redirecionamento sem header Location valido.'));
          res.resume();
          return this.fetchJson(redirectUrl).then(resolve).catch(reject);
        }
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`Erro HTTP: ${res.statusCode}`));
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
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
   * Escolhe o instalador entre os assets do release.
   * O release publica o setup do NSIS (Companion-Setup-<versao>.exe); um .exe
   * solto (build portatil antigo) e ignorado de proposito, porque nao sabe se
   * instalar sozinho.
   * @param {Array} assets
   * @returns {object|null}
   */
  encontrarInstalador(assets) {
    const lista = Array.isArray(assets) ? assets : [];
    const nome = (a) => String(a?.name || '').toLowerCase();
    return lista.find((a) => /setup.*\.exe$/.test(nome(a)))
      || lista.find((a) => nome(a).endsWith('.exe') && nome(a).includes('install'))
      || null;
  }

  /**
   * Roda na inicializacao, sem interface. Se houver versao nova, ja dispara o
   * download em segundo plano.
   * @returns {Promise<void>}
   */
  async checkForUpdates() {
    try {
      const url = `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/releases/latest`;
      const release = await this.fetchJson(url);

      this.latestVersion = release?.tag_name;
      if (!this.latestVersion) return;

      if (!this.isNewerVersion(this.latestVersion, this.currentVersion)) {
        console.log('[Updater] Ja esta na versao mais recente:', this.currentVersion);
        return;
      }

      this.installerAsset = this.encontrarInstalador(release.assets);
      if (!this.installerAsset) {
        console.warn('[Updater] Release sem instalador (.exe de setup); nada a fazer.');
        return;
      }

      await this.baixarAtualizacao();
    } catch (error) {
      // Silencioso de proposito: sem rede, o app simplesmente segue na versao atual.
      console.error('[Updater] Falha ao verificar atualizacoes:', error.message);
    }
  }

  /**
   * Baixa o instalador em segundo plano, publicando progresso para a interface.
   */
  async baixarAtualizacao() {
    const destDir = this.getUpdateDir();
    const nomeArquivo = String(this.installerAsset.name || 'Companion-Setup.exe')
      .replace(/[\\/:*?"<>|]/g, '_');
    const destPath = path.join(destDir, nomeArquivo);

    try {
      fs.mkdirSync(destDir, { recursive: true });
      this.limparInstaladoresAntigos(destDir, nomeArquivo);

      // Se o instalador desta versao ja foi baixado numa sessao anterior,
      // nao baixa de novo — so reavisa que esta pronto.
      if (fs.existsSync(destPath) && fs.statSync(destPath).size === this.installerAsset.size) {
        this.installerPath = destPath;
        this.notificar('pronta');
        return;
      }

      this.notificar('baixando', { progresso: 0 });

      await this.downloadFile(this.installerAsset.browser_download_url, destPath, (progresso) => {
        this.notificar('baixando', { progresso });
      });

      this.installerPath = destPath;
      this.notificar('pronta');
      console.log('[Updater] Atualizacao', this.latestVersion, 'pronta para instalar ao sair.');
    } catch (error) {
      console.error('[Updater] Falha no download da atualizacao:', error.message);
      this.installerPath = null;
      this.notificar('erro', { mensagem: error.message });
    }
  }

  /** Remove instaladores de versoes anteriores para nao acumular no disco. */
  limparInstaladoresAntigos(destDir, manter) {
    try {
      fs.readdirSync(destDir).forEach((arquivo) => {
        if (arquivo !== manter) {
          try {
            fs.unlinkSync(path.join(destDir, arquivo));
          } catch {
            // Arquivo em uso ou ja removido: ignorar.
          }
        }
      });
    } catch {
      // Pasta recem-criada ou inacessivel: nada a limpar.
    }
  }

  /**
   * Baixa um arquivo seguindo redirecionamentos, com progresso em 0-100.
   * @param {string} url
   * @param {string} destPath
   * @param {function} progressCallback
   * @returns {Promise<void>}
   */
  downloadFile(url, destPath, progressCallback) {
    return new Promise((resolve, reject) => {
      const tempPath = `${destPath}.download`;
      const headers = { 'User-Agent': 'Companion-App-Updater' };
      if (process.env.GITHUB_TOKEN && url.includes('api.github.com')) {
        headers['Authorization'] = `token ${process.env.GITHUB_TOKEN}`;
      }

      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // Ignora se o temporario nao existir.
      }

      https.get(url, { headers }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          const redirectUrl = this.resolveRedirectUrl(res.headers.location, url);
          if (!redirectUrl) return reject(new Error('Redirecionamento sem header Location valido.'));
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
        let ultimoAviso = -1;

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
            const pct = Math.floor((downloadedBytes / totalBytes) * 100);
            // Avisa so a cada ponto percentual: sem isso sao milhares de
            // mensagens de IPC por download, o que trava a interface.
            if (pct !== ultimoAviso) {
              ultimoAviso = pct;
              progressCallback(pct);
            }
          }
        });

        res.on('aborted', () => fail(new Error('Download interrompido antes da conclusao.')));
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

  /** Ha uma atualizacao baixada esperando para ser instalada? */
  temAtualizacaoPronta() {
    return Boolean(this.installerPath && fs.existsSync(this.installerPath));
  }

  /**
   * Roda o instalador em modo silencioso e sai. Chamado no encerramento do app,
   * para que a versao nova esteja no lugar na proxima abertura.
   *
   * '/S' e o modo silencioso do NSIS. Sem console, sem assistente, sem clique.
   */
  instalarAoSair() {
    if (!this.temAtualizacaoPronta()) return false;

    try {
      spawn(this.installerPath, ['/S'], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }).unref();
      console.log('[Updater] Instalador silencioso disparado:', this.installerPath);
      return true;
    } catch (error) {
      console.error('[Updater] Falha ao iniciar o instalador:', error.message);
      return false;
    }
  }
}

module.exports = AppUpdater;
