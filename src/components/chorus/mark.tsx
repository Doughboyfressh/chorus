export function ChorusMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
    >
      <circle cx="16" cy="6" r="2.4" />
      <circle cx="6" cy="16" r="2.4" />
      <circle cx="26" cy="16" r="2.4" />
      <circle cx="11" cy="26" r="2.4" />
      <circle cx="21" cy="26" r="2.4" />
      <path d="M16 8.4V12M16 12L7.8 15.2M16 12L24.2 15.2M7.8 17.6L11.4 24M24.2 17.6L20.6 24M13.4 26H18.6" />
    </svg>
  );
}
