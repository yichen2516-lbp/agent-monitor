window.AgentMonitor = window.AgentMonitor || {};

window.AgentMonitor.systemPanel = {
  update(system) {
    if (!system) return;

    if (system.cpu) {
      document.getElementById('cpu-value').textContent = system.cpu.used + '%';
    }
    if (system.gpu) {
      document.getElementById('gpu-value').textContent = system.gpu.used + '%';
    }
    if (system.memory) {
      document.getElementById('mem-value').textContent = system.memory.percentage + '%';
    }
    if (system.disk) {
      document.getElementById('disk-value').textContent = system.disk.percentage + '%';
    }
  }
};
