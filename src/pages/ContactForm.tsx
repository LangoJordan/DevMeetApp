import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, AlertCircle, ContactRound, Mail, Phone } from 'lucide-react';
import Swal from 'sweetalert2';
import { db } from "@/firebase/firebase";
import { collection, addDoc, doc, getDoc, updateDoc } from "firebase/firestore";
import { useAuth } from "@/context/AuthContext";

const lookupContactProfile = async (email: string) => {
  const directorySnapshot = await getDoc(doc(db, 'emailDirectory', email));
  if (!directorySnapshot.exists()) return null;

  const directory = directorySnapshot.data();
  const publicProfileSnapshot = await getDoc(doc(db, 'publicProfiles', directory.uid));
  const publicProfile = publicProfileSnapshot.exists() ? publicProfileSnapshot.data() : null;

  return {
    id: directory.uid as string,
    avatar: publicProfile?.photoURL || null,
  };
};

const ContactForm = () => {
  const { user } = useAuth();
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = !!id;

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(isEdit);
  const [profileExists, setProfileExists] = useState<boolean | null>(null);
  const [profileCheckError, setProfileCheckError] = useState('');
  const [checkingProfile, setCheckingProfile] = useState(false);

  // Load existing contact data when in edit mode
  useEffect(() => {
    if (!isEdit || !id) {
      setInitialLoading(false);
      return;
    }

    const loadContactData = async () => {
      try {
        const contactDoc = await getDoc(doc(db, "contacts", id));
        if (contactDoc.exists()) {
          const data = contactDoc.data();
          setName(data.name || "");
          setEmail(data.email || "");
          setPhone(data.phone || "");
        } else {
          Swal.fire({
            icon: 'error',
            title: 'Contact non trouvé',
            text: 'Le contact que vous essayez de modifier n\'existe pas.',
          });
          navigate('/contacts');
        }
      } catch (error) {
        console.error("Erreur lors du chargement du contact:", error);
        Swal.fire({
          icon: 'error',
          title: 'Erreur',
          text: 'Une erreur est survenue lors du chargement du contact.',
        });
        navigate('/contacts');
      } finally {
        setInitialLoading(false);
      }
    };

    loadContactData();
  }, [id, isEdit, navigate]);

  useEffect(() => {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail || !user) {
      setProfileExists(null);
      setProfileCheckError('');
      setCheckingProfile(false);
      return;
    }

    setProfileExists(null);
    setProfileCheckError('');
    setCheckingProfile(true);
    let active = true;
    const timer = setTimeout(async () => {
      setCheckingProfile(true);
      try {
        const profile = await lookupContactProfile(normalizedEmail);
        if (active) setProfileExists(Boolean(profile));
      } catch (error) {
        console.error("Erreur lors de la vérification du profil:", error);
        if (active) {
          setProfileExists(null);
          setProfileCheckError(error instanceof Error ? error.message : 'Impossible de vérifier cet email.');
        }
      } finally {
        if (active) setCheckingProfile(false);
      }
    }, 500);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [email, user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!user) {
      Swal.fire({
        icon: 'error',
        title: 'Oops...',
        text: 'Vous devez être connecté pour créer ou modifier un contact.',
      });
      return;
    }

    // Validate that profile exists
    if (profileExists === false) {
      Swal.fire({
        icon: 'error',
        title: 'Profil non trouvé',
        text: 'L\'utilisateur avec cet email n\'existe pas dans la base de données. Veuillez vérifier l\'email ou demander à l\'utilisateur de créer un compte d\'abord.',
      });
      return;
    }

    if (profileExists === null && email.trim() !== "") {
      Swal.fire({
        icon: 'error',
        title: 'Profil non valide',
        text: 'Impossible de vérifier le profil. Veuillez réessayer.',
      });
      return;
    }

    setLoading(true);

    try {
      if (isEdit && id) {
        // Update existing contact
        const contactRef = doc(db, "contacts", id);
        await updateDoc(contactRef, {
          name,
          email,
          phone,
          updatedAt: new Date().toISOString(),
        });

        Swal.fire({
          title: 'Contact modifié!',
          text: 'Le contact a été modifié avec succès',
          icon: 'success',
        });
      } else {
        // Create new contact
        const profile = await lookupContactProfile(email.trim().toLowerCase());

        if (!profile) {
          Swal.fire({
            icon: 'error',
            title: 'Profil non trouvé',
            text: 'L\'utilisateur avec cet email n\'existe pas. Veuillez vérifier l\'email.',
          });
          setLoading(false);
          return;
        }

        await addDoc(collection(db, "contacts"), {
          name,
          email,
          phone,
          avatar: profile.avatar || null,
          status: "offline",
          creatorId: user.uid,
          invitId: profile.id,
          createdAt: new Date().toISOString(),
        });

        Swal.fire({
          title: 'Nouveau contact enregistré!',
          text: 'Le contact a été enregistré avec succès',
          icon: 'success',
        });
      }

      setName("");
      setEmail("");
      setPhone("");
      navigate('/contacts');
    } catch (error) {
      console.error("Erreur Firestore:", error);
      Swal.fire({
        icon: 'error',
        title: 'Oops...',
        text: 'Une erreur est survenue lors de l\'enregistrement.',
      });
    }

    setLoading(false);
  };

  if (initialLoading) {
    return (
      <DashboardLayout>
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-primary"></div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <div className="dashboard-surface landing-page mx-auto w-full max-w-[1120px] space-y-6 pb-8">
        <div>
          <button
            type="button"
            onClick={() => navigate('/contacts')}
            className="mb-5 inline-flex items-center gap-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" /> Retour aux contacts
          </button>
          <div className="flex items-start gap-4">
            <div className="dashboard-tone-lavender flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl">
              <ContactRound className="h-5 w-5" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Carnet d’adresses</p>
              <h1 className="mt-1 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">
                {isEdit ? 'Modifier le contact' : 'Ajouter un contact'}
              </h1>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {isEdit ? 'Mettez à jour les coordonnées de cette personne.' : 'Renseignez les coordonnées d’une personne déjà inscrite sur MeetApp.'}
              </p>
            </div>
          </div>
        </div>

        <div className="dashboard-card overflow-hidden rounded-[1.5rem]">
          <div className="border-b border-border/70 px-5 py-4 sm:px-8">
            <h2 className="text-base font-semibold text-foreground">Coordonnées</h2>
            <p className="mt-1 text-sm text-muted-foreground">Les champs marqués d’un astérisque sont obligatoires.</p>
          </div>
          <div className="p-5 sm:p-8">
          {/* Profile verification alert for new contacts */}
          {!isEdit && email && (
            <div className={`mb-6 flex items-start gap-3 rounded-2xl border p-4 ${
              profileExists
                ? 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-900 dark:bg-emerald-950/40'
                : profileExists === false || profileCheckError
                ? 'border-rose-200 bg-rose-50/80 dark:border-rose-900 dark:bg-rose-950/40'
                : 'border-sky-200 bg-sky-50/80 dark:border-sky-900 dark:bg-sky-950/40'
            }`}>
              <AlertCircle className={`mt-0.5 h-5 w-5 flex-shrink-0 ${
                profileExists
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : profileExists === false || profileCheckError
                  ? 'text-rose-600 dark:text-rose-400'
                  : 'text-sky-600 dark:text-sky-400'
              }`} />
              <div>
                {checkingProfile && <p className="text-sm text-sky-800 dark:text-sky-300">Vérification du profil…</p>}
                {!checkingProfile && profileExists && <p className="text-sm text-emerald-800 dark:text-emerald-300">Le profil existe. Vous pouvez ajouter ce contact.</p>}
                {!checkingProfile && profileExists === false && <p className="text-sm text-rose-800 dark:text-rose-300">Aucun profil trouvé pour cet e-mail. La personne doit d’abord créer un compte.</p>}
                {!checkingProfile && profileExists === null && profileCheckError && <p className="text-sm text-rose-800 dark:text-rose-300">{profileCheckError}</p>}
              </div>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="name">Nom complet *</Label>
              <Input
                id="name"
                placeholder="Jean Dupont"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                disabled={loading}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="email" className="inline-flex items-center gap-2"><Mail className="h-3.5 w-3.5 text-muted-foreground" /> E-mail *</Label>
              <Input
                id="email"
                type="email"
                placeholder="jean@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                disabled={loading || isEdit}
                title={isEdit ? "Vous ne pouvez pas modifier l'email d'un contact existant" : ""}
              />
              {checkingProfile && !isEdit && (
                <p className="text-xs text-muted-foreground">Vérification du profil...</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="phone" className="inline-flex items-center gap-2"><Phone className="h-3.5 w-3.5 text-muted-foreground" /> Téléphone</Label>
              <Input
                id="phone"
                type="tel"
                placeholder="+237 6 12 34 56 78"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                disabled={loading}
              />
            </div>

            <div className="flex flex-col gap-3 border-t border-border pt-6 sm:flex-row-reverse sm:justify-end">
              <Button
                disabled={
                  loading ||
                  checkingProfile ||
                  (!isEdit && profileExists === false) ||
                  (!isEdit && profileExists === null && email.trim() !== "")
                }
                type="submit"
                className="rounded-full font-semibold sm:min-w-[200px]"
              >
                {loading ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    {isEdit ? "Modification en cours..." : "Enregistrement..."}
                  </>
                ) : isEdit ? (
                  "Modifier le contact"
                ) : (
                  "Ajouter le contact"
                )}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="rounded-full"
                onClick={() => navigate('/contacts')}
                disabled={loading}
              >
                Annuler
              </Button>
            </div>
          </form>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default ContactForm;
