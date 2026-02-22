document.addEventListener('DOMContentLoaded', () => {
  const launcher = document.getElementById('chatLauncher');
  const panel = document.getElementById('chatPanel');
  const closeBtn = document.getElementById('chatClose');
  const form = document.getElementById('chatForm');
  const input = document.getElementById('chatInput');
  const messages = document.getElementById('chatMessages');

  if (!launcher || !panel || !closeBtn || !form || !input || !messages) return;

  const setOpen = (open) => {
    panel.classList.toggle('is-open', open);
    panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    launcher.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) input.focus();
  };

  const appendBubble = (text, role, sources = []) => {
    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${role}`;
    bubble.textContent = text;

    if (role === 'bot' && Array.isArray(sources) && sources.length) {
      const sourceWrap = document.createElement('div');
      sourceWrap.className = 'chat-sources';
      sources.forEach((source, index) => {
        const link = document.createElement('a');
        link.href = source.url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = `Source ${index + 1}: ${source.title}`;
        sourceWrap.appendChild(link);
      });
      bubble.appendChild(sourceWrap);
    }

    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
  };

  launcher.addEventListener('click', () => setOpen(!panel.classList.contains('is-open')));
  closeBtn.addEventListener('click', () => setOpen(false));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    appendBubble(question, 'user');
    input.value = '';

    const loadingBubble = document.createElement('div');
    loadingBubble.className = 'chat-bubble bot';
    loadingBubble.textContent = 'Thinking...';
    messages.appendChild(loadingBubble);
    messages.scrollTop = messages.scrollHeight;

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ question }),
      });
      const result = await response.json();
      loadingBubble.remove();
      if (!response.ok) {
        appendBubble(result.error || 'Chat is temporarily unavailable.', 'bot');
        return;
      }
      appendBubble(result.answer || 'No answer returned.', 'bot', result.sources || []);
    } catch (error) {
      loadingBubble.remove();
      appendBubble('Network error. Please try again.', 'bot');
    }
  });
});
