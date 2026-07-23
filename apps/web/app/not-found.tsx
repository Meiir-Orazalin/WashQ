import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="centered-state">
      <p className="eyebrow">404</p>
      <h1>Page not found</h1>
      <p>The requested development route does not exist.</p>
      <Link href="/">Return home</Link>
    </main>
  );
}
