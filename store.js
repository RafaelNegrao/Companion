// store.js - Gerenciamento de dados persistentes no appData
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

class Store {
  constructor() {
    const userDataPath = app.getPath('userData');
    this.filePath = path.join(userDataPath, 'user-preferences.json');
    this.data = this.loadData();
  }

  loadData() {
    try {
      if (fs.existsSync(this.filePath)) {
        const rawData = fs.readFileSync(this.filePath, 'utf-8');
        return JSON.parse(rawData);
      }
    } catch (error) {
      console.error('Erro ao carregar dados:', error);
    }
    return {};
  }

  saveData() {
    try {
      const userDataPath = path.dirname(this.filePath);
      if (!fs.existsSync(userDataPath)) {
        fs.mkdirSync(userDataPath, { recursive: true });
      }
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2));
    } catch (error) {
      console.error('Erro ao salvar dados:', error);
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.saveData();
  }

  delete(key) {
    delete this.data[key];
    this.saveData();
  }

  clear() {
    this.data = {};
    this.saveData();
  }
}

module.exports = Store;
