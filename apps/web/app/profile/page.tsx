import type { Metadata } from 'next';
import { Profile } from '@/components/profile';

export const metadata: Metadata = {
  title: 'Your profile · WashQueue KZ',
  description: 'View your account and update your profile names.',
};

export default function ProfilePage() {
  return (
    <main className="registration-page">
      <div className="registration-card profile-card">
        <header className="registration-header">
          <div>
            <p className="eyebrow">WashQueue KZ</p>
            <h1>Your profile</h1>
          </div>
        </header>
        <Profile />
      </div>
    </main>
  );
}
