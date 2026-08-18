(function () {
  "use strict";

  function initFaq() {
    document.querySelectorAll(".home-faq-question").forEach(function (button) {
      button.addEventListener("click", function () {
        var item = button.closest(".home-faq-item");
        if (!item) return;
        var isOpen = item.classList.contains("is-open");

        document.querySelectorAll(".home-faq-item.is-open").forEach(function (openItem) {
          openItem.classList.remove("is-open");
          var openButton = openItem.querySelector(".home-faq-question");
          if (openButton) openButton.setAttribute("aria-expanded", "false");
        });

        if (!isOpen) {
          item.classList.add("is-open");
          button.setAttribute("aria-expanded", "true");
        }
      });
    });
  }

  function initReveal() {
    var elements = document.querySelectorAll(".home-reveal");
    if (!elements.length) return;

    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      elements.forEach(function (element) { element.classList.add("is-visible"); });
      return;
    }

    if (!("IntersectionObserver" in window)) {
      elements.forEach(function (element) { element.classList.add("is-visible"); });
      return;
    }

    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    }, { threshold: 0.1, rootMargin: "0px 0px -24px 0px" });

    elements.forEach(function (element) { observer.observe(element); });
  }

  document.addEventListener("DOMContentLoaded", function () {
    initFaq();
    initReveal();
  });
})();
