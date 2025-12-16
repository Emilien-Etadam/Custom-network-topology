const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const { Client } = require('ssh2');
const net = require('net');
const dns = require('dns');
const { exec } = require('child_process');
const os = require('os');

// Store active SSH connections
const sshConnections = new Map();

// Main window reference
let mainWindow;

// Configuration paths
const getConfigPath = () => path.join(app.getPath('userData'), 'config.json');
const getStatusPath = () => path.join(app.getPath('userData'), 'status.json');

// ============================================
// Password Encryption Utilities
// ============================================

function encryptPassword(password) {
  if (!password) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(password);
      return encrypted.toString('base64');
    }
  } catch (e) {
    console.error('Encryption failed:', e);
  }
  // Fallback: return as-is (not recommended for production)
  return password;
}

function decryptPassword(encryptedPassword) {
  if (!encryptedPassword) return null;
  try {
    if (safeStorage.isEncryptionAvailable()) {
      const buffer = Buffer.from(encryptedPassword, 'base64');
      return safeStorage.decryptString(buffer);
    }
  } catch (e) {
    // If decryption fails, it might be a plain text password (legacy)
    return encryptedPassword;
  }
  return encryptedPassword;
}

function encryptConfigPasswords(config) {
  if (!config || !config.nodes) return config;

  const encrypted = JSON.parse(JSON.stringify(config));
  encrypted.nodes = encrypted.nodes.map(node => {
    if (node.sshPass && !node._encrypted) {
      return {
        ...node,
        sshPass: encryptPassword(node.sshPass),
        _encrypted: true
      };
    }
    return node;
  });
  return encrypted;
}

function decryptConfigPasswords(config) {
  if (!config || !config.nodes) return config;

  const decrypted = JSON.parse(JSON.stringify(config));
  decrypted.nodes = decrypted.nodes.map(node => {
    if (node.sshPass && node._encrypted) {
      return {
        ...node,
        sshPass: decryptPassword(node.sshPass),
        _encrypted: false
      };
    }
    return node;
  });
  return decrypted;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 768,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: 'Network Topology'
  });

  // Load the main HTML file
  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  // Open DevTools in development
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    // Close all SSH connections when window closes
    sshConnections.forEach((conn, id) => {
      try {
        conn.end();
      } catch (e) {}
    });
    sshConnections.clear();
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// ============================================
// IPC HANDLERS - File Operations
// ============================================

ipcMain.handle('config:load', async () => {
  try {
    const configPath = getConfigPath();
    // If no user config exists, copy from default
    if (!fs.existsSync(configPath)) {
      const defaultConfig = path.join(__dirname, 'renderer', 'config.json');
      if (fs.existsSync(defaultConfig)) {
        fs.copyFileSync(defaultConfig, configPath);
      } else {
        // Return default empty config
        return {
          settings: { showGrid: true, gridSize: 100, snapToGrid: true },
          nodes: [],
          connections: []
        };
      }
    }
    const data = fs.readFileSync(configPath, 'utf8');
    const config = JSON.parse(data);
    // Decrypt passwords before sending to renderer
    return decryptConfigPasswords(config);
  } catch (error) {
    console.error('Error loading config:', error);
    return { settings: { showGrid: true, gridSize: 100, snapToGrid: true }, nodes: [], connections: [] };
  }
});

