(function () {
  "use strict";
  var box = document.getElementById("faqList");
  var faq = (window.CARDORIA_SEO && CARDORIA_SEO.faq) || [];
  if (!box) return;
  box.innerHTML = faq.map(function (item) {
    return '<article class="faq-item"><h2 style="color:#ffe18a;font-size:18px;margin:0 0 10px">' + item.question + "</h2><p>" + item.answer + "</p></article>";
  }).join("");
})();
