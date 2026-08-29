import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CommunicationIQ | Emich Automotive',
  description: 'AI-powered customer communication intelligence for Emich Automotive.',
  applicationName: 'CommunicationIQ',
  icons: { icon: '/emich-automotive.png', apple: '/emich-automotive.png' }
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: '#f7f8fa'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
