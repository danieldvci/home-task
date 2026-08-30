'use client';

import React, { useState } from 'react';
import { MessageCircle, Send, SmilePlus, Trash2, X } from 'lucide-react';
import { Avatar } from './Avatar';
import {
  COMMENT_MAX_LENGTH,
  COMMENTS_MAX,
  REACTIONS,
  REACTION_BY_ID,
  countReactions
} from '../lib/reactions';
import type { LogComment, ReactionId } from '../lib/reactions';

type ReactionUser = {
  id: string;
  name: string;
  color: string;
  photoURL?: string;
};

type Props = {
  reactions?: Record<string, string>;
  comments?: LogComment[];
  myReaction?: ReactionId | null;
  users: ReactionUser[];
  photoOf?: (userId: string) => string | undefined;
  canModerate?: boolean;
  onToggleReaction: (reaction: ReactionId) => void;
  onAddComment: (text: string) => Promise<void> | void;
  onDeleteComment: (index: number) => void;
};

export function ReactionBar({
  reactions,
  comments,
  myReaction,
  users,
  photoOf,
  canModerate,
  onToggleReaction,
  onAddComment,
  onDeleteComment
}: Props) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);

  const counts = countReactions(reactions);
  const summary = REACTIONS.filter((reaction) => (counts[reaction.id] || 0) > 0);
  const commentList = comments || [];
  const commentsFull = commentList.length >= COMMENTS_MAX;

  const submitComment = async () => {
    const text = draft.trim().slice(0, COMMENT_MAX_LENGTH);
    if (!text || sending || commentsFull) return;
    setSending(true);
    try {
      await onAddComment(text);
      setDraft('');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-1.5 flex-wrap">
        {summary.map(({ id, label, Icon, activeClass }) => {
          const mine = myReaction === id;
          return (
            <button
              key={id}
              onClick={() => onToggleReaction(id)}
              title={label}
              className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-xl border transition-colors ${
                mine
                  ? `${activeClass} border-current`
                  : 'text-[#8C7E6A] bg-[#F5F1EA] border-transparent hover:bg-[#EAE3D5]'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              {counts[id]}
            </button>
          );
        })}

        <button
          onClick={() => setPickerOpen((open) => !open)}
          title="הוסף תגובה"
          className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-xl transition-colors ${
            pickerOpen ? 'text-[#3D3732] bg-[#EAE3D5]' : 'text-[#8C7E6A] bg-[#F5F1EA] hover:bg-[#EAE3D5]'
          }`}
        >
          {pickerOpen ? <X className="w-3.5 h-3.5" /> : <SmilePlus className="w-3.5 h-3.5" />}
        </button>

        <button
          onClick={() => setCommentsOpen((open) => !open)}
          title="תגובות"
          className={`inline-flex items-center gap-1 text-xs font-bold px-2.5 py-1 rounded-xl transition-colors ${
            commentsOpen ? 'text-[#3D3732] bg-[#EAE3D5]' : 'text-[#8C7E6A] bg-[#F5F1EA] hover:bg-[#EAE3D5]'
          }`}
        >
          <MessageCircle className="w-3.5 h-3.5" />
          {commentList.length > 0 ? commentList.length : 'תגובה'}
        </button>
      </div>

      {pickerOpen && (
        <div className="flex items-center gap-1.5 flex-wrap bg-[#F5F1EA] rounded-2xl p-1.5">
          {REACTIONS.map(({ id, label, Icon, activeClass }) => {
            const mine = myReaction === id;
            return (
              <button
                key={id}
                onClick={() => {
                  onToggleReaction(id);
                  setPickerOpen(false);
                }}
                title={label}
                className={`inline-flex items-center gap-1 text-[11px] font-bold px-2 py-1 rounded-xl transition-colors ${
                  mine ? activeClass : 'text-[#8C7E6A] hover:bg-white'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            );
          })}
        </div>
      )}

      {commentsOpen && (
        <div className="flex flex-col gap-2 bg-[#FAF9F6] border border-[#E6E0D4] rounded-2xl p-3">
          {commentList.length === 0 ? (
            <p className="text-xs text-[#A39788]">אין תגובות עדיין.</p>
          ) : (
            commentList.map((comment, idx) => {
              const author = users.find((u) => u.id === comment.userId);
              const timeStr = new Date(comment.timestamp).toLocaleTimeString('he-IL', {
                hour: '2-digit',
                minute: '2-digit'
              });
              return (
                <div key={`${comment.timestamp}-${idx}`} className="flex gap-2 items-start">
                  <Avatar
                    name={author?.name || '?'}
                    color={author?.color || 'bg-[#D4CBBF]'}
                    photoURL={photoOf?.(comment.userId)}
                    size="sm"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-bold text-[#3D3732] truncate">
                        {author?.name || 'דייר שהוסר'}
                      </span>
                      <span className="text-[10px] font-medium text-[#A39788] whitespace-nowrap">{timeStr}</span>
                      <span
                        title={canModerate ? undefined : 'רק מנהל הבית יכול לבצע פעולה זו'}
                        className="ml-auto inline-flex"
                      >
                        <button
                          onClick={() => onDeleteComment(idx)}
                          disabled={!canModerate}
                          title={canModerate ? 'מחק תגובה' : 'רק מנהל הבית יכול לבצע פעולה זו'}
                          aria-label={canModerate ? 'מחק תגובה' : 'רק מנהל הבית יכול לבצע פעולה זו'}
                          className="p-0.5 text-rose-400 hover:bg-rose-50 rounded-lg transition-colors disabled:opacity-40 disabled:pointer-events-none"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </span>
                    </div>
                    <p className="text-xs text-[#6B5E4C] leading-relaxed break-words">{comment.text}</p>
                  </div>
                </div>
              );
            })
          )}

          {commentsFull ? (
            <p className="text-[10px] text-[#A39788]">הגעתם למספר התגובות המקסימלי לרשומה זו.</p>
          ) : (
            <div className="flex items-center gap-2">
              <input
                value={draft}
                maxLength={COMMENT_MAX_LENGTH}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    submitComment();
                  }
                }}
                placeholder="כתבו תגובה..."
                className="flex-1 bg-white border border-[#E6E0D4] rounded-xl px-3 py-2 text-xs text-[#3D3732] outline-none focus:border-[#A1C181]"
              />
              <button
                onClick={submitComment}
                disabled={sending || !draft.trim()}
                title="שלח תגובה"
                className="p-2 rounded-xl bg-[#A1C181] text-white disabled:opacity-40 hover:bg-[#8eab72] transition-colors"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
