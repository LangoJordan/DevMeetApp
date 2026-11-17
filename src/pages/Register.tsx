import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, ArrowRight, Moon, Sun, Check, X, Users, Shield, Zap } from 'lucide-react';
import { registerUser, loginWithGoogle, syncPublicProfile } from '@/services/authService';
import { toast } from 'sonner';
import { updateProfile } from 'firebase/auth';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '@/firebase/firebase';
import MeetAppLogo from '@/components/MeetAppLogo';

const getErrorMessage = (error: { code?: string; message?: string }) => {
  switch (error.code) {
    case 'auth/email-already-in-use': return 'Cette adresse email est déjà utilisée';
    case 'auth/weak-password': return 'Mot de passe trop faible (min. 6 caractères)';
    case 'auth/invalid-email': return "Format d'email invalide";
    case 'auth/too-many-requests': return 'Trop de tentatives. Réessayez plus tard';
    case 'auth/network-request-failed': return 'Erreur réseau';
    case 'auth/popup-closed-by-user': return 'Fenêtre fermée';
    case 'auth/popup-blocked': return 'Popup bloqué. Autorisez les popups';
    default: return error.message || "Erreur d'authentification";
  }
};

const GoogleIcon = () => (
  <svg className="h-4 w-4" viewBox="0 0 24 24">
    <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </svg>
);

const checklist = [
  { icon: Users, text: 'Invitez vos contacts en un clic' },
  { icon: Shield, text: 'Chiffrement de bout en bout' },
  { icon: Zap, text: 'Lancez une réunion en quelques secondes' },
  { icon: Check, text: 'Aucune installation requise' },
];

