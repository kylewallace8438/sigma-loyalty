/* eslint-disable react/prop-types -- the project doesn't use PropTypes */
import { useCallback, useEffect, useRef, useState } from "react";
import { useActionData, useLoaderData, useNavigation, useSubmit } from "react-router";
import { SaveBar, useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import {
  MAX_POINTS,
  getEarningRule,
  parseEarningRuleForm,
  saveEarningRule,
  toEarningFormValues,
} from "../services/earning/rules.server";
import { getSettings, pointsLabel } from "../services/settings/settings.server";
import { listRules } from "../services/discounts/rules.server";
import { EARNING_TYPE, ITEM_SCOPES, ORDER_METHODS, typeFromSlug } from "../services/earning/types";
import { NOTICE_DAYS } from "../services/earning/birthday.server";
import { ResourceSelection, pickResources } from "../components/ResourceSelection";

// /app/earning/:type, e.g. /app/earning/place-order: edit one earning rule.
function parseType(slug) {
  const type = typeFromSlug(slug);
  if (!type) throw new Response("Not found", { status: 404 });
  return type;
}

export const loader = async ({ request, params }) => {
  const { session } = await authenticate.admin(request);
  const type = parseType(params.type);
  const [rule, settings, discountRules] = await Promise.all([
    getEarningRule(session.shop, type),
    getSettings(session.shop),
    EARNING_TYPE[type].kind === "referral" ? listRules(session.shop) : [],
  ]);
  return {
    type,
    values: toEarningFormValues(rule),
    pointsName: pointsLabel(settings),
    noticeDays: NOTICE_DAYS,
    maxPoints: MAX_POINTS,
    discountRules: discountRules.map((r) => ({ id: String(r.id), title: r.title, active: r.active })),
  };
};

export const action = async ({ request, params }) => {
  const { session, redirect } = await authenticate.admin(request);
  const type = parseType(params.type);
  const { data, values, errors } = parseEarningRuleForm(type, await request.formData());
  if (Object.keys(errors).length) return { values, errors };
  await saveEarningRule(session.shop, type, data);
  return redirect("/app/earning?notice=saved");
};

// The form's fields as one string, to tell whether anything changed since it was loaded.
const snapshot = (form) => JSON.stringify([...new FormData(form).entries()]);

export default function EarningRuleForm() {
  const { type, values: saved, pointsName, noticeDays, maxPoints, discountRules } = useLoaderData();
  const actionData = useActionData();
  const navigation = useNavigation();
  const submit = useSubmit();
  const shopify = useAppBridge();
  const formRef = useRef(null);
  const meta = EARNING_TYPE[type];

  // After a failed submit, start from what the merchant sent rather than the stored values.
  const initial = actionData?.values ?? saved;
  const errors = actionData?.errors ?? {};
  const [method, setMethod] = useState(initial.method);
  const [itemScope, setItemScope] = useState(initial.itemScope);
  const [rewardType, setRewardType] = useState(initial.rewardType);
  const [products, setProducts] = useState(initial.products);
  const [collections, setCollections] = useState(initial.collections);
  // Bumped to remount the form (discard), so its uncontrolled fields show `initial` again.
  const [formVersion, setFormVersion] = useState(0);
  const [baseline, setBaseline] = useState(null);
  const [current, setCurrent] = useState(null);

  const reset = useCallback(() => {
    setMethod(initial.method);
    setItemScope(initial.itemScope);
    setRewardType(initial.rewardType);
    setProducts(initial.products);
    setCollections(initial.collections);
    setBaseline(null);
    setFormVersion((v) => v + 1);
  }, [initial]);
  useEffect(reset, [reset]);

  // React 18 doesn't wire onChange props on web components; listen on the form instead.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const onChange = () => {
      const data = new FormData(form);
      setMethod(String(data.get("method") ?? ""));
      setItemScope(String(data.get("itemScope") ?? ""));
      setRewardType(String(data.get("rewardType") ?? "POINTS"));
      setCurrent(snapshot(form));
    };
    for (const event of ["change", "input"]) form.addEventListener(event, onChange, true);
    return () => {
      for (const event of ["change", "input"]) form.removeEventListener(event, onChange, true);
    };
  }, [formVersion]);

  // The hidden selection fields change with state, not events: re-read the form after each render.
  useEffect(() => {
    const form = formRef.current;
    if (!form) return;
    const now = snapshot(form);
    setCurrent(now);
    setBaseline((b) => b ?? now);
  }, [formVersion, products, collections, method, itemScope, rewardType]);

  const dirty = baseline !== null && current !== null && current !== baseline;
  const saving = navigation.state === "submitting";
  const save = () => submit(formRef.current, { method: "post" });

  const pick = async (resource, selected, setSelected) => {
    const picked = await pickResources(shopify, resource, selected);
    if (picked) setSelected(picked);
  };

  const perAmount = method === ORDER_METHODS.PER_AMOUNT;
  const coupon = meta.kind === "referral" && rewardType === "COUPON";
  const scoped = perAmount && itemScope !== ITEM_SCOPES.ALL;
  const unit = pointsName.toLowerCase();

  return (
    <s-page heading={initial.name || meta.defaultName} inlineSize="small">
      <s-link slot="breadcrumb-actions" href="/app/earning">
        Earning rules
      </s-link>
      <SaveBar id="earning-rule-save-bar" open={dirty || Boolean(actionData?.errors)}>
        <button variant="primary" onClick={save} loading={saving ? "" : undefined}>
          Save
        </button>
        <button onClick={reset}>Discard</button>
      </SaveBar>

      <form
        ref={formRef}
        key={formVersion}
        onSubmit={(event) => {
          event.preventDefault();
          save();
        }}
      >
        <s-stack gap="base">
          {Object.keys(errors).length > 0 && (
            <s-banner tone="critical" heading="The rule wasn't saved">
              Fix the highlighted fields and save again.
            </s-banner>
          )}

          <s-section>
            <s-stack gap="base">
              <s-paragraph color="subdued">{meta.description}</s-paragraph>
              <s-switch label="Active" name="active" checked={initial.active || undefined}></s-switch>
              <s-text-field
                label="Name"
                name="name"
                value={initial.name}
                maxLength={100}
                details="Customers see this in the rewards widget and in their points history."
                error={errors.name}
                required
              ></s-text-field>
              {meta.kind === "referral" && (
                <s-choice-list name="rewardType" label="Reward" values={[initial.rewardType]} error={errors.rewardType}>
                  <s-choice value="POINTS">{pointsName}</s-choice>
                  <s-choice value="COUPON">A discount code</s-choice>
                </s-choice-list>
              )}
              {coupon ? (
                <>
                  {/* Keeps the points setting for when the rule goes back to giving points. */}
                  <input type="hidden" name="points" value={initial.points} />
                  <s-select
                    label="Discount code from"
                    name="discountRuleId"
                    value={initial.discountRuleId}
                    placeholder="Choose a discount rule"
                    details="Customers get a code for this reward, without spending points. The rule can be inactive to keep it off the redeem list."
                    error={errors.discountRuleId}
                  >
                    {discountRules.map((r) => (
                      <s-option key={r.id} value={r.id}>
                        {r.active ? r.title : `${r.title} (inactive)`}
                      </s-option>
                    ))}
                  </s-select>
                  {discountRules.length === 0 && (
                    <s-text tone="critical">
                      Create a discount rule first, in <s-link href="/app/discount-rules/new">Discount rules</s-link>.
                    </s-text>
                  )}
                </>
              ) : (
                <s-number-field
                  label={type === "PLACE_ORDER" && perAmount ? `${pointsName} for every amount spent` : pointsName}
                  name="points"
                  value={initial.points}
                  min={1}
                  max={maxPoints}
                  step={1}
                  inputMode="numeric"
                  suffix={unit}
                  error={errors.points}
                  required
                ></s-number-field>
              )}
            </s-stack>
          </s-section>

          {meta.kind === "order" && (
            <s-section heading="How points are counted">
              <s-stack gap="base">
                <s-choice-list name="method" label="Points" values={[initial.method]} error={errors.method}>
                  <s-choice value={ORDER_METHODS.FIXED}>A fixed number per order</s-choice>
                  <s-choice value={ORDER_METHODS.PER_AMOUNT}>For every amount spent</s-choice>
                </s-choice-list>
                {perAmount && (
                  <>
                    <s-money-field
                      label="Amount spent"
                      name="spent"
                      value={initial.spent}
                      min={0.01}
                      details={`Customers get the ${unit} above for every this much of the order amount, rounded. Orders under it get nothing.`}
                      error={errors.spent}
                    ></s-money-field>
                    <s-choice-list name="itemScope" label="Items that count" values={[initial.itemScope]} error={errors.itemScope}>
                      <s-choice value={ITEM_SCOPES.ALL}>All items (order subtotal)</s-choice>
                      <s-choice value={ITEM_SCOPES.INCLUDE}>Only selected products and collections</s-choice>
                      <s-choice value={ITEM_SCOPES.EXCLUDE}>All except selected products and collections</s-choice>
                    </s-choice-list>
                  </>
                )}
                {scoped && (
                  <s-box padding="base" borderWidth="base" borderRadius="base">
                    <s-stack gap="base">
                      <ResourceSelection
                        label="Products"
                        items={products}
                        onPick={() => pick("product", products, setProducts)}
                        onRemove={(id) => setProducts((list) => list.filter((p) => p.id !== id))}
                      />
                      <s-divider></s-divider>
                      <ResourceSelection
                        label="Collections"
                        items={collections}
                        onPick={() => pick("collection", collections, setCollections)}
                        onRemove={(id) => setCollections((list) => list.filter((c) => c.id !== id))}
                        error={errors.items}
                      />
                    </s-stack>
                  </s-box>
                )}
                <input type="hidden" name="products" value={JSON.stringify(products)} />
                <input type="hidden" name="collections" value={JSON.stringify(collections)} />
                <s-paragraph color="subdued">
                  Points are given when the order is fulfilled, or when it&apos;s placed if you turned off
                  &quot;Only reward customers when their orders are fulfilled&quot; in Settings. A refund or
                  cancellation takes them back.
                </s-paragraph>
              </s-stack>
            </s-section>
          )}

          {meta.kind === "social" && (
            <s-section heading="Link">
              <s-url-field
                label={meta.urlLabel}
                name="url"
                value={initial.url}
                placeholder="https://"
                details={`Opened when the customer clicks ${meta.action} in the rewards widget.`}
                error={errors.url}
                required
              ></s-url-field>
            </s-section>
          )}

          {meta.kind === "birthday" && (
            <s-section heading="Birthday">
              <s-checkbox
                label={`Only reward birthdays entered at least ${noticeDays} days ahead`}
                name="requireNotice"
                checked={initial.requireNotice || undefined}
                details="A birthday entered later is rewarded next year. This stops customers entering a date just to get points now."
              ></s-checkbox>
            </s-section>
          )}

          {meta.kind === "referral" && (
            <s-section heading="How referrals work">
              <s-paragraph>
                Logged-in customers find their referral link in the rewards widget. A friend who opens it and
                then creates an account gets the Referred by a friend reward. The customer who shared the link
                gets the Refer a friend reward when that friend&apos;s first order is rewarded. Both rules can be
                turned on separately.
              </s-paragraph>
            </s-section>
          )}
        </s-stack>
      </form>
    </s-page>
  );
}
