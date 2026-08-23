'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Camera, CheckCircle2, X, ImagePlus, Repeat, Loader2, Trash2 } from 'lucide-react';
import { motion } from 'motion/react';
import { Avatar } from './Avatar';
import { compressImage } from '../lib/image';
import { MAX_PROOF_PHOTOS, validateProofFile } from '../lib/storage-upload';

type PickedPhoto = { id: string; preview: string; blob: Blob | null };

type PhotoPickerProps = {
  disabled?: boolean;
  max?: number;
  /** Fires on every change with the compressed blobs and whether work is pending. */
  onChange: (photos: Blob[], processing: boolean) => void;
};

/**
 * Camera and gallery picker for proof photos.
 *
 * Android decides between camera and gallery from the `capture` attribute, and
 * a single input can only offer one of them: with `capture` the gallery is
 * unreachable, without it most devices go straight to the gallery. Two inputs
 * behind two buttons is the only way to offer both.
 */
export function PhotoPicker({ disabled, max = MAX_PROOF_PHOTOS, onChange }: PhotoPickerProps) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<PickedPhoto[]>([]);
  const [pending, setPending] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Kept in a ref so an inline parent callback cannot retrigger the effect.
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    onChangeRef.current(
      items.map(i => i.blob).filter((b): b is Blob => !!b),
      pending > 0
    );
  }, [items, pending]);

  const itemsRef = useRef(items);
  itemsRef.current = items;
  useEffect(() => {
    return () => {
      itemsRef.current.forEach(i => URL.revokeObjectURL(i.preview));
    };
  }, []);

  const addFiles = async (files: File[]) => {
    setError(null);
    const room = max - itemsRef.current.length;
    if (room <= 0) return;
    if (files.length > room) setError(`אפשר לצרף עד ${max} תמונות`);

    const accepted: PickedPhoto[] = [];
    for (const file of files.slice(0, room)) {
      const validationError = validateProofFile(file);
      if (validationError) {
        setError(validationError);
        continue;
      }
      accepted.push({ id: crypto.randomUUID(), preview: URL.createObjectURL(file), blob: null });
    }
    if (accepted.length === 0) return;

    setItems(prev => [...prev, ...accepted]);
    setPending(p => p + accepted.length);

    await Promise.all(
      accepted.map(async (item, i) => {
        try {
          const compressed = await compressImage(files[i]);
          setItems(prev => prev.map(x => (x.id === item.id ? { ...x, blob: compressed } : x)));
        } catch (err) {
          console.error(err);
          setError('עיבוד התמונה נכשל. אפשר לאשר בלי תמונה.');
          setItems(prev => prev.filter(x => x.id !== item.id));
          URL.revokeObjectURL(item.preview);
        } finally {
          setPending(p => p - 1);
        }
      })
    );
  };

  const removeItem = (id: string) => {
    setItems(prev => {
      const target = prev.find(x => x.id === id);
      if (target) URL.revokeObjectURL(target.preview);
      return prev.filter(x => x.id !== id);
    });
    setError(null);
  };

  const atMax = items.length >= max;

  return (
    <div className="flex flex-col gap-2">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          addFiles(files);
        }}
      />
      <input
        ref={galleryRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          addFiles(files);
        }}
      />

      {items.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {items.map(item => (
            <div
              key={item.id}
              className="relative aspect-square rounded-2xl overflow-hidden border border-[#E6E0D4] bg-[#FAF9F6]"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={item.preview} alt="תצוגה מקדימה" className="w-full h-full object-cover" />
              {!item.blob && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-white">
                  <Loader2 className="w-5 h-5 animate-spin" />
                </div>
              )}
              <button
                type="button"
                onClick={() => removeItem(item.id)}
                disabled={disabled}
                aria-label="הסר תמונה"
                className="absolute top-1 left-1 bg-white/90 text-[#8C7E6A] p-1.5 rounded-full shadow-sm"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => cameraRef.current?.click()}
          disabled={disabled || atMax}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-[#DED8CE] bg-[#FAF9F6] text-[#8C7E6A] text-sm font-medium hover:bg-[#F3EFE9] disabled:opacity-40"
        >
          <Camera className="w-5 h-5" />
          צלם
        </button>
        <button
          type="button"
          onClick={() => galleryRef.current?.click()}
          disabled={disabled || atMax}
          className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl border border-dashed border-[#DED8CE] bg-[#FAF9F6] text-[#8C7E6A] text-sm font-medium hover:bg-[#F3EFE9] disabled:opacity-40"
        >
          <ImagePlus className="w-5 h-5" />
          בחר מהגלריה
        </button>
      </div>

      {atMax && <p className="text-xs text-[#A39788]">הגעת למקסימום {max} תמונות</p>}
      {error && <p className="text-sm text-rose-500">{error}</p>}
    </div>
  );
}

type Props = {
  choreName: string;
  busy?: boolean;
  onConfirm: (photos: Blob[]) => void;
  onCancel: () => void;
};

export function DoneConfirmModal({ choreName, busy, onConfirm, onCancel }: Props) {
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [processing, setProcessing] = useState(false);

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

        <p className="text-sm text-[#6B5E4C]">
          אפשר לצרף עד {MAX_PROOF_PHOTOS} תמונות כהוכחה (מומלץ). אפשר גם לאשר בלי תמונה.
        </p>

        <PhotoPicker
          disabled={busy}
          onChange={(next, isProcessing) => {
            setPhotos(next);
            setProcessing(isProcessing);
          }}
        />

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy || processing}
            onClick={() => onConfirm(photos)}
            className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#A1C181] text-white rounded-2xl font-bold shadow-sm hover:bg-[#8eab72] disabled:opacity-60"
          >
            <CheckCircle2 className="w-5 h-5" />
            {busy
              ? 'שומר...'
              : processing
                ? 'מעבד תמונה...'
                : photos.length > 1
                  ? `אשר עם ${photos.length} תמונות`
                  : photos.length === 1
                    ? 'אשר עם תמונה'
                    : 'אשר ביצוע'}
          </button>
          {photos.length > 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm([])}
              className="w-full flex items-center justify-center gap-2 py-3 rounded-2xl border border-[#E6E0D4] text-[#8C7E6A] font-medium hover:bg-[#F3EFE9]"
            >
              <ImagePlus className="w-4 h-4" />
              בלי תמונה
            </button>
          )}
          {photos.length === 0 && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onConfirm([])}
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

