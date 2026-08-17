import type {Metadata} from 'next';
import { Rubik } from 'next/font/google';
import './globals.css';

const rubik = Rubik({ subsets: ['hebrew', 'latin'] });

export const metadata: Metadata = {
  title: 'תורנויות הבית',
  description: 'אפליקציה פשוטה לניהול משימות הבית.',
  openGraph: {
    title: 'תורנויות הבית',
    description: 'אפליקציה פשוטה לניהול משימות הבית.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'תורנויות הבית',
    description: 'אפליקציה פשוטה לניהול משימות הבית.',
  },
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="he" dir="rtl">
      <body className={`${rubik.className} bg-[#FAF9F6] text-[#4A443F] min-h-screen`} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
