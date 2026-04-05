// ─── Config ──────────────────────────────────────────────
const API_URL        = 'http://localhost:3001/api/chat';
const MODEL          = 'claude-haiku-4-5-20251001';
const MAX_TOKENS     = 2048;
const COST_PER_TOKEN = 0.000001;
const KEY_STORAGE    = 'flux_api_key';

// ─── Personas ────────────────────────────────────────────
const PERSONAS = {
  default:     'You are FLUX, a brilliant and creative AI assistant. Be concise, insightful, and occasionally poetic.',
  coder:       'You are FLUX in Coder mode. You are an expert software engineer. Prioritize clean code, explain your reasoning, and always include working examples. Format code with proper syntax.',
  writer:      'You are FLUX in Writer mode. You are a masterful author and editor. Be expressive, vivid, and help craft compelling prose. Suggest improvements when appropriate.',
  philosopher: 'You are FLUX in Philosopher mode. You explore ideas deeply, ask probing questions, consider multiple perspectives, and draw from philosophy, science, and history to illuminate concepts.',
};

// ─── State ───────────────────────────────────────────────
let messages       = [];
let conversations  = JSON.parse(localStorage.getItem('flux_conversations') || '[]');
let currentConvId  = null;
let isStreaming    = false;
let totalTokens    = 0;
let soundEnabled   = true;
let currentPersona = 'default';
let systemPrompt   = localStorage.getItem('flux_system_prompt') || PERSONAS.default;
let recognition    = null;
let isRecording    = false;

// ─── DOM Refs ─────────────────────────────────────────────
const chatArea      = document.getElementById('chat-area');
const inputField    = document.getElementById('input-field');
const sendBtn       = document.getElementById('send-btn');
const clearBtn      = document.getElementById('clear-btn');
const historyBtn    = document.getElementById('history-btn');
const sidebar       = document.getElementById('sidebar');
const sidebarClose  = document.getElementById('sidebar-close');
const newChatBtn    = document.getElementById('new-chat-btn');
const historyList   = document.getElementById('history-list');
const settingsBtn   = document.getElementById('settings-btn');
const settingsDrawer= document.getElementById('settings-drawer');
const drawerClose   = document.getElementById('drawer-close');
const overlay       = document.getElementById('overlay');
const tokenCount    = document.getElementById('token-count');
const costCount     = document.getElementById('cost-count');
const systemPromptEl= document.getElementById('system-prompt');
const saveSystemPrompt = document.getElementById('save-system-prompt');
const soundToggle   = document.getElementById('sound-toggle');
const exportMd      = document.getElementById('export-md');
const exportTxt     = document.getElementById('export-txt');
const micBtn        = document.getElementById('mic-btn');
const statusText    = document.getElementById('status-text');
const emptyState    = document.getElementById('empty-state');
const personaPills  = document.querySelectorAll('.pill[data-persona]');
const bgCanvas      = document.getElementById('bg-canvas');

// ─── Animated Background ─────────────────────────────────
(function initBg() {
  const ctx = bgCanvas.getContext('2d');
  const particles = [];
  const COLORS = ['#c084fc','#f472b6','#fb923c'];

  function resize() {
    bgCanvas.width  = window.innerWidth;
    bgCanvas.height = window.innerHeight;
  }
  resize();
  window.addEventListener('resize', resize);

  for (let i = 0; i < 55; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 2.5 + 0.5,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      alpha: Math.random() * 0.6 + 0.1,
    });
  }

  function drawFrame() {
    ctx.clearRect(0, 0, bgCanvas.width, bgCanvas.height);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.x < 0) p.x = bgCanvas.width;
      if (p.x > bgCanvas.width) p.x = 0;
      if (p.y < 0) p.y = bgCanvas.height;
      if (p.y > bgCanvas.height) p.y = 0;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.alpha;
      ctx.fill();
    });
    // draw connections
    ctx.globalAlpha = 1;
    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const dx = particles[i].x - particles[j].x;
        const dy = particles[i].y - particles[j].y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < 120) {
          ctx.beginPath();
          ctx.moveTo(particles[i].x, particles[i].y);
          ctx.lineTo(particles[j].x, particles[j].y);
          ctx.strokeStyle = particles[i].color;
          ctx.globalAlpha = (1 - dist / 120) * 0.15;
          ctx.lineWidth = 0.5;
          ctx.stroke();
        }
      }
    }
    requestAnimationFrame(drawFrame);
  }
  drawFrame();
})();

// ─── Sound Effects ───────────────────────────────────────
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx = null;

