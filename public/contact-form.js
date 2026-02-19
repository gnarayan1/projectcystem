// Contact Form Handler
document.addEventListener('DOMContentLoaded', () => {
  const RECAPTCHA_ACTION = 'CONTACT_FORM_SUBMIT';
  const contactForm = document.getElementById('contactForm');
  const statusDiv = document.getElementById('formStatus');
  const modalBackdrop = document.getElementById('contactModal');
  const openModalBtn = document.getElementById('openContactModal');
  const closeModalBtn = modalBackdrop ? modalBackdrop.querySelector('.modal-close') : null;

  if (!contactForm) return;

  const closeModal = () => {
    if (!modalBackdrop) return;
    modalBackdrop.classList.remove('is-open');
    modalBackdrop.setAttribute('aria-hidden', 'true');
  };

  const openModal = () => {
    if (!modalBackdrop) return;
    modalBackdrop.classList.add('is-open');
    modalBackdrop.setAttribute('aria-hidden', 'false');
    const firstInput = contactForm.querySelector('input, textarea, button');
    if (firstInput) firstInput.focus();
  };

  if (openModalBtn) {
    openModalBtn.addEventListener('click', openModal);
  }

  if (closeModalBtn) {
    closeModalBtn.addEventListener('click', closeModal);
  }

  if (modalBackdrop) {
    modalBackdrop.addEventListener('click', (e) => {
      if (e.target === modalBackdrop) {
        closeModal();
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeModal();
    }
  });

  const getRecaptchaToken = async (siteKey) => {
    if (typeof grecaptcha === 'undefined') {
      throw new Error('reCAPTCHA failed to load. Please try again later.');
    }

    if (grecaptcha.enterprise && typeof grecaptcha.enterprise.execute === 'function') {
      await new Promise((resolve) => grecaptcha.enterprise.ready(resolve));
      return grecaptcha.enterprise.execute(siteKey, { action: RECAPTCHA_ACTION });
    }

    if (typeof grecaptcha.execute === 'function') {
      await new Promise((resolve) => grecaptcha.ready(resolve));
      return grecaptcha.execute(siteKey, { action: RECAPTCHA_ACTION });
    }

    throw new Error('reCAPTCHA is not available. Please try again later.');
  };

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const siteKey = contactForm.dataset.recaptchaSiteKey;
    if (!siteKey) {
      statusDiv.className = 'form-status error';
      statusDiv.textContent = 'reCAPTCHA is not configured. Please try again later.';
      return;
    }

    // Disable submit button and show loading state
    const submitBtn = contactForm.querySelector('.submit-btn');
    const originalText = submitBtn.textContent;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending...';

    // Clear previous status messages
    statusDiv.className = 'form-status loading';
    statusDiv.textContent = 'Sending your message...';

    try {
      // Get reCAPTCHA token
      const token = await getRecaptchaToken(siteKey);

      // Prepare form data
      const formData = new FormData(contactForm);
      formData.append('g-recaptcha-response', token);

      // Send form data to server
      const response = await fetch('/contact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(Object.fromEntries(formData)),
      });

      const result = await response.json();

      if (response.ok && result.success) {
        // Success
        statusDiv.className = 'form-status success';
        statusDiv.textContent = '✓ ' + result.message;
        contactForm.reset();

        // Clear status message after 5 seconds
        setTimeout(() => {
          statusDiv.className = 'form-status';
          statusDiv.textContent = '';
        }, 5000);

        closeModal();
      } else {
        // Error response from server
        throw new Error(result.error || 'Failed to send message');
      }
    } catch (error) {
      console.error('Form submission error:', error);
      statusDiv.className = 'form-status error';
      statusDiv.textContent = '✗ ' + (error.message || 'An error occurred. Please try again.');
    } finally {
      // Re-enable submit button
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  });
});
