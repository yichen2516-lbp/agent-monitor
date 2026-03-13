(function () {
  window.AgentMonitor = window.AgentMonitor || {};

  function isReady() {
    const app = window.AgentMonitor;
    return !!(
      app.dom &&
      app.render &&
      app.uiState &&
      app.poller &&
      app.state
    );
  }

  function bootstrap() {
    if (!isReady()) {
      console.warn('[Agent-Monitor] bootstrap delayed: modules not ready yet');
      setTimeout(bootstrap, 50);
      return;
    }

    const dom = window.AgentMonitor.dom;
    const render = window.AgentMonitor.render;
    const uiState = window.AgentMonitor.uiState;
    const poller = window.AgentMonitor.poller;
    const state = window.AgentMonitor.state;

    if (state.__bootstrapped) return;
    state.__bootstrapped = true;

    const refs = dom.getRefs();

    [refs.filterAgentEl, refs.filterTypeEl, refs.filterKeywordEl, refs.filterErrorsOnlyEl].forEach(el => {
      el.addEventListener('input', () => {
        render.renderFilteredList(refs);
        uiState.save(refs);
      });
      el.addEventListener('change', () => {
        render.renderFilteredList(refs);
        uiState.save(refs);
      });
    });

    refs.toggleErrorAggregateEl.addEventListener('click', () => {
      state.errorAggregateMode = !state.errorAggregateMode;
      refs.toggleErrorAggregateEl.textContent = 'Error Aggregate: ' + (state.errorAggregateMode ? 'On' : 'Off');
      render.renderFilteredList(refs);
      uiState.save(refs);
    });

    const setQuickMode = (mode) => {
      state.quickMode = state.quickMode === mode ? 'all' : mode;
      render.renderFilteredList(refs);
      uiState.save(refs);
    };

    refs.quickResetFiltersEl.addEventListener('click', () => {
      refs.filterAgentEl.value = 'all';
      refs.filterTypeEl.value = 'all';
      refs.filterKeywordEl.value = '';
      refs.filterErrorsOnlyEl.checked = false;
      state.errorAggregateMode = false;
      state.quickMode = 'all';
      refs.toggleErrorAggregateEl.textContent = 'Error Aggregate: Off';
      render.renderFilteredList(refs);
      uiState.save(refs);
    });

    refs.metricCardErrors5mEl?.addEventListener('click', () => {
      refs.filterErrorsOnlyEl.checked = true;
      state.quickMode = 'all';
      render.renderFilteredList(refs);
      uiState.save(refs);
    });

    refs.metricCardSlowCallsEl?.addEventListener('click', () => setQuickMode('slow'));
    refs.quickFailedToolsEl?.addEventListener('click', () => setQuickMode('failed-tools'));
    refs.quickToolErrorsEl?.addEventListener('click', () => setQuickMode('tool-errors'));
    refs.quickCronErrorsEl?.addEventListener('click', () => setQuickMode('cron-errors'));

    document.addEventListener('click', async (e) => {
      if (e.target && e.target.id === 'detail-close') {
        dom.getDetailDrawerEl()?.classList.remove('open');
        refs.drawerOverlayEl?.classList.remove('open');
        return;
      }

      const copyTarget = e.target?.dataset?.copyTarget;
      if (copyTarget) {
        const detailBodyEl = dom.getDetailBodyEl();
        const copyMap = {
          json: detailBodyEl?.dataset?.copyJson || '',
          source: detailBodyEl?.dataset?.copySource || '',
          session: detailBodyEl?.dataset?.copySession || ''
        };
        const text = copyMap[copyTarget] || '';
        if (!text) return;
        try {
          await navigator.clipboard.writeText(text);
          e.target.textContent = 'Copied';
          setTimeout(() => {
            e.target.textContent = copyTarget === 'json' ? 'Copy Event JSON' : copyTarget === 'source' ? 'Copy Source Path' : 'Copy Session';
          }, 1200);
        } catch (err) {
          console.warn('[Agent-Monitor] copy failed:', err.message);
        }
      }
    });

    refs.drawerOverlayEl?.addEventListener('click', () => {
      dom.getDetailDrawerEl()?.classList.remove('open');
      refs.drawerOverlayEl?.classList.remove('open');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && dom.getDetailDrawerEl()?.classList.contains('open')) {
        dom.getDetailDrawerEl().classList.remove('open');
        refs.drawerOverlayEl?.classList.remove('open');
      }
    });

    uiState.load(refs);
    render.initCodeBackground(refs);
    poller.start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();
