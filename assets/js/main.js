(() => {
  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const progressBar = document.querySelector(".scroll-progress__bar");
  const revealElements = document.querySelectorAll("[data-reveal]");
  const unlockCards = document.querySelectorAll("[data-unlock]");
  const yearElement = document.getElementById("year");
  const brandLink = document.querySelector(".brand");
  const navToggle = document.querySelector(".nav-toggle");
  const nav = document.querySelector(".site-nav");

  if (yearElement) {
    yearElement.textContent = String(new Date().getFullYear());
  }

  if (navToggle && nav) {
    navToggle.addEventListener("click", () => {
      const isOpen = nav.classList.toggle("is-open");
      navToggle.setAttribute("aria-expanded", String(isOpen));
    });

    nav.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", () => {
        nav.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      });
    });
  }

  if (brandLink) {
    brandLink.addEventListener("click", (event) => {
      event.preventDefault();
      window.scrollTo({
        top: 0,
        behavior: prefersReducedMotion ? "auto" : "smooth",
      });

      if (nav && navToggle) {
        nav.classList.remove("is-open");
        navToggle.setAttribute("aria-expanded", "false");
      }
    });
  }

  revealElements.forEach((element) => {
    const delay = element.getAttribute("data-delay");
    if (delay) {
      element.style.setProperty("--reveal-delay", `${delay}s`);
    }
  });

  const updateScrollProgress = () => {
    if (!progressBar) {
      return;
    }

    const scrollRange = document.documentElement.scrollHeight - window.innerHeight;
    const scrolled = window.scrollY;
    const ratio = scrollRange > 0 ? Math.min(Math.max(scrolled / scrollRange, 0), 1) : 0;
    progressBar.style.width = `${ratio * 100}%`;
  };

  updateScrollProgress();
  window.addEventListener("scroll", updateScrollProgress, { passive: true });
  window.addEventListener("resize", updateScrollProgress);

  if (prefersReducedMotion || !("IntersectionObserver" in window)) {
    revealElements.forEach((element) => element.classList.add("in-view"));
    unlockCards.forEach((card) => card.classList.add("unlocked"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries, io) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        entry.target.classList.add("in-view");

        if (entry.target.hasAttribute("data-unlock")) {
          entry.target.classList.add("unlocked");
        }

        io.unobserve(entry.target);
      });
    },
    {
      threshold: 0.18,
      rootMargin: "0px 0px -6% 0px",
    }
  );

  revealElements.forEach((element) => observer.observe(element));
})();
