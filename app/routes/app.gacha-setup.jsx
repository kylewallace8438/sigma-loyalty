import { useEffect, useMemo, useRef, useState } from "react";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import { GachaPreview, TierSwatch } from "../components/GachaPreview";
import { GACHA_TIERS, MAX_PITY, buildPool, effectiveOdds, validatePity } from "../services/gacha/tiers";
import {
  getPityValues,
  listGachaRules,
  parsePityForm,
  parseTierForm,
  saveGachaSetup,
} from "../services/gacha/gacha.server";

// Gacha setup: pick which discount rules are gacha items (and their tier), set the
// guarantees, and try the spin with all of it, saved or not.
export const loader = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const [rules, pityValues] = await Promise.all([listGachaRules(session.shop), getPityValues(session.shop)]);
  return { rules, pityValues };
};

export const action = async ({ request }) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();
  const { pity, errors } = parsePityForm(formData);
  if (Object.keys(errors).length) return { errors };

  await saveGachaSetup(session.shop, parseTierForm(formData), pity);
  return { savedAt: Date.now() };
};

const formatOdds = (percent) => `${Number(percent.toFixed(1))}%`;
const itemsOf = (rules) => Object.fromEntries(rules.filter((r) => r.tier).map((r) => [r.id, r.tier]));

export default function GachaSetup() {
  const { rules, pityValues: savedPity } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const formRef = useRef(null);
  const addRef = useRef(null);

  const savedItems = useMemo(() => itemsOf(rules), [rules]);
  // The setup as edited on the page: { ruleId: tier } for the gacha items, and the guarantee fields as typed.
  const [items, setItems] = useState(savedItems);
  const [pityValues, setPityValues] = useState(savedPity);
  // Bumped to remount the form, so its uncontrolled fields show `items` / `pityValues` again.
  const [formVersion, setFormVersion] = useState(0);

  const discard = () => {
    setItems(savedItems);
    setPityValues(savedPity);
    setFormVersion((v) => v + 1);
  };
  // Fresh loader data (after a save): start over from it.
  useEffect(discard, [savedItems, savedPity]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (actionData?.savedAt) shopify.toast.show("Gacha setup saved");
  }, [actionData, shopify]);

  // React 18 doesn't wire onChange props on web components; listen on the form instead
  // (capture phase, in case the fields' events don't bubble). `input` keeps the demo live while typing.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onChange = () => {
      const data = new FormData(form);
      setItems((current) =>
        Object.fromEntries(Object.keys(current).map((id) => [id, String(data.get(`tier-${id}`) ?? current[id])])),
      );
      setPityValues({
        goldPity: String(data.get("goldPity") ?? ""),
        purplePity: String(data.get("purplePity") ?? ""),
      });
    };
    for (const type of ["change", "input"]) form.addEventListener(type, onChange, true);
    return () => {
      for (const type of ["change", "input"]) form.removeEventListener(type, onChange, true);
    };
  }, [formVersion]);

  const dirty =
    JSON.stringify(items) !== JSON.stringify(savedItems) ||
    pityValues.goldPity.trim() !== savedPity.goldPity ||
    pityValues.purplePity.trim() !== savedPity.purplePity;

  const itemRules = rules.filter((r) => items[r.id]);
  const otherRules = rules.filter((r) => !items[r.id]);

  const addItem = () => {
    const id = addRef.current?.value;
    if (id) setItems((current) => ({ ...current, [id]: "WHITE" }));
  };
  const removeItem = (id) =>
    setItems((current) => Object.fromEntries(Object.entries(current).filter(([key]) => key !== String(id))));

  const pool = useMemo(
    () => buildPool(rules.filter((r) => r.active && items[r.id]).map((r) => ({ ...r, tier: items[r.id] }))),
    [rules, items],
  );
  const odds = effectiveOdds(pool);
  // Checked as typed: the demo leaves out invalid guarantees, and the fields show why.
  const { pity, errors } = validatePity(pityValues);
  const demoPity = useMemo(() => pity, [pity.gold, pity.purple]); // eslint-disable-line react-hooks/exhaustive-deps
  const saving = navigation.state === "submitting";

  const save = () => submit(formRef.current, { method: "post" });

  return (
    <s-page heading="Gacha setup" inlineSize="large">
      <SaveBar id="gacha-setup-save-bar" open={dirty}>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined}>
          Save
        </button>
        <button onClick={discard}>Discard</button>
      </SaveBar>

      <s-section heading="Demo">
        <s-stack gap="base">
          <s-paragraph color="subdued">
            Try the spin with the items and guarantees below, including unsaved changes. Only active rules
            are in the pool. Nothing is given to anyone.
          </s-paragraph>
          <GachaPreview pool={pool} pity={demoPity} />
          <s-grid gridTemplateColumns="repeat(auto-fit, minmax(160px, 1fr))" gap="base">
            {Object.entries(GACHA_TIERS).map(([tier, { label }]) => (
              <s-box key={tier} padding="base" borderWidth="base" borderRadius="base">
                <s-stack gap="small-200">
                  <s-text>
                    <TierSwatch tier={tier} /> <s-text type="strong">{label}</s-text>
                  </s-text>
                  <s-heading>{pool[tier].length ? formatOdds(odds[tier]) : "—"}</s-heading>
                  <s-text color="subdued">
                    {pool[tier].length
                      ? `${pool[tier].length} active ${pool[tier].length === 1 ? "item" : "items"}`
                      : "No active items, skipped"}
                  </s-text>
                </s-stack>
              </s-box>
            ))}
          </s-grid>
        </s-stack>
      </s-section>

      {rules.length === 0 ? (
        <s-section>
          <s-stack gap="base" alignItems="center" padding="large">
            <s-heading>No discount rules yet</s-heading>
            <s-paragraph>Gacha items are discount rules. Create one first, then add it here.</s-paragraph>
            <s-button variant="primary" href="/app/discount-rules/new">
              Create rule
            </s-button>
          </s-stack>
        </s-section>
      ) : (
        <form
          ref={formRef}
          key={formVersion}
          onSubmit={(event) => {
            event.preventDefault();
            save();
          }}
        >
          <s-section heading="Items">
            <s-stack gap="base">
              {otherRules.length > 0 && (
                <s-stack direction="inline" gap="base" alignItems="end">
                  <s-select label="Add a discount rule as an item" ref={addRef}>
                    {otherRules.map((rule) => (
                      <s-option key={rule.id} value={String(rule.id)}>
                        {`${rule.title} (${rule.value})${rule.active ? "" : " · inactive"}`}
                      </s-option>
                    ))}
                  </s-select>
                  <s-button onClick={addItem}>Add item</s-button>
                </s-stack>
              )}

              {itemRules.length === 0 ? (
                <s-paragraph color="subdued">No items yet. Add discount rules above to fill the gacha.</s-paragraph>
              ) : (
                <s-table>
                  <s-table-header-row>
                    <s-table-header listSlot="primary">Item</s-table-header>
                    <s-table-header listSlot="labeled">Discount</s-table-header>
                    <s-table-header listSlot="inline">Status</s-table-header>
                    <s-table-header>Tier</s-table-header>
                    <s-table-header>
                      <s-text accessibilityVisibility="exclusive">Remove</s-text>
                    </s-table-header>
                  </s-table-header-row>
                  <s-table-body>
                    {itemRules.map((rule) => (
                      <s-table-row key={rule.id}>
                        <s-table-cell>
                          <s-link href={`/app/discount-rules/${rule.id}`}>{rule.title}</s-link>
                        </s-table-cell>
                        <s-table-cell>{rule.value}</s-table-cell>
                        <s-table-cell>
                          <s-badge tone={rule.active ? "success" : "neutral"}>
                            {rule.active ? "Active" : "Inactive, not in the pool"}
                          </s-badge>
                        </s-table-cell>
                        <s-table-cell>
                          <s-select
                            label={`Tier for ${rule.title}`}
                            labelAccessibilityVisibility="exclusive"
                            name={`tier-${rule.id}`}
                            value={items[rule.id]}
                          >
                            {Object.entries(GACHA_TIERS).map(([tier, { label }]) => (
                              <s-option key={tier} value={tier}>
                                {label}
                              </s-option>
                            ))}
                          </s-select>
                        </s-table-cell>
                        <s-table-cell>
                          <s-button
                            variant="tertiary"
                            icon="delete"
                            accessibilityLabel={`Remove ${rule.title}`}
                            onClick={() => removeItem(rule.id)}
                          />
                        </s-table-cell>
                      </s-table-row>
                    ))}
                  </s-table-body>
                </s-table>
              )}
              {/* Rules that aren't items are saved as out of the gacha. */}
              {otherRules.map((rule) => (
                <input key={rule.id} type="hidden" name={`tier-${rule.id}`} value="" />
              ))}
            </s-stack>
          </s-section>

          <s-section heading="Guarantees">
            <s-stack gap="base">
              <s-paragraph color="subdued">
                The most rolls a customer can make before they get an item of that tier. The count starts
                again each time they get one. Leave empty for no guarantee.
              </s-paragraph>
              <s-grid gridTemplateColumns="repeat(auto-fit, minmax(220px, 1fr))" gap="base">
                <s-number-field
                  label="Gold guaranteed within"
                  name="goldPity"
                  value={pityValues.goldPity}
                  min={2}
                  max={MAX_PITY}
                  step={1}
                  suffix="rolls"
                  placeholder="No guarantee"
                  error={errors.goldPity ?? actionData?.errors?.goldPity}
                  details={pity.gold && !pool.GOLD.length ? "No active Gold items, so this doesn't apply yet." : undefined}
                ></s-number-field>
                <s-number-field
                  label="Purple or better guaranteed within"
                  name="purplePity"
                  value={pityValues.purplePity}
                  min={2}
                  max={MAX_PITY}
                  step={1}
                  suffix="rolls"
                  placeholder="No guarantee"
                  error={errors.purplePity ?? actionData?.errors?.purplePity}
                  details={
                    pity.purple && !pool.PURPLE.length && !pool.GOLD.length
                      ? "No active Purple or Gold items, so this doesn't apply yet."
                      : undefined
                  }
                ></s-number-field>
              </s-grid>
            </s-stack>
          </s-section>
        </form>
      )}
    </s-page>
  );
}
