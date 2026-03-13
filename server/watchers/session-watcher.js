const fs = require('fs');

function createSessionWatcher({ sessionInfo, parseLine, onActivities, onError }) {
  const { agent, path: filePath, sessionName, initialSize = 0 } = sessionInfo;
  let lastSize = initialSize;

  const watcher = fs.watch(filePath, (eventType) => {
    if (eventType !== 'change') return;

    try {
      const stats = fs.statSync(filePath);
      if (stats.size <= lastSize) return;

      const fd = fs.openSync(filePath, 'r');
      const buffer = Buffer.alloc(stats.size - lastSize);
      fs.readSync(fd, buffer, 0, buffer.length, lastSize);
      fs.closeSync(fd);

      const newLines = buffer.toString('utf8').split('\n').filter(l => l.trim());
      for (const line of newLines) {
        const activities = parseLine(line, agent, sessionName);
        if (activities) {
          activities.forEach(onActivities);
        }
      }

      lastSize = stats.size;
    } catch (err) {
      onError(err, agent);
    }
  });

  return {
    watcher,
    getLastSize() {
      return lastSize;
    },
    setLastSize(size) {
      lastSize = size;
    }
  };
}

module.exports = { createSessionWatcher };
