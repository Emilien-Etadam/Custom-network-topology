// ============================================
// Network Topology Application
// ============================================

// State
let config = { settings: { showGrid: true, gridSize: 100, snapToGrid: true }, nodes: [] };
let networkData = [];
let terminals = new Map();
let activeTerminal = null;
let monitoringActive = false;
let contextMenuNode = null;
let uptimeTrackers = new Map();

// Zoom/Pan Variables
let scale = 1, pointX = 0, pointY = 0, isPanning = false, startX = 0, startY = 0;

// Drag Variables
let isDragging = false, dragNode = null, dragStartX = 0, dragStartY = 0, nodeStartX = 0, nodeStartY = 0;

// Grid System Constants
const gridCols = [];
for (let i = 0; i < 26; i++) gridCols.push(String.fromCharCode(65 + i));
for (let i = 0; i < 26; i++) gridCols.push('A' + String.fromCharCode(65 + i));

// DOM Elements
const viewport = document.getElementById('viewport');
const world = document.getElementById('world');

// ============================================
// Initialization
// ============================================

async function init() {
  lucide.createIcons();
  drawGridSystem();
  setupEventListeners();
  await loadConfig();
  setupMonitoringListener();

  // Check if running in Electron
  if (window.electronAPI) {
    console.log('Running in Electron');
    startMonitoring();
  } else {
    console.log('Running in browser - monitoring disabled');
  }
}

async function loadConfig() {
  try {
    if (window.electronAPI) {
      config = await window.electronAPI.config.load();
    } else {
      // Fallback for browser testing
      const res = await fetch('config.json');
      if (res.ok) config = await res.json();
    }

    // Ensure settings exist
    config.settings = config.settings || { showGrid: true, gridSize: 100, snapToGrid: true };
    config.nodes = config.nodes || [];

    updateSnapButton();
    renderTree(config.nodes);
    renderHostList(config.nodes);
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

async function saveConfig() {
  try {
    if (window.electronAPI) {
      await window.electronAPI.config.save(config);
    }
  } catch (error) {
    console.error('Failed to save config:', error);
  }
}

// ============================================
// Grid System
// ============================================

function drawGridSystem() {
  const labelContainer = document.getElementById('grid-labels');
  labelContainer.innerHTML = '';

  gridCols.forEach((char, i) => {
    const el = document.createElement('div');
    el.className = 'grid-label';
    el.innerText = char;
    el.style.top = '0';
    el.style.left = (i * 5) + 'vw';
    el.style.width = '5vw';
    el.style.height = '20px';
    labelContainer.appendChild(el);
  });

  for (let i = 1; i <= 50; i++) {
    const el = document.createElement('div');
    el.className = 'grid-label';
    el.innerText = i;
    el.style.left = '0';
    el.style.top = ((i - 1) * 5) + 'vh';
    el.style.height = '5vh';
    el.style.width = '20px';
    el.style.justifyContent = 'flex-start';
    el.style.paddingLeft = '4px';
    labelContainer.appendChild(el);
  }
}

function snapToGrid(x, y) {
  if (!config.settings.snapToGrid) return { x, y };

  // Snap to 5% grid (matching the visual grid)
  const gridStep = 5;
  const offset = 2.5; // Center of grid cell

  const snappedX = Math.round((x - offset) / gridStep) * gridStep + offset;
  const snappedY = Math.round((y - offset) / gridStep) * gridStep + offset;

  return {
    x: Math.max(2.5, Math.min(97.5, snappedX)),
    y: Math.max(2.5, Math.min(97.5, snappedY))
  };
}

function getGridCell(x, y) {
  const colIndex = Math.floor((x - 0.01) / 5);
  const rowIndex = Math.floor((y - 0.01) / 5) + 1;

  const col = colIndex >= 0 && colIndex < gridCols.length ? gridCols[colIndex] : '?';
  const row = rowIndex >= 1 && rowIndex <= 50 ? rowIndex : '?';

  return { col, row };
}

// ============================================
// Zoom & Pan
// ============================================

function setupEventListeners() {
  // Zoom
  viewport.addEventListener('wheel', (e) => {
    e.preventDefault();
    const xs = (e.clientX - pointX) / scale;
    const ys = (e.clientY - pointY) / scale;
    const delta = -e.deltaY;
    scale = delta > 0 ? scale * 1.1 : scale / 1.1;
    scale = Math.min(Math.max(0.1, scale), 5);
    pointX = e.clientX - xs * scale;
    pointY = e.clientY - ys * scale;
    updateTransform();
  });

  // Pan
  viewport.addEventListener('mousedown', (e) => {
    if (e.target.closest('.node-container')) return;
    isPanning = true;
    startX = e.clientX - pointX;
    startY = e.clientY - pointY;
  });

  window.addEventListener('mousemove', (e) => {
    if (isDragging && dragNode) {
      handleNodeDrag(e);
      return;
    }
    if (!isPanning) return;
    e.preventDefault();
    pointX = e.clientX - startX;
    pointY = e.clientY - startY;
    updateTransform();
  });

  window.addEventListener('mouseup', () => {
    isPanning = false;
    if (isDragging && dragNode) {
      endNodeDrag();
    }
  });

  // Context menu
  document.addEventListener('click', () => hideContextMenu());
  document.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('.node-container')) {
      hideContextMenu();
    }
  });

  // Toolbar buttons
  document.getElementById('btn-admin').addEventListener('click', () => {
    window.location.href = 'admin.html';
  });

  document.getElementById('btn-discover').addEventListener('click', openDiscoveryModal);
  document.getElementById('btn-snap').addEventListener('click', toggleSnapToGrid);

  document.getElementById('btn-import').addEventListener('click', async () => {
    if (window.electronAPI) {
      const result = await window.electronAPI.config.import();
      if (result.success) {
        config = result.config;
        config.settings = config.settings || { showGrid: true, gridSize: 100, snapToGrid: true };
        renderTree(config.nodes);
        renderHostList(config.nodes);
      }
    }
  });

  document.getElementById('btn-export').addEventListener('click', async () => {
    if (window.electronAPI) {
      await window.electronAPI.config.export(config);
    }
  });

  document.getElementById('btn-monitoring').addEventListener('click', toggleMonitoring);

  // Window resize
  window.addEventListener('resize', () => {
    if (networkData.length) renderTree(networkData);
  });
}

