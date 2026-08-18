'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, X, ImagePlus, Repeat, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Avatar } from './Avatar';
import { compressImage } from '../lib/image';
import { validateProofFile } from '../lib/storage-upload';

type Props = {
  choreName: string;
  busy?: boolean;
  onConfirm: (photo: Blob | null) => void;
  onCancel: () => void;
};

export function DoneConfirmModal({ choreName, busy, onConfirm, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photo, setPhoto] = useState<Blob | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onPick = async (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setError(null);
    setPhoto(null);
    if (!f) {
      setPreview(null);
      return;
    }
    const validationError = validateProofFile(f);
    if (validationError) {
      setPreview(null);
      setError(validationError);
      return;
    }
    setPreview(URL.createObjectURL(f));
    setProcessing(true);
    try {
      const compressed = await compressImage(f);
      setPhoto(compressed);
    } catch (err) {
      console.error(err);
      setError('עיבוד התמונה נכשל. אפשר לאשר בלי תמונה.');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-3xl border border-[#E6E0D4] shadow-xl p-5 flex flex-col gap-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-[#3D3732]">סיימת את המשימה?</h3>
            <p className="text-sm text-[#8C7E6A] mt-1">{choreName}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="p-2 text-[#8C7E6A] hover:bg-[#F5F1EA] rounded-full"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-[#6B5E4C]">אפשר לצרף תמונה כהוכחה (מומלץ). אפשר גם לאשר בלי תמונה.</p>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0] || null;
            e.target.value = '';
            onPick(f);
          }}
        />

        {preview ? (
          <div className="relative rounded-2xl overflow-hidden border border-[#E6E0D4] bg-[#FAF9F6]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="תצוגה מקדימה" className="w-full max-h-56 object-cover" />
            {processing && (
              <div className="absolute inset-0 flex items-center justify-center gap-2 bg-black/40 text-white text-sm font-medium">
                <Loader2 className="w-4 h-4 animate-spin" />
                מעבד תמונה...
              </div>
            )}
            <button
              type="button"
              onClick={() => onPick(null)}
              className="absolute top-2 left-2 bg-white/90 text-[#8C7E6A] p-2 rounded-full shadow-sm"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="flex flex-col items-center justify-center gap-2 py-8 rounded-2xl border border-dashed border-[#DED8CE] bg-[#FAF9F6] text-[#8C7E6A] hover:bg-[#F3EFE9]"
          >
            <Camera className="w-8 h-8" />
            <span className="font-medium text-sm">צלם או בחר תמונה</span>
          </button>
        )}

        {error && <p className="text-sm text-rose-500">{error}</p>}

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy || processing}
            onClick={() => onConfirm(photo)}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#A1C181] text-white rounded-2xl font-bold shadow-sm hover:bg-[#8eab72] disabled:opacity-60"
          >
            <CheckCircle2 className="w-5 h-5" />
            {busy ? 'שומר...' : processing ? 'מעבד תמונה...' : photo ? 'אשר עם תמונה' : 'אשר ביצוע'}
          </button>
          {preview && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm(null)}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-[#E6E0D4] text-[#8C7E6A] font-medium hover:bg-[#F3EFE9]"
            >
              <ImagePlus className="w-4 h-4" />
              בלי תמונה
            </button>
          )}
          {!preview && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm(null)}
              className="w-full py-3 rounded-2xl border border-[#E6E0D4] text-[#8C7E6A] font-medium hover:bg-[#F3EFE9]"
            >
              בלי תמונה
            </button>
          )}
        </div>
      </motion.div>
    </div>
  );
}

type SkipProps = {
  choreName: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function SkipConfirmModal({ choreName, busy, onConfirm, onCancel }: SkipProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-3xl border border-[#E6E0D4] shadow-xl p-5 flex flex-col gap-4"
      >
        <h3 className="text-lg font-extrabold text-[#3D3732]">לדלג על המשימה?</h3>
        <p className="text-sm text-[#6B5E4C]">
          המשימה <span className="font-bold">{choreName}</span> תועבר לתור הבא (למשל אם היא קשה או לא רלוונטית היום).
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className="flex-1 py-3 bg-[#3D5A80] text-white rounded-2xl font-bold disabled:opacity-60"
          >
            {busy ? 'מעביר...' : 'העבר לתור הבא'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-5 py-3 bg-[#F3EFE9] text-[#8C7E6A] rounded-2xl font-medium"
          >
            ביטול
          </button>
        </div>
      </motion.div>
    </div>
  );
}

type SwapCandidate = { id: string; name: string; color: string; photoURL?: string | null };

type SwapProps = {
  choreName: string;
  candidates: SwapCandidate[];
  busy?: boolean;
  onConfirm: (targetUserId: string) => void;
  onCancel: () => void;
};

export function SwapTurnModal({ choreName, candidates, busy, onConfirm, onCancel }: SwapProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-3xl border border-[#E6E0D4] shadow-xl p-5 flex flex-col gap-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-[#3D3732]">להחליף תור?</h3>
            <p className="text-sm text-[#8C7E6A] mt-1">{choreName}</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="p-2 text-[#8C7E6A] hover:bg-[#F5F1EA] rounded-full"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-[#6B5E4C]">בחר/י עם מי להחליף תורות במשימה הזו.</p>

        {candidates.length === 0 ? (
          <p className="text-sm text-[#A39788] italic py-4 text-center">אין עם מי להחליף במשימה הזו.</p>
        ) : (
          <div className="flex flex-col gap-2 max-h-64 overflow-y-auto">
            {candidates.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => setSelectedId(c.id)}
                className={`flex items-center gap-3 p-3 rounded-2xl border transition-colors ${
                  selectedId === c.id
                    ? 'bg-[#A1C181]/10 border-[#A1C181] ring-1 ring-[#A1C181]/40'
                    : 'bg-[#FAF9F6] border-[#E6E0D4] hover:bg-[#F3EFE9]'
                }`}
              >
                <Avatar name={c.name} color={c.color} photoURL={c.photoURL} size="sm" />
                <span className="font-medium text-[#3D3732]">{c.name}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy || !selectedId}
            onClick={() => selectedId && onConfirm(selectedId)}
            className="flex-1 flex items-center justify-center gap-2 py-3 bg-[#3D5A80] text-white rounded-2xl font-bold disabled:opacity-40"
          >
            <Repeat className="w-4 h-4" />
            {busy ? 'מחליף...' : 'החלף תור'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="px-5 py-3 bg-[#F3EFE9] text-[#8C7E6A] rounded-2xl font-medium"
          >
            ביטול
          </button>
        </div>
      </motion.div>
    </div>
  );
}
