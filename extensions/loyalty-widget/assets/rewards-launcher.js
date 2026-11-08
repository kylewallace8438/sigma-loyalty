(function () {
  function init(root) {
    var toggle = root.querySelector("[data-sigma-rewards-toggle]");
    var panel = root.querySelector("[data-sigma-rewards-panel]");
    var closeBtn = root.querySelector("[data-sigma-rewards-close]");
    var pointsEl = root.querySelector("[data-sigma-rewards-points]");
    var errorEl = root.querySelector("[data-sigma-rewards-error]");
    var excludedEl = root.querySelector("[data-sigma-rewards-excluded]");
    var loggedIn = root.dataset.loggedIn === "true";
    var loading = false;

    function loadPoints() {
      if (!loggedIn || !pointsEl || loading) return;
      loading = true;
      root.classList.add("is-loading");
      fetch(root.dataset.endpoint, { headers: { Accept: "application/json" }, credentials: "same-origin" })
        .then(function (res) {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        })
        .then(function (data) {
          errorEl.hidden = true;
          pointsEl.textContent = Number(data.points || 0).toLocaleString(document.documentElement.lang || undefined);
          excludedEl.hidden = !data.excluded;
        })
        .catch(function () {
          errorEl.hidden = false;
        })
        .finally(function () {
          loading = false;
          root.classList.remove("is-loading");
        });
    }

    function open() {
      panel.show();
      toggle.setAttribute("aria-expanded", "true");
      root.classList.add("is-open");
      loadPoints();
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