function updateTransform() {
  world.style.transform = `translate(${pointX}px, ${pointY}px) scale(${scale})`;
}

// ============================================
// Node Rendering
// ============================================

function renderTree(nodes) {
  const container = document.getElementById('tree-container');
  container.innerHTML = '';

  const nodeMap = {};
  nodes.forEach(n => {
    n.primaryParentId = (n.primaryParentId && n.primaryParentId !== '') ? n.primaryParentId : null;
    n.activeParentId = (n.activeParentId && n.activeParentId !== '') ? n.activeParentId : n.primaryParentId;
    n.level = 0;
    nodeMap[n.id] = n;
  });

  // Calculate levels
  for (let i = 0; i < 6; i++) {
    nodes.forEach(n => {
      if (n.primaryParentId && nodeMap[n.primaryParentId]) {
        n.level = Math.max(n.level, nodeMap[n.primaryParentId].level + 1);
      }
    });
  }

  const maxLevel = nodes.reduce((m, x) => Math.max(m, x.level || 0), 0);
  const levels = {};
  for (let l = 0; l <= maxLevel; l++) {
    levels[l] = nodes.filter(n => n.level === l);
  }

  nodes.forEach(node => {
    const el = document.createElement('div');
    el.id = `node-${node.id}`;
    el.className = 'node-container card';
    el.dataset.nodeId = node.id;

    let leftPos, topPos;
    if (node.x !== null && node.x !== undefined) {
      leftPos = node.x + '%';
    } else {
      const levelNodes = levels[node.level];
      const idx = levelNodes.indexOf(node);
      const slice = 100 / (levelNodes.length + 1);
      leftPos = (slice * (idx + 1)) + '%';
    }
    if (node.y !== null && node.y !== undefined) {
      topPos = node.y + '%';
    } else {
      topPos = (maxLevel === 0) ? '50%' : (85 - (node.level * (70 / maxLevel))) + '%';
    }

    el.style.left = leftPos;
    el.style.top = topPos;
    el.style.width = '140px';
    el.style.height = '140px';
    el.style.pointerEvents = 'auto';

    const isUp = node.status === true;
    const isFailover = node.activeParentId === node.secondaryParentId && node.secondaryParentId !== null;

    let iconHtml;
    if (node.iconType === 'url') {
      iconHtml = `<img src="${escapeHtml(node.icon || '')}" class="w-full h-full object-cover" onerror="this.style.display='none'">`;
    } else if (node.iconType === 'svg') {
      iconHtml = node.icon || '<i data-lucide="help-circle" class="w-8 h-8"></i>';
    } else {
      iconHtml = `<i data-lucide="${escapeHtml(node.icon || 'circle')}" class="w-8 h-8"></i>`;
    }

    const gridCell = getGridCell(node.x || 50, node.y || 50);

    el.innerHTML = `
      <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100%; gap:6px; padding:10px; box-sizing:border-box;">
        <div style="width:48px; height:48px; border-radius:999px; display:flex; align-items:center; justify-content:center; background: rgba(0,0,0,0.15); border:1px solid rgba(255,255,255,0.03); overflow:hidden;">
          ${iconHtml}
        </div>
        <div style="text-align:center; width:100%; color:#e6eef8;">
          <div style="font-weight:700; font-size:12px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(node.name || node.id)}</div>
          <div style="font-size:11px; color:var(--muted); font-family:monospace;">${escapeHtml(node.address || '')}</div>
          <div style="font-size:9px; color:#475569; font-family:monospace;">${gridCell.col}${gridCell.row}</div>
          <div style="margin-top:6px; font-size:10px; padding:4px 6px; border-radius:999px; display:inline-block; color:${isFailover ? '#b45309' : (isUp ? '#16a34a' : '#ef4444')}; background:${isFailover ? 'rgba(251,191,36,0.08)' : (isUp ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)')}; border:1px solid rgba(255,255,255,0.02); font-weight:700; letter-spacing:0.6px;">
            ${isUp ? 'ONLINE' : 'OFFLINE'}${isFailover ? ' (FAILOVER)' : ''}
          </div>
        </div>
      </div>
    `;

    // Event listeners for node interaction
    el.addEventListener('mousedown', (e) => startNodeDrag(e, node));
    el.addEventListener('contextmenu', (e) => showNodeContextMenu(e, node));
    el.addEventListener('dblclick', () => openNodeModal(node));

    container.appendChild(el);
  });

  lucide.createIcons();
  requestAnimationFrame(drawLines);
}