/** Mirrors the `details` ceiling in firestore.rules. */
export const MANUAL_LOG_MAX_CHARS = 200;

type ManualLogProps = {
  chores: { id: string; name: string }[];
  busy?: boolean;
  onConfirm: (text: string, choreId: string | null, photos: Blob[]) => void;
  onCancel: () => void;
};

/**
 * A free-form history entry for work done outside the rotation. It writes a
 * log and nothing else, so it can never move a turn.
 */
export function ManualLogModal({ chores, busy, onConfirm, onCancel }: ManualLogProps) {
  const [text, setText] = useState('');
  const [choreId, setChoreId] = useState('');
  const [photos, setPhotos] = useState<Blob[]>([]);
  const [processing, setProcessing] = useState(false);

  const trimmed = text.trim();
  const remaining = MANUAL_LOG_MAX_CHARS - text.length;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-3xl border border-[#E6E0D4] shadow-xl p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-[#3D3732]">רישום ליומן</h3>
            <p className="text-sm text-[#8C7E6A] mt-1">משהו שנעשה בבית ולא קשור למשימה בתור</p>
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

        <div className="flex flex-col gap-1">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MANUAL_LOG_MAX_CHARS))}
            disabled={busy}
            rows={3}
            placeholder="מה נעשה?"
            className="w-full bg-[#FAF9F6] border border-[#E6E0D4] rounded-2xl px-4 py-3 text-sm text-[#3D3732] outline-none focus:border-[#A1C181] resize-none"
          />
          <span className="text-[11px] text-[#A39788] self-end">נותרו {remaining} תווים</span>
        </div>

        {chores.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-bold text-[#8C7E6A]">לשייך למשימה (לא חובה)</label>
            <select
              value={choreId}
              onChange={(e) => setChoreId(e.target.value)}
              disabled={busy}
              className="w-full bg-white border border-[#E6E0D4] rounded-2xl px-4 py-3 text-sm font-medium text-[#6B5E4C] outline-none focus:border-[#A1C181]"
            >
              <option value="">ללא שיוך</option>
              {chores.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        )}

        <PhotoPicker
          disabled={busy}
          onChange={(next, isProcessing) => {
            setPhotos(next);
            setProcessing(isProcessing);
          }}
        />

        <button
          type="button"
          disabled={busy || processing || trimmed.length === 0}
          onClick={() => onConfirm(trimmed, choreId || null, photos)}
          className="w-full flex items-center justify-center gap-2 py-3.5 bg-[#A1C181] text-white rounded-2xl font-bold shadow-sm hover:bg-[#8eab72] disabled:opacity-50"
        >
          <CheckCircle2 className="w-5 h-5" />
          {busy ? 'שומר...' : processing ? 'מעבד תמונה...' : 'הוסף ליומן'}
        </button>
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

type DeleteLogProps = {
  details: string;
  olderCountHint?: number;
  busy?: boolean;
  onDeleteOne: () => void;
  onDeleteOlder: () => void;
  onCancel: () => void;
};

export function DeleteLogConfirmModal({
  details,
  olderCountHint,
  busy,
  onDeleteOne,
  onDeleteOlder,
  onCancel
}: DeleteLogProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-white rounded-3xl border border-[#E6E0D4] shadow-xl p-5 flex flex-col gap-4"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-extrabold text-[#3D3732]">מחיקת רשומת פעילות</h3>
            <p className="text-sm text-[#8C7E6A] mt-1 line-clamp-2">{details}</p>
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

        <p className="text-sm text-[#6B5E4C]">
          אפשר למחוק רק את הרשומה הזו, או גם את כל הרשומות הישנות ממנה (כולל אותה).
        </p>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onDeleteOne}
            className="w-full flex items-center justify-center gap-2 py-3 bg-rose-500 text-white rounded-2xl font-bold disabled:opacity-40 hover:bg-rose-600 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {busy ? 'מוחק...' : 'מחק רק רשומה זו'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDeleteOlder}
            className="w-full flex items-center justify-center gap-2 py-3 border border-rose-200 text-rose-600 bg-rose-50 rounded-2xl font-bold disabled:opacity-40 hover:bg-rose-100 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            {busy
              ? 'מוחק...'
              : olderCountHint && olderCountHint > 1
              ? `מחק רשומה זו ואת כל הישנות (${olderCountHint})`
              : 'מחק רשומה זו ואת כל הישנות'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onCancel}
            className="w-full py-3 bg-[#F3EFE9] text-[#8C7E6A] rounded-2xl font-medium"
          >
            ביטול
          </button>
        </div>
      </motion.div>
    </div>
  );
}