function getAudioCtx() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

function playClick() {
  if (!soundEnabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = 'square';
    osc.frequency.setValueAtTime(1200 + Math.random() * 200, ctx.currentTime);
    gain.gain.setValueAtTime(0.02, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
    osc.start(); osc.stop(ctx.currentTime + 0.04);
  } catch {}
}

// ─── Markdown Renderer ───────────────────────────────────
function renderMarkdown(text) {
  return text
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_, lang, code) =>
      `<pre><code class="lang-${lang}">${escHtml(code.trim())}</code></pre>`)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^### (.+)$/gm, '<h3 style="font-size:15px;font-weight:600;margin:12px 0 4px;color:var(--text)">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 style="font-size:16px;font-weight:700;margin:14px 0 6px;color:var(--text)">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 style="font-size:18px;font-weight:800;margin:16px 0 8px;color:var(--text)">$1</h1>')
    .replace(/^\* (.+)$/gm, '<li style="margin-left:16px;list-style:disc;margin-bottom:2px">$1</li>')
    .replace(/^\d+\. (.+)$/gm, '<li style="margin-left:16px;list-style:decimal;margin-bottom:2px">$1</li>')
    .replace(/\n\n/g, '</p><p style="margin-top:8px">')
    .replace(/\n/g, '<br>');
}

function escHtml(t) {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ─── Toast ───────────────────────────────────────────────
function showToast(msg) {
  let t = document.querySelector('.toast');
  if (!t) { t = document.createElement('div'); t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ─── Token Tracker ───────────────────────────────────────
function addTokens(n) {
  totalTokens += n;
  tokenCount.textContent = totalTokens.toLocaleString();
  costCount.textContent = '$' + (totalTokens * COST_PER_TOKEN).toFixed(4);
}

// ─── Render Message ──────────────────────────────────────
function renderMessage(role, content, id) {
  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  row.dataset.id = id || Date.now();

  if (role === 'assistant') {
    const icon = document.createElement('div');
    icon.className = 'role-icon';
    icon.textContent = '✦';
    row.appendChild(icon);
  }

  const bubble = document.createElement('div');
  bubble.className = 'bubble';

  if (role === 'assistant') {
    bubble.innerHTML = renderMarkdown(content);

    // message actions
    const actions = document.createElement('div');
    actions.className = 'msg-actions';

    const copyBtn = createActionBtn('📋 Copy', () => {
      navigator.clipboard.writeText(content);
      copyBtn.textContent = '✓ Copied';
      copyBtn.classList.add('reacted');
      setTimeout(() => { copyBtn.textContent = '📋 Copy'; copyBtn.classList.remove('reacted'); }, 2000);
    });

    const likeBtn = createActionBtn('👍', () => likeBtn.classList.toggle('reacted'));
    const regenBtn = createActionBtn('↺ Regen', () => regenerateLast());

    actions.appendChild(copyBtn);
    actions.appendChild(likeBtn);
    actions.appendChild(regenBtn);
    bubble.appendChild(actions);
  } else {
    bubble.textContent = content;
  }

  row.appendChild(bubble);

  // Remove empty state
  emptyState?.remove();

  chatArea.appendChild(row);
  chatArea.scrollTop = chatArea.scrollHeight;
  return bubble;
}

function createActionBtn(label, onClick) {
  const b = document.createElement('button');
  b.className = 'msg-action-btn';
  b.textContent = label;
  b.addEventListener('click', onClick);
  return b;
}

// ─── Thinking Indicator ───────────────────────────────────
function showThinking() {
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  row.id = 'thinking-row';
  const icon = document.createElement('div');
  icon.className = 'role-icon'; icon.textContent = '✦';
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.innerHTML = '<div class="thinking"><span></span><span></span><span></span></div>';
  row.appendChild(icon); row.appendChild(bubble);
  emptyState?.remove();
  chatArea.appendChild(row);
  chatArea.scrollTop = chatArea.scrollHeight;
}

function removeThinking() {
  document.getElementById('thinking-row')?.remove();
}

// ─── Send Message ────────────────────────────────────────
async function sendMessage(text) {
  if (!text.trim() || isStreaming) return;
  isStreaming = true;
  sendBtn.disabled = true;
  statusText.textContent = 'Thinking…';
  inputField.value = '';
  autoResize();

  messages.push({ role: 'user', content: text });
  renderMessage('user', text);
  showThinking();
  addTokens(Math.ceil(text.length / 4));

  const body = {
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
    messages,
    stream: true,
  };

  try {
    const userKey = getStoredKey();
    if (!userKey) { showKeyGate(); isStreaming = false; sendBtn.disabled = false; return; }

    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-user-key': userKey,
      },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const err = await resp.json();
      removeThinking();
      appendError(err?.error?.message || 'API error');
      return;
    }

    removeThinking();

    // Create streaming bubble
    const row = document.createElement('div');
    row.className = 'message-row assistant';
    const icon = document.createElement('div');
    icon.className = 'role-icon'; icon.textContent = '✦';
    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    const cursor = document.createElement('span');
    cursor.className = 'cursor';
    bubble.appendChild(cursor);
    row.appendChild(icon); row.appendChild(bubble);
    chatArea.appendChild(row);
    chatArea.scrollTop = chatArea.scrollHeight;

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let clickCounter = 0;

    statusText.textContent = 'Streaming…';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split('\n');

      for (const line of lines) {
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (data === '[DONE]') continue;
        try {
          const json = JSON.parse(data);
          if (json.type === 'content_block_delta' && json.delta?.text) {
            fullText += json.delta.text;
            bubble.innerHTML = renderMarkdown(fullText);
            bubble.appendChild(cursor);
            chatArea.scrollTop = chatArea.scrollHeight;

            // sound every ~4 chars
            clickCounter++;
            if (clickCounter % 4 === 0) playClick();
          }
          if (json.type === 'message_delta' && json.usage?.output_tokens) {
            addTokens(json.usage.output_tokens);
          }
        } catch {}
      }
    }

    // Finalise
    cursor.remove();
    bubble.innerHTML = renderMarkdown(fullText);

    // Add action buttons
    const actions = document.createElement('div');
    actions.className = 'msg-actions';
    const copyBtn = createActionBtn('📋 Copy', () => {
      navigator.clipboard.writeText(fullText);
      copyBtn.textContent = '✓ Copied'; copyBtn.classList.add('reacted');
      setTimeout(() => { copyBtn.textContent = '📋 Copy'; copyBtn.classList.remove('reacted'); }, 2000);
    });
    const likeBtn = createActionBtn('👍', () => likeBtn.classList.toggle('reacted'));
    const regenBtn = createActionBtn('↺ Regen', () => regenerateLast());
    actions.appendChild(copyBtn); actions.appendChild(likeBtn); actions.appendChild(regenBtn);
    bubble.appendChild(actions);

    messages.push({ role: 'assistant', content: fullText });
    saveCurrentConversation();

  } catch (err) {
    removeThinking();
    appendError(err.message);
  } finally {
    isStreaming = false;
    sendBtn.disabled = !inputField.value.trim();
    statusText.textContent = 'Ready';
  }
}

