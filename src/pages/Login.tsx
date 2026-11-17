import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, ArrowRight, Moon, Sun, Shield, Zap, Video } from 'lucide-react';
import { loginUser, loginWithGoogle } from '../services/authService';
import { toast } from 'sonner';
import MeetAppLogo from '@/components/MeetAppLogo';

const getErrorMessage = (error: { code?: string; message?: string }) => {
  switch (error.code) {
    case 'auth/user-not-found': return 'Email non trouvé';
    case 'auth/wrong-password': return 'Mot de passe incorrect';
    case 'auth/invalid-email': return "Format d'email invalide";
    case 'auth/user-disabled': return 'Ce compte a été désactivé';
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

const highlights = [
  { icon: Video, label: 'Qualité vidéo HD' },
  { icon: Shield, label: 'Chiffrement de bout en bout' },
  { icon: Zap, label: 'Sans installation' },
];

const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const requestedLocation = (
    location.state as {
      from?: { pathname?: string; search?: string; hash?: string };
    } | null
  )?.from;
  const redirectTo =
    requestedLocation?.pathname?.startsWith('/') && !requestedLocation.pathname.startsWith('//')
      ? `${requestedLocation.pathname}${requestedLocation.search || ''}${requestedLocation.hash || ''}`
      : '/dashboard';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
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

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) { toast.error('Veuillez entrer votre email et mot de passe'); return; }
    try {
      setIsLoading(true);
      await loginUser(email, password);
      toast.success('Connexion réussie !');
      navigate(redirectTo, { replace: true });
    } catch (err: unknown) {
      toast.error('Erreur de connexion', { description: getErrorMessage(err as { code?: string; message?: string }), duration: 5000 });
    } finally { setIsLoading(false); }
  };

  const handleGoogleLogin = async () => {
    try {
      setIsLoading(true);
      await loginWithGoogle();
      toast.success('Connexion Google réussie !');
      navigate(redirectTo, { replace: true });
    } catch (err: unknown) {
      toast.error('Erreur de connexion Google', { description: getErrorMessage(err as { code?: string; message?: string }), duration: 5000 });
    } finally { setIsLoading(false); }
  };

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
              <Link to="/register">
                <Button variant="ghost" className="rounded-full">Créer un compte</Button>
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Main — split layout dans le même conteneur que la Home */}
      <main className="px-4 pt-4 md:px-6 md:pt-6 pb-24">
        <div className="mx-auto max-w-6xl">
          <div className="grid min-h-[78vh] lg:grid-cols-2 gap-4 items-stretch">

            {/* LEFT — Panneau visuel (même style que le hero de la Home) */}
            <div className="relative flex flex-col justify-between overflow-hidden rounded-[2rem] bg-neutral-950 p-8 text-white shadow-2xl md:p-12 order-2 lg:order-1">
              {/* Même overlay gradient que le hero */}
              <div className="absolute inset-0 bg-gradient-to-br from-primary/20 via-transparent to-transparent" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/20" />
              {/* Dot pattern */}
              <div className="absolute inset-0 opacity-[0.07]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '28px 28px' }} />

              {/* Badge — même style que le hero */}
              <div className="relative">
                <span className="liquid-glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                  Vos réunions vous attendent
                </span>
              </div>

              {/* Titre massif */}
              <div className="relative space-y-6">
                <h2 className="text-4xl font-extrabold leading-[0.98] tracking-[-0.035em] md:text-5xl lg:text-6xl">
                  Bon retour<br />
                  <span className="text-primary">parmi nous.</span>
                </h2>
                <p className="max-w-sm text-base leading-relaxed text-white/70">
                  Retrouvez vos contacts, vos réunions planifiées et vos échanges dans un espace unique et sécurisé.
                </p>

                {/* Highlights — même style que le hero */}
                <div className="grid grid-cols-1 divide-y divide-white/15 overflow-hidden rounded-2xl liquid-glass sm:grid-cols-3 sm:divide-x sm:divide-y-0 max-w-lg">
                  {highlights.map(({ icon: Icon, label }) => (
                    <div key={label} className="flex items-center gap-3 px-5 py-4 text-sm font-medium">
                      <Icon className="h-4 w-4 shrink-0 text-primary" />
                      {label}
                    </div>
                  ))}
                </div>
              </div>

              {/* Avatars flottants */}
              <div className="relative">
                <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-sm">
                  <div className="flex -space-x-2">
                    {['C', 'L', 'A', 'M'].map((l, i) => (
                      <div key={i} className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-neutral-950 bg-primary text-xs font-bold text-primary-foreground">
                        {l}
                      </div>
                    ))}
                  </div>
                  <div className="text-sm">
                    <p className="font-medium">+2 400 équipes actives</p>
                    <p className="text-white/50 text-xs">font confiance à MeetApp</p>
                  </div>
                </div>
              </div>
            </div>

            {/* RIGHT — Formulaire */}
            <div className="flex flex-col justify-center rounded-[2rem] border border-border bg-card px-8 py-10 shadow-sm md:px-12 order-1 lg:order-2">
              <div className="mx-auto w-full max-w-sm space-y-7">

                <div className="space-y-1">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">Connexion</p>
                  <h1 className="text-3xl font-bold tracking-tight">Se connecter</h1>
                  <p className="text-muted-foreground text-sm">Accédez à votre espace MeetApp.</p>
                </div>

                {/* Google */}
                <Button
                  variant="outline"
                  className="h-11 w-full rounded-full gap-2"
                  onClick={handleGoogleLogin}
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

                {/* Form */}
                <form onSubmit={handleLogin} className="space-y-4">
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
                      <button
                        type="button"
                        onClick={() => setShowPassword(p => !p)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                        disabled={isLoading}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>

                  <Button type="submit" className="h-11 w-full rounded-full font-semibold" disabled={isLoading}>
                    {isLoading
                      ? <span className="h-4 w-4 rounded-full border-2 border-primary-foreground/30 border-t-primary-foreground animate-spin" />
                      : <><span>Se connecter</span><ArrowRight className="ml-2 h-4 w-4" /></>
                    }
                  </Button>
                </form>

                {/* Footer */}
                <div className="space-y-3 text-center">
                  <p className="text-sm text-muted-foreground">
                    Pas encore de compte ?{' '}
                    <Link to="/register" className="font-semibold text-primary underline-offset-4 hover:underline">
                      Créer un compte
                    </Link>
                  </p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    En continuant, vous acceptez nos{' '}
                    <button className="underline hover:text-foreground transition-colors">Conditions</button>
                    {' '}et{' '}
                    <button className="underline hover:text-foreground transition-colors">Politique de confidentialité</button>
                  </p>
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
};

export default Login;
