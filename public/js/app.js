// PulseStream — Main App

const socket = io({ transports: ['websocket', 'polling'] });
let myRole = null;
let myName = '';
let myColor = '';
let isLive = false;
let micEnabled = true;
let camEnabled = false;
let screenEnabled = false;
let viewerCount = 0;
let uptimeInterval = null;
let streamStartTime = null;
let polls = [];
let myVotes = {};
let waitingViewers = []; // viewers who joined before host went live

const rtc = new WebRTCManager(socket);

// ── CONNECT ───────────────────────────────────────────────────────────────────
socket.on('connect', () => {
  console.log('[App] Connected:', socket.id);
  document.getElementById('loadingMsg').textContent = 'Establishing session...';
});

socket.on('role', (data) => {
  myRole = data.role;
  myName = data.name || 'Host';
  myColor = data.color || '#c084fc';
  rtc.setRole(myRole);
  setTimeout(() => {
    document.getElementById('loadingScreen').style.display = 'none';
    document.getElementById('mainNav').classList.remove('hidden');
    document.getElementById('mainApp').classList.remove('hidden');
    setupUI();
  }, 400);
});

socket.on('stream-state', (state) => {
  if (state.isLive) applyStreamStarted(state);
});

socket.on('chat-history', (msgs) => msgs.forEach(appendChat));
socket.on('polls-update', (data) => { polls = data; renderPolls(); });

// ── SETUP UI ──────────────────────────────────────────────────────────────────
function setupUI() {
  const badge = document.getElementById('roleBadge');
  if (myRole === 'host') {
    badge.textContent = '⚡ HOST';
    badge.className = 'role-badge host';
    document.querySelectorAll('.host-only').forEach(el => el.classList.remove('hidden'));
    document.getElementById('stagePlaceholderText').textContent = 'Turn on 📷 Camera or 🖥 Screen, then hit ⚡ Go Live!';
  } else {
    badge.textContent = '👁 VIEWER';
    badge.className = 'role-badge viewer';
    document.getElementById('stagePlaceholderText').textContent = 'Stream hasn\'t started yet. Hang tight! 👀';
  }

  // Viewer: receive stream
  rtc.onRemoteStream = (stream) => {
    console.log('[App] Received remote stream, tracks:', stream.getTracks().map(t => t.kind));
    const vid = document.getElementById('remoteVideo');
    vid.srcObject = stream;
    vid.style.display = 'block';
    document.getElementById('stagePlaceholder').style.display = 'none';
    vid.play().catch(e => {
      console.warn('[App] Autoplay blocked, showing play button');
      showPlayButton(vid);
    });
  };

  rtc.onStreamEnded = () => {
    document.getElementById('remoteVideo').style.display = 'none';
    document.getElementById('stagePlaceholder').style.display = 'flex';
  };
}

// Show manual play button if autoplay is blocked (common on mobile)
function showPlayButton(vid) {
  const existing = document.getElementById('playBtn');
  if (existing) return;
  const btn = document.createElement('button');
  btn.id = 'playBtn';
  btn.textContent = '▶ Tap to Watch';
  btn.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);z-index:20;padding:14px 28px;background:#7c5cfc;color:#fff;border:none;border-radius:10px;font-size:16px;font-family:Syne,sans-serif;font-weight:700;cursor:pointer';
  btn.onclick = () => { vid.play(); btn.remove(); };
  document.getElementById('stage').appendChild(btn);
}

// ── HOST: GO LIVE MODAL ───────────────────────────────────────────────────────
function openGoLiveModal() {
  document.getElementById('goLiveModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('inputTitle').focus(), 100);
}

async function startStream() {
  const title = document.getElementById('inputTitle').value.trim() || 'My Live Stream';
  const category = document.getElementById('inputCategory').value;

  // Auto-start camera if nothing is on yet
  if (!camEnabled && !screenEnabled) {
    showToast('📷 Starting camera...');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      rtc.camStream = stream;
      document.getElementById('camVideo').srcObject = stream;
      document.getElementById('camBtn').classList.add('active');
      camEnabled = true;
      const sv = document.getElementById('screenVideo');
      sv.srcObject = stream;
      sv.style.display = 'block';
      document.getElementById('stagePlaceholder').style.display = 'none';
      rtc.buildLocalStream();
    } catch(e) {
      console.warn('[App] Camera auto-start failed:', e);
      // continue anyway
    }
  }

  closeModal('goLiveModal');
  socket.emit('start-stream', { title, category });
}

