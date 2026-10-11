(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { user: null, event: null, tickets: [], activeOrder: null, countdownTimer: null };
  const statusLabels = { reserved: 'Đang giữ chỗ', pending: 'Chờ duyệt thanh toán', approved: 'Đã xác nhận', rejected: 'Cần kiểm tra lại', expired: 'Đã hết hạn' };

  async function api(url, options = {}) {
    const config = { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } };
    if (config.body && !(config.body instanceof FormData) && typeof config.body !== 'string') {
      config.headers['Content-Type'] = 'application/json'; config.body = JSON.stringify(config.body);
    }
    const response = await fetch(url, config);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(payload?.error || 'Có lỗi xảy ra. Vui lòng thử lại.');
    return payload;
  }
  const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
  const money = value => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));
  const prettyDate = value => {
    if (!value) return '—';
    const [year, month, day] = String(value).split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return `${String(day).padStart(2, '0')} tháng ${String(month).padStart(2, '0')}, ${year}`;
  };
  const toast = (message, kind = 'success') => {
    const node = document.createElement('div'); node.className = `toast ${kind}`; node.textContent = message;
    $('#toastRegion').append(node); window.setTimeout(() => node.remove(), 4400);
  };
  function openModal(id) {
    const modal = document.getElementById(id); if (!modal) return;
    modal.classList.add('open'); modal.setAttribute('aria-hidden', 'false'); document.body.classList.add('modal-open');
  }
  function closeModal(id) {
    const modal = document.getElementById(id); if (!modal) return;
    modal.classList.remove('open'); modal.setAttribute('aria-hidden', 'true');
    if (!$('.modal-backdrop.open')) document.body.classList.remove('modal-open');
  }
  function updateAccountButton() {
    $('#accountButton').textContent = state.user ? 'Tài khoản của tôi' : 'Đăng nhập';
  }
  function authPrompt(tab = 'login') {
    setAuthTab(tab); openModal('accountModal');
  }
  function setAuthTab(tab) {
    $$('.auth-tabs button').forEach(button => button.classList.toggle('active', button.dataset.authTab === tab));
    $('#loginForm').classList.toggle('hidden', tab !== 'login'); $('#registerForm').classList.toggle('hidden', tab !== 'register');
    $('#accountTitle').innerHTML = tab === 'login' ? 'Gặp lại <em>nhau.</em>' : 'Bắt đầu <em>hành trình.</em>';
  }

  async function loadEvent() {
    const data = await api('/api/event'); state.event = data.event; state.tickets = data.tickets;
    $('#showDate').textContent = prettyDate(data.event.date);
    $('#showTime').textContent = `${data.event.time} · ${weekdayVi(data.event.date)}`;
    $('#showVenue').textContent = data.event.venue;
    $('#showAddress').textContent = data.event.address;
    renderTickets();
  }
  function weekdayVi(value) {
    const [year, month, day] = String(value).split('-').map(Number);
    return new Intl.DateTimeFormat('vi-VN', { weekday: 'long' }).format(new Date(year, month - 1, day));
  }
  function renderTickets() {
    const grid = $('#ticketGrid');
    if (!state.tickets.length) { grid.innerHTML = '<div class="loading-card">Hiện chưa có hạng vé mở bán. Bạn hãy quay lại sau nhé.</div>'; return; }
    grid.innerHTML = state.tickets.map((ticket, index) => {
      const available = Number(ticket.remaining || 0); const stock = Math.max(Number(ticket.stock), 1);
      const percentage = Math.max(0, Math.min(100, available / stock * 100));
      const featured = ticket.accent === 'gold' || index === 1;
      return `<article class="ticket-card ${featured ? 'featured' : ''}">
        <span class="ticket-label">${String(index + 1).padStart(2, '0')} / FIRE CLUB TICKET</span>
        <h3>${escapeHtml(ticket.name)}</h3><p class="ticket-subtitle">${escapeHtml(ticket.subtitle)}</p>
        <div class="ticket-price">${money(ticket.price)}<small> / VÉ</small></div>
        <div class="ticket-separator"></div>
        <div class="ticket-features"><span>Vé vào cửa đêm nhạc Thập Kỷ</span><span>Lưu giữ kỷ niệm 10 năm Fire</span><span>Thông tin vé qua tài khoản</span></div>
        <div class="ticket-availability"><span>${available > 0 ? `Còn ${available} vé` : 'Tạm hết vé'}</span><span>${available > 0 ? 'SỐ LƯỢNG GIỚI HẠN' : 'SOLD OUT'}</span></div>
        <div class="stock-bar"><span style="width:${percentage}%"></span></div>
        <label class="quantity-picker">Số lượng <select aria-label="Số lượng ${escapeHtml(ticket.name)}" id="qty-${ticket.id}" ${available < 1 ? 'disabled' : ''}>${Array.from({ length: Math.min(6, available) }, (_, i) => `<option value="${i + 1}">${i + 1} vé</option>`).join('')}</select></label>
        <button class="button ${featured ? 'button-gold' : 'button-outline'} reserve-button" data-ticket-id="${ticket.id}" ${available < 1 ? 'disabled' : ''}>${available > 0 ? 'Giữ chỗ ngay' : 'Đã hết vé'} <span>↗</span></button>
      </article>`;
    }).join('');
    $$('.reserve-button').forEach(button => button.addEventListener('click', () => reserveTicket(Number(button.dataset.ticketId))));
  }

  async function reserveTicket(ticketId) {
    if (!state.user) { toast('Đăng nhập hoặc tạo tài khoản trước khi giữ vé nhé.', 'error'); authPrompt('login'); return; }
    const quantity = Number($(`#qty-${ticketId}`)?.value || 1);
    const button = $(`.reserve-button[data-ticket-id="${ticketId}"]`); if (button) { button.disabled = true; button.classList.add('is-loading'); }
    try {
      const result = await api('/api/orders', { method: 'POST', body: { ticketId, quantity } });
      state.activeOrder = result.order;
      // Refresh inventory after the server atomically holds this order.
      await loadEvent();
      openCheckout(result.order, result.event);
    } catch (error) { toast(error.message, 'error'); await loadEvent().catch(() => {}); }
    finally { if (button) { button.disabled = false; button.classList.remove('is-loading'); } }
  }
  function openCheckout(order, event = state.event) {
    state.activeOrder = order;
    $('#checkoutOrderShort').textContent = order.id;
    $('#checkoutSummary').innerHTML = `<div><b>${escapeHtml(order.ticket_name || `Vé #${order.ticket_id}`)}</b><small>${order.quantity} vé × ${money(order.unit_price)}</small><small>Mã đơn: ${escapeHtml(order.id)}</small></div><div class="summary-total"><small>TỔNG THANH TOÁN</small><b>${money(order.total)}</b></div>`;
    $('#bankName').textContent = event.bank_name || '—'; $('#bankAccount').childNodes[0].textContent = event.bank_account || '— ';
    $('#bankOwner').textContent = event.bank_owner || '—'; $('#transferReference').childNodes[0].textContent = order.transfer_reference || order.id;
    $('#transferTotal').textContent = money(order.total); $('#bankNote').textContent = event.bank_note || '';
    const demo = /demo|cần cập nhật|0000000000/i.test(`${event.bank_name} ${event.bank_account} ${event.bank_note}`);
    $('#bankWarning').classList.toggle('hidden', !demo);
    const reserved = order.status === 'reserved'; const pending = order.status === 'pending';
    $('#proofForm').classList.toggle('hidden', !reserved && !pending);
    $('#checkoutSuccess').classList.toggle('hidden', !pending && order.status !== 'approved');
    if (pending || order.status === 'approved') {
      $('#checkoutSuccess').querySelector('b').textContent = order.status === 'approved' ? 'Thanh toán đã được xác nhận' : 'Minh chứng đã được gửi';
      $('#checkoutSuccess').querySelector('p').textContent = order.status === 'approved' ? 'Đơn vé của bạn đã được xác nhận. Hãy lưu lại mã đơn để đối chiếu khi cần.' : 'Đơn vé của bạn đang chờ Ban tổ chức xác nhận. Bạn có thể theo dõi trạng thái trong Tài khoản.';
    }
    $('#proofFile').value = ''; $('#proofFileName').textContent = 'Chọn ảnh hoặc PDF minh chứng';
    startCountdown(order, event);
    openModal('checkoutModal');
  }
  function startCountdown(order, event) {
    if (state.countdownTimer) clearInterval(state.countdownTimer);
    const label = $('#holdCountdown');
    if (order.status !== 'reserved' || !order.expires_at) { label.textContent = order.status === 'pending' ? 'ĐANG CHỜ DUYỆT' : '—'; return; }
    const tick = () => {
      const seconds = Math.max(0, Math.floor((new Date(order.expires_at).getTime() - Date.now()) / 1000));
      label.textContent = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
      if (seconds <= 0) {
        clearInterval(state.countdownTimer); state.countdownTimer = null;
        $('#proofForm').classList.add('hidden'); toast('Thời gian giữ chỗ đã hết. Hãy chọn vé để tạo đơn mới.', 'error');
        label.textContent = 'HẾT HẠN';
        state.activeOrder = { ...order, status: 'expired' };
      }
    };
    tick(); state.countdownTimer = setInterval(tick, 1000);
  }

  async function loadOrders() {
    const data = await api('/api/orders');
    $('#accountProfile').innerHTML = `<span class="profile-avatar">${escapeHtml((state.user.name || 'F').slice(0, 1).toUpperCase())}</span><div><b>${escapeHtml(state.user.name)}</b><small>${escapeHtml(state.user.email)} · Tài khoản khách</small></div>`;
    if (!data.orders.length) { $('#ordersList').innerHTML = '<div class="loading-card">Bạn chưa có đơn vé nào. Chọn một hạng vé để bắt đầu hành trình nhé.</div>'; return; }
    $('#ordersList').innerHTML = data.orders.map(order => {
      const canResume = order.status === 'reserved';
      return `<article class="order-card"><div class="order-card-top"><div><h3>${escapeHtml(order.ticket_name)}</h3><p class="order-id">${escapeHtml(order.id)} · ${new Date(order.created_at).toLocaleString('vi-VN')}</p></div><div class="order-total">${money(order.total)}</div></div>
        <span class="status-pill ${order.status}">${statusLabels[order.status] || order.status}</span>
        <div class="order-meta"><span>${order.quantity} vé</span>${order.transfer_reference ? `<span>Nội dung CK: ${escapeHtml(order.transfer_reference)}</span>` : ''}</div>
        ${order.admin_note ? `<p class="order-meta">Ghi chú BTC: ${escapeHtml(order.admin_note)}</p>` : ''}
        <div class="order-card-actions">${canResume ? `<button class="small-action" data-resume-order="${escapeHtml(order.id)}">Thanh toán / gửi minh chứng</button><button class="small-action" data-cancel-order="${escapeHtml(order.id)}">Hủy giữ chỗ</button>` : ''}${order.has_proof ? `<button class="small-action" data-view-proof="${escapeHtml(order.id)}">Xem minh chứng đã gửi</button>` : ''}</div>
      </article>`;
    }).join('');
    $$('[data-resume-order]').forEach(button => button.addEventListener('click', () => resumeOrder(button.dataset.resumeOrder)));
    $$('[data-cancel-order]').forEach(button => button.addEventListener('click', () => cancelOrder(button.dataset.cancelOrder)));
    $$('[data-view-proof]').forEach(button => button.addEventListener('click', () => window.open(`/api/orders/${encodeURIComponent(button.dataset.viewProof)}/proof`, '_blank', 'noopener')));
  }
  async function resumeOrder(id) {
    try { const result = await api(`/api/orders/${encodeURIComponent(id)}`); closeModal('ordersModal'); openCheckout(result.order, result.event); }
    catch (error) { toast(error.message, 'error'); await loadOrders().catch(() => {}); }
  }
  async function cancelOrder(id) {
    if (!window.confirm('Bạn muốn hủy giữ chỗ cho đơn này?')) return;
    try { await api(`/api/orders/${encodeURIComponent(id)}`, { method: 'DELETE' }); toast('Đã hủy giữ chỗ.'); await loadOrders(); await loadEvent(); }
    catch (error) { toast(error.message, 'error'); }
  }
  async function openAccount() {
    if (!state.user) { authPrompt('login'); return; }
    try { await loadOrders(); openModal('ordersModal'); }
    catch (error) { toast(error.message, 'error'); }
  }

  $('#accountButton').addEventListener('click', openAccount);
  $$('.auth-tabs button').forEach(button => button.addEventListener('click', () => setAuthTab(button.dataset.authTab)));
  $('#loginForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); button.disabled = true;
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { const result = await api('/api/auth/login', { method: 'POST', body: data }); state.user = result.user; updateAccountButton(); closeModal('accountModal'); event.currentTarget.reset(); toast(`Xin chào ${state.user.name}!`); }
    catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  $('#registerForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); button.disabled = true;
    const data = Object.fromEntries(new FormData(event.currentTarget).entries());
    try { const result = await api('/api/auth/register', { method: 'POST', body: data }); state.user = result.user; updateAccountButton(); closeModal('accountModal'); event.currentTarget.reset(); toast('Tạo tài khoản thành công. Chọn hạng vé để giữ chỗ nhé.'); }
    catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  $('#logoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); state.user = null; updateAccountButton(); closeModal('ordersModal'); toast('Bạn đã đăng xuất.'); }
    catch (error) { toast(error.message, 'error'); }
  });
  $$('.modal-close').forEach(button => button.addEventListener('click', () => closeModal(button.dataset.close)));
  $$('.modal-backdrop').forEach(backdrop => backdrop.addEventListener('click', event => { if (event.target === backdrop) closeModal(backdrop.id); }));
  document.addEventListener('keydown', event => { if (event.key === 'Escape') $$('.modal-backdrop.open').forEach(modal => closeModal(modal.id)); });
  $('#mobileMenu').addEventListener('click', () => $('#navLinks').classList.toggle('open'));
  $$('#navLinks a').forEach(link => link.addEventListener('click', () => $('#navLinks').classList.remove('open')));
  $('#proofFile').addEventListener('change', event => { $('#proofFileName').textContent = event.target.files?.[0]?.name || 'Chọn ảnh hoặc PDF minh chứng'; });
  $('#proofForm').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.activeOrder?.id) return;
    const file = $('#proofFile').files[0]; if (!file) return toast('Hãy chọn tệp minh chứng trước.', 'error');
    if (file.size > 5 * 1024 * 1024) return toast('Tệp lớn hơn 5 MB. Hãy chọn tệp nhỏ hơn.', 'error');
    const button = $('button[type="submit"]', event.currentTarget); const original = button.innerHTML; button.disabled = true; button.textContent = 'Đang gửi minh chứng…';
    const formData = new FormData(); formData.append('proof', file);
    try {
      const result = await api(`/api/orders/${encodeURIComponent(state.activeOrder.id)}/proof`, { method: 'POST', body: formData });
      state.activeOrder = result.order; $('#proofForm').classList.add('hidden'); $('#checkoutSuccess').classList.remove('hidden');
      $('#checkoutSuccess').querySelector('b').textContent = 'Minh chứng đã được gửi';
      $('#checkoutSuccess').querySelector('p').textContent = result.message || 'Đơn vé đang chờ Ban tổ chức xác nhận.';
      if (state.countdownTimer) clearInterval(state.countdownTimer); $('#holdCountdown').textContent = 'ĐANG CHỜ DUYỆT';
      toast('Đã gửi minh chứng thành công.'); await loadEvent();
    } catch (error) { toast(error.message, 'error'); }
    finally { button.disabled = false; button.innerHTML = original; }
  });
  $('#openOrdersButton').addEventListener('click', async () => { closeModal('checkoutModal'); await openAccount(); });
  $$('[data-copy]').forEach(button => button.addEventListener('click', async () => {
    const element = document.getElementById(button.dataset.copy); const text = element?.childNodes?.[0]?.textContent?.trim() || element?.textContent?.trim();
    try { await navigator.clipboard.writeText(text); toast('Đã sao chép.'); }
    catch { toast(`Bạn hãy sao chép thủ công: ${text}`, 'error'); }
  }));

  // Small entrance effects; content remains visible when reduced motion is enabled.
  if ('IntersectionObserver' in window) {
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (entry.isIntersecting) { entry.target.classList.add('in-view'); observer.unobserve(entry.target); }
    }), { threshold: 0.08 });
    $$('.reveal').forEach(element => observer.observe(element));
  } else $$('.reveal').forEach(element => element.classList.add('in-view'));
  const loadMe = async () => { try { const result = await api('/api/me'); state.user = result.user; updateAccountButton(); } catch {} };
  Promise.all([loadMe(), loadEvent()]).catch(error => { console.error(error); toast('Không tải được dữ liệu show. Hãy tải lại trang.', 'error'); });
})();