function drawLines() {
  const svg = document.getElementById('connections-layer');
  if (!svg) return;
  svg.setAttribute('width', '300%');
  svg.setAttribute('height', '300%');
  svg.innerHTML = '';

  networkData.forEach(node => {
    if (!node.activeParentId) return;
    const childEl = document.getElementById(`node-${node.id}`);
    const parentEl = document.getElementById(`node-${node.activeParentId}`);
    if (!childEl || !parentEl) return;

    const x1 = parentEl.offsetLeft;
    const y1 = parentEl.offsetTop;
    const x2 = childEl.offsetLeft;
    const y2 = childEl.offsetTop;

    const d = `M ${x1} ${y1} C ${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}`;

    const isFailover = node.activeParentId === node.secondaryParentId && node.secondaryParentId !== null;
    const baseColor = isFailover ? '#fbbf24' : (node.status ? '#22c55e' : '#ef4444');

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', baseColor);
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-opacity', '0.4');
    svg.appendChild(path);

    if (node.status || isFailover) {
      const pathFwd = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pathFwd.setAttribute('d', d);
      pathFwd.setAttribute('fill', 'none');
      pathFwd.setAttribute('stroke', baseColor);
      pathFwd.setAttribute('stroke-width', '1.5');
      pathFwd.setAttribute('stroke-dasharray', '8 8');
      pathFwd.classList.add('animate-flow');
      svg.appendChild(pathFwd);

      const pathRev = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pathRev.setAttribute('d', d);
      pathRev.setAttribute('fill', 'none');
      pathRev.setAttribute('stroke', baseColor);
      pathRev.setAttribute('stroke-width', '1.5');
      pathRev.setAttribute('stroke-dasharray', '8 8');
      pathRev.setAttribute('stroke-opacity', '0.6');
      pathRev.classList.add('animate-flow-reverse');
      svg.appendChild(pathRev);
    }
  });
}

// ============================================
// Node Drag & Drop
// ============================================

function startNodeDrag(e, node) {
  if (e.button !== 0) return; // Only left click
  e.stopPropagation();

  isDragging = true;
  dragNode = node;
  dragStartX = e.clientX;
  dragStartY = e.clientY;
  nodeStartX = node.x || 50;
  nodeStartY = node.y || 50;

  const el = document.getElementById(`node-${node.id}`);
  el.classList.add('dragging');
}

