// PulseStream WebRTC Manager
// Host streams to each viewer via individual peer connections

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    {
      urls: 'turn:openrelay.metered.ca:80',
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
  ]
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

  // HOST: send stream to a new viewer
  async createOfferForViewer(viewerId) {
    console.log('[WebRTC] Creating offer for viewer:', viewerId);
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections.set(viewerId, pc);

    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
        console.log('[WebRTC] Added track:', track.kind);
      });
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit('webrtc-ice', { to: viewerId, candidate: e.candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC Host] ICE state:', pc.iceConnectionState, 'for', viewerId);
      if (pc.iceConnectionState === 'failed') {
        pc.restartIce();
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC Host] Connection state:', pc.connectionState);
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.peerConnections.delete(viewerId);
      }
    };

    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit('webrtc-offer', { to: viewerId, offer });
      console.log('[WebRTC] Offer sent to', viewerId);
    } catch(e) {
      console.error('[WebRTC] Offer error:', e);
    }
    return pc;
  }

  // HOST: handle answer from viewer
  async handleAnswer(viewerId, answer) {
    const pc = this.peerConnections.get(viewerId);
    if (!pc) return;
    try {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
        console.log('[WebRTC] Answer set for', viewerId);
      }
    } catch(e) {
      console.error('[WebRTC] Answer error:', e);
    }
  }

  // HOST: ICE from viewer
  async handleIceFromViewer(viewerId, candidate) {
    const pc = this.peerConnections.get(viewerId);
    if (!pc) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) {}
  }

  // VIEWER: handle offer from host
  async handleOffer(hostId, offer) {
    console.log('[WebRTC Viewer] Got offer from host');
    const existing = this.peerConnections.get(hostId);
    if (existing) { existing.close(); }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections.set(hostId, pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit('webrtc-ice', { to: hostId, candidate: e.candidate });
      }
    };

    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC Viewer] ICE state:', pc.iceConnectionState);
    };

    pc.ontrack = (e) => {
      console.log('[WebRTC Viewer] Got track:', e.track.kind);
      if (e.streams && e.streams[0]) {
        if (this.onRemoteStream) this.onRemoteStream(e.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      console.log('[WebRTC Viewer] Connection:', pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        if (this.onStreamEnded) this.onStreamEnded();
      }
    };

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      this.socket.emit('webrtc-answer', { to: hostId, answer });
      console.log('[WebRTC Viewer] Answer sent');
    } catch(e) {
      console.error('[WebRTC Viewer] Error:', e);
    }
  }

  // VIEWER: ICE from host
  async handleIceFromHost(hostId, candidate) {
    const pc = this.peerConnections.get(hostId);
    if (!pc) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) {}
  }

  // HOST: rebuild combined stream from screen + cam
  buildLocalStream() {
    const tracks = [];
    if (this.screenStream) {
      this.screenStream.getVideoTracks().forEach(t => tracks.push(t));
      this.screenStream.getAudioTracks().forEach(t => tracks.push(t));
    }
    if (this.camStream) {
      if (!this.screenStream) {
        this.camStream.getVideoTracks().forEach(t => tracks.push(t));
      }
      this.camStream.getAudioTracks().forEach(t => tracks.push(t));
    }
    this.localStream = tracks.length > 0 ? new MediaStream(tracks) : null;
    console.log('[WebRTC] Local stream tracks:', tracks.map(t => t.kind));
  }

  // HOST: push updated tracks to all viewers
  async updateAllViewers() {
    if (!this.localStream) return;
    for (const [viewerId, pc] of this.peerConnections.entries()) {
      try {
        const senders = pc.getSenders();
        const tracks = this.localStream.getTracks();

        for (const track of tracks) {
          const sender = senders.find(s => s.track && s.track.kind === track.kind);
          if (sender) {
            await sender.replaceTrack(track);
          } else {
            pc.addTrack(track, this.localStream);
            // renegotiate
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            this.socket.emit('webrtc-offer', { to: viewerId, offer });
          }
        }
      } catch(e) {
        console.error('[WebRTC] Update error for', viewerId, e);
      }
    }
  }

  // HOST: send stream to ALL current viewers (call after going live)
  async sendToAllViewers(viewerIds) {
    for (const id of viewerIds) {
      await this.createOfferForViewer(id);
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
