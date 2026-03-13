function createActivityParser({ toolCallState }) {
  function buildToolCallPayload({ toolName, args, timestamp, model, provider, usage, stopReason }) {
    return { toolName, args, timestamp, model, provider, usage, stopReason };
  }

  function parseNewMessageFormat(data, agentName, sessionName, sessionKey) {
    const msg = data.message;
    const timestamp = data.timestamp || new Date().toISOString();
    const model = data.model || data.request?.model || toolCallState.getSessionModel(sessionKey) || null;
    const provider = data.provider || null;
    const usage = data.usage || null;
    const stopReason = data.stopReason || null;
    const activities = [];

    if (msg.role === 'tool' && msg.toolCallId) {
      const callInfo = toolCallState.consumePending(msg.toolCallId);
      if (!callInfo) return null;
      activities.push({
        type: 'tool',
        agent: agentName,
        sessionName,
        tool: callInfo.toolName,
        description: `🔍 ${callInfo.toolName} ${typeof callInfo.args === 'string' ? callInfo.args : JSON.stringify(callInfo.args)}`,
        timestamp,
        model: callInfo.model,
        provider: callInfo.provider,
        usage: callInfo.usage,
        stopReason: callInfo.stopReason,
        durationMs: msg.durationMs,
        exitCode: msg.exitCode,
        toolStatus: msg.status,
        toolError: msg.isError
      });
      return activities;
    }

    if (msg.role === 'assistant' && Array.isArray(msg.content)) {
      for (const item of msg.content) {
        if (item.type === 'thinking' && item.thinking) {
          activities.push({ type: 'thinking', agent: agentName, sessionName, description: `💭 ${item.thinking}`, timestamp, model, provider, usage, stopReason });
        }
        if (item.type === 'text' && item.text) {
          activities.push({ type: 'reply', agent: agentName, sessionName, description: `💬 ${item.text}`, timestamp, fullText: item.text, model, provider, usage, stopReason });
        }
        if (item.type === 'toolCall') {
          const toolName = item.name || 'unknown';
          const args = item.arguments ? JSON.stringify(item.arguments) : '';
          const toolCallId = item.id || item.toolCallId;
          toolCallState.setPending(toolCallId, buildToolCallPayload({ toolName, args, timestamp, model, provider, usage, stopReason }));
          activities.push({ type: 'tool', agent: agentName, sessionName, tool: toolName, description: `🔧 ${toolName} ${args}`, timestamp, model, provider, usage, stopReason });
        }
      }
      return activities.length > 0 ? activities : null;
    }

    if (msg.role === 'user' && Array.isArray(msg.content)) {
      const text = msg.content.map(c => c.text || '').join('');
      if (!text) return null;
      return [{ type: 'reply', agent: agentName, sessionName, description: `💬 ${text}`, timestamp, fullText: text, model, provider, usage, stopReason }];
    }

    return null;
  }

  function parseLegacyFormat(data, agentName, sessionName) {
    const item = data.item || data;
    const timestamp = data.timestamp || item.timestamp || new Date().toISOString();
    const itemTimestamp = new Date(timestamp).toISOString();
    const model = data.model || item.model || data.request?.model || null;
    const provider = data.provider || item.provider || null;
    const usage = data.usage || item.usage || null;
    const stopReason = data.stopReason || item.stopReason || null;
    const activities = [];

    if (item.type === 'tool_call') {
      const toolName = item.toolName || item.tool_name || 'unknown';
      const args = item.arguments || item.args || '';
      const toolCallId = item.id || item.toolCallId || item.tool_call_id || null;
      toolCallState.setPending(toolCallId, buildToolCallPayload({ toolName, args, timestamp: itemTimestamp, model, provider, usage, stopReason }));
      activities.push({ type: 'tool', agent: agentName, sessionName, tool: toolName, description: `🔧 ${toolName} ${typeof args === 'string' ? args : JSON.stringify(args)}`, timestamp: itemTimestamp, model, provider, usage, stopReason });
    }

    if (item.type === 'tool_result') {
      const toolCallId = item.toolCallId || item.tool_call_id || item.id || null;
      const callInfo = toolCallState.consumePending(toolCallId);
      if (callInfo) {
        activities.push({
          type: 'tool',
          agent: agentName,
          sessionName,
          tool: callInfo.toolName,
          description: `🔍 ${callInfo.toolName} ${typeof callInfo.args === 'string' ? callInfo.args : JSON.stringify(callInfo.args)}`,
          timestamp: itemTimestamp,
          model: callInfo.model,
          provider: callInfo.provider,
          usage: callInfo.usage,
          stopReason: callInfo.stopReason,
          durationMs: item.durationMs,
          exitCode: item.exitCode,
          toolStatus: item.status,
          toolError: item.isError
        });
      }
    }

    if (item.type === 'thinking') {
      activities.push({ type: 'thinking', agent: agentName, sessionName, description: `💭 ${item.thinking || ''}`, timestamp: itemTimestamp, model, provider, usage, stopReason });
    }

    if (item.type === 'text' && item.text) {
      activities.push({ type: 'reply', agent: agentName, sessionName, description: `💬 ${item.text}`, timestamp: itemTimestamp, fullText: item.text, model, provider, usage, stopReason });
    }

    return activities.length > 0 ? activities : null;
  }

  return {
    parseLine(line, agentName, sessionName) {
      try {
        const data = JSON.parse(line);
        const sessionKey = `${agentName}:${sessionName}`;

        if (data.type === 'custom' && data.customType === 'model-snapshot') {
          toolCallState.setSessionModel(sessionKey, data.data?.modelId || data.data?.model || null);
          return null;
        }

        if (data.type === 'message' && data.message) {
          return parseNewMessageFormat(data, agentName, sessionName, sessionKey);
        }

        return parseLegacyFormat(data, agentName, sessionName);
      } catch (_) {
        return null;
      }
    }
  };
}

module.exports = { createActivityParser };
