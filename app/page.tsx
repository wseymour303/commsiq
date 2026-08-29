import { AuthGate } from '@/components/auth-gate';
import { AppShell } from '@/components/app-shell';

export default function HomePage() {
  return (
    <AuthGate>
      <AppShell />
    </AuthGate>
  );
}
