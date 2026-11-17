import { Link } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Video, Users, Shield, Zap, ArrowRight, Moon, Sun, Mic, MicOff, Monitor, MessageSquare, PhoneOff, Check } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { useAuth } from "../context/AuthContext";
import MeetAppLogo from '@/components/MeetAppLogo';

const BACKGROUND_VIDEO_URL = "https://www.pexels.com/fr-fr/download/video/19549330/";
const HERO_POSTER_URL = "https://images.pexels.com/photos/3184307/pexels-photo-3184307.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2";
const ABOUT_IMAGE_URL = "https://images.pexels.com/photos/3184405/pexels-photo-3184405.jpeg?auto=compress&cs=tinysrgb&w=1260&h=750&dpr=2";

const navLinks = [
  { href: '#apercu', label: 'Aperçu' },
  { href: '#about', label: 'À propos' },
  { href: '#features', label: 'Fonctionnalités' },
  { href: '#faq', label: 'FAQ' },
];

const features: { icon: LucideIcon; title: string; description: string }[] = [
  { icon: Video, title: 'Visioconférence HD', description: 'Qualité vidéo et audio exceptionnelle pour vos réunions professionnelles.' },
  { icon: Users, title: 'Collaboration simple', description: 'Invitez facilement vos contacts et gérez les rôles de chacun.' },
  { icon: Shield, title: 'Sécurisé', description: 'Vos données et conversations sont protégées et cryptées.' },
  { icon: Zap, title: 'Ultra rapide', description: 'Lancez une réunion en quelques secondes, sans installation.' },
];

const heroHighlights: { icon: LucideIcon; label: string }[] = [
  { icon: Video, label: 'Qualité vidéo HD' },
  { icon: Shield, label: 'Chiffrement de bout en bout' },
  { icon: Zap, label: 'Sans installation' },
];

const meetingHighlights = [
  'Vidéo HD et audio clair',
  "Micro, caméra et sortie d'appel à portée de main",
  'Aucune installation requise',
];

const faqItems = [
  {
    question: "Qu'est-ce que MeetApp ?",
    answer: "MeetApp est une plateforme de visioconférence et de collaboration qui permet aux équipes de se connecter facilement, d'organiser des réunions HD sécurisées et de gérer leurs contacts en temps réel.",
  },
  {
    question: 'Comment puis-je créer un compte ?',
    answer: 'Vous pouvez créer un compte gratuitement en cliquant sur le bouton "Créer un compte" dans l\'en-tête ou la section principale. L\'inscription se fait par email/mot de passe ou via Google.',
  },
  {
    question: 'MeetApp est-il gratuit ?',
    answer: 'Oui, MeetApp propose une version gratuite avec des fonctionnalités de base. Des plans payants avec des fonctionnalités avancées pour les équipes et les entreprises seront disponibles prochainement.',
  },
  {
    question: 'Comment la sécurité de mes données est-elle assurée ?',
    answer: 'MeetApp utilise le cryptage de bout en bout pour toutes les communications et stocke vos données sur des serveurs sécurisés. Nous nous engageons à protéger votre vie privée et la confidentialité de vos échanges.',
  },
  {
    question: 'Puis-je inviter des personnes qui ne sont pas inscrites sur MeetApp ?',
    answer: "Oui, lorsque vous ajoutez un contact, si son email n'existe pas dans notre système, vous avez la possibilité de lui envoyer un lien d'invitation par email pour qu'il puisse rejoindre MeetApp et devenir l'un de vos contacts.",
  },
];

const SectionEyebrow = ({ children }: { children: string }) => (
  <p className="mb-4 text-xs font-semibold uppercase tracking-[0.18em] text-primary">{children}</p>
);

const ParticipantLabel = ({ name, muted = false }: { name: string; muted?: boolean }) => (
  <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
    {muted ? <MicOff className="h-3 w-3 text-red-400" /> : <Mic className="h-3 w-3 text-emerald-400" />}
    {name}
  </div>
);

const ParticipantTile = ({ name, initials, muted = false }: { name: string; initials: string; muted?: boolean }) => (
  <div className="relative flex items-center justify-center overflow-hidden rounded-2xl bg-white/[0.06]">
    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary text-sm font-bold text-primary-foreground">
      {initials}
    </span>
    <ParticipantLabel name={name} muted={muted} />
  </div>
);

