import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/firebase/firebase';

export interface RoomParticipant {
  uid: string;
  displayName: string;
  photoURL: string | null;
  role: 'host' | 'co-host' | 'participant' | 'viewer';
  isMuted: boolean;
  isVideoOff: boolean;
  audioLocked: boolean;
  videoLocked: boolean;
  isScreenSharing: boolean;
  connectionState: RTCPeerConnectionState;
  stream: MediaStream | null;
}

interface UseWebRTCRoomOptions {
  reunionId: string;
  roomId: string;
  uid: string;
  displayName: string;
  photoURL?: string | null;
  role: 'host' | 'co-host' | 'participant' | 'viewer';
  isModerator: boolean;
  isViewer: boolean;
  mediaPermissions: {
    participantsCanSpeak: boolean;
    participantsCanUseCamera: boolean;
    participantsCanShareScreen: boolean;
  };
}

const getPeerSender = (peer: RTCPeerConnection, kind: 'audio' | 'video') =>
  peer.getTransceivers().find((transceiver) => transceiver.receiver.track.kind === kind)?.sender;

const logRtcDiagnostics = (event: string, details: Record<string, unknown>) => {
  if (!import.meta.env.DEV || typeof window === 'undefined'
    || new URLSearchParams(window.location.search).get('webrtcDiagnostics') !== '1') return;
  console.info(`[WebRTC diagnostics] ${event}`, details);
};

const rtcConfiguration: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

