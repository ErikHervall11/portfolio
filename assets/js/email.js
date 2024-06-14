/*
	Directive by HTML5 UP
	html5up.net | @ajlkn
	Free for personal and commercial use under the CCA 3.0 license (html5up.net/license)
*/

(function ($) {
  emailjs.init("-Mx4RZlW2OaO_e7tv");

  document
    .getElementById("email-form")
    .addEventListener("submit", function (e) {
      e.preventDefault();
      const name = document.getElementById("name").value;
      const email = document.getElementById("email").value;
      const message = document.getElementById("message").value;

      emailjs
        .send("service_ddqquj7", "template_m9cdb1k", {
          name: name,
          email: email,
          message: message,
        })
        .then(
          function (response) {
            document.getElementById("res").innerText =
              "Thanks For Reaching Out!";
            document.getElementById("name").value = "";
            document.getElementById("email").value = "";
            document.getElementById("message").value = "";
          },

          function (error) {
            document.getElementById("res").innerText = JSON.stringify(error);
          }
        );
    });
})(jQuery);
