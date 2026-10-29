export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight text-ink">
      <svg width="22" height="22" viewBox="0 0 32 32" aria-hidden="true">
        <rect x="3" y="6" width="12" height="18" rx="3" fill="#fff" stroke="#1B1E27" strokeWidth="1.7" />
        <rect x="17" y="8" width="12" height="18" rx="3" fill="#fff" stroke="#1D4ED8" strokeWidth="1.7" />
        <path d="M14 16.5h5" stroke="#1D4ED8" strokeWidth="1.7" strokeLinecap="round" />
        <path d="M17.2 14.2 20 16.5l-2.8 2.3" stroke="#1D4ED8" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {compact ? null : "Flowboard"}
    </span>
  );
}
