(function () {
  'use strict';

  const STORAGE_KEY = 'workspace.state.v1';
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

  function init() {
    const searchInput = document.getElementById('workspace-search');
    const treeContainer = document.getElementById('file-tree-container');
    const sidebar = document.getElementById('workspace-sidebar');
    const sidebarClose = document.getElementById('sidebar-close-btn');
    const sidebarOpen = document.getElementById('sidebar-open-btn');

    if (!treeContainer) return;

    const state = loadState();

    const expandedSet = new Set(state.expandedDirs?.[currentAgent] || []);
    const searchTerm = state.searchTerm || '';

    function persistExpanded() {
      const allDirs = treeContainer.querySelectorAll('.dir-header');
      const expanded = [];
      allDirs.forEach(h => {
        if (h.classList.contains('expanded')) {
          expanded.push(h.querySelector('.dir-name')?.textContent || '');
        }
      });
      state.expandedDirs = state.expandedDirs || {};
      state.expandedDirs[currentAgent] = expanded;
      saveState(state);
    }

    function restoreExpanded() {
      const allDirs = treeContainer.querySelectorAll('.dir-header');
      allDirs.forEach(h => {
        const name = h.querySelector('.dir-name')?.textContent;
        if (expandedSet.has(name)) {
          h.classList.add('expanded');
          const content = h.nextElementSibling;
          if (content && content.classList.contains('dir-content')) {
            content.classList.remove('collapsed');
          }
        }
      });
    }

    function highlightCurrentFile() {
      if (!currentFile) return;
      const links = treeContainer.querySelectorAll('.file-link');
      links.forEach(link => {
        const href = link.getAttribute('href') || '';
        if (href.includes(encodeURIComponent(currentFile))) {
          link.classList.add('is-current');
        } else {
          link.classList.remove('is-current');
        }
      });
    }

    function countVisible() {
      const visible = treeContainer.querySelectorAll('.file-link:not([data-hidden="1"])');
      const countEl = document.getElementById('search-count');
      if (countEl) countEl.textContent = visible.length;
    }

    function applySearch(term) {
      const lower = (term || '').trim().toLowerCase();
      state.searchTerm = lower;
      saveState(state);

      const allFiles = treeContainer.querySelectorAll('.file-link');
      const allDirs = treeContainer.querySelectorAll('.dir-header');

      if (!lower) {
        allFiles.forEach(f => f.removeAttribute('data-hidden'));
        allDirs.forEach(d => {
          const parent = d.closest('li');
          if (parent) parent.style.display = '';
        });
        treeContainer.querySelectorAll('.dir-content').forEach(c => c.classList.add('collapsed'));
        treeContainer.querySelectorAll('.dir-header').forEach(h => h.classList.remove('expanded'));
        restoreExpanded();
        highlightCurrentFile();
        countVisible();
        return;
      }

      const matchedPaths = new Set();
      allFiles.forEach(link => {
        const nameEl = link.querySelector('.file-name');
        const name = (nameEl?.textContent || '').toLowerCase();
        if (name.includes(lower)) {
          link.removeAttribute('data-hidden');
          let el = link.closest('.dir-content');
          while (el) {
            const header = el.previousElementSibling;
            if (header && header.classList.contains('dir-header')) {
              const dirName = header.querySelector('.dir-name')?.textContent;
              if (dirName) matchedPaths.add(dirName);
            }
            el = el.closest('.dir-content');
          }
        } else {
          link.setAttribute('data-hidden', '1');
        }
      });

      allDirs.forEach(h => {
        const nameEl = h.querySelector('.dir-name');
        const dirName = nameEl?.textContent || '';
        const isMatch = dirName.toLowerCase().includes(lower) || matchedPaths.has(dirName);
        const parent = h.closest('li');
        if (parent) parent.style.display = isMatch ? '' : 'none';
        if (isMatch) {
          h.classList.add('expanded');
          const content = h.nextElementSibling;
          if (content && content.classList.contains('dir-content')) {
            content.classList.remove('collapsed');
          }
        }
      });

      countVisible();
    }

    function handleToggleDir(header) {
      header.classList.toggle('expanded');
      const content = header.nextElementSibling;
      if (content && content.classList.contains('dir-content')) {
        content.classList.toggle('collapsed');
      }
      persistExpanded();
    }

    function toggleSidebar() {
      sidebar.classList.toggle('is-open');
    }

    treeContainer.addEventListener('click', function (e) {
      const header = e.target.closest('.dir-header');
      if (header) {
        e.preventDefault();
        handleToggleDir(header);
      }
    });

    if (sidebarClose) sidebarClose.addEventListener('click', toggleSidebar);
    if (sidebarOpen) sidebarOpen.addEventListener('click', toggleSidebar);

    if (searchInput) {
      searchInput.value = searchTerm;
      searchInput.addEventListener('input', function () {
        applySearch(searchInput.value);
      });
    }

    restoreExpanded();
    highlightCurrentFile();
    applySearch(searchTerm);

    document.querySelectorAll('.file-link').forEach(link => {
      link.addEventListener('click', function (e) {
        if (window.innerWidth <= 768) {
          sidebar.classList.remove('is-open');
        }
        state.lastFile = link.getAttribute('href') || '';
        saveState(state);
      });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
