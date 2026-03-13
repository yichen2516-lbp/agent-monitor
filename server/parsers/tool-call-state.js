function createToolCallState() {
  const pendingToolCalls = new Map();
  const sessionModelSnapshots = new Map();

  return {
    setPending(toolCallId, payload) {
      if (!toolCallId) return;
      pendingToolCalls.set(toolCallId, payload);
    },

    consumePending(toolCallId) {
      if (!toolCallId || !pendingToolCalls.has(toolCallId)) return null;
      const payload = pendingToolCalls.get(toolCallId);
      pendingToolCalls.delete(toolCallId);
      return payload;
    },

    hasPending(toolCallId) {
      return !!toolCallId && pendingToolCalls.has(toolCallId);
    },

    setSessionModel(sessionKey, model) {
      if (!sessionKey || !model) return;
      sessionModelSnapshots.set(sessionKey, model);
    },

    getSessionModel(sessionKey) {
      return sessionModelSnapshots.get(sessionKey) || null;
    }
  };
}

module.exports = { createToolCallState };