function appendError(msg) {
  const row = document.createElement('div');
  row.className = 'message-row assistant';
  const icon = document.createElement('div');
  icon.className = 'role-icon'; icon.textContent = '!';
  icon.style.background = 'rgba(255,107,107,0.2)';
  const bubble = document.createElement('div');
  bubble.className = 'error-msg'; bubble.textContent = '⚠ ' + msg;
  row.appendChild(icon); row.appendChild(bubble);
  chatArea.appendChild(row);
  chatArea.scrollTop = chatArea.scrollHeight;
}

// ─── Regenerate ──────────────────────────────────────────
async function regenerateLast() {
  if (isStreaming || messages.length < 2) return;
  // Remove last assistant message
  if (messages[messages.length - 1]?.role === 'assistant') {
    messages.pop();
    // Remove last row from DOM
    chatArea.lastElementChild?.remove();
  }
  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  if (lastUser) {
    messages = messages.slice(0, messages.lastIndexOf(lastUser) + 1);
    await sendMessage(lastUser.content);
  }
}

// ─── Conversations ───────────────────────────────────────
function saveCurrentConversation() {
  if (!messages.length) return;
  const title = messages[0]?.content?.slice(0, 40) || 'New conversation';
  if (currentConvId) {
    const idx = conversations.findIndex(c => c.id === currentConvId);
    if (idx > -1) {
      conversations[idx] = { id: currentConvId, title, messages: [...messages], ts: Date.now() };
    }
  } else {
    currentConvId = Date.now().toString();
    conversations.unshift({ id: currentConvId, title, messages: [...messages], ts: Date.now() });
  }
  localStorage.setItem('flux_conversations', JSON.stringify(conversations));
  renderHistory();
}

function loadConversation(id) {
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;
  currentConvId = id;
  messages = [...conv.messages];
  chatArea.innerHTML = '';
  messages.forEach(m => renderMessage(m.role, m.content));
  closeSidebar();
}

