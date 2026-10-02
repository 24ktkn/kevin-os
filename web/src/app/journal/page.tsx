'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function DailyJournalRedirect() {
  const router = useRouter();

  useEffect(() => {
    router.replace('/health');
  }, [router]);

  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-[#0A0A0D] text-white">
      <div className="text-center space-y-3">
        <div className="animate-spin h-8 w-8 border-2 border-cyan-400 border-t-transparent rounded-full mx-auto" />
        <p className="text-sm font-semibold text-zinc-300">Redirecting to Health Tracker...</p>
      </div>
    </div>
  );
}
