const fs = require('fs');
const path = require('path');
const os = require('os');

const EXCLUDE_DIRS = ['node_modules', '.git', '.venv', '__pycache__', '.pytest_cache', '.next', 'dist', 'build', 'coverage'];
const EXCLUDE_FILES = ['.DS_Store', 'Thumbs.db'];
const DEFAULT_INITIAL_TREE_DEPTH = 1;

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

function getDirectoryEntries(workspaceRoot, relativeDir = '') {
  const safeRelativeDir = relativeDir.replace(/^\/+/, '');
  const fullDir = path.join(workspaceRoot, safeRelativeDir);
  if (!isPathSafe(fullDir, workspaceRoot) || !fs.existsSync(fullDir)) {
    return [];
  }

  let stat;
  try {
    stat = fs.statSync(fullDir);
  } catch (_) {
    return [];
  }

  if (!stat.isDirectory()) return [];

  const items = [];
  try {
    const files = fs.readdirSync(fullDir);
    for (const file of files) {
      if (file.startsWith('.') && !file.startsWith('.openclaw')) continue;
      if (EXCLUDE_FILES.includes(file)) continue;

      const fullPath = path.join(fullDir, file);
      const relativePath = path.join(safeRelativeDir, file);
      const entryStat = fs.statSync(fullPath);

      if (entryStat.isDirectory()) {
        if (EXCLUDE_DIRS.includes(file)) continue;
        items.push({ name: file, path: relativePath, type: 'directory', children: null, hasChildren: directoryHasVisibleChildren(fullPath) });
      } else {
        items.push({ name: file, path: relativePath, type: 'file', size: entryStat.size });
      }
    }
  } catch (e) {
    console.error('[Workspace] Failed to read directory entries:', fullDir, e.message);
  }

  return items.sort((a, b) => {
    if (a.type === 'directory' && b.type !== 'directory') return -1;
    if (a.type !== 'directory' && b.type === 'directory') return 1;
    return a.name.localeCompare(b.name);
  });
}

function directoryHasVisibleChildren(dir) {
  try {
    const files = fs.readdirSync(dir);
    return files.some((file) => {
      if (file.startsWith('.') && !file.startsWith('.openclaw')) return false;
      if (EXCLUDE_FILES.includes(file)) return false;
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        return !EXCLUDE_DIRS.includes(file);
      }
      return true;
    });
  } catch (_) {
    return false;
  }
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

function getAncestorPaths(relativePath = '') {
  const parts = String(relativePath).split('/').filter(Boolean);
  const ancestors = [];
  let current = '';
  for (let i = 0; i < parts.length - 1; i += 1) {
    current = current ? path.posix.join(current, parts[i]) : parts[i];
    ancestors.push(current);
  }
  return ancestors;
}

function flattenWorkspace(items, { limit = Infinity } = {}) {
  const files = [];
  const directories = [];
  let truncated = false;

  function walk(nodes) {
    for (const item of nodes) {
      if (item.type === 'directory') {
        directories.push({ name: item.name, path: item.path, type: 'directory' });
        if (item.children) walk(item.children);
        continue;
      }

      if (files.length >= limit) {
        truncated = true;
        continue;
      }

      files.push({
        name: item.name,
        path: item.path,
        size: item.size,
        sizeLabel: formatFileSize(item.size),
        icon: getFileIcon(item.name)
      });
    }
  }

  walk(items);
  return { files, directories, truncated };
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildFileLink(item, agent) {
  const icon = getFileIcon(item.name);
  return `
    <li class="file">
      <a href="/workspace/view/${encodeURIComponent(item.path)}?agent=${encodeURIComponent(agent)}" class="file-link" data-file-path="${escapeHtml(item.path)}">
        <span class="file-icon">${icon}</span>
        <span class="file-name">${escapeHtml(item.name)}</span>
        <span class="file-size">${formatFileSize(item.size)}</span>
      </a>
    </li>`;
}

function buildDirectoryNode(item, agent, options, level) {
  const initialDepth = Number.isInteger(options.initialDepth) ? options.initialDepth : DEFAULT_INITIAL_TREE_DEPTH;
  const expandedPaths = options.expandedPaths || new Set();
  const alwaysExpandedPaths = options.alwaysExpandedPaths || new Set();
  const isInitiallyExpanded = level < initialDepth || expandedPaths.has(item.path) || alwaysExpandedPaths.has(item.path);
  const shouldRenderChildren = item.children && (level < initialDepth || expandedPaths.has(item.path) || alwaysExpandedPaths.has(item.path));
  const childHtml = shouldRenderChildren ? generateWorkspaceTree(item.children, agent, { ...options, initialDepth }, level + 1) : '';
  const hasChildren = item.hasChildren != null ? item.hasChildren : Boolean(item.children && item.children.length > 0);

  return `
    <li class="directory" data-dir-path="${escapeHtml(item.path)}">
      <div class="dir-header ${isInitiallyExpanded ? 'expanded' : ''}" data-dir-path="${escapeHtml(item.path)}" data-loaded="${shouldRenderChildren ? '1' : '0'}">
        <span class="dir-arrow">▶</span>
        <span class="dir-icon">📁</span>
        <span class="dir-name">${escapeHtml(item.name)}</span>
        <span class="dir-count">${item.children ? item.children.length : ''}</span>
      </div>
      ${hasChildren ? `<div class="dir-content ${isInitiallyExpanded ? '' : 'collapsed'}" data-dir-children="${escapeHtml(item.path)}">${childHtml}</div>` : ''}
    </li>`;
}

function generateWorkspaceTree(items, agent, options = {}, level = 0) {
  if (!items || items.length === 0) {
    return level === 0 ? '<p class="empty-tree">No files</p>' : '';
  }

  const listClass = level === 0 ? 'file-tree' : '';
  const parts = [`<ul${listClass ? ` class="${listClass}"` : ''}>`];

  for (const item of items) {
    if (item.type === 'directory') {
      parts.push(buildDirectoryNode(item, agent, options, level));
    } else {
      parts.push(buildFileLink(item, agent));
    }
  }

  parts.push('</ul>');
  return parts.join('');
}

function findNodeByPath(items, targetPath) {
  for (const item of items) {
    if (item.path === targetPath) return item;
    if (item.type === 'directory' && item.children) {
      const child = findNodeByPath(item.children, targetPath);
      if (child) return child;
    }
  }
  return null;
}

module.exports = {
  DEFAULT_INITIAL_TREE_DEPTH,
  scanWorkspaces,
  getWorkspaceAgents,
  getValidWorkspaceAgent,
  isPathSafe,
  getFileList,
  getDirectoryEntries,
  formatFileSize,
  getFileIcon,
  getAncestorPaths,
  flattenWorkspace,
  generateWorkspaceTree,
  findNodeByPath,
  escapeHtml
};