function handleNodeDrag(e) {
  if (!isDragging || !dragNode) return;

  const container = document.getElementById('tree-container');
  const rect = container.getBoundingClientRect();

  // Calculate movement in percentage
  const deltaX = ((e.clientX - dragStartX) / (rect.width * scale)) * 100;
  const deltaY = ((e.clientY - dragStartY) / (rect.height * scale)) * 100;

  let newX = nodeStartX + deltaX;
  let newY = nodeStartY + deltaY;

  // Clamp values
  newX = Math.max(0, Math.min(100, newX));
  newY = Math.max(0, Math.min(100, newY));

  // Apply snap-to-grid if enabled
  const snapped = snapToGrid(newX, newY);

  // Update visual position
  const el = document.getElementById(`node-${dragNode.id}`);
  el.style.left = snapped.x + '%';
  el.style.top = snapped.y + '%';

  // Store temporary position
  dragNode._tempX = snapped.x;
  dragNode._tempY = snapped.y;

  // Update lines in real-time
  requestAnimationFrame(drawLines);
}

function endNodeDrag() {
  if (!isDragging || !dragNode) return;

  const el = document.getElementById(`node-${dragNode.id}`);
  el.classList.remove('dragging');

  // Save the position if it changed
  if (dragNode._tempX !== undefined) {
    dragNode.x = dragNode._tempX;
    dragNode.y = dragNode._tempY;
    delete dragNode._tempX;
    delete dragNode._tempY;

    // Update config
    const configNode = config.nodes.find(n => n.id === dragNode.id);
    if (configNode) {
      configNode.x = dragNode.x;
      configNode.y = dragNode.y;
      saveConfig();
    }
  }

  isDragging = false;
  dragNode = null;
}

// ============================================
// Host List
// ============================================

function renderHostList(nodes) {
  const list = document.getElementById('host-list-content');
  document.getElementById('host-count').innerText = nodes.length;

  const sortedNodes = [...nodes].sort((a, b) => {
    if (a.status === b.status) return (a.name || '').localeCompare(b.name || '');
    return a.status ? 1 : -1;
  });

  let html = '';
  sortedNodes.forEach(node => {
    const colorClass = node.status ? 'bg-green-500' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]';
    const uptimeText = node.uptime || 'checking...';
    const statusLabel = node.status ? 'UP' : 'DOWN';
    const statusColor = node.status ? 'text-green-400' : 'text-red-400 font-bold';

    html += `
      <div class="host-row" data-node-id="${node.id}">
        <div class="flex items-center">
          <div class="status-dot ${colorClass}"></div>
          <div class="flex flex-col">
            <span class="font-bold text-slate-200">${escapeHtml(node.name || '')}</span>
            <span class="text-[10px] text-slate-500 font-mono">${escapeHtml(node.address || '')}</span>
          </div>
        </div>
        <div class="text-right">
          <div class="text-[10px] ${statusColor}">${statusLabel}</div>
          <div class="status-text">${uptimeText}</div>
        </div>
      </div>
    `;
  });
  list.innerHTML = html;
}

// ============================================
// Context Menu
// ============================================

function showNodeContextMenu(e, node) {
  e.preventDefault();
  e.stopPropagation();

  contextMenuNode = node;
  const menu = document.getElementById('context-menu');
  menu.style.left = e.clientX + 'px';
  menu.style.top = e.clientY + 'px';
  menu.classList.remove('hidden');
  lucide.createIcons();
}

function hideContextMenu() {
  document.getElementById('context-menu').classList.add('hidden');
  contextMenuNode = null;
}

function openSSHFromContext() {
  if (!contextMenuNode) return;
  hideContextMenu();
  openSSHModal(contextMenuNode);
}

function editNodeFromContext() {
  if (!contextMenuNode) return;
  hideContextMenu();
  openNodeModal(contextMenuNode);
}

async function pingNodeFromContext() {
  if (!contextMenuNode || !window.electronAPI) return;
  hideContextMenu();

  const result = await window.electronAPI.network.ping(contextMenuNode.address);
  alert(`Ping ${contextMenuNode.address}: ${result.success ? 'OK' : 'FAILED'} (${result.duration}ms)`);
}

