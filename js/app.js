import { 
  initAuth, 
  signIn, 
  signUp, 
  signOut, 
  currentUser, 
  currentProfile, 
  normalizeTag,
  isAdmin 
} from './auth.js';

import { searchUsers } from './search.js';

import { 
  getOrCreateConversation, 
  fetchConversations, 
  fetchMessages, 
  sendMessage, 
  subscribeToActiveConversation, 
  subscribeToGlobalEvents 
} from './chat.js';

import {
  getAdminStats,
  getAllUsers,
  getAllRecentMessages,
  adminDeleteMessage,
  adminBanUser,
  adminMuteUser,
  adminUnmuteUser
} from './admin.js';

// DOM Elements
const authModal = document.getElementById('auth-modal');
const authAlert = document.getElementById('auth-alert');
const tabLoginBtn = document.getElementById('tab-login-btn');
const tabSignupBtn = document.getElementById('tab-signup-btn');
const loginForm = document.getElementById('login-form');
const signupForm = document.getElementById('signup-form');

const sidebarUserFooter = document.getElementById('sidebar-user-footer');
const myAvatar = document.getElementById('my-avatar');
const myDisplayName = document.getElementById('my-display-name');
const myUsername = document.getElementById('my-username');
const myAdminBadge = document.getElementById('my-admin-badge');
const copyMyTagBtn = document.getElementById('copy-my-tag-btn');
const adminPanelBtn = document.getElementById('admin-panel-btn');
const logoutBtn = document.getElementById('logout-btn');

const searchInput = document.getElementById('user-search-input');
const searchClearBtn = document.getElementById('search-clear-btn');
const searchDropdown = document.getElementById('search-results-dropdown');
const conversationsList = document.getElementById('conversations-list');

const emptyPlaceholder = document.getElementById('empty-placeholder');
const activeChatContainer = document.getElementById('active-chat-container');
const activeChatAvatar = document.getElementById('active-chat-avatar');
const activeChatName = document.getElementById('active-chat-name');
const activeChatTag = document.getElementById('active-chat-tag');
const backToSidebarBtn = document.getElementById('back-to-sidebar-btn');
const messagesContainer = document.getElementById('messages-container');
const sendMessageForm = document.getElementById('send-message-form');
const messageInput = document.getElementById('message-input');
const sendBtn = document.getElementById('send-btn');
const toastContainer = document.getElementById('toast-container');
const sidebar = document.getElementById('sidebar');
const chatArea = document.getElementById('chat-area');

// Admin Modal Elements
const adminModal = document.getElementById('admin-modal');
const closeAdminModalBtn = document.getElementById('close-admin-modal-btn');
const statTotalUsers = document.getElementById('stat-total-users');
const statTotalConvs = document.getElementById('stat-total-convs');
const statTotalMsgs = document.getElementById('stat-total-msgs');
const adminTabUsersBtn = document.getElementById('admin-tab-users-btn');
const adminTabMsgsBtn = document.getElementById('admin-tab-msgs-btn');
const adminTabUsers = document.getElementById('admin-tab-users');
const adminTabMsgs = document.getElementById('admin-tab-msgs');
const adminUsersTbody = document.getElementById('admin-users-tbody');
const adminMsgsTbody = document.getElementById('admin-msgs-tbody');

// Mute Modal Elements
const muteModal = document.getElementById('mute-modal');
const muteModalUsername = document.getElementById('mute-modal-username');
const muteDurationSelect = document.getElementById('mute-duration-select');
const cancelMuteBtn = document.getElementById('cancel-mute-btn');
const confirmMuteBtn = document.getElementById('confirm-mute-btn');

// State
let activeConversationId = null;
let activePartner = null;
let searchTimeout = null;
let selectedMuteUserId = null;
let selectedMuteUsername = null;

