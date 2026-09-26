import { Zap } from "lucide-react";
import { useCountUp } from "./use-count-up";

type UsageReview = {
  tokenUsage?: { input: number; output: number; total: number; requests: number };
};

const format = new Intl.NumberFormat("en-US");

function validUsage(review: UsageReview) {
  const usage = review.tokenUsage;
  return usage && [usage.input, usage.output, usage.total, usage.requests].every((value) => Number.isFinite(value) && value >= 0) ? usage : null;
}

export function UsageSection({ reviews }: { reviews: UsageReview[] }) {
  const recorded = reviews.map(validUsage).filter((usage): usage is NonNullable<typeof usage> => usage !== null);
  const totals = recorded.reduce((sum, usage) => ({
    input: sum.input + usage.input,
    output: sum.output + usage.output,
    total: sum.total + usage.total,
    requests: sum.requests + usage.requests,
  }), { input: 0, output: 0, total: 0, requests: 0 });
  const measuredTokens = totals.input + totals.output;
  const inputShare = measuredTokens ? totals.input / measuredTokens * 100 : 0;
  const totalDisplay = useCountUp(recorded.length ? totals.total : null);
  const inputDisplay = useCountUp(recorded.length ? totals.input : null);
  const outputDisplay = useCountUp(recorded.length ? totals.output : null);
  const requestDisplay = useCountUp(recorded.length ? totals.requests : null);

  return <section className="rw-usage-section" aria-labelledby="rw-usage-heading">
    <div className="rw-section-head"><h2 id="rw-usage-heading">Token &amp; usage</h2><span>{recorded.length} / {reviews.length} runs recorded</span></div>
    <div className="rw-usage-panel">
      <div className="rw-usage-metrics">
        <div className="rw-usage-total"><span><Zap size={15} /> Total tokens</span><strong className="rw-count-up">{recorded.length ? format.format(totalDisplay) : "—"}</strong><small>Across recorded reviews in this workspace</small></div>
        <div><span>Input</span><strong className="rw-count-up">{recorded.length ? format.format(inputDisplay) : "—"}</strong></div>
        <div><span>Output</span><strong className="rw-count-up">{recorded.length ? format.format(outputDisplay) : "—"}</strong></div>
        <div><span>Model calls</span><strong className="rw-count-up">{recorded.length ? format.format(requestDisplay) : "—"}</strong></div>
      </div>
      {measuredTokens > 0 && <><div className="rw-usage-breakdown" aria-label={`Input ${Math.round(inputShare)}%, output ${Math.round(100 - inputShare)}%`}>
          <span className="input" style={{ width: `${inputShare}%` }} /><span className="output" style={{ width: `${100 - inputShare}%` }} />
        </div>
        <div className="rw-usage-legend"><span><i className="input" /> Input</span><span><i className="output" /> Output</span></div></>}
      {!recorded.length && <p className="rw-usage-empty">Token usage will appear here when SynthScholar records model calls.</p>}
    </div>
  </section>;
}
