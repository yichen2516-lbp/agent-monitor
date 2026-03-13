const fs = require('fs');
const path = require('path');
const express = require('express');
const {
  getWorkspaceAgents,
  getValidWorkspaceAgent,
  isPathSafe,
  getFileList,
  getDirectoryEntries,
  formatFileSize,
  getFileIcon,
  generateWorkspaceTree,
  flattenWorkspace,
  getAncestorPaths,
  escapeHtml
} = require('../workspace');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico']);
const TEXT_EXTENSIONS = new Set(['.md', '.txt', '.json', '.js', '.ts', '.jsx', '.tsx', '.py', '.sh', '.yml', '.yaml', '.html', '.css', '.sql', '.csv', '.log', '.xml']);
const SEARCH_INDEX_LIMIT = 5000;
const TEXT_PREVIEW_CHAR_LIMIT = 120000;

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

function renderImageContent(agentKey, filePath, fileName, stat) {
  const rawUrl = `/workspace/raw/${encodeURIComponent(filePath)}?agent=${encodeURIComponent(agentKey)}`;
  return `
    <div class="file-view-content image-preview-wrap">
      <div class="image-preview-meta">Image preview · ${escapeHtml(formatFileSize(stat.size))}</div>
      <img class="file-image-preview" src="${rawUrl}" alt="${escapeHtml(fileName)}" loading="lazy" />
    </div>`;
}

function renderBinaryContent(fileName, size, rawUrl) {
  return `
    <div class="file-view-content binary-file-notice">
      <div class="binary-file-title">Binary preview is not available</div>
      <div class="binary-file-text">${escapeHtml(fileName)} is not a text file, so the viewer will not render it as plain text.</div>
      <div class="binary-file-meta">Size: ${escapeHtml(formatFileSize(size))}</div>
      <div class="content-actions"><a href="${rawUrl}" class="nav-link" target="_blank" rel="noreferrer">Open raw file</a></div>
    </div>`;
}

function makeSearchIndexJson(files, agentKey) {
  const flattened = flattenWorkspace(files, { limit: SEARCH_INDEX_LIMIT });
  return JSON.stringify({
    files: flattened.files,
    truncated: flattened.truncated,
    limit: SEARCH_INDEX_LIMIT,
    agent: agentKey
  })
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026');
}

function buildWorkspaceTree(files, agentKey, currentFile = '') {
  const expandedPaths = new Set(getAncestorPaths(currentFile));
  return generateWorkspaceTree(files, agentKey, {
    initialDepth: currentFile ? 0 : 1,
    expandedPaths,
    alwaysExpandedPaths: expandedPaths
  });
}

function makeNavLink(href, label, kind = '') {
  return `<a href="${href}" class="nav-link ${kind}">${label}</a>`;
}

function buildFileNavigation(files, agentKey, currentFilePath) {
  const flattened = flattenWorkspace(files);
  const fileList = flattened.files;
  const currentIndex = fileList.findIndex((item) => item.path === currentFilePath);
  const prev = currentIndex > 0 ? fileList[currentIndex - 1] : null;
  const next = currentIndex >= 0 && currentIndex < fileList.length - 1 ? fileList[currentIndex + 1] : null;

  return {
    prev,
    next,
    html: `
      <div class="file-nav-row">
        ${prev ? makeNavLink(`/workspace/view/${encodeURIComponent(prev.path)}?agent=${encodeURIComponent(agentKey)}`, `← Prev · ${escapeHtml(prev.name)}`) : '<span class="nav-link is-disabled">← Prev</span>'}
        ${next ? makeNavLink(`/workspace/view/${encodeURIComponent(next.path)}?agent=${encodeURIComponent(agentKey)}`, `Next · ${escapeHtml(next.name)} →`) : '<span class="nav-link is-disabled">Next →</span>'}
      </div>`
  };
}

function renderFileViewPage({ template, agents, agentKey, config, fileTree, fileCount, dirCount, fileName, filePath, fileType, fileSize, fileIcon, breadcrumbs, contentHtml, files, navHtml = '', rawFileUrl = '#', statusCode = 200 }) {
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
    CURRENT_FILE_PATH: escapeHtml(filePath),
    SEARCH_INDEX_JSON: makeSearchIndexJson(files, agentKey),
    FILE_NAVIGATION: navHtml,
    RAW_FILE_URL: rawFileUrl
  });

  return { html, statusCode };
}

