window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.uiState = {
  save(refs) {
    const state = window.AgentMonitor.state;
    const snapshot = {
      filterAgent: refs.filterAgentEl.value,
      filterType: refs.filterTypeEl.value,
      filterKeyword: refs.filterKeywordEl.value,
      filterErrorsOnly: refs.filterErrorsOnlyEl.checked,
      errorAggregateMode: state.errorAggregateMode
    };
    try {
      localStorage.setItem(state.STORAGE_KEY, JSON.stringify(snapshot));
    } catch (_) {}
  },

  load(refs) {
    const state = window.AgentMonitor.state;
    try {
      const raw = localStorage.getItem(state.STORAGE_KEY);
      if (!raw) return;
      const snapshot = JSON.parse(raw);
      if (snapshot.filterType) refs.filterTypeEl.value = snapshot.filterType;
      if (typeof snapshot.filterKeyword === 'string') refs.filterKeywordEl.value = snapshot.filterKeyword;
      if (typeof snapshot.filterErrorsOnly === 'boolean') refs.filterErrorsOnlyEl.checked = snapshot.filterErrorsOnly;
      if (typeof snapshot.errorAggregateMode === 'boolean') {
        state.errorAggregateMode = snapshot.errorAggregateMode;
        refs.toggleErrorAggregateEl.textContent = 'Error Aggregate: ' + (state.errorAggregateMode ? 'On' : 'Off');
      }
    } catch (_) {}
  },

  getSavedAgent() {
    const state = window.AgentMonitor.state;
    try {
      return JSON.parse(localStorage.getItem(state.STORAGE_KEY) || '{}').filterAgent;
    } catch (_) {
      return null;
    }
  }
};