function deleteNodeFromContext() {
  if (!contextMenuNode) return;
  hideContextMenu();

  if (confirm(`Delete node "${contextMenuNode.name}"?`)) {
    const idx = config.nodes.findIndex(n => n.id === contextMenuNode.id);
    if (idx !== -1) {
      config.nodes.splice(idx, 1);
      saveConfig();
      renderTree(config.nodes);
      renderHostList(config.nodes);
    }
  }
}

// ============================================
// Modals
// ============================================

function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
  lucide.createIcons();
}

function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// ============================================
// SSH Modal & Terminal
// ============================================

function openSSHModal(node) {
  document.getElementById('ssh-host').value = node.address || '';
  document.getElementById('ssh-port').value = node.sshPort || 22;
  document.getElementById('ssh-username').value = node.sshUser || '';
  document.getElementById('ssh-password').value = node.sshPass || '';
  document.getElementById('ssh-node-id').value = node.id;
  openModal('ssh-modal');
}

async function connectSSH() {
  if (!window.electronAPI) {
    alert('SSH is only available in Electron');
    return;
  }

  const nodeId = document.getElementById('ssh-node-id').value;
  const host = document.getElementById('ssh-host').value;
  const port = parseInt(document.getElementById('ssh-port').value) || 22;
  const username = document.getElementById('ssh-username').value;
  const password = document.getElementById('ssh-password').value;

  if (!host || !username) {
    alert('Host and username are required');
    return;
  }

  closeModal('ssh-modal');

  // Show connecting status
  document.getElementById('terminal-status').textContent = 'Connecting...';
  document.getElementById('terminal-status').className = 'text-xs px-2 py-0.5 rounded bg-yellow-600';

  const result = await window.electronAPI.ssh.connect({
    nodeId,
    host,
    port,
    username,
    password
  });

  if (result.success) {
    document.getElementById('terminal-status').textContent = 'Connected';
    document.getElementById('terminal-status').className = 'text-xs px-2 py-0.5 rounded bg-green-600';
    createTerminalTab(nodeId, host);
  } else {
    document.getElementById('terminal-status').textContent = 'Failed';
    document.getElementById('terminal-status').className = 'text-xs px-2 py-0.5 rounded bg-red-600';
    alert('SSH connection failed: ' + result.error);
  }
}

function createTerminalTab(nodeId, host) {
  // Hide placeholder
  document.getElementById('terminal-placeholder').classList.add('hidden');

  // Create tab
  const tabs = document.getElementById('terminal-tabs');
  const tab = document.createElement('div');
  tab.className = 'terminal-tab active';
  tab.dataset.nodeId = nodeId;
  tab.innerHTML = `
    <span>${escapeHtml(host)}</span>
    <button class="close-btn text-slate-500 hover:text-red-400" onclick="closeTerminalTab('${nodeId}')">
      <i data-lucide="x" class="w-3 h-3"></i>
    </button>
  `;
  tab.addEventListener('click', (e) => {
    if (!e.target.closest('.close-btn')) {
      switchTerminal(nodeId);
    }
  });

  // Deactivate other tabs
  tabs.querySelectorAll('.terminal-tab').forEach(t => t.classList.remove('active'));
  tabs.appendChild(tab);

  // Create terminal instance container
  const instances = document.getElementById('terminal-instances');
  const termDiv = document.createElement('div');
  termDiv.id = `terminal-${nodeId}`;
  termDiv.className = 'terminal-instance h-full';
  instances.querySelectorAll('.terminal-instance').forEach(t => t.style.display = 'none');
  instances.appendChild(termDiv);

  // Initialize xterm.js (will be loaded dynamically)
  initTerminal(nodeId, termDiv);

  lucide.createIcons();
}

async function initTerminal(nodeId, container) {
  // Load xterm dynamically if not in Electron
  if (typeof Terminal === 'undefined') {
    // Terminal will be initialized when xterm is loaded
    terminals.set(nodeId, { container, pending: true });
    return;
  }

  const term = new Terminal({
    cursorBlink: true,
    fontSize: 13,
    fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    theme: {
      background: '#1a1a2e',
      foreground: '#e2e8f0',
      cursor: '#3b82f6',
      selection: 'rgba(59, 130, 246, 0.3)'
    }
  });

  term.open(container);

  // Handle terminal input
  term.onData(data => {
    if (window.electronAPI) {
      window.electronAPI.ssh.write(nodeId, data);
    }
  });

  // Fit terminal to container
  if (window.FitAddon) {
    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    fitAddon.fit();

    // Resize on window resize
    window.addEventListener('resize', () => fitAddon.fit());
  }

  terminals.set(nodeId, { term, container });
  activeTerminal = nodeId;
}