socket.on('stream-started', async (state) => {
  applyStreamStarted(state);
  if (myRole === 'host') {
    showToast('🔴 You are LIVE!');
    appendSystemMsg('Stream started! Welcome everyone 👋');
    // Send to any viewers already waiting
    console.log('[App] Going live, waiting viewers:', waitingViewers.length);
    for (const id of waitingViewers) {
      await rtc.createOfferForViewer(id);
    }
  } else {
    showToast('🎉 Stream just started!');
    appendSystemMsg('Stream started! Welcome everyone 👋');
  }
});

function applyStreamStarted(state) {
  isLive = true;
  document.getElementById('streamTitleDisplay').textContent = state.title;
  document.getElementById('streamTitleNav').textContent = state.title;
  document.getElementById('categoryPill').textContent = state.category;
  document.getElementById('viewPill').classList.remove('hidden');
  document.getElementById('timePill').classList.remove('hidden');
  document.getElementById('liveBadge').classList.remove('hidden');
  document.getElementById('statusDot').classList.add('live');
  document.getElementById('statusLabel').textContent = myRole === 'host' ? '● LIVE' : 'Watching';
  if (myRole === 'host') {
    document.getElementById('goLiveBtn').classList.add('hidden');
    document.getElementById('stopBtn').classList.remove('hidden');
  }
  streamStartTime = state.startedAt || Date.now();
  clearInterval(uptimeInterval);
  uptimeInterval = setInterval(() => {
    const s = Math.floor((Date.now() - streamStartTime) / 1000);
    document.getElementById('uptime').textContent =
      String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
  }, 1000);
}

// ── HOST: STOP STREAM ─────────────────────────────────────────────────────────
function stopStream() {
  if (!confirm('End the stream?')) return;
  socket.emit('stop-stream');
}

socket.on('stream-stopped', () => {
  isLive = false;
  clearInterval(uptimeInterval);
  document.getElementById('liveBadge').classList.add('hidden');
  document.getElementById('viewPill').classList.add('hidden');
  document.getElementById('timePill').classList.add('hidden');
  document.getElementById('statusDot').classList.remove('live');
  document.getElementById('statusLabel').textContent = 'Offline';
  document.getElementById('streamTitleNav').textContent = '';
  if (myRole === 'host') {
    document.getElementById('goLiveBtn').classList.remove('hidden');
    document.getElementById('stopBtn').classList.add('hidden');
    rtc.stopAll();
    document.getElementById('screenVideo').style.display = 'none';
    document.getElementById('camPip').classList.add('hidden');
    document.getElementById('screenBadge').classList.add('hidden');
    document.getElementById('stagePlaceholder').style.display = 'flex';
    document.getElementById('stagePlaceholderText').textContent = 'Turn on 📷 Camera or 🖥 Screen, then hit ⚡ Go Live!';
    document.getElementById('screenBtn').classList.remove('active');
    document.getElementById('camBtn').classList.remove('active');
    screenEnabled = false; camEnabled = false;
    waitingViewers = [];
  } else {
    document.getElementById('remoteVideo').style.display = 'none';
    document.getElementById('stagePlaceholder').style.display = 'flex';
  }
  appendSystemMsg('Stream ended. Thanks for watching! 🙏');
});

socket.on('host-disconnected', () => {
  appendSystemMsg('Host disconnected.');
  showToast('Host has disconnected');
});

// ── HOST: VIEWER MANAGEMENT ───────────────────────────────────────────────────
socket.on('viewer-joined', async ({ id, name, color }) => {
  if (myRole !== 'host') return;
  appendSystemMsg(`👤 ${name} joined`);
  if (isLive && rtc.localStream) {
    console.log('[App] Viewer joined while live, sending stream to', id);
    await rtc.createOfferForViewer(id);
  } else {
    console.log('[App] Viewer joined before live, queuing:', id);
    waitingViewers.push(id);
  }
});

socket.on('viewer-left', ({ id, name }) => {
  if (myRole !== 'host') return;
  waitingViewers = waitingViewers.filter(v => v !== id);
  rtc.removeViewer(id);
  appendSystemMsg(`👋 ${name} left`);
});

socket.on('viewer-count', (count) => {
  viewerCount = count;
  document.getElementById('viewCount').textContent = count;
  document.getElementById('chatViewerCount').textContent = count + ' viewer' + (count !== 1 ? 's' : '');
});

// ── WEBRTC SIGNALING ──────────────────────────────────────────────────────────
socket.on('webrtc-offer', async ({ from, offer }) => {
  if (myRole === 'viewer') {
    await rtc.handleOffer(from, offer);
  } else if (myRole === 'host') {
    // Renegotiation answer
    await rtc.handleAnswer(from, offer);
  }
});

socket.on('webrtc-answer', async ({ from, answer }) => {
  if (myRole === 'host') await rtc.handleAnswer(from, answer);
});

socket.on('webrtc-ice', async ({ from, candidate }) => {
  if (myRole === 'host') await rtc.handleIceFromViewer(from, candidate);
  else await rtc.handleIceFromHost(from, candidate);
});

