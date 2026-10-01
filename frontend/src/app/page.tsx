import { Architecture } from '@/components/Architecture';
import { Contact } from '@/components/Contact';
import { FAQ } from '@/components/FAQ';
import { Features } from '@/components/Features';
import { Footer } from '@/components/Footer';
import { Hero } from '@/components/Hero';
import { HowItWorks } from '@/components/HowItWorks';
import { Navbar } from '@/components/Navbar';
import { Problem } from '@/components/Problem';
import { TechStack } from '@/components/TechStack';

export default function Home() {
  return (
    <>
      <Navbar />
      <main className="overflow-x-clip">
        <Hero />
        <Problem />
        <HowItWorks />
        <Features />
        <Architecture />
        <TechStack />
        <FAQ />
        <Contact />
      </main>
      <Footer />
    </>
  );
}
