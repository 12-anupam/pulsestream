// WebRTC Manager for PulseStream
// Handles peer connections between host and multiple viewers

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ]
};

class WebRTCManager {
  constructor(socket) {
    this.socket = socket;
    this.role = null;
    this.peerConnections = new Map(); // viewerId -> RTCPeerConnection
    this.localStream = null; // combined stream sent to viewers
    this.screenStream = null;
    this.camStream = null;
    this.onRemoteStream = null; // callback for viewers
    this.onStreamEnded = null;
  }

  setRole(role) {
    this.role = role;
  }

  // HOST: called when a new viewer joins while streaming
  async createOfferForViewer(viewerId) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections.set(viewerId, pc);

    // Add all local tracks to this peer
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit('webrtc-ice', { to: viewerId, candidate: e.candidate });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        this.peerConnections.delete(viewerId);
      }
    };

    const offer = await pc.createOffer({ offerToReceiveVideo: false, offerToReceiveAudio: false });
    await pc.setLocalDescription(offer);
    this.socket.emit('webrtc-offer', { to: viewerId, offer });
    return pc;
  }

  // HOST: handle answer from viewer
  async handleAnswer(viewerId, answer) {
    const pc = this.peerConnections.get(viewerId);
    if (!pc) return;
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }

  // HOST: handle ICE from viewer
  async handleIceFromViewer(viewerId, candidate) {
    const pc = this.peerConnections.get(viewerId);
    if (!pc) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) {}
  }

  // VIEWER: handle offer from host, create answer
  async handleOffer(hostId, offer) {
    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peerConnections.set(hostId, pc);

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        this.socket.emit('webrtc-ice', { to: hostId, candidate: e.candidate });
      }
    };

    pc.ontrack = (e) => {
      if (this.onRemoteStream && e.streams[0]) {
        this.onRemoteStream(e.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        if (this.onStreamEnded) this.onStreamEnded();
      }
    };

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.socket.emit('webrtc-answer', { to: hostId, answer });
  }

  // VIEWER: handle ICE from host
  async handleIceFromHost(hostId, candidate) {
    const pc = this.peerConnections.get(hostId);
    if (!pc) return;
    try { await pc.addIceCandidate(new RTCIceCandidate(candidate)); } catch(e) {}
  }

  // HOST: update stream (when screen share / cam changes)
  async updateStreamForAllViewers() {
    if (!this.localStream) return;
    for (const [viewerId, pc] of this.peerConnections.entries()) {
      const senders = pc.getSenders();
      const tracks = this.localStream.getTracks();
      for (const sender of senders) {
        const newTrack = tracks.find(t => t.kind === sender.track?.kind);
        if (newTrack) {
          try { await sender.replaceTrack(newTrack); } catch(e) {}
        }
      }
      // If new tracks added
      for (const track of tracks) {
        const hasSender = senders.find(s => s.track?.kind === track.kind);
        if (!hasSender) {
          pc.addTrack(track, this.localStream);
          // renegotiate
          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          this.socket.emit('webrtc-offer', { to: viewerId, offer });
        }
      }
    }
  }

  // HOST: build combined stream from screen + mic + optional cam audio
  buildLocalStream() {
    const tracks = [];
    if (this.screenStream) {
      this.screenStream.getVideoTracks().forEach(t => tracks.push(t));
      this.screenStream.getAudioTracks().forEach(t => tracks.push(t));
    }
    if (this.camStream) {
      this.camStream.getAudioTracks().forEach(t => tracks.push(t));
      // if no screen, add cam video
      if (!this.screenStream) {
        this.camStream.getVideoTracks().forEach(t => tracks.push(t));
      }
    }
    this.localStream = tracks.length > 0 ? new MediaStream(tracks) : null;
  }

  // HOST: stop all peer connections
  stopAll() {
    for (const pc of this.peerConnections.values()) {
      pc.close();
    }
    this.peerConnections.clear();
    if (this.screenStream) { this.screenStream.getTracks().forEach(t => t.stop()); this.screenStream = null; }
    if (this.camStream) { this.camStream.getTracks().forEach(t => t.stop()); this.camStream = null; }
    this.localStream = null;
  }

  // Remove one viewer's connection
  removeViewer(viewerId) {
    const pc = this.peerConnections.get(viewerId);
    if (pc) { pc.close(); this.peerConnections.delete(viewerId); }
  }
}
