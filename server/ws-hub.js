const crypto = require('crypto');

const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

function encodeTextFrame(text) {
  const payload = Buffer.from(String(text), 'utf8');
  const length = payload.length;

  if (length < 126) {
    return Buffer.concat([Buffer.from([0x81, length]), payload]);
  }

  if (length < 65536) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(length, 2);
    return Buffer.concat([header, payload]);
  }

  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(length), 2);
  return Buffer.concat([header, payload]);
}

function createWsHub() {
  const clients = new Set();

  function broadcast(event, payload) {
    const message = JSON.stringify({ event, payload, sentAt: new Date().toISOString() });
    const frame = encodeTextFrame(message);

    for (const socket of clients) {
      if (socket.destroyed || !socket.writable) {
        clients.delete(socket);
        continue;
      }

      try {
        socket.write(frame);
      } catch (_) {
        clients.delete(socket);
        try { socket.destroy(); } catch (_) {}
      }
    }
  }

  function handleUpgrade(req, socket) {
    const key = req.headers['sec-websocket-key'];
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    const acceptKey = crypto
      .createHash('sha1')
      .update(key + WS_GUID)
      .digest('base64');

    const headers = [
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${acceptKey}`,
      '\r\n'
    ];

    socket.write(headers.join('\r\n'));
    socket.setNoDelay(true);
    clients.add(socket);

    try {
      socket.write(encodeTextFrame(JSON.stringify({ event: 'connected', payload: { ok: true }, sentAt: new Date().toISOString() })));
    } catch (_) {}

    socket.on('close', () => clients.delete(socket));
    socket.on('end', () => clients.delete(socket));
    socket.on('error', () => clients.delete(socket));
    socket.on('data', (buffer) => {
      if (!buffer || buffer.length === 0) return;
      const opcode = buffer[0] & 0x0f;
      if (opcode === 0x8) {
        clients.delete(socket);
        socket.end();
      }
    });
  }

  return {
    handleUpgrade,
    broadcast,
    getClientCount() {
      return clients.size;
    }
  };
}

module.exports = { createWsHub };