const ControlButton = ({ icon: Icon, danger = false }: { icon: LucideIcon; danger?: boolean }) => (
  <span className={`flex h-10 w-10 items-center justify-center rounded-full ${danger ? 'bg-red-500' : 'bg-white/10'}`}>
    <Icon className="h-4 w-4" />
  </span>
);

const MeetingPreview = () => (
  <div aria-hidden="true" className="rounded-[1.75rem] border border-border bg-neutral-950 p-3 text-white shadow-2xl">
    <div className="flex items-center justify-between px-2 pb-3 pt-1 text-xs">
      <span className="flex items-center gap-2 font-medium">
        <span className="h-2 w-2 rounded-full bg-emerald-400" />
        Réunion produit
      </span>
      <span className="font-mono text-white/50">03:12 · 3 participants</span>
    </div>
    <div className="grid aspect-[16/10] grid-cols-3 grid-rows-2 gap-2">
      <div className="relative col-span-2 row-span-2 overflow-hidden rounded-2xl">
        <img src={ABOUT_IMAGE_URL} alt="" className="h-full w-full object-cover" />
        <ParticipantLabel name="Camille Martin" />
      </div>
      <ParticipantTile name="Lucas Tessier" initials="LT" />
      <ParticipantTile name="Amina Diallo" initials="AD" muted />
    </div>
    <div className="mt-3 flex items-center justify-center gap-3">
      <ControlButton icon={Mic} />
      <ControlButton icon={Video} />
      <ControlButton icon={Monitor} />
      <ControlButton icon={MessageSquare} />
      <ControlButton icon={PhoneOff} danger />
    </div>
  </div>
);

