(function () {
  'use strict';

  const STORAGE_KEY = 'workspace.state.v3';
  const RECENT_LIMIT = 8;
  const currentAgent = document.body.dataset.agent || 'main';
  const currentFile = document.body.dataset.currentFile || '';

  function loadState() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function normalizePath(path) {
    return String(path || '').replace(/^\/+/, '');
  }

  function parseSearchIndex() {
    const node = document.getElementById('workspace-search-index');
    if (!node) return { files: [], truncated: false, limit: 0 };

    try {
      return JSON.parse(node.textContent || '{}');
    } catch (_) {
      return { files: [], truncated: false, limit: 0 };
    }
  }

  function fileNameFromPath(filePath) {
    const normalized = normalizePath(filePath);
    const parts = normalized.split('/').filter(Boolean);
    return parts[parts.length - 1] || normalized || '(unknown)';
  }

  function makeFileHref(filePath) {
    return `/workspace/view/${encodeURIComponent(normalizePath(filePath))}?agent=${encodeURIComponent(currentAgent)}`;
  }

  function init() {
    const searchInput = document.getElementById('workspace-search');
    const treeContainer = document.getElementById('file-tree-container');
    const searchResultsContainer = document.getElementById('search-results-container');
    const recentFilesContainer = document.getElementById('recent-files-container');
    const sidebar = document.getElementById('workspace-sidebar');
    const sidebarClose = document.getElementById('sidebar-close-btn');
    const sidebarOpen = document.getElementById('sidebar-open-btn');
    const sidebarOpenInline = document.getElementById('sidebar-open-btn-inline');
    const sidebarBackdrop = document.getElementById('mobile-sidebar-backdrop');
    const countEl = document.getElementById('search-count');

    if (!treeContainer) return;

    const searchIndex = parseSearchIndex();
    const state = loadState();
    const initialExpanded = new Set((state.expandedDirs && state.expandedDirs[currentAgent]) || []);
    const searchTerm = state.searchTerm || '';

    state.recentFiles = state.recentFiles || {};
    state.recentFiles[currentAgent] = state.recentFiles[currentAgent] || [];

    function setCount(value) {
      if (countEl) countEl.textContent = String(value);
    }

    function getExpandedPaths() {
      return Array.from(treeContainer.querySelectorAll('.dir-header.expanded'))
        .map((node) => normalizePath(node.dataset.dirPath))
        .filter(Boolean);
    }

    function persistExpanded() {
      state.expandedDirs = state.expandedDirs || {};
      state.expandedDirs[currentAgent] = getExpandedPaths();
      saveState(state);
    }

    function pushRecentFile(filePath) {
      const normalized = normalizePath(filePath);
      if (!normalized) return;
      const current = state.recentFiles[currentAgent] || [];
      const next = [normalized].concat(current.filter((item) => item !== normalized)).slice(0, RECENT_LIMIT);
      state.recentFiles[currentAgent] = next;
      saveState(state);
      renderRecentFiles();
    }

    function renderRecentFiles() {
      if (!recentFilesContainer) return;
      const items = (state.recentFiles[currentAgent] || []).slice(0, RECENT_LIMIT);
      if (!items.length) {
        recentFilesContainer.innerHTML = '<div class="recent-empty">No recent files yet</div>';
        return;
      }

      recentFilesContainer.innerHTML = items.map((filePath) => `
        <a href="${makeFileHref(filePath)}" class="file-link recent-file-link" data-file-path="${escapeHtml(filePath)}">
          <span class="file-icon">🕘</span>
          <span class="search-result-body">
            <span class="file-name">${escapeHtml(fileNameFromPath(filePath))}</span>
            <span class="search-result-path">${escapeHtml(filePath)}</span>
          </span>
        </a>`).join('');
      highlightCurrentFile();
    }

    async function loadDirectoryChildren(header) {
      if (!header || header.dataset.loaded === '1') return;
      const dirPath = normalizePath(header.dataset.dirPath);
      const content = header.nextElementSibling;
      if (!dirPath || !content || !content.classList.contains('dir-content')) return;

      header.classList.add('is-loading');
      try {
        const response = await fetch(`/workspace/tree/${encodeURIComponent(dirPath)}?agent=${encodeURIComponent(currentAgent)}`, {
          headers: { 'X-Requested-With': 'workspace-browser' },
          cache: 'no-store'
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        content.innerHTML = await response.text();
        header.dataset.loaded = '1';
      } catch (error) {
        content.innerHTML = `<div class="tree-inline-error">Failed to load folder: ${escapeHtml(error.message)}</div>`;
        header.dataset.loaded = '0';
      } finally {
        header.classList.remove('is-loading');
      }
    }

    async function expandDirectory(header) {
      if (!header) return;
      await loadDirectoryChildren(header);
      header.classList.add('expanded');
      const content = header.nextElementSibling;
      if (content && content.classList.contains('dir-content')) {
        content.classList.remove('collapsed');
      }
      persistExpanded();
    }

    function collapseDirectory(header) {
      if (!header) return;
      header.classList.remove('expanded');
      const content = header.nextElementSibling;
      if (content && content.classList.contains('dir-content')) {
        content.classList.add('collapsed');
      }
      persistExpanded();
    }

    async function restoreExpanded() {
      for (const dirPath of initialExpanded) {
        const header = treeContainer.querySelector(`.dir-header[data-dir-path="${CSS.escape(dirPath)}"]`);
        if (header) {
          await expandDirectory(header);
        }
      }
    }

    function markCurrentLinks(container) {
      if (!container || !currentFile) return;
      const normalizedCurrent = normalizePath(currentFile);
      const links = container.querySelectorAll('.file-link');
      links.forEach((link) => {
        if (normalizePath(link.dataset.filePath) === normalizedCurrent) {
          link.classList.add('is-current');
        } else {
          link.classList.remove('is-current');
        }
      });
    }

    function highlightCurrentFile() {
      markCurrentLinks(treeContainer);
      markCurrentLinks(searchResultsContainer);
      markCurrentLinks(recentFilesContainer);
    }

    function renderSearchResults(term) {
      if (!searchResultsContainer) return;
      const lower = String(term || '').trim().toLowerCase();
      state.searchTerm = lower;
      saveState(state);

      if (!lower) {
        searchResultsContainer.hidden = true;
        searchResultsContainer.innerHTML = '';
        treeContainer.hidden = false;
        setCount(searchIndex.files.length || 0);
        highlightCurrentFile();
        return;
      }

      const matchedFiles = searchIndex.files.filter((item) => {
        const haystack = `${item.name} ${item.path}`.toLowerCase();
        return haystack.includes(lower);
      });
      const limitedFiles = matchedFiles.slice(0, 200);

      const resultHtml = limitedFiles.length
        ? limitedFiles.map((item) => `
            <a href="${makeFileHref(item.path)}" class="file-link search-result-link" data-file-path="${escapeHtml(item.path)}">
              <span class="file-icon">${item.icon}</span>
              <span class="search-result-body">
                <span class="file-name">${escapeHtml(item.name)}</span>
                <span class="search-result-path">${escapeHtml(item.path)}</span>
              </span>
              <span class="file-size">${escapeHtml(item.sizeLabel)}</span>
            </a>`).join('')
        : '<div class="search-empty">No matching files</div>';

      const truncationNote = matchedFiles.length > limitedFiles.length
        ? `<div class="search-note">Showing first ${limitedFiles.length} matches out of ${matchedFiles.length}</div>`
        : (searchIndex.truncated ? `<div class="search-note">Search index limited to first ${searchIndex.limit} files for responsiveness</div>` : '');

      searchResultsContainer.innerHTML = `${truncationNote}<div class="search-results-list">${resultHtml}</div>`;
      searchResultsContainer.hidden = false;
      treeContainer.hidden = true;
      setCount(matchedFiles.length);
      highlightCurrentFile();
    }

    async function handleToggleDir(header) {
      if (!header) return;
      if (header.classList.contains('expanded')) {
        collapseDirectory(header);
        return;
      }
      await expandDirectory(header);
      highlightCurrentFile();
    }

    function setSidebarOpen(isOpen) {
      if (!sidebar) return;
      sidebar.classList.toggle('is-open', isOpen);
      if (sidebarBackdrop) {
        sidebarBackdrop.hidden = !isOpen;
      }
      document.body.classList.toggle('mobile-sidebar-open', isOpen);
    }

    function toggleSidebar() {
      if (!sidebar) return;
      setSidebarOpen(!sidebar.classList.contains('is-open'));
    }

    treeContainer.addEventListener('click', function (e) {
      const header = e.target.closest('.dir-header');
      if (header) {
        e.preventDefault();
        handleToggleDir(header);
      }
    });

    document.addEventListener('click', function (e) {
      const link = e.target.closest('.file-link');
      if (!link) return;
      const filePath = link.dataset.filePath || '';
      if (filePath) pushRecentFile(filePath);
      if (window.innerWidth <= 768 && sidebar) {
        setSidebarOpen(false);
      }
      state.lastFile = link.getAttribute('href') || '';
      saveState(state);
    });

    if (currentFile) {
      pushRecentFile(currentFile);
    } else {
      renderRecentFiles();
    }

    if (sidebarClose) sidebarClose.addEventListener('click', toggleSidebar);
    if (sidebarOpen) sidebarOpen.addEventListener('click', toggleSidebar);
    if (sidebarOpenInline) sidebarOpenInline.addEventListener('click', toggleSidebar);
    if (sidebarBackdrop) sidebarBackdrop.addEventListener('click', function () { setSidebarOpen(false); });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && sidebar && sidebar.classList.contains('is-open')) {
        setSidebarOpen(false);
      }
    });

    if (searchInput) {
      searchInput.value = searchTerm;
      searchInput.addEventListener('input', function () {
        renderSearchResults(searchInput.value);
      });
    }

    Promise.resolve()
      .then(restoreExpanded)
      .then(highlightCurrentFile)
      .then(function () {
        renderSearchResults(searchTerm);
      });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
