import type { Metadata, Viewport } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import { MotionConfig } from 'motion/react';
import './globals.css';

const sans = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });
const mono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono' });

export const metadata: Metadata = {
  title: 'Accord: a grounded agent that checks decisions against real code and data',
  description:
    'Accord checks your team’s decisions against the code that implements them and the data they affect, and answers only with evidence it can cite.',
  openGraph: {
    title: 'Accord',
    description: 'Your team decided. Does your code agree?',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#fbfbfe',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh font-sans">
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </body>
    </html>
  );
}
