(function () {
  var REF_PARAM = "sigma_ref";
  var REF_STORAGE_KEY = "sigmaRewardsReferral";

  // localStorage can throw (private mode, blocked storage); the widget works without it.
  function storageGet(key) {
    try {
      return window.localStorage.getItem(key);
    } catch (e) {
      return null;
    }
  }
  function storageSet(key, value) {
    try {
      if (value == null) window.localStorage.removeItem(key);
      else window.localStorage.setItem(key, value);
    } catch (e) {
      /* ignore */
    }
  }

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function fill(template, values) {
    return String(template).replace(/\{(\w+)\}/g, function (match, key) {
      return key in values ? values[key] : match;
    });
  }

  function init(root) {
    var toggle = root.querySelector("[data-sigma-rewards-toggle]");
    var panel = root.querySelector("[data-sigma-rewards-panel]");
    var closeBtn = root.querySelector("[data-sigma-rewards-close]");
    var pointsEl = root.querySelector("[data-sigma-rewards-points]");
    var unitEl = root.querySelector("[data-sigma-rewards-unit]");
    var errorEl = root.querySelector("[data-sigma-rewards-error]");
    var excludedEl = root.querySelector("[data-sigma-rewards-excluded]");
    var noticeEl = root.querySelector("[data-sigma-rewards-notice]");
    var referralEl = root.querySelector("[data-sigma-rewards-referral]");
    var birthdayEl = root.querySelector("[data-sigma-rewards-birthday]");
    var earnEl = root.querySelector("[data-sigma-rewards-earn]");
    var redeemEl = root.querySelector("[data-sigma-rewards-redeem]");
    var codesEl = root.querySelector("[data-sigma-rewards-codes]");
    var vipEl = root.querySelector("[data-sigma-rewards-vip]");
    var i18nEl = root.querySelector("[data-sigma-rewards-i18n]");
    var t = i18nEl ? JSON.parse(i18nEl.textContent) : {};
    var loggedIn = root.dataset.loggedIn === "true";
    var proxy = root.dataset.proxy;
    var locale = document.documentElement.lang || undefined;
    var loading = false;
    var unit = t.pointsUnit || "points";

    function formatNumber(n) {
      return Number(n || 0).toLocaleString(locale);
    }
    function formatPoints(n) {
      return formatNumber(n) + " " + unit;
    }
    function formatMoney(amount) {
      try {
        return new Intl.NumberFormat(locale, { style: "currency", currency: root.dataset.currency }).format(amount);
      } catch (e) {
        return String(amount);
      }
    }

    function request(path, options) {
      return fetch(proxy + path, Object.assign({ credentials: "same-origin", headers: { Accept: "application/json" } }, options)).then(
        function (res) {
          return res.json().then(function (body) {
            if (!res.ok && !(body && body.error)) throw new Error("HTTP " + res.status);
            return body;
          });
        },
      );
    }

    function post(body, path) {
      return request(path || "/earn", {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    }

    function showNotice(text, isError) {
      if (!noticeEl) return;
      noticeEl.textContent = text;
      noticeEl.classList.toggle("is-error", Boolean(isError));
      noticeEl.hidden = false;
    }

    function setPoints(points) {
      if (pointsEl) pointsEl.textContent = formatNumber(points);
    }

    // Runs an earn action; on success refreshes the balance and the list.
    function runAction(body, button, earnedPoints) {
      if (button) button.disabled = true;
      return post(body)
        .then(function (result) {
          if (!result.ok) throw new Error(result.error || t.actionError);
          if (earnedPoints) showNotice(fill(t.earned, { points: formatPoints(earnedPoints) }));
          setPoints(result.points);
          load();
          return result;
        })
        .catch(function (err) {
          showNotice(err.message || t.actionError, true);
          if (button) button.disabled = false;
        });
    }

    var ctx = {
      root: root,
      t: t,
      loggedIn: loggedIn,
      el: el,
      fill: fill,
      formatPoints: formatPoints,
      formatMoney: formatMoney,
      runAction: runAction,
      showNotice: showNotice,
      refParam: REF_PARAM,
      locale: locale,
      post: post,
      setPoints: setPoints,
      formatNumber: formatNumber,
      load: function () {
        load();
      },
      earnEl: earnEl,
      redeemEl: redeemEl,
      codesEl: codesEl,
      vipEl: vipEl,
      referralEl: referralEl,
      birthdayEl: birthdayEl,
    };

    function load() {
      if (loading) return;
      loading = true;
      root.classList.add("is-loading");
      request("/points")
        .then(function (data) {
          if (errorEl) errorEl.hidden = true;
          if (data.pointsName) {
            unit = data.pointsName.toLowerCase();
            if (unitEl) unitEl.textContent = unit;
          }
          if (loggedIn) {
            setPoints(data.points);
            excludedEl.hidden = !data.excluded;
          }
          // The sections are drawn by rewards-redeem.js and rewards-earn.js (separate assets, to keep
          // each file small).
          if (window.SigmaRewardsRedeem) window.SigmaRewardsRedeem.render(ctx, data);
          if (window.SigmaRewardsEarn) window.SigmaRewardsEarn.render(ctx, data);
        })
        .catch(function () {
          if (errorEl) errorEl.hidden = false;
        })
        .finally(function () {
          loading = false;
          root.classList.remove("is-loading");
        });
    }

    // Referral links: a visitor arriving with ?sigma_ref=CODE gets a signed token, kept until they
    // have an account and are logged in; then it's sent once (kept only when asked to retry).
    function handleReferral() {
      var code = new URLSearchParams(window.location.search).get(REF_PARAM);
      if (code && !loggedIn) {
        request("/referral?code=" + encodeURIComponent(code))
          .then(function (body) {
            if (body && body.token) storageSet(REF_STORAGE_KEY, body.token);
          })
          .catch(function () {});
      }
      var token = storageGet(REF_STORAGE_KEY);
      if (loggedIn && token) {
        post({ action: "referral", token: token })
          .then(function (result) {
            if (result.result !== "retry") storageSet(REF_STORAGE_KEY, null);
          })
          .catch(function () {});
      }
    }

    function open() {
      panel.show();
      toggle.setAttribute("aria-expanded", "true");
      root.classList.add("is-open");
      if (noticeEl) noticeEl.hidden = true;
      load();
      closeBtn.focus();
    }

    function close(returnFocus) {
      if (!panel.open) return;
      panel.close();
      toggle.setAttribute("aria-expanded", "false");
      root.classList.remove("is-open");
      if (returnFocus) toggle.focus();
    }

    toggle.addEventListener("click", function () {
      if (panel.open) close(false);
      else open();
    });
    closeBtn.addEventListener("click", function () {
      close(true);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && panel.open) close(true);
    });
    document.addEventListener("click", function (event) {
      if (panel.open && !root.contains(event.target)) close(false);
    });

    handleReferral();
  }

  function boot() {
    document.querySelectorAll("[data-sigma-rewards]").forEach(function (root) {
      if (root.dataset.sigmaReady) return;
      root.dataset.sigmaReady = "true";
      init(root);
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
