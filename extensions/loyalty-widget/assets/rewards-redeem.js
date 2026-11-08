(function () {
  // Draws the "Redeem points" list and the customer's codes in the rewards launcher.
  // Called by rewards-launcher.js with its context after each load of /points.
  var ctx, t, el, fill;

  function copyButton(code) {
    var button = el("button", "sigma-rewards__action", t.copy);
    button.type = "button";
    button.addEventListener("click", function () {
      if (!navigator.clipboard) return;
      navigator.clipboard.writeText(code).then(function () {
        button.textContent = t.copied;
        setTimeout(function () {
          button.textContent = t.copy;
        }, 2000);
      });
    });
    return button;
  }

  // A code with copy and "use now" (Shopify's /discount/CODE link applies it to the cart).
  function codeRow(code, detail) {
    var item = el("li", "sigma-rewards__rule");
    var text = el("div", "sigma-rewards__rule-text");
    text.appendChild(el("span", "sigma-rewards__code", code.code));
    if (detail) text.appendChild(el("span", "sigma-rewards__rule-points", detail));
    item.appendChild(text);
    var actions = el("span", "sigma-rewards__action-group");
    var use = el("a", "sigma-rewards__link", t.useNow);
    use.href = "/discount/" + encodeURIComponent(code.code) + "?redirect=/cart";
    actions.appendChild(use);
    actions.appendChild(copyButton(code.code));
    item.appendChild(actions);
    return item;
  }

  function expiryText(code) {
    if (!code.expiresAt) return code.title;
    var date = new Date(code.expiresAt).toLocaleDateString(ctx.locale);
    return code.title + " · " + fill(t.expires, { date: date });
  }

  function redeem(reward, points, button) {
    button.disabled = true;
    ctx
      .post({ ruleId: reward.id, points: points }, "/redeem")
      .then(function (result) {
        if (!result.ok) throw new Error(result.error || t.actionError);
        ctx.showNotice(fill(t.codeReady, { title: result.title, code: result.code }));
        ctx.setPoints(result.points);
        ctx.load();
      })
      .catch(function (err) {
        ctx.showNotice(err.message || t.actionError, true);
        button.disabled = false;
      });
  }

  function rewardText(reward) {
    var cost = ctx.formatPoints(reward.pointsCost);
    var text =
      reward.spendMode === "INCREMENT"
        ? fill(t.perPoints, { points: cost, value: ctx.formatMoney(reward.discountValue) })
        : cost;
    if (reward.minimumSubtotal) text += " · " + fill(t.minimumOrder, { amount: ctx.formatMoney(reward.minimumSubtotal) });
    return text;
  }

  function rewardAction(reward, data) {
    if (!ctx.loggedIn || data.excluded) return null;
    var balance = data.points || 0;
    var group = el("span", "sigma-rewards__action-group");
    var button = el("button", "sigma-rewards__action", t.redeem);
    button.type = "button";

    if (reward.spendMode === "INCREMENT") {
      var step = reward.pointsCost;
      var min = Math.max(reward.minPoints || step, step);
      var max = Math.floor(balance / step) * step;
      if (reward.maxPoints) max = Math.min(max, reward.maxPoints);
      var input = el("input", "sigma-rewards__input sigma-rewards__points-input");
      input.type = "number";
      input.min = min;
      input.step = step;
      input.max = Math.max(max, min);
      input.value = min;
      input.setAttribute("aria-label", fill(t.pointsToSpend, { title: reward.title }));
      button.disabled = max < min;
      button.addEventListener("click", function () {
        redeem(reward, Number(input.value), button);
      });
      group.appendChild(input);
    } else {
      button.disabled = balance < reward.pointsCost;
      button.addEventListener("click", function () {
        redeem(reward, null, button);
      });
    }
    if (button.disabled) button.title = t.notEnough;
    group.appendChild(button);
    return group;
  }

  function renderRewards(data) {
    var box = ctx.redeemEl;
    box.textContent = "";
    var rewards = data.rewards || [];
    box.hidden = rewards.length === 0;
    if (!rewards.length) return;
    box.appendChild(el("h3", "sigma-rewards__subheading", t.redeemHeading));
    var list = el("ul", "sigma-rewards__rules");
    rewards.forEach(function (reward) {
      var item = el("li", "sigma-rewards__rule");
      var text = el("div", "sigma-rewards__rule-text");
      text.appendChild(el("span", "sigma-rewards__rule-name", reward.title));
      text.appendChild(el("span", "sigma-rewards__rule-points", rewardText(reward)));
      item.appendChild(text);
      var action = rewardAction(reward, data);
      if (action) item.appendChild(action);
      list.appendChild(item);
    });
    box.appendChild(list);
  }

  // Codes the customer can still use (not used, not expired).
  function renderCodes(data) {
    var box = ctx.codesEl;
    if (!box) return;
    box.textContent = "";
    var codes = (data.codes || []).filter(function (code) {
      return !code.used && !code.expired;
    });
    box.hidden = codes.length === 0;
    if (!codes.length) return;
    box.appendChild(el("h3", "sigma-rewards__subheading", t.yourCodes));
    var list = el("ul", "sigma-rewards__rules");
    codes.forEach(function (code) {
      list.appendChild(codeRow(code, expiryText(code)));
    });
    box.appendChild(list);
  }

  // The VIP program: the customer's tier, its perks and progress, then every tier.
  function renderVip(data) {
    var box = ctx.vipEl;
    if (!box) return;
    box.textContent = "";
    var vip = data.vip;
    box.hidden = !vip || !vip.tiers.length;
    if (box.hidden) return;
    var money = vip.entryMethod === "MONEY_SPENT";
    var amount = function (n) {
      return money ? ctx.formatMoney(n) : ctx.formatPoints(n);
    };
    box.appendChild(el("h3", "sigma-rewards__subheading", t.vipHeading));
    if (vip.current) {
      var current = vip.current;
      box.appendChild(el("p", "sigma-rewards__tier", (current.icon ? current.icon + " " : "") + fill(t.vipCurrent, { tier: current.title })));
      var perks = (current.multiplier ? [fill(t.vipBonus, { multiplier: current.multiplier })] : []).concat(current.perks);
      if (perks.length) {
        var perkList = el("ul", "sigma-rewards__perks");
        perks.forEach(function (perk) {
          perkList.appendChild(el("li", null, perk));
        });
        box.appendChild(perkList);
      }
      box.appendChild(
        el("p", "sigma-rewards__hint", vip.next ? fill(t.vipNext, { amount: amount(vip.next.needed), tier: vip.next.title }) : t.vipTop),
      );
    }
    var list = el("ul", "sigma-rewards__rules");
    vip.tiers.forEach(function (tier) {
      var isCurrent = vip.current && vip.current.title === tier.title;
      var item = el("li", "sigma-rewards__rule" + (isCurrent ? " is-current" : ""));
      var text = el("div", "sigma-rewards__rule-text");
      text.appendChild(el("span", "sigma-rewards__rule-name", (tier.icon ? tier.icon + " " : "") + tier.title));
      text.appendChild(el("span", "sigma-rewards__rule-points", tier.threshold ? amount(tier.threshold) : t.vipEntry));
      item.appendChild(text);
      list.appendChild(item);
    });
    box.appendChild(list);
  }

  window.SigmaRewardsRedeem = {
    render: function (context, data) {
      ctx = context;
      t = ctx.t;
      el = ctx.el;
      fill = ctx.fill;
      renderVip(data);
      renderRewards(data);
      if (ctx.loggedIn) renderCodes(data);
    },
  };
})();
