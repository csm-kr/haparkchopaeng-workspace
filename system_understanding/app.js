// 공유 스크립트: 테마 토글 + Mermaid 초기화 + 현재 페이지 nav 활성화
(function () {
  // --- theme ---
  const saved = localStorage.getItem("su-theme");
  if (saved) document.documentElement.setAttribute("data-theme", saved);

  function currentTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  window.addEventListener("DOMContentLoaded", function () {
    // theme toggle button
    const btn = document.createElement("button");
    btn.className = "theme-toggle";
    function label() { btn.textContent = currentTheme() === "dark" ? "☀️ 라이트" : "🌙 다크"; }
    label();
    btn.onclick = function () {
      const next = currentTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      localStorage.setItem("su-theme", next);
      label();
      // mermaid는 테마 전환 시 재렌더가 필요하지만, 새로고침 없이 간단히 페이지 reload
      location.reload();
    };
    document.body.appendChild(btn);

    // active nav
    const here = location.pathname.split("/").pop() || "index.html";
    document.querySelectorAll(".nav a").forEach(function (a) {
      const href = a.getAttribute("href");
      if (href === here) a.classList.add("active");
    });
  });

  // --- mermaid ---
  if (window.mermaid) {
    const dark = currentTheme() === "dark";
    window.mermaid.initialize({
      startOnLoad: true,
      theme: dark ? "dark" : "base",
      themeVariables: dark
        ? { primaryColor: "#2e2838", primaryTextColor: "#ece7f1", primaryBorderColor: "#6d5aa8",
            lineColor: "#8b7fb0", secondaryColor: "#262030", tertiaryColor: "#201b29",
            fontFamily: "Pretendard, -apple-system, sans-serif", fontSize: "14px" }
        : { primaryColor: "#efeaff", primaryTextColor: "#2a2622", primaryBorderColor: "#7c6fd6",
            lineColor: "#9a8fc7", secondaryColor: "#fff5e9", tertiaryColor: "#f4f0ea",
            fontFamily: "Pretendard, -apple-system, sans-serif", fontSize: "14px" },
      sequence: { useMaxWidth: true, wrap: true },
      flowchart: { useMaxWidth: true, curve: "basis" },
    });
  }
})();
