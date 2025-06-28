import React, { useEffect, useRef, useState } from 'react';
import io from 'socket.io-client';
import './App.css';

const socket = io('https://streamingbacknedforwebapp.onrender.com', {
  transports: ['polling'],
  reconnectionAttempts: 5,
  timeout: 10000,
});

const MAX_USERS = 4;

function App() {
  const [rooms, setRooms] = useState([]);
  const [joinedRoom, setJoinedRoom] = useState(null);
  const [remoteStreams, setRemoteStreams] = useState([]);
  const [role, setRole] = useState(null);
  const localVideoRef = useRef(null);
  const peersRef = useRef({});
  const pendingCandidates = useRef({});
  const localStreamRef = useRef(null);

  useEffect(() => {
    socket.emit('getRooms');

    socket.on('roomsList', (rooms) => setRooms(rooms));

    socket.on('joined', ({ room, users }) => {
      setJoinedRoom(room);
      users.forEach(userId => {
        if (!peersRef.current[userId]) {
          const peer = createPeer(userId);
          peersRef.current[userId] = peer;
        }
      });
    });

    socket.on('role', async (assignedRole) => {
      setRole(assignedRole);
      if (assignedRole === 'host') {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        localStreamRef.current = stream;
        localVideoRef.current.srcObject = stream;
      }
    });

    socket.on('newUser', async (userId) => {
      if (!peersRef.current[userId]) {
        const peer = createPeer(userId);
        peersRef.current[userId] = peer;

        const offer = await peer.createOffer();
        await peer.setLocalDescription({ type: 'offer', sdp: preferVP8(offer.sdp) });
        socket.emit('signal', { to: userId, data: peer.localDescription });
      }
    });

    socket.on('signal', async ({ from, data }) => {
      let peer = peersRef.current[from];
      if (!peer) {
        peer = createPeer(from);
        peersRef.current[from] = peer;
      }
    
      if (data.type === 'offer') {
        await peer.setRemoteDescription(new RTCSessionDescription(data));
        const answer = await peer.createAnswer();
        await peer.setLocalDescription({ type: 'answer', sdp: preferVP8(answer.sdp) });
        socket.emit('signal', { to: from, data: peer.localDescription });
    
        (pendingCandidates.current[from] || []).forEach(c => peer.addIceCandidate(c));
        pendingCandidates.current[from] = [];
      } else if (data.type === 'answer') {
        if (!peer.currentRemoteDescriptionSet) {
          await peer.setRemoteDescription(new RTCSessionDescription(data));
          peer.currentRemoteDescriptionSet = true;
        } else {
          console.warn('🔁 Duplicate answer ignored');
        }
      } else if (data.candidate) {
        const candidate = new RTCIceCandidate(data.candidate);
        if (peer.remoteDescription?.type) {
          await peer.addIceCandidate(candidate);
        } else {
          (pendingCandidates.current[from] = pendingCandidates.current[from] || []).push(candidate);
        }
      }
    });
    

    socket.on('streamRequest', (requesterId) => {
      if (window.confirm(`Allow ${requesterId.slice(0, 4)} to stream?`)) {
        socket.emit('streamApproved', requesterId);
      }
    });

    socket.on('startStream', async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      localStreamRef.current = stream;
      localVideoRef.current.srcObject = stream;

      // Add stream to all existing peers
      Object.values(peersRef.current).forEach((peer) => {
        stream.getTracks().forEach((track) => {
          peer.addTrack(track, stream);
        });
      });

      // Re-negotiate
      Object.entries(peersRef.current).forEach(async ([id, peer]) => {
        if (peer.signalingState === 'stable') {
          const offer = await peer.createOffer();
          await peer.setLocalDescription(offer);
          socket.emit('signal', { to: id, data: peer.localDescription });
        }
      });
      
    });

    socket.on('userLeft', (socketId) => {
      if (peersRef.current[socketId]) {
        peersRef.current[socketId].close();
        delete peersRef.current[socketId];
        setRemoteStreams(prev => prev.filter(s => s.id !== socketId));
      }
    });
  }, []);

  const joinRoom = (roomName) => {
    setJoinedRoom(roomName);
    socket.emit('joinRoom', roomName);
  };

  const createPeer = (socketId) => {
    const peer = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: ['turn:coturn.streamalong.live:3478'],
          username: 'webrtcuser',
          credential: 'Test@1234'
        }
      ],
      iceTransportPolicy: 'all',
      sdpSemantics: 'unified-plan'
    });
  
    peer.currentRemoteDescriptionSet = false;
  
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track =>
        peer.addTrack(track, localStreamRef.current)
      );
    }
  
    peer.ontrack = (event) => {
      const stream = event.streams[0];
      if (!stream) return;
  
      setRemoteStreams(prev => {
        const exists = prev.some(s => s.id === socketId);
        if (exists) return prev;
        return [...prev, { id: socketId, stream }];
      });
    };
  
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('signal', { to: socketId, data: { candidate: event.candidate } });
      }
    };
  
    return peer;
  };  

  const preferVP8 = (sdp) => {
    const sdpLines = sdp.split('\r\n');
    const mLineIndex = sdpLines.findIndex(line => line.startsWith('m=video'));
    if (mLineIndex === -1) return sdp;

    const vp8Payloads = sdpLines
      .map(line => line.match(/^a=rtpmap:(\d+) VP8\/90000/i))
      .filter(Boolean)
      .map(match => match[1]);

    const parts = sdpLines[mLineIndex].split(' ');
    const header = parts.slice(0, 3);
    const payloads = parts.slice(3);
    const reordered = [
      ...vp8Payloads.filter(p => payloads.includes(p)),
      ...payloads.filter(p => !vp8Payloads.includes(p))
    ];

    sdpLines[mLineIndex] = [...header, ...reordered].join(' ');
    return sdpLines.join('\r\n');
  };

  return (
    <div className="App">
      {!joinedRoom ? (
        <div>
          <h2>Available Rooms</h2>
          {rooms.map(room => (
            <button key={room.name} onClick={() => joinRoom(room.name)} disabled={room.full}>
              {room.name} ({room.count}/{MAX_USERS})
            </button>
          ))}
        </div>
      ) : (
        <div>
          <h2>Room: {joinedRoom}</h2>
          {role && <h4>You are a {role}</h4>}
          <div className="grid">
            <div className="videoSlot">
              <video ref={localVideoRef} autoPlay muted playsInline />
              <div className="nameTag">You</div>
            </div>
            {remoteStreams.map(({ id, stream }) => (
              <div className="videoSlot" key={id}>
                <video
                  autoPlay
                  playsInline
                  ref={video => video && (video.srcObject = stream)}
                />
                <div className="nameTag">User {id.slice(0, 4)}</div>
              </div>
            ))}
          </div>
          {role === 'viewer' && !localStreamRef.current && (
            <button onClick={() => socket.emit('streamRequest')}>Request to Stream</button>
          )}
        </div>
      )}
    </div>
  );
}

export default App;