const Register = () => {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const stored = localStorage.getItem('theme');
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (isDarkTheme) { root.classList.add('dark'); localStorage.setItem('theme', 'dark'); }
    else { root.classList.remove('dark'); localStorage.setItem('theme', 'light'); }
  }, [isDarkTheme]);

  const isPasswordValid = password.length >= 6;
  const isPasswordMatch = password === confirmPassword && password.length > 0;
  const isPhoneValid = phone === '' || phone.replace(/\D/g, '').length > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password || !confirmPassword || !name || !phone) { toast.error('Veuillez remplir tous les champs'); return; }
    if (!isPasswordValid) { toast.error('Le mot de passe doit contenir au moins 6 caractères'); return; }
    if (!isPasswordMatch) { toast.error('Les mots de passe ne correspondent pas'); return; }
    try {
      setIsLoading(true);
      const userCredential = await registerUser(email, password);
      if (userCredential.user) {
        await updateProfile(userCredential.user, { displayName: name });
        const profileRef = doc(db, 'profiles', userCredential.user.uid);
        await updateDoc(profileRef, {
          name,
          phone: phone.replace(/\D/g, ''),
          avatar: userCredential.user.photoURL || 'https://lh3.googleusercontent.com/a/ACg8ocLZ8rJKU52yGWjkTzmsXB_5pIafCE5e147Wmo805EQlW0VRDw=s96-c',
        });
        await syncPublicProfile(userCredential.user.uid, {
          displayName: name,
          photoURL: userCredential.user.photoURL,
          isOnline: true,
        });
      }
      toast.success('Compte créé avec succès !');
      navigate('/dashboard');
    } catch (err: unknown) {
      toast.error("Erreur lors de la création du compte", { description: getErrorMessage(err as { code?: string; message?: string }), duration: 5000 });
    } finally { setIsLoading(false); }
  };

  const handleGoogleRegister = async () => {
    try {
      setIsLoading(true);
      await loginWithGoogle();
      toast.success('Inscription Google réussie !');
      navigate('/dashboard');
    } catch (err: unknown) {
      toast.error("Erreur lors de l'inscription avec Google", { description: getErrorMessage(err as { code?: string; message?: string }), duration: 5000 });
    } finally { setIsLoading(false); }
  };

  const strengthLevel = password.length === 0 ? 0 : password.length < 6 ? 1 : password.length < 10 ? 2 : password.length < 14 ? 3 : 4;
  const strengthColors = ['bg-border', 'bg-destructive', 'bg-warning', 'bg-primary', 'bg-success'];
  const strengthLabels = ['', 'Trop court', 'Faible', 'Correct', 'Fort'];

  return (
    <div className="landing-page min-h-screen bg-background text-foreground">

      {/* Header — identique à la Home */}
      <header className="sticky top-0 z-50 px-4 pt-4">
        <div className="mx-auto max-w-6xl rounded-2xl border border-border bg-background/80 px-3 py-2.5 shadow-sm backdrop-blur-xl">
          <div className="flex items-center justify-between gap-4">
            <Link to="/" className="flex items-center gap-3 pl-1">
              <MeetAppLogo />
              <div className="leading-none">
                <p className="text-base font-bold tracking-tight">MeetApp</p>
                <p className="mt-1 hidden text-[11px] uppercase tracking-[0.14em] text-muted-foreground sm:block">Visioconférence</p>
              </div>
            </Link>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                onClick={() => setIsDarkTheme(p => !p)}
                aria-label={isDarkTheme ? 'Thème clair' : 'Thème sombre'}
              >
                {isDarkTheme ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Link to="/login">
                <Button variant="ghost" className="rounded-full">Se connecter</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      <main className="px-4 pt-4 md:px-6 md:pt-6 pb-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid min-h-[78vh] lg:grid-cols-2 gap-4 items-stretch">

            {/* LEFT — Formulaire */}
            <div className="flex flex-col justify-center rounded-[2rem] border border-border bg-card px-8 py-10 shadow-sm md:px-12">
              <div className="mx-auto w-full max-w-sm space-y-6">

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Inscription</p>
                  <h1 className="text-3xl font-bold tracking-tight">Créer un compte</h1>
                  <p className="text-muted-foreground text-sm">Rejoignez MeetApp et collaborez sans limites.</p>
                </div>

                {/* Google */}
                <Button
                  variant="outline"
                  className="h-11 w-full rounded-full gap-2"
                  onClick={handleGoogleRegister}
                  disabled={isLoading}
                >
                  <GoogleIcon />
                  Continuer avec Google
                </Button>

                {/* Divider */}
                <div className="flex items-center gap-3">
                  <div className="flex-1 border-t border-border" />
                  <span className="text-xs font-medium uppercase tracking-widest text-muted-foreground">ou</span>
                  <div className="flex-1 border-t border-border" />
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                  {/* Nom + Téléphone */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label htmlFor="name" className="text-sm font-semibold">Nom complet</label>
                      <input
                        id="name"
                        type="text"
                        placeholder="Jean Dupont"
                        value={name}
                        onChange={e => setName(e.target.value)}
                        disabled={isLoading}
                        required
                        className="h-11 w-full rounded-xl border border-input bg-background px-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background transition-shadow"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label htmlFor="phone" className="text-sm font-semibold">Téléphone</label>
                      <div className="relative">
                        <input
                          id="phone"
                          type="tel"
                          placeholder="+33 6 00 00 00"
                          value={phone}
                          onChange={e => setPhone(e.target.value)}
                          disabled={isLoading}
                          required
                          className="h-11 w-full rounded-xl border border-input bg-background px-4 pr-10 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background transition-shadow"
                        />
                        {phone && (
                          <span className="absolute right-3 top-1/2 -translate-y-1/2">
                            {isPhoneValid
                              ? <Check className="h-4 w-4 text-success" />
                              : <X className="h-4 w-4 text-destructive" />}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Email */}
                  <div className="space-y-1.5">
                    <label htmlFor="email" className="text-sm font-semibold">Email</label>
                    <input
                      id="email"
                      type="email"
                      placeholder="vous@exemple.com"
                      value={email}
                      onChange={e => setEmail(e.target.value)}
                      disabled={isLoading}
                      required
                      className="h-11 w-full rounded-xl border border-input bg-background px-4 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background transition-shadow"
                    />
                  </div>

                  {/* Mot de passe */}
                  <div className="space-y-1.5">
                    <label htmlFor="password" className="text-sm font-semibold">Mot de passe</label>
                    <div className="relative">
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={e => setPassword(e.target.value)}
                        disabled={isLoading}
                        required
                        className="h-11 w-full rounded-xl border border-input bg-background px-4 pr-11 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background transition-shadow"
                      />
                      <button type="button" onClick={() => setShowPassword(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" disabled={isLoading}>
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {/* Barre de force */}
                    {password && (
                      <div className="space-y-1">
                        <div className="flex gap-1">
                          {[1, 2, 3, 4].map(i => (
                            <div key={i} className={`h-1 flex-1 rounded-full transition-all ${i <= strengthLevel ? strengthColors[strengthLevel] : 'bg-border'}`} />
                          ))}
                        </div>
                        <p className={`text-xs ${strengthLevel <= 1 ? 'text-destructive' : strengthLevel === 2 ? 'text-warning' : 'text-success'}`}>
                          {strengthLabels[strengthLevel]}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Confirmation */}
                  <div className="space-y-1.5">
                    <label htmlFor="confirmPassword" className="text-sm font-semibold">Confirmer le mot de passe</label>
                    <div className="relative">
                      <input
                        id="confirmPassword"
                        type={showConfirm ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={confirmPassword}
                        onChange={e => setConfirmPassword(e.target.value)}
                        disabled={isLoading}
                        required
                        className="h-11 w-full rounded-xl border border-input bg-background px-4 pr-11 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background transition-shadow"
                      />
                      <button type="button" onClick={() => setShowConfirm(p => !p)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors" disabled={isLoading}>
                        {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {confirmPassword && (
                      <p className={`text-xs flex items-center gap-1 ${isPasswordMatch ? 'text-success' : 'text-destructive'}`}>
                        {isPasswordMatch ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                        {isPasswordMatch ? 'Mots de passe identiques' : 'Ne correspondent pas'}
                      </p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="h-11 w-full rounded-full font-semibold"
                    disabled={isLoading || !isPasswordValid || !isPasswordMatch || !isPhoneValid}
                  >
                    {isLoading
                      ? <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                      : <><span>Créer mon compte</span><ArrowRight className="ml-2 h-4 w-4" /></>
                    }
                  </Button>
                </form>

                <div className="space-y-3 text-center">
                  <p className="text-sm text-muted-foreground">
                    Déjà un compte ?{' '}
                    <Link to="/login" className="font-semibold text-primary underline-offset-4 hover:underline">
                      Se connecter
                    </Link>
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    En créant un compte, vous acceptez nos{' '}
                    <button className="underline hover:text-foreground transition-colors">Conditions</button>
                    {' '}et{' '}
                    <button className="underline hover:text-foreground transition-colors">Politique de confidentialité</button>
                  </p>
                </div>
              </div>
            </div>

            {/* RIGHT — Panneau visuel (inversé par rapport au Login) */}
            <div className="relative hidden lg:flex flex-col justify-between overflow-hidden rounded-[2rem] bg-neutral-950 p-12 text-white shadow-2xl">
              <div className="absolute inset-0 bg-gradient-to-bl from-primary/20 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
              <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />

              {/* Badge */}
              <div className="relative">
                <span className="liquid-glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
                  Inscription gratuite
                </span>
              </div>

              {/* Titre */}
              <div className="relative space-y-6">
                <h2 className="text-4xl font-extrabold leading-[0.98] tracking-[-0.035em] lg:text-5xl xl:text-6xl">
                  Commencez<br />
                  <span className="text-primary">en 30 secondes.</span>
                </h2>
                <p className="max-w-sm text-base leading-relaxed text-white/70">
                  Créez votre compte MeetApp et lancez votre première réunion sans rien installer.
                </p>

                {/* Checklist — même style que la section aperçu de la Home */}
                <ul className="space-y-3">
                  {checklist.map(({ icon: Icon, text }) => (
                    <li key={text} className="flex items-center gap-3 text-sm font-medium">
                      <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/20 text-primary shrink-0">
                        <Icon className="h-3.5 w-3.5" />
                      </span>
                      {text}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Bottom indicator */}
              <div className="relative">
                <div className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm">
                  <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
                  <span className="text-sm font-medium">Plateforme disponible 24h/24</span>
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
};

export default Register;
