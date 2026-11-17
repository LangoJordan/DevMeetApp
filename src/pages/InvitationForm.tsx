// ============================================================================
// PAGE: InvitationForm.tsx - Créer et inviter aux réunions
// ============================================================================
//
// Cette page permet aux utilisateurs de:
// 1. Créer une nouvelle réunion avec titre, description et type
// 2. Sélectionner une date et heure pour la réunion (ou programmer maintenant)
// 3. Sélectionner plusieurs contacts à inviter
// 4. Assigner des rôles aux participants (host, co-host, participant)
// 5. Envoyer les invitations et notifications
// 6. Créer un document de réunion dans Firestore
//
// PROCESSUS:
// 1. L'utilisateur remplit le formulaire de réunion
// 2. Sélectionne les contacts à inviter
// 3. Soumet le formulaire
// 4. La réunion est créée dans Firestore
// 5. Des invitations sont créées pour chaque participant
// 6. L'utilisateur est redirigé vers la page de la réunion

import { useEffect, useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { db } from '@/firebase/firebase';
import { collection, query, where, getDocs, addDoc, serverTimestamp, Timestamp } from 'firebase/firestore';
import { useNavigate } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, CalendarDays, ShieldCheck, X } from 'lucide-react';
import { toast } from 'sonner';
import { mockContacts } from '@/data/mockData';

interface Contact {
  id: string;
  name?: string;
  invitId?: string;
  email?: string;
  [key: string]: unknown;
}

