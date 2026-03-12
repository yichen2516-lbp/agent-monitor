const os = require('os');
const { execSync } = require('child_process');

const PLATFORM = os.platform();
const IS_MACOS = PLATFORM === 'darwin';
const IS_LINUX = PLATFORM === 'linux';

let systemStats = {
  cpu: { used: 0, user: 0, sys: 0, idle: 100 },
  gpu: { used: 0, name: 'GPU' },
  memory: { used: 0, total: 0, percentage: 0 },
  disk: { used: 0, total: 0, percentage: 0 },
  updatedAt: new Date().toISOString()
};

function execAsync(command, timeout = 5000) {
  return new Promise((resolve) => {
    try {
      const result = execSync(command, { encoding: 'utf8', timeout });
      resolve(result);
    } catch (e) {
      resolve(null);
    }
  });
}

async function getCPUStats() {
  try {
    let output;

    if (IS_MACOS) {
      output = await execAsync('top -l 1 -n 0 | grep "CPU usage"', 3000);
      if (output) {
        const match = output.match(/(\d+\.?\d*)%\s*user.*?(\d+\.?\d*)%\s*sys.*?(\d+\.?\d*)%\s*idle/);
        if (match) {
          const user = parseFloat(match[1]) || 0;
          const sys = parseFloat(match[2]) || 0;
          const idle = parseFloat(match[3]) || 0;
          return { used: Math.round(user + sys), user, sys, idle };
        }
      }
    } else if (IS_LINUX) {
      const statOutput = await execAsync('cat /proc/stat | grep "^cpu "', 2000);
      if (statOutput) {
        const parts = statOutput.split(/\s+/);
        if (parts.length >= 8) {
          const user = parseFloat(parts[1]) || 0;
          const nice = parseFloat(parts[2]) || 0;
          const system = parseFloat(parts[3]) || 0;
          const idle = parseFloat(parts[4]) || 0;
          const iowait = parseFloat(parts[5]) || 0;
          const total = user + nice + system + idle + iowait;
          const used = user + nice + system;
          const userPct = (user / total) * 100;
          const sysPct = (system / total) * 100;
          const usedPct = Math.round((used / total) * 100);
          return { used: usedPct, user: userPct, sys: sysPct, idle: (idle / total) * 100 };
        }
      }

      output = await execAsync('top -bn1 | grep "Cpu(s)"', 3000);
      if (output) {
        const match = output.match(/(\d+\.?\d*)%?\s*us.*?(\d+\.?\d*)%?\s*sy/);
        if (match) {
          const user = parseFloat(match[1]) || 0;
          const sys = parseFloat(match[2]) || 0;
          return { used: Math.round(user + sys), user, sys, idle: 100 - user - sys };
        }
      }
    }
  } catch (e) {
    console.error('[Agent-Monitor] Failed to get CPU stats:', e.message);
  }
  return { used: 0, user: 0, sys: 0, idle: 100 };
}

async function getGPUStats() {
  try {
    let used = 0;
    let name = 'GPU';

    if (IS_MACOS) {
      const output = await execAsync('ioreg -l | grep -E "(GPU|Metal|AGC)" | head -10', 3000);
      if (output) {
        const activityMatch = output.match(/"GPU Activity"[=:]\s*(\d+)/i) || output.match(/gpuActivePercentage\s*=\s*(\d+)/i);
        if (activityMatch) used = parseInt(activityMatch[1]) || 0;

        const nameMatch = output.match(/"model"[=:]\s*"([^"]+)"/i);
        if (nameMatch) name = nameMatch[1];
      }
    } else if (IS_LINUX) {
      const nvidiaOutput = await execAsync('nvidia-smi --query-gpu=utilization.gpu,name --format=csv,noheader,nounits 2>/dev/null', 3000);
      if (nvidiaOutput) {
        const parts = nvidiaOutput.split(',');
        if (parts.length >= 2) {
          used = parseInt(parts[0].trim()) || 0;
          name = parts[1].trim();
        }
      } else {
        const intelOutput = await execAsync('timeout 1 intel_gpu_top -l 1 2>/dev/null | grep -E "render|3D" | head -1', 3000);
        if (intelOutput) {
          const match = intelOutput.match(/(\d+\.?\d*)/);
          if (match) used = parseFloat(match[1]) || 0;
          name = 'Intel GPU';
        }
      }
    }

    return { used, name };
  } catch (e) {
    console.error('[Agent-Monitor] Failed to get GPU stats:', e.message);
  }
  return { used: 0, name: 'GPU' };
}

function getMemoryStats() {
  try {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;
    return {
      used: Math.round((used / 1024 / 1024 / 1024) * 100) / 100,
      total: Math.round((total / 1024 / 1024 / 1024) * 100) / 100,
      percentage: Math.round((used / total) * 100)
    };
  } catch (e) {
    console.error('[Agent-Monitor] Failed to get memory stats:', e.message);
    return { used: 0, total: 0, percentage: 0 };
  }
}

async function getDiskStats() {
  try {
    const output = await execAsync('df -h /', 3000);
    if (output) {
      const lines = output.trim().split('\n');
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        if (parts.length >= 5) {
          const total = parts[1];
          const used = parts[2];
          const percentage = parseInt(parts[4].replace('%', '')) || 0;
          const totalGB = parseFloat(total.replace(/[GT]/, '')) * (total.includes('T') ? 1024 : 1);
          const usedGB = parseFloat(used.replace(/[GT]/, '')) * (used.includes('T') ? 1024 : 1);
          return { used: Math.round(usedGB * 100) / 100, total: Math.round(totalGB * 100) / 100, percentage };
        }
      }
    }
  } catch (e) {
    console.error('[Agent-Monitor] Failed to get disk stats:', e.message);
  }
  return { used: 0, total: 0, percentage: 0 };
}

async function updateSystemStats() {
  try {
    const [cpu, gpu, disk] = await Promise.all([getCPUStats(), getGPUStats(), getDiskStats()]);
    const memory = getMemoryStats();

    systemStats = {
      cpu,
      gpu,
      memory,
      disk,
      updatedAt: new Date().toISOString()
    };
  } catch (e) {
    console.error('[Agent-Monitor] Failed to update system stats:', e.message);
  }
}

function getSystemStats() {
  return systemStats;
}

function startSystemStatsPolling(intervalMs = 2000) {
  updateSystemStats();
  return setInterval(updateSystemStats, intervalMs);
}

module.exports = {
  getSystemStats,
  startSystemStatsPolling,
  updateSystemStats
};
