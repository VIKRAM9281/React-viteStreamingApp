// HostView.jsx
import React, { useEffect, useRef } from 'react';
import io from 'socket.io-client';

const socket = io('https://streamingbacknedforwebapp.onrender.com');

const config = {
  iceServers: [
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
      urls: 'turn:in.relay.metered.ca:80',
      username: '92b58ddc6becca9a7458fe50',
      credential: 'f0VH3WmLtV6ZANec',
    },
  ],
};

export default function HostView({ roomId }) {
  const localRef = useRef();
  const peerConnections = useRef({});

  useEffect(() => {
    socket.emit('join-room', { roomId, role: 'host' });

    navigator.mediaDevices.getUserMedia({ video: true, audio: true }).then((stream) => {
      localRef.current.srcObject = stream;

      socket.on('stream-request', async ({ id }) => {
        const approve = window.confirm(`Approve stream for ${id}?`);
        if (approve) {
          socket.emit('approve-stream', { roomId, toUserId: id });

          const pc = new RTCPeerConnection(config);
          stream.getTracks().forEach((track) => pc.addTrack(track, stream));

          pc.onicecandidate = (e) => {
            if (e.candidate) {
              socket.emit('signal', { roomId, to: id, from: socket.id, data: { candidate: e.candidate } });
            }
          };

          pc.ontrack = (e) => {
            document.getElementById(`remote-${id}`).srcObject = e.streams[0];
          };

          const offer = await pc.createOffer();
          await pc.setLocalDescription(offer);
          socket.emit('signal', { roomId, to: id, from: socket.id, data: { sdp: offer } });

          peerConnections.current[id] = pc;
        }
      });

      socket.on('signal', async ({ from, data }) => {
        let pc = peerConnections.current[from];
        if (!pc) {
          pc = new RTCPeerConnection(config);

          pc.ontrack = (e) => {
            document.getElementById(`remote-${from}`).srcObject = e.streams[0];
          };

          pc.onicecandidate = (e) => {
            if (e.candidate) {
              socket.emit('signal', { roomId, to: from, from: socket.id, data: { candidate: e.candidate } });
            }
          };

          stream.getTracks().forEach((track) => pc.addTrack(track, stream));
          peerConnections.current[from] = pc;
        }

        const desc = new RTCSessionDescription(data.sdp);

        if (data.sdp) {
          const desc = new RTCSessionDescription(data.sdp);
          console.log('Received SDP:', desc.type, 'Current state:', pc.signalingState);
        
          if (desc.type === 'offer') {
            if (pc.signalingState !== 'stable') {
              console.warn('Cannot handle offer in current state:', pc.signalingState);
              return;
            }
            await pc.setRemoteDescription(desc);
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            socket.emit('signal', {
              roomId,
              to: from,
              from: socket.id,
              data: { sdp: answer },
            });
          } else if (
            desc.type === 'answer' &&
            pc.signalingState === 'have-local-offer'
          ) {
            await pc.setRemoteDescription(desc);
          } else {
            console.warn('Skipping unexpected SDP or invalid state:', desc.type, pc.signalingState);
          }
        }
        
      });
    });
  }, [roomId]);

  return (
    <div>
      <h2>Host View</h2>
      <video ref={localRef} autoPlay muted playsInline style={{ width: '400px' }} />
      <div id="remotes"></div>
    </div>
  );
}