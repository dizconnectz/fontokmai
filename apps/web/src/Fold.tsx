import type { ReactNode } from 'react';

/**
 * A side-panel section folded to its heading line, which carries the section's key figure (user 2026-10-01: the
 * panel was about six screens long; the whole picture should be read at a glance). The status bar opens one.
 */
export function Fold({
  id,
  headingId,
  heading,
  headingClass,
  className,
  testId,
  open = false,
  children,
}: {
  id: string;
  headingId: string;
  heading: ReactNode;
  headingClass?: string;
  className?: string;
  testId?: string;
  /** open at first (the reader can still fold it) */
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className={`panel-section fold${className ? ` ${className}` : ''}`}
      aria-labelledby={headingId}
      data-testid={testId}
    >
      <details open={open || undefined}>
        <summary>
          <h2 id={headingId} className={headingClass}>
            {heading}
          </h2>
        </summary>
        <div className="fold-body">{children}</div>
      </details>
    </section>
  );
}

/** Open a folded section and bring it into view, its heading focused (the status bar's chips). */
export function openSection(id: string): void {
  const section = document.getElementById(id);
  if (!section) return;
  const details = section.querySelector('details');
  if (details) details.open = true;
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  section.querySelector('summary')?.focus({ preventScroll: true });
}
