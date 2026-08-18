'use client';

import React, { useRef, useState } from 'react';
import { Camera, CheckCircle2, X, ImagePlus } from 'lucide-react';
import { motion } from 'motion/react';

type Props = {
  choreName: string;
  busy?: boolean;
  onConfirm: (file: File | null) => void;
  onCancel: () => void;
};

export function DoneConfirmModal({ choreName, busy, onConfirm, onCancel }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const onPick = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    if (!f) {
      setFile(null);
      setPreview(null);
      return;
    }
    setFile(f);
    setPreview(URL.createObjectURL(f));
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
          capture="environment"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] || null)}
        />

        {preview ? (
          <div className="relative rounded-2xl overflow-hidden border border-[#E6E0D4] bg-[#FAF9F6]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="תצוגה מקדימה" className="w-full max-h-56 object-cover" />
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

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => onConfirm(file)}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#A1C181] text-white rounded-2xl font-bold shadow-sm hover:bg-[#8eab72] disabled:opacity-60"
          >
            <CheckCircle2 className="w-5 h-5" />
            {busy ? 'שומר...' : file ? 'אשר עם תמונה' : 'אשר ביצוע'}
          </button>
          {file && (
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
          {!file && (
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
