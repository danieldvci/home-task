'use client';

import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Home,
  Loader2,
  Plus,
  Trash2,
  Users
} from 'lucide-react';
import { motion } from 'motion/react';
import { Avatar } from './Avatar';
import { CHORE_ICONS } from './default-icons';
import {
  SETUP_MAX_RESIDENTS,
  STARTER_TEMPLATES,
  normalizeResidentNames,
  setupDraftProblems
} from '../lib/household-setup';
import type { ChoreDraft, ResidentDraft, SetupFrequency } from '../lib/household-setup';
import { fallbackUserIcon } from '../lib/default-icons';

export type SetupResult = {
  name: string;
  residents: ResidentDraft[];
  chores: ChoreDraft[];
};

type SetupOwner = {
  id: string;
  name: string;
  color: string;
  photoURL?: string | null;
  icon?: string | null;
};

type Props = {
  /** Current name of the household, which step one lets the owner change. */
  householdName: string;
  houseCode: string;
  owner: SetupOwner;
  busy?: boolean;
  /** Why the last attempt to save did not work. The draft stays on screen. */
  error?: string | null;
  onFinish: (result: SetupResult) => void;
  /** Leave the rest for later; the app opens on an empty but usable schedule. */
  onSkip: () => void;
};

const DAY_LETTERS = ['א׳', 'ב׳', 'ג׳', 'ד׳', 'ה׳', 'ו׳', 'ש׳'];

const FREQUENCY_LABELS: Record<SetupFrequency, string> = {
  daily: 'כל יום',
  weekly: 'פעם בשבוע',
  custom_days: 'ימים נבחרים'
};

const STEPS = ['הבית', 'מי גר כאן', 'מה עושים'] as const;

const newResidentId = () => `u${crypto.randomUUID().split('-')[0]}`;
const newChoreId = () => `c${crypto.randomUUID().split('-')[0]}`;

type ChoreRow = {
  id: string;
  templateId: string;
  selected: boolean;
  name: string;
  frequency: SetupFrequency;
  customDays: number[];
  category: string;
  icon: ChoreDraft['icon'];
  /** Empty means everybody, which is what it should keep meaning while
   *  residents are still being added on the step before this one. */
  rotation: string[];
};

/**
 * The first run.
 *
 * A household that has just been created has one resident and no chores, and
 * until now the two things it needed were three taps deep inside a collapsed
 * settings section - so the app opened on an empty screen and stayed there.
 * The three steps here are the three questions that screen could not ask.
 *
 * Nothing is written until the last step: the caller commits one batch, so a
 * run that fails leaves the household exactly as it was and the draft still on
 * screen to try again.
 */
