'use client';

import React, { useState } from 'react';
import { USER_ICONS } from './default-icons';
import { isUserIconId, fallbackUserIcon } from '../lib/default-icons';

type AvatarProps = {
  name: string;
  color: string;
  photoURL?: string | null;
  /** The resident's stored icon name, if they have chosen one. */
  icon?: string | null;
  /**
   * Their id, which is what an unchosen icon is derived from. Given rather
   * than derived from the name so a rename does not change somebody's face.
   */
  iconSeed?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  /** Names an avatar that stands alone, such as one overlapped in a queue. */
  title?: string;
};

const sizeClass = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-2xl'
};

const glyphClass = {
  sm: 'w-3.5 h-3.5',
  md: 'w-5 h-5',
  lg: 'w-8 h-8'
};

export function Avatar({
  name,
  color,
  photoURL,
  icon,
  iconSeed,
  size = 'md',
  className = '',
  title
}: AvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  // flex-shrink-0 is not cosmetic: a flex item shrinks below its width by
  // default, and object-cover then crops the photo to fill the narrowed box
  // rather than scaling it, leaving a sliver of someone's face.
  const base = `${sizeClass[size]} flex-shrink-0 rounded-full flex items-center justify-center text-white font-bold shadow-sm overflow-hidden ${className}`;
  const showImg = !!photoURL && failedUrl !== photoURL;

  if (showImg) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoURL!}
        alt={name}
        title={title}
        // Google avatar URLs reject requests that send a referrer.
        referrerPolicy="no-referrer"
        className={`${base} object-cover bg-avatar-empty`}
        onError={() => setFailedUrl(photoURL!)}
      />
    );
  }

  // A picture beats an icon and an icon beats a letter. The Google photo and
  // any upload are resolved into `photoURL` by the caller, so a household that
  // uses photos never sees this; one that does not gets a face rather than the
  // first character of a name, which for two residents called דני and דנה was
  // the same character.
  const iconName = isUserIconId(icon) ? icon : iconSeed ? fallbackUserIcon(iconSeed) : null;
  if (iconName) {
    const Glyph = USER_ICONS[iconName];
    return (
      <div className={`${base} ${color}`} title={title} aria-label={name}>
        <Glyph className={glyphClass[size]} strokeWidth={2.4} aria-hidden="true" />
      </div>
    );
  }

  return <div className={`${base} ${color}`} title={title}>{name?.charAt(0) || '?'}</div>;
}
