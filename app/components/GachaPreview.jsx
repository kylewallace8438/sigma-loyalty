/* eslint-disable react/prop-types -- the project doesn't use PropTypes */
import { useEffect, useRef, useState } from "react";
import { GACHA_TIERS, NO_ROLLS, buildReel, pickReward, rollWithPity } from "../services/gacha/tiers";
import styles from "./GachaPreview.module.css";

const CARD = 132;
const GAP = 8;
const WINNER_INDEX = 42;
const SPIN_MS = 6000;
// Fast start, long slow stop.
const EASING = "cubic-bezier(0.08, 0.6, 0.12, 1)";
const BATCH = 10;

/**
 * Case-opening style reel: the reward is rolled first (by tier odds), then the strip scrolls
 * until that card stops under the marker, a little off-centre so it doesn't look scripted.
 * With `pity` ({ gold, purple }, see rollWithPity), the guarantees apply and the rolls are counted
 * across spins, with a button to roll several at once without the animation.
 * Only a preview: nothing is saved or given to anyone.
 */
export function GachaPreview({ pool, pity }) {
  const viewportRef = useRef(null);
  const stripRef = useRef(null);
  const [reel, setReel] = useState([]);
  const [spin, setSpin] = useState(null); // { winner, offset, counters, guaranteed } while spinning
  const [result, setResult] = useState(null);
  const [counters, setCounters] = useState(NO_ROLLS);
  const [rolls, setRolls] = useState(0);
  const [batch, setBatch] = useState(null); // tier counts of the last instant batch

  const empty = Object.values(pool).every((rules) => !rules.length);

  // Idle reel, rebuilt when the pool changes. Built after mount: Math.random would differ on the server.
  useEffect(() => {
    if (spin) return;
    setResult(null);
    setBatch(null);
    setReel(empty ? [] : buildReel(pool, pickReward(pool)));
    if (stripRef.current) {
      stripRef.current.style.transition = "none";
      stripRef.current.style.transform = "translateX(0)";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool]);

  // New guarantees: start counting again.
  useEffect(() => reset(), [pity?.gold, pity?.purple]);

  // Runs once the new reel is rendered (start() already moved the strip back): scroll to the winner.
  useEffect(() => {
    const strip = stripRef.current;
    if (!spin || !strip) return;
    void strip.offsetWidth; // apply the reset before the transition starts

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    strip.style.transition = reduceMotion ? "none" : `transform ${SPIN_MS}ms ${EASING}`;
    strip.style.transform = `translateX(${-spin.offset}px)`;
    if (reduceMotion) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spin]);

  const start = () => {
    const roll = rollWithPity(pool, pity, counters);
    const viewport = viewportRef.current?.clientWidth ?? 0;
    // Land anywhere on the winning card except its outer 12px.
    const jitter = (Math.random() - 0.5) * (CARD - 24);
    const offset = WINNER_INDEX * (CARD + GAP) + CARD / 2 - viewport / 2 + jitter;
    const strip = stripRef.current;
    strip.style.transition = "none";
    strip.style.transform = "translateX(0)";
    setResult(null);
    setBatch(null);
    setReel(buildReel(pool, roll.reward, { winnerIndex: WINNER_INDEX }));
    setSpin({ winner: roll.reward, offset, counters: roll.counters, guaranteed: roll.guaranteed });
  };

  const finish = () => {
    if (!spin) return;
    setResult({ ...spin.winner, guaranteed: spin.guaranteed });
    setCounters(spin.counters);
    setRolls((n) => n + 1);
    setSpin(null);
  };

  const rollBatch = () => {
    const tally = { counts: {}, guaranteed: 0 };
    let next = counters;
    for (let i = 0; i < BATCH; i++) {
      const roll = rollWithPity(pool, pity, next);
      next = roll.counters;
      tally.counts[roll.reward.tier] = (tally.counts[roll.reward.tier] ?? 0) + 1;
      if (roll.guaranteed) tally.guaranteed++;
    }
    setCounters(next);
    setRolls((n) => n + BATCH);
    setResult(null);
    setBatch(tally);
  };

  function reset() {
    setCounters(NO_ROLLS);
    setRolls(0);
    setBatch(null);
  }

  return (
    <s-stack gap="base">
      <div
        ref={viewportRef}
        className={styles.viewport}
        style={{ "--card": `${CARD}px`, "--gap": `${GAP}px` }}
        aria-hidden="true"
      >
        <div ref={stripRef} className={styles.strip} onTransitionEnd={finish}>
          {reel.map(({ tier, rule }, i) => (
            <div
              // Cards are rebuilt on every spin; index keys are fine.
              key={i}
              className={`${styles.card} ${result && i === WINNER_INDEX ? styles.won : ""}`}
              style={{ "--tier": GACHA_TIERS[tier].color }}
            >
              <span className={styles.cardTitle}>{rule.title}</span>
              <span className={styles.cardValue}>{rule.value}</span>
              <span className={styles.cardBar} />
            </div>
          ))}
          {empty && <div style={{ height: 132 }} />}
        </div>
        <div className={styles.marker} />
      </div>

      <s-stack direction="inline" gap="base" alignItems="center">
        <s-button variant="primary" onClick={start} disabled={empty || Boolean(spin) || undefined}>
          {spin ? "Spinning…" : "Try a spin"}
        </s-button>
        {pity && (
          <>
            <s-button onClick={rollBatch} disabled={empty || Boolean(spin) || undefined}>
              Roll {BATCH} instantly
            </s-button>
            <s-button variant="tertiary" onClick={reset} disabled={!rolls || Boolean(spin) || undefined}>
              Reset count
            </s-button>
          </>
        )}
        <span role="status">
          {empty ? (
            <s-text color="subdued">Put at least one active rule in a tier to try the preview.</s-text>
          ) : result ? (
            <s-text>
              Won: <TierSwatch tier={result.tier} /> <s-text type="strong">{result.rule.title}</s-text> (
              {GACHA_TIERS[result.tier].label}, {result.rule.value})
              {result.guaranteed && (
                <>
                  {" "}
                  <s-badge tone="info">Guaranteed</s-badge>
                </>
              )}
            </s-text>
          ) : batch ? (
            <s-text>
              {BATCH} rolls:{" "}
              {Object.entries(GACHA_TIERS)
                .filter(([tier]) => batch.counts[tier])
                .map(([tier, { label }]) => `${batch.counts[tier]} ${label}`)
                .join(", ")}
              {batch.guaranteed ? ` (${batch.guaranteed} guaranteed)` : ""}
            </s-text>
          ) : null}
        </span>
      </s-stack>

      {pity && !empty && <PityStatus pool={pool} pity={pity} counters={counters} rolls={rolls} />}
    </s-stack>
  );
}

// "Roll 12 · Gold within 78 more rolls · Purple or better within 3 more rolls".
function PityStatus({ pool, pity, counters, rolls }) {
  const parts = [`Rolls so far: ${rolls}`];
  const within = (limit, since) => {
    const left = limit - since;
    return left === 1 ? "on the next roll" : `within ${left} more rolls`;
  };
  if (pity.gold && pool.GOLD.length) parts.push(`Gold ${within(pity.gold, counters.sinceGold)}`);
  if (pity.purple && (pool.PURPLE.length || pool.GOLD.length)) {
    parts.push(`Purple or better ${within(pity.purple, counters.sincePurple)}`);
  }
  if (parts.length === 1) parts.push("No guarantees");
  return <s-text color="subdued">{parts.join(" · ")}</s-text>;
}

/** Small coloured square for a tier, for use next to tier names. */
export function TierSwatch({ tier }) {
  return <span className={styles.swatch} style={{ "--tier": GACHA_TIERS[tier].color }} />;
}
