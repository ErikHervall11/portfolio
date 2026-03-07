(() => {
  const PUBLIC_KEY = "-Mx4RZlW2OaO_e7tv";
  const SERVICE_ID = "service_ddqquj7";
  const TEMPLATE_ID = "template_m9cdb1k";

  const form = document.getElementById("email-form");
  const status = document.getElementById("res");

  if (!form || !status) {
    return;
  }

  const setStatus = (text, isError = false) => {
    status.textContent = text;
    status.style.color = isError ? "#ff9aa2" : "#3fffd5";
  };

  const hasEmailJs = typeof window.emailjs !== "undefined";

  if (hasEmailJs) {
    window.emailjs.init(PUBLIC_KEY);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = String(document.getElementById("name")?.value || "").trim();
    const email = String(document.getElementById("email")?.value || "").trim();
    const message = String(document.getElementById("message")?.value || "").trim();

    if (!name || !email || !message) {
      setStatus("Please fill out all fields before sending.", true);
      return;
    }

    if (!hasEmailJs) {
      setStatus("Email service unavailable right now. Message me on LinkedIn.", true);
      return;
    }

    const submitButton = form.querySelector('button[type="submit"]');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = "Sending...";
    }

    try {
      await window.emailjs.send(SERVICE_ID, TEMPLATE_ID, {
        name,
        email,
        message,
      });

      setStatus("Thanks for reaching out. I will get back to you soon.");
      form.reset();
    } catch (error) {
      setStatus("Message failed to send. Please try again in a moment.", true);
      console.error("EmailJS error:", error);
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = "Send Message";
      }
    }
  });
})();