// ========================================================
// TOAST NOTIFICATIONS & HELPERS
// ========================================================
function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = 'toast';
  const icon = type === 'error' ? 'fa-circle-exclamation' : 'fa-circle-check';
  const color = type === 'error' ? '#f87171' : '#4ade80';
  
  toast.innerHTML = `
    <i class="fa-solid ${icon}" style="color: ${color};"></i>
    <span>${escapeHtml(message)}</span>
  `;

  toastContainer.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.2s ease';
    setTimeout(() => toast.remove(), 200);
  }, 3500);
}

function showAlert(message, type = 'error') {
  authAlert.textContent = message;
  authAlert.className = `alert-box alert-${type}`;
  authAlert.style.display = 'block';
}

function hideAlert() {
  authAlert.style.display = 'none';
  authAlert.textContent = '';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.innerText = text;
  return div.innerHTML;
}

function formatTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDateTime(isoString) {
  if (!isoString) return '';
  const date = new Date(isoString);
  return `${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (${date.toLocaleDateString()})`;
}

function getAdminBadgeHtml(username) {
  if (isAdmin(username)) {
    return `<span class="admin-badge"><i class="fa-solid fa-crown"></i> Admin</span>`;
  }
  return '';
}

// ========================================================
// AUTH UI & TAB SWITCHING
// ========================================================
tabLoginBtn.addEventListener('click', () => {
  tabLoginBtn.classList.add('active');
  tabSignupBtn.classList.remove('active');
  loginForm.style.display = 'block';
  signupForm.style.display = 'none';
  hideAlert();
});

tabSignupBtn.addEventListener('click', () => {
  tabSignupBtn.classList.add('active');
  tabLoginBtn.classList.remove('active');
  signupForm.style.display = 'block';
  loginForm.style.display = 'none';
  hideAlert();
});

// Login Form Submit
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  const usernameOrEmail = document.getElementById('login-username').value;
  const password = document.getElementById('login-password').value;
  const submitBtn = document.getElementById('login-submit-btn');

  try {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Вход...';
    await signIn({ usernameOrEmail, password });
    showToast('Успешный вход в аккаунт!');
  } catch (err) {
    showAlert(err.message || 'Ошибка входа. Проверьте имя пользователя и пароль.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Войти</span>';
  }
});

// Signup Form Submit
signupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  hideAlert();
  const username = document.getElementById('signup-username').value;
  const displayName = document.getElementById('signup-display-name').value;
  const password = document.getElementById('signup-password').value;
  const submitBtn = document.getElementById('signup-submit-btn');

  try {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Создание...';
    
    await signUp({ username, password, displayName });
    showToast('Аккаунт успешно создан!');
  } catch (err) {
    showAlert(err.message || 'Ошибка регистрации.');
  } finally {
    submitBtn.disabled = false;
    submitBtn.innerHTML = '<span>Зарегистрироваться</span>';
  }
});

// Logout
logoutBtn.addEventListener('click', async () => {
  if (confirm('Вы уверены, что хотите выйти?')) {
    await signOut();
    activeConversationId = null;
    activePartner = null;
    showToast('Вы вышли из аккаунта');
  }
});

// Copy My Tag
copyMyTagBtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (currentProfile?.username) {
    const fullTag = `@${currentProfile.username}`;
    navigator.clipboard.writeText(fullTag);
    showToast(`Тег скопирован: ${fullTag}`);
  }
});

// ========================================================
// SEARCH LOGIC (@tag and Name)
// ========================================================
searchInput.addEventListener('input', (e) => {
  const query = e.target.value.trim();
  searchClearBtn.style.display = query ? 'block' : 'none';

  clearTimeout(searchTimeout);
  if (!query) {
    searchDropdown.classList.remove('active');
    searchDropdown.innerHTML = '';
    return;
  }

  searchTimeout = setTimeout(async () => {
    searchDropdown.innerHTML = '<div style="padding: 12px; text-align: center; color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Поиск...</div>';
    searchDropdown.classList.add('active');

    const results = await searchUsers(query);
    renderSearchResults(results, query);
  }, 250);
});

searchClearBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchClearBtn.style.display = 'none';
  searchDropdown.classList.remove('active');
  searchDropdown.innerHTML = '';
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-container')) {
    searchDropdown.classList.remove('active');
  }
});

function renderSearchResults(users, query) {
  if (!users || users.length === 0) {
    searchDropdown.innerHTML = `
      <div style="padding: 14px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        Пользователь по запросу "<b>${escapeHtml(query)}</b>" не найден
      </div>
    `;
    return;
  }

  searchDropdown.innerHTML = '';
  users.forEach(user => {
    const item = document.createElement('div');
    item.className = 'search-result-item';
    const avatarSrc = user.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${user.username}`;
    const adminBadge = getAdminBadgeHtml(user.username);

    item.innerHTML = `
      <div class="user-info-flex">
        <img src="${avatarSrc}" alt="${escapeHtml(user.username)}" class="avatar avatar-sm" />
        <div>
          <div style="font-weight: 600; font-size: 0.9rem;">
            ${escapeHtml(user.display_name || user.username)}
            ${adminBadge}
          </div>
          <div class="user-tag-pill">@${escapeHtml(user.username)}</div>
        </div>
      </div>
      <button class="search-btn-chat">
        <i class="fa-regular fa-paper-plane"></i> Написать
      </button>
    `;

    item.addEventListener('click', async () => {
      searchDropdown.classList.remove('active');
      searchInput.value = '';
      searchClearBtn.style.display = 'none';
      await startChatWithUser(user);
    });

    searchDropdown.appendChild(item);
  });
}

// ========================================================
// CHAT & CONVERSATIONS
// ========================================================

async function startChatWithUser(targetUser) {
  try {
    const convId = await getOrCreateConversation(targetUser.id);
    await openConversation(convId, targetUser);
    await loadConversations();
  } catch (err) {
    showToast(err.message || 'Ошибка открытия чата', 'error');
  }
}

async function openConversation(conversationId, partnerProfile) {
  activeConversationId = conversationId;
  activePartner = partnerProfile;

  // Update Header UI
  const avatarSrc = partnerProfile.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${partnerProfile.username}`;
  activeChatAvatar.src = avatarSrc;
  
  const adminBadge = getAdminBadgeHtml(partnerProfile.username);
  activeChatName.innerHTML = `${escapeHtml(partnerProfile.display_name || partnerProfile.username)} ${adminBadge}`;
  activeChatTag.textContent = `@${partnerProfile.username}`;

  // Switch view
  emptyPlaceholder.style.display = 'none';
  activeChatContainer.style.display = 'flex';

  // Check mute state for input box
  checkUserMuteState();

  // Mobile layout switch
  sidebar.classList.add('hidden-mobile');
  chatArea.classList.add('active-mobile');

  // Highlight active conversation in sidebar
  highlightActiveSidebarItem(conversationId);

  // Load message history
  messagesContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка сообщений...</div>';
  const messages = await fetchMessages(conversationId);
  renderMessages(messages);

  // Subscribe to Realtime messages
  subscribeToActiveConversation(conversationId, (newMsg) => {
    // Собственные сообщения уже отрисованы при отправке через sendMessageForm
    if (newMsg.sender_id === currentUser?.id) {
      loadConversations();
      return;
    }
    appendMessage(newMsg);
    loadConversations();
  });

  if (!messageInput.disabled) {
    messageInput.focus();
  }
}

function checkUserMuteState() {
  if (currentProfile?.is_banned) {
    messageInput.disabled = true;
    messageInput.placeholder = 'Ваш аккаунт заблокирован';
    sendBtn.disabled = true;
    return;
  }

  if (currentProfile?.muted_until) {
    const mutedDate = new Date(currentProfile.muted_until);
    if (mutedDate > new Date()) {
      messageInput.disabled = true;
      messageInput.placeholder = `🔇 Вам выдан мут до ${formatDateTime(currentProfile.muted_until)}`;
      sendBtn.disabled = true;
      return;
    }
  }

  messageInput.disabled = false;
  messageInput.placeholder = 'Напишите сообщение...';
  sendBtn.disabled = false;
}

function highlightActiveSidebarItem(convId) {
  const items = conversationsList.querySelectorAll('.conversation-item');
  items.forEach(el => {
    if (el.dataset.convId === convId) {
      el.classList.add('active');
    } else {
      el.classList.remove('active');
    }
  });
}

function renderMessages(messages) {
  messagesContainer.innerHTML = '';
  if (!messages || messages.length === 0) {
    messagesContainer.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); margin: auto; font-size: 0.9rem;">
        Начните диалог первым! Напишите приветствие ниже 👋
      </div>
    `;
    return;
  }

  messages.forEach(msg => {
    appendMessage(msg, false);
  });

  scrollToBottom();
}

function appendMessage(msg, shouldScroll = true) {
  if (!msg) return;

  // Предотвращение дублирования сообщений по ID
  if (msg.id && messagesContainer.querySelector(`[data-msg-id="${msg.id}"]`)) {
    return;
  }

  if (messagesContainer.querySelector('div[style*="margin: auto"]')) {
    messagesContainer.innerHTML = '';
  }

  const isMe = msg.sender_id === currentUser?.id;
  const row = document.createElement('div');
  row.className = `message-row ${isMe ? 'me' : 'other'}`;
  if (msg.id) {
    row.dataset.msgId = msg.id;
  }

  const timeStr = formatTime(msg.created_at);
  const senderName = msg.profiles?.display_name || msg.profiles?.username || 'Собеседник';
  const adminBadge = getAdminBadgeHtml(msg.profiles?.username);

  row.innerHTML = `
    <div class="message-bubble">
      ${!isMe ? `<div class="message-sender-name">${escapeHtml(senderName)} ${adminBadge}</div>` : ''}
      <div class="message-text">${escapeHtml(msg.content)}</div>
      <div class="message-meta">
        <span>${timeStr}</span>
        ${isMe ? '<i class="fa-solid fa-check" style="font-size: 0.65rem;"></i>' : ''}
      </div>
    </div>
  `;

  messagesContainer.appendChild(row);

  if (shouldScroll) {
    scrollToBottom();
  }
}

function scrollToBottom() {
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Send Message Form
sendMessageForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = messageInput.value.trim();
  if (!text || !activeConversationId) return;

  messageInput.value = '';

  try {
    const sentMsg = await sendMessage(activeConversationId, text);
    if (sentMsg) {
      appendMessage(sentMsg);
      await loadConversations();
    }
  } catch (err) {
    showToast(err.message || 'Не удалось отправить сообщение', 'error');
  }
});

// Load and Render Conversations List in Sidebar
async function loadConversations() {
  const conversations = await fetchConversations();
  renderConversationsList(conversations);
}

function renderConversationsList(conversations) {
  if (!conversations || conversations.length === 0) {
    conversationsList.innerHTML = `
      <div style="padding: 24px; text-align: center; color: var(--text-muted); font-size: 0.85rem;">
        <i class="fa-regular fa-comment-dots" style="font-size: 1.8rem; margin-bottom: 8px; display: block;"></i>
        У вас пока нет чатов.<br>Найдите людей по <b>@тегу</b> в поиске выше!
      </div>
    `;
    return;
  }

  conversationsList.innerHTML = '';
  conversations.forEach(conv => {
    const item = document.createElement('div');
    item.className = `conversation-item ${conv.id === activeConversationId ? 'active' : ''}`;
    item.dataset.convId = conv.id;

    const partner = conv.partner;
    const avatarSrc = partner.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${partner.username}`;
    const lastMsgText = conv.lastMessage ? conv.lastMessage.content : 'Диалог создан';
    const lastMsgTime = conv.lastMessage ? formatTime(conv.lastMessage.created_at) : '';
    const adminBadge = getAdminBadgeHtml(partner.username);

    item.innerHTML = `
      <div class="conv-avatar-wrap">
        <img src="${avatarSrc}" alt="${escapeHtml(partner.username)}" class="avatar" />
      </div>
      <div class="conv-content">
        <div class="conv-top-row">
          <span class="conv-name">${escapeHtml(partner.display_name || partner.username)} ${adminBadge}</span>
          <span class="conv-time">${lastMsgTime}</span>
        </div>
        <div class="conv-bottom-row">
          <span class="conv-preview">${escapeHtml(lastMsgText)}</span>
        </div>
      </div>
    `;

    item.addEventListener('click', () => {
      openConversation(conv.id, partner);
    });

    conversationsList.appendChild(item);
  });
}

