(() => {
  "use strict";

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const progressBar = document.querySelector(".scroll-progress__bar");
  const revealElements = document.querySelectorAll("[data-reveal]");
  const yearElement = document.getElementById("year");
  const navToggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".site-nav");
  const toastRegion = document.getElementById("toasts");

  if (yearElement) {
    yearElement.textContent = String(new Date().getFullYear());
  }

  /* ---------- nav ---------- */

  const closeNav = () => {
    if (nav && navToggle) {
      nav.classList.remove("is-open");
      navToggle.setAttribute("aria-expanded", "false");
    }
  };

  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });
    nav.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeNav));
  }

  /* ---------- toasts ---------- */

  window.siteToast = (title, text) => {
    if (!toastRegion) {
      return;
    }
    const toast = document.createElement("div");
    toast.className = "toast";
    const heading = document.createElement("strong");
    heading.textContent = title;
    const body = document.createElement("span");
    body.textContent = text;
    toast.append(heading, body);
    toastRegion.append(toast);
    window.setTimeout(() => toast.classList.add("is-leaving"), 4200);
    window.setTimeout(() => toast.remove(), 4700);
  };

  /* ---------- arcade cabinets: load the itch.io embed on demand ---------- */

  document.querySelectorAll("[data-embed]").forEach((screen) => {
    const button = screen.querySelector("button");
    if (!button) {
      return;
    }
    button.addEventListener("click", () => {
      const iframe = document.createElement("iframe");
      iframe.src = screen.getAttribute("data-embed");
      iframe.title = screen.getAttribute("data-title") || "Game";
      iframe.setAttribute("allowfullscreen", "");
      iframe.setAttribute("allow", "fullscreen; gamepad; autoplay");
      screen.replaceChildren(iframe);
      screen.classList.add("is-live");
    });
  });

  /* ---------- scroll progress ---------- */

  const updateScrollProgress = () => {
    if (!progressBar) {
      return;
    }
    const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
    const ratio = scrollRange > 0 ? Math.min(Math.max(window.scrollY / scrollRange, 0), 1) : 0;
    progressBar.style.transform = `scaleX(${ratio})`;
  };

  updateScrollProgress();
  window.addEventListener("scroll", updateScrollProgress, { passive: true });
  window.addEventListener("resize", updateScrollProgress);

  /* ---------- reveal on scroll ---------- */

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("in-view"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, io) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("in-view");
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -5% 0px" }
  );

  revealElements.forEach((element) => observer.observe(element));
})();
