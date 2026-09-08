import type { Metadata } from 'next';
import { Vehicles } from '@/components/vehicles';

export const metadata: Metadata = {
  title: 'Your vehicles · WashQueue KZ',
  description: 'Add, view, edit and delete your saved vehicles.',
};

export default function VehiclesPage() {
  return (
    <main className="vehicles-page">
      <header>
        <p className="eyebrow">WashQueue KZ</p>
        <h1>Your garage</h1>
      </header>
      <Vehicles />
    </main>
  );
}
