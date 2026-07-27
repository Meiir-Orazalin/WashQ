import type { Metadata } from 'next';
import { RegistrationForm } from '@/components/registration-form';

export const metadata: Metadata = {
  title: 'Create account · WashQueue KZ',
  description: 'Create a WashQueue KZ customer account.',
};

export default function RegisterPage() {
  return (
    <main className="registration-page">
      <section className="registration-card" aria-labelledby="registration-heading">
        <header className="registration-header">
          <div className="brand-mark" aria-hidden="true">
            WQ
          </div>
          <div>
            <p className="eyebrow">Customer registration</p>
            <h1 id="registration-heading">Create your account</h1>
            <p className="subtitle">Get ready to add vehicles and book car washes later.</p>
          </div>
        </header>
        <RegistrationForm />
      </section>
    </main>
  );
}
