import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { AlertCircle, Loader2, PhoneOff, UserPlus, X, ChevronRight } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { auth, db } from '@/firebase/firebase';
import { signInAnonymously } from 'firebase/auth';
import {
  addDoc, arrayUnion, collection, doc, getDoc, getDocs,
  query, serverTimestamp, setDoc, updateDoc, where,
} from 'firebase/firestore';
import { toast } from 'sonner';
import VideoRoom from '@/components/VideoRoom';
import MeetAppLogo from '@/components/MeetAppLogo';

interface MeetingContact { id: string; name: string; email?: string; invitId?: string; }
interface MeetingInfo {
  title?: string;
  description?: string;
  type?: 'public' | 'private';
  creatorId?: string;
  begin?: unknown;
  invitedUserIds?: string[];
  participantsCanSpeak?: boolean;
  participantsCanUseCamera?: boolean;
  participantsCanShareScreen?: boolean;
}

const Meeting = () => {
  const { id: roomId = '' } = useParams();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meetingInfo, setMeetingInfo] = useState<MeetingInfo | null>(null);
  const [reunionId, setReunionId] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<'host' | 'co-host' | 'participant'>('participant');
  const [isInvitePanelOpen, setIsInvitePanelOpen] = useState(false);
  const [contacts, setContacts] = useState<MeetingContact[]>([]);
  const [kickedUserIds, setKickedUserIds] = useState<Set<string>>(new Set());
  const [kickedUserRoles, setKickedUserRoles] = useState<Record<string, 'host' | 'co-host' | 'participant'>>({});
  const [loadingContacts, setLoadingContacts] = useState(false);
  const userJoinTimeRef = useRef<number | null>(null);
  const userName = user?.displayName || user?.email || `Invité ${user?.uid.slice(0, 5) || ''}`;
  const isViewer = searchParams.get('viewer') === 'true';
  const isMeetingHost = Boolean(user && meetingInfo?.creatorId === user.uid);
  const isModerator = !isViewer && (myRole === 'host' || myRole === 'co-host');
  const canShareLink = meetingInfo?.type === 'public' || isModerator;

  useEffect(() => {
    if (authLoading) return;
    if (!roomId) { setError('Identifiant de réunion manquant.'); setIsLoading(false); return; }
    if (!user?.uid) {
      void signInAnonymously(auth).catch(() => {
        setError('Impossible de créer une session invité. Activez la connexion anonyme dans Firebase Authentication.');
        setIsLoading(false);
      });
      return;
    }

    let cancelled = false;
    const load = async () => {
      setIsLoading(true); setError(null);
      try {
        const [owned, invited, pub] = await Promise.all([
          getDocs(query(collection(db, 'reunions'), where('roomId', '==', roomId), where('creatorId', '==', user.uid))),
          getDocs(query(collection(db, 'reunions'), where('roomId', '==', roomId), where('invitedUserIds', 'array-contains', user.uid))),
          getDocs(query(collection(db, 'reunions'), where('roomId', '==', roomId), where('type', '==', 'public'))),
        ]);
        const reunionDoc = owned.docs[0] || invited.docs[0] || pub.docs[0];
        if (!reunionDoc) throw new Error('Cette réunion est introuvable ou son lien est invalide.');
        const data = reunionDoc.data() as MeetingInfo & { status?: string; expiresAt?: { toDate?: () => Date }; type?: string };
        if (data.status === 'completed' || data.status === 'closed') throw new Error('Cette réunion est terminée.');
        const exp = data.expiresAt?.toDate?.().getTime();
        if (exp && Date.now() >= exp) throw new Error('Le lien de cette réunion a expiré.');

        const memberRef = doc(db, 'reunions', reunionDoc.id, 'roomMembers', user.uid);
        const existingMember = await getDoc(memberRef);
        const existingMemberData = existingMember.data();
        const invSnap = await getDocs(query(collection(db, 'invitations'), where('reunionId', '==', reunionDoc.id), where('contactId', '==', user.uid)));
        const invitation = existingMemberData?.kicked === true
          ? invSnap.docs.find((candidate) => candidate.id === existingMemberData.reinviteInvitationId)
          : invSnap.docs.find((candidate) => candidate.data().status === 'accepted') || invSnap.docs[0];
        const invData = invitation?.data() as { role?: 'host' | 'co-host' | 'participant'; status?: string } | undefined;
        const hasInvite = invData?.status === 'accepted';
        if (data.type === 'private' && !hasInvite && data.creatorId !== user.uid) throw new Error('Cette réunion est privée.');
        if (!hasInvite && data.creatorId !== user.uid && data.type !== 'public') throw new Error('Vous n\'êtes pas autorisé à rejoindre cette réunion.');
        if (cancelled) return;

        const memberRole = data.creatorId === user.uid ? 'host' : hasInvite ? invData?.role || 'participant' : 'participant';
        if (existingMemberData?.kicked === true) {
          if (!invitation || !hasInvite || invitation.id !== existingMemberData.reinviteInvitationId || memberRole !== existingMemberData.role) {
            throw new Error('Vous avez été exclu de cette réunion. Acceptez une nouvelle invitation pour la rejoindre.');
          }
          await updateDoc(memberRef, { uid: user.uid, role: memberRole, invitationId: invitation.id, kicked: false });
        }
        const roomMemberData = hasInvite && invitation
          ? { uid: user.uid, role: memberRole, invitationId: invitation.id, kicked: false }
          : { uid: user.uid, role: memberRole, kicked: false };
        await setDoc(memberRef, roomMemberData);
        setReunionId(reunionDoc.id); setMeetingInfo(data); setMyRole(memberRole);
        if (hasInvite && invitation) await updateDoc(invitation.ref, { viewed: true });
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Impossible de charger cette réunion.');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [authLoading, roomId, user?.uid]);

  const recordJoin = useCallback(async () => {
    if (!user?.uid || !reunionId || userJoinTimeRef.current) return;
    userJoinTimeRef.current = Date.now();
    try {
      const snap = await getDocs(query(collection(db, 'invitations'), where('reunionId', '==', reunionId), where('contactId', '==', user.uid)));
      const inv = snap.docs[0];
      if (inv && !inv.data().debut) await updateDoc(inv.ref, { debut: serverTimestamp() });
      if (meetingInfo?.creatorId === user.uid && !meetingInfo.begin)
        await updateDoc(doc(db, 'reunions', reunionId), { begin: serverTimestamp(), status: 'in-progress' });
    } catch { /* ignored */ }
  }, [meetingInfo, reunionId, user?.uid]);

  useEffect(() => {
    if (!user?.uid || !isInvitePanelOpen) return;
    let cancelled = false;
    setLoadingContacts(true);
    void (async () => {
      try {
        if (!reunionId) return;
        const [snap, activeParticipants, roomMembers] = await Promise.all([
          getDocs(query(collection(db, 'contacts'), where('creatorId', '==', user.uid))),
          getDocs(collection(db, 'reunions', reunionId, 'participants')),
          getDocs(collection(db, 'reunions', reunionId, 'roomMembers')),
        ]);
        if (cancelled) return;
        const kickedIds = new Set(roomMembers.docs.filter((member) => member.data().kicked === true).map((member) => member.id));
        const pendingReinviteIds = new Set<string>();
        await Promise.all(roomMembers.docs.filter((member) => kickedIds.has(member.id)).map(async (member) => {
          const invitationId = member.data().reinviteInvitationId;
          if (typeof invitationId !== 'string') return;
          const invitation = await getDoc(doc(db, 'invitations', invitationId));
          if (['pending', 'accepted'].includes(String(invitation.data()?.status || ''))) pendingReinviteIds.add(member.id);
        }));
        if (cancelled) return;
        setKickedUserIds(kickedIds);
        const kickedRoles = roomMembers.docs.reduce<Record<string, 'host' | 'co-host' | 'participant'>>((roles, member) => {
          if (kickedIds.has(member.id)) {
            const role = member.data().role;
            roles[member.id] = role === 'host' || role === 'co-host' ? role : 'participant';
          }
          return roles;
        }, {});
        setKickedUserRoles(kickedRoles);
        const invitedIds = new Set([
          ...(meetingInfo?.invitedUserIds || []),
          ...activeParticipants.docs.map((participant) => participant.id),
        ]);
        const contactsByUid = new Map<string, MeetingContact>();
        snap.docs.forEach((d) => {
          const data = d.data() as { name?: string; email?: string; invitId?: string };
          const inviteeId = data.invitId;
          if (!inviteeId || inviteeId === user.uid || contactsByUid.has(inviteeId)) return;
          const inviteeRole = kickedRoles[inviteeId];
          const canManageKickedMember = myRole === 'host'
            ? inviteeRole !== 'host'
            : inviteeRole === 'participant';
          if ((!invitedIds.has(inviteeId) || (kickedIds.has(inviteeId) && canManageKickedMember))
            && !pendingReinviteIds.has(inviteeId)) {
            contactsByUid.set(inviteeId, { id: d.id, name: data.name || 'Contact', email: data.email, invitId: inviteeId });
          }
        });
        setContacts([...contactsByUid.values()]);
      } catch { toast.error('Impossible de charger les contacts'); }
      finally { if (!cancelled) setLoadingContacts(false); }
    })();
    return () => { cancelled = true; };
  }, [isInvitePanelOpen, meetingInfo?.invitedUserIds, myRole, reunionId, user?.uid]);

  const handleInvite = async (contact: MeetingContact) => {
    if (!user?.uid || !reunionId) return;
    try {
      const roomUrl = `${window.location.origin}/meeting/${encodeURIComponent(roomId)}`;
      const inviteeId = contact.invitId || contact.id;
      const isReinvite = kickedUserIds.has(inviteeId);
      if (meetingInfo?.invitedUserIds?.includes(inviteeId) && !isReinvite) return;
      await updateDoc(doc(db, 'reunions', reunionId), { invitedUserIds: arrayUnion(inviteeId) });
      setMeetingInfo((current) => current ? {
        ...current,
        invitedUserIds: [...new Set([...(current.invitedUserIds || []), inviteeId])],
      } : current);
      const reinviteRole = kickedUserRoles[inviteeId] || 'participant';
      const invitationRef = await addDoc(collection(db, 'invitations'), {
        callerId: user.uid, contactId: inviteeId,
        createdAt: serverTimestamp(), dateFin: null, debut: null,
        reunionId, role: isReinvite ? reinviteRole : 'participant', status: 'pending', viewed: false, url: roomUrl, roomId,
      });
      if (isReinvite) {
        await updateDoc(doc(db, 'reunions', reunionId, 'roomMembers', inviteeId), { reinviteInvitationId: invitationRef.id });
        setContacts((current) => current.filter((item) => item.invitId !== inviteeId));
      }
      const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '');
      if (contact.email && apiBaseUrl) {
        void fetch(`${apiBaseUrl}/api/send-invitations-email`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ invitations: [{ toEmail: contact.email, toName: contact.name, meetingTitle: meetingInfo?.title || 'Réunion Meet-Flow', meetingDescription: meetingInfo?.description || '', begin: new Date().toISOString(), roomUrl }] }),
        }).catch(() => {});
      }
      toast.success(`Invitation envoyée à ${contact.name}`);
    } catch { toast.error('Impossible d\'inviter ce contact'); }
  };

  const recordDeparture = useCallback(async () => {
    if (!user?.uid || !reunionId) return;
    try {
      const snap = await getDocs(query(collection(db, 'invitations'), where('reunionId', '==', reunionId), where('contactId', '==', user.uid)));
      const invitation = snap.docs[0];
      if (invitation && !invitation.data().dateFin) await updateDoc(invitation.ref, { dateFin: serverTimestamp() });
    } catch {
      toast.error('Impossible d’enregistrer votre départ de la réunion.');
    }
  }, [reunionId, user?.uid]);

  const handleLeaveCall = useCallback(async () => {
    await recordDeparture();
    navigate('/calls');
  }, [navigate, recordDeparture]);

  const handleRoomEnded = useCallback(async () => {
    await recordDeparture();
    toast.info('La réunion a été terminée par l’organisateur.');
    navigate('/calls');
  }, [navigate, recordDeparture]);

  /* ── Error state ── */
  if (error) {
    return (
      <div className="meeting-page flex min-h-screen items-center justify-center p-4">
        <div className="meeting-glass w-full max-w-sm space-y-4 rounded-2xl p-6 text-center">
          <AlertCircle className="mx-auto h-8 w-8 text-destructive" />
          <h2 className="text-lg font-bold">Impossible de rejoindre</h2>
          <p className="text-sm text-muted-foreground">{error}</p>
          <div className="flex justify-center gap-2 pt-1">
            <button type="button" onClick={() => navigate('/calls')} className="meeting-btn-outline rounded-xl px-4 py-2 text-sm">Retour</button>
            <button type="button" onClick={() => navigate('/dashboard')} className="meeting-btn-primary rounded-xl px-4 py-2 text-sm">Tableau de bord</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="meeting-page flex min-h-screen flex-col">
      {/* Header */}
      <header className="meeting-header flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <MeetAppLogo />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-sm font-semibold">{meetingInfo?.title || 'Salle de réunion'}</h1>
              <span className="meeting-badge-live flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />En direct
              </span>
            </div>
            <p className="truncate text-[11px] text-muted-foreground">{userName}</p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(myRole === 'host' || myRole === 'co-host') && (
            <button
              type="button"
              onClick={() => setIsInvitePanelOpen((o) => !o)}
              className="meeting-btn-outline hidden items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs sm:flex"
            >
              <UserPlus className="h-3.5 w-3.5" />
              Inviter
            </button>
          )}
          <button type="button" onClick={handleLeaveCall} className="meeting-btn-danger flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium">
            <PhoneOff className="h-3.5 w-3.5" />
            Quitter
          </button>
        </div>
      </header>

      {/* Main */}
      <main className="flex flex-1 flex-col gap-3 overflow-hidden px-3 py-3 md:flex-row md:px-4 md:py-4">
        {/* Video area */}
        <div className="meeting-glass flex min-h-0 flex-1 flex-col rounded-2xl p-3">
          {isLoading || !reunionId || !meetingInfo || !user ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />Chargement de la salle…
            </div>
          ) : (
            <VideoRoom
              reunionId={reunionId}
              roomId={roomId}
              uid={user.uid}
              displayName={userName}
              photoURL={user.photoURL}
              role={isViewer && !isMeetingHost ? 'viewer' : myRole}
              roomRole={myRole}
              isHost={isMeetingHost}
              isModerator={isModerator}
              canShareLink={canShareLink}
              mediaPermissions={{
                participantsCanSpeak: meetingInfo.participantsCanSpeak !== false,
                participantsCanUseCamera: meetingInfo.participantsCanUseCamera !== false,
                participantsCanShareScreen: meetingInfo.participantsCanShareScreen === true,
              }}
              onJoined={recordJoin}
              onLeave={handleLeaveCall}
              onEndRoom={handleRoomEnded}
            />
          )}
        </div>

        {/* Sidebar */}
        <aside className="flex w-full shrink-0 flex-col gap-3 md:w-64 lg:w-72">
          {/* Meeting info */}
          <div className="meeting-glass rounded-2xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Réunion</p>
              {meetingInfo?.type && (
                <span className="meeting-badge-type rounded-full px-2 py-0.5 text-[9px] font-semibold">{meetingInfo.type}</span>
              )}
            </div>
            <p className="text-sm font-semibold">{meetingInfo?.title || 'Salle de réunion'}</p>
            {meetingInfo?.description && <p className="text-xs leading-relaxed text-muted-foreground">{meetingInfo.description}</p>}
            <div className="meeting-info-chip rounded-xl px-3 py-2 text-xs">
              <span className="text-muted-foreground">Connecté · </span>
              <span className="font-medium">{userName}</span>
            </div>
          </div>

          {/* Invite panel */}
          {(myRole === 'host' || myRole === 'co-host') && (
            <div className="meeting-glass rounded-2xl p-4 space-y-3">
              <button
                type="button"
                onClick={() => setIsInvitePanelOpen((o) => !o)}
                className="flex w-full items-center justify-between text-sm font-semibold"
              >
                <span className="flex items-center gap-2"><UserPlus className="h-3.5 w-3.5 text-primary" />Inviter des contacts</span>
                <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${isInvitePanelOpen ? 'rotate-90' : ''}`} />
              </button>
              {isInvitePanelOpen && (
                <div className="space-y-2">
                  {loadingContacts ? (
                    <p className="text-xs text-muted-foreground">Chargement…</p>
                  ) : contacts.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Aucun contact disponible.</p>
                  ) : contacts.map((c) => (
                    <div key={c.id} className="meeting-contact-row flex items-center justify-between gap-2 rounded-xl px-3 py-2">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium">{c.name}</p>
                        {c.email && <p className="truncate text-[10px] text-muted-foreground">{c.email}</p>}
                      </div>
                      <button type="button" onClick={() => void handleInvite(c)} className="meeting-btn-outline shrink-0 rounded-lg px-2.5 py-1 text-[10px] font-medium">
                        {c.invitId && kickedUserIds.has(c.invitId) ? 'Réinviter' : 'Inviter'}
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <p className="hidden px-1 text-[10px] leading-relaxed text-muted-foreground lg:block">
            {meetingInfo?.type === 'public'
              ? 'Cette salle est publique : toute personne disposant du lien peut la rejoindre.'
              : 'Cette salle est privée : seuls les organisateurs peuvent partager le lien.'}
          </p>
        </aside>
      </main>
    </div>
  );
};

export default Meeting;