// ── HOST: MIC ─────────────────────────────────────────────────────────────────
function toggleMic() {
  micEnabled = !micEnabled;
  [rtc.camStream, rtc.screenStream].forEach(s => {
    if (s) s.getAudioTracks().forEach(t => { t.enabled = micEnabled; });
  });
  const btn = document.getElementById('micBtn');
  btn.classList.toggle('muted', !micEnabled);
  btn.querySelector('.ctrl-icon').textContent = micEnabled ? '🎙' : '🔇';
  showToast(micEnabled ? '🎙 Mic on' : '🔇 Mic muted');
}

// ── HOST: CAMERA ──────────────────────────────────────────────────────────────
async function toggleCam() {
  if (camEnabled) {
    if (rtc.camStream) { rtc.camStream.getTracks().forEach(t => t.stop()); rtc.camStream = null; }
    document.getElementById('camPip').classList.add('hidden');
    document.getElementById('camVideo').srcObject = null;
    document.getElementById('camBtn').classList.remove('active');
    camEnabled = false;
    if (!screenEnabled) {
      document.getElementById('screenVideo').style.display = 'none';
      document.getElementById('stagePlaceholder').style.display = 'flex';
    }
    rtc.buildLocalStream();
    if (isLive) await rtc.updateAllViewers();
    showToast('📷 Camera off');
  } else {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      rtc.camStream = stream;
      document.getElementById('camVideo').srcObject = stream;
      document.getElementById('camBtn').classList.add('active');
      camEnabled = true;
      if (!screenEnabled) {
        document.getElementById('screenVideo').srcObject = stream;
        document.getElementById('screenVideo').style.display = 'block';
        document.getElementById('stagePlaceholder').style.display = 'none';
      } else {
        document.getElementById('camPip').classList.remove('hidden');
      }
      rtc.buildLocalStream();
      if (isLive) await rtc.updateAllViewers();
      showToast('📷 Camera on');
    } catch(e) {
      showToast('❌ Camera access denied. Check browser permissions.');
      console.error(e);
    }
  }
}

// ── HOST: SCREEN SHARE ────────────────────────────────────────────────────────
async function toggleScreen() {
  if (screenEnabled) {
    if (rtc.screenStream) { rtc.screenStream.getTracks().forEach(t => t.stop()); rtc.screenStream = null; }
    document.getElementById('screenBadge').classList.add('hidden');
    document.getElementById('screenBtn').classList.remove('active');
    screenEnabled = false;
    if (camEnabled) {
      document.getElementById('screenVideo').srcObject = rtc.camStream;
      document.getElementById('screenVideo').style.display = 'block';
      document.getElementById('camPip').classList.add('hidden');
    } else {
      document.getElementById('screenVideo').style.display = 'none';
      document.getElementById('stagePlaceholder').style.display = 'flex';
    }
    rtc.buildLocalStream();
    if (isLive) await rtc.updateAllViewers();
    showToast('🖥 Screen share stopped');
  } else {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
      rtc.screenStream = stream;
      document.getElementById('screenVideo').srcObject = stream;
      document.getElementById('screenVideo').style.display = 'block';
      document.getElementById('stagePlaceholder').style.display = 'none';
      document.getElementById('screenBadge').classList.remove('hidden');
      document.getElementById('screenBtn').classList.add('active');
      screenEnabled = true;
      if (camEnabled) document.getElementById('camPip').classList.remove('hidden');
      stream.getVideoTracks()[0].onended = () => { screenEnabled = true; toggleScreen(); };
      rtc.buildLocalStream();
      if (isLive) await rtc.updateAllViewers();
      showToast('🖥 Screen sharing started');
    } catch(e) {
      showToast('Screen share cancelled');
    }
  }
}

// ── CHAT ──────────────────────────────────────────────────────────────────────
function sendChat() {
  const inp = document.getElementById('chatInput');
  const text = inp.value.trim();
  if (!text) return;
  socket.emit('chat-msg', { text });
  inp.value = '';
}

socket.on('chat-msg', appendChat);

function appendChat(msg) {
  const c = document.getElementById('chatMessages');
  const el = document.createElement('div');
  el.className = 'chat-msg' + (msg.isSystem ? ' system' : '') + (msg.isHost ? ' host-msg' : '');
  const av = (msg.name || '?').substring(0, 2).toUpperCase();
  el.innerHTML = `
    <div class="chat-msg-header">
      <div class="chat-avatar" style="background:${msg.color}22;color:${msg.color}">${av}</div>
      <span class="chat-name" style="color:${msg.color}">${esc(msg.name)}${msg.isHost ? ' 👑' : ''}</span>
      <span class="chat-time">${msg.time || ''}</span>
    </div>
    <div class="chat-text">${esc(msg.text)}</div>`;
  c.appendChild(el);
  c.scrollTop = c.scrollHeight;
}

