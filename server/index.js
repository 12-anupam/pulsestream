const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

app.use(express.static(path.join(__dirname, '../public')));

let streamState = {
  isLive: false,
  title: '',
  category: '',
  startedAt: null,
  hostId: null,
};

let viewers = new Map();
let polls = [];
let chatHistory = [];

const COLORS = ['#7c5cfc','#c084fc','#22c55e','#f59e0b','#ff3b5c','#06b6d4','#a78bfa','#fb923c'];
const NAMES = ['StargazerX','TechWizard','NeonDreamer','PixelPirate','CosmoVibes','ByteRacer','AlphaWave','ShadowByte','NovaCoder','GlitchHero','PulseRider','ZeroLag'];

io.on('connection', (socket) => {
  console.log('[+]', socket.id);

  const isHost = !streamState.hostId;

  if (isHost) {
    streamState.hostId = socket.id;
    socket.join('host');
    socket.emit('role', { role: 'host' });
    socket.emit('stream-state', streamState);
    console.log('[HOST]', socket.id);
  } else {
    socket.join('viewers');
    const name = NAMES[Math.floor(Math.random() * NAMES.length)] + Math.floor(Math.random() * 99 + 1);
    const color = COLORS[Math.floor(Math.random() * COLORS.length)];
    viewers.set(socket.id, { name, color });
    socket.emit('role', { role: 'viewer', name, color });
    socket.emit('stream-state', streamState);
    socket.emit('chat-history', chatHistory.slice(-50));
    socket.emit('polls-update', polls);
    if (streamState.isLive) {
      io.to('host').emit('viewer-joined', { id: socket.id, name, color });
    }
    io.emit('viewer-count', viewers.size);
    console.log('[VIEWER]', name);
  }

  // Stream control
  socket.on('start-stream', (data) => {
    if (socket.id !== streamState.hostId) return;
    streamState.isLive = true;
    streamState.title = data.title || 'Live Stream';
    streamState.category = data.category || 'Just Chatting';
    streamState.startedAt = Date.now();
    io.emit('stream-started', streamState);
  });

  socket.on('stop-stream', () => {
    if (socket.id !== streamState.hostId) return;
    streamState.isLive = false;
    streamState.startedAt = null;
    io.emit('stream-stopped');
  });

  // WebRTC signaling — host sends offer to specific viewer
  socket.on('webrtc-offer', ({ to, offer }) => {
    io.to(to).emit('webrtc-offer', { from: socket.id, offer });
  });

  // Viewer sends answer back to host
  socket.on('webrtc-answer', ({ to, answer }) => {
    io.to(to).emit('webrtc-answer', { from: socket.id, answer });
  });

  // ICE candidates
  socket.on('webrtc-ice', ({ to, candidate }) => {
    io.to(to).emit('webrtc-ice', { from: socket.id, candidate });
  });

  // Chat
  socket.on('chat-msg', (data) => {
    const isHostMsg = socket.id === streamState.hostId;
    const sender = isHostMsg
      ? { name: 'Host', color: '#c084fc', isHost: true }
      : (viewers.get(socket.id) || { name: 'Anon', color: '#888' });
    const msg = {
      id: Date.now() + Math.random(),
      name: sender.name,
      color: sender.color,
      isHost: isHostMsg,
      text: data.text,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    chatHistory.push(msg);
    if (chatHistory.length > 200) chatHistory.shift();
    io.emit('chat-msg', msg);
  });

  // Reactions
  socket.on('reaction', (emoji) => {
    io.emit('reaction', { emoji });
  });

  // Polls
  socket.on('create-poll', (data) => {
    if (socket.id !== streamState.hostId) return;
    const poll = {
      id: Date.now(),
      question: data.question,
      options: data.options,
      votes: data.options.map(() => 0),
      voters: [],
    };
    polls.push(poll);
    io.emit('polls-update', polls);
    const msg = {
      id: Date.now(),
      name: 'PulseStream',
      color: '#7c5cfc',
      isSystem: true,
      text: '📊 New poll: ' + poll.question,
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    chatHistory.push(msg);
    io.emit('chat-msg', msg);
  });

  socket.on('vote-poll', ({ pollId, optionIndex }) => {
    const poll = polls.find(p => p.id === pollId);
    if (!poll || poll.voters.includes(socket.id)) return;
    poll.votes[optionIndex]++;
    poll.voters.push(socket.id);
    io.emit('polls-update', polls);
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (socket.id === streamState.hostId) {
      streamState.hostId = null;
      streamState.isLive = false;
      io.emit('stream-stopped');
      io.emit('host-disconnected');
      console.log('[HOST disconnected]');
    } else {
      const v = viewers.get(socket.id);
      viewers.delete(socket.id);
      io.emit('viewer-count', viewers.size);
      if (v) io.to('host').emit('viewer-left', { id: socket.id, name: v.name });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log('🟣 PulseStream on port', PORT);
});