function switchTerminal(nodeId) {
  const tabs = document.getElementById('terminal-tabs');
  tabs.querySelectorAll('.terminal-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.nodeId === nodeId);
  });

  const instances = document.getElementById('terminal-instances');
  instances.querySelectorAll('.terminal-instance').forEach(t => {
    t.style.display = t.id === `terminal-${nodeId}` ? 'block' : 'none';
  });

  activeTerminal = nodeId;
}

async function closeTerminalTab(nodeId) {
  if (window.electronAPI) {
    await window.electronAPI.ssh.disconnect(nodeId);
  }

  // Remove tab
  const tabs = document.getElementById('terminal-tabs');
  const tab = tabs.querySelector(`[data-node-id="${nodeId}"]`);
  if (tab) tab.remove();

  // Remove terminal instance
  const termDiv = document.getElementById(`terminal-${nodeId}`);
  if (termDiv) termDiv.remove();

  // Clean up terminal
  const termData = terminals.get(nodeId);
  if (termData && termData.term) {
    termData.term.dispose();
  }
  terminals.delete(nodeId);

  // Show placeholder if no terminals left
  if (terminals.size === 0) {
    document.getElementById('terminal-placeholder').classList.remove('hidden');
    document.getElementById('terminal-status').textContent = 'No Connection';
    document.getElementById('terminal-status').className = 'text-xs px-2 py-0.5 rounded bg-slate-700';
  } else {
    // Switch to another terminal
    const firstTab = tabs.querySelector('.terminal-tab');
    if (firstTab) {
      switchTerminal(firstTab.dataset.nodeId);
    }
  }
}

// SSH data listener
function setupSSHListeners() {
  if (!window.electronAPI) return;

  window.electronAPI.ssh.onData(({ nodeId, data }) => {
    const termData = terminals.get(nodeId);
    if (termData && termData.term) {
      termData.term.write(data);
    }
  });

  window.electronAPI.ssh.onClosed(({ nodeId }) => {
    closeTerminalTab(nodeId);
  });
}

// ============================================
// Node Edit Modal
// ============================================

function openNodeModal(node = null) {
  const isNew = !node;
  document.getElementById('node-modal-title').innerHTML = isNew
    ? '<i data-lucide="plus" class="w-5 h-5 inline mr-2"></i>Add Node'
    : '<i data-lucide="edit" class="w-5 h-5 inline mr-2"></i>Edit Node';

  document.getElementById('node-edit-id').value = node ? node.id : '';
  document.getElementById('node-name').value = node ? node.name : '';
  document.getElementById('node-address').value = node ? node.address : '';
  document.getElementById('node-port').value = node && node.port ? node.port : '';
  document.getElementById('node-icon-type').value = node ? node.iconType : 'lucide';
  document.getElementById('node-icon').value = node ? node.icon : 'circle';
  document.getElementById('node-ssh-port').value = node && node.sshPort ? node.sshPort : 22;
  document.getElementById('node-ssh-user').value = node ? node.sshUser || '' : '';
  document.getElementById('node-ssh-pass').value = node ? node.sshPass || '' : '';

  // Populate parent dropdowns
  const primarySelect = document.getElementById('node-primary-parent');
  const secondarySelect = document.getElementById('node-secondary-parent');

  let options = '<option value="">No Parent (Root)</option>';
  config.nodes.forEach(n => {
    if (!node || n.id !== node.id) {
      options += `<option value="${n.id}">${escapeHtml(n.name)}</option>`;
    }
  });

  primarySelect.innerHTML = options;
  secondarySelect.innerHTML = options;

  if (node) {
    primarySelect.value = node.primaryParentId || '';
    secondarySelect.value = node.secondaryParentId || '';
  }

  openModal('node-modal');
}

