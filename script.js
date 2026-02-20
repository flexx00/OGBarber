// ----- Header Scroll Effect -----
(function() {
  const header = document.querySelector('header');
  function onScroll() {
    header.classList.toggle('scrolled', window.scrollY > 60);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();
})();

// ----- Booking Form Submission -----
const form = document.getElementById('bookingForm');
const message = document.getElementById('bookingMessage');

if (form) {
  form.addEventListener('submit', function(e) {
    e.preventDefault(); // prevent default form submission
    fetch(form.action, {
      method: 'POST',
      body: new FormData(form),
      headers: { 'Accept': 'application/json' }
    }).then(response => {
      if (response.ok) {
        message.textContent = 'Thanks! Your appointment has been booked.';
        message.style.display = 'block';
        form.reset();
      } else {
        message.textContent = 'Oops! There was a problem submitting your booking.';
        message.style.display = 'block';
      }
    }).catch(() => {
      message.textContent = 'Oops! There was a problem submitting your booking.';
      message.style.display = 'block';
    });
  });
}