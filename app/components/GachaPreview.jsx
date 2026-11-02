/* eslint-disable react/prop-types -- the project doesn't use PropTypes */
import { useEffect, useRef, useState } from "react";
import { GACHA_TIERS, buildReel, pickReward } from "../services/gacha/tiers";
import styles from "./GachaPreview.module.css";

const CARD = 132;
const GAP = 8;
const WINNER_INDEX = 42;
const SPIN_MS = 6000;
// Fast start, long slow stop.
const EASING = "cubic-bezier(0.08, 0.6, 0.12, 1)";

/**
 * Case-opening style reel: the reward is rolled first (by tier odds), then the strip scrolls
 * until that card stops under the marker, a little off-centre so it doesn't look scripted.
 * Only a preview: nothing is saved or given to anyone.
 */
export function GachaPreview({ pool }) {
  const viewportRef = useRef(null);
  const stripRef = useRef(null);
  const [reel, setReel] = useState([]);
  const [spin, setSpin] = useState(null); // { winner, offset } while spinning
  const [result, setResult] = useState(null);

  const empty = Object.values(pool).every((rules) => !rules.length);

  // Idle reel, rebuilt when the pool changes. Built after mount: Math.random would differ on the server.
  useEffect(() => {
    if (spin) return;
    setResult(null);
    setReel(empty ? [] : buildReel(pool, pickReward(pool)));
    if (stripRef.current) {
      stripRef.current.style.transition = "none";
      stripRef.current.style.transform = "translateX(0)";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pool]);

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
    const winner = pickReward(pool);
    const viewport = viewportRef.current?.clientWidth ?? 0;
    // Land anywhere on the winning card except its outer 12px.
    const jitter = (Math.random() - 0.5) * (CARD - 24);
    const offset = WINNER_INDEX * (CARD + GAP) + CARD / 2 - viewport / 2 + jitter;
    const strip = stripRef.current;
    strip.style.transition = "none";
    strip.style.transform = "translateX(0)";
    setResult(null);
    setReel(buildReel(pool, winner, { winnerIndex: WINNER_INDEX }));
    setSpin({ winner, offset });
  };

  const finish = () => {
    if (!spin) return;
    setResult(spin.winner);
    setSpin(null);
  };

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
        <span role="status">
          {empty ? (
            <s-text color="subdued">Put at least one active rule in a tier to try the preview.</s-text>
          ) : result ? (
            <s-text>
              Won:{" "}
              <span className={styles.swatch} style={{ "--tier": GACHA_TIERS[result.tier].color }} />{" "}
              <s-text type="strong">{result.rule.title}</s-text> ({GACHA_TIERS[result.tier].label},{" "}
              {result.rule.value})
            </s-text>
          ) : null}
        </span>
      </s-stack>
    </s-stack>
  );
}

/** Small coloured square for a tier, for use next to tier names. */
export function TierSwatch({ tier }) {
  return <span className={styles.swatch} style={{ "--tier": GACHA_TIERS[tier].color }} />;
}
