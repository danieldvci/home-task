'use client';

import React, { useState } from 'react';

type AvatarProps = {
  name: string;
  color: string;
  photoURL?: string | null;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
};

const sizeClass = {
  sm: 'w-6 h-6 text-xs',
  md: 'w-10 h-10 text-sm',
  lg: 'w-16 h-16 text-2xl'
};

export function Avatar({ name, color, photoURL, size = 'md', className = '' }: AvatarProps) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const base = `${sizeClass[size]} rounded-full flex items-center justify-center text-white font-bold shadow-sm overflow-hidden ${className}`;
  const showImg = !!photoURL && failedUrl !== photoURL;

  if (showImg) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={photoURL!}
        alt={name}
        // Google avatar URLs reject requests that send a referrer.
        referrerPolicy="no-referrer"
        className={`${base} object-cover bg-[#D4CBBF]`}
        onError={() => setFailedUrl(photoURL!)}
      />
    );
  }
  return <div className={`${base} ${color}`}>{name?.charAt(0) || '?'}</div>;
}