function deleteConversation(id, e) {
  e.stopPropagation();
  conversations = conversations.filter(c => c.id !== id);
  localStorage.setItem('flux_conversations', JSON.stringify(conversations));
  if (currentConvId === id) clearChat();
  renderHistory();
}

function renderHistory() {
  historyList.innerHTML = '';
  if (!conversations.length) {
    historyList.innerHTML = '<div style="padding:12px;color:var(--text-dim);font-size:12px;text-align:center">No conversations yet</div>';
    return;
  }
  conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = 'history-item' + (conv.id === currentConvId ? ' active' : '');
    item.innerHTML = `<span class="history-item-title">${conv.title}</span><button class="history-item-del" title="Delete">✕</button>`;
    item.querySelector('.history-item-del').addEventListener('click', e => deleteConversation(conv.id, e));
    item.addEventListener('click', () => loadConversation(conv.id));
    historyList.appendChild(item);
  });
}

function clearChat() {
  messages = []; currentConvId = null;
  chatArea.innerHTML = '';
  chatArea.appendChild(createEmptyState());
  totalTokens = 0;
  tokenCount.textContent = '0';
  costCount.textContent = '$0.000';
  statusText.textContent = 'Ready';
}

function createEmptyState() {
  const div = document.createElement('div');
  div.className = 'empty-state'; div.id = 'empty-state';
  div.innerHTML = `
    <div class="empty-orb"></div>
    <h2 class="empty-title">FLUX is ready</h2>
    <p class="empty-sub">Ask anything. Think out loud. Explore together.</p>
    <div class="starter-chips">
      <button class="chip" data-msg="What's the most fascinating thing happening in AI right now?">✦ AI frontiers</button>
      <button class="chip" data-msg="Write me a short poem about the ocean at night.">✦ Write a poem</button>
      <button class="chip" data-msg="Explain quantum entanglement like I'm 10.">✦ Quantum for kids</button>
      <button class="chip" data-msg="Give me a Python snippet to fetch and parse JSON from an API.">✦ Code: fetch JSON</button>
    </div>`;
  div.querySelectorAll('.chip').forEach(chip =>
    chip.addEventListener('click', () => sendMessage(chip.dataset.msg)));
  return div;
}

// ─── Export ──────────────────────────────────────────────
function exportConversation(format) {
  if (!messages.length) { showToast('Nothing to export'); return; }
  let content = '';
  if (format === 'md') {
    content = `# FLUX Conversation\n_${new Date().toLocaleString()}_\n\n`;
    messages.forEach(m => {
      content += `## ${m.role === 'user' ? 'You' : 'FLUX'}\n${m.content}\n\n`;
    });
  } else {
    messages.forEach(m => {
      content += `[${m.role === 'user' ? 'You' : 'FLUX'}]\n${m.content}\n\n---\n\n`;
    });
  }
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url;
  a.download = `nova-chat-${Date.now()}.${format}`;
  a.click(); URL.revokeObjectURL(url);
  showToast(`Exported as .${format}`);
}

// ─── Voice Input ─────────────────────────────────────────
function initVoice() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { micBtn.title = 'Voice not supported'; micBtn.style.opacity = '0.3'; return; }
  recognition = new SR();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = 'en-US';

  recognition.onresult = (e) => {
    const transcript = Array.from(e.results).map(r => r[0].transcript).join('');
    inputField.value = transcript;
    autoResize();
    sendBtn.disabled = !transcript.trim();
  };

  recognition.onend = () => {
    isRecording = false;
    micBtn.classList.remove('recording');
  };

  micBtn.addEventListener('click', () => {
    if (isRecording) { recognition.stop(); return; }
    recognition.start();
    isRecording = true;
    micBtn.classList.add('recording');
  });
}

// ─── Sidebar / Drawer ────────────────────────────────────
function openSidebar() {
  sidebar.classList.add('open');
  overlay.classList.add('active');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  if (!settingsDrawer.classList.contains('open')) overlay.classList.remove('active');
}
function openDrawer() {
  settingsDrawer.classList.add('open');
  overlay.classList.add('active');
}
function closeDrawer() {
  settingsDrawer.classList.remove('open');
  if (!sidebar.classList.contains('open')) overlay.classList.remove('active');
}

// ─── Auto-resize textarea ────────────────────────────────
function autoResize() {
  inputField.style.height = 'auto';
  inputField.style.height = Math.min(inputField.scrollHeight, 160) + 'px';
}

