import { Heart, Laugh, Sparkles, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export type ReactionId = 'like' | 'love' | 'laugh' | 'wow' | 'dislike';

export type ReactionDef = {
  id: ReactionId;
  label: string;
  Icon: LucideIcon;
  activeClass: string;
};

// Mirrors the allowed values in firestore.rules; anything else is rejected.
export const REACTIONS: ReactionDef[] = [
  { id: 'like', label: 'אהבתי', Icon: ThumbsUp, activeClass: 'text-[#5F7A45] bg-[#A1C181]/25' },
  { id: 'love', label: 'מעולה', Icon: Heart, activeClass: 'text-rose-600 bg-rose-50' },
  { id: 'laugh', label: 'מצחיק', Icon: Laugh, activeClass: 'text-[#8A6D1F] bg-[#E9C46A]/25' },
  { id: 'wow', label: 'וואו', Icon: Sparkles, activeClass: 'text-[#5C4F86] bg-[#7B6CA8]/20' },
  { id: 'dislike', label: 'לא אהבתי', Icon: ThumbsDown, activeClass: 'text-[#3D5A80] bg-[#3D5A80]/15' }
];

export const REACTION_BY_ID: Record<string, ReactionDef | undefined> = REACTIONS.reduce(
  (acc, reaction) => ({ ...acc, [reaction.id]: reaction }),
  {} as Record<string, ReactionDef | undefined>
);

export type LogComment = {
  userId: string;
  text: string;
  timestamp: string;
};

// Mirrors the `text` and array ceilings in firestore.rules.
export const COMMENT_MAX_LENGTH = 200;
export const COMMENTS_MAX = 30;

export function countReactions(reactions?: Record<string, string>) {
  const counts: Partial<Record<ReactionId, number>> = {};
  Object.values(reactions || {}).forEach((value) => {
    const def = REACTION_BY_ID[value];
    if (!def) return;
    counts[def.id] = (counts[def.id] || 0) + 1;
  });
  return counts;
}
