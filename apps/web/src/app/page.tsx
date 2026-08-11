'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Dashboard } from '@/components/dashboard';
import { api, setCsrfToken, type SessionResponse } from '@/lib/api';

export default function HomePage() {
  const router = useRouter();
  const session = useQuery({
    queryKey: ['session'],
    queryFn: () => api<SessionResponse>('/auth/session'),
    retry: false,
  });
  useEffect(() => {
    if (session.isError) router.replace('/login');
    if (session.data) setCsrfToken(session.data.csrfToken);
  }, [router, session.data, session.isError]);
  if (!session.data)
    return (
      <main className="loading-screen">
        <div className="brand">
          <span className="brand-mark brand-mark-logo">
            <img src="/brand/constack-logo.png" alt="" draggable={false} />
          </span>
          <span>CONSTACK</span>
        </div>
        <p>Connecting to the cluster twin…</p>
      </main>
    );
  return <Dashboard session={session.data} />;
}
