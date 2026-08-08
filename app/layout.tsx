import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FX Intel — Forex News Intelligence',
  description:
    'Explainable bullish/bearish scoring for currencies, pairs, metals and oil, built from economic releases and corroborated news flow.',
};

export const viewport: Viewport = {
  themeColor: '#0a0d14',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
