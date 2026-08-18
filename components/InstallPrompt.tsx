'use client';

import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Download, Share, X } from 'lucide-react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'chores_install_dismissed';

function isStandalone() {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos() {
  if (typeof navigator === 'undefined') return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

const noopSubscribe = () => () => {};

export function InstallPrompt() {
  const [promptEvent, setPromptEvent] = useState<BeforeInstallPromptEvent | null>(null);
  const [hidden, setHidden] = useState(false);

  // iOS never fires beforeinstallprompt, so offer manual instructions instead.
  // Read after hydration so server and client markup agree.
  const showIosHint = useSyncExternalStore(
    noopSubscribe,
    () => isIos() && !isStandalone() && localStorage.getItem(DISMISS_KEY) !== '1',
    () => false
  );

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const register = () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.error('[pwa] service worker registration failed:', err);
      });
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }, []);

  useEffect(() => {
    if (isStandalone()) return;
    if (localStorage.getItem(DISMISS_KEY) === '1') return;

    const onBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    const onInstalled = () => {
      setPromptEvent(null);
      setHidden(true);
    };
    window.addEventListener('appinstalled', onInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const dismiss = () => {
    setHidden(true);
    localStorage.setItem(DISMISS_KEY, '1');
  };

  const install = async () => {
    if (!promptEvent) return;
    await promptEvent.prompt();
    const choice = await promptEvent.userChoice;
    setPromptEvent(null);
    if (choice.outcome === 'accepted') setHidden(true);
  };

  const visible = !hidden && (promptEvent !== null || showIosHint);
  if (!visible) return null;

  return (
    <div className="fixed bottom-24 left-0 right-0 z-30 px-4 pointer-events-none">
      <div className="max-w-md mx-auto bg-white border border-[#E6E0D4] shadow-lg rounded-3xl p-4 flex items-center gap-3 pointer-events-auto">
        <div className="w-11 h-11 rounded-2xl bg-[#A1C181]/15 flex items-center justify-center flex-shrink-0">
          <Download className="w-5 h-5 text-[#6B5E4C]" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="font-bold text-[#3D3732] text-sm">התקנת האפליקציה</p>
          {promptEvent ? (
            <p className="text-xs text-[#8C7E6A]">הוסיפו את תורנויות הבית למסך הבית לגישה מהירה.</p>
          ) : (
            <p className="text-xs text-[#8C7E6A] flex items-center gap-1 flex-wrap">
              פתחו את
              <Share className="w-3 h-3 inline" />
              שיתוף ובחרו &quot;הוסף למסך הבית&quot;
            </p>
          )}
        </div>

        {promptEvent && (
          <button
            onClick={install}
            className="flex-shrink-0 px-4 py-2 bg-[#A1C181] text-white text-sm font-bold rounded-xl shadow-sm hover:bg-[#8eab72] transition-colors"
          >
            התקן
          </button>
        )}

        <button
          onClick={dismiss}
          aria-label="סגור"
          className="flex-shrink-0 p-2 text-[#8C7E6A] hover:bg-[#F5F1EA] rounded-full transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}
