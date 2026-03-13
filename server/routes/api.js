const express = require('express');

function createApiRouter({ monitorStore, writeRollingLog }) {
  const router = express.Router();

  const apiMetrics = {
    total: 0,
    sinceRequests: 0,
    totalLatencyMs: 0
  };

  router.get('/api', (req, res) => {
    const start = Date.now();
    const since = req.query.since || null;

    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Content-Type', 'application/json');

    const payload = monitorStore.getStatus(since);
    res.json(payload);

    const latency = Date.now() - start;
    apiMetrics.total += 1;
    if (since) apiMetrics.sinceRequests += 1;
    apiMetrics.totalLatencyMs += latency;

    const avgLatency = (apiMetrics.totalLatencyMs / apiMetrics.total).toFixed(1);
    const sinceHitRate = ((apiMetrics.sinceRequests / apiMetrics.total) * 100).toFixed(1);

    const apiLog = `[Agent-Monitor][API] /api latency=${latency}ms avg=${avgLatency}ms count=${payload.activities.length} since=${since ? 'yes' : 'no'} sinceHitRate=${sinceHitRate}% total=${apiMetrics.total}`;
    console.log(apiLog);
    writeRollingLog('INFO', apiLog);
  });

  router.get('/health', (req, res) => {
    res.json({ status: 'ok', agents: monitorStore.getActiveSessionsCount() });
  });

  return router;
}

module.exports = { createApiRouter };