const Home = () => {
  const { user, loading } = useAuth();
  const [isDarkTheme, setIsDarkTheme] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    const stored = window.localStorage.getItem('theme');
    if (stored === 'dark') return true;
    if (stored === 'light') return false;
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

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

  if (loading) {
    return <div className="flex justify-center items-center min-h-screen text-lg">Chargement...</div>;
  }

  return (
    <div className="landing-page min-h-screen bg-background text-foreground">
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

            <nav className="hidden items-center gap-1 rounded-full bg-muted/60 p-1 lg:flex">
              {navLinks.map((link) => (
                <a
                  key={link.href}
                  href={link.href}
                  className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground hover:shadow-sm"
                >
                  {link.label}
                </a>
              ))}
              <a
                href="mailto:nepturnelangojordan@mail.com"
                className="rounded-full px-4 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-background hover:text-foreground hover:shadow-sm"
              >
                Contact
              </a>
            </nav>

            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="rounded-full"
                aria-label={isDarkTheme ? 'Passer au thème clair' : 'Passer au thème sombre'}
                onClick={() => setIsDarkTheme((prev) => !prev)}
              >
                {isDarkTheme ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              {user ? (
                <Link to="/dashboard">
                  <Button className="rounded-full">Tableau de bord</Button>
                </Link>
              ) : (
                <>
                  <Link to="/login" className="hidden sm:block">
                    <Button variant="ghost" className="rounded-full">Se connecter</Button>
                  </Link>
                  <Link to="/register">
                    <Button className="rounded-full">Créer un compte</Button>
                  </Link>
                </>
              )}
            </div>
          </div>

          <nav className="mt-2 flex gap-1 overflow-x-auto border-t border-border pt-2 text-sm lg:hidden">
            {navLinks.map((link) => (
              <a key={link.href} href={link.href} className="shrink-0 rounded-full px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
                {link.label}
              </a>
            ))}
            <a href="mailto:nepturnelangojordan@mail.com" className="shrink-0 rounded-full px-3 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground">
              Contact
            </a>
          </nav>
        </div>
      </header>

      <section className="px-4 pt-4 md:px-6 md:pt-6">
        <div className="relative mx-auto flex h-[78vh] min-h-[660px] max-h-[860px] max-w-6xl flex-col justify-between overflow-hidden rounded-[2rem] bg-neutral-950 p-6 text-white shadow-2xl md:min-h-[600px] md:p-12">
          <video
            className="absolute inset-0 h-full w-full object-cover"
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            poster={HERO_POSTER_URL}
            aria-hidden="true"
          >
            <source src={BACKGROUND_VIDEO_URL} type="video/mp4" />
          </video>
          <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/50 to-black/20" />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/30" />

          <div className="relative">
            <span className="liquid-glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-white">
              <span className="h-1.5 w-1.5 rounded-full bg-primary" />
              {user ? 'Espace personnel' : 'Visioconférence HD pour les équipes'}
            </span>
          </div>

          <div className="relative max-w-3xl">
            <h1 className="text-5xl font-extrabold leading-[0.98] tracking-[-0.035em] sm:text-6xl lg:text-7xl">
              {user ? (
                <>Bienvenue,<br /><span className="text-primary">{user.displayName || user.email}</span></>
              ) : (
                <>Vos réunions,<br /><span className="text-primary">sans friction.</span></>
              )}
            </h1>
            <p className="mt-6 max-w-xl text-base leading-relaxed text-white/75 md:text-lg">
              {user
                ? 'Vous êtes connecté. Accédez à votre tableau de bord pour gérer vos contacts et réunions en toute simplicité.'
                : 'Organisez des réunions vidéo professionnelles en quelques clics. Simple, rapide et efficace.'}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {user ? (
                <Link to="/dashboard">
                  <Button size="lg" className="h-12 rounded-full px-7">
                    Accéder au tableau de bord
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Button>
                </Link>
              ) : (
                <>
                  <Link to="/register">
                    <Button size="lg" className="h-12 rounded-full px-7">
                      Commencer gratuitement
                      <ArrowRight className="ml-2 h-4 w-4" />
                    </Button>
                  </Link>
                  <Link to="/login">
                    <Button size="lg" variant="outline" className="h-12 rounded-full border-white/25 bg-white/10 px-7 text-white backdrop-blur-md hover:bg-white/20 hover:text-white">
                      Se connecter
                    </Button>
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="relative mt-10 grid max-w-3xl grid-cols-1 divide-y divide-white/15 overflow-hidden rounded-2xl liquid-glass sm:grid-cols-3 sm:divide-x sm:divide-y-0">
            {heroHighlights.map((item) => (
              <div key={item.label} className="flex items-center gap-3 px-5 py-4 text-sm font-medium">
                <item.icon className="h-4 w-4 shrink-0 text-primary" />
                {item.label}
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="apercu" className="px-6 pt-24 md:pt-32">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionEyebrow>Aperçu</SectionEyebrow>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Une salle de réunion, directement dans votre navigateur.</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Participants, micro, caméra et partage d'écran réunis dans une seule fenêtre claire.
            </p>
            <ul className="mt-8 space-y-3">
              {meetingHighlights.map((item) => (
                <li key={item} className="flex items-center gap-3 text-sm font-medium">
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-primary/15 text-primary">
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  {item}
                </li>
              ))}
            </ul>
          </div>
          <div className="lg:col-span-7">
            <MeetingPreview />
          </div>
        </div>
      </section>

      <section id="features" className="px-6 py-24 md:py-32">
        <div className="mx-auto grid max-w-6xl gap-14 lg:grid-cols-12">
          <div className="lg:col-span-4">
            <SectionEyebrow>Fonctionnalités</SectionEyebrow>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Pourquoi choisir MeetApp ?</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Quatre atouts pour des réunions claires, sécurisées et prêtes en quelques secondes.
            </p>
          </div>
          <ol className="divide-y divide-border border-y border-border lg:col-span-8">
            {features.map((feature, index) => (
              <li key={feature.title} className="grid grid-cols-[auto_1fr] gap-6 py-8 md:grid-cols-[auto_1fr_auto]">
                <span className="pt-1 font-mono text-sm text-muted-foreground">0{index + 1}</span>
                <div>
                  <h3 className="text-xl font-semibold">{feature.title}</h3>
                  <p className="mt-2 leading-relaxed text-muted-foreground">{feature.description}</p>
                </div>
                <feature.icon className="hidden h-6 w-6 text-primary md:block" />
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section id="about" className="border-t border-border px-6 py-24 md:py-32">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-2">
          <img
            src={ABOUT_IMAGE_URL}
            alt="Équipe en réunion"
            className="aspect-[4/5] w-full rounded-[2rem] object-cover md:aspect-[5/4]"
          />
          <div className="space-y-6">
            <SectionEyebrow>À propos</SectionEyebrow>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">À propos de MeetApp</h2>
            <p className="leading-relaxed text-muted-foreground">
              MeetApp est né d'une vision simple : rendre la communication d'équipe fluide, sécurisée et accessible à tous. Nous croyons que les meilleures idées émergent d'une collaboration sans friction, et c'est ce que notre plateforme s'efforce d'offrir.
            </p>
            <p className="leading-relaxed text-muted-foreground">
              De la visioconférence HD à la gestion intuitive des contacts et à la présence en temps réel, MeetApp est conçu pour dynamiser votre productivité et renforcer les liens au sein de vos équipes, où que vous soyez.
            </p>
            <Link to="/register">
              <Button size="lg" variant="outline" className="h-12 rounded-full px-7">
                Rejoindre MeetApp
                <ArrowRight className="ml-2 h-4 w-4" />
              </Button>
            </Link>
          </div>
        </div>
      </section>

      <section id="faq" className="border-t border-border px-6 py-24 md:py-32">
        <div className="mx-auto grid max-w-6xl gap-12 lg:grid-cols-12">
          <div className="lg:col-span-5">
            <SectionEyebrow>FAQ</SectionEyebrow>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Questions fréquentes</h2>
            <p className="mt-4 leading-relaxed text-muted-foreground">
              Une autre question ? Écrivez-nous à{' '}
              <a href="mailto:nepturnelangojordan@mail.com" className="font-medium text-foreground underline underline-offset-4 hover:text-primary">
                nepturnelangojordan@mail.com
              </a>.
            </p>
          </div>
          <div className="lg:col-span-7">
            <Accordion type="single" collapsible className="w-full">
              {faqItems.map((item, index) => (
                <AccordionItem key={item.question} value={`item-${index + 1}`} className="border-border">
                  <AccordionTrigger className="py-5 text-left text-base font-semibold hover:no-underline">
                    {item.question}
                  </AccordionTrigger>
                  <AccordionContent className="pb-5 leading-relaxed text-muted-foreground">
                    {item.answer}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          </div>
        </div>
      </section>

      <section id="contact" className="px-4 pb-24 md:px-6 md:pb-32">
        <div className="mx-auto grid max-w-6xl gap-8 rounded-[2rem] bg-foreground px-8 py-14 text-background md:grid-cols-[1fr_auto] md:items-center md:px-14">
          <div>
            <h2 className="text-3xl font-bold tracking-tight md:text-4xl">Prêt à transformer vos réunions ?</h2>
            <p className="mt-4 max-w-xl leading-relaxed opacity-70">
              Rejoignez des milliers d'entreprises qui font confiance à MeetApp et découvrez une nouvelle façon de collaborer.
            </p>
          </div>
          <Link to="/register">
            <Button size="lg" className="h-12 rounded-full bg-primary px-8 font-semibold text-primary-foreground hover:bg-primary/90">
              Créer un compte gratuitement
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-14">
        <div className="mx-auto grid max-w-6xl gap-10 text-sm md:grid-cols-12">
          <div className="space-y-4 md:col-span-5">
            <div className="flex items-center gap-3">
              <MeetAppLogo />
              <span className="text-lg font-bold tracking-tight">MeetApp</span>
            </div>
            <p className="max-w-sm leading-relaxed text-muted-foreground">Votre partenaire pour des communications fluides et sécurisées.</p>
          </div>

          <div className="md:col-span-3">
            <h4 className="font-semibold">Navigation</h4>
            <ul className="mt-4 space-y-2 text-muted-foreground">
              {navLinks.map((link) => (
                <li key={link.href}><a href={link.href} className="transition-colors hover:text-foreground">{link.label}</a></li>
              ))}
            </ul>
          </div>

          <div className="md:col-span-4">
            <h4 className="font-semibold">Contact</h4>
            <ul className="mt-4 space-y-2 text-muted-foreground">
              <li><a href="mailto:nepturnelangojordan@mail.com" className="transition-colors hover:text-foreground">nepturnelangojordan@mail.com</a></li>
              <li>+1 234 567 890 (Exemple)</li>
              <li>123 Rue de l'Innovation, Ville, Pays (Exemple)</li>
            </ul>
          </div>
        </div>

        <div className="mx-auto mt-12 max-w-6xl border-t border-border pt-6 text-xs text-muted-foreground">
          &copy; {new Date().getFullYear()} MeetApp. Tous droits réservés.
        </div>
      </footer>
    </div>
  );
};

export default Home;
