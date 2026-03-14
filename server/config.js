const fs = require('fs');
const path = require('path');
const os = require('os');

function loadFileConfig(baseDir) {
  const configPath = path.join(baseDir, 'config.json');
  if (!fs.existsSync(configPath)) return {};

  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (e) {
    console.error('[Agent-Monitor] 配置文件解析失败:', e.message);
    return {};
  }
}

function getDefaultAgentsDir() {
  return path.join(os.homedir(), '.openclaw', 'agents');
}

function loadConfig(baseDir) {
  const fileConfig = loadFileConfig(baseDir);

  return {
    agentsDir: process.env.AGENTS_DIR || fileConfig.agentsDir || getDefaultAgentsDir(),
    maxActivities: Number(process.env.MAX_ACTIVITIES || fileConfig.maxActivities || 160),
    maxCronActivities: Number(process.env.MAX_CRON_ACTIVITIES || fileConfig.maxCronActivities || 20),
    pollInterval: Number(process.env.POLL_INTERVAL || fileConfig.pollInterval || 10000),
    refreshInterval: Number(process.env.REFRESH_INTERVAL || fileConfig.refreshInterval || 1000),
    logRetentionDays: Number(process.env.LOG_RETENTION_DAYS || fileConfig.logRetentionDays || 3),
    activityMaxAgeHours: Number(process.env.ACTIVITY_MAX_AGE_HOURS || fileConfig.activityMaxAgeHours || 24)
  };
}

module.exports = {
  loadConfig,
  getDefaultAgentsDir
};
