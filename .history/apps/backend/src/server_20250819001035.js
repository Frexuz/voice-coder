import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';

const app = express();
app.use(cors());
app.use(express.json());

app.post('/api/prompt', (req, res) => {
  const { id, text } = req.body || {};
  if (!text) return res.status(400).json({ error: 'missing text' });
  const reply = `you said '${text}'`;
  res.json({ id, text: reply });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

wss.on('connection', (ws) => {
  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'prompt') {
        const reply = `you said '${msg.text}'`;
        ws.send(JSON.stringify({ type: 'ack', id: msg.id }));
        // small delay to simulate processing
        setTimeout(() => {
          ws.send(JSON.stringify({ type: 'reply', id: msg.id, text: reply }));
        }, 100);
      }
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', message: 'invalid json' }));
    }
  });
});

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.destroy();
  }
});

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`backend listening on http://localhost:${PORT}`);
});
