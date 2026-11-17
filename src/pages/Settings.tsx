// ============================================================================
// PAGE: Settings.tsx - Paramètres du profil et de confidentialité utilisateur
// ============================================================================
//
// Cette page permet aux utilisateurs de:
// 1. Voir et modifier leurs informations de profil (nom, email, téléphone, avatar)
// 2. Gérer les préférences de confidentialité (visibilité en ligne)
// 3. Changer leur mot de passe
// 4. Supprimer leur compte
// 5. Gérer les préférences de notifications
// 6. Changer le thème (mode sombre/clair)
//
// INTERACTIONS BACKEND:
// - Lecture/écriture dans Firestore (collection 'profiles')
// - Firebase Auth pour changement de mot de passe et suppression de compte
// - POST /api/deactivate-account pour supprimer le compte
//
// DONNÉES STOCKÉES:
// - displayName: Nom d'affichage
// - email: Adresse email
// - phone: Numéro de téléphone
// - photoURL: URL de la photo de profil
// - getVisibility: Booléen pour la visibilité en ligne (paramètre de confidentialité)
// - emailNotifications: Préférence pour les notifications email
// - meetingReminders: Préférence pour les rappels de réunion

import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { useAuth } from '@/context/AuthContext';
import { syncPublicProfile } from '@/services/authService';
import { useEffect, useState } from 'react';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, googleProvider } from '@/firebase/firebase';
import { toast } from 'sonner';
import { Bell, Eye, EyeOff, Moon, Sun, User, Lock, AlertTriangle, Loader2 } from 'lucide-react';
import {
  EmailAuthProvider,
  linkWithCredential,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  updatePassword,
} from 'firebase/auth';
import { FirebaseError } from 'firebase/app';

interface ProfileData {
  displayName?: string;
  email?: string;
  isOnline?: boolean;
  photoURL?: string;
  phone?: string;
  emailNotifications?: boolean;
  meetingReminders?: boolean;
  getVisibility?: boolean;
}

