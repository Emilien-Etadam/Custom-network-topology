// ============================================
// Network Topology Application
// ============================================

// State
let config = { settings: { showGrid: true, gridSize: 100, snapToGrid: true }, nodes: [], connections: [] };
let networkData = [];
let terminals = new Map();
let activeTerminal = null;
let monitoringActive = false;
let contextMenuNode = null;
let uptimeTrackers = new Map();

// Connection dragging state
let isConnecting = false;
let connectionStart = null; // { nodeId, portId, element }

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
    config.connections = config.connections || [];

    // Migrate legacy data and ensure ports exist
    migrateAndInitializePorts();

    updateSnapButton();
    renderTree(config.nodes);
    renderHostList(config.nodes);
  } catch (error) {
    console.error('Failed to load config:', error);
  }
}

// Migrate old primaryParentId/secondaryParentId to connections and ensure ports
function migrateAndInitializePorts() {
  let needsSave = false;

  config.nodes.forEach(node => {
    // Ensure node has ports array
    if (!node.ports || node.ports.length === 0) {
      node.ports = [
        { id: `${node.id}_in`, name: 'IN', side: 'top' },
        { id: `${node.id}_out`, name: 'OUT', side: 'bottom' }
      ];
      needsSave = true;
    }

    // Migrate legacy primaryParentId to connection
    if (node.primaryParentId) {
      const parentNode = config.nodes.find(n => n.id === node.primaryParentId);
      if (parentNode) {
        // Ensure parent has ports
        if (!parentNode.ports || parentNode.ports.length === 0) {
          parentNode.ports = [
            { id: `${parentNode.id}_in`, name: 'IN', side: 'top' },
            { id: `${parentNode.id}_out`, name: 'OUT', side: 'bottom' }
          ];
        }

        // Check if connection already exists
        const existingConn = config.connections.find(c =>
          c.sourceNodeId === parentNode.id && c.targetNodeId === node.id
        );

        if (!existingConn) {
          config.connections.push({
            id: `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            sourceNodeId: parentNode.id,
            sourcePortId: `${parentNode.id}_out`,
            targetNodeId: node.id,
            targetPortId: `${node.id}_in`,
            linkType: node.linkType || null,
            linkSpeed: node.linkSpeed || null,
            isFailover: false
          });
          needsSave = true;
        }
      }
    }

    // Migrate legacy secondaryParentId to failover connection
    if (node.secondaryParentId) {
      const parentNode = config.nodes.find(n => n.id === node.secondaryParentId);
      if (parentNode) {
        if (!parentNode.ports || parentNode.ports.length === 0) {
          parentNode.ports = [
            { id: `${parentNode.id}_in`, name: 'IN', side: 'top' },
            { id: `${parentNode.id}_out`, name: 'OUT', side: 'bottom' }
          ];
        }

        const existingConn = config.connections.find(c =>
          c.sourceNodeId === parentNode.id && c.targetNodeId === node.id && c.isFailover
        );

        if (!existingConn) {
          config.connections.push({
            id: `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            sourceNodeId: parentNode.id,
            sourcePortId: `${parentNode.id}_out`,
            targetNodeId: node.id,
            targetPortId: `${node.id}_in`,
            linkType: null,
            linkSpeed: null,
            isFailover: true
          });
          needsSave = true;
        }
      }
    }
  });

  if (needsSave) {
    saveConfig();
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
    y: Math.max(2.5, Math.min(247.5, snappedY)) // 50 rows * 5% = 250%, center at 247.5
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
    if (isDragging) return; // Don't start panning while dragging
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

  window.addEventListener('mouseup', async () => {
    isPanning = false;
    if (isDragging && dragNode) {
      await endNodeDrag();
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

  // Window resize - use networkData if monitoring, otherwise config
  window.addEventListener('resize', () => {
    if (monitoringActive && networkData.length) {
      // Merge positions from config before rendering
      networkData.forEach(node => {
        const configNode = config.nodes.find(n => n.id === node.id);
        if (configNode) {
          node.x = configNode.x;
          node.y = configNode.y;
        }
      });
      renderTree(networkData);
    } else if (config.nodes.length) {
      renderTree(config.nodes);
    }
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

    // Render port handles
    const ports = node.ports || [];
    const portsByPosition = { top: [], bottom: [], left: [], right: [] };
    ports.forEach(port => {
      if (portsByPosition[port.side]) {
        portsByPosition[port.side].push(port);
      }
    });

    let portsHtml = '<div class="node-ports">';
    Object.entries(portsByPosition).forEach(([side, sidePorts]) => {
      sidePorts.forEach((port, idx) => {
        const isConnected = config.connections.some(c =>
          (c.sourceNodeId === node.id && c.sourcePortId === port.id) ||
          (c.targetNodeId === node.id && c.targetPortId === port.id)
        );
        portsHtml += `
          <div class="port-handle port-${side} ${isConnected ? 'connected' : ''}"
               data-node-id="${node.id}"
               data-port-id="${port.id}"
               data-index="${idx}"
               title="${escapeHtml(port.name)}"></div>
          <span class="port-label port-${side}">${escapeHtml(port.name)}</span>
        `;
      });
    });
    portsHtml += '</div>';

    el.innerHTML = `
      ${portsHtml}
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
    el.addEventListener('mousedown', (e) => {
      // Don't start node drag if clicking on a port
      if (e.target.classList.contains('port-handle')) return;
      startNodeDrag(e, node);
    });
    el.addEventListener('contextmenu', (e) => showNodeContextMenu(e, node));
    el.addEventListener('dblclick', () => openNodeModal(node));

    // Port event listeners
    el.querySelectorAll('.port-handle').forEach(portEl => {
      portEl.addEventListener('mousedown', (e) => startConnection(e, node, portEl));
    });

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

  // Draw connections from config.connections array
  config.connections.forEach(conn => {
    const sourceNode = config.nodes.find(n => n.id === conn.sourceNodeId);
    const targetNode = config.nodes.find(n => n.id === conn.targetNodeId);
    if (!sourceNode || !targetNode) return;

    const sourceEl = document.getElementById(`node-${conn.sourceNodeId}`);
    const targetEl = document.getElementById(`node-${conn.targetNodeId}`);
    if (!sourceEl || !targetEl) return;

    // Get port positions
    const sourcePort = sourceNode.ports?.find(p => p.id === conn.sourcePortId);
    const targetPort = targetNode.ports?.find(p => p.id === conn.targetPortId);

    // Calculate connection points based on port positions
    const sourcePos = getPortPosition(sourceEl, sourcePort, sourceNode);
    const targetPos = getPortPosition(targetEl, targetPort, targetNode);

    const x1 = sourcePos.x;
    const y1 = sourcePos.y;
    const x2 = targetPos.x;
    const y2 = targetPos.y;

    // Create bezier curve path
    const d = createBezierPath(x1, y1, x2, y2, sourcePort?.side || 'bottom', targetPort?.side || 'top');

    // Determine connection status and color
    const sourceData = networkData.find(n => n.id === conn.sourceNodeId);
    const targetData = networkData.find(n => n.id === conn.targetNodeId);
    const isOnline = sourceData?.status && targetData?.status;
    const baseColor = conn.isFailover ? '#fbbf24' : (isOnline ? '#22c55e' : '#ef4444');

    // Base path
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute('d', d);
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke', baseColor);
    path.setAttribute('stroke-width', '2');
    path.setAttribute('stroke-opacity', '0.4');
    path.dataset.connectionId = conn.id;
    svg.appendChild(path);

    // Animated paths for active connections
    if (isOnline || conn.isFailover) {
      const pathFwd = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pathFwd.setAttribute('d', d);
      pathFwd.setAttribute('fill', 'none');
      pathFwd.setAttribute('stroke', baseColor);
      pathFwd.setAttribute('stroke-width', '2');
      pathFwd.setAttribute('stroke-dasharray', '8 8');
      pathFwd.classList.add('animate-flow');
      svg.appendChild(pathFwd);

      const pathRev = document.createElementNS("http://www.w3.org/2000/svg", "path");
      pathRev.setAttribute('d', d);
      pathRev.setAttribute('fill', 'none');
      pathRev.setAttribute('stroke', baseColor);
      pathRev.setAttribute('stroke-width', '2');
      pathRev.setAttribute('stroke-dasharray', '8 8');
      pathRev.setAttribute('stroke-opacity', '0.6');
      pathRev.classList.add('animate-flow-reverse');
      svg.appendChild(pathRev);
    }

    // Draw link speed/type label if available
    if (conn.linkType || conn.linkSpeed) {
      const midX = (x1 + x2) / 2;
      const midY = (y1 + y2) / 2;

      let labelParts = [];
      if (conn.linkType) labelParts.push(conn.linkType);
      if (conn.linkSpeed) labelParts.push(conn.linkSpeed);
      const labelText = labelParts.join(' ');

      const textBg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      const textWidth = labelText.length * 6 + 8;
      textBg.setAttribute('x', midX - textWidth / 2);
      textBg.setAttribute('y', midY - 8);
      textBg.setAttribute('width', textWidth);
      textBg.setAttribute('height', 16);
      textBg.setAttribute('rx', 4);
      textBg.setAttribute('fill', 'rgba(15, 23, 42, 0.9)');
      textBg.setAttribute('stroke', baseColor);
      textBg.setAttribute('stroke-width', '1');
      svg.appendChild(textBg);

      const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
      text.setAttribute('x', midX);
      text.setAttribute('y', midY + 4);
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('fill', '#e2e8f0');
      text.setAttribute('font-size', '10');
      text.setAttribute('font-family', 'monospace');
      text.setAttribute('font-weight', 'bold');
      text.textContent = labelText;
      svg.appendChild(text);
    }
  });
}

// Get the pixel position of a port on a node
function getPortPosition(nodeEl, port, node) {
  const rect = nodeEl.getBoundingClientRect();
  const nodeX = nodeEl.offsetLeft;
  const nodeY = nodeEl.offsetTop;
  const nodeW = nodeEl.offsetWidth;
  const nodeH = nodeEl.offsetHeight;

  // Get port index for positioning multiple ports on same side
  const samePortSide = (node.ports || []).filter(p => p.side === port?.side);
  const portIndex = samePortSide.findIndex(p => p.id === port?.id);
  const portCount = samePortSide.length;

  // Calculate offset for multiple ports (spread them out)
  let offsetRatio = 0.5;
  if (portCount > 1) {
    offsetRatio = (portIndex + 1) / (portCount + 1);
  }

  const side = port?.side || 'bottom';
  switch (side) {
    case 'top':
      return { x: nodeX + nodeW * offsetRatio - nodeW / 2, y: nodeY - nodeH / 2 };
    case 'bottom':
      return { x: nodeX + nodeW * offsetRatio - nodeW / 2, y: nodeY + nodeH / 2 };
    case 'left':
      return { x: nodeX - nodeW / 2, y: nodeY + nodeH * offsetRatio - nodeH / 2 };
    case 'right':
      return { x: nodeX + nodeW / 2, y: nodeY + nodeH * offsetRatio - nodeH / 2 };
    default:
      return { x: nodeX, y: nodeY };
  }
}

// Create a bezier path between two points, considering port sides
function createBezierPath(x1, y1, x2, y2, sourceSide, targetSide) {
  const distance = Math.sqrt(Math.pow(x2 - x1, 2) + Math.pow(y2 - y1, 2));
  const curvature = Math.min(distance * 0.5, 100);

  let cx1 = x1, cy1 = y1, cx2 = x2, cy2 = y2;

  // Adjust control points based on port sides
  switch (sourceSide) {
    case 'top': cy1 = y1 - curvature; break;
    case 'bottom': cy1 = y1 + curvature; break;
    case 'left': cx1 = x1 - curvature; break;
    case 'right': cx1 = x1 + curvature; break;
  }

  switch (targetSide) {
    case 'top': cy2 = y2 - curvature; break;
    case 'bottom': cy2 = y2 + curvature; break;
    case 'left': cx2 = x2 - curvature; break;
    case 'right': cx2 = x2 + curvature; break;
  }

  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

// ============================================
// Connection Drag & Drop
// ============================================

function startConnection(e, node, portEl) {
  e.stopPropagation();
  e.preventDefault();

  isConnecting = true;
  connectionStart = {
    nodeId: node.id,
    portId: portEl.dataset.portId,
    element: portEl
  };

  // Add temporary line SVG
  const svg = document.getElementById('connections-layer');
  const tempLine = document.createElementNS("http://www.w3.org/2000/svg", "path");
  tempLine.id = 'temp-connection';
  tempLine.setAttribute('fill', 'none');
  tempLine.setAttribute('stroke', '#3b82f6');
  tempLine.setAttribute('stroke-width', '2');
  tempLine.setAttribute('stroke-dasharray', '5 5');
  svg.appendChild(tempLine);

  document.addEventListener('mousemove', handleConnectionDrag);
  document.addEventListener('mouseup', endConnection);
}

function handleConnectionDrag(e) {
  if (!isConnecting || !connectionStart) return;

  const svg = document.getElementById('connections-layer');
  const tempLine = document.getElementById('temp-connection');
  if (!tempLine) return;

  const sourceEl = document.getElementById(`node-${connectionStart.nodeId}`);
  const sourceNode = config.nodes.find(n => n.id === connectionStart.nodeId);
  const sourcePort = sourceNode?.ports?.find(p => p.id === connectionStart.portId);
  const startPos = getPortPosition(sourceEl, sourcePort, sourceNode);

  // Get mouse position relative to world
  const worldRect = world.getBoundingClientRect();
  const mouseX = (e.clientX - worldRect.left) / scale;
  const mouseY = (e.clientY - worldRect.top) / scale;

  const d = createBezierPath(startPos.x, startPos.y, mouseX, mouseY, sourcePort?.side || 'bottom', 'top');
  tempLine.setAttribute('d', d);
}

function endConnection(e) {
  document.removeEventListener('mousemove', handleConnectionDrag);
  document.removeEventListener('mouseup', endConnection);

  // Remove temp line
  const tempLine = document.getElementById('temp-connection');
  if (tempLine) tempLine.remove();

  if (!isConnecting || !connectionStart) {
    isConnecting = false;
    connectionStart = null;
    return;
  }

  // Check if we dropped on a port
  const targetPort = e.target.closest('.port-handle');
  if (targetPort && targetPort !== connectionStart.element) {
    const targetNodeId = targetPort.dataset.nodeId;
    const targetPortId = targetPort.dataset.portId;

    // Don't connect to same node
    if (targetNodeId !== connectionStart.nodeId) {
      // Check if connection already exists
      const existingConn = config.connections.find(c =>
        (c.sourceNodeId === connectionStart.nodeId && c.sourcePortId === connectionStart.portId &&
         c.targetNodeId === targetNodeId && c.targetPortId === targetPortId) ||
        (c.sourceNodeId === targetNodeId && c.sourcePortId === targetPortId &&
         c.targetNodeId === connectionStart.nodeId && c.targetPortId === connectionStart.portId)
      );

      if (!existingConn) {
        // Create new connection
        config.connections.push({
          id: `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
          sourceNodeId: connectionStart.nodeId,
          sourcePortId: connectionStart.portId,
          targetNodeId: targetNodeId,
          targetPortId: targetPortId,
          linkType: null,
          linkSpeed: null,
          isFailover: false
        });

        saveConfig();
        renderTree(config.nodes);
      }
    }
  }

  isConnecting = false;
  connectionStart = null;
}

// ============================================
// Node Drag & Drop
// ============================================

let dragOffsetX = 0, dragOffsetY = 0;

function startNodeDrag(e, node) {
  if (e.button !== 0) return; // Only left click
  e.stopPropagation();
  e.preventDefault();

  isDragging = true;
  dragNode = node;

  // Get the node element and its current position
  const el = document.getElementById(`node-${node.id}`);
  const viewport = document.getElementById('viewport');
  const viewportRect = viewport.getBoundingClientRect();

  // Use vw/vh based dimensions for consistency with grid labels
  const worldWidth = window.innerWidth;
  const worldHeight = window.innerHeight;

  // Calculate mouse position relative to viewport, accounting for zoom/pan
  const mouseWorldX = (e.clientX - viewportRect.left - pointX) / scale;
  const mouseWorldY = (e.clientY - viewportRect.top - pointY) / scale;

  // Store the offset between mouse and node center (using vh/vw units)
  const nodeX = (node.x || 50) / 100 * worldWidth;
  const nodeY = (node.y || 50) / 100 * worldHeight;

  dragOffsetX = mouseWorldX - nodeX;
  dragOffsetY = mouseWorldY - nodeY;

  el.classList.add('dragging');

  // Prevent text selection during drag and set body class for cursor
  document.body.style.userSelect = 'none';
  document.body.classList.add('dragging-node');
}

function handleNodeDrag(e) {
  if (!isDragging || !dragNode) return;
  e.preventDefault();

  const viewport = document.getElementById('viewport');
  const viewportRect = viewport.getBoundingClientRect();

  // Use vw/vh based dimensions for consistency with grid labels
  const worldWidth = window.innerWidth;
  const worldHeight = window.innerHeight;

  // Calculate mouse position in world coordinates (accounting for zoom/pan)
  const mouseWorldX = (e.clientX - viewportRect.left - pointX) / scale;
  const mouseWorldY = (e.clientY - viewportRect.top - pointY) / scale;

  // Calculate new node position (subtract the initial offset)
  let newX = ((mouseWorldX - dragOffsetX) / worldWidth) * 100;
  let newY = ((mouseWorldY - dragOffsetY) / worldHeight) * 100;

  // Clamp values to keep node within bounds (allow full grid range)
  newX = Math.max(1, Math.min(99, newX));
  newY = Math.max(1, Math.min(250, newY)); // Grid extends to 250vh (50 rows * 5vh)

  // Apply snap-to-grid if enabled
  const snapped = snapToGrid(newX, newY);

  // Update visual position immediately
  const el = document.getElementById(`node-${dragNode.id}`);
  el.style.left = snapped.x + '%';
  el.style.top = snapped.y + '%';

  // Store temporary position
  dragNode._tempX = snapped.x;
  dragNode._tempY = snapped.y;

  // Update lines in real-time
  drawLines();
}

async function endNodeDrag() {
  if (!isDragging || !dragNode) return;

  const el = document.getElementById(`node-${dragNode.id}`);
  el.classList.remove('dragging');

  // Restore text selection and remove body class
  document.body.style.userSelect = '';
  document.body.classList.remove('dragging-node');

  // Save the position if it changed
  if (dragNode._tempX !== undefined) {
    const newX = dragNode._tempX;
    const newY = dragNode._tempY;

    delete dragNode._tempX;
    delete dragNode._tempY;

    // Update ALL references to this node
    const nodeId = dragNode.id;

    // Update config.nodes (source of truth)
    const configNode = config.nodes.find(n => n.id === nodeId);
    if (configNode) {
      configNode.x = newX;
      configNode.y = newY;
    }

    // Update networkData if it exists
    const dataNode = networkData.find(n => n.id === nodeId);
    if (dataNode) {
      dataNode.x = newX;
      dataNode.y = newY;
    }

    // Update dragNode itself
    dragNode.x = newX;
    dragNode.y = newY;

    // Save to disk and wait for completion
    await saveConfig();
  }

  isDragging = false;
  dragNode = null;
  dragOffsetX = 0;
  dragOffsetY = 0;
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

// Temporary ports storage for the modal
let editingNodePorts = [];

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
  document.getElementById('node-link-type').value = node ? node.linkType || '' : '';
  document.getElementById('node-link-speed').value = node ? node.linkSpeed || '' : '';

  // Initialize ports
  if (node && node.ports && node.ports.length > 0) {
    editingNodePorts = JSON.parse(JSON.stringify(node.ports));
  } else {
    // Default ports for new nodes
    const nodeId = node ? node.id : 'node_' + Date.now();
    editingNodePorts = [
      { id: `${nodeId}_in`, name: 'IN', side: 'top' },
      { id: `${nodeId}_out`, name: 'OUT', side: 'bottom' }
    ];
  }
  renderNodePortsList();

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

function renderNodePortsList() {
  const container = document.getElementById('node-ports-list');
  container.innerHTML = '';

  editingNodePorts.forEach((port, idx) => {
    const div = document.createElement('div');
    div.className = 'flex items-center gap-2 p-2 bg-slate-800 rounded';
    div.innerHTML = `
      <input type="text" value="${escapeHtml(port.name)}" placeholder="Name"
             onchange="updateNodePort(${idx}, 'name', this.value)"
             class="flex-1 px-2 py-1 bg-slate-900 border border-slate-600 rounded text-sm">
      <select onchange="updateNodePort(${idx}, 'side', this.value)"
              class="px-2 py-1 bg-slate-900 border border-slate-600 rounded text-sm">
        <option value="top" ${port.side === 'top' ? 'selected' : ''}>Top</option>
        <option value="bottom" ${port.side === 'bottom' ? 'selected' : ''}>Bottom</option>
        <option value="left" ${port.side === 'left' ? 'selected' : ''}>Left</option>
        <option value="right" ${port.side === 'right' ? 'selected' : ''}>Right</option>
      </select>
      <button onclick="removeNodePort(${idx})" class="p-1 text-red-400 hover:text-red-300">
        <i data-lucide="trash-2" class="w-4 h-4"></i>
      </button>
    `;
    container.appendChild(div);
  });

  lucide.createIcons();
}

function addNodePort() {
  const nodeId = document.getElementById('node-edit-id').value || 'node_' + Date.now();
  editingNodePorts.push({
    id: `${nodeId}_port_${Date.now()}`,
    name: `Port ${editingNodePorts.length + 1}`,
    side: 'bottom'
  });
  renderNodePortsList();
}

function updateNodePort(idx, field, value) {
  if (editingNodePorts[idx]) {
    editingNodePorts[idx][field] = value;
  }
}

function removeNodePort(idx) {
  editingNodePorts.splice(idx, 1);
  renderNodePortsList();
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
  const linkType = document.getElementById('node-link-type').value || null;
  const linkSpeed = document.getElementById('node-link-speed').value || null;

  if (!name) {
    alert('Name is required');
    return;
  }

  const newNodeId = id || 'node_' + Date.now();

  // Update port IDs if this is a new node
  const ports = editingNodePorts.map(p => ({
    ...p,
    id: p.id.startsWith('node_') ? p.id : `${newNodeId}_${p.name.toLowerCase().replace(/\s+/g, '_')}`
  }));

  const nodeData = {
    id: newNodeId,
    name,
    address,
    port: port ? parseInt(port) : null,
    iconType,
    icon,
    primaryParentId,
    secondaryParentId,
    sshPort: sshPort ? parseInt(sshPort) : 22,
    sshUser,
    sshPass,
    linkType,
    linkSpeed,
    ports
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

  // Restart monitoring with updated config
  if (monitoringActive) {
    stopMonitoring().then(() => startMonitoring());
  }
}

// ============================================
// Network Discovery
// ============================================

let discoveredHosts = [];
let networkInterfaces = []; // Store interfaces for reference

async function openDiscoveryModal() {
  if (!window.electronAPI) {
    alert('Network discovery is only available in Electron');
    return;
  }

  // Get network interfaces
  networkInterfaces = await window.electronAPI.network.getLocalInfo();
  const select = document.getElementById('discovery-interface');
  select.innerHTML = '';

  networkInterfaces.forEach((iface, idx) => {
    const opt = document.createElement('option');
    opt.value = idx;
    opt.textContent = `${iface.interface} - ${iface.address} (${iface.netmask})`;
    opt.dataset.address = iface.address;
    opt.dataset.netmask = iface.netmask;
    select.appendChild(opt);
  });

  // Add change listener to update IP range when interface changes
  select.onchange = () => updateDiscoveryRange();

  // Set default base IP from first interface
  updateDiscoveryRange();

  discoveredHosts = [];
  document.getElementById('discovery-results').classList.add('hidden');
  document.getElementById('discovery-status').classList.add('hidden');
  document.getElementById('btn-add-discovered').classList.add('hidden');
  document.getElementById('btn-start-scan').classList.remove('hidden');
  document.getElementById('btn-start-scan').textContent = 'Start Scan';

  openModal('discovery-modal');
}

function updateDiscoveryRange() {
  const select = document.getElementById('discovery-interface');
  const selectedIdx = parseInt(select.value) || 0;

  if (networkInterfaces.length > 0 && networkInterfaces[selectedIdx]) {
    const iface = networkInterfaces[selectedIdx];
    const ipParts = iface.address.split('.');
    const maskParts = iface.netmask.split('.');

    // Calculate network range based on netmask
    const baseIp = ipParts.slice(0, 3).join('.');
    document.getElementById('discovery-base').value = baseIp;

    // Calculate start and end based on netmask
    // For /24 (255.255.255.0): range is 1-254
    // For /16 (255.255.0.0): we'll limit to current subnet
    const lastOctetMask = parseInt(maskParts[3]) || 0;

    if (lastOctetMask === 0) {
      // /24 or larger - scan 1-254
      document.getElementById('discovery-start').value = 1;
      document.getElementById('discovery-end').value = 254;
    } else {
      // Smaller subnet - calculate range
      const hostBits = 256 - lastOctetMask;
      const networkPart = parseInt(ipParts[3]) & lastOctetMask;
      document.getElementById('discovery-start').value = networkPart + 1;
      document.getElementById('discovery-end').value = Math.min(networkPart + hostBits - 2, 254);
    }
  }
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

async function addDiscoveredNodes() {
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

  // Restart monitoring with new nodes if it was active
  if (monitoringActive) {
    await stopMonitoring();
    await startMonitoring();
  } else {
    // If monitoring is not active, just render from config
    renderTree(config.nodes);
    renderHostList(config.nodes);
  }
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

    // Merge monitoring data with current config positions
    // This preserves user-moved positions while updating status
    const mergedNodes = data.nodes.map(node => {
      const configNode = config.nodes.find(n => n.id === node.id);
      if (configNode) {
        // Use ALL properties from config (user may have edited the node)
        node.name = configNode.name;
        node.address = configNode.address;
        node.port = configNode.port;
        node.primaryParentId = configNode.primaryParentId;
        node.secondaryParentId = configNode.secondaryParentId;
        node.x = configNode.x;
        node.y = configNode.y;
        node.icon = configNode.icon;
        node.iconType = configNode.iconType;
        node.sshPort = configNode.sshPort;
        node.sshUser = configNode.sshUser;
        node.sshPass = configNode.sshPass;
        node.linkType = configNode.linkType;
        node.linkSpeed = configNode.linkSpeed;
        node.ports = configNode.ports;
      }

      // Update uptime tracking
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

      return node;
    });

    networkData = mergedNodes;
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