function saveNode() {
  const id = document.getElementById('node-edit-id').value;
  const name = document.getElementById('node-name').value;
  const address = document.getElementById('node-address').value;
  const port = document.getElementById('node-port').value;
  const iconType = document.getElementById('node-icon-type').value;
  const icon = document.getElementById('node-icon').value;
  const primaryParentId = document.getElementById('node-primary-parent').value || null;
  const secondaryParentId = document.getElementById('node-secondary-parent').value || null;
  const sshPort = document.getElementById('node-ssh-port').value;
  const sshUser = document.getElementById('node-ssh-user').value;
  const sshPass = document.getElementById('node-ssh-pass').value;

  if (!name) {
    alert('Name is required');
    return;
  }

  const nodeData = {
    id: id || 'node_' + Date.now(),
    name,
    address,
    port: port ? parseInt(port) : null,
    iconType,
    icon,
    primaryParentId,
    secondaryParentId,
    sshPort: sshPort ? parseInt(sshPort) : 22,
    sshUser,
    sshPass
  };

  if (id) {
    // Update existing node
    const idx = config.nodes.findIndex(n => n.id === id);
    if (idx !== -1) {
      nodeData.x = config.nodes[idx].x;
      nodeData.y = config.nodes[idx].y;
      config.nodes[idx] = nodeData;
    }
  } else {
    // Add new node - auto position
    const existingCount = config.nodes.length;
    const col = existingCount % 10;
    const row = Math.floor(existingCount / 10);
    nodeData.x = (col * 10) + 5;
    nodeData.y = (row * 15) + 10;
    config.nodes.push(nodeData);
  }

  saveConfig();
  closeModal('node-modal');
  renderTree(config.nodes);
  renderHostList(config.nodes);
}

// ============================================
// Network Discovery
// ============================================

let discoveredHosts = [];

async function openDiscoveryModal() {
  if (!window.electronAPI) {
    alert('Network discovery is only available in Electron');
    return;
  }

  // Get network interfaces
  const interfaces = await window.electronAPI.network.getLocalInfo();
  const select = document.getElementById('discovery-interface');
  select.innerHTML = '';

  interfaces.forEach((iface, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `${iface.interface} - ${iface.address}`;
    opt.dataset.address = iface.address;
    select.appendChild(opt);
  });

  // Set default base IP from first interface
  if (interfaces.length > 0) {
    const parts = interfaces[0].address.split('.');
    document.getElementById('discovery-base').value = parts.slice(0, 3).join('.');
  }

  discoveredHosts = [];
  document.getElementById('discovery-results').classList.add('hidden');
  document.getElementById('discovery-status').classList.add('hidden');
  document.getElementById('btn-add-discovered').classList.add('hidden');
  document.getElementById('btn-start-scan').classList.remove('hidden');

  openModal('discovery-modal');
}

async function startNetworkScan() {
  if (!window.electronAPI) return;

  const baseIp = document.getElementById('discovery-base').value;
  const startRange = parseInt(document.getElementById('discovery-start').value) || 1;
  const endRange = parseInt(document.getElementById('discovery-end').value) || 254;

  if (!baseIp) {
    alert('Please enter a base IP');
    return;
  }

  discoveredHosts = [];
  document.getElementById('discovery-status').classList.remove('hidden');
  document.getElementById('discovery-results').classList.add('hidden');
  document.getElementById('btn-start-scan').classList.add('hidden');
  document.getElementById('discovery-progress-bar').style.width = '0%';
  document.getElementById('discovery-text').textContent = 'Scanning...';

  // Listen for progress updates
  const removeProgressListener = window.electronAPI.network.onScanProgress((progress) => {
    const percent = Math.round((progress.current / progress.total) * 100);
    document.getElementById('discovery-progress-bar').style.width = percent + '%';
    document.getElementById('discovery-text').textContent = `Scanning... ${progress.current}/${progress.total} (Found: ${progress.found})`;
  });

  // Start scan
  const results = await window.electronAPI.network.scan(baseIp, startRange, endRange);

  removeProgressListener();

  // Also get ARP table for MAC addresses
  const arpTable = await window.electronAPI.network.arp();

  // Merge results
  discoveredHosts = results.map(r => {
    const arpEntry = arpTable.find(a => a.ip === r.ip);
    return {
      ip: r.ip,
      mac: arpEntry ? arpEntry.mac : null,
      selected: true
    };
  });

  // Filter out already configured hosts
  const configuredIps = config.nodes.map(n => n.address);
  discoveredHosts = discoveredHosts.filter(h => !configuredIps.includes(h.ip));

  document.getElementById('discovery-text').textContent = `Found ${discoveredHosts.length} new hosts`;
  document.getElementById('discovery-progress-bar').style.width = '100%';

  // Show results
  renderDiscoveryResults();

  if (discoveredHosts.length > 0) {
    document.getElementById('btn-add-discovered').classList.remove('hidden');
  }
  document.getElementById('btn-start-scan').classList.remove('hidden');
  document.getElementById('btn-start-scan').textContent = 'Scan Again';
}

