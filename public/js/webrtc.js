// PulseStream WebRTC Manager - Fixed for cross-network streaming

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Free reliable TURN servers
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:80?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ],
  iceCandidatePoolSize: 10
};

class WebRTCManager {
  constructor(socket) {
    this.socket = socket;
    this.role = null;
    this.peerConnections = new Map();
    this.localStream = null;
    this.screenStream = null;
    this.camStream = null;
    this.onRemoteStream = null;
    this.onStreamEnded = null;
  }

  setRole(role) { this.role = role; }

  // HOST: create offer for a specific viewer
  async createOfferForViewer(viewerId) {
    console.log('[RTC] Creating offer for', viewerId);

    // Close existing connection if any
    if (this.peerConnections.has(viewerId)) {
      this.peerConnections.get(viewerId).close();
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections.set(viewerId, pc);

    // Add tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        console.log('[RTC] Adding track:', track.kind, track.label);
        pc.addTrack(track, this.localStream);
      });
    } else {
      console.warn('[RTC] No localStream when creating offer!');
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit('webrtc-ice', { to: viewerId, candidate: e.candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[RTC Host] ICE:', pc.iceConnectionState, viewerId);
      if (pc.iceConnectionState === 'failed') {
        console.log('[RTC] Restarting ICE for', viewerId);
        pc.restartIce();
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[RTC Host] Connection:', pc.connectionState, viewerId);
    };

    try {
      const offer = await pc.createOffer({
        offerToReceiveAudio: false,
        offerToReceiveVideo: false
      });
      await pc.setLocalDescription(offer);
      this.socket.emit('webrtc-offer', { to: viewerId, offer: pc.localDescription });
      console.log('[RTC] Offer sent to', viewerId);
    } catch(e) {
      console.error('[RTC] createOffer error:', e);
    }

    return pc;
  }

  // HOST: handle answer from viewer
  async handleAnswer(viewerId, answer) {
    const pc = this.peerConnections.get(viewerId);
    if (!pc) { console.warn('[RTC] No PC for viewer', viewerId); return; }
    try {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('[RTC] Answer accepted from', viewerId);
      }
    } catch(e) {
      console.error('[RTC] setRemoteDescription error:', e);
    }
  }

  // HOST: ICE candidate from viewer
  async handleIceFromViewer(viewerId, candidate) {
    const pc = this.peerConnections.get(viewerId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch(e) { /* ignore */ }
  }

  // VIEWER: handle offer from host
  async handleOffer(hostId, offer) {
    console.log('[RTC Viewer] Got offer from host');

    if (this.peerConnections.has(hostId)) {
      this.peerConnections.get(hostId).close();
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections.set(hostId, pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit('webrtc-ice', { to: hostId, candidate: e.candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[RTC Viewer] ICE:', pc.iceConnectionState);
    };

    pc.onconnectionstatechange = () => {
      console.log('[RTC Viewer] Connection:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        console.log('[RTC Viewer] ✅ Connected to host!');
      }
      if (pc.connectionState === 'failed' || pc.connectionState === 'disconnected') {
        if (this.onStreamEnded) this.onStreamEnded();
      }
    };

    // This fires when host's video/audio arrives
    pc.ontrack = (e) => {
      console.log('[RTC Viewer] ✅ Got track:', e.track.kind, 'streams:', e.streams.length);
      if (e.streams && e.streams[0]) {
        console.log('[RTC Viewer] Stream has tracks:', e.streams[0].getTracks().map(t=>t.kind));
        if (this.onRemoteStream) this.onRemoteStream(e.streams[0]);
      } else {
        // fallback: build stream from track directly
        const stream = new MediaStream([e.track]);
        if (this.onRemoteStream) this.onRemoteStream(stream);
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.emit('webrtc-answer', { to: hostId, answer: pc.localDescription });
      console.log('[RTC Viewer] Answer sent');
    } catch(e) {
      console.error('[RTC Viewer] Error:', e);
    }
  }

  // VIEWER: ICE from host
  async handleIceFromHost(hostId, candidate) {
    const pc = this.peerConnections.get(hostId);
    if (!pc) return;
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch(e) { /* ignore */ }
  }

  // HOST: combine screen + cam into one stream
  buildLocalStream() {
    const tracks = [];
    if (this.screenStream) {
      this.screenStream.getVideoTracks().forEach(t => tracks.push(t));
      this.screenStream.getAudioTracks().forEach(t => tracks.push(t));
    }
    if (this.camStream) {
      if (!this.screenStream) {
        // No screen share: use cam video
        this.camStream.getVideoTracks().forEach(t => tracks.push(t));
      }
      // Always add cam audio if no screen audio
      if (!this.screenStream || this.screenStream.getAudioTracks().length === 0) {
        this.camStream.getAudioTracks().forEach(t => tracks.push(t));
      }
    }
    if (tracks.length > 0) {
      this.localStream = new MediaStream(tracks);
      console.log('[RTC] Built localStream:', tracks.map(t => t.kind + ':' + t.label));
    } else {
      this.localStream = null;
      console.warn('[RTC] No tracks for localStream');
    }
  }

  // HOST: push new tracks to all connected viewers
  async updateAllViewers() {
    if (!this.localStream) {
      console.warn('[RTC] updateAllViewers: no localStream');
      return;
    }
    console.log('[RTC] Updating', this.peerConnections.size, 'viewers');

    for (const [viewerId, pc] of this.peerConnections.entries()) {
      try {
        const senders = pc.getSenders();
        const newTracks = this.localStream.getTracks();

        for (const track of newTracks) {
          const existingSender = senders.find(s => s.track && s.track.kind === track.kind);
          if (existingSender) {
            await existingSender.replaceTrack(track);
            console.log('[RTC] Replaced track', track.kind, 'for', viewerId);
          } else {
            pc.addTrack(track, this.localStream);
            console.log('[RTC] Added new track', track.kind, 'for', viewerId);
            // Renegotiate
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.socket.emit('webrtc-offer', { to: viewerId, offer: pc.localDescription });
          }
        }
      } catch(e) {
        console.error('[RTC] updateAllViewers error for', viewerId, e);
        // If update fails, create fresh offer
        await this.createOfferForViewer(viewerId);
      }
    }
  }

  removeViewer(viewerId) {
    const pc = this.peerConnections.get(viewerId);
    if (pc) { pc.close(); this.peerConnections.delete(viewerId); }
  }

  stopAll() {
    for (const pc of this.peerConnections.values()) pc.close();
    this.peerConnections.clear();
    if (this.screenStream) { this.screenStream.getTracks().forEach(t => t.stop()); this.screenStream = null; }
    if (this.camStream) { this.camStream.getTracks().forEach(t => t.stop()); this.camStream = null; }
    this.localStream = null;
  }
}