ipcMain.handle('config:save', async (event, config) => {
  try {
    const configPath = getConfigPath();
    // Encrypt passwords before saving
    const encryptedConfig = encryptConfigPasswords(config);
    fs.writeFileSync(configPath, JSON.stringify(encryptedConfig, null, 2));
    return { success: true };
  } catch (error) {
    console.error('Error saving config:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('config:export', async (event, config) => {
  try {
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export Configuration',
      defaultPath: 'topology-config.json',
      filters: [{ name: 'JSON Files', extensions: ['json'] }]
    });

    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, JSON.stringify(config, null, 2));
      return { success: true, path: result.filePath };
    }
    return { success: false, canceled: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('config:import', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import Configuration',
      filters: [{ name: 'JSON Files', extensions: ['json'] }],
      properties: ['openFile']
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const data = fs.readFileSync(result.filePaths[0], 'utf8');
      return { success: true, config: JSON.parse(data) };
    }
    return { success: false, canceled: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

// ============================================
// IPC HANDLERS - SSH Connections
// ============================================

ipcMain.handle('ssh:browseKey', async () => {
  try {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Select SSH Private Key',
      properties: ['openFile'],
      filters: [
        { name: 'SSH Keys', extensions: ['pem', 'key', 'ppk', ''] },
        { name: 'All Files', extensions: ['*'] }
      ],
      defaultPath: require('os').homedir() + '/.ssh'
    });

    if (!result.canceled && result.filePaths.length > 0) {
      return { success: true, path: result.filePaths[0] };
    }
    return { success: false, canceled: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
});

ipcMain.handle('ssh:connect', async (event, connectionInfo) => {
  const { nodeId, host, port = 22, username, password, privateKeyPath, passphrase } = connectionInfo;

  return new Promise((resolve) => {
    const conn = new Client();

    conn.on('ready', () => {
      conn.shell({ term: 'xterm-256color' }, (err, stream) => {
        if (err) {
          conn.end();
          resolve({ success: false, error: err.message });
          return;
        }

        // Store connection with stream
        sshConnections.set(nodeId, { conn, stream });

        stream.on('data', (data) => {
          mainWindow.webContents.send('ssh:data', { nodeId, data: data.toString() });
        });

        stream.on('close', () => {
          mainWindow.webContents.send('ssh:closed', { nodeId });
          sshConnections.delete(nodeId);
        });

        stream.stderr.on('data', (data) => {
          mainWindow.webContents.send('ssh:data', { nodeId, data: data.toString() });
        });

        resolve({ success: true });
      });
    });

    conn.on('error', (err) => {
      resolve({ success: false, error: err.message });
    });

    conn.on('close', () => {
      mainWindow.webContents.send('ssh:closed', { nodeId });
      sshConnections.delete(nodeId);
    });

    // Connect with password or private key
    const connectConfig = {
      host,
      port,
      username,
      readyTimeout: 10000,
      keepaliveInterval: 10000
    };

    // Handle private key authentication
    if (privateKeyPath) {
      try {
        connectConfig.privateKey = fs.readFileSync(privateKeyPath);
        if (passphrase) {
          connectConfig.passphrase = passphrase;
        }
      } catch (keyError) {
        resolve({ success: false, error: `Failed to read private key: ${keyError.message}` });
        return;
      }
    } else if (password) {
      connectConfig.password = password;
    }

    try {
      conn.connect(connectConfig);
    } catch (error) {
      resolve({ success: false, error: error.message });
    }
  });
});

ipcMain.handle('ssh:write', async (event, { nodeId, data }) => {
  const connection = sshConnections.get(nodeId);
  if (connection && connection.stream) {
    connection.stream.write(data);
    return { success: true };
  }
  return { success: false, error: 'Connection not found' };
});

ipcMain.handle('ssh:resize', async (event, { nodeId, cols, rows }) => {
  const connection = sshConnections.get(nodeId);
  if (connection && connection.stream) {
    connection.stream.setWindow(rows, cols, 0, 0);
    return { success: true };
  }
  return { success: false, error: 'Connection not found' };
});

ipcMain.handle('ssh:disconnect', async (event, nodeId) => {
  const connection = sshConnections.get(nodeId);
  if (connection) {
    try {
      connection.conn.end();
    } catch (e) {}
    sshConnections.delete(nodeId);
    return { success: true };
  }
  return { success: false, error: 'Connection not found' };
});

// ============================================
// IPC HANDLERS - Network Discovery
// ============================================

ipcMain.handle('network:getLocalInfo', async () => {
  const interfaces = os.networkInterfaces();
  const result = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({
          interface: name,
          address: addr.address,
          netmask: addr.netmask,
          mac: addr.mac
        });
      }
    }
  }

  return result;
});

ipcMain.handle('network:ping', async (event, host) => {
  return new Promise((resolve) => {
    const start = Date.now();
    const isWindows = process.platform === 'win32';
    const cmd = isWindows
      ? `ping -n 1 -w 1000 ${host}`
      : `ping -c 1 -W 1 ${host}`;

    exec(cmd, (error, stdout) => {
      const duration = Date.now() - start;
      if (error) {
        resolve({ success: false, host, duration });
      } else {
        resolve({ success: true, host, duration });
      }
    });
  });
});

ipcMain.handle('network:portCheck', async (event, { host, port, timeout = 2000 }) => {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const start = Date.now();

    socket.setTimeout(timeout);

    socket.on('connect', () => {
      socket.destroy();
      resolve({ success: true, host, port, duration: Date.now() - start });
    });

    socket.on('error', () => {
      socket.destroy();
      resolve({ success: false, host, port, duration: Date.now() - start });
    });

    socket.on('timeout', () => {
      socket.destroy();
      resolve({ success: false, host, port, duration: timeout });
    });

    socket.connect(port, host);
  });
});

