import { useAuth } from '@/context/AuthContext';
import { usePWA } from '@/context/PWAContext';
import { useIncomingCall } from '@/context/IncomingCallContext';
import { Button } from '@/components/ui/button';
import { X, Download, LogIn, PhoneCall, PhoneOff, ArrowRight } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useState } from 'react';

export const GlobalPrompts = () => {
  const { user, loading } = useAuth();
  const { showInstallPrompt, dismissInstallPrompt, installApp } = usePWA();
  const { currentInvitation, currentCaller, acceptIncomingCall, declineIncomingCall, pendingInvitationsCount } = useIncomingCall();
  const { pathname } = useLocation();
  const [dismissedGooglePrompt, setDismissedGooglePrompt] = useState(false);
  const showSignInPrompt =
    !user &&
    !dismissedGooglePrompt &&
    pathname !== '/login' &&
    pathname !== '/register';

  // Don't show anything while loading
  if (loading) return null;

  return (
    <>
      {/* PWA Install Prompt */}
      {showInstallPrompt && (
        <div className="fixed bottom-4 right-4 z-[9999] animate-in slide-in-from-bottom-5 fade-in duration-300">
          <div className="bg-card border border-primary/20 rounded-xl shadow-xl p-3 flex items-center gap-3 max-w-xs hover:shadow-2xl transition-shadow">
            <div className="flex-shrink-0 h-10 w-10 bg-primary/10 rounded-lg flex items-center justify-center">
              <Download className="h-5 w-5 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-sm text-foreground">Installer l'app</h3>
              <p className="text-xs text-muted-foreground">Accès rapide et hors ligne</p>
            </div>
            <div className="flex gap-1 flex-shrink-0">
              <button
                onClick={installApp}
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors"
                title="Installer"
              >
                <Download className="h-4 w-4" />
              </button>
              <button
                onClick={dismissInstallPrompt}
                className="inline-flex items-center justify-center h-8 w-8 rounded-lg hover:bg-muted transition-colors text-muted-foreground hover:text-foreground"
                title="Fermer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      )}

      {!loading && showSignInPrompt && (
        <div className="fixed bottom-4 left-4 right-4 z-[9998] mx-auto max-w-sm animate-in slide-in-from-bottom-5 fade-in duration-300 sm:left-auto sm:right-6 sm:mx-0">
          <section aria-label="Connexion" className="dashboard-card rounded-[1.5rem] p-4 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="dashboard-stat-icon dashboard-tone-lavender flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl">
                <LogIn className="h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <h3 className="font-semibold text-foreground">Retrouvez votre espace</h3>
                <p className="mt-1 text-sm leading-5 text-muted-foreground">
                  Connectez-vous pour accéder à vos contacts et réunions.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setDismissedGooglePrompt(true)}
                aria-label="Fermer la notification de connexion"
                className="-mr-2 -mt-2 shrink-0 rounded-full text-muted-foreground"
              >
                <X aria-hidden="true" />
              </Button>
            </div>
            <Button
              asChild
              size="sm"
              className="mt-4 h-10 w-full rounded-full bg-[#c5ef83] font-semibold text-[#263512] hover:bg-[#b3e986] dark:bg-[#9acb59] dark:hover:bg-[#aad36c]"
            >
              <Link to="/login">
                Se connecter
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </Button>
          </section>
        </div>
      )}

      {user && currentInvitation && (
        <div className="fixed bottom-4 left-4 right-4 z-[9999] mx-auto max-w-sm animate-in slide-in-from-bottom-5 fade-in duration-300 sm:left-auto sm:right-6 sm:mx-0">
          <section
            role="status"
            aria-live="assertive"
            aria-label="Appel entrant"
            className="dashboard-card rounded-[1.6rem] p-4 shadow-2xl sm:p-5"
          >
            <div className="flex items-start gap-3">
              <div className="relative flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border border-[#84a93a]/20 bg-[#eff8d9] text-[#4d6e16] dark:border-[#84a93a]/25 dark:bg-[#28351c] dark:text-[#c5ef83]">
                <span className="absolute inset-0 animate-ping rounded-2xl bg-[#c5ef83]/30" />
                <PhoneCall className="relative h-5 w-5" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1 pt-0.5">
                <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Appel entrant</p>
                <h3 className="mt-1 truncate font-semibold text-foreground">
                  {currentCaller?.displayName || currentCaller?.name || 'Un utilisateur vous appelle'}
                </h3>
                {pendingInvitationsCount > 1 && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    +{pendingInvitationsCount - 1} autre{pendingInvitationsCount - 1 > 1 ? 's' : ''} appel{pendingInvitationsCount - 1 > 1 ? 's' : ''}
                  </p>
                )}
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => declineIncomingCall(currentInvitation)}
                className="h-10 flex-1 rounded-full border-destructive/25 text-destructive hover:bg-destructive/10 hover:text-destructive"
              >
                <PhoneOff aria-hidden="true" />
                Refuser
              </Button>
              <Button
                size="sm"
                onClick={() => acceptIncomingCall(currentInvitation)}
                className="h-10 flex-1 rounded-full bg-[#c5ef83] font-semibold text-[#263512] hover:bg-[#b3e986] dark:bg-[#9acb59] dark:hover:bg-[#aad36c]"
              >
                <PhoneCall aria-hidden="true" />
                Rejoindre
              </Button>
            </div>
          </section>
        </div>
      )}

    </>
  );
};
