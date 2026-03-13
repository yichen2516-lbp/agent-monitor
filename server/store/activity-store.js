function createActivityStore({ maxActivities, maxCronActivities = 50, activityMaxAgeHours }) {
  let recentActivities = [];
  let cronActivities = [];

  function append(activities, source, filePath) {
    if (!activities || activities.length === 0) return;
    const enriched = activities.map(a => ({ ...a, source: filePath }));
    if (source === 'cron') {
      cronActivities.push(...enriched);
      if (cronActivities.length > maxCronActivities) cronActivities = cronActivities.slice(-maxCronActivities);
      return;
    }

    recentActivities.push(...enriched);
    if (recentActivities.length > maxActivities) recentActivities = recentActivities.slice(-maxActivities);
  }

  function appendIncremental(activity) {
    if (!activity) return;
    recentActivities.push(activity);
    if (recentActivities.length > maxActivities) recentActivities.shift();
  }

  function getStatus(since = null) {
    const allActivities = [...recentActivities, ...cronActivities];
    const nowMs = Date.now();
    const maxAgeMs = Math.max(1, Number(activityMaxAgeHours || 24)) * 60 * 60 * 1000;

    let sorted = allActivities
      .filter(a => {
        const ts = new Date(a.timestamp).getTime();
        return !isNaN(ts) && (nowMs - ts) <= maxAgeMs;
      })
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    if (since) {
      const sinceMs = new Date(since).getTime();
      if (!isNaN(sinceMs)) sorted = sorted.filter(a => new Date(a.timestamp).getTime() > sinceMs);
    }

    return sorted.slice(0, maxActivities);
  }

  return {
    append,
    appendIncremental,
    getStatus
  };
}

module.exports = { createActivityStore };
