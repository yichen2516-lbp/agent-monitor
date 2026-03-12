const fs = require('fs');
const path = require('path');
const os = require('os');

function scanWorkspaces() {
  const openclawDir = path.join(os.homedir(), '.openclaw');
  const workspaces = {};

  const agentColors = {
    main: '#f7931a',
    cool: '#58a6ff',
    tim: '#3fb950',
    edge: '#f778ba',
    deep: '#58a6ff',
    geek: '#a371f7'
  };

  const agentEmojis = {
    main: '⚡',
    cool: '❄️',
    tim: '⏱️',
    edge: '🔥',
    deep: '🔧',
    geek: '🤓'
  };

  try {
    if (!fs.existsSync(openclawDir)) {
      return workspaces;
    }

    const entries = fs.readdirSync(openclawDir);

    for (const entry of entries) {
      if (!entry.startsWith('workspace')) continue;

      const fullPath = path.join(openclawDir, entry);
      const stat = fs.statSync(fullPath);
      if (!stat.isDirectory()) continue;

      let agentKey = 'main';
      let displayName = 'Main';

      if (entry.includes('-')) {
        agentKey = entry.replace('workspace-', '').toLowerCase();
        displayName = agentKey.charAt(0).toUpperCase() + agentKey.slice(1);
      }

      workspaces[agentKey] = {
        name: displayName,
        emoji: agentEmojis[agentKey] || '🤖',
        workspace: fullPath,
        color: agentColors[agentKey] || '#8b949e'
      };
    }
  } catch (e) {
    console.error('[Workspace] Failed to scan workspaces:', e.message);
  }

  return workspaces;
}

function getWorkspaceAgents() {
  return scanWorkspaces();
}

function getValidWorkspaceAgent(agent) {
  const agents = getWorkspaceAgents();
  return agents[agent] ? agent : 'main';
}

function isPathSafe(filePath, basePath) {
  const resolved = path.resolve(filePath);
  const baseResolved = path.resolve(basePath);
  return resolved.startsWith(baseResolved);
}

function getFileList(dir, basePath = '') {
  const items = [];
  if (!fs.existsSync(dir)) return items;

  const EXCLUDE_DIRS = ['node_modules', '.git', '.venv', '__pycache__', '.pytest_cache', '.next', 'dist', 'build', 'coverage'];
  const EXCLUDE_FILES = ['.DS_Store', 'Thumbs.db'];

  try {
    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (file.startsWith('.') && !file.startsWith('.openclaw')) continue;
      if (EXCLUDE_FILES.includes(file)) continue;

      const fullPath = path.join(dir, file);
      const relativePath = path.join(basePath, file);
      const stat = fs.statSync(fullPath);

      if (stat.isDirectory()) {
        if (EXCLUDE_DIRS.includes(file)) continue;
        const children = getFileList(fullPath, relativePath);
        items.push({ name: file, path: relativePath, type: 'directory', children });
      } else {
        items.push({ name: file, path: relativePath, type: 'file', size: stat.size });
      }
    }
  } catch (e) {
    console.error('[Workspace] Failed to read directory:', dir, e.message);
  }

  return items.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function getFileIcon(filename) {
  const icons = {
    '.md': '📝', '.json': '📋', '.js': '💻', '.ts': '💻', '.py': '🐍',
    '.sh': '🔧', '.yml': '⚙️', '.yaml': '⚙️', '.txt': '📄', '.log': '📜',
    '.png': '🖼️', '.jpg': '🖼️', '.jpeg': '🖼️', '.gif': '🖼️', '.svg': '🎨',
    '.html': '🌐', '.css': '🎨', '.sql': '🗄️', '.csv': '📊'
  };
  const ext = path.extname(filename).toLowerCase();
  return icons[ext] || '📄';
}

function generateWorkspaceTree(items, agent, level = 0) {
  if (items.length === 0) return '<p style="color:#666;padding:10px;">No files</p>';

  let html = level === 0 ? '<ul class="file-tree">' : '<ul>';

  for (const item of items) {
    if (item.type === 'directory') {
      const hasChildren = item.children && item.children.length > 0;
      html += `
        <li class="directory">
          <div class="dir-header" onclick="toggleDir(this)">
            <span class="dir-arrow">▶</span>
            <span class="dir-icon">📁</span>
            <span class="dir-name">${item.name}</span>
            <span class="dir-count">${item.children ? item.children.length : 0}</span>
          </div>
          ${hasChildren ? `<div class="dir-content collapsed">${generateWorkspaceTree(item.children, agent, level + 1)}</div>` : ''}
        </li>`;
    } else {
      const icon = getFileIcon(item.name);
      html += `
        <li class="file">
          <a href="/workspace/view/${encodeURIComponent(item.path)}?agent=${agent}" class="file-link">
            <span class="file-icon">${icon}</span>
            <span class="file-name">${item.name}</span>
            <span class="file-size">${formatFileSize(item.size)}</span>
          </a>
        </li>`;
    }
  }

  html += '</ul>';
  return html;
}

module.exports = {
  scanWorkspaces,
  getWorkspaceAgents,
  getValidWorkspaceAgent,
  isPathSafe,
  getFileList,
  generateWorkspaceTree
};
