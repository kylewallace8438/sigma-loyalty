/* eslint-disable react/prop-types -- the project doesn't use PropTypes */
import { useEffect, useRef } from "react";

// A removable chip. React 18 doesn't wire custom events (the chip's "remove"), so listen directly.
function Chip({ label, onRemove }) {
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current;
    el?.addEventListener("remove", onRemove);
    return () => el?.removeEventListener("remove", onRemove);
  }, [onRemove]);
  return (
    <s-clickable-chip ref={ref} removable accessibilityLabel={`Remove ${label}`}>
      {label}
    </s-clickable-chip>
  );
}

/**
 * Products or collections picked with the App Bridge resource picker, shown as removable chips.
 * `items` is [{ id, title }]; `onPick` opens the picker; `onRemove(id)` drops one.
 */
export function ResourceSelection({ label, items, onPick, onRemove, error }) {
  return (
    <s-stack gap="small-200">
      <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
        <s-text type="strong">{label}</s-text>
        <s-button onClick={onPick}>{items.length ? "Change" : "Select"}</s-button>
      </s-stack>
      {items.length ? (
        <s-stack direction="inline" gap="small-200">
          {items.map((item) => (
            <Chip key={item.id} label={item.title || item.id} onRemove={() => onRemove(item.id)} />
          ))}
        </s-stack>
      ) : (
        <s-text color="subdued">None selected</s-text>
      )}
      {error && <s-text tone="critical">{error}</s-text>}
    </s-stack>
  );
}

/** Opens the resource picker for `type` ("product" | "collection"); resolves to [{ id, title }] or null. */
export async function pickResources(shopify, type, selected, { multiple = true } = {}) {
  const picked = await shopify.resourcePicker({
    type,
    multiple,
    selectionIds: selected.map((item) => ({ id: item.id })),
  });
  return picked ? picked.map((item) => ({ id: item.id, title: item.title })) : null;
}