ipcMain.handle('network:scan', async (event, { baseIp, startRange, endRange }) => {
  // Scan IP range for active hosts
  const results = [];
  const scanPromises = [];

  for (let i = startRange; i <= endRange; i++) {
    const ip = `${baseIp}.${i}`;
    scanPromises.push(
      new Promise((resolve) => {
        const isWindows = process.platform === 'win32';
        const cmd = isWindows
          ? `ping -n 1 -w 500 ${ip}`
          : `ping -c 1 -W 1 ${ip}`;

        exec(cmd, (error) => {
          if (!error) {
            results.push({ ip, online: true });
          }
          resolve();
        });
      })
    );

    // Batch pings to avoid overwhelming the system
    if (scanPromises.length >= 20) {
      await Promise.all(scanPromises);
      scanPromises.length = 0;
      // Report progress
      mainWindow.webContents.send('network:scanProgress', {
        current: i - startRange + 1,
        total: endRange - startRange + 1,
        found: results.length
      });
    }
  }

  // Wait for remaining pings
  await Promise.all(scanPromises);

  return results;
});

ipcMain.handle('network:arp', async () => {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const cmd = isWindows ? 'arp -a' : 'arp -a';

    exec(cmd, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }

      const entries = [];
      const lines = stdout.split('\n');

      for (const line of lines) {
        // Parse ARP table entries
        const match = isWindows
          ? line.match(/(\d+\.\d+\.\d+\.\d+)\s+([\da-f-]+)/i)
          : line.match(/\((\d+\.\d+\.\d+\.\d+)\)\s+at\s+([\da-f:]+)/i);

        if (match) {
          entries.push({
            ip: match[1],
            mac: match[2].replace(/-/g, ':').toLowerCase()
          });
        }
      }

      resolve(entries);
    });
  });
});

ipcMain.handle('network:resolve', async (event, hostname) => {
  return new Promise((resolve) => {
    dns.lookup(hostname, (err, address) => {
      if (err) {
        resolve({ success: false, hostname });
      } else {
        resolve({ success: true, hostname, address });
      }
    });
  });
});

// ============================================
// IPC HANDLERS - Monitoring
// ============================================

let monitoringInterval = null;
let monitoringConfig = null;

ipcMain.handle('monitor:start', async (event, config) => {
  monitoringConfig = config;

  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  const runMonitoring = async () => {
    if (!monitoringConfig || !monitoringConfig.nodes) return;

    const statusResults = await Promise.all(
      monitoringConfig.nodes.map(async (node) => {
        const start = Date.now();
        let online = false;

        if (node.port) {
          // TCP port check
          online = await new Promise((resolve) => {
            const socket = new net.Socket();
            socket.setTimeout(1000);
            socket.on('connect', () => {
              socket.destroy();
              resolve(true);
            });
            socket.on('error', () => {
              socket.destroy();
              resolve(false);
            });
            socket.on('timeout', () => {
              socket.destroy();
              resolve(false);
            });
            socket.connect(node.port, node.address);
          });
        } else {
          // Ping check
          const isWindows = process.platform === 'win32';
          const cmd = isWindows
            ? `ping -n 1 -w 500 ${node.address}`
            : `ping -c 1 -W 1 ${node.address}`;

          online = await new Promise((resolve) => {
            exec(cmd, (error) => resolve(!error));
          });
        }

        return {
          ...node,
          status: online,
          responseTime: Date.now() - start
        };
      })
    );

    mainWindow.webContents.send('monitor:status', {
      nodes: statusResults,
      updated: new Date().toLocaleTimeString()
    });
  };

  // Run immediately then on interval
  await runMonitoring();
  monitoringInterval = setInterval(runMonitoring, config.interval || 2000);

  return { success: true };
});

ipcMain.handle('monitor:stop', async () => {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
  }
  return { success: true };
});

// ============================================
// IPC HANDLERS - Window Controls
// ============================================

ipcMain.handle('window:minimize', () => {
  mainWindow.minimize();
});

ipcMain.handle('window:maximize', () => {
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize();
  } else {
    mainWindow.maximize();
  }
});

ipcMain.handle('window:close', () => {
  mainWindow.close();
});
