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

// Simple Cart System
const cartBtn = document.querySelector('.cart-btn');
const cartModal = document.getElementById('cartModal');
const closeCartBtn = document.getElementById('closeCart');
const cartItemsList = document.getElementById('cartItems');
const cartTotal = document.getElementById('cartTotal');

let cart = [];

function updateCart() {
  cartItemsList.innerHTML = '';
  let total = 0;
  cart.forEach((item, index) => {
    const li = document.createElement('li');
    li.innerHTML = `${item.name} <span>£${item.price.toFixed(2)}</span>`;
    cartItemsList.appendChild(li);
    total += item.price;
  });
  cartTotal.textContent = `Total: £${total.toFixed(2)}`;
}

// Add to Cart buttons
document.querySelectorAll('.add-to-cart').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const card = e.target.closest('.product-card');
    const name = card.querySelector('.product-name').textContent;
    const priceText = card.querySelector('.product-price').textContent.replace('£','');
    const price = parseFloat(priceText);
    cart.push({ name, price });
    alert(`${name} added to cart!`);
  });
});

// Show cart
cartBtn.addEventListener('click', () => {
  updateCart();
  cartModal.style.display = 'flex';
});

// Close cart
closeCartBtn.addEventListener('click', () => {
  cartModal.style.display = 'none';
});

// Close cart when clicking outside
cartModal.addEventListener('click', (e) => {
  if(e.target === cartModal) cartModal.style.display = 'none';
});