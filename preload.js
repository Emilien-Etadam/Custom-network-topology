const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('electronAPI', {
  // ============================================
  // Configuration Management
  // ============================================
  config: {
    load: () => ipcRenderer.invoke('config:load'),
    save: (config) => ipcRenderer.invoke('config:save', config),
    export: (config) => ipcRenderer.invoke('config:export', config),
    import: () => ipcRenderer.invoke('config:import')
  },

  // ============================================
  // SSH Terminal
  // ============================================
  ssh: {
    connect: (connectionInfo) => ipcRenderer.invoke('ssh:connect', connectionInfo),
    write: (nodeId, data) => ipcRenderer.invoke('ssh:write', { nodeId, data }),
    resize: (nodeId, cols, rows) => ipcRenderer.invoke('ssh:resize', { nodeId, cols, rows }),
    disconnect: (nodeId) => ipcRenderer.invoke('ssh:disconnect', nodeId),

    // Event listeners for SSH data
    onData: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('ssh:data', handler);
      return () => ipcRenderer.removeListener('ssh:data', handler);
    },
    onClosed: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('ssh:closed', handler);
      return () => ipcRenderer.removeListener('ssh:closed', handler);
    }
  },

  // ============================================
  // Network Discovery & Tools
  // ============================================
  network: {
    getLocalInfo: () => ipcRenderer.invoke('network:getLocalInfo'),
    ping: (host) => ipcRenderer.invoke('network:ping', host),
    portCheck: (host, port, timeout) => ipcRenderer.invoke('network:portCheck', { host, port, timeout }),
    scan: (baseIp, startRange, endRange) => ipcRenderer.invoke('network:scan', { baseIp, startRange, endRange }),
    arp: () => ipcRenderer.invoke('network:arp'),
    resolve: (hostname) => ipcRenderer.invoke('network:resolve', hostname),

    // Event listener for scan progress
    onScanProgress: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('network:scanProgress', handler);
      return () => ipcRenderer.removeListener('network:scanProgress', handler);
    }
  },

  // ============================================
  // Monitoring
  // ============================================
  monitor: {
    start: (config) => ipcRenderer.invoke('monitor:start', config),
    stop: () => ipcRenderer.invoke('monitor:stop'),

    // Event listener for status updates
    onStatus: (callback) => {
      const handler = (event, data) => callback(data);
      ipcRenderer.on('monitor:status', handler);
      return () => ipcRenderer.removeListener('monitor:status', handler);
    }
  },

  // ============================================
  // Window Controls
  // ============================================
  window: {
    minimize: () => ipcRenderer.invoke('window:minimize'),
    maximize: () => ipcRenderer.invoke('window:maximize'),
    close: () => ipcRenderer.invoke('window:close')
  },

  // ============================================
  // Platform Info
  // ============================================
  platform: process.platform,
  isElectron: true
});

// Log that preload script loaded
console.log('Preload script loaded successfully');
