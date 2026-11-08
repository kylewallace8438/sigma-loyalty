(function () {
  // Draws the panel sections of the rewards launcher (ways to earn, referral link, birthday form).
  // Called by rewards-launcher.js with its context after each load of /points.
  var ctx, t, el, fill;

  function formatPoints(n) {
    return ctx.formatPoints(n);
  }
  function formatMoney(n) {
    return ctx.formatMoney(n);
  }
  function runAction(body, button, earnedPoints) {
    return ctx.runAction(body, button, earnedPoints);
  }
  function showNotice(text, isError) {
    ctx.showNotice(text, isError);
  }

  function ruleText(rule) {
    var points = formatPoints(rule.points);
    if (rule.kind === "order") {
      return rule.method === "PER_AMOUNT"
        ? fill(t.perAmount, { points: points, amount: formatMoney(rule.spent) })
        : fill(t.perOrder, { points: points });
    }
    if (rule.kind === "birthday") return fill(t.everyBirthday, { points: points });
    return rule.couponTitle || points;
  }

  function ruleAction(rule, data) {
    if (!ctx.loggedIn || data.excluded) return null;
    if (rule.done) return el("span", "sigma-rewards__done", t.done);
    if (rule.kind === "social") {
      var social = el("button", "sigma-rewards__action", rule.action);
      social.type = "button";
      social.addEventListener("click", function () {
        // Open the link first (in the click, so popup blockers allow it), then claim the points.
        window.open(rule.link, "_blank", "noopener");
        runAction({ action: "social", type: rule.type }, social, rule.points);
      });
      return social;
    }
    if (rule.type === "NEWSLETTER") {
      var subscribe = el("button", "sigma-rewards__action", rule.action);
      subscribe.type = "button";
      subscribe.addEventListener("click", function () {
        runAction({ action: "newsletter" }, subscribe, rule.points);
      });
      return subscribe;
    }
    if (rule.type === "COMPLETE_PROFILE") {
      var wrap = el("span", "sigma-rewards__action-group");
      var edit = el("a", "sigma-rewards__link", t.editProfile);
      edit.href = ctx.root.dataset.accountUrl;
      var claim = el("button", "sigma-rewards__action", t.claim);
      claim.type = "button";
      claim.addEventListener("click", function () {
        runAction({ action: "profile" }, claim, rule.points);
      });
      wrap.appendChild(edit);
      wrap.appendChild(claim);
      return wrap;
    }
    return null;
  }

  function renderEarn(data) {
    ctx.earnEl.textContent = "";
    var rules = data.rules || [];
    ctx.earnEl.hidden = rules.length === 0;
    if (!rules.length) return;
    ctx.earnEl.appendChild(el("h3", "sigma-rewards__subheading", t.waysToEarn));
    var list = el("ul", "sigma-rewards__rules");
    rules.forEach(function (rule) {
      var item = el("li", "sigma-rewards__rule" + (rule.done ? " is-done" : ""));
      var text = el("div", "sigma-rewards__rule-text");
      text.appendChild(el("span", "sigma-rewards__rule-name", rule.name));
      text.appendChild(el("span", "sigma-rewards__rule-points", ruleText(rule)));
      item.appendChild(text);
      var action = ruleAction(rule, data);
      if (action) item.appendChild(action);
      list.appendChild(item);
    });
    ctx.earnEl.appendChild(list);
  }

  function renderReferral(data) {
    ctx.referralEl.textContent = "";
    ctx.referralEl.hidden = !data.referralCode;
    if (!data.referralCode) return;
    var byType = {};
    (data.rules || []).forEach(function (rule) {
      byType[rule.type] = rule;
    });
    var friend = byType.REFERRED_FRIEND;
    var you = byType.REFERRER;
    var link = window.location.origin + "/?" + ctx.refParam + "=" + encodeURIComponent(data.referralCode);

    ctx.referralEl.appendChild(el("h3", "sigma-rewards__subheading", t.referralHeading));
    ctx.referralEl.appendChild(
      el(
        "p",
        "sigma-rewards__hint",
        friend && you ? fill(t.referralBody, { friend: friend.couponTitle || formatPoints(friend.points), you: you.couponTitle || formatPoints(you.points) }) : t.referralBodyShort,
      ),
    );
    var row = el("div", "sigma-rewards__copy-row");
    var input = el("input", "sigma-rewards__input");
    input.type = "text";
    input.readOnly = true;
    input.value = link;
    input.setAttribute("aria-label", t.referralHeading);
    var copy = el("button", "sigma-rewards__action", t.copy);
    copy.type = "button";
    copy.addEventListener("click", function () {
      var done = function () {
        copy.textContent = t.copied;
        setTimeout(function () {
          copy.textContent = t.copy;
        }, 2000);
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(done, function () {
          input.select();
        });
      } else {
        input.select();
      }
    });
    row.appendChild(input);
    row.appendChild(copy);
    ctx.referralEl.appendChild(row);
  }

  function renderBirthday(data) {
    ctx.birthdayEl.textContent = "";
    var hasRule = (data.rules || []).some(function (rule) {
      return rule.kind === "birthday";
    });
    ctx.birthdayEl.hidden = !hasRule || data.excluded;
    if (ctx.birthdayEl.hidden) return;
    var form = el("form", "sigma-rewards__copy-row");
    var label = el("label", "sigma-rewards__label", t.birthdayLabel);
    var id = "sigma-rewards-birthday-input";
    label.htmlFor = id;
    var input = el("input", "sigma-rewards__input");
    input.type = "date";
    input.id = id;
    input.required = true;
    input.max = new Date().toISOString().slice(0, 10);
    if (data.birthday) input.value = data.birthday;
    var save = el("button", "sigma-rewards__action", t.birthdaySave);
    save.type = "submit";
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      runAction({ action: "birthday", birthday: input.value }, save).then(function (result) {
        if (result && result.ok) showNotice(t.birthdaySaved);
      });
    });
    ctx.birthdayEl.appendChild(label);
    form.appendChild(input);
    form.appendChild(save);
    ctx.birthdayEl.appendChild(form);
  }

  window.SigmaRewardsEarn = {
    render: function (context, data) {
      ctx = context;
      t = ctx.t;
      el = ctx.el;
      fill = ctx.fill;
      if (ctx.loggedIn) {
        renderReferral(data);
        renderBirthday(data);
      }
      renderEarn(data);
    },
  };
})();
