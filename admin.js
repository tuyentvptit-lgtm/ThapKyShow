(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  let adminUser = null; let allOrders = []; let activeStatus = 'all'; let summaryData = null;
  const statusNames = { reserved: 'Đang giữ chỗ', pending: 'Chờ duyệt', approved: 'Đã xác nhận', rejected: 'Từ chối', expired: 'Hết hạn' };
  const money = value => new Intl.NumberFormat('vi-VN', { style: 'currency', currency: 'VND', maximumFractionDigits: 0 }).format(Number(value || 0));
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
  async function api(url, options = {}) {
    const config = { credentials: 'same-origin', ...options, headers: { ...(options.headers || {}) } };
    if (config.body && typeof config.body !== 'string') { config.headers['Content-Type'] = 'application/json'; config.body = JSON.stringify(config.body); }
    const response = await fetch(url, config); const type = response.headers.get('content-type') || '';
    const data = type.includes('application/json') ? await response.json() : await response.text();
    if (!response.ok) throw new Error(data?.error || 'Yêu cầu không thành công.');
    return data;
  }
  function flash(message, kind = 'success') {
    const toast = document.createElement('div'); toast.className = `admin-inline-toast ${kind}`; toast.textContent = message;
    document.body.append(toast); setTimeout(() => toast.remove(), 4200);
  }
  function showDashboard() {
    $('#adminLogin').classList.add('hidden'); $('#adminDashboard').classList.remove('hidden');
    $('#adminWelcome').textContent = `${adminUser.name} · Toàn cảnh hoạt động vé Thập Kỷ.`;
    refreshAll().catch(error => flash(error.message, 'error'));
  }
  function showLogin(message = '') {
    $('#adminDashboard').classList.add('hidden'); $('#adminLogin').classList.remove('hidden'); $('#adminLoginError').textContent = message;
  }
  async function refreshAll() {
    const [summary, orderResult] = await Promise.all([api('/api/admin/summary'), api('/api/admin/orders')]);
    summaryData = summary; allOrders = orderResult.orders;
    renderStats(); renderOrders(); renderEventForm(summary.event); renderTickets(summary.tickets);
  }
  function renderStats() {
    const counts = summaryData.counts;
    const stats = [
      ['TỔNG ĐƠN', counts.all, ''], ['CHỜ DUYỆT', counts.pending, 'pending'], ['ĐÃ XÁC NHẬN', counts.approved, 'approved'], ['DOANH THU ĐÃ DUYỆT', money(summaryData.approvedRevenue), 'revenue']
    ];
    $('#adminStats').innerHTML = stats.map(([label, value, type]) => `<div class="admin-stat ${type}"><small>${label}</small><b>${escapeHtml(value)}</b></div>`).join('');
  }
  function renderOrders() {
    const query = $('#orderSearch').value.trim().toLowerCase();
    const orders = allOrders.filter(order => (activeStatus === 'all' || order.status === activeStatus) && (!query || `${order.id} ${order.customer_name} ${order.customer_email} ${order.ticket_name} ${order.customer_phone}`.toLowerCase().includes(query)));
    if (!orders.length) { $('#adminOrders').innerHTML = '<div class="admin-empty">Không tìm thấy đơn phù hợp với bộ lọc hiện tại.</div>'; return; }
    $('#adminOrders').innerHTML = orders.map(order => {
      const waiting = order.status === 'pending'; const hold = order.status === 'reserved';
      return `<article class="admin-order" data-order-id="${escapeHtml(order.id)}">
        <div class="admin-order-head"><div><div class="admin-order-id">${escapeHtml(order.id)} · ${escapeHtml(new Date(order.created_at).toLocaleString('vi-VN'))}</div><h3>${escapeHtml(order.customer_name)} <span class="status-pill ${order.status}">${statusNames[order.status] || order.status}</span></h3><div class="admin-order-customer">${escapeHtml(order.customer_email)}${order.customer_phone ? ` · ${escapeHtml(order.customer_phone)}` : ''}</div></div><div class="admin-order-total">${money(order.total)}</div></div>
        <div class="admin-order-details"><span>Hạng vé: <b>${escapeHtml(order.ticket_name)}</b></span><span>Số lượng: <b>${order.quantity}</b></span><span>Đơn giá: <b>${money(order.unit_price)}</b></span><span>Nội dung CK: <b>${escapeHtml(order.transfer_reference || '—')}</b></span>${order.expires_at && hold ? `<span>Hết giữ: <b>${new Date(order.expires_at).toLocaleString('vi-VN')}</b></span>` : ''}</div>
        ${order.admin_note ? `<div class="admin-order-note">Ghi chú hiện tại: ${escapeHtml(order.admin_note)}</div>` : ''}
        <div class="admin-order-actions">${order.has_proof ? `<button class="small-action" data-proof="${escapeHtml(order.id)}">↗ Mở minh chứng</button>` : '<span class="small-action" style="opacity:.55;cursor:default">Chưa có minh chứng</span>'}
          ${waiting ? `<input class="admin-note-input" id="note-${escapeHtml(order.id)}" placeholder="Ghi chú cho khách (không bắt buộc)" maxlength="500"><button class="small-action approve-action" data-decision="approved" data-id="${escapeHtml(order.id)}">✓ Duyệt</button><button class="small-action reject-action" data-decision="rejected" data-id="${escapeHtml(order.id)}">× Từ chối</button>` : ''}
          ${hold ? `<button class="small-action" data-cancel-hold="${escapeHtml(order.id)}">Trả chỗ / hết hạn</button>` : ''}
        </div>
      </article>`;
    }).join('');
    $$('[data-proof]').forEach(button => button.addEventListener('click', () => {
      const popup = window.open(`/api/orders/${encodeURIComponent(button.dataset.proof)}/proof`, '_blank', 'noopener');
      if (!popup) flash('Trình duyệt đã chặn cửa sổ mới. Hãy cho phép popup hoặc mở liên kết trong tab mới.', 'error');
    }));
    $$('[data-decision]').forEach(button => button.addEventListener('click', () => decideOrder(button.dataset.id, button.dataset.decision)));
    $$('[data-cancel-hold]').forEach(button => button.addEventListener('click', () => expireHold(button.dataset.cancelHold)));
  }
  async function decideOrder(id, status) {
    const note = $(`#note-${CSS.escape(id)}`)?.value.trim() || '';
    const confirmed = status === 'approved'
      ? window.confirm(`Xác nhận đã kiểm tra và nhận được tiền cho đơn ${id}?`)
      : window.confirm(`Từ chối minh chứng/đơn ${id}? Vé sẽ được trả lại kho.`);
    if (!confirmed) return;
    try { const result = await api(`/api/admin/orders/${encodeURIComponent(id)}`, { method: 'PATCH', body: { status, adminNote: note } }); flash(result.message || 'Đã cập nhật đơn.'); await refreshAll(); }
    catch (error) { flash(error.message, 'error'); }
  }
  async function expireHold(id) {
    if (!window.confirm(`Trả lại kho vé đang giữ của đơn ${id}?`)) return;
    // The public cancel endpoint enforces ownership, so this administrative action changes it only via a dedicated safe route.
    try { await api(`/api/admin/orders/${encodeURIComponent(id)}/release`, { method: 'POST', body: {} }); flash('Đã trả lại kho vé.'); await refreshAll(); }
    catch (error) { flash(error.message, 'error'); }
  }
  function renderEventForm(event) {
    const form = $('#eventConfigForm');
    Object.entries(event).forEach(([key, value]) => { const input = form.elements.namedItem(key); if (input) input.value = value ?? ''; });
  }
  function renderTickets(tickets) {
    $('#adminTickets').innerHTML = tickets.map(ticket => `<form class="admin-ticket-item" data-ticket-form="${ticket.id}">
      <div class="ticket-primary"><div class="ticket-title">${escapeHtml(ticket.name)}</div><div class="ticket-remaining">Còn ${ticket.remaining} vé · ${ticket.active ? 'Đang mở bán' : 'Đã ẩn'}</div></div>
      <label>Tên hạng vé<input class="admin-input" name="name" value="${escapeHtml(ticket.name)}" maxlength="100" required></label>
      <label>Giá (VND)<input class="admin-input" type="number" name="price" min="0" step="1000" value="${ticket.price}" required></label>
      <label>Tổng số lượng<input class="admin-input" type="number" name="stock" min="0" max="100000" value="${ticket.stock}" required></label>
      <label>Giới thiệu ngắn<input class="admin-input" name="subtitle" value="${escapeHtml(ticket.subtitle)}" maxlength="200"></label>
      <label class="ticket-toggle"><span>Mở bán</span><input type="checkbox" name="active" ${ticket.active ? 'checked' : ''}></label>
      <button class="button button-outline save-ticket" type="submit">Lưu hạng vé</button>
    </form>`).join('');
    $$('[data-ticket-form]').forEach(form => form.addEventListener('submit', async event => {
      event.preventDefault(); const formData = new FormData(form);
      const body = { name: formData.get('name'), price: Number(formData.get('price')), stock: Number(formData.get('stock')), subtitle: formData.get('subtitle'), active: formData.has('active') };
      const button = $('button[type="submit"]', form); button.disabled = true;
      try { const result = await api(`/api/admin/tickets/${form.dataset.ticketForm}`, { method: 'PATCH', body }); flash(result.message); await refreshAll(); }
      catch (error) { flash(error.message, 'error'); }
      finally { button.disabled = false; }
    }));
  }
  $('#adminAuthForm').addEventListener('submit', async event => {
    event.preventDefault(); const button = $('button[type="submit"]', event.currentTarget); button.disabled = true; $('#adminLoginError').textContent = '';
    const body = Object.fromEntries(new FormData(event.currentTarget).entries());
    try {
      const result = await api('/api/auth/login', { method: 'POST', body });
      if (result.user.role !== 'admin') { await api('/api/auth/logout', { method: 'POST' }); throw new Error('Tài khoản này không có quyền Admin. Hãy đăng nhập bằng tài khoản quản trị.'); }
      adminUser = result.user; showDashboard();
    } catch (error) { $('#adminLoginError').textContent = error.message; }
    finally { button.disabled = false; }
  });
  $('#adminLogoutButton').addEventListener('click', async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); adminUser = null; showLogin(''); }
    catch (error) { flash(error.message, 'error'); }
  });
  $('#refreshButton').addEventListener('click', async () => { const button = $('#refreshButton'); button.disabled = true; try { await refreshAll(); flash('Đã làm mới dữ liệu.'); } catch (error) { flash(error.message, 'error'); } finally { button.disabled = false; } });
  $('#statusFilters').addEventListener('click', event => {
    const button = event.target.closest('button[data-status]'); if (!button) return;
    activeStatus = button.dataset.status; $$('#statusFilters button').forEach(item => item.classList.toggle('active', item === button)); renderOrders();
  });
  $('#orderSearch').addEventListener('input', renderOrders);
  $('#eventConfigForm').addEventListener('submit', async event => {
    event.preventDefault(); const form = event.currentTarget; const button = $('button[type="submit"]', form); button.disabled = true; $('#eventSaveMessage').textContent = '';
    const formData = new FormData(form); const body = Object.fromEntries(formData.entries()); body.hold_minutes = Number(body.hold_minutes);
    try { const result = await api('/api/admin/event', { method: 'PATCH', body }); $('#eventSaveMessage').textContent = '✓ Đã lưu'; flash(result.message); await refreshAll(); }
    catch (error) { $('#eventSaveMessage').textContent = error.message; flash(error.message, 'error'); }
    finally { button.disabled = false; }
  });
  $('#exportOrdersButton').addEventListener('click', () => {
    const header = ['Ma don','Khach hang','Email','Dien thoai','Hang ve','So luong','Don gia','Tong tien VND','Trang thai','Noi dung CK','Ngay tao','Ghi chu Admin'];
    const lines = [header, ...allOrders.map(order => [order.id, order.customer_name, order.customer_email, order.customer_phone, order.ticket_name, order.quantity, order.unit_price, order.total, statusNames[order.status] || order.status, order.transfer_reference, order.created_at, order.admin_note])];
    const csv = '\uFEFF' + lines.map(row => row.map(value => `"${String(value ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' })); const a = document.createElement('a'); a.href = url; a.download = `thap-ky-orders-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(url);
  });
  (async () => {
    try { const result = await api('/api/me'); if (result.user?.role === 'admin') { adminUser = result.user; showDashboard(); } }
    catch { /* The login screen remains available. */ }
  })();
})();