// Mobile back button
backToSidebarBtn.addEventListener('click', () => {
  sidebar.classList.remove('hidden-mobile');
  chatArea.classList.remove('active-mobile');
});

// ========================================================
// ADMIN PANEL LOGIC (FOR USER puffahaka)
// ========================================================

adminPanelBtn.addEventListener('click', async () => {
  adminModal.style.display = 'flex';
  await loadAdminDashboard();
});

closeAdminModalBtn.addEventListener('click', () => {
  adminModal.style.display = 'none';
});

adminModal.addEventListener('click', (e) => {
  if (e.target === adminModal) {
    adminModal.style.display = 'none';
  }
});

adminTabUsersBtn.addEventListener('click', () => {
  adminTabUsersBtn.classList.add('active');
  adminTabMsgsBtn.classList.remove('active');
  adminTabUsers.style.display = 'block';
  adminTabMsgs.style.display = 'none';
});

adminTabMsgsBtn.addEventListener('click', async () => {
  adminTabMsgsBtn.classList.add('active');
  adminTabUsersBtn.classList.remove('active');
  adminTabMsgs.style.display = 'block';
  adminTabUsers.style.display = 'none';
  await loadAdminMessages();
});

async function loadAdminDashboard() {
  try {
    // 1. Stats
    const stats = await getAdminStats();
    statTotalUsers.textContent = stats.totalUsers;
    statTotalConvs.textContent = stats.totalConversations;
    statTotalMsgs.textContent = stats.totalMessages;

    // 2. Users Table
    adminUsersTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка пользователей...</td></tr>';
    const users = await getAllUsers();
    
    adminUsersTbody.innerHTML = '';
    users.forEach(u => {
      const tr = document.createElement('tr');
      const avatarSrc = u.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${u.username}`;
      const badge = getAdminBadgeHtml(u.username);
      
      // Status Badge
      let statusHtml = '<span class="status-badge active"><i class="fa-solid fa-check"></i> Активен</span>';
      const isUserMuted = u.muted_until && new Date(u.muted_until) > new Date();

      if (u.is_banned) {
        statusHtml = '<span class="status-badge banned"><i class="fa-solid fa-ban"></i> Забанен</span>';
      } else if (isUserMuted) {
        statusHtml = `<span class="status-badge muted" title="До ${formatDateTime(u.muted_until)}"><i class="fa-solid fa-volume-xmark"></i> Мут (${formatTime(u.muted_until)})</span>`;
      }

      const isSelf = u.id === currentUser?.id;

      tr.innerHTML = `
        <td><img src="${avatarSrc}" class="avatar avatar-sm" style="width: 32px; height: 32px;" /></td>
        <td>
          <b>${escapeHtml(u.display_name || u.username)}</b> ${badge}<br>
          <span style="color: #818cf8; font-size: 0.8rem;">@${escapeHtml(u.username)}</span>
        </td>
        <td>${statusHtml}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
            ${!isSelf ? `
              <button class="admin-action-btn" style="background: var(--primary); color: white;" data-action="chat" data-user-id="${u.id}" title="Написать">
                <i class="fa-regular fa-paper-plane"></i>
              </button>

              ${!u.is_banned ? `
                <button class="admin-action-btn btn-ban" data-action="ban" data-user-id="${u.id}" title="Забанить пользователя">
                  <i class="fa-solid fa-ban"></i> Бан
                </button>
              ` : `
                <button class="admin-action-btn btn-unban" data-action="unban" data-user-id="${u.id}" title="Разбанить пользователя">
                  <i class="fa-solid fa-unlock"></i> Разбан
                </button>
              `}

              ${!isUserMuted ? `
                <button class="admin-action-btn btn-mute" data-action="mute" data-user-id="${u.id}" data-username="${escapeHtml(u.username)}" title="Дать мут">
                  <i class="fa-solid fa-volume-xmark"></i> Мут
                </button>
              ` : `
                <button class="admin-action-btn btn-unmute" data-action="unmute" data-user-id="${u.id}" title="Снять мут">
                  <i class="fa-solid fa-volume-high"></i> Снять мут
                </button>
              `}
            ` : '<span style="color: var(--text-muted); font-size: 0.8rem;">Вы (Админ)</span>'}
          </div>
        </td>
      `;

      // Event handlers for user actions
      const chatBtn = tr.querySelector('[data-action="chat"]');
      if (chatBtn) {
        chatBtn.addEventListener('click', async () => {
          adminModal.style.display = 'none';
          await startChatWithUser(u);
        });
      }

      const banBtn = tr.querySelector('[data-action="ban"]');
      if (banBtn) {
        banBtn.addEventListener('click', async () => {
          if (confirm(`Заблокировать пользователя @${u.username}? Он не сможет войти и писать сообщения.`)) {
            try {
              await adminBanUser(u.id, true);
              showToast(`Пользователь @${u.username} заблокирован!`);
              await loadAdminDashboard();
            } catch (e) {
              showToast(e.message, 'error');
            }
          }
        });
      }

      const unbanBtn = tr.querySelector('[data-action="unban"]');
      if (unbanBtn) {
        unbanBtn.addEventListener('click', async () => {
          try {
            await adminBanUser(u.id, false);
            showToast(`Пользователь @${u.username} разблокирован!`);
            await loadAdminDashboard();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      }

      const muteBtn = tr.querySelector('[data-action="mute"]');
      if (muteBtn) {
        muteBtn.addEventListener('click', () => {
          selectedMuteUserId = u.id;
          selectedMuteUsername = u.username;
          muteModalUsername.textContent = `Пользователь: @${u.username}`;
          muteModal.style.display = 'flex';
        });
      }

      const unmuteBtn = tr.querySelector('[data-action="unmute"]');
      if (unmuteBtn) {
        unmuteBtn.addEventListener('click', async () => {
          try {
            await adminUnmuteUser(u.id);
            showToast(`Мут с пользователя @${u.username} снят!`);
            await loadAdminDashboard();
          } catch (e) {
            showToast(e.message, 'error');
          }
        });
      }

      adminUsersTbody.appendChild(tr);
    });
  } catch (err) {
    showToast(err.message || 'Ошибка загрузки админ-панели', 'error');
  }
}

// Mute Modal Confirmation
confirmMuteBtn.addEventListener('click', async () => {
  if (!selectedMuteUserId) return;
  const minutes = parseInt(muteDurationSelect.value, 10);
  
  try {
    confirmMuteBtn.disabled = true;
    const untilIso = await adminMuteUser(selectedMuteUserId, minutes);
    showToast(`Пользователю @${selectedMuteUsername} выдан мут на ${minutes} мин.`);
    muteModal.style.display = 'none';
    selectedMuteUserId = null;
    selectedMuteUsername = null;
    await loadAdminDashboard();
  } catch (e) {
    showToast(e.message, 'error');
  } finally {
    confirmMuteBtn.disabled = false;
  }
});

cancelMuteBtn.addEventListener('click', () => {
  muteModal.style.display = 'none';
  selectedMuteUserId = null;
  selectedMuteUsername = null;
});

async function loadAdminMessages() {
  adminMsgsTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px;"><i class="fa-solid fa-spinner fa-spin"></i> Загрузка сообщений...</td></tr>';
  try {
    const msgs = await getAllRecentMessages(100);
    adminMsgsTbody.innerHTML = '';
    
    if (msgs.length === 0) {
      adminMsgsTbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 20px;">Нет сообщений в базе</td></tr>';
      return;
    }

    msgs.forEach(m => {
      const tr = document.createElement('tr');
      const sender = m.profiles?.display_name || m.profiles?.username || 'Неизвестный';
      const senderTag = m.profiles?.username ? `@${m.profiles.username}` : '';
      
      tr.innerHTML = `
        <td>
          <b>${escapeHtml(sender)}</b><br>
          <span style="color: #818cf8; font-size: 0.75rem;">${escapeHtml(senderTag)}</span>
        </td>
        <td style="max-width: 300px; word-break: break-word;">${escapeHtml(m.content)}</td>
        <td style="font-size: 0.75rem; color: var(--text-muted); white-space: nowrap;">${formatTime(m.created_at)}</td>
        <td>
          <button class="admin-action-btn" data-msg-id="${m.id}" title="Удалить сообщение">
            <i class="fa-solid fa-trash"></i>
          </button>
        </td>
      `;

      const delBtn = tr.querySelector('.admin-action-btn');
      delBtn.addEventListener('click', async () => {
        if (confirm('Вы уверены, что хотите удалить это сообщение?')) {
          try {
            await adminDeleteMessage(m.id);
            tr.remove();
            showToast('Сообщение удалено администратором');
            if (activeConversationId === m.conversation_id) {
              const activeRow = messagesContainer.querySelector(`[data-msg-id="${m.id}"]`);
              if (activeRow) activeRow.remove();
            }
          } catch (e) {
            showToast('Не удалось удалить сообщение: ' + e.message, 'error');
          }
        }
      });

      adminMsgsTbody.appendChild(tr);
    });
  } catch (err) {
    adminMsgsTbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #f87171; padding: 20px;">${escapeHtml(err.message)}</td></tr>`;
  }
}

// ========================================================
// APP INITIALIZATION & AUTH STATE HANDLER
// ========================================================
initAuth(async (user, profile) => {
  if (user && profile) {
    // Check if user is banned
    if (profile.is_banned && !isAdmin(profile.username)) {
      alert('⛔ Ваш аккаунт был заблокирован администратором.');
      await signOut();
      return;
    }

    // Authenticated
    authModal.style.display = 'none';
    sidebarUserFooter.style.display = 'flex';

    myDisplayName.textContent = profile.display_name || profile.username;
    myUsername.textContent = `@${profile.username}`;
    myAvatar.src = profile.avatar_url || `https://api.dicebear.com/7.x/bottts/svg?seed=${profile.username}`;

    // Admin privileges check for user puffahaka
    if (isAdmin(profile.username)) {
      myAdminBadge.style.display = 'inline-flex';
      adminPanelBtn.style.display = 'flex';
    } else {
      myAdminBadge.style.display = 'none';
      adminPanelBtn.style.display = 'none';
    }

    await loadConversations();

    // Subscribe to global new message notifications
    subscribeToGlobalEvents(() => {
      loadConversations();
    });
  } else {
    // Unauthenticated
    authModal.style.display = 'flex';
    sidebarUserFooter.style.display = 'none';
    conversationsList.innerHTML = '';
    activeChatContainer.style.display = 'none';
    emptyPlaceholder.style.display = 'flex';
    activeConversationId = null;
    activePartner = null;
    myAdminBadge.style.display = 'none';
    adminPanelBtn.style.display = 'none';
  }
});
