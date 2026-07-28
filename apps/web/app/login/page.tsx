import type { Metadata } from 'next';
import { LoginForm } from '@/components/login-form';

export const metadata: Metadata = {
  title: 'Sign in · WashQueue KZ',
  description: 'Sign in to your WashQueue KZ customer account.',
};

export default function LoginPage() {
  return (
    <main className="registration-page">
      <section className="registration-card" aria-labelledby="login-heading">
        <header className="registration-header">
          <div className="brand-mark" aria-hidden="true">
            WQ
          </div>
          <div>
            <p className="eyebrow">Customer login</p>
            <h1 id="login-heading">Sign in to your account</h1>
            <p className="subtitle">Continue with your registered customer account.</p>
          </div>
        </header>
        <LoginForm />
      </section>
    </main>
  );
}
