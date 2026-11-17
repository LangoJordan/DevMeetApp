import { useEffect, useRef, useState } from 'react';
import {
  Camera, CameraOff, Check, Copy, Mic, MicOff,
  MonitorUp, PhoneOff, UserRound, Users, UserX,
} from 'lucide-react';
import { useWebRTCRoom, type RoomParticipant } from '@/hooks/useWebRTCRoom';
import { toast } from 'sonner';

interface VideoRoomProps {
  reunionId: string;
  roomId: string;
  uid: string;
  displayName: string;
  photoURL?: string | null;
  role: 'host' | 'co-host' | 'participant' | 'viewer';
  roomRole: 'host' | 'co-host' | 'participant';
  isHost: boolean;
  isModerator: boolean;
  canShareLink: boolean;
  mediaPermissions: {
    participantsCanSpeak: boolean;
    participantsCanUseCamera: boolean;
    participantsCanShareScreen: boolean;
  };
  onJoined: () => void;
  onLeave: () => void;
  onEndRoom: () => void;
}

interface VideoTileProps {
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
  isSelf?: boolean;
  uid: string;
  isModerator: boolean;
  canModerate: boolean;
  onModerate: (uid: string, action: 'lock-microphone' | 'unlock-microphone' | 'lock-camera' | 'unlock-camera' | 'kick') => void;
}

