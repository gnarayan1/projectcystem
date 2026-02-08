// Contact Form Handler
document.addEventListener('DOMContentLoaded', () => {
  const contactForm = document.getElementById('contactForm');
  const statusDiv = document.getElementById('formStatus');

  if (!contactForm) return;

  contactForm.addEventListener('submit', async (e) => {
    e.preventDefault();

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
      const token = await grecaptcha.execute('YOUR_RECAPTCHA_SITE_KEY', {
        action: 'submit',
      });

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
