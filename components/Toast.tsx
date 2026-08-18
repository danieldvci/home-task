'use client';

import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

type ToastType = 'error' | 'success' | 'info';
type ToastItem = { id: number; message: string; type: ToastType };

type ToastContextValue = {
  showToast: (message: string, type?: ToastType) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

const ICONS: Record<ToastType, React.ReactNode> = {
  error: <AlertCircle className="w-4 h-4 flex-shrink-0" />,
  success: <CheckCircle2 className="w-4 h-4 flex-shrink-0" />,
  info: <Info className="w-4 h-4 flex-shrink-0" />
};

const STYLES: Record<ToastType, string> = {
  error: 'bg-rose-50 border-rose-200 text-rose-700',
  success: 'bg-[#A1C181]/10 border-[#A1C181]/40 text-[#3D3732]',
  info: 'bg-white border-[#E6E0D4] text-[#3D3732]'
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const showToast = useCallback((message: string, type: ToastType = 'error') => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 left-0 right-0 z-[100] flex flex-col items-center gap-2 px-4 pointer-events-none">
        <AnimatePresence>
          {toasts.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              className={`pointer-events-auto max-w-sm w-full text-sm font-medium px-4 py-3 rounded-2xl shadow-lg border flex items-center gap-2 ${STYLES[t.type]}`}
            >
              {ICONS[t.type]}
              <span className="flex-1">{t.message}</span>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}