const VideoTile = ({ displayName, photoURL, role, isMuted, isVideoOff, audioLocked, videoLocked, isScreenSharing, connectionState, stream, isSelf = false, uid, isModerator, canModerate, onModerate }: VideoTileProps) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = Boolean((isScreenSharing || !isVideoOff) && stream?.getVideoTracks().some((track) => track.readyState === 'live' && track.enabled));

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    video.srcObject = stream;
    if (stream) void video.play().catch(() => undefined);
  }, [stream, hasVideo]);

  useEffect(() => {
    if (!import.meta.env.DEV || typeof window === 'undefined'
      || new URLSearchParams(window.location.search).get('webrtcDiagnostics') !== '1') return;
    console.info('[WebRTC diagnostics] video-tile', {
      role,
      isSelf,
      isVideoOff,
      videoLocked,
      isScreenSharing,
      hasVideo,
      videoTracks: stream?.getVideoTracks().map((track) => ({
        readyState: track.readyState,
        enabled: track.enabled,
      })) || [],
    });
  }, [hasVideo, isScreenSharing, isSelf, isVideoOff, role, stream, videoLocked]);

  return (
    <div className="meeting-tile group relative overflow-hidden rounded-2xl border-2" style={{ borderColor: `hsl(${Array.from(uid).reduce((hue, char) => (hue * 31 + char.charCodeAt(0)) % 360, 0)} 70% 55%)` }}>
      {hasVideo ? (
        <video ref={videoRef} autoPlay playsInline muted className="h-full w-full object-contain" />
      ) : (
        <div className="flex h-full items-center justify-center meeting-tile-bg">
          {photoURL ? (
            <img src={photoURL} alt="" className="h-16 w-16 rounded-full object-cover ring-2 ring-white/20" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white/10 text-xl font-semibold text-white">
              {displayName.slice(0, 1).toUpperCase() || <UserRound size={20} />}
            </div>
          )}
        </div>
      )}
      {!isSelf && stream?.getAudioTracks().length ? (
        <audio className="hidden" ref={(el) => { if (el && el.srcObject !== stream) el.srcObject = stream; }} autoPlay muted={isMuted || audioLocked} />
      ) : null}
      {isScreenSharing && <span className="absolute left-2 top-2 rounded-md bg-black/65 px-2 py-1 text-[10px] text-white">Partage d’écran</span>}
      {!isSelf && connectionState !== 'connected' && (
        <span className="absolute right-2 top-2 rounded-md bg-black/70 px-2 py-1 text-[10px] text-amber-100">
          {connectionState === 'failed' ? 'Connexion interrompue' : connectionState === 'disconnected' ? 'Reconnexion…' : 'Connexion…'}
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 to-transparent px-3 pb-2 pt-8">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-xs font-medium text-white drop-shadow">{displayName}</span>
          {(role === 'host' || role === 'co-host') && (
            <span className="meeting-badge-host shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold">{role === 'co-host' ? 'Co-organisateur' : 'Organisateur'}</span>
          )}
          {isSelf && (
            <span className="shrink-0 rounded-full bg-white/15 px-1.5 py-0.5 text-[9px] text-white/80">Vous</span>
          )}
        </div>
        {isMuted && <MicOff className="h-3 w-3 shrink-0 text-red-400" />}
      </div>
      {isModerator && canModerate && (
        <div className="absolute right-2 top-10 flex gap-1 rounded-lg bg-black/65 p-1 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100">
          <button type="button" onClick={() => onModerate(uid, audioLocked ? 'unlock-microphone' : 'lock-microphone')} className="rounded p-1 text-white hover:bg-white/20" aria-label={audioLocked ? 'Autoriser le micro' : 'Verrouiller le micro'}>
            <MicOff className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onModerate(uid, videoLocked ? 'unlock-camera' : 'lock-camera')} className="rounded p-1 text-white hover:bg-white/20" aria-label={videoLocked ? 'Autoriser la caméra' : 'Verrouiller la caméra'}>
            <CameraOff className="h-3.5 w-3.5" />
          </button>
          <button type="button" onClick={() => onModerate(uid, 'kick')} className="rounded p-1 text-red-300 hover:bg-white/20" aria-label="Exclure définitivement">
            <UserX className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
};

const ControlBtn = ({
  onClick, active = false, danger = false, label, children,
}: {
  onClick: () => void; active?: boolean; danger?: boolean; label: string; children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className={`meeting-ctrl-btn flex h-9 w-9 items-center justify-center rounded-xl transition-all ${
      danger ? 'meeting-ctrl-danger' : active ? 'meeting-ctrl-active' : 'meeting-ctrl-default'
    }`}
  >
    {children}
  </button>
);

const VideoRoom = ({ reunionId, roomId, uid, displayName, photoURL, role, roomRole, isHost, isModerator, canShareLink, mediaPermissions, onJoined, onLeave, onEndRoom }: VideoRoomProps) => {
  const [copied, setCopied] = useState(false);
  const {
    participants, localStream, isMuted, isVideoOff, isSharing, audioLocked, videoLocked, isLoading, error, roomEnded,
    toggleMicrophone, toggleCamera, toggleScreenShare, moderateParticipant, endRoomForAll,
  } = useWebRTCRoom({ reunionId, roomId, uid, displayName, photoURL, role: roomRole, isModerator, isViewer: role === 'viewer', mediaPermissions });

  useEffect(() => { if (!isLoading && !error) onJoined(); }, [error, isLoading, onJoined]);
  useEffect(() => { if (roomEnded) onLeave(); }, [roomEnded]);

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };

  const shareScreen = async () => {
    try {
      await toggleScreenShare();
    } catch {
      toast.error('Le partage d’écran n’a pas pu démarrer. Vérifiez les autorisations du navigateur.');
    }
  };

  const toggleCameraWithFeedback = async () => {
    try {
      await toggleCamera();
    } catch (cameraError) {
      if (cameraError instanceof DOMException && cameraError.name === 'NotReadableError') {
        toast.error('La caméra est utilisée par une autre application ou indisponible. Fermez les autres applications/onglets qui l’utilisent, puis réessayez.');
      } else if (cameraError instanceof DOMException && cameraError.name === 'NotAllowedError') {
        toast.error('L’accès à la caméra est refusé. Autorisez-la dans les paramètres du navigateur, puis réessayez.');
      } else if (cameraError instanceof DOMException && cameraError.name === 'NotFoundError') {
        toast.error('Aucune caméra n’est détectée sur cet appareil.');
      } else {
        toast.error('La caméra n’a pas pu être activée. Vérifiez les autorisations et la disponibilité de l’appareil.');
      }
    }
  };

  const canModerate = (targetRole: RoomParticipant['role']) =>
    isModerator && (targetRole === 'participant' || (role === 'host' && targetRole === 'co-host'));

  const endForAll = async () => {
    try {
      await endRoomForAll();
      onEndRoom();
    } catch {
      toast.error('Seul le créateur de la réunion peut la terminer pour tous.');
    }
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center gap-3 text-sm text-muted-foreground">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Connexion à la salle…
      </div>
    );
  }
  if (error) {
    return <div className="flex min-h-[50vh] items-center justify-center p-6 text-center text-sm text-destructive">{error}</div>;
  }

  const tileCount = participants.length + 1;
  const gridClass =
    tileCount === 1 ? 'grid-cols-1' :
    tileCount === 2 ? 'grid-cols-1 sm:grid-cols-2' :
    tileCount <= 4 ? 'grid-cols-2' :
    'grid-cols-2 lg:grid-cols-3';

  return (
    <div className="flex h-full flex-col gap-3">
      {/* Participant count */}
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <Users className="h-3.5 w-3.5" />
        <span>{tileCount} participant{tileCount > 1 ? 's' : ''}</span>
      </div>

      {/* Video grid */}
      <div className={`grid flex-1 gap-2 ${gridClass}`} style={{ minHeight: 0 }}>
        <VideoTile
          displayName={displayName}
          uid={uid}
          isModerator={false}
          canModerate={false}
          onModerate={() => undefined}
          photoURL={photoURL || null}
          role={role}
          isMuted={isMuted}
          isVideoOff={isVideoOff}
          audioLocked={audioLocked}
          videoLocked={videoLocked}
          isScreenSharing={isSharing}
          connectionState="connected"
          stream={localStream}
          isSelf
        />
        {participants.map((p) => (
          <VideoTile
            key={p.uid}
            displayName={p.displayName}
            uid={p.uid}
            isModerator={isModerator}
            canModerate={canModerate(p.role)}
            onModerate={(targetUid, action) => void moderateParticipant(targetUid, action)}
            photoURL={p.photoURL}
            role={p.role}
            isMuted={p.isMuted}
            isVideoOff={p.isVideoOff}
            audioLocked={p.audioLocked}
            videoLocked={p.videoLocked}
            isScreenSharing={p.isScreenSharing}
            connectionState={p.connectionState}
            stream={p.stream}
          />
        ))}
      </div>

      {/* Controls bar */}
      <div className="meeting-controls mx-auto flex flex-wrap items-center justify-center gap-1.5 rounded-2xl px-4 py-2.5">
        {role !== 'viewer' && (
          <>
            <ControlBtn onClick={() => void toggleMicrophone()} active={isMuted || audioLocked} danger={isMuted || audioLocked} label={audioLocked ? 'Micro verrouillé par un responsable' : isMuted ? 'Activer le micro' : 'Couper le micro'}>
              {isMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}
            </ControlBtn>
            <ControlBtn onClick={() => void toggleCameraWithFeedback()} active={isVideoOff || videoLocked} danger={isVideoOff || videoLocked} label={videoLocked ? 'Caméra verrouillée par un responsable' : isVideoOff ? 'Activer la caméra' : 'Couper la caméra'}>
              {isVideoOff ? <CameraOff className="h-4 w-4" /> : <Camera className="h-4 w-4" />}
            </ControlBtn>
            {(isModerator || mediaPermissions.participantsCanShareScreen) && <ControlBtn onClick={() => void shareScreen()} active={isSharing} label={isSharing ? 'Arrêter le partage' : 'Partager l\'écran'}>
              <MonitorUp className="h-4 w-4" />
            </ControlBtn>}
            <div className="mx-1 h-5 w-px bg-border" />
          </>
        )}
        {canShareLink && <button
          type="button"
          onClick={() => void copyLink()}
          className="meeting-ctrl-default meeting-ctrl-btn flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all"
        >
          {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? 'Copié' : 'Lien'}
        </button>}
        {isHost && (
          <button
            type="button"
            onClick={() => void endForAll()}
            className="meeting-ctrl-danger meeting-ctrl-btn flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all"
          >
            <PhoneOff className="h-3.5 w-3.5" />
            Terminer
          </button>
        )}
        <ControlBtn onClick={onLeave} danger label="Quitter la réunion">
          <PhoneOff className="h-4 w-4" />
        </ControlBtn>
      </div>
    </div>
  );
};

export default VideoRoom;
