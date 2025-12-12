# Network Topology Manager

An Electron-based network topology visualization and management application with SSH terminal integration, network discovery, and real-time monitoring.

![Network Topology](https://github.com/user-attachments/assets/a6ba412f-bffe-494c-b081-bce053920e18)

## Features

- **Interactive Topology Viewer** - Zoom, pan, and drag nodes to create custom network layouts
- **Real-time Monitoring** - Cross-platform monitoring using Node.js (replaces PowerShell)
- **SSH Terminal** - Integrated xterm.js terminal for direct SSH connections to nodes
- **Network Discovery** - Automatic network scanning to discover devices via ping and ARP
- **Snap-to-Grid** - Precise node positioning with A-Z/1-50 coordinate system
- **Failover Support** - Visual representation of primary and failover connections
- **Import/Export** - Save and load topology configurations as JSON

## Screenshots

### Topology Viewer
The main interface displays your network topology with real-time status updates, animated connection flows, and a host status panel.

### Admin Panel
![Admin Panel](https://github.com/user-attachments/assets/246432e6-90ce-47be-a8b8-7339caeba225)

Configure nodes, SSH credentials, parent relationships, and grid positions.

## Installation

### Prerequisites
- [Node.js](https://nodejs.org/) v18 or later
- [npm](https://www.npmjs.com/) or [yarn](https://yarnpkg.com/)

### Setup

```bash
# Clone the repository
git clone https://github.com/your-repo/Custom-network-topology.git
cd Custom-network-topology

# Install dependencies
npm install

# Start the application
npm start

# Development mode with DevTools
npm run dev
```

### Building for Distribution

```bash
# Build for current platform
npm run build

# Build for specific platforms
npm run build:win    # Windows
npm run build:mac    # macOS
npm run build:linux  # Linux
```

## Project Structure

```
Custom-network-topology/
├── main.js              # Electron main process
├── preload.js           # Secure IPC bridge
├── package.json         # Project configuration
├── renderer/            # Frontend files
│   ├── index.html       # Main topology viewer
│   ├── admin.html       # Configuration editor
│   ├── config.json      # Default configuration
│   ├── css/
│   │   └── xterm.css    # Terminal styles
│   └── js/
│       └── app.js       # Application logic
├── assets/              # Application icons
└── dist/                # Build output (generated)
```

## Usage Guide

### Getting Started

1. **Launch the application** using `npm start`
2. **Open the Admin panel** (click "Admin" in toolbar) to configure your nodes
3. **Add nodes** with their IP addresses and optional SSH credentials
4. **Position nodes** using drag-and-drop or grid coordinates
5. **Enable monitoring** to see real-time status updates

### Node Configuration

Each node can have:
- **Name** - Display name
- **IP Address** - Network address for monitoring/SSH
- **Port** - Optional TCP port for connectivity checks
- **Primary Parent** - Main upstream connection
- **Failover Parent** - Backup connection (highlighted in orange when active)
- **SSH Credentials** - Port, username, password for terminal access
- **Icon** - Lucide icon name, image URL, or custom SVG

### Grid System

The topology uses a grid system with:
- **Columns**: A-Z, then AA-AZ (52 columns total)
- **Rows**: 1-50

Enable **Snap to Grid** for precise positioning on grid intersections.

### SSH Terminal

1. **Right-click** on any node with SSH configured
2. Select **"SSH Connect"**
3. Enter credentials (pre-filled if configured)
4. A new terminal tab opens in the sidebar

Multiple terminals can be open simultaneously.

### Network Discovery

1. Click **"Discover"** in the toolbar
2. Select your network interface
3. Adjust the IP range if needed
4. Click **"Start Scan"**
5. Select discovered hosts to add to your topology

### Keyboard Shortcuts

- **Scroll wheel** - Zoom in/out
- **Click + drag (background)** - Pan view
- **Click + drag (node)** - Move node
- **Double-click (node)** - Edit node
- **Right-click (node)** - Context menu

## Configuration Format

The `config.json` file structure:

```json
{
  "settings": {
    "showGrid": true,
    "gridSize": 100,
    "snapToGrid": true
  },
  "nodes": [
    {
      "id": "node_gateway",
      "name": "Gateway Router",
      "address": "192.168.1.1",
      "port": null,
      "primaryParentId": null,
      "secondaryParentId": null,
      "icon": "router",
      "iconType": "lucide",
      "x": 50,
      "y": 85,
      "sshPort": 22,
      "sshUser": "admin",
      "sshPass": ""
    }
  ]
}
```

### Node Properties

| Property | Type | Description |
|----------|------|-------------|
| `id` | string | Unique identifier |
| `name` | string | Display name |
| `address` | string | IP address or hostname |
| `port` | number/null | TCP port for health check (null = ping) |
| `primaryParentId` | string/null | ID of primary parent node |
| `secondaryParentId` | string/null | ID of failover parent node |
| `icon` | string | Icon name, URL, or SVG code |
| `iconType` | string | "lucide", "url", or "svg" |
| `x` | number | X position (0-100%) |
| `y` | number | Y position (0-100%) |
| `sshPort` | number | SSH port (default: 22) |
| `sshUser` | string | SSH username |
| `sshPass` | string | SSH password |

## Architecture

### Main Process (main.js)

Handles:
- Window management
- SSH connections via ssh2
- Network scanning (ping, ARP)
- File system operations
- Real-time monitoring

### Preload Script (preload.js)

Secure IPC bridge exposing:
- `electronAPI.config` - Configuration management
- `electronAPI.ssh` - SSH terminal operations
- `electronAPI.network` - Network discovery
- `electronAPI.monitor` - Real-time monitoring

### Renderer (renderer/)

- Pure HTML/CSS/JS frontend
- Tailwind CSS for styling
- Lucide icons
- xterm.js for terminal emulation

## Dependencies

### Production
- `ssh2` - SSH2 client for Node.js
- `xterm` - Terminal emulator
- `xterm-addon-fit` - Terminal auto-sizing
- `xterm-addon-web-links` - Clickable links
- `node-arp` - ARP table access
- `ping` - ICMP ping wrapper

### Development
- `electron` - Desktop application framework
- `electron-builder` - Application packaging

## Troubleshooting

### SSH Connection Issues
- Verify the target host is reachable
- Check that SSH credentials are correct
- Ensure the SSH port is not blocked by firewall

### Network Discovery Not Finding Hosts
- Run the application with administrator/root privileges
- Verify you're scanning the correct IP range
- Check firewall settings

### Monitoring Not Working
- Ensure nodes have valid IP addresses
- Check network connectivity
- Verify there are no conflicting services

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## License

MIT License - see LICENSE file for details.

## Acknowledgments

- [Electron](https://www.electronjs.org/)
- [xterm.js](https://xtermjs.org/)
- [Tailwind CSS](https://tailwindcss.com/)
- [Lucide Icons](https://lucide.dev/)