export function HouseholdSetup({
  householdName,
  houseCode,
  owner,
  busy,
  error,
  onFinish,
  onSkip
}: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState(householdName);
  const [residents, setResidents] = useState<ResidentDraft[]>([]);
  const [newResident, setNewResident] = useState('');
  const [rows, setRows] = useState<ChoreRow[]>(() =>
    STARTER_TEMPLATES.map(template => ({
      id: newChoreId(),
      templateId: template.id,
      selected: template.suggested,
      name: template.name,
      frequency: template.frequency,
      customDays: template.customDays ? [...template.customDays] : [],
      category: template.category,
      icon: template.icon,
      rotation: []
    }))
  );
  const addResidentRef = useRef<HTMLInputElement>(null);

  // The owner already has a profile, so they are a participant here but never
  // a document to create.
  const people = useMemo(
    () => [{ id: owner.id, name: owner.name }, ...residents.map(r => ({ id: r.id, name: r.name }))],
    [owner.id, owner.name, residents]
  );

  const rotationOf = (row: ChoreRow) =>
    row.rotation.length > 0
      ? people.filter(p => row.rotation.includes(p.id)).map(p => p.id)
      : people.map(p => p.id);

  const selectedRows = rows.filter(row => row.selected);

  const draft = {
    residents: residents.map(r => ({ ...r, name: r.name.trim() })),
    chores: selectedRows.map(row => ({
      id: row.id,
      name: row.name,
      frequency: row.frequency,
      customDays: row.customDays,
      category: row.category,
      icon: row.icon,
      rotation: rotationOf(row)
    }))
  };
  const problems = setupDraftProblems(draft, [owner.id]);

  const addResidents = () => {
    const names = normalizeResidentNames(newResident);
    if (names.length === 0) return;
    setResidents(prev => {
      const room = SETUP_MAX_RESIDENTS - prev.length;
      const added = names.slice(0, Math.max(room, 0)).map(residentName => {
        const id = newResidentId();
        return { id, name: residentName, icon: fallbackUserIcon(id) };
      });
      return [...prev, ...added];
    });
    setNewResident('');
    addResidentRef.current?.focus();
  };

  const updateRow = (id: string, patch: Partial<ChoreRow>) =>
    setRows(prev => prev.map(row => (row.id === id ? { ...row, ...patch } : row)));

  const toggleParticipant = (row: ChoreRow, personId: string) => {
    const current = rotationOf(row);
    const next = current.includes(personId)
      ? current.filter(id => id !== personId)
      : [...current, personId];
    updateRow(row.id, { rotation: people.filter(p => next.includes(p.id)).map(p => p.id) });
  };

  const atLastStep = step === STEPS.length - 1;
  const canGoOn = step !== 1 || residents.every(r => r.name.trim().length > 0);

  return (
    <div className="min-h-screen bg-page flex flex-col" dir="rtl">
      <header className="sticky top-0 z-20 bg-page/90 backdrop-blur-xl border-b border-line px-6 py-4">
        <div className="max-w-md mx-auto flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <h1 className="text-lg font-extrabold text-ink">שנתחיל?</h1>
            <button
              type="button"
              onClick={onSkip}
              disabled={busy}
              className="text-xs font-bold text-ink-muted hover:text-ink-mid underline disabled:opacity-40"
            >
              דלג, אסדר לבד
            </button>
          </div>
          {/* Three steps, and which one this is. A wizard that does not say how
              much is left is a wizard people abandon on the first screen. */}
          <ol className="flex items-center gap-2">
            {STEPS.map((label, index) => (
              <li key={label} className="flex-1 flex flex-col gap-1.5">
                <span
                  className={`h-1.5 rounded-full transition-colors ${
                    index <= step ? 'bg-settled' : 'bg-inset'
                  }`}
                />
                <span
                  className={`text-[11px] font-bold ${
                    index === step ? 'text-ink' : 'text-ink-faint'
                  }`}
                >
                  {label}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </header>

      <main className="flex-1 px-6 py-6">
        <div className="max-w-md mx-auto flex flex-col gap-4">
          {step === 0 && (
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card p-5 rounded-3xl border border-line shadow-sm flex flex-col gap-4"
            >
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-2xl bg-settled/15 text-settled-ink flex items-center justify-center">
                  <Home className="w-5 h-5" />
                </span>
                <div>
                  <h2 className="font-extrabold text-ink">איך נקרא לבית?</h2>
                  <p className="text-xs text-ink-muted">אפשר לשנות בכל רגע בהגדרות</p>
                </div>
              </div>
              <input
                value={name}
                onChange={e => setName(e.target.value.slice(0, 80))}
                placeholder="למשל: משפחת כהן"
                className="w-full bg-page border border-line rounded-2xl px-4 py-3 text-ink outline-none focus:border-settled"
              />
              <p className="text-xs text-ink-muted">
                קוד הבית לשיתוף:{' '}
                <span dir="ltr" className="font-mono font-bold text-ink-mid tabular-nums">
                  {houseCode}
                </span>
                . מי שמתחבר עם גוגל ומקליד את הקוד מצטרף לבית הזה.
              </p>
            </motion.section>
          )}

          {step === 1 && (
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card p-5 rounded-3xl border border-line shadow-sm flex flex-col gap-4"
            >
              <div className="flex items-center gap-3">
                <span className="w-11 h-11 rounded-2xl bg-accent/10 text-accent flex items-center justify-center">
                  <Users className="w-5 h-5" />
                </span>
                <div>
                  <h2 className="font-extrabold text-ink">מי גר בבית?</h2>
                  <p className="text-xs text-ink-muted">
                    בלי טלפון ובלי חשבון. אפשר לסמן בשמם מכל מכשיר בבית.
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3 bg-page border border-line rounded-2xl px-3 py-2.5">
                <Avatar
                  name={owner.name}
                  color={owner.color}
                  photoURL={owner.photoURL}
                  icon={owner.icon}
                  iconSeed={owner.id}
                  size="sm"
                />
                <span className="font-medium text-ink flex-1 truncate">{owner.name}</span>
                <span className="text-[11px] font-bold text-accent bg-accent/10 px-2 py-0.5 rounded-full">
                  אתה, מנהל הבית
                </span>
              </div>

              {residents.map((resident, index) => (
                <div key={resident.id} className="flex items-center gap-2">
                  <Avatar
                    name={resident.name || '?'}
                    color="bg-avatar-empty"
                    icon={resident.icon}
                    iconSeed={resident.id}
                    size="sm"
                  />
                  <input
                    value={resident.name}
                    onChange={e =>
                      setResidents(prev =>
                        prev.map((r, i) =>
                          i === index ? { ...r, name: e.target.value.slice(0, 100) } : r
                        )
                      )
                    }
                    aria-label={`שם הדייר ${index + 1}`}
                    aria-invalid={resident.name.trim().length === 0}
                    className={`flex-1 min-w-0 bg-page border rounded-2xl px-3 py-2.5 text-ink outline-none focus:border-settled ${
                      resident.name.trim().length === 0 ? 'border-danger' : 'border-line'
                    }`}
                  />
                  <button
                    type="button"
                    onClick={() => setResidents(prev => prev.filter((_, i) => i !== index))}
                    aria-label={`הסר את ${resident.name || 'הדייר'}`}
                    className="p-2 text-danger hover:bg-danger/10 rounded-xl transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}

              {residents.length < SETUP_MAX_RESIDENTS ? (
                <div className="flex gap-2">
                  <input
                    ref={addResidentRef}
                    value={newResident}
                    onChange={e => setNewResident(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addResidents();
                      }
                    }}
                    placeholder="שם, או כמה שמות מופרדים בפסיק"
                    aria-label="שם דייר להוספה"
                    className="flex-1 min-w-0 bg-page border border-line rounded-2xl px-3 py-2.5 text-ink outline-none focus:border-settled"
                  />
                  <button
                    type="button"
                    onClick={addResidents}
                    disabled={normalizeResidentNames(newResident).length === 0}
                    className="px-4 flex items-center gap-1 bg-settled text-white rounded-2xl font-bold disabled:opacity-40"
                  >
                    <Plus className="w-4 h-4" />
                    הוסף
                  </button>
                </div>
              ) : (
                <p className="text-xs text-ink-muted">
                  אפשר להוסיף עד {SETUP_MAX_RESIDENTS} דיירים כאן, והשאר בהגדרות.
                </p>
              )}
            </motion.section>
          )}

          {step === 2 && (
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col gap-3"
            >
              <div className="bg-card p-5 rounded-3xl border border-line shadow-sm">
                <h2 className="font-extrabold text-ink">מה עושים בבית?</h2>
                <p className="text-xs text-ink-muted mt-1">
                  סימנו את הנפוצות. אפשר לשנות שם, תדירות ומשתתפים, ולהוסיף עוד בהגדרות.
                </p>
              </div>

              {rows.map(row => {
                const Glyph = CHORE_ICONS[row.icon];
                const rotation = rotationOf(row);
                return (
                  <div
                    key={row.id}
                    className={`rounded-3xl border p-4 flex flex-col gap-3 transition-colors ${
                      row.selected ? 'bg-card border-settled shadow-sm' : 'bg-page border-line'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => updateRow(row.id, { selected: !row.selected })}
                        role="checkbox"
                        aria-checked={row.selected}
                        aria-label={row.name}
                        className={`w-11 h-11 rounded-2xl flex items-center justify-center flex-shrink-0 transition-colors ${
                          row.selected
                            ? 'bg-settled text-white'
                            : 'bg-inset text-ink-muted hover:bg-subtle'
                        }`}
                      >
                        <Glyph className="w-5 h-5" />
                      </button>
                      <input
                        value={row.name}
                        onChange={e => updateRow(row.id, { name: e.target.value.slice(0, 100) })}
                        disabled={!row.selected}
                        aria-label="שם המשימה"
                        aria-invalid={row.selected && row.name.trim().length === 0}
                        className={`flex-1 min-w-0 bg-transparent border-b py-1 font-bold text-ink outline-none focus:border-settled disabled:text-ink-faint ${
                          row.selected && row.name.trim().length === 0
                            ? 'border-danger'
                            : 'border-transparent'
                        }`}
                      />
                      {row.selected && (
                        <span className="text-[11px] font-bold text-ink-faint flex-shrink-0">
                          {row.category}
                        </span>
                      )}
                    </div>

                    {row.selected && (
                      <>
                        <div className="flex gap-2">
                          {(['daily', 'weekly', 'custom_days'] as const).map(frequency => (
                            <button
                              key={frequency}
                              type="button"
                              onClick={() => updateRow(row.id, { frequency })}
                              aria-pressed={row.frequency === frequency}
                              className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors ${
                                row.frequency === frequency
                                  ? 'bg-settled/15 text-settled-ink border-settled/40'
                                  : 'bg-page text-ink-muted border-line'
                              }`}
                            >
                              {FREQUENCY_LABELS[frequency]}
                            </button>
                          ))}
                        </div>

                        {row.frequency === 'custom_days' && (
                          <div className="flex justify-between gap-1">
                            {DAY_LETTERS.map((letter, index) => {
                              const on = row.customDays.includes(index);
                              return (
                                <button
                                  key={letter}
                                  type="button"
                                  onClick={() =>
                                    updateRow(row.id, {
                                      customDays: on
                                        ? row.customDays.filter(d => d !== index)
                                        : [...row.customDays, index].sort((a, b) => a - b)
                                    })
                                  }
                                  aria-pressed={on}
                                  aria-label={`יום ${letter}`}
                                  className={`w-9 h-9 rounded-full text-sm font-bold transition-colors ${
                                    on
                                      ? 'bg-settled text-white'
                                      : 'bg-page text-ink-muted border border-line'
                                  }`}
                                >
                                  {letter}
                                </button>
                              );
                            })}
                          </div>
                        )}

                        <div className="flex flex-wrap gap-2">
                          {people.map(person => {
                            const on = rotation.includes(person.id);
                            return (
                              <button
                                key={person.id}
                                type="button"
                                onClick={() => toggleParticipant(row, person.id)}
                                aria-pressed={on}
                                className={`px-3 py-1.5 rounded-2xl text-xs font-medium border transition-colors ${
                                  on
                                    ? 'bg-accent/10 text-accent border-accent/40'
                                    : 'bg-page text-ink-muted border-line'
                                }`}
                              >
                                {person.id === owner.id ? 'אני' : person.name || 'דייר'}
                              </button>
                            );
                          })}
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </motion.section>
          )}

          {/* Why the last attempt did not go through, and what is still
              missing - both in the same place, because from the user's side
              they are the same question. */}
          {(error || (atLastStep && problems.length > 0)) && (
            <div
              role="alert"
              className="flex items-start gap-2 bg-danger/10 border border-danger/30 text-danger rounded-2xl px-4 py-3 text-sm font-medium"
            >
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span className="flex flex-col gap-0.5">
                {error && <span>{error}</span>}
                {atLastStep && problems.map(problem => <span key={problem}>{problem}</span>)}
              </span>
            </div>
          )}
        </div>
      </main>

      <nav className="sticky bottom-0 bg-card border-t border-line px-6 py-4 pb-safe">
        <div className="max-w-md mx-auto flex gap-2">
          {step > 0 && (
            <button
              type="button"
              onClick={() => setStep(s => s - 1)}
              disabled={busy}
              className="px-4 py-3.5 rounded-2xl border border-line text-ink-muted font-bold flex items-center gap-1 disabled:opacity-40"
            >
              <ChevronRight className="w-4 h-4" />
              חזרה
            </button>
          )}
          <button
            type="button"
            disabled={busy || !canGoOn || (atLastStep && problems.length > 0)}
            onClick={() => {
              if (!atLastStep) {
                setStep(s => s + 1);
                return;
              }
              onFinish({ name: name.trim(), residents: draft.residents, chores: draft.chores });
            }}
            className="flex-1 flex items-center justify-center gap-2 py-3.5 bg-settled text-white rounded-2xl font-extrabold shadow-sm hover:bg-settled-hover disabled:opacity-50"
          >
            {busy ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                מסדר את הבית...
              </>
            ) : atLastStep ? (
              <>
                <Check className="w-5 h-5" />
                {selectedRows.length > 0 ? `סיום · ${selectedRows.length} משימות` : 'סיום'}
              </>
            ) : (
              <>
                המשך
                <ChevronLeft className="w-4 h-4" />
              </>
            )}
          </button>
        </div>
      </nav>
    </div>
  );
}
