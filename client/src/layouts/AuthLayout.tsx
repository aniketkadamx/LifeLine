import { Outlet, Link } from "react-router-dom";

import { Activity, ShieldCheck, HeartPulse } from "lucide-react";

export function AuthLayout() {
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-background text-foreground flex flex-col justify-between p-4 sm:p-6 lg:p-8 antialiased">
      {/* Brand Header */}
      <header className="w-full max-w-7xl mx-auto flex items-center justify-between py-2">
        <Link to="/" className="flex items-center gap-2.5 font-bold text-xl tracking-tight">
          <div className="flex size-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-xs">
            <Activity className="size-6" />
          </div>
          <span className="text-foreground">LifeLine</span>
        </Link>
        <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground bg-muted/60 px-3 py-1.5 rounded-full border border-border">
          <ShieldCheck className="size-4 text-emerald-600 dark:text-emerald-400" />
          <span>HIPAA & FHIR Ready Platform</span>
        </div>
      </header>

      {/* Centered Content Card Shell */}
      <main className="w-full max-w-md mx-auto my-8">
        <Outlet />
      </main>

      {/* Trust & Compliance Footer */}
      <footer className="w-full max-w-7xl mx-auto py-4 text-center text-xs text-muted-foreground border-t border-border/60">
        <div className="flex items-center justify-center gap-1.5 mb-1 text-muted-foreground">
          <HeartPulse className="size-3.5 text-primary" />
          <span>LifeLine Digital Healthcare & Telemedicine Network</span>
        </div>
        <p>© {new Date().getFullYear()} LifeLine Platform. All rights reserved. Secure 256-bit encrypted session.</p>
      </footer>
    </div>
  );
}
