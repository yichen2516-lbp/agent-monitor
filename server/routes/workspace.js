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

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.js', '.ts', '.jsx', '.tsx', '.py', '.sh', '.yml', '.yaml', '.html', '.css', '.sql', '.csv', '.log', '.xml']);

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

function getImageMimeType(fileName) {
  const ext = path.extname(fileName).toLowerCase();
  return ext === '.svg' ? 'image/svg+xml'
    : ext === '.png' ? 'image/png'
    : ext === '.gif' ? 'image/gif'
    : ext === '.webp' ? 'image/webp'
    : ext === '.bmp' ? 'image/bmp'
    : ext === '.ico' ? 'image/x-icon'
    : 'image/jpeg';
}

function renderImageContent(agentKey, filePath, fileName) {
  const rawUrl = `/workspace/raw/${encodeURIComponent(filePath)}?agent=${encodeURIComponent(agentKey)}`;
  return `<div class="file-view-content image-preview-wrap"><img class="file-image-preview" src="${rawUrl}" alt="${escapeHtml(fileName)}" loading="lazy" /></div>`;
}

function renderBinaryContent(fileName, size) {
  return `
    <div class="file-view-content binary-file-notice">
      <div class="binary-file-title">Binary preview is not available</div>
      <div class="binary-file-text">${escapeHtml(fileName)} is not a text file, so the viewer will not render it as plain text.</div>
      <div class="binary-file-meta">Size: ${escapeHtml(formatFileSize(size))}</div>
    </div>`;
}

function renderFileViewPage({ template, agents, agentKey, config, fileTree, fileCount, dirCount, fileName, filePath, fileType, fileSize, fileIcon, breadcrumbs, contentHtml, statusCode = 200 }) {
  const agentTabs = Object.entries(agents).map(([key, cfg]) => {
    const isActive = key === agentKey;
    const activeStyle = isActive ? `style="background: linear-gradient(180deg, rgba(0,229,255,0.14), rgba(0,229,255,0.08)); border-color: rgba(0,229,255,0.6); color: #e0fdff;"` : '';
    return `<a href="?agent=${encodeURIComponent(key)}" class="agent-tab ${isActive ? 'active' : ''}" ${activeStyle}>
      <span>${cfg.emoji}</span>
      <span>${escapeHtml(cfg.name)}</span>
    </a>`;
  }).join('');

  const html = renderTemplate(template, {
    TITLE: escapeHtml(`${fileName} - ${config.name} Workspace`),
    BODY_CLASS: 'file-view-page',
    AGENT: encodeURIComponent(agentKey),
    AGENT_KEY: escapeHtml(agentKey),
    AGENT_NAME: escapeHtml(config.name),
    AGENT_EMOJI: config.emoji,
    AGENT_COLOR: config.color,
    AGENT_TABS: agentTabs,
    FILE_TREE: fileTree,
    FILE_COUNT: fileCount,
    DIR_COUNT: dirCount,
    FILE_NAME: escapeHtml(fileName),
    FILE_ICON: fileIcon,
    FILE_SIZE: escapeHtml(fileSize),
    FILE_TYPE: escapeHtml(fileType),
    BREADCRUMBS: breadcrumbs,
    CONTENT_HTML: contentHtml,
    CURRENT_FILE_PATH: escapeHtml(filePath)
  });

  return { html, statusCode };
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

  function buildFileNotFoundPage(req) {
    const agents = getWorkspaceAgents();
    const agentKey = getValidWorkspaceAgent(req.query.agent || 'main');
    const config = agents[agentKey];
    if (!config) return null;

    const requestedPath = decodeURIComponent(req.params[0] || '');
    const files = getFileList(config.workspace);
    const fileTree = generateWorkspaceTree(files, agentKey);
    const { fileCount, dirCount } = countTree(files);
    const breadcrumbs = `<span style="color:var(--neon-yellow)">Missing file</span>`;
    const contentHtml = `
      <div class="file-view-content binary-file-notice inline-error-notice">
        <div class="binary-file-title">File not found</div>
        <div class="binary-file-text">The requested file does not exist anymore, or the path is no longer valid.</div>
        <div class="binary-file-meta">Requested path: ${escapeHtml(requestedPath || '(empty)')}</div>
        <div class="inline-error-actions">
          <a href="/workspace?agent=${encodeURIComponent(agentKey)}" class="nav-link">Back to workspace</a>
        </div>
      </div>`;

    return renderFileViewPage({
      template: workspaceViewTemplate,
      agents,
      agentKey,
      config,
      fileTree,
      fileCount,
      dirCount,
      fileName: 'File not found',
      filePath: requestedPath || 'Missing file',
      fileType: 'missing',
      fileSize: '—',
      fileIcon: '⚠️',
      breadcrumbs,
      contentHtml,
      statusCode: 404
    });
  }

  function resolveWorkspaceFile(req, res, options = {}) {
    const agents = getWorkspaceAgents();
    const agentKey = getValidWorkspaceAgent(req.query.agent || 'main');
    const config = agents[agentKey];
    if (!config) {
      if (options.inlineOnMissing) {
        const fallback = buildFileNotFoundPage(req);
        if (fallback) return res.status(fallback.statusCode).send(fallback.html);
      }
      res.status(404).send('Workspace not found');
      return null;
    }

    const filePath = decodeURIComponent(req.params[0]);
    const fullPath = path.join(config.workspace, filePath);
    if (!isPathSafe(fullPath, config.workspace) || !fs.existsSync(fullPath)) {
      if (options.inlineOnMissing) {
        const fallback = buildFileNotFoundPage(req);
        if (fallback) return res.status(fallback.statusCode).send(fallback.html);
      }
      res.status(404).send('File not found');
      return null;
    }

    return { agents, agentKey, config, filePath, fullPath };
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

  router.get('/workspace/raw/*', (req, res) => {
    const resolved = resolveWorkspaceFile(req, res);
    if (!resolved) return;

    const { fullPath, filePath } = resolved;
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();

    if (!IMAGE_EXTENSIONS.has(ext)) {
      return res.status(400).send('Raw route currently supports image preview files only');
    }

    res.setHeader('Cache-Control', 'no-store');
    res.type(getImageMimeType(fileName));
    fs.createReadStream(fullPath).pipe(res);
  });

  router.get('/workspace/view/*', (req, res) => {
    const resolved = resolveWorkspaceFile(req, res, { inlineOnMissing: true });
    if (!resolved) return;

    const { agents, agentKey, config, filePath, fullPath } = resolved;
    const stat = fs.statSync(fullPath);
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();

    let contentHtml;
    try {
      if (IMAGE_EXTENSIONS.has(ext)) {
        contentHtml = renderImageContent(agentKey, filePath, fileName);
      } else if (TEXT_EXTENSIONS.has(ext)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        if (ext === '.md') {
          contentHtml = `<div class="file-view-content markdown">${renderMarkdown(content)}</div>`;
        } else {
          contentHtml = `<div class="file-view-content"><pre>${escapeHtml(content)}</pre></div>`;
        }
      } else {
        contentHtml = renderBinaryContent(fileName, stat.size);
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
    const page = renderFileViewPage({
      template: workspaceViewTemplate,
      agents,
      agentKey,
      config,
      fileTree,
      fileCount,
      dirCount,
      fileName,
      filePath,
      fileType: ext || 'text',
      fileSize: formatFileSize(stat.size),
      fileIcon: getFileIcon(fileName),
      breadcrumbs,
      contentHtml,
      statusCode: 200
    });

    res.status(page.statusCode).send(page.html);
  });

  return router;
}

module.exports = { createWorkspaceRouter };