// ─── Event Listeners ─────────────────────────────────────
sendBtn.addEventListener('click', () => sendMessage(inputField.value.trim()));

inputField.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage(inputField.value.trim());
  }
});

inputField.addEventListener('input', () => {
  sendBtn.disabled = !inputField.value.trim();
  autoResize();
});

clearBtn.addEventListener('click', clearChat);

historyBtn.addEventListener('click', () => {
  renderHistory();
  openSidebar();
});
sidebarClose.addEventListener('click', closeSidebar);
newChatBtn.addEventListener('click', () => { clearChat(); closeSidebar(); });

settingsBtn.addEventListener('click', openDrawer);
drawerClose.addEventListener('click', closeDrawer);
overlay.addEventListener('click', () => { closeSidebar(); closeDrawer(); });

saveSystemPrompt.addEventListener('click', () => {
  systemPrompt = systemPromptEl.value.trim() || PERSONAS.default;
  localStorage.setItem('flux_system_prompt', systemPrompt);
  showToast('System prompt saved');
});

soundToggle.addEventListener('change', () => { soundEnabled = soundToggle.checked; });
exportMd.addEventListener('click',  () => exportConversation('md'));
exportTxt.addEventListener('click', () => exportConversation('txt'));

personaPills.forEach(pill => {
  pill.addEventListener('click', () => {
    personaPills.forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    currentPersona = pill.dataset.persona;
    systemPrompt = PERSONAS[currentPersona];
    systemPromptEl.value = systemPrompt;
    showToast(`Mode: ${pill.textContent}`);
  });
});

// Starter chips
document.querySelectorAll('.chip').forEach(chip =>
  chip.addEventListener('click', () => sendMessage(chip.dataset.msg)));

// ─── API Key Gate ────────────────────────────────────────
const keyGate       = document.getElementById('key-gate');
const keyInput      = document.getElementById('key-input');
const keySubmitBtn  = document.getElementById('key-submit-btn');
const keyShowBtn    = document.getElementById('key-show-btn');
const changeKeyBtn  = document.getElementById('change-key-btn');
const removeKeyBtn  = document.getElementById('remove-key-btn');
const keyStatusText = document.getElementById('key-status-text');

function getStoredKey() {
  return localStorage.getItem(KEY_STORAGE) || '';
}

function saveKey(key) {
  localStorage.setItem(KEY_STORAGE, key);
}

function removeKey() {
  localStorage.removeItem(KEY_STORAGE);
}

function showKeyGate() {
  keyGate.classList.remove('hidden');
  keyInput.value = '';
  keySubmitBtn.disabled = true;
  setTimeout(() => keyInput.focus(), 100);
}

function hideKeyGate() {
  keyGate.classList.add('hidden');
  updateKeyStatus();
}

function updateKeyStatus() {
  const key = getStoredKey();
  if (key) {
    const masked = key.slice(0, 8) + '••••••••' + key.slice(-4);
    keyStatusText.textContent = masked;
  } else {
    keyStatusText.textContent = 'No key saved';
  }
}

keyInput.addEventListener('input', () => {
  const val = keyInput.value.trim();
  keySubmitBtn.disabled = !val.startsWith('sk-ant-');
  keyInput.classList.remove('error');
});

keyShowBtn.addEventListener('click', () => {
  keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
  keyShowBtn.textContent = keyInput.type === 'password' ? '👁' : '🙈';
});

keySubmitBtn.addEventListener('click', () => {
  const val = keyInput.value.trim();
  if (!val.startsWith('sk-ant-')) {
    keyInput.classList.add('error');
    showToast('Key must start with sk-ant-');
    return;
  }
  saveKey(val);
  hideKeyGate();
  showToast('API key saved ✓');
});

keyInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !keySubmitBtn.disabled) keySubmitBtn.click();
});

changeKeyBtn?.addEventListener('click', () => {
  closeDrawer();
  showKeyGate();
});

removeKeyBtn?.addEventListener('click', () => {
  removeKey();
  clearChat();
  closeDrawer();
  showKeyGate();
  showToast('Key removed');
});

// Patch sendMessage to inject user key into request header via proxy
const _origSend = sendMessage;

// Override fetch in sendMessage to attach key header
// We pass the key as a custom header which server.js forwards
// Update server.js to read x-user-key header

// ─── Init ─────────────────────────────────────────────────
systemPromptEl.value = systemPrompt;
renderHistory();
initVoice();

// Check for key on load
if (!getStoredKey()) {
  showKeyGate();
} else {
  hideKeyGate();
}
