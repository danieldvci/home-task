import type {Metadata, Viewport} from 'next';
import { Rubik } from 'next/font/google';
import './globals.css';
import { InstallPrompt } from '../components/InstallPrompt';
import { ToastProvider } from '../components/Toast';

const rubik = Rubik({ subsets: ['hebrew', 'latin'] });

export const metadata: Metadata = {
  title: 'תורנויות הבית',
  description: 'אפליקציה פשוטה לניהול משימות הבית.',
  applicationName: 'תורנויות הבית',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [{ url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }]
  },
  appleWebApp: {
    capable: true,
    title: 'תורנויות הבית',
    statusBarStyle: 'default'
  },
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

export const viewport: Viewport = {
  themeColor: '#A1C181',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover'
};

export default function RootLayout({children}: {children: React.ReactNode}) {
  return (
    <html lang="he" dir="rtl">
      <body className={`${rubik.className} bg-[#FAF9F6] text-[#4A443F] min-h-screen`} suppressHydrationWarning>
        <ToastProvider>
          {children}
          <InstallPrompt />
        </ToastProvider>
      </body>
    </html>
  );
}
