'use client';

import React, { useState } from 'react';

type AvatarProps = {
  name: string;
  color: string;
  photoURL?: string | null;
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

export function Avatar({ name, color, photoURL, size = 'md', className = '', title }: AvatarProps) {
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
        className={`${base} object-cover bg-[#D4CBBF]`}
        onError={() => setFailedUrl(photoURL!)}
      />
    );
  }
  return <div className={`${base} ${color}`} title={title}>{name?.charAt(0) || '?'}</div>;
}
