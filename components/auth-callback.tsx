"use client";

import Link from "next/link";

export function AuthCallback() {
  return (
    <main className="centered-page">
      <div className="panel callback-panel">
        <p className="eyebrow">Email Sign-In</p>
        <h1>You&apos;re signed in.</h1>
        <p className="muted">
          Your email link was confirmed. You can close this tab or continue straight to your pools.
        </p>
        <Link className="primary-button" href="/">
          Go to my pools
        </Link>
      </div>
    </main>
  );
}