const InvitationForm = () => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    scheduledDate: '',
    scheduledTime: '',
    type: 'private' as 'public' | 'private',
    scheduleNow: false,
    participantsCanSpeak: true,
    participantsCanUseCamera: true,
    participantsCanShareScreen: false,
  });

  const [selectedContacts, setSelectedContacts] = useState<string[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [roles, setRoles] = useState<Record<string, 'host' | 'co-host' | 'participant'>>({});

  const toggleContact = (contactId: string) => {
    if (selectedContacts.includes(contactId)) {
      setSelectedContacts(selectedContacts.filter(id => id !== contactId));
      const newRoles = { ...roles };
      delete newRoles[contactId];
      setRoles(newRoles);
    } else {
      setSelectedContacts([...selectedContacts, contactId]);
      setRoles({ ...roles, [contactId]: 'participant' });
    }
  };

  const updateRole = (contactId: string, role: 'host' | 'co-host' | 'participant') => {
    setRoles({ ...roles, [contactId]: role });
  };

  const { user } = useAuth();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Validate
    if (!user) {
      toast.error('Vous devez être connecté pour créer une invitation');
      return;
    }
    if (!formData.title || !formData.description) {
      toast.error('Veuillez remplir tous les champs requis');
      return;
    }
    if (!formData.scheduleNow && (!formData.scheduledDate || !formData.scheduledTime)) {
      toast.error('Veuillez renseigner la date et l\'heure programmées ou choisir "Programmer maintenant"');
      return;
    }
    if (formData.type === 'private' && selectedContacts.length === 0) {
      toast.error('Une réunion privée doit avoir au moins un participant invité.');
      return;
    }

    (async () => {
      try {
        // Build begin date
        const now = new Date();
        const beginDate = formData.scheduleNow
          ? now
          : new Date(`${formData.scheduledDate}T${formData.scheduledTime}`);

        // Génération conditionnelle du lien de réunion
        const roomId = `room_${crypto.randomUUID()}`;
        const roomUrl = `${window.location.origin}/meeting/${encodeURIComponent(roomId)}`;
        const selectedContactsDocs = contacts.filter(c => selectedContacts.includes(c.id));
        const invitedUserIds = [...new Set([
          user.uid,
          ...selectedContactsDocs.map(contact => contact.invitId).filter((id): id is string => Boolean(id)),
        ])];

        // Create reunion
        const reunionRef = await addDoc(collection(db, 'reunions'), {
          begin: beginDate,
          createdAt: serverTimestamp(),
          creatorId: user.uid,
          hostId: user.uid,
          maxParticipants: 6,
          expiresAt: Timestamp.fromDate(new Date(beginDate.getTime() + 24 * 60 * 60 * 1000)),
          description: formData.description,
          roomUrl,
          roomId,
          status: 'scheduled',
          title: formData.title,
          type: formData.type,
          participantsCanSpeak: formData.participantsCanSpeak,
          participantsCanUseCamera: formData.participantsCanUseCamera,
          participantsCanShareScreen: formData.participantsCanShareScreen,
          invitedUserIds,
        });

        // Create invitations for each selected contact
        const promises = selectedContactsDocs.map(async (c) => {
          const role = roles[c.id] || 'participant';
          await addDoc(collection(db, 'invitations'), {
            callerId: user.uid,
            contactId: c.invitId,
            createdAt: serverTimestamp(),
            dateFin: null,
            debut: formData.scheduleNow ? serverTimestamp() : null,
            reunionId: reunionRef.id,
            role: role,
            status: 'pending',
            viewed: false,
            url: roomUrl,
            roomId,
          });
        });

        await Promise.all(promises);

        // Appel backend pour envoyer les emails d'invitation (non bloquant pour l'utilisateur)
        try {
          const emailInvitations = selectedContactsDocs
            .filter(c => c.email)
            .map(c => ({
              toEmail: c.email as string,
              toName: c.name || '',
              meetingTitle: formData.title,
              meetingDescription: formData.description,
              begin: beginDate.toISOString(),
              roomUrl: roomUrl ?? '',
            }));

          const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '');
          if (emailInvitations.length > 0 && apiBaseUrl) {
            void fetch(`${apiBaseUrl}/api/send-invitations-email`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ invitations: emailInvitations }),
            }).catch((err) => {
              console.warn('Failed to call send-invitations-email endpoint', err);
            });
          }
        } catch (emailErr) {
          console.warn('Error preparing invitation emails', emailErr);
        }

        toast.success('Réunion et invitations créées avec succès');
        navigate('/invitations');
      } catch (err) {
        console.error('Error creating reunion/invitations', err);
        toast.error('Erreur lors de la création des invitations');
      }
    })();
  };

  // Load contacts for the current user
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const q = query(collection(db, 'contacts'), where('creatorId', '==', user.uid));
        const snap = await getDocs(q);
        const seenUserIds = new Set<string>();
        const items = snap.docs
          .map(d => ({ id: d.id, ...(d.data() as Contact) } as Contact))
          .filter((contact) => {
            if (!contact.invitId || contact.invitId === user.uid || seenUserIds.has(contact.invitId)) return false;
            seenUserIds.add(contact.invitId);
            return true;
          });
        setContacts(items);
      } catch (e) {
        console.error('Error loading contacts', e);
      }
    })();
  }, [user]);

  return (
    <DashboardLayout>
      <div className="dashboard-surface landing-page mx-auto w-full max-w-[1120px] space-y-6 pb-8">
        <div>
          <button
            type="button"
            onClick={() => navigate('/invitations')}
            className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Retour aux réunions
          </button>
          <div className="flex items-start gap-4">
            <div className="dashboard-tone-mint flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
              <CalendarDays className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Planification</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">Nouvelle réunion</h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">Définissez le rendez-vous, les accès et les participants.</p>
            </div>
          </div>
        </div>

        <Card className="dashboard-card overflow-hidden rounded-[1.5rem]">
          <CardHeader className="border-b border-border/70 bg-muted/20 px-5 py-5 sm:px-8">
            <div className="flex items-start gap-3">
              <div className="dashboard-tone-lavender flex h-10 w-10 shrink-0 items-center justify-center rounded-xl">
                <ShieldCheck className="h-4 w-4" />
              </div>
              <div>
                <CardTitle className="text-lg">Détails de la réunion</CardTitle>
                <CardDescription className="mt-1">Les champs marqués d’un astérisque sont obligatoires.</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-5 sm:p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="title">Titre de la réunion *</Label>
                <Input
                  id="title"
                  placeholder="Ex: Réunion stratégique mensuelle"
                  value={formData.title}
                  onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Objectifs / Description *</Label>
                <Textarea
                  id="description"
                  placeholder="Décrivez les objectifs de cette réunion..."
                  value={formData.description}
                  onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                  rows={4}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="type">Type de réunion *</Label>
                <Select 
                  value={formData.type}
                  onValueChange={(value: 'public' | 'private') => setFormData({ ...formData, type: value })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Publique</SelectItem>
                    <SelectItem value="private">Privée</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <section className="space-y-3 rounded-2xl border border-border/70 bg-background/55 p-4 sm:p-5">
                <div>
                  <h2 className="text-sm font-semibold">Permissions au démarrage</h2>
                  <p className="text-xs text-muted-foreground">L’organisateur et les co-organisateurs gardent toujours le contrôle.</p>
                </div>
                {([
                  ['participantsCanSpeak', 'Les participants peuvent activer leur micro'],
                  ['participantsCanUseCamera', 'Les participants peuvent activer leur caméra'],
                  ['participantsCanShareScreen', 'Les participants peuvent partager leur écran'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-3 text-sm">
                    <Checkbox
                      checked={formData[key]}
                      onCheckedChange={(checked) => setFormData((current) => ({ ...current, [key]: Boolean(checked) }))}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </section>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="date">Date *</Label>
                  <Input
                    id="date"
                    type="date"
                    value={formData.scheduledDate}
                    onChange={(e) => setFormData({ ...formData, scheduledDate: e.target.value })}
                    required={!formData.scheduleNow}
                    disabled={formData.scheduleNow}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="time">Heure *</Label>
                  <Input
                    id="time"
                    type="time"
                    value={formData.scheduledTime}
                    onChange={(e) => setFormData({ ...formData, scheduledTime: e.target.value })}
                    required={!formData.scheduleNow}
                    disabled={formData.scheduleNow}
                  />
                </div>
              </div>

              <div className="flex items-start gap-2">
                <Checkbox
                  id="scheduleNow"
                  checked={formData.scheduleNow}
                  onCheckedChange={(checked) =>
                    setFormData({ ...formData, scheduleNow: Boolean(checked) })
                  }
                />
                <div>
                  <Label htmlFor="scheduleNow">Programmer maintenant</Label>
                  <p className="text-xs text-muted-foreground">
                    Si cette option est cochée, la réunion est disponible immédiatement et le lien est généré.
                    Sinon, le lien sera généré plus tard via la gestion de la réunion.
                  </p>
                </div>
              </div>

              <div className="space-y-4">
                <Label>Sélectionner les participants *</Label>
                <div className="max-h-72 space-y-2 overflow-y-auto rounded-2xl border border-border/70 bg-background/55 p-3 sm:p-4">
                  {contacts.filter((contact) => contact.invitId && contact.invitId !== user?.uid).map((contact) => (
                    <div key={contact.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-card/80 px-3 py-2.5 transition-colors hover:border-primary/25">
                      <Checkbox
                        id={contact.id}
                        checked={selectedContacts.includes(contact.id)}
                        onCheckedChange={() => toggleContact(contact.id)}
                      />
                      <Label 
                        htmlFor={contact.id} 
                        className="min-w-[120px] flex-1 cursor-pointer"
                      >
                        {contact.name}
                      </Label>
                      {selectedContacts.includes(contact.id) && (
                        <Select
                          value={roles[contact.id]}
                          onValueChange={(value: 'host' | 'co-host' | 'participant') => updateRole(contact.id, value)}
                        >
                          <SelectTrigger className="w-full rounded-xl sm:w-40">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="host">Organisateur</SelectItem>
                            <SelectItem value="co-host">Co-organisateur</SelectItem>
                            <SelectItem value="participant">Participant</SelectItem>
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {selectedContacts.length > 0 && (
                <div className="space-y-2">
                  <Label>Participants sélectionnés ({selectedContacts.length})</Label>
                  <div className="flex flex-wrap gap-2">
                    {selectedContacts.map((contactId) => {
                      const contact = contacts.find(c => c.id === contactId);
                      return (
                        <Badge key={contactId} variant="secondary" className="gap-1">
                          {contact?.name} ({roles[contactId]})
                          <X 
                            className="h-3 w-3 cursor-pointer" 
                            onClick={() => toggleContact(contactId)}
                          />
                        </Badge>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="flex flex-col-reverse gap-3 border-t border-border pt-6 sm:flex-row sm:justify-end">
                <Button type="submit" className="rounded-xl font-semibold sm:min-w-56">
                  Envoyer l'invitation
                </Button>
                <Button 
                  type="button" 
                  variant="outline"
                  onClick={() => navigate('/invitations')}
                >
                  Annuler
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default InvitationForm;