const Settings = () => {
  const { user } = useAuth();
  const [profileData, setProfileData] = useState<ProfileData>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem('theme');
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  const [passwordData, setPasswordData] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });
  const [hasPasswordProvider, setHasPasswordProvider] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [isDeletingAccount, setIsDeletingAccount] = useState(false);

  useEffect(() => {
    setHasPasswordProvider(user?.providerData.some((provider) => provider.providerId === 'password') ?? false);
  }, [user]);

  useEffect(() => {
    const loadProfile = async () => {
      if (!user) return;

      try {
        const profileRef = doc(db, 'profiles', user.uid);
        const profileSnap = await getDoc(profileRef);

        if (profileSnap.exists()) {
          const data = profileSnap.data() as ProfileData;
          setProfileData({
            displayName: data.displayName || user.displayName || '',
            email: data.email || user.email || '',
            isOnline: data.isOnline ?? true,
            photoURL: data.photoURL || user.photoURL || '',
            phone: data.phone || '',
            emailNotifications: data.emailNotifications ?? true,
            meetingReminders: data.meetingReminders ?? true,
            getVisibility: data.getVisibility ?? true,
          });
        } else {
          setProfileData({
            displayName: user.displayName || '',
            email: user.email || '',
            isOnline: true,
            phone: '',
            emailNotifications: true,
            meetingReminders: true,
            getVisibility: true,
          });
        }
      } catch (error) {
        console.error('Error loading profile:', error);
        toast.error('Erreur lors du chargement du profil');
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, [user]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (isDarkTheme) {
      root.classList.add('dark');
      window.localStorage.setItem('theme', 'dark');
    } else {
      root.classList.remove('dark');
      window.localStorage.setItem('theme', 'light');
    }
  }, [isDarkTheme]);

  const handleSaveProfile = async () => {
    if (!user) {
      toast.error('Utilisateur non authentifié');
      return;
    }

    try {
      setIsSaving(true);
      const profileRef = doc(db, 'profiles', user.uid);
      await setDoc(profileRef, {
        userId: user.uid,
        email: profileData.email || user.email || '',
        displayName: profileData.displayName,
        photoURL: profileData.photoURL || user.photoURL || '',
        isOnline: profileData.isOnline,
        phone: profileData.phone || '',
        emailNotifications: profileData.emailNotifications ?? true,
        meetingReminders: profileData.meetingReminders ?? true,
        getVisibility: profileData.getVisibility ?? true,
      }, { merge: true });
      await syncPublicProfile(user.uid, {
        displayName: profileData.displayName,
        photoURL: profileData.photoURL,
        isOnline: profileData.isOnline,
      });
      toast.success('Profil mis à jour avec succès');
    } catch (error) {
      console.error('Error saving profile:', error);
      toast.error('Erreur lors de la sauvegarde du profil');
    } finally {
      setIsSaving(false);
    }
  };

  const handleOnlineVisibilityChange = (value: boolean) => {
    setProfileData(prev => ({ ...prev, isOnline: value, getVisibility: value }));
  };

  const handleChangePassword = async () => {
    if (!user) {
      toast.error('Utilisateur non authentifié');
      return;
    }

    const hasGoogleProvider = user.providerData.some((provider) => provider.providerId === 'google.com');
    const canCreatePassword = !hasPasswordProvider && hasGoogleProvider;

    if (hasPasswordProvider && !passwordData.currentPassword) {
      toast.error('Veuillez entrer votre mot de passe actuel');
      return;
    }

    if (!hasPasswordProvider && !canCreatePassword) {
      toast.error('Ce compte ne permet pas de définir un mot de passe depuis cette page.');
      return;
    }

    if (!passwordData.newPassword) {
      toast.error('Veuillez entrer un nouveau mot de passe');
      return;
    }

    if (passwordData.newPassword.length < 6) {
      toast.error('Le nouveau mot de passe doit contenir au moins 6 caractères');
      return;
    }

    if (passwordData.newPassword !== passwordData.confirmPassword) {
      toast.error('Les mots de passe ne correspondent pas');
      return;
    }

    try {
      setIsChangingPassword(true);
      if (!user.email) {
        toast.error('Aucune adresse email n’est associée à ce compte.');
        return;
      }

      if (hasPasswordProvider) {
        const credential = EmailAuthProvider.credential(user.email, passwordData.currentPassword);
        await reauthenticateWithCredential(user, credential);
        await updatePassword(user, passwordData.newPassword);
      } else {
        await reauthenticateWithPopup(user, googleProvider);
        const credential = EmailAuthProvider.credential(user.email, passwordData.newPassword);
        await linkWithCredential(user, credential);
        setHasPasswordProvider(true);
      }

      setPasswordData({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });

      toast.success('Mot de passe mis à jour avec succès');
    } catch (error: unknown) {
      console.error('Error changing password:', error);
      const errorCode = error instanceof FirebaseError ? error.code : '';
      if (errorCode === 'auth/wrong-password' || errorCode === 'auth/invalid-credential') {
        toast.error('Le mot de passe actuel est incorrect');
      } else if (errorCode === 'auth/weak-password') {
        toast.error('Le nouveau mot de passe est trop faible');
      } else if (errorCode === 'auth/credential-already-in-use' || errorCode === 'auth/email-already-in-use') {
        toast.error('Un autre compte utilise déjà cette adresse email.');
      } else if (errorCode === 'auth/popup-closed-by-user') {
        toast.error('La confirmation Google a été annulée.');
      } else if (errorCode === 'auth/operation-not-allowed') {
        toast.error('Activez le fournisseur Email/Mot de passe dans Firebase Authentication.');
      } else {
        toast.error('Erreur lors du changement du mot de passe');
      }
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleDeactivateAccount = async () => {
    if (!user) {
      toast.error('Utilisateur non authentifié');
      return;
    }

    toast('Confirmer la désactivation du compte ?', {
      description: 'Cette action désactivera votre compte. Vous pourrez le réactiver plus tard en vous reconnectant.',
      action: {
        label: "Désactiver",
        onClick: async () => {
          try {
            setIsDeletingAccount(true);

            // Record the deactivation in the user-owned Firestore profile.
            const profileRef = doc(db, 'profiles', user.uid);
            await setDoc(profileRef, {
              userId: user.uid,
              isDeactivated: true,
              deactivatedAt: serverTimestamp(),
            }, { merge: true });

            const apiBaseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/+$/, '') || 'http://localhost:4000';
            const response = await fetch(`${apiBaseUrl}/api/deactivate-account`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${await user.getIdToken()}`,
              },
              body: JSON.stringify({ uid: user.uid }),
            });
            if (!response.ok) throw new Error(`Account deactivation failed (${response.status}).`);

            toast.success('Compte désactivé avec succès');
            setTimeout(() => {
              window.location.href = '/login';
            }, 2000);
          } catch (error: unknown) {
            console.error('Error deactivating account:', error);
            toast.error('Erreur lors de la désactivation du compte');
          } finally {
            setIsDeletingAccount(false);
          }
        },
      },
      cancel: { label: "Annuler", onClick: () => undefined },
      duration: 10000,
    });
  };

  const hasGoogleProvider = user?.providerData.some((provider) => provider.providerId === 'google.com') ?? false;
  const canSetPassword = hasPasswordProvider || hasGoogleProvider;

  if (isLoading) {
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
        <section className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Votre espace</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-[-0.045em] text-foreground sm:text-4xl">Paramètres</h1>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">Gérez votre profil, votre confidentialité et vos préférences.</p>
          </div>
        </section>

        {/* Profile Section */}
        <Card className="dashboard-card overflow-hidden rounded-[1.5rem]">
          <CardHeader className="border-b border-border/70 bg-muted/20 pb-4">
            <div className="flex items-center gap-3">
              <div className="dashboard-tone-blue flex h-10 w-10 items-center justify-center rounded-2xl">
                <User className="w-5 h-5 text-blue-600" />
              </div>
              <div>
                <CardTitle className="text-xl">Profil</CardTitle>
                <CardDescription>Informations de votre compte</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <div className="grid md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label htmlFor="name" className="font-semibold">Nom complet</Label>
                <Input
                  id="name"
                  value={profileData.displayName || ''}
                  onChange={(e) => setProfileData(prev => ({ ...prev, displayName: e.target.value }))}
                  className="h-11 bg-muted/40 border-border/50 focus:border-primary/50"
                  placeholder="Votre nom complet"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="font-semibold">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={profileData.email || ''}
                  disabled
                  className="h-11 opacity-60 cursor-not-allowed bg-muted/40 border-border/50"
                />
              </div>
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="phone" className="font-semibold">Téléphone</Label>
              <Input
                id="phone"
                type="tel"
                value={profileData.phone || ''}
                onChange={(e) => setProfileData(prev => ({ ...prev, phone: e.target.value }))}
                className="h-11 bg-muted/40 border-border/50 focus:border-primary/50"
                placeholder="+33 6 12 34 56 78"
              />
            </div>

            <Button
              onClick={handleSaveProfile}
              disabled={isSaving}
              className="w-full rounded-xl font-semibold shadow-sm sm:w-auto"
            >
              {isSaving ? (
                <>
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Enregistrement...
                </>
              ) : (
                'Enregistrer les modifications'
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Appearance Section */}
        <Card className="dashboard-card overflow-hidden rounded-[1.5rem]">
          <CardHeader className="border-b border-border/70 bg-muted/20 pb-4">
            <div className="flex items-center gap-3">
              <div className="dashboard-tone-lavender flex h-10 w-10 items-center justify-center rounded-2xl">
                {isDarkTheme ? <Moon className="w-5 h-5 text-purple-600" /> : <Sun className="w-5 h-5 text-purple-600" />}
              </div>
              <div>
                <CardTitle className="text-xl">Apparence</CardTitle>
                <CardDescription>Choisissez votre thème préféré</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/50 p-4 transition-colors hover:border-primary/20">
              <div>
                <p className="font-semibold">Mode {isDarkTheme ? 'sombre' : 'clair'}</p>
                <p className="text-sm text-muted-foreground">Basculez entre le mode clair et le mode sombre</p>
              </div>
              <Switch
                checked={isDarkTheme}
                onCheckedChange={(value: boolean) => setIsDarkTheme(value)}
                className="ml-4"
              />
            </div>
          </CardContent>
        </Card>

        {/* Online Visibility Section */}
        <Card className="dashboard-card overflow-hidden rounded-[1.5rem]">
          <CardHeader className="border-b border-border/70 bg-muted/20 pb-4">
            <div className="flex items-center gap-3">
              <div className="dashboard-tone-mint flex h-10 w-10 items-center justify-center rounded-2xl">
                <Eye className="w-5 h-5 text-green-600" />
              </div>
              <div>
                <CardTitle className="text-xl">Visibilité en ligne</CardTitle>
                <CardDescription>Contrôlez votre statut de présence</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/50 p-4 transition-colors hover:border-primary/20">
              <div>
                <p className="font-semibold">Afficher mon statut en ligne</p>
                <p className="text-sm text-muted-foreground">Vos contacts verront si vous êtes en ligne</p>
              </div>
              <Switch
                checked={profileData.isOnline ?? true}
                onCheckedChange={handleOnlineVisibilityChange}
                className="ml-4"
              />
            </div>

            {profileData.isOnline ? (
              <div className="rounded-xl bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 p-4 flex items-start gap-3">
                <div className="w-6 h-6 rounded-full bg-green-500 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-white text-sm">✓</span>
                </div>
                <div>
                  <p className="font-semibold text-green-900 dark:text-green-400">Statut visible</p>
                  <p className="text-sm text-green-800 dark:text-green-300">Vous êtes affiché en ligne pour vos contacts</p>
                </div>
              </div>
            ) : (
              <div className="rounded-xl bg-muted/50 dark:bg-muted/20 border border-border/50 p-4 flex items-start gap-3">
                <EyeOff className="w-6 h-6 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-foreground">Statut caché</p>
                  <p className="text-sm text-muted-foreground">Vous êtes affiché hors ligne pour vos contacts</p>
                </div>
              </div>
            )}

            <Button
              onClick={handleSaveProfile}
              disabled={isSaving}
              className="w-full rounded-xl font-semibold shadow-sm sm:w-auto"
            >
              {isSaving ? 'Enregistrement...' : 'Enregistrer les modifications'}
            </Button>
          </CardContent>
        </Card>

        {/* Notifications Section */}
        <Card className="dashboard-card overflow-hidden rounded-[1.5rem]">
          <CardHeader className="border-b border-border/70 bg-muted/20 pb-4">
            <div className="flex items-center gap-3">
              <div className="dashboard-tone-peach flex h-10 w-10 items-center justify-center rounded-2xl">
                <Bell className="w-5 h-5 text-orange-600" />
              </div>
              <div>
                <CardTitle className="text-xl">Notifications</CardTitle>
                <CardDescription>Configurez vos préférences de notification</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/50 p-4 transition-colors hover:border-primary/20">
              <div>
                <p className="font-semibold">Notifications par email</p>
                <p className="text-sm text-muted-foreground">Recevoir des emails pour les nouvelles invitations</p>
              </div>
              <Switch
                checked={profileData.emailNotifications ?? true}
                onCheckedChange={(value: boolean) =>
                  setProfileData(prev => ({ ...prev, emailNotifications: value }))
                }
                className="ml-4"
              />
            </div>
            
            <Separator className="my-2 opacity-50" />
            
            <div className="flex items-center justify-between gap-4 rounded-xl border border-border/70 bg-background/50 p-4 transition-colors hover:border-primary/20">
              <div>
                <p className="font-semibold">Rappels de réunion</p>
                <p className="text-sm text-muted-foreground">Recevoir des rappels avant chaque réunion</p>
              </div>
              <Switch
                checked={profileData.meetingReminders ?? true}
                onCheckedChange={(value: boolean) =>
                  setProfileData(prev => ({ ...prev, meetingReminders: value }))
                }
                className="ml-4"
              />
            </div>

            <Button
              onClick={handleSaveProfile}
              disabled={isSaving}
              className="mt-4 w-full rounded-xl font-semibold shadow-sm sm:w-auto"
            >
              {isSaving ? 'Enregistrement...' : 'Enregistrer les modifications'}
            </Button>
          </CardContent>
        </Card>

        {/* Security Section */}
        <Card className="dashboard-card overflow-hidden rounded-[1.5rem]">
          <CardHeader className="border-b border-border/70 bg-muted/20 pb-4">
            <div className="flex items-center gap-3">
              <div className="dashboard-tone-blue flex h-10 w-10 items-center justify-center rounded-2xl">
                <Lock className="w-5 h-5 text-blue-700" />
              </div>
              <div>
                <CardTitle className="text-xl">Sécurité</CardTitle>
                <CardDescription>Paramètres de sécurité de votre compte</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            {!hasPasswordProvider && hasGoogleProvider && (
              <p className="text-sm text-muted-foreground">
                Votre compte utilise Google. Confirmez votre compte Google pour créer un mot de passe utilisable aussi pour vous connecter par email.
              </p>
            )}
            {!canSetPassword && (
              <p className="text-sm text-muted-foreground">
                Ce compte n’utilise ni email/mot de passe ni Google. Aucun mot de passe ne peut être défini ici.
              </p>
            )}
            <div className={hasPasswordProvider ? 'grid md:grid-cols-2 gap-6' : 'space-y-2'}>
              {hasPasswordProvider && (
                <div className="space-y-2">
                  <Label htmlFor="current-password" className="font-semibold">Mot de passe actuel</Label>
                  <Input
                    id="current-password"
                    type="password"
                    autoComplete="current-password"
                    className="h-11 bg-muted/40 border-border/50 focus:border-primary/50"
                    placeholder="••••••••"
                    value={passwordData.currentPassword}
                    onChange={(e) => setPasswordData(prev => ({ ...prev, currentPassword: e.target.value }))}
                  />
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="new-password" className="font-semibold">Nouveau mot de passe</Label>
                <Input
                  id="new-password"
                  type="password"
                  autoComplete="new-password"
                  className="h-11 bg-muted/40 border-border/50 focus:border-primary/50"
                  placeholder="••••••••"
                  value={passwordData.newPassword}
                  onChange={(e) => setPasswordData(prev => ({ ...prev, newPassword: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password" className="font-semibold">Confirmer le mot de passe</Label>
              <Input
                id="confirm-password"
                type="password"
                autoComplete="new-password"
                className="h-11 bg-muted/40 border-border/50 focus:border-primary/50"
                placeholder="••••••••"
                value={passwordData.confirmPassword}
                onChange={(e) => setPasswordData(prev => ({ ...prev, confirmPassword: e.target.value }))}
              />
            </div>
            <Button
              onClick={handleChangePassword}
              disabled={isChangingPassword || !canSetPassword}
              className="w-full rounded-xl font-semibold sm:w-auto"
            >
              {isChangingPassword ? (
                <>
                  <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                  Changement...
                </>
              ) : (
                hasPasswordProvider ? 'Changer le mot de passe' : 'Créer un mot de passe'
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Account Deletion Section */}
        <Card className="overflow-hidden rounded-[1.5rem] border border-destructive/30 bg-card shadow-sm">
          <CardHeader className="border-b border-destructive/20 bg-destructive/5 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-destructive/20 rounded-lg flex items-center justify-center">
                <AlertTriangle className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <CardTitle className="text-xl text-destructive">Suppression de compte</CardTitle>
                <CardDescription>Gérez l'accès à votre compte</CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm text-muted-foreground">Désactiver votre compte le rendra inaccessible. Vous pouvez réactiver votre compte en vous reconnectant avec vos identifiants.</p>
            <Button
              variant="destructive"
              className="w-full rounded-xl font-semibold shadow-sm sm:w-auto"
              onClick={handleDeactivateAccount}
              disabled={isDeletingAccount}
            >
              {isDeletingAccount ? (
                <>
                  <Loader2 className="animate-spin -ml-1 mr-2 h-4 w-4" />
                  Désactivation...
                </>
              ) : (
                'Désactiver mon compte'
              )}
            </Button>
          </CardContent>
        </Card>
      </div>
    </DashboardLayout>
  );
};

export default Settings;
