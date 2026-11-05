"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {path}
  </svg>
);

const NAV = [
  { href: "/", label: "Overview", icon: icon(<><rect x="3" y="3" width="8" height="8" rx="2" /><rect x="13" y="3" width="8" height="5" rx="2" /><rect x="13" y="10" width="8" height="11" rx="2" /><rect x="3" y="13" width="8" height="8" rx="2" /></>) },
  { href: "/forecast", label: "Forecast", icon: icon(<><path d="M3 17l5-5 4 3 8-9" /><path d="M16 6h4v4" /></>) },
  { href: "/zones", label: "Zones", icon: icon(<><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></>) },
  { href: "/models", label: "Models", icon: icon(<><circle cx="6" cy="6" r="2.5" /><circle cx="18" cy="6" r="2.5" /><circle cx="12" cy="18" r="2.5" /><path d="M7.5 8l3.5 7.6M16.5 8L13 15.6" /></>) },
  { href: "/about", label: "Data", icon: icon(<><ellipse cx="12" cy="5.5" rx="8" ry="3" /><path d="M4 5.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6M4 11.5v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" /></>) },
];

function ThemeButton() {
  const [dark, setDark] = useState<boolean | null>(null);

  useEffect(() => {
    const stored = document.documentElement.dataset.theme;
    const next = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    // The theme can only be known in the browser, so it is read after mounting.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDark(next);
  }, []);

  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // The choice simply won't persist if storage is blocked.
    }
  };

  return (
    <button type="button" className="theme-btn" onClick={toggle}>
      {dark === null ? "Theme" : dark ? "Use light theme" : "Use dark theme"}
    </button>
  );
}

export function Shell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <div className="shell">
      <aside className="rail">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>Parking Occupancy Forecasts</span>
        </div>
        <nav className="nav" aria-label="Main">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} aria-current={pathname === item.href ? "page" : undefined}>
              {item.icon}
              <span>{item.label}</span>
            </Link>
          ))}
        </nav>
        <div className="rail-foot">
          <ThemeButton />
          <span>
            Historical data from{" "}
            <a href="https://archive.ics.uci.edu/dataset/482/parking+birmingham" target="_blank" rel="noreferrer">
              UCI Parking Birmingham
            </a>
            , CC BY 4.0.
          </span>
        </div>
      </aside>
      <main className="main">
        <div className="mobile-top">
          <span>Parking Occupancy Forecasts</span>
          <ThemeButton />
        </div>
        <div className="historical-note" role="note">
          <span>
            <strong>Historical data, not a live feed.</strong> Readings are from Oct to Dec 2016, about 08:00 to 16:30.
          </span>
        </div>
        {children}
      </main>
    </div>
  );
}
