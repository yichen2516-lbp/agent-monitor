/**
 * Agent Monitor - OpenClaw Agent 实时状态监控
 *
 * 独立运行版本，无需依赖 LBP-Tools
 */

const fs = require('fs');
const path = require('path');
const express = require('express');
const { loadConfig } = require('./server/config');
const { createLogger } = require('./server/logger');
const { getSystemStats, startSystemStatsPolling } = require('./server/system-stats');
const { createMonitorStore } = require('./server/monitor-store');
const { createApiRouter } = require('./server/routes/api');
const { createWorkspaceRouter } = require('./server/routes/workspace');

const app = express();
const PORT = process.env.PORT || 3450;
const BASE_DIR = __dirname;

const CONFIG = loadConfig(BASE_DIR);
console.log('[Agent-Monitor] Agents 目录:', CONFIG.agentsDir);

const logger = createLogger({
  baseDir: BASE_DIR,
  logRetentionDays: CONFIG.logRetentionDays
});
logger.startCleanupScheduler();

startSystemStatsPolling(2000);

const monitorStore = createMonitorStore({ CONFIG, getSystemStats });
const monitorHtml = fs.readFileSync(path.join(BASE_DIR, 'views', 'monitor.html'), 'utf8');

app.use('/public', express.static(path.join(BASE_DIR, 'public')));

app.get('/', (req, res) => {
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.send(monitorHtml);
});

app.use(createApiRouter({
  monitorStore,
  writeRollingLog: logger.writeRollingLog
}));

app.use(createWorkspaceRouter({ baseDir: BASE_DIR }));

monitorStore.init();

app.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔════════════════════════════════════════════════════════╗
║              Agent Monitor 已启动                      ║
╠════════════════════════════════════════════════════════╣
║  本地访问: http://localhost:${PORT}                    ║
║  局域网访问: http://0.0.0.0:${PORT}                    ║
║  API: http://localhost:${PORT}/api                     ║
╚════════════════════════════════════════════════════════╝
  `);
});

module.exports = app;
