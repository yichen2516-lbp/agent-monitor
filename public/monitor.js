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

    refs.quickResetFiltersEl.addEventListener('click', () => {
      refs.filterAgentEl.value = 'all';
      refs.filterTypeEl.value = 'all';
      refs.filterKeywordEl.value = '';
      refs.filterErrorsOnlyEl.checked = false;
      state.errorAggregateMode = false;
      refs.toggleErrorAggregateEl.textContent = 'Error Aggregate: Off';
      render.renderFilteredList(refs);
      uiState.save(refs);
    });

    document.addEventListener('click', (e) => {
      if (e.target && e.target.id === 'detail-close') {
        dom.getDetailDrawerEl()?.classList.remove('open');
        refs.drawerOverlayEl?.classList.remove('open');
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
