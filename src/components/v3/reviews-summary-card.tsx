'use client';

import { seededGradient } from '@/lib/seeded-gradient';
import { scoreColor, VERDICT_META, VERDICTS, type Verdict } from '@/lib/review-verdict';
import type { ReviewsSummary } from '@/lib/reviews-server';

/**
 * ReviewsSummaryCard (F12) — the friends'-score card atop the reviews wall: the
 * film poster + a big verdict-coloured aggregate score + a loved/liked/fine/nope
 * distribution histogram. Theme-aware via tokens; the verdict colours are fixed
 * (they read the same on both themes, like the design).
 */
export function ReviewsSummaryCard({
  title,
  posterUrl,
  summary,
}: {
  title: string;
  posterUrl?: string | null;
  summary: ReviewsSummary;
}) {
  const { score, count, distribution } = summary;
  const maxBucket = Math.max(1, ...VERDICTS.map((v) => distribution[v]));

  return (
    <div className="rounded-[20px] border border-hair bg-card p-4 shadow-lift">
      <div className="flex gap-4">
        {/* poster */}
        <div
          className="relative h-[92px] w-[62px] flex-shrink-0 overflow-hidden rounded-[12px] shadow-photo"
          style={posterUrl ? undefined : { background: seededGradient(title) }}
        >
          {posterUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={posterUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>

        {/* score */}
        <div className="min-w-0 flex-1">
          <div className="cc-eyebrow truncate">score · {title}</div>
          <div className="mt-1 flex items-baseline gap-1.5">
            <span
              className="font-headline text-[40px] font-bold leading-none tabular-nums"
              style={{ color: score != null ? scoreColor(score) : 'var(--muted-foreground)' }}
            >
              {score != null ? score.toFixed(1) : '–'}
            </span>
            <span className="font-mono text-[13px] text-muted-foreground">/ 10</span>
            <span className="font-ui text-[14px] text-muted-foreground">
              · {count} {count === 1 ? 'review' : 'reviews'}
            </span>
          </div>
        </div>
      </div>

      {/* distribution histogram */}
      <div className="mt-4 space-y-2">
        {VERDICTS.map((v: Verdict) => {
          const n = distribution[v];
          const pct = Math.round((n / maxBucket) * 100);
          return (
            <div key={v} className="flex items-center gap-3">
              <span className="w-12 flex-shrink-0 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                {v}
              </span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-foreground/[0.08]">
                <span
                  className="block h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${pct}%`, backgroundColor: VERDICT_META[v].color }}
                />
              </span>
              <span className="w-4 flex-shrink-0 text-right font-mono text-[12px] tabular-nums text-muted-foreground">
                {n}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