export const useWebRTCRoom = ({ reunionId, roomId, uid, displayName, photoURL, role, isModerator, isViewer, mediaPermissions }: UseWebRTCRoomOptions) => {
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [isMuted, setIsMuted] = useState(false);
  const [isVideoOff, setIsVideoOff] = useState(false);
  const [audioLocked, setAudioLocked] = useState(false);
  const [videoLocked, setVideoLocked] = useState(false);
  const [isSharing, setIsSharing] = useState(false);
  const [isJoined, setIsJoined] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [roomEnded, setRoomEnded] = useState(false);
  const peerConnections = useRef(new Map<string, RTCPeerConnection>());
  const peerStatsIntervals = useRef(new Map<string, number>());
  const peerUnsubscribers = useRef(new Map<string, Array<() => void>>());
  const connectionRefs = useRef(new Map<string, ReturnType<typeof doc>>());
  const remoteStreams = useRef(new Map<string, MediaStream>());
  const presenceUnsubscribe = useRef<(() => void) | null>(null);
  const roomUnsubscribe = useRef<(() => void) | null>(null);
  const memberUnsubscribe = useRef<(() => void) | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const sessionId = useRef(`${Date.now()}_${Math.random().toString(36).slice(2)}`);
  const active = useRef(false);
  const joinedSession = useRef(false);

  const participantRef = useCallback((participantUid: string) =>
    doc(db, 'reunions', reunionId, 'participants', participantUid), [reunionId]);

  const closePeer = useCallback((peerUid: string) => {
    const statsInterval = peerStatsIntervals.current.get(peerUid);
    if (statsInterval !== undefined) window.clearInterval(statsInterval);
    peerStatsIntervals.current.delete(peerUid);
    peerUnsubscribers.current.get(peerUid)?.forEach((unsubscribe) => unsubscribe());
    peerUnsubscribers.current.delete(peerUid);
    peerConnections.current.get(peerUid)?.close();
    peerConnections.current.delete(peerUid);
    remoteStreams.current.delete(peerUid);
    const connectionRef = connectionRefs.current.get(peerUid);
    connectionRefs.current.delete(peerUid);
    if (connectionRef) void (async () => {
      for (const candidateCollection of ['offerCandidates', 'answerCandidates']) {
        const candidates = await getDocs(collection(connectionRef, candidateCollection));
        await Promise.all(candidates.docs.map((candidate) => deleteDoc(candidate.ref)));
      }
      await deleteDoc(connectionRef);
    })().catch((cleanupError) => console.warn('Unable to clear signaling documents', cleanupError));
    setParticipants((current) => current.filter((participant) => participant.uid !== peerUid));
  }, []);

  const leaveRoom = useCallback(async () => {
    const shouldCheckEmptyRoom = joinedSession.current;
    joinedSession.current = false;
    active.current = false;
    presenceUnsubscribe.current?.();
    roomUnsubscribe.current?.();
    memberUnsubscribe.current?.();
    presenceUnsubscribe.current = null;
    roomUnsubscribe.current = null;
    memberUnsubscribe.current = null;
    peerConnections.current.forEach((connection) => connection.close());
    peerConnections.current.clear();
    peerStatsIntervals.current.forEach((interval) => window.clearInterval(interval));
    peerStatsIntervals.current.clear();
    remoteStreams.current.clear();
    connectionRefs.current.forEach((connectionRef) => {
      void (async () => {
        for (const candidateCollection of ['offerCandidates', 'answerCandidates']) {
          const candidates = await getDocs(collection(connectionRef, candidateCollection));
          await Promise.all(candidates.docs.map((candidate) => deleteDoc(candidate.ref)));
        }
        await deleteDoc(connectionRef);
      })().catch((cleanupError) => console.warn('Unable to clear signaling documents', cleanupError));
    });
    connectionRefs.current.clear();
    peerUnsubscribers.current.forEach((unsubscribers) => unsubscribers.forEach((unsubscribe) => unsubscribe()));
    peerUnsubscribers.current.clear();
    screenStreamRef.current?.getTracks().forEach((track) => track.stop());
    screenStreamRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setParticipants([]);
    setIsJoined(false);
    try {
      await deleteDoc(participantRef(uid));
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '');
      const currentUser = auth.currentUser;
      if (shouldCheckEmptyRoom && apiBaseUrl && currentUser) {
        void currentUser.getIdToken()
          .then((token) => fetch(`${apiBaseUrl}/api/reunions/finish-if-empty`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ reunionId }),
          }))
          .then((response) => {
            if (!response.ok && response.status !== 403) console.warn('Unable to check empty reunion status');
          })
          .catch((leaveError) => console.warn('Unable to check empty reunion status', leaveError));
      }
    } catch (leaveError) {
      console.warn('Unable to remove room presence', leaveError);
    }
  }, [participantRef, reunionId, uid]);

  const endRoomForAll = useCallback(async () => {
    const roomRef = doc(db, 'reunions', reunionId);
    const roomSnap = await getDoc(roomRef);
    const data = roomSnap.data();
    if (!roomSnap.exists() || data?.creatorId !== uid) {
      throw new Error('Seul le créateur peut terminer cette réunion pour tous.');
    }
    await updateDoc(roomRef, { status: 'completed', endedAt: serverTimestamp() });
  }, [reunionId, uid]);

  useEffect(() => {
    if (!reunionId || !roomId || !uid) {
      setError('Connexion requise pour rejoindre cette réunion.');
      setIsLoading(false);
      return;
    }

    let disposed = false;
    active.current = true;

    const startRoom = async () => {
      try {
        const roomRef = doc(db, 'reunions', reunionId);
        const roomSnap = await getDoc(roomRef);
        if (!roomSnap.exists()) throw new Error('Cette réunion est introuvable.');
        const roomData = roomSnap.data();
        if (roomData.roomId !== roomId) throw new Error('Le lien de cette réunion est invalide.');
        const expiration = roomData.expiresAt?.toDate?.().getTime?.() ?? null;
        if (roomData.status === 'completed' || roomData.status === 'closed' || (expiration && Date.now() >= expiration)) {
          throw new Error('Cette réunion est terminée ou son lien a expiré.');
        }

        const peersRef = collection(db, 'reunions', reunionId, 'participants');
        const peersSnap = await getDoc(participantRef(uid));
        const allPeers = await getDocs(peersRef);
        if (!peersSnap.exists() && allPeers.size >= Math.min(Number(roomData.maxParticipants) || 6, 6)) {
          throw new Error('Cette réunion a atteint sa limite de six participants.');
        }

        const audioAllowed = !isViewer && role !== 'viewer' && (isModerator || mediaPermissions.participantsCanSpeak);
        const videoAllowed = !isViewer && role !== 'viewer' && (isModerator || mediaPermissions.participantsCanUseCamera);
        let stream = new MediaStream();
        if (audioAllowed || videoAllowed) {
          try {
            stream = await navigator.mediaDevices.getUserMedia({ audio: audioAllowed, video: videoAllowed });
            logRtcDiagnostics('initial-media-capture', {
              localRole: role,
              audioTrackCount: stream.getAudioTracks().length,
              videoTracks: stream.getVideoTracks().map((track) => ({
                readyState: track.readyState,
                enabled: track.enabled,
              })),
            });
          } catch (mediaError) {
            logRtcDiagnostics('initial-media-capture-error', {
              localRole: role,
              error: mediaError instanceof Error ? mediaError.message : String(mediaError),
            });
            if (audioAllowed && videoAllowed) {
              try {
                stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
              } catch {
                stream = new MediaStream();
              }
            }
          }
        }
        const nextAudioLocked = !isModerator && (!mediaPermissions.participantsCanSpeak || Boolean(peersSnap.data()?.audioLocked));
        const nextVideoLocked = !isModerator && (!mediaPermissions.participantsCanUseCamera || Boolean(peersSnap.data()?.videoLocked));
        setAudioLocked(nextAudioLocked);
        setVideoLocked(nextVideoLocked);
        stream.getAudioTracks().forEach((track) => { track.enabled = !nextAudioLocked; });
        stream.getVideoTracks().forEach((track) => { track.enabled = !nextVideoLocked; });
        if (disposed || !active.current) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }

        localStreamRef.current = stream;
        setLocalStream(stream);
        setIsMuted(!stream.getAudioTracks().some((track) => track.enabled));
        setIsVideoOff(!stream.getVideoTracks().some((track) => track.enabled));
        const localParticipant = participantRef(uid);
        await setDoc(localParticipant, {
          uid,
          displayName,
          photoURL: photoURL || null,
          role,
          isMuted: nextAudioLocked || !stream.getAudioTracks().some((track) => track.enabled),
          isVideoOff: nextVideoLocked || !stream.getVideoTracks().some((track) => track.enabled),
          audioLocked: nextAudioLocked,
          videoLocked: nextVideoLocked,
          isScreenSharing: false,
          kicked: false,
          sessionId: sessionId.current,
          joinedAt: serverTimestamp(),
        });
        joinedSession.current = true;

        const startPeer = async (remote: Record<string, unknown> & { uid: string }) => {
          if (!active.current || remote.uid === uid || peerConnections.current.has(remote.uid) || !remote.sessionId) return;
          setParticipants((current) => current.some((participant) => participant.uid === remote.uid) ? current : [...current, {
            uid: remote.uid,
            displayName: String(remote.displayName || 'Participant'),
            photoURL: typeof remote.photoURL === 'string' ? remote.photoURL : null,
            role: remote.role === 'host' || remote.role === 'co-host' ? remote.role : 'participant',
            isMuted: Boolean(remote.isMuted),
            isVideoOff: Boolean(remote.isVideoOff),
            audioLocked: Boolean(remote.audioLocked),
            videoLocked: Boolean(remote.videoLocked),
            isScreenSharing: Boolean(remote.isScreenSharing),
            connectionState: 'connecting',
            stream: remoteStreams.current.get(remote.uid) || null,
          }]);
          const pairId = [uid, remote.uid].sort().map(encodeURIComponent).join('__');
          const connectionRef = doc(db, 'reunions', reunionId, 'connections', pairId);
          connectionRefs.current.set(remote.uid, connectionRef);
          const offerer = uid.localeCompare(remote.uid) < 0;
          const connection = new RTCPeerConnection(rtcConfiguration);
          let currentGeneration = '';
          let remoteCandidateUnsubscribe: (() => void) | undefined;
          let remoteDescriptionReady = false;
          const pendingRemoteCandidates: RTCIceCandidateInit[] = [];
          const addRemoteCandidate = (candidate: RTCIceCandidateInit) => {
            if (!remoteDescriptionReady) {
              pendingRemoteCandidates.push(candidate);
              return;
            }
            void connection.addIceCandidate(new RTCIceCandidate(candidate)).catch((candidateError) => {
              logRtcDiagnostics('candidate-apply-error', {
                localRole: role,
                remoteRole: remote.role,
                error: candidateError instanceof Error ? candidateError.message : String(candidateError),
              });
              console.warn('Unable to apply remote ICE candidate', candidateError);
            });
          };
          const flushRemoteCandidates = async () => {
            remoteDescriptionReady = true;
            for (const candidate of pendingRemoteCandidates.splice(0)) {
              await connection.addIceCandidate(new RTCIceCandidate(candidate)).catch((candidateError) => {
                logRtcDiagnostics('candidate-apply-error', {
                  localRole: role,
                  remoteRole: remote.role,
                  error: candidateError instanceof Error ? candidateError.message : String(candidateError),
                });
                console.warn('Unable to apply queued remote ICE candidate', candidateError);
              });
            }
          };

          peerConnections.current.set(remote.uid, connection);
          connection.onconnectionstatechange = () => {
            logRtcDiagnostics('connection-state', {
              localRole: role,
              remoteRole: remote.role,
              connectionState: connection.connectionState,
              iceConnectionState: connection.iceConnectionState,
              signalingState: connection.signalingState,
            });
            setParticipants((current) => current.map((participant) => participant.uid === remote.uid
              ? { ...participant, connectionState: connection.connectionState }
              : participant));
          };
          const audioSender = connection.addTransceiver('audio', { direction: 'sendrecv', streams: [stream] }).sender;
          const videoSender = connection.addTransceiver('video', { direction: 'sendrecv', streams: [stream] }).sender;
          for (const track of stream.getTracks()) {
            const sender = track.kind === 'audio' ? audioSender : videoSender;
            await sender.replaceTrack(track);
          }
          const activeScreenTrack = screenStreamRef.current?.getVideoTracks()[0];
          if (activeScreenTrack) await videoSender.replaceTrack(activeScreenTrack);
          const reportPeerStats = async () => {
            try {
              const stats = await connection.getStats();
              const videoRtpReports = [...stats.values()]
                .filter((stat) => stat.type === 'outbound-rtp' || stat.type === 'inbound-rtp')
                .map((stat) => {
                  const report = stat as RTCOutboundRtpStreamStats & RTCInboundRtpStreamStats & { mediaType?: string };
                  return {
                    type: stat.type,
                    kind: report.kind || report.mediaType || null,
                    bytesSent: report.bytesSent,
                    framesEncoded: report.framesEncoded,
                    bytesReceived: report.bytesReceived,
                    framesDecoded: report.framesDecoded,
                  };
                });
              const outboundVideo = [...stats.values()]
                .filter((stat) => stat.type === 'outbound-rtp' && ((stat as RTCOutboundRtpStreamStats).kind === 'video'
                  || (stat as RTCOutboundRtpStreamStats & { mediaType?: string }).mediaType === 'video'))
                .map((stat) => {
                  const report = stat as RTCOutboundRtpStreamStats;
                  return { bytesSent: report.bytesSent, framesEncoded: report.framesEncoded };
                });
              const inboundVideo = [...stats.values()]
                .filter((stat) => stat.type === 'inbound-rtp' && ((stat as RTCInboundRtpStreamStats).kind === 'video'
                  || (stat as RTCInboundRtpStreamStats & { mediaType?: string }).mediaType === 'video'))
                .map((stat) => {
                  const report = stat as RTCInboundRtpStreamStats;
                  return { bytesReceived: report.bytesReceived, framesDecoded: report.framesDecoded };
                });
              const cameraTrack = localStreamRef.current?.getVideoTracks()[0] || null;
              logRtcDiagnostics('peer-stats', {
                localRole: role,
                remoteRole: remote.role,
                connectionState: connection.connectionState,
                iceConnectionState: connection.iceConnectionState,
                cameraTrack: cameraTrack ? { readyState: cameraTrack.readyState, enabled: cameraTrack.enabled } : null,
                senderTrack: videoSender.track
                  ? { readyState: videoSender.track.readyState, enabled: videoSender.track.enabled }
                  : null,
                videoRtpReports,
                outboundVideo,
                inboundVideo,
                receivedVideoTracks: remoteStreams.current.get(remote.uid)?.getVideoTracks().map((track) => ({
                  readyState: track.readyState,
                  enabled: track.enabled,
                })) || [],
              });
            } catch (statsError) {
              logRtcDiagnostics('stats-error', {
                localRole: role,
                remoteRole: remote.role,
                error: statsError instanceof Error ? statsError.message : String(statsError),
              });
            }
          };
          void reportPeerStats();
          peerStatsIntervals.current.set(remote.uid, window.setInterval(() => void reportPeerStats(), 5000));
          connection.ontrack = (event) => {
            const remoteStream = event.streams[0] || remoteStreams.current.get(remote.uid) || new MediaStream();
            if (!remoteStream.getTracks().some((track) => track.id === event.track.id)) remoteStream.addTrack(event.track);
            remoteStreams.current.set(remote.uid, remoteStream);
            logRtcDiagnostics('ontrack', {
              localRole: role,
              remoteRole: remote.role,
              kind: event.track.kind,
              readyState: event.track.readyState,
              enabled: event.track.enabled,
              eventStreamCount: event.streams.length,
              streamVideoTracks: remoteStream.getVideoTracks().map((track) => ({
                readyState: track.readyState,
                enabled: track.enabled,
              })),
            });
            setParticipants((current) => {
              const existing = current.find((participant) => participant.uid === remote.uid);
              const details: RoomParticipant = existing
                ? { ...existing, connectionState: connection.connectionState, stream: remoteStream }
                : {
                    uid: remote.uid,
                    displayName: String(remote.displayName || 'Participant'),
                    photoURL: typeof remote.photoURL === 'string' ? remote.photoURL : null,
                    role: remote.role === 'host' || remote.role === 'co-host' ? remote.role : 'participant',
                    isMuted: Boolean(remote.isMuted),
                    isVideoOff: Boolean(remote.isVideoOff),
                    audioLocked: Boolean(remote.audioLocked),
                    videoLocked: Boolean(remote.videoLocked),
                    isScreenSharing: Boolean(remote.isScreenSharing),
                    connectionState: connection.connectionState,
                    stream: remoteStream,
                  };
              return existing ? current.map((participant) => participant.uid === remote.uid ? details : participant) : [...current, details];
            });
          };

          const watchRemoteCandidates = (candidateCollection: 'offerCandidates' | 'answerCandidates', generationId: string) => {
            remoteCandidateUnsubscribe?.();
            const candidatesQuery = query(
              collection(connectionRef, candidateCollection),
              where('generationId', '==', generationId),
            );
            remoteCandidateUnsubscribe = onSnapshot(candidatesQuery, (snapshot) => {
              snapshot.docChanges().forEach((change) => {
                if (change.type === 'added') {
                  addRemoteCandidate(change.doc.data().candidate as RTCIceCandidateInit);
                }
              });
            }, (snapshotError) => logRtcDiagnostics('candidate-listener-error', {
              localRole: role,
              remoteRole: remote.role,
              error: snapshotError.message,
            }));
          };

          if (offerer) {
            connection.onicecandidate = ({ candidate }) => {
              if (candidate && currentGeneration) {
                void addDoc(collection(connectionRef, 'offerCandidates'), {
                  candidate: candidate.toJSON(),
                  generationId: currentGeneration,
                  from: uid,
                }).catch((writeError) => logRtcDiagnostics('candidate-write-error', {
                  localRole: role,
                  remoteRole: remote.role,
                  error: writeError instanceof Error ? writeError.message : String(writeError),
                }));
              }
            };
            const unsubscribe = onSnapshot(connectionRef, async (snapshot) => {
              const data = snapshot.data();
              if (!data || data.offererSessionId !== sessionId.current || data.answererSessionId !== remote.sessionId) return;
              const generationId = String(data.generationId || '');
              if (generationId && generationId !== currentGeneration) {
                currentGeneration = generationId;
                watchRemoteCandidates('answerCandidates', generationId);
              }
              if (data.answer && !connection.remoteDescription) {
                await connection.setRemoteDescription(new RTCSessionDescription(data.answer as RTCSessionDescriptionInit));
                await flushRemoteCandidates();
              }
            }, (snapshotError) => logRtcDiagnostics('signaling-listener-error', {
              localRole: role,
              remoteRole: remote.role,
              error: snapshotError.message,
            }));
            peerUnsubscribers.current.set(remote.uid, [unsubscribe, () => remoteCandidateUnsubscribe?.()]);
            void (async () => {
              try {
                currentGeneration = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
                const offer = await connection.createOffer();
                await connection.setLocalDescription(offer);
                await setDoc(connectionRef, {
                  offer: { type: offer.type, sdp: offer.sdp },
                  offererId: uid,
                  answererId: remote.uid,
                  offererSessionId: sessionId.current,
                  answererSessionId: remote.sessionId,
                  generationId: currentGeneration,
                  updatedAt: serverTimestamp(),
                });
                watchRemoteCandidates('answerCandidates', currentGeneration);
              } catch (connectionError) {
                logRtcDiagnostics('offer-creation-error', {
                  localRole: role,
                  remoteRole: remote.role,
                  error: connectionError instanceof Error ? connectionError.message : String(connectionError),
                });
                console.warn('Unable to create WebRTC offer', connectionError);
              }
            })();
            return;
          }

          connection.onicecandidate = ({ candidate }) => {
            if (candidate && currentGeneration) {
              void addDoc(collection(connectionRef, 'answerCandidates'), {
                candidate: candidate.toJSON(),
                generationId: currentGeneration,
                from: uid,
              }).catch((writeError) => logRtcDiagnostics('candidate-write-error', {
                localRole: role,
                remoteRole: remote.role,
                error: writeError instanceof Error ? writeError.message : String(writeError),
              }));
            }
          };
          const unsubscribe = onSnapshot(connectionRef, async (snapshot) => {
            const data = snapshot.data();
            if (!data?.offer || data.offererSessionId !== remote.sessionId || data.answererSessionId !== sessionId.current) return;
            const generationId = String(data.generationId || '');
            if (!generationId || generationId === currentGeneration) return;
            currentGeneration = generationId;
            try {
              await connection.setRemoteDescription(new RTCSessionDescription(data.offer as RTCSessionDescriptionInit));
              await flushRemoteCandidates();
              watchRemoteCandidates('offerCandidates', generationId);
              const answer = await connection.createAnswer();
              await connection.setLocalDescription(answer);
              await updateDoc(connectionRef, { answer: { type: answer.type, sdp: answer.sdp }, answeredAt: serverTimestamp() });
            } catch (connectionError) {
              logRtcDiagnostics('answer-creation-error', {
                localRole: role,
                remoteRole: remote.role,
                error: connectionError instanceof Error ? connectionError.message : String(connectionError),
              });
              console.warn('Unable to answer WebRTC offer', connectionError);
            }
          }, (snapshotError) => logRtcDiagnostics('signaling-listener-error', {
            localRole: role,
            remoteRole: remote.role,
            error: snapshotError.message,
          }));
          peerUnsubscribers.current.set(remote.uid, [unsubscribe, () => remoteCandidateUnsubscribe?.()]);
        };

        presenceUnsubscribe.current = onSnapshot(peersRef, (snapshot) => {
          const present = new Set(snapshot.docs.map((peer) => peer.id));
          snapshot.docs.forEach((peer) => {
            const data = peer.data();
            if (peer.id !== uid && peerConnections.current.has(peer.id)) {
              if (role === 'host' || data.role === 'host') {
                logRtcDiagnostics('presence', {
                  localRole: role,
                  participantRole: data.role,
                  isVideoOff: data.isVideoOff,
                  videoLocked: data.videoLocked,
                });
              }
              remoteStreams.current.get(peer.id)?.getAudioTracks().forEach((track) => { track.enabled = !data.audioLocked && !data.isMuted; });
              remoteStreams.current.get(peer.id)?.getVideoTracks().forEach((track) => { track.enabled = Boolean(data.isScreenSharing) || (!data.videoLocked && !data.isVideoOff); });
              setParticipants((current) => {
                const details: RoomParticipant = {
                  uid: peer.id,
                  displayName: String(data.displayName || 'Participant'),
                  photoURL: typeof data.photoURL === 'string' ? data.photoURL : null,
                  role: data.role === 'host' || data.role === 'co-host' ? data.role : 'participant',
                  isMuted: Boolean(data.isMuted),
                  isVideoOff: Boolean(data.isVideoOff),
                  audioLocked: Boolean(data.audioLocked),
                  videoLocked: Boolean(data.videoLocked),
                  isScreenSharing: Boolean(data.isScreenSharing),
                  connectionState: peerConnections.current.get(peer.id)?.connectionState || 'connecting',
                  stream: remoteStreams.current.get(peer.id) || null,
                };
                return current.some((participant) => participant.uid === peer.id)
                  ? current.map((participant) => participant.uid === peer.id ? details : participant)
                  : [...current, details];
              });
            } else if (peer.id !== uid) {
              void startPeer({ uid: peer.id, ...data }).catch(console.warn);
            }
          });
          peerConnections.current.forEach((_connection, peerUid) => {
            if (!present.has(peerUid)) closePeer(peerUid);
          });
        }, (snapshotError) => logRtcDiagnostics('presence-listener-error', {
          localRole: role,
          error: snapshotError.message,
        }));
        const memberRef = doc(db, 'reunions', reunionId, 'roomMembers', uid);
        memberUnsubscribe.current = onSnapshot(participantRef(uid), (snapshot) => {
          const data = snapshot.data();
          if (!data) return;
          if (role === 'host') {
            logRtcDiagnostics('presence', {
              localRole: role,
              participantRole: role,
              isVideoOff: data.isVideoOff,
              videoLocked: data.videoLocked,
            });
          }
          const nextAudioLocked = Boolean(data.audioLocked);
          const nextVideoLocked = Boolean(data.videoLocked);
          setAudioLocked(nextAudioLocked);
          setVideoLocked(nextVideoLocked);
          const nextMuted = Boolean(data.isMuted);
          const liveAudioTracks = localStreamRef.current?.getAudioTracks().filter((track) => track.readyState === 'live') || [];
          if (nextAudioLocked || nextMuted) {
            liveAudioTracks.forEach((track) => { track.enabled = false; });
            setIsMuted(true);
            void Promise.all([...peerConnections.current.values()].map((peer) => getPeerSender(peer, 'audio')?.replaceTrack(null)));
          } else if (liveAudioTracks.length) {
            const track = liveAudioTracks[0];
            liveAudioTracks.forEach((audioTrack) => { audioTrack.enabled = true; });
            setIsMuted(false);
            void Promise.all([...peerConnections.current.values()].map((peer) => getPeerSender(peer, 'audio')?.replaceTrack(track)));
          } else {
            setIsMuted(true);
            void updateDoc(participantRef(uid), { isMuted: true }).catch(console.warn);
          }
          const liveVideoTracks = localStreamRef.current?.getVideoTracks().filter((track) => track.readyState === 'live') || [];
          const nextVideoOff = nextVideoLocked || Boolean(data.isVideoOff);
          setIsVideoOff(nextVideoOff);
          liveVideoTracks.forEach((track) => { track.enabled = !nextVideoOff; });
          if (!screenStreamRef.current) {
            const cameraTrack = nextVideoOff ? null : liveVideoTracks[0] || null;
            void Promise.all([...peerConnections.current.values()].map((peer) => getPeerSender(peer, 'video')?.replaceTrack(cameraTrack)));
          }
        });
        const memberSnapshotUnsubscribe = onSnapshot(memberRef, (snapshot) => {
          if (snapshot.data()?.kicked === true) {
            setError('Vous avez été exclu de cette réunion.');
            void leaveRoom();
          }
        });
        const previousMemberUnsubscribe = memberUnsubscribe.current;
        memberUnsubscribe.current = () => {
          previousMemberUnsubscribe?.();
          memberSnapshotUnsubscribe();
        };
        roomUnsubscribe.current = onSnapshot(roomRef, (snapshot) => {
          const latest = snapshot.data();
          if (latest?.status === 'completed' || latest?.status === 'closed') {
            setRoomEnded(true);
            void leaveRoom();
          }
        });
        setIsJoined(true);
      } catch (joinError) {
        if (!disposed) setError(joinError instanceof Error ? joinError.message : 'Impossible de rejoindre cette réunion.');
      } finally {
        if (!disposed) setIsLoading(false);
      }
    };

    void startRoom();
    return () => {
      disposed = true;
      void leaveRoom();
    };
  }, [closePeer, displayName, isModerator, isViewer, leaveRoom, mediaPermissions.participantsCanShareScreen, mediaPermissions.participantsCanSpeak, mediaPermissions.participantsCanUseCamera, participantRef, photoURL, reunionId, role, roomId, uid]);

  const toggleMicrophone = useCallback(async () => {
    if (audioLocked) return;
    let track = localStreamRef.current?.getAudioTracks().find((candidate) => candidate.readyState === 'live');
    let nextMuted = !isMuted;
    if (!track) {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      track = media.getAudioTracks()[0];
      nextMuted = false;
      const stream = localStreamRef.current || new MediaStream();
      stream.addTrack(track);
      localStreamRef.current = stream;
      setLocalStream(new MediaStream(stream.getTracks()));
      await Promise.all([...peerConnections.current.values()].map((peer) => getPeerSender(peer, 'audio')?.replaceTrack(track)));
    }
    track.enabled = !nextMuted;
    setIsMuted(nextMuted);
    await Promise.all([...peerConnections.current.values()].map((peer) => getPeerSender(peer, 'audio')?.replaceTrack(nextMuted ? null : track)));
    await updateDoc(participantRef(uid), { isMuted: nextMuted });
  }, [audioLocked, isMuted, participantRef, uid]);

  const toggleCamera = useCallback(async () => {
    if (videoLocked) return;
    let track = localStreamRef.current?.getVideoTracks().find((candidate) => candidate.readyState === 'live');
    logRtcDiagnostics('camera-toggle', {
      localRole: role,
      isVideoOff,
      videoLocked,
      cameraTrack: track ? { readyState: track.readyState, enabled: track.enabled } : null,
    });
    if (!track) {
      let media: MediaStream;
      try {
        media = await navigator.mediaDevices.getUserMedia({ audio: false, video: true });
      } catch (cameraError) {
        logRtcDiagnostics('camera-acquisition-error', {
          localRole: role,
          error: cameraError instanceof Error ? cameraError.message : String(cameraError),
        });
        throw cameraError;
      }
      track = media.getVideoTracks()[0];
      if (!track) throw new Error('La capture vidéo n’a retourné aucune piste caméra.');
      const stream = localStreamRef.current || new MediaStream();
      stream.getVideoTracks().filter((candidate) => candidate.readyState !== 'live').forEach((candidate) => stream.removeTrack(candidate));
      stream.addTrack(track);
      localStreamRef.current = stream;
      setLocalStream(screenStreamRef.current || new MediaStream(stream.getTracks()));
      setIsVideoOff(false);
      if (!screenStreamRef.current) {
        try {
          await Promise.all([...peerConnections.current.values()].map((peer) => getPeerSender(peer, 'video')?.replaceTrack(track)));
        } catch (senderError) {
          logRtcDiagnostics('camera-sender-error', {
            localRole: role,
            error: senderError instanceof Error ? senderError.message : String(senderError),
          });
          throw senderError;
        }
      }
      try {
        await updateDoc(participantRef(uid), { isVideoOff: false });
      } catch (presenceError) {
        logRtcDiagnostics('camera-presence-write-error', {
          localRole: role,
          error: presenceError instanceof Error ? presenceError.message : String(presenceError),
        });
        throw presenceError;
      }
      logRtcDiagnostics('camera-reactivated', {
        localRole: role,
        cameraTrack: { readyState: track.readyState, enabled: track.enabled },
        senderTracks: [...peerConnections.current.values()].map((peer) => {
          const senderTrack = getPeerSender(peer, 'video')?.track;
          return senderTrack ? { readyState: senderTrack.readyState, enabled: senderTrack.enabled } : null;
        }),
      });
      return;
    }
    const nextVideoOff = !isVideoOff;
    track.enabled = !nextVideoOff;
    setIsVideoOff(nextVideoOff);
    if (!screenStreamRef.current) {
      try {
        await Promise.all([...peerConnections.current.values()].map((peer) => getPeerSender(peer, 'video')?.replaceTrack(nextVideoOff ? null : track)));
      } catch (senderError) {
        logRtcDiagnostics('camera-sender-error', {
          localRole: role,
          error: senderError instanceof Error ? senderError.message : String(senderError),
        });
        throw senderError;
      }
    }
    try {
      await updateDoc(participantRef(uid), { isVideoOff: nextVideoOff });
    } catch (presenceError) {
      logRtcDiagnostics('camera-presence-write-error', {
        localRole: role,
        error: presenceError instanceof Error ? presenceError.message : String(presenceError),
      });
      throw presenceError;
    }
  }, [isVideoOff, participantRef, role, uid, videoLocked]);

  const toggleScreenShare = useCallback(async () => {
    if (isViewer || role === 'viewer' || (!isModerator && !mediaPermissions.participantsCanShareScreen)) return false;
    if (screenStreamRef.current) {
      const screenStream = screenStreamRef.current;
      screenStreamRef.current = null;
      const cameraTrack = localStreamRef.current?.getVideoTracks().find((track) => track.readyState === 'live') || null;
      await Promise.all([...peerConnections.current.values()].map((peer) =>
        getPeerSender(peer, 'video')?.replaceTrack(cameraTrack?.enabled && !videoLocked ? cameraTrack : null),
      ));
      screenStream.getTracks().forEach((track) => track.stop());
      setLocalStream(new MediaStream(localStreamRef.current?.getTracks() || []));
      setIsSharing(false);
      await updateDoc(participantRef(uid), { isScreenSharing: false });
      return false;
    }
    const screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const screenTrack = screenStream.getVideoTracks()[0];
    const cameraTrack = localStreamRef.current?.getVideoTracks().find((track) => track.readyState === 'live') || null;
    try {
      await Promise.all([...peerConnections.current.values()].map((peer) => {
        const sender = getPeerSender(peer, 'video') || peer.addTransceiver('video', { direction: 'sendrecv' }).sender;
        return sender.replaceTrack(screenTrack);
      }));
      screenStreamRef.current = screenStream;
      setLocalStream(screenStream);
      setIsSharing(true);
      await updateDoc(participantRef(uid), { isScreenSharing: true });
      screenTrack.onended = () => {
        if (screenStreamRef.current === screenStream) void toggleScreenShare();
      };
      return true;
    } catch (shareError) {
      screenStreamRef.current = null;
      setLocalStream(new MediaStream(localStreamRef.current?.getTracks() || []));
      setIsSharing(false);
      await Promise.all([...peerConnections.current.values()].map((peer) =>
        getPeerSender(peer, 'video')?.replaceTrack(cameraTrack?.enabled && !videoLocked ? cameraTrack : null),
      )).catch(console.warn);
      screenStream.getTracks().forEach((track) => track.stop());
      throw shareError;
    }
  }, [isModerator, isViewer, mediaPermissions.participantsCanShareScreen, participantRef, role, uid, videoLocked]);

  const moderateParticipant = useCallback(async (targetUid: string, action: 'mute' | 'unmute' | 'lock-microphone' | 'unlock-microphone' | 'lock-camera' | 'unlock-camera' | 'kick') => {
    if (!isModerator || isViewer || !['host', 'co-host'].includes(role) || targetUid === uid) return;
    const targetMemberRef = doc(db, 'reunions', reunionId, 'roomMembers', targetUid);
    const targetMember = await getDoc(targetMemberRef);
    const targetRole = targetMember.data()?.role;
    if (!targetMember.exists() || targetRole === 'host' || (targetRole === 'co-host' && role !== 'host')) return;

    const targetRef = participantRef(targetUid);
    if (action === 'kick') {
      await updateDoc(targetMemberRef, { kicked: true });
      await deleteDoc(participantRef(targetUid));
      return;
    }
    if (action === 'lock-microphone' || action === 'mute') {
      await updateDoc(targetRef, { audioLocked: true, isMuted: true });
      return;
    }
    if (action === 'unlock-microphone' || action === 'unmute') {
      await updateDoc(targetRef, { audioLocked: false, isMuted: false });
      return;
    }
    if (action === 'lock-camera') {
      await updateDoc(targetRef, { videoLocked: true, isVideoOff: true });
      return;
    }
    await updateDoc(targetRef, { videoLocked: false });
  }, [isModerator, isViewer, participantRef, reunionId, role, uid]);

  return {
    participants,
    localStream,
    isMuted,
    isVideoOff,
    isSharing,
    audioLocked,
    videoLocked,
    isJoined,
    isLoading,
    error,
    roomEnded,
    toggleMicrophone,
    toggleCamera,
    toggleScreenShare,
    moderateParticipant,
    leaveRoom,
    endRoomForAll,
  };
};