function buildTextContent({ content, ext, stat, isFullView, fullViewUrl, compactViewUrl, rawFileUrl }) {
  const isTruncated = !isFullView && content.length > TEXT_PREVIEW_CHAR_LIMIT;
  const previewText = isTruncated ? content.slice(0, TEXT_PREVIEW_CHAR_LIMIT) : content;
  const metaParts = [isTruncated ? `Previewing first ${TEXT_PREVIEW_CHAR_LIMIT.toLocaleString()} chars` : 'Full text preview', formatFileSize(stat.size)];
  const actions = [`<a href="${rawFileUrl}" class="nav-link" target="_blank" rel="noreferrer">Open raw</a>`];
  if (isTruncated) actions.unshift(`<a href="${fullViewUrl}" class="nav-link">View full file</a>`);
  if (isFullView && compactViewUrl) actions.unshift(`<a href="${compactViewUrl}" class="nav-link">Back to compact preview</a>`);

  const metaHtml = `<div class="text-preview-meta">${metaParts.join(' · ')}</div><div class="content-actions">${actions.join('')}</div>`;

  if (ext === '.md') {
    return `<div class="file-view-content markdown">${metaHtml}${renderMarkdown(previewText)}${isTruncated ? '<div class="preview-fade"></div>' : ''}</div>`;
  }

  return `<div class="file-view-content">${metaHtml}<pre>${escapeHtml(previewText)}</pre>${isTruncated ? '<div class="preview-fade"></div>' : ''}</div>`;
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
    const fileTree = buildWorkspaceTree(files, agentKey, requestedPath);
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
      files,
      navHtml: '',
      rawFileUrl: '#',
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
    const fileTree = buildWorkspaceTree(files, agentKey);
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
      AGENT_COLOR: config.color,
      SEARCH_INDEX_JSON: makeSearchIndexJson(files, agentKey),
      FILE_NAVIGATION: '',
      RAW_FILE_URL: '#'
    });
    res.send(html);
  });

  router.get('/workspace/tree/*', (req, res) => {
    const agents = getWorkspaceAgents();
    const agentKey = getValidWorkspaceAgent(req.query.agent || 'main');
    const config = agents[agentKey];
    if (!config) return res.status(404).send('Workspace not found');

    const dirPath = decodeURIComponent(req.params[0] || '');
    const fullPath = path.join(config.workspace, dirPath);
    if (!isPathSafe(fullPath, config.workspace) || !fs.existsSync(fullPath) || !fs.statSync(fullPath).isDirectory()) {
      return res.status(404).send('Directory not found');
    }

    const children = getDirectoryEntries(config.workspace, dirPath);
    const html = generateWorkspaceTree(children, agentKey, { initialDepth: 0 }, 1);
    res.setHeader('Cache-Control', 'no-store');
    res.send(html);
  });

  router.get('/workspace/raw/*', (req, res) => {
    const resolved = resolveWorkspaceFile(req, res);
    if (!resolved) return;

    const { fullPath, filePath } = resolved;
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();

    res.setHeader('Cache-Control', 'no-store');
    if (IMAGE_EXTENSIONS.has(ext)) {
      res.type(getImageMimeType(fileName));
      return fs.createReadStream(fullPath).pipe(res);
    }

    return res.sendFile(fullPath);
  });

  router.get('/workspace/view/*', (req, res) => {
    const resolved = resolveWorkspaceFile(req, res, { inlineOnMissing: true });
    if (!resolved) return;

    const { agents, agentKey, config, filePath, fullPath } = resolved;
    const stat = fs.statSync(fullPath);
    const fileName = path.basename(filePath);
    const ext = path.extname(fileName).toLowerCase();
    const isFullView = req.query.full === '1';
    const rawFileUrl = `/workspace/raw/${encodeURIComponent(filePath)}?agent=${encodeURIComponent(agentKey)}`;
    const fullViewUrl = `/workspace/view/${encodeURIComponent(filePath)}?agent=${encodeURIComponent(agentKey)}&full=1`;
    const compactViewUrl = `/workspace/view/${encodeURIComponent(filePath)}?agent=${encodeURIComponent(agentKey)}`;

    let contentHtml;
    try {
      if (IMAGE_EXTENSIONS.has(ext)) {
        contentHtml = renderImageContent(agentKey, filePath, fileName, stat);
      } else if (TEXT_EXTENSIONS.has(ext)) {
        const content = fs.readFileSync(fullPath, 'utf-8');
        contentHtml = buildTextContent({ content, ext, stat, isFullView, fullViewUrl, compactViewUrl, rawFileUrl });
      } else {
        contentHtml = renderBinaryContent(fileName, stat.size, rawFileUrl);
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
    const fileTree = buildWorkspaceTree(files, agentKey, filePath);
    const { fileCount, dirCount } = countTree(files);
    const navigation = buildFileNavigation(files, agentKey, filePath);
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
      files,
      navHtml: navigation.html,
      rawFileUrl,
      statusCode: 200
    });

    res.status(page.statusCode).send(page.html);
  });

  return router;
}

module.exports = { createWorkspaceRouter };