function renderDiscoveryResults() {
  const container = document.getElementById('discovery-results');
  container.innerHTML = '';
  container.classList.remove('hidden');

  discoveredHosts.forEach((host, idx) => {
    const div = document.createElement('div');
    div.className = 'discovered-host';
    div.innerHTML = `
      <div>
        <input type="checkbox" ${host.selected ? 'checked' : ''} onchange="discoveredHosts[${idx}].selected = this.checked" class="mr-2">
        <span class="font-mono text-sm">${host.ip}</span>
        ${host.mac ? `<span class="text-xs text-slate-500 ml-2">${host.mac}</span>` : ''}
      </div>
    `;
    container.appendChild(div);
  });
}

function addDiscoveredNodes() {
  const selected = discoveredHosts.filter(h => h.selected);
  const startCount = config.nodes.length;

  selected.forEach((host, idx) => {
    const col = (startCount + idx) % 10;
    const row = Math.floor((startCount + idx) / 10);

    config.nodes.push({
      id: 'node_' + Date.now() + '_' + idx,
      name: `Device ${host.ip}`,
      address: host.ip,
      port: null,
      primaryParentId: null,
      secondaryParentId: null,
      icon: 'circle',
      iconType: 'lucide',
      x: (col * 10) + 5,
      y: (row * 15) + 10
    });
  });

  saveConfig();
  closeModal('discovery-modal');
  renderTree(config.nodes);
  renderHostList(config.nodes);
}

// ============================================
// Snap to Grid
// ============================================

function toggleSnapToGrid() {
  config.settings.snapToGrid = !config.settings.snapToGrid;
  updateSnapButton();
  saveConfig();
}

function updateSnapButton() {
  const btn = document.getElementById('btn-snap');
  if (config.settings.snapToGrid) {
    btn.classList.add('active');
  } else {
    btn.classList.remove('active');
  }
}

// ============================================
// Monitoring
// ============================================

function setupMonitoringListener() {
  if (!window.electronAPI) return;

  window.electronAPI.monitor.onStatus((data) => {
    document.getElementById('last-updated').textContent = 'Last Update: ' + data.updated;

    // Update uptime tracking
    data.nodes.forEach(node => {
      const tracker = uptimeTrackers.get(node.id);
      const currentStatus = node.status;

      if (!tracker) {
        uptimeTrackers.set(node.id, {
          status: currentStatus,
          since: Date.now()
        });
      } else if (tracker.status !== currentStatus) {
        tracker.status = currentStatus;
        tracker.since = Date.now();
      }

      // Calculate uptime string
      const elapsed = Date.now() - (uptimeTrackers.get(node.id)?.since || Date.now());
      node.uptime = formatDuration(elapsed);
    });

    networkData = data.nodes;
    renderTree(networkData);
    renderHostList(networkData);
  });
}

async function startMonitoring() {
  if (!window.electronAPI || monitoringActive) return;

  await window.electronAPI.monitor.start({
    nodes: config.nodes,
    interval: 2000
  });

  monitoringActive = true;
  document.getElementById('btn-monitoring').classList.add('active');
}

async function stopMonitoring() {
  if (!window.electronAPI || !monitoringActive) return;

  await window.electronAPI.monitor.stop();
  monitoringActive = false;
  document.getElementById('btn-monitoring').classList.remove('active');
}

async function toggleMonitoring() {
  if (monitoringActive) {
    await stopMonitoring();
  } else {
    await startMonitoring();
  }
}

function formatDuration(ms) {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return seconds + 's';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return minutes + 'm ' + (seconds % 60) + 's';
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours + 'h ' + (minutes % 60) + 'm';
  const days = Math.floor(hours / 24);
  return days + 'd ' + (hours % 24) + 'h';
}

// ============================================
// Utilities
// ============================================

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function togglePanel(id) {
  const panel = document.getElementById(id + '-content');
  if (panel) {
    panel.classList.toggle('hidden');
  }
}

// ============================================
// Initialize
// ============================================

document.addEventListener('DOMContentLoaded', () => {
  init();
  setupSSHListeners();
});
