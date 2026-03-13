const fs = require('fs');
const path = require('path');

function createLogger({ baseDir, logRetentionDays = 3 }) {
  const logDir = path.join(baseDir, 'logs');

  function ensureLogDir() {
    try {
      if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
    } catch (e) {
      console.error('[Agent-Monitor] 创建日志目录失败:', e.message);
    }
  }

  function getDailyLogFileName(date = new Date()) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `agent-monitor-${y}-${m}-${d}.log`;
  }

  function writeRollingLog(level, message) {
    try {
      ensureLogDir();
      const line = `[${new Date().toISOString()}] [${level}] ${message}\n`;
      const filePath = path.join(logDir, getDailyLogFileName());
      fs.appendFileSync(filePath, line, 'utf8');
    } catch (e) {
      console.error('[Agent-Monitor] 写日志失败:', e.message);
    }
  }

  function cleanupOldLogs() {
    try {
      ensureLogDir();
      const files = fs.readdirSync(logDir)
        .filter(f => /^agent-monitor-\d{4}-\d{2}-\d{2}\.log$/.test(f));

      const now = Date.now();
      const keepMs = Math.max(1, logRetentionDays) * 24 * 60 * 60 * 1000;

      for (const file of files) {
        const match = file.match(/(\d{4})-(\d{2})-(\d{2})/);
        if (!match) continue;
        const ts = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`).getTime();
        if (isNaN(ts)) continue;
        if (now - ts > keepMs) {
          fs.unlinkSync(path.join(logDir, file));
        }
      }
    } catch (e) {
      console.error('[Agent-Monitor] 清理旧日志失败:', e.message);
    }
  }

  function startCleanupScheduler(intervalMs = 6 * 60 * 60 * 1000) {
    cleanupOldLogs();
    return setInterval(cleanupOldLogs, intervalMs);
  }

  return {
    logDir,
    ensureLogDir,
    getDailyLogFileName,
    writeRollingLog,
    cleanupOldLogs,
    startCleanupScheduler
  };
}

module.exports = { createLogger };
