import { HomeContent } from '@/components/HomeContent';
import { RateLimitBanner } from '@/components/auth/RateLimitBanner';

export default function Home() {
  return (
    <div className="flex flex-col h-full w-full overflow-y-auto">
      <section className="flex-1 flex flex-col min-h-min">
        <RateLimitBanner className="mx-2 mt-2" />
        
        {/* Main OpenReader Dashboard */}
        <div className="flex-1">
          <HomeContent />
        </div>
      </section>
    </div>
  );
}