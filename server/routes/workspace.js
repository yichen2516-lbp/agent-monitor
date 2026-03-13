const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  getWorkspaceAgents,
  getValidWorkspaceAgent,
  isPathSafe,
  getFileList,
  formatFileSize,
  getFileIcon,
  generateWorkspaceTree
} = require('../workspace');

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderTemplate(template, data) {
  return template.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_, key) => {
    return Object.prototype.hasOwnProperty.call(data, key) ? String(data[key]) : '';
  });
}

function renderMarkdown(content) {
  return escapeHtml(content)
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/```[\s\S]*?```/g, '<pre><code>$&</code></pre>')
    .replace(/\n/g, '<br>');
}

function countTree(items) {
  let fileCount = 0;
  let dirCount = 0;
  function walk(nodes) {
    for (const item of nodes) {
      if (item.type === 'file') fileCount += 1;
      else if (item.type === 'directory') {
        dirCount += 1;
        if (item.children) walk(item.children);
      }
    }
  }
  walk(items);
  return { fileCount, dirCount };
}

function createWorkspaceRouter({ baseDir }) {
  const router = express.Router();
  const workspaceTemplate = fs.readFileSync(path.join(baseDir, 'views', 'workspace.html'), 'utf8');
  const workspaceViewTemplate = fs.readFileSync(path.join(baseDir, 'views', 'workspace-view.html'), 'utf8');

  function makeAgentTabs(agents, currentAgent) {
    return Object.entries(agents).map(([key, cfg]) => {
      const isActive = key === currentAgent;
      const activeStyle = isActive ? `style="background: linear-gradient(180deg, rgba(0,229,255,0.14), rgba(0,229,255,0.08)); border-color: rgba(0,229,255,0.6); color: #e0fdff;"` : '';
      return `<a href="?agent=${encodeURIComponent(key)}" class="agent-tab ${isActive ? 'active' : ''}" ${activeStyle}>
        <span>${cfg.emoji}</span>
        <span>${escapeHtml(cfg.name)}</span>
      </a>`;
    }).join('');
  }

  router.get('/workspace', (req, res) => {
    const agents = getWorkspaceAgents();
    const agentKey = getValidWorkspaceAgent(req.query.agent || 'main');
    const config = agents[agentKey];
    if (!config) return res.status(404).send('Workspace not found');

    const files = getFileList(config.workspace);
    const fileTree = generateWorkspaceTree(files, agentKey);
    const { fileCount, dirCount } = countTree(files);
    const agentTabs = makeAgentTabs(agents, agentKey);

    const html = renderTemplate(workspaceTemplate, {
      TITLE: escapeHtml(`${config.name} Workspace - Agent Monitor`),
      BODY_CLASS: '',
      AGENT_KEY: escapeHtml(agentKey),
      AGENT_TABS: agentTabs,
      FILE_TREE: fileTree,
      AGENT_NAME: escapeHtml(config.name),
      AGENT_EMOJI: config.emoji,
      WORKSPACE_PATH: escapeHtml(config.workspace),
      FILE_COUNT: fileCount,
      DIR_COUNT: dirCount,
      AGENT_COLOR: config.color
    });
    res.send(html);
  });

  router.get('/workspace/view/*', (req, res) => {
    const agents = getWorkspaceAgents();
    const agentKey = getValidWorkspaceAgent(req.query.agent || 'main');
    const config = agents[agentKey];
    if (!config) return res.status(404).send('Workspace not found');

    const filePath = decodeURIComponent(req.params[0]);
    const fullPath = path.join(config.workspace, filePath);

    if (!isPathSafe(fullPath, config.workspace) || !fs.existsSync(fullPath)) {
      return res.status(404).send('File not found');
    }

    const stat = fs.statSync(fullPath);
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();

    let contentHtml;
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      if (ext === '.md') {
        contentHtml = `<div class="file-view-content markdown">${renderMarkdown(content)}</div>`;
      } else {
        contentHtml = `<div class="file-view-content"><pre>${escapeHtml(content)}</pre></div>`;
      }
    } catch (e) {
      contentHtml = `<div class="file-view-content"><p style="color:var(--neon-red)">Unable to read file: ${escapeHtml(e.message)}</p></div>`;
    }

    const parts = filePath.split('/').filter(Boolean);
    let breadcrumbPath = '';
    const breadcrumbs = parts.map((part, i) => {
      breadcrumbPath += '/' + part;
      const isLast = i === parts.length - 1;
      if (isLast) return `<span style="color:var(--neon-yellow)">${escapeHtml(part)}</span>`;
      return `<a href="/workspace/view/${encodeURIComponent(breadcrumbPath)}?agent=${encodeURIComponent(agentKey)}">${escapeHtml(part)}</a>`;
    }).join('<span class="breadcrumb-sep">/</span>');

    const files = getFileList(config.workspace);
    const fileTree = generateWorkspaceTree(files, agentKey);
    const { fileCount, dirCount } = countTree(files);
    const agentTabs = makeAgentTabs(agents, agentKey);

    const html = renderTemplate(workspaceViewTemplate, {
      TITLE: escapeHtml(`${fileName} - ${config.name} Workspace`),
      BODY_CLASS: 'file-view-page',
      AGENT: encodeURIComponent(agentKey),
      AGENT_KEY: escapeHtml(agentKey),
      AGENT_NAME: escapeHtml(config.name),
      AGENT_EMOJI: config.emoji,
      AGENT_COLOR: config.color,
      FILE_TREE: fileTree,
      FILE_COUNT: fileCount,
      DIR_COUNT: dirCount,
      FILE_NAME: escapeHtml(fileName),
      FILE_ICON: getFileIcon(fileName),
      FILE_SIZE: escapeHtml(formatFileSize(stat.size)),
      FILE_TYPE: escapeHtml(ext || 'text'),
      BREADCRUMBS: breadcrumbs,
      CONTENT_HTML: contentHtml,
      CURRENT_FILE_PATH: escapeHtml(filePath)
    });
    res.send(html);
  });

  return router;
}

module.exports = { createWorkspaceRouter };