function appendSystemMsg(text) {
  appendChat({
    name: 'PulseStream', color: '#7c5cfc', isSystem: true, text,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  });
}

// ── REACTIONS ─────────────────────────────────────────────────────────────────
function sendReaction(emoji) { socket.emit('reaction', emoji); }

socket.on('reaction', ({ emoji }) => {
  const c = document.getElementById('reactionsContainer');
  const el = document.createElement('div');
  el.className = 'float-emoji';
  el.textContent = emoji;
  el.style.left = (Math.random() * 80 + 10) + '%';
  el.style.bottom = '80px';
  c.appendChild(el);
  setTimeout(() => el.remove(), 2500);
});

// ── POLLS ─────────────────────────────────────────────────────────────────────
function openPollModal() {
  if (myRole !== 'host') return;
  document.getElementById('pollModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('pollQ').focus(), 100);
}

function addPollOpt() {
  const list = document.getElementById('pollOptionsList');
  if (list.children.length >= 6) { showToast('Max 6 options'); return; }
  const n = list.children.length + 1;
  const row = document.createElement('div');
  row.className = 'poll-opt-row';
  row.innerHTML = `<input placeholder="Option ${n}" class="poll-opt-inp"><button class="rm-opt" onclick="rmOpt(this)">✕</button>`;
  list.appendChild(row);
}

function rmOpt(btn) {
  if (document.getElementById('pollOptionsList').children.length <= 2) {
    showToast('Need at least 2 options'); return;
  }
  btn.closest('.poll-opt-row').remove();
}

function submitPoll() {
  const q = document.getElementById('pollQ').value.trim();
  const opts = [...document.querySelectorAll('.poll-opt-inp')].map(i => i.value.trim()).filter(Boolean);
  if (!q) { showToast('Enter a question'); return; }
  if (opts.length < 2) { showToast('Add at least 2 options'); return; }
  socket.emit('create-poll', { question: q, options: opts });
  closeModal('pollModal');
  document.getElementById('pollQ').value = '';
  document.querySelectorAll('.poll-opt-inp').forEach(i => i.value = '');
  const list = document.getElementById('pollOptionsList');
  while (list.children.length > 2) list.lastChild.remove();
  showToast('📊 Poll launched!');
}

function votePoll(pollId, optIdx) {
  if (myVotes[pollId] !== undefined) { showToast('Already voted!'); return; }
  if (myRole === 'host') { showToast('Host cannot vote'); return; }
  socket.emit('vote-poll', { pollId, optionIndex: optIdx });
  myVotes[pollId] = optIdx;
  renderPolls();
}

function renderPolls() {
  const c = document.getElementById('pollsContainer');
  if (!polls.length) { c.innerHTML = '<div class="polls-empty">No polls yet</div>'; return; }
  c.innerHTML = polls.map(p => {
    const total = p.votes.reduce((a, b) => a + b, 0) || 1;
    const maxV = Math.max(...p.votes);
    const voted = myVotes[p.id] !== undefined;
    return `<div class="poll-card">
      <div class="poll-card-q">${esc(p.question)}</div>
      ${p.options.map((o, i) => {
        const pct = Math.round(p.votes[i] / total * 100);
        const lead = p.votes[i] === maxV && p.votes[i] > 0;
        return `<div class="poll-opt" onclick="votePoll(${p.id},${i})">
          <div class="poll-opt-header">
            <span class="poll-opt-label">${esc(o)}${myVotes[p.id]===i?' ✓':''}</span>
            <span class="poll-opt-pct${lead?' leader':''}">${pct}%</span>
          </div>
          <div class="poll-bar-track"><div class="poll-bar-fill${lead?' leader':''}" style="width:${pct}%"></div></div>
        </div>`;
      }).join('')}
      <div class="poll-footer">
        <span>${p.votes.reduce((a,b)=>a+b,0)} votes</span>
        ${voted ? '<span class="poll-voted">✓ Voted</span>' : (myRole!=='host'?'<span style="color:var(--muted)">Click to vote</span>':'')}
      </div>
    </div>`;
  }).join('');
}

// ── UTILS ─────────────────────────────────────────────────────────────────────
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

function copyStreamLink() {
  navigator.clipboard.writeText(window.location.href)
    .then(() => showToast('🔗 Stream link copied!'))
    .catch(() => showToast('Link: ' + window.location.href));
}

let toastTimer;
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function esc(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

document.querySelectorAll('.modal-overlay').forEach(el => {
  el.addEventListener('click', e => { if (e.target === el) el.classList.add('hidden'); });
});
