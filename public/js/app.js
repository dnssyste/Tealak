(function() {
  const { t, setLang, getLang } = window.i18n;
  const appEl = document.getElementById('app');

  // ===== STATE =====
  let state = {
    currentView: null,
    driver: api.getDriverInfo(),
    currentJob: null,
    newDelivery: { step: 1, photos: [], additionalPhotos: [], jobId: null, data: {}, status: null, damageDesc: '' },
  };

  // ===== SERVICE WORKER =====
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }

  // ===== OFFLINE DETECTION =====
  const offlineBanner = document.getElementById('offline-banner');
  function updateOnlineStatus() {
    if (navigator.onLine) {
      offlineBanner.classList.add('hidden');
    } else {
      offlineBanner.textContent = '⚡ ' + t('common.offline');
      offlineBanner.classList.remove('hidden');
    }
  }
  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();

  // ===== TOAST =====
  function toast(message, type) {
    type = type || 'success';
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = 'toast toast-' + type;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => { el.classList.add('toast-out'); }, 2500);
    setTimeout(() => { el.remove(); }, 2800);
  }

  // ===== HAPTIC =====
  function haptic(ms) {
    if (navigator.vibrate) navigator.vibrate(ms || 10);
  }

  // ===== ROUTER =====
  function navigate(hash) {
    window.location.hash = hash;
  }

  function getRoute() {
    const hash = window.location.hash || '#/login';
    return hash.replace('#', '');
  }

  function router() {
    const route = getRoute();
    if (!api.isLoggedIn() && route !== '/login') {
      navigate('#/login');
      return;
    }
    if (api.isLoggedIn() && route === '/login') {
      navigate('#/dashboard');
      return;
    }

    state.driver = api.getDriverInfo();

    if (route === '/login') renderLogin();
    else if (route === '/dashboard') renderDashboard();
    else if (route === '/new-delivery') renderNewDelivery();
    else if (route === '/deliveries') renderDeliveries();
    else if (route.startsWith('/job/')) renderJobDetail(route.split('/job/')[1]);
    else if (route === '/damage-report') renderDamageReport();
    else if (route === '/container-report') renderContainerReport();
    else if (route === '/delivery-conditions') renderDeliveryConditions();
    else navigate('#/dashboard');
  }

  window.addEventListener('hashchange', router);

  // ===== RENDER HELPERS =====
  function render(html, showNav) {
    appEl.innerHTML = '';
    const wrapper = document.createElement('div');
    wrapper.className = 'view-enter';
    wrapper.innerHTML = html;
    appEl.appendChild(wrapper);
    if (showNav !== false && api.isLoggedIn()) {
      appEl.innerHTML += renderBottomNav();
      bindBottomNav();
    }
  }

  function renderHeader(title, showBack) {
    const driver = state.driver;
    if (showBack) {
      return '<div class="app-header">' +
        '<div class="flex-row">' +
          '<button class="back-btn" onclick="history.back()">←</button>' +
          '<span style="font-weight:600;font-size:0.95rem;">' + escHtml(title || '') + '</span>' +
        '</div>' +
        '<img src="/assets/teslak-logo.png" class="logo" alt="Teslak">' +
      '</div>';
    }
    return '<div class="app-header">' +
      '<img src="/assets/teslak-logo.png" class="logo" alt="Teslak">' +
      '<div class="header-right">' +
        (driver ? '<span class="driver-name">' + escHtml(driver.name) + '</span>' : '') +
        '<button class="btn-logout" onclick="window._logout()">' + t('common.logout') + '</button>' +
      '</div>' +
    '</div>';
  }

  function renderBottomNav() {
    const route = getRoute();
    function cls(r) { return route === r || route.startsWith(r + '/') ? 'nav-item active' : 'nav-item'; }
    return '<nav class="bottom-nav">' +
      '<button class="' + cls('/dashboard') + '" data-nav="#/dashboard"><span class="nav-icon">🏠</span>' + t('nav.dashboard') + '</button>' +
      '<button class="' + cls('/new-delivery') + '" data-nav="#/new-delivery"><span class="nav-icon">📦</span>' + t('nav.new') + '</button>' +
      '<button class="' + cls('/deliveries') + '" data-nav="#/deliveries"><span class="nav-icon">📋</span>' + t('nav.deliveries') + '</button>' +
    '</nav>';
  }

  function bindBottomNav() {
    document.querySelectorAll('.bottom-nav .nav-item').forEach(function(btn) {
      btn.addEventListener('click', function() {
        haptic();
        navigate(this.getAttribute('data-nav'));
      });
    });
  }

  function escHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleDateString('da-DK') + ' ' + d.toLocaleTimeString('da-DK', { hour: '2-digit', minute: '2-digit' });
  }

  function statusBadge(status) {
    const map = {
      delivered: { cls: 'badge-delivered', icon: '✅', da: 'Leveret', en: 'Delivered' },
      damaged: { cls: 'badge-damaged', icon: '⚠️', da: 'Beskadiget', en: 'Damaged' },
      missing: { cls: 'badge-missing', icon: '❌', da: 'Mangler', en: 'Missing' },
      pending: { cls: 'badge-pending', icon: '⏳', da: 'Afventer', en: 'Pending' },
      draft: { cls: 'badge-draft', icon: '📝', da: 'Kladde', en: 'Draft' }
    };
    const info = map[status] || map.pending;
    const label = getLang() === 'da' ? info.da : info.en;
    return '<span class="badge ' + info.cls + '">' + info.icon + ' ' + label + '</span>';
  }

  // ===== LOGOUT =====
  window._logout = function() {
    haptic();
    api.logout();
  };

  // ===== LOGIN VIEW =====
  function renderLogin() {
    const lang = getLang();
    let html = '<div class="login-screen">' +
      '<div class="login-card">' +
        '<img src="/assets/teslak-logo.png" class="login-logo" alt="Teslak Transport">' +
        '<h1 class="login-title">' + t('login.title') + '</h1>' +
        '<p class="login-subtitle">' + t('login.subtitle') + '</p>' +
        '<div class="lang-toggle">' +
          '<button class="lang-btn ' + (lang === 'da' ? 'active' : '') + '" data-lang="da">🇩🇰 DA</button>' +
          '<button class="lang-btn ' + (lang === 'en' ? 'active' : '') + '" data-lang="en">🇬🇧 EN</button>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">' + t('login.selectDriver') + '</label>' +
          '<select id="login-driver" class="form-select"><option value="">' + t('common.loading') + '</option></select>' +
        '</div>' +
        '<div class="form-group">' +
          '<label class="form-label">' + t('login.pin') + '</label>' +
          '<input type="tel" id="login-pin" class="form-input pin-input" maxlength="4" pattern="[0-9]*" placeholder="' + t('login.pinPlaceholder') + '">' +
        '</div>' +
        '<button id="login-btn" class="btn btn-primary btn-lg">' + t('login.button') + '</button>' +
      '</div>' +
    '</div>';

    render(html, false);

    // Load drivers
    api.getDrivers().then(function(drivers) {
      const sel = document.getElementById('login-driver');
      if (!sel) return;
      sel.innerHTML = '<option value="">' + t('login.selectDriver') + '</option>';
      (Array.isArray(drivers) ? drivers : []).forEach(function(d) {
        sel.innerHTML += '<option value="' + escHtml(d.id) + '">' + escHtml(d.name) + '</option>';
      });
    }).catch(function() {
      const sel = document.getElementById('login-driver');
      if (sel) sel.innerHTML = '<option value="">Error loading drivers</option>';
    });

    // Language toggle
    document.querySelectorAll('.lang-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        haptic();
        setLang(this.getAttribute('data-lang'));
        renderLogin();
      });
    });

    // Login
    document.getElementById('login-btn').addEventListener('click', async function() {
      haptic();
      const sel = document.getElementById('login-driver');
      const pin = document.getElementById('login-pin').value;
      const name = sel.options[sel.selectedIndex] ? sel.options[sel.selectedIndex].text : '';
      if (!sel.value || !pin || pin.length !== 4) {
        toast(t('common.error'), 'error');
        return;
      }
      this.disabled = true;
      this.textContent = t('login.loggingIn');
      try {
        await api.login(name, pin);
        state.driver = api.getDriverInfo();
        navigate('#/dashboard');
      } catch (e) {
        toast(e.message, 'error');
        this.disabled = false;
        this.textContent = t('login.button');
      }
    });
  }

  // ===== DASHBOARD VIEW =====

  function showResendModal(jobId) {
    // Remove any existing modal
    var existing = document.getElementById('resend-modal-overlay');
    if (existing) existing.remove();

    var overlay = document.createElement('div');
    overlay.id = 'resend-modal-overlay';
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';

    overlay.innerHTML =
      '<div style="background:#fff;border-radius:16px;padding:24px;width:100%;max-width:420px;box-shadow:0 8px 32px rgba(0,0,0,0.2);">' +
        '<h3 style="margin:0 0 8px;font-size:18px;">📧 ' + (t('job.resendEmail') || 'Resend Email') + '</h3>' +
        '<p style="margin:0 0 16px;color:#666;font-size:14px;">' + (t('job.resendHint') || 'Enter a specific email address, or leave blank to send to all configured recipients.') + '</p>' +
        '<input type="email" id="resend-email-input" class="form-input" placeholder="email@example.com" style="margin-bottom:16px;width:100%;box-sizing:border-box;">' +
        '<div style="display:flex;gap:10px;">' +
          '<button id="resend-cancel-btn" class="btn btn-secondary" style="flex:1;">✕ ' + (t('common.cancel') || 'Cancel') + '</button>' +
          '<button id="resend-send-btn" class="btn btn-primary" style="flex:1;">📧 ' + (t('job.send') || 'Send') + '</button>' +
        '</div>' +
      '</div>';

    document.body.appendChild(overlay);

    document.getElementById('resend-cancel-btn').addEventListener('click', function() {
      overlay.remove();
    });
    overlay.addEventListener('click', function(e) {
      if (e.target === overlay) overlay.remove();
    });

    document.getElementById('resend-send-btn').addEventListener('click', async function() {
      haptic();
      var emailVal = document.getElementById('resend-email-input').value.trim();
      this.disabled = true;
      this.textContent = '⏳';
      try {
        await api.sendEmail(jobId, emailVal || null);
        toast(t('job.emailSent') || 'Email sent!', 'success');
        overlay.remove();
      } catch (e) {
        toast(e.message || 'Failed to send', 'error');
        this.disabled = false;
        this.innerHTML = '📧 ' + (t('job.send') || 'Send');
      }
    });
  }


// Dropdown Options Cache
var _dropdownCache = {};
async function loadDropdownOptions() {
  try {
    var dcRes = await fetch('/api/dropdown-options/dc_reason');
    var itRes = await fetch('/api/dropdown-options/item_type');
    _dropdownCache.dc_reason = dcRes.ok ? await dcRes.json() : [];
    _dropdownCache.item_type = itRes.ok ? await itRes.json() : [];
  } catch(e) {
    _dropdownCache.dc_reason = [];
    _dropdownCache.item_type = [];
  }
}
// End Dropdown Options Cache

// Pre-load dropdown options
loadDropdownOptions();

function renderDashboard() {
    let html = renderHeader() +
      '<div class="page-content">' +
        '<h1 class="page-title">' + t('dash.title') + '</h1>' +
        '<div class="stats-grid" id="stats-grid">' +
          '<div class="stat-card stat-total"><div class="stat-value">-</div><div class="stat-label">' + t('dash.totalToday') + '</div></div>' +
          '<div class="stat-card stat-done"><div class="stat-value">-</div><div class="stat-label">' + t('dash.completed') + '</div></div>' +
          '<div class="stat-card stat-issue"><div class="stat-value">-</div><div class="stat-label">' + t('dash.issues') + '</div></div>' +
        '</div>' +
        '<div class="quick-actions">' +
          '<button class="action-btn action-primary" onclick="window._nav(\'#/new-delivery\')"><span class="action-icon">📦</span>' + t('dash.newDelivery') + '</button>' +
          '<button class="action-btn" onclick="window._nav(\'#/deliveries\')"><span class="action-icon">📋</span>' + t('dash.myDeliveries') + '</button>' +
          '<button class="action-btn" onclick="window._nav(\'#/damage-report\')"><span class="action-icon">⚠️</span>' + t('dash.damageReport') + '</button>' +
          '<button class="action-btn" onclick="window._nav(\'#/container-report\')"><span class="action-icon">🚛</span>' + t('dash.containerReport') + '</button>' +
          '<button class="action-btn" onclick="window._nav(\'#/delivery-conditions\')"><span class="action-icon">📋</span>' + t('dash.deliveryConditions') + '</button>' +
        '</div>' +
        '<div class="section-title">' + t('dash.recentTitle') + '</div>' +
        '<div id="recent-jobs"><div class="loading-overlay"><div class="spinner"></div></div></div>' +
      '</div>';

    render(html);

    // Load stats and recent
    loadDashboardData();
  }

  window._nav = function(hash) { haptic(); navigate(hash); };

  async function loadDashboardData() {
    try {
      const driver = state.driver;
      const driverId = driver ? driver.id : undefined;
      const data = await api.getJobs({ driver_id: driverId, date: 'today' });
      const jobs = data.jobs || data || [];

      // Stats
      const total = jobs.length;
      const delivered = jobs.filter(function(j) { return j.status === 'delivered'; }).length;
      const issues = jobs.filter(function(j) { return j.status === 'damaged' || j.status === 'missing'; }).length;

      const grid = document.getElementById('stats-grid');
      if (grid) {
        const vals = grid.querySelectorAll('.stat-value');
        vals[0].textContent = total;
        vals[1].textContent = delivered;
        vals[2].textContent = issues;
      }

      // Recent
      const recentEl = document.getElementById('recent-jobs');
      if (!recentEl) return;
      const recent = jobs.slice(0, 5);
      if (recent.length === 0) {
        recentEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">' + t('dash.noRecent') + '</div></div>';
        return;
      }
      recentEl.innerHTML = '<div class="job-list">' + recent.map(renderJobCard).join('') + '</div>';
      bindJobCards();
    } catch (e) {
      const el = document.getElementById('recent-jobs');
      if (el) el.innerHTML = '<div class="empty-state"><div class="empty-text">' + t('common.error') + '</div></div>';
    }
  }

  function renderJobCard(job) {
    return '<div class="job-card" data-job-id="' + job.id + '">' +
      '<div class="job-card-top">' +
        '<div class="job-card-ids">' + escHtml(job.order_nr || '—') + (job.tour_nr ? ' · Tur ' + escHtml(job.tour_nr) : '') + '</div>' +
        statusBadge(job.status) +
      '</div>' +
      '<div class="job-card-customer">' + escHtml(job.customer || '') + '</div>' +
      '<div class="job-card-address">' + escHtml(job.address || '') + '</div>' +
      '<div class="job-card-footer">' +
        '<span class="job-card-time">' + formatTime(job.created_at || job.updated_at) + '</span>' +
      '</div>' +
    '</div>';
  }

  function bindJobCards() {
    document.querySelectorAll('.job-card').forEach(function(card) {
      card.addEventListener('click', function() {
        haptic();
        navigate('#/job/' + this.getAttribute('data-job-id'));
      });
    });
  }

  // ===== PHOTO ROTATION UTILS =====
  async function rotateImageFile(photoObj) {
    if (!photoObj.rotation) return photoObj.file;
    return new Promise(function(resolve) {
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var deg = ((photoObj.rotation % 360) + 360) % 360;
        if (deg === 90 || deg === 270) {
          canvas.width = img.height; canvas.height = img.width;
        } else {
          canvas.width = img.width; canvas.height = img.height;
        }
        var ctx = canvas.getContext('2d');
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(deg * Math.PI / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        canvas.toBlob(function(blob) {
          resolve(new File([blob], photoObj.file.name, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.92);
      };
      img.src = photoObj.preview;
    });
  }
  async function getRotatedFiles(photos) {
    var files = [];
    for (var i = 0; i < photos.length; i++) {
      files.push(await rotateImageFile(photos[i]));
    }
    return files;
  }

  // ===== NEW DELIVERY VIEW =====
  function renderNewDelivery() {
    const s = state.newDelivery;
    let html = renderHeader(t('new.title'), true) +
      '<div class="page-content">' +
        '<div class="steps">' +
          '<div class="step-dot ' + (s.step === 1 ? 'active' : (s.step > 1 ? 'completed' : '')) + '"></div>' +
          '<div class="step-dot ' + (s.step === 2 ? 'active' : (s.step > 2 ? 'completed' : '')) + '"></div>' +
          '<div class="step-dot ' + (s.step === 3 ? 'active' : '') + '"></div>' +
        '</div>' +
        '<div id="step-content"></div>' +
      '</div>';

    render(html);

    if (s.step === 1) renderStep1();
    else if (s.step === 2) renderStep2();
    else if (s.step === 3) renderStep3();
  }

  function renderStep1() {
    const s = state.newDelivery;
    const el = document.getElementById('step-content');
    if (!el) return;

    let photosHtml = '';
    if (s.photos.length > 0) {
      photosHtml = '<div class="photo-grid">' +
        s.photos.map(function(p, i) {
          return '<div class="photo-thumb"><img src="' + p.preview + '" alt="" style="transform:rotate(' + (p.rotation||0) + 'deg)"><button class="photo-rotate" data-idx="' + i + '">↻</button><button class="photo-delete" data-idx="' + i + '">✕</button></div>';
        }).join('') +
      '</div>';
    }

    el.innerHTML =
      '<h2 class="text-center mb-16" style="font-size:1.1rem;">' + t('new.step1') + '</h2>' +
      '<div class="text-center mb-8"><div class="camera-icon">📸</div><div class="camera-text">' + t('new.takePhoto') + '</div><div class="text-sm text-muted mt-8">' + t('new.takePhotoDesc') + '</div></div>' +
      '<div style="display:flex;gap:12px;justify-content:center;margin:12px 0;">' +
        '<button type="button" class="btn btn-primary" id="camera-input-cam-btn" style="flex:1;max-width:180px;padding:14px 8px;font-size:1rem;">📷 ' + t('new.camera') + '</button>' +
        '<button type="button" class="btn btn-secondary" id="camera-input-file-btn" style="flex:1;max-width:180px;padding:14px 8px;font-size:1rem;">📁 ' + t('new.files') + '</button>' +
      '</div>' +
      '<input type="file" accept="image/*" capture="environment" class="camera-input" id="camera-input">' +
      '<input type="file" accept="image/*" multiple class="camera-input" id="camera-input-files">' +
      photosHtml +
      (s.photos.length > 0 ?
        '<button class="btn btn-secondary mb-12" id="add-more-btn">📷 ' + t('new.addMore') + '</button>' +
        '<button class="btn btn-primary" id="analyze-btn">' + t('new.analyze') + '</button>'
        : '');

    // Bindings
    document.getElementById('camera-input-cam-btn').addEventListener('click', function() {
      haptic();
      document.getElementById('camera-input').click();
    });
    document.getElementById('camera-input-file-btn').addEventListener('click', function() {
      haptic();
      document.getElementById('camera-input-files').click();
    });
    document.getElementById('camera-input-files').addEventListener('change', handlePhotoCapture);

    document.getElementById('camera-input').addEventListener('change', handlePhotoCapture);

    var addMoreBtn = document.getElementById('add-more-btn');
    if (addMoreBtn) {
      addMoreBtn.addEventListener('click', function() {
        haptic();
        document.getElementById('camera-input-files').click();
      });
    }

    var analyzeBtn = document.getElementById('analyze-btn');
    if (analyzeBtn) {
      analyzeBtn.addEventListener('click', doAnalyze);
    }

    // Photo delete
    document.querySelectorAll('.photo-delete').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        haptic(20);
        const idx = parseInt(this.getAttribute('data-idx'));
        s.photos.splice(idx, 1);
        renderStep1();
      });
    });
    document.querySelectorAll('.photo-rotate').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation(); haptic();
        const idx = parseInt(this.getAttribute('data-idx'));
        s.photos[idx].rotation = ((s.photos[idx].rotation || 0) + 90) % 360;
        renderStep1();
      });
    });
  }

  function handlePhotoCapture(e) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const reader = new FileReader();
      reader.onload = function(ev) {
        state.newDelivery.photos.push({ file: file, preview: ev.target.result, rotation: 0 });
        renderStep1();
      };
      reader.readAsDataURL(file);
    }
  }

  async function doAnalyze() {
    haptic();
    const s = state.newDelivery;
    if (s._analyzing) return; // prevent double-click
    s._analyzing = true;
    const el = document.getElementById('step-content');
    if (!el) { s._analyzing = false; return; }

    el.innerHTML = '<div class="loading-overlay"><div class="spinner"></div><div class="loading-text">' + t('new.analyzing') + '</div><div class="text-sm text-muted">' + t('new.analyzingDesc') + '</div></div>';

    try {
      // Create job only if we don't already have one
      if (!s.jobId) {
        const driver = state.driver;
        const jobResult = await api.createJob(driver ? driver.id : undefined);
        const job = jobResult.job || jobResult;
        s.jobId = job.id;
      }

      // Upload photos (with rotation baked in)
      const files = [];
      for (let ri = 0; ri < s.photos.length; ri++) {
        const ph = s.photos[ri];
        if (ph.rotation) {
          files.push(await _rotateFile(ph.file, ph.rotation));
        } else {
          files.push(ph.file);
        }
      }
      await api.uploadPhotos(s.jobId, files, 'sticker');

      // Analyze
      const analysis = await api.analyzeJob(s.jobId);
      const data = analysis.job || analysis.data || analysis;

      s.data = {
        tour_nr: data.tour_nr || data.tur_nr || '',
        order_nr: data.order_nr || '',
        customer: data.customer || data.customer_name || '',
        address: data.address || '',
        delivery_date: new Date().toISOString().slice(0,10)
      };

      s._analyzing = false;
      s.step = 2;
      renderNewDelivery();
    } catch (e) {
      s._analyzing = false;
      toast(e.message, 'error');
      renderStep1();
    }
  }

  function renderStep2() {
    const s = state.newDelivery;
    const d = s.data;
    const el = document.getElementById('step-content');
    if (!el) return;

    const fields = [
      { key: 'tour_nr', label: t('new.tourNr') },
      { key: 'order_nr', label: t('new.orderNr') },
      { key: 'customer', label: t('new.customer') },
      { key: 'address', label: t('new.address') },
      { key: 'delivery_date', label: t('new.deliveryDate'), type: 'date', default: new Date().toISOString().slice(0,10) }
    ];

    let fieldsHtml = fields.map(function(f) {
      const val = d[f.key] || f.default || '';
      return '<div class="form-group">' +
        '<label class="form-label">' + f.label + '</label>' +
        '<input type="' + (f.type || 'text') + '" class="form-input" data-field="' + f.key + '" value="' + escHtml(val) + '">' +
      '</div>';
    }).join('');

    // Additional photos section
    let addPhotosHtml = '';
    if (s.additionalPhotos.length > 0) {
      addPhotosHtml = '<div class="photo-grid mb-12">' +
        s.additionalPhotos.map(function(p, i) {
          return '<div class="photo-thumb"><img src="' + p.preview + '" alt="" style="transform:rotate(' + (p.rotation||0) + 'deg)"><button class="photo-rotate add-photo-rot" data-idx="' + i + '">↻</button><button class="photo-delete add-photo-del" data-idx="' + i + '">✕</button></div>';
        }).join('') +
      '</div>';
    }

    el.innerHTML =
      '<h2 class="text-center mb-16" style="font-size:1.1rem;">' + t('new.step2') + '</h2>' +
      '<div class="card">' + fieldsHtml + '</div>' +
      '<div class="section-title mt-16">' + t('new.additionalPhotos') + '</div>' +
      addPhotosHtml +
      '<div class="text-center" style="padding:8px 0;"><div class="camera-icon" style="font-size:1.5rem;">📷</div><div class="camera-text text-sm">' + t('new.addUnloadPhoto') + '</div></div>' +
      '<div style="display:flex;gap:12px;justify-content:center;margin:12px 0;">' +
        '<button type="button" class="btn btn-primary" id="add-photo-input-cam-btn" style="flex:1;max-width:180px;padding:14px 8px;font-size:1rem;">📷 ' + t('new.camera') + '</button>' +
        '<button type="button" class="btn btn-secondary" id="add-photo-input-file-btn" style="flex:1;max-width:180px;padding:14px 8px;font-size:1rem;">📁 ' + t('new.files') + '</button>' +
      '</div>' +
      '<input type="file" accept="image/*" capture="environment" class="camera-input" id="add-photo-input">' +
      '<input type="file" accept="image/*" multiple class="camera-input" id="add-photo-input-files">' +
      '<div class="flex-row mt-16" style="gap:10px;">' +
        '<button class="btn btn-secondary" id="step2-back" style="flex:1;">' + t('new.back') + '</button>' +
        '<button class="btn btn-primary" id="step2-next" style="flex:2;">' + t('new.next') + '</button>' +
      '</div>';

    // Field changes
    document.querySelectorAll('#step-content .form-input[data-field]').forEach(function(input) {
      input.addEventListener('change', function() {
        s.data[this.getAttribute('data-field')] = this.value;
      });
      input.addEventListener('input', function() {
        s.data[this.getAttribute('data-field')] = this.value;
      });
    });

    // Additional photos
    document.getElementById('add-photo-input-cam-btn').addEventListener('click', function() {
      haptic();
      document.getElementById('add-photo-input').click();
    });
    document.getElementById('add-photo-input-file-btn').addEventListener('click', function() {
      haptic();
      document.getElementById('add-photo-input-files').click();
    });
    document.getElementById('add-photo-input-files').addEventListener('change', function(e) {
      var files = Array.from(e.target.files);
      files.forEach(function(file) {
        var reader = new FileReader();
        reader.onload = function(ev) {
          s.additionalPhotos.push({ file: file, preview: ev.target.result, rotation: 0 });
          renderStep3();
        };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    });
    document.getElementById('add-photo-input').addEventListener('change', function(e) {
      const files = e.target.files;
      if (!files) return;
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const reader = new FileReader();
        reader.onload = function(ev) {
          s.additionalPhotos.push({ file: file, preview: ev.target.result, rotation: 0 });
          renderStep2();
        };
        reader.readAsDataURL(file);
      }
    });

    document.querySelectorAll('.add-photo-del').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        haptic(20);
        s.additionalPhotos.splice(parseInt(this.getAttribute('data-idx')), 1);
        renderStep2();
      });
    });
    document.querySelectorAll('.add-photo-rot').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation(); haptic();
        const idx = parseInt(this.getAttribute('data-idx'));
        s.additionalPhotos[idx].rotation = ((s.additionalPhotos[idx].rotation || 0) + 90) % 360;
        renderStep2();
      });
    });

    document.getElementById('step2-back').addEventListener('click', function() {
      haptic(); s.step = 1; renderNewDelivery();
    });
    document.getElementById('step2-next').addEventListener('click', function() {
      haptic(); s.step = 3; renderNewDelivery();
    });
  }

  function renderStep3() {
    const s = state.newDelivery;
    const d = s.data;
    const el = document.getElementById('step-content');
    if (!el) return;

    const summaryFields = [
      [t('new.tourNr'), d.tour_nr],
      [t('new.orderNr'), d.order_nr],
      [t('new.customer'), d.customer],
      [t('new.address'), d.address],
      [t('new.deliveryDate'), d.delivery_date]
    ];

    let summaryHtml = summaryFields.map(function(f) {
      if (!f[1]) return '';
      return '<div class="summary-row"><span class="summary-label">' + f[0] + '</span><span class="summary-value">' + escHtml(f[1]) + '</span></div>';
    }).join('');

    el.innerHTML =
      '<h2 class="text-center mb-16" style="font-size:1.1rem;">' + t('new.step3') + '</h2>' +
      '<div class="section-title">' + t('new.summary') + '</div>' +
      '<div class="card mb-20">' + summaryHtml + '</div>' +
      '<div class="section-title">' + t('new.selectStatus') + '</div>' +
      '<div class="status-options">' +
        '<div class="status-option status-delivered ' + (s.status === 'delivered' ? 'selected' : '') + '" data-status="delivered">' +
          '<span class="status-icon">✅</span><span class="status-text">' + t('new.delivered') + '</span></div>' +
        '<div class="status-option status-damaged ' + (s.status === 'damaged' ? 'selected' : '') + '" data-status="damaged">' +
          '<span class="status-icon">⚠️</span><span class="status-text">' + t('new.damaged') + '</span></div>' +
        '<div class="status-option status-missing ' + (s.status === 'missing' ? 'selected' : '') + '" data-status="missing">' +
          '<span class="status-icon">❌</span><span class="status-text">' + t('new.missing') + '</span></div>' +
      '</div>' +
      '<div id="damage-desc-area" class="' + (s.status === 'damaged' || s.status === 'missing' ? '' : 'hidden') + '">' +
        '<div class="form-group">' +
          '<label class="form-label">' + t('new.damageDesc') + '</label>' +
          '<textarea class="form-textarea" id="damage-desc" placeholder="' + t('new.damageDescPlaceholder') + '">' + escHtml(s.damageDesc) + '</textarea>' +
        '</div>' +
      '</div>' +
      '<div class="flex-row mt-16" style="gap:10px;">' +
        '<button class="btn btn-secondary" id="step3-back" style="flex:1;">' + t('new.back') + '</button>' +
        '<button class="btn btn-primary" id="step3-submit" style="flex:2;" ' + (s.status ? '' : 'disabled') + '>' + t('new.submit') + '</button>' +
      '</div>';

    // Status selection
    document.querySelectorAll('.status-option').forEach(function(opt) {
      opt.addEventListener('click', function() {
        haptic();
        s.status = this.getAttribute('data-status');
        document.querySelectorAll('.status-option').forEach(function(o) { o.classList.remove('selected'); });
        this.classList.add('selected');
        const area = document.getElementById('damage-desc-area');
        if (s.status === 'damaged' || s.status === 'missing') {
          area.classList.remove('hidden');
        } else {
          area.classList.add('hidden');
        }
        document.getElementById('step3-submit').disabled = false;
      });
    });

    var descEl = document.getElementById('damage-desc');
    if (descEl) {
      descEl.addEventListener('input', function() { s.damageDesc = this.value; });
    }

    document.getElementById('step3-back').addEventListener('click', function() {
      haptic(); s.step = 2; renderNewDelivery();
    });

    document.getElementById('step3-submit').addEventListener('click', submitDelivery);
  }

  async function submitDelivery() {
    haptic();
    const s = state.newDelivery;
    const btn = document.getElementById('step3-submit');
    if (!btn) return;
    btn.disabled = true;
    btn.textContent = t('new.submitting');

    try {
      // Update job with data
      await api.updateJob(s.jobId, s.data);

      // Upload additional photos (with rotation baked in)
      if (s.additionalPhotos.length > 0) {
        const files = [];
        for (let i = 0; i < s.additionalPhotos.length; i++) {
          const p = s.additionalPhotos[i];
          if (p.rotation) {
            files.push(await _rotateFile(p.file, p.rotation));
          } else {
            files.push(p.file);
          }
        }
        await api.uploadPhotos(s.jobId, files, 'unload');
      }

      // Set status
      const report = (s.status === 'damaged' || s.status === 'missing') ? s.damageDesc : undefined;
      await api.updateJobStatus(s.jobId, s.status, report);

      toast(t('new.success'), 'success');

      // Reset state
      state.newDelivery = { step: 1, photos: [], additionalPhotos: [], jobId: null, data: {}, status: null, damageDesc: '' };
      navigate('#/dashboard');
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = t('new.submit');
    }
  }

  // --- Helper: Rotate image file via Canvas ---
  function _rotateFile(file, degrees) {
    return new Promise(function(resolve) {
      if (!degrees) { resolve(file); return; }
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var swap = (degrees === 90 || degrees === 270);
        canvas.width = swap ? img.height : img.width;
        canvas.height = swap ? img.width : img.height;
        var ctx = canvas.getContext('2d');
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(degrees * Math.PI / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        canvas.toBlob(function(blob) {
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.9);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  // ===== DELIVERIES VIEW =====
  let deliveryFilters = { status: '', date: 'today' };

  function renderDeliveries() {
    let html = renderHeader(t('del.title'), true) +
      '<div class="page-content">' +
        '<div class="ptr-indicator" id="ptr">' + t('del.pullRefresh') + '</div>' +
        '<div class="filter-tabs mb-12">' +
          filterTab('', t('del.all')) +
          filterTab('delivered', t('del.delivered')) +
          filterTab('damaged', t('del.damaged')) +
          filterTab('missing', t('del.missing')) +
        '</div>' +
        '<div class="date-filter">' +
          dateBtn('today', t('del.today')) +
          dateBtn('week', t('del.thisWeek')) +
          dateBtn('month', t('del.thisMonth')) +
        '</div>' +
        '<div id="jobs-list"><div class="loading-overlay"><div class="spinner"></div></div></div>' +
      '</div>';

    render(html);

    // Bind filters
    document.querySelectorAll('.filter-tab').forEach(function(tab) {
      tab.addEventListener('click', function() {
        haptic();
        deliveryFilters.status = this.getAttribute('data-status');
        document.querySelectorAll('.filter-tab').forEach(function(t) { t.classList.remove('active'); });
        this.classList.add('active');
        loadJobs();
      });
    });
    document.querySelectorAll('.date-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        haptic();
        deliveryFilters.date = this.getAttribute('data-date');
        document.querySelectorAll('.date-btn').forEach(function(b) { b.classList.remove('active'); });
        this.classList.add('active');
        loadJobs();
      });
    });

    loadJobs();
    setupPullToRefresh();
  }

  function filterTab(status, label) {
    return '<button class="filter-tab ' + (deliveryFilters.status === status ? 'active' : '') + '" data-status="' + status + '">' + label + '</button>';
  }

  function dateBtn(date, label) {
    return '<button class="date-btn ' + (deliveryFilters.date === date ? 'active' : '') + '" data-date="' + date + '">' + label + '</button>';
  }

  async function loadJobs() {
    const el = document.getElementById('jobs-list');
    if (!el) return;
    el.innerHTML = '<div class="loading-overlay"><div class="spinner"></div></div>';

    try {
      const driver = state.driver;
      const filters = {
        driver_id: driver ? driver.id : undefined,
        status: deliveryFilters.status || undefined,
        date: deliveryFilters.date || undefined
      };
      const data = await api.getJobs(filters);
      const jobs = data.jobs || data || [];

      if (jobs.length === 0) {
        el.innerHTML = '<div class="empty-state"><div class="empty-icon">📭</div><div class="empty-text">' + t('del.noJobs') + '</div></div>';
        return;
      }

      el.innerHTML = '<div class="job-list">' + jobs.map(renderJobCard).join('') + '</div>';
      bindJobCards();
    } catch (e) {
      el.innerHTML = '<div class="empty-state"><div class="empty-text">' + t('common.error') + '</div><button class="btn btn-sm btn-secondary mt-12" onclick="window._loadJobs()">' + t('common.retry') + '</button></div>';
    }
  }
  window._loadJobs = loadJobs;

  function setupPullToRefresh() {
    let startY = 0;
    let pulling = false;
    const content = document.querySelector('.page-content');
    if (!content) return;

    content.addEventListener('touchstart', function(e) {
      if (content.scrollTop === 0) {
        startY = e.touches[0].clientY;
        pulling = true;
      }
    }, { passive: true });

    content.addEventListener('touchmove', function(e) {
      if (!pulling) return;
      const diff = e.touches[0].clientY - startY;
      const ptr = document.getElementById('ptr');
      if (diff > 60 && ptr) {
        ptr.classList.add('visible');
      }
    }, { passive: true });

    content.addEventListener('touchend', function() {
      const ptr = document.getElementById('ptr');
      if (ptr && ptr.classList.contains('visible')) {
        loadJobs();
        setTimeout(function() { ptr.classList.remove('visible'); }, 1000);
      }
      pulling = false;
    });
  }

  // ===== JOB DETAIL VIEW =====
  async function renderJobDetail(jobId) {
    let html = renderHeader(t('job.title'), true) +
      '<div class="page-content"><div id="job-detail"><div class="loading-overlay"><div class="spinner"></div></div></div></div>';

    render(html);

    try {
      const result = await api.getJob(jobId);
      const job = result.job || result;
      state.currentJob = job;

      let photosResult;
      try {
        photosResult = await api.getPhotos(jobId);
      } catch (e) {
        photosResult = { photos: [] };
      }
      const photos = photosResult.photos || photosResult || [];

      const el = document.getElementById('job-detail');
      if (!el) return;

      const infoFields = [
        [t('new.tourNr'), job.tour_nr],
        [t('new.orderNr'), job.order_nr],
        [t('new.customer'), job.customer],
        [t('new.deliveryDate'), job.delivery_date]
      ];

      let infoHtml = infoFields.map(function(f) {
        if (!f[1]) return '';
        return '<div class="summary-row"><span class="summary-label">' + f[0] + '</span><span class="summary-value">' + escHtml(f[1]) + '</span></div>';
      }).join('');

      let photosHtml = '';
      if (photos.length > 0) {
        photosHtml = '<div class="photo-gallery">' +
          photos.map(function(p) {
            const src = p.url || ('/api/photos/file/' + p.filename);
            return '<div class="gallery-item"><img src="' + escHtml(src) + '" alt="Photo" loading="lazy"></div>';
          }).join('') +
        '</div>';
      } else {
        photosHtml = '<div class="text-sm text-muted">' + t('job.noPhotos') + '</div>';
      }

      let damageHtml = '';
      if (job.status === 'damaged' || job.status === 'missing') {
        damageHtml = '<div class="detail-section">' +
          '<div class="section-header"><span class="section-icon">⚠️</span><span class="section-title" style="margin-bottom:0;">' + t('job.damageReport') + '</span></div>' +
          '<div class="card"><p style="font-size:0.9rem;line-height:1.5;">' + escHtml(job.damage_report || '—') + '</p></div>' +
        '</div>';
      }

      el.innerHTML =
        '<div class="flex-between mb-16">' +
          '<h2 style="font-size:1.1rem;">Order ' + escHtml(job.order_nr || '—') + '</h2>' +
          statusBadge(job.status) +
        '</div>' +
        '<div class="detail-section">' +
          '<div class="section-header"><span class="section-icon">ℹ️</span><span class="section-title" style="margin-bottom:0;">' + t('job.info') + '</span></div>' +
          '<div class="card">' + infoHtml + '</div>' +
        '</div>' +
        '<div class="detail-section">' +
          '<div class="section-header"><span class="section-icon">📷</span><span class="section-title" style="margin-bottom:0;">' + t('job.photos') + '</span></div>' +
          photosHtml +
        '</div>' +
        damageHtml +
        '<div class="flex-row mt-16" style="gap:10px;">' +
          '<button class="btn btn-secondary" id="edit-job-btn" style="flex:1;">✏️ ' + t('job.edit') + '</button>' +
          '<button class="btn btn-primary" id="resend-email-btn" style="flex:1;">📧 ' + t('job.resendEmail') + '</button>' +
        '</div>' +
        '<div id="delete-job-container"></div>';

      document.getElementById('resend-email-btn').addEventListener('click', function() {
        haptic();
        showResendModal(jobId);
      });

      document.getElementById('edit-job-btn').addEventListener('click', function() {
        haptic();
        // Pre-populate new delivery form with job data for editing
        state.newDelivery = {
          step: 2,
          photos: [],
          additionalPhotos: [],
          jobId: job.id,
          data: {
            tour_nr: job.tour_nr || '',
            order_nr: job.order_nr || '',
            customer: job.customer || '',
            address: job.address || '',
            delivery_date: job.delivery_date || ''
          },
          status: job.status,
          damageDesc: job.damage_report || ''
        };
        navigate('#/new-delivery');
      });

      // Check if trucker delete is allowed and show button if yes
      (async () => {
        try {
          const val = await api.getSetting('allow_trucker_delete');
          if (val === 'true') {
            var delContainer = document.getElementById('delete-job-container');
            if (delContainer) {
              delContainer.innerHTML = 
                '<div class="flex-row mt-8" style="gap:10px;"><button class="btn" id="delete-job-btn" style="background:#dc2626;color:#fff;flex:1;">🗑️ ' + t('job.deleteJob') + '</button></div>';
              var delBtn = document.getElementById('delete-job-btn');
              if (delBtn) {
                delBtn.addEventListener('click', async function() {
                  haptic();
                  if (!confirm(t('job.confirmDelete'))) return;
                  this.disabled = true;
                  try {
                    await api.deleteJob(jobId, 'trucker');
                    toast(t('job.deleted'), 'success');
                    navigate('#/history');
                  } catch (de) {
                    toast(de.message, 'error');
                    this.disabled = false;
                  }
                });
              }
            }
          }
        } catch (ignore) { /* setting check failed, hide delete */ }
      })();

    } catch (e) {
      const el = document.getElementById('job-detail');
      if (el) el.innerHTML = '<div class="empty-state"><div class="empty-text">' + t('common.error') + ': ' + escHtml(e.message) + '</div></div>';
    }
  }

  // ===== CONTAINER REPORT =====
  var _contState = { photos: [], _comment: '', submitting: false };

  function renderContainerReport() {
    _contState = { photos: [], _comment: '', _tur_nr: '', _container_nr: '', _rating: 0, _item_type: '', submitting: false };
    _drawContainerReport();
  }

  function _drawContainerReport() {
    var s = _contState;
    var photosHtml = '';
    if (s.photos.length > 0) {
      photosHtml = '<div class="photo-grid" style="margin-bottom:12px;">' +
        s.photos.map(function(p, i) {
          return '<div class="photo-thumb"><img src="' + p.preview + '" alt="" style="transform:rotate(' + (p.rotation||0) + 'deg)"><button class="photo-rotate cont-photo-rot" data-idx="' + i + '">\u21bb</button><button class="photo-delete cont-photo-del" data-idx="' + i + '">&times;</button></div>';
        }).join('') +
        '</div>';
    }

    var ratingLabels = [
      { val: 1, emoji: '\ud83d\ude1e', label: t('cont.ratingBad') },
      { val: 2, emoji: '\ud83d\ude15', label: t('cont.ratingPoor') },
      { val: 3, emoji: '\ud83d\ude10', label: t('cont.ratingOk') },
      { val: 4, emoji: '\ud83d\ude42', label: t('cont.ratingGood') },
      { val: 5, emoji: '\ud83d\ude0a', label: t('cont.ratingGreat') }
    ];

    var ratingHtml = '<div style="display:flex;gap:6px;flex-wrap:nowrap;margin-top:8px;">' +
      ratingLabels.map(function(r) {
        var selected = s._rating === r.val;
        var bg = selected ? '#1a1a2e' : '#f0f0f0';
        var color = selected ? '#fff' : '#333';
        var border = selected ? '2px solid #1a1a2e' : '2px solid transparent';
        return '<div class="cont-rating-btn" data-val="' + r.val + '" style="cursor:pointer;flex:1;padding:8px 4px;border-radius:10px;background:' + bg + ';color:' + color + ';border:' + border + ';text-align:center;transition:all 0.15s;">' +
          '<div style="font-size:1.5rem;">' + r.emoji + '</div>' +
          '<div style="font-size:0.7rem;margin-top:2px;font-weight:600;">' + r.label + '</div>' +
          '</div>';
      }).join('') +
    '</div>';

    var html = renderHeader(t('cont.title'), true) +
      '<div class="card" style="margin-bottom:16px;">' +
        '<label class="form-label" style="margin-bottom:8px;">\ud83d\udcf7 ' + t('cont.addPhoto') + ' (' + s.photos.length + ')</label>' +
        '<div class="text-center" style="padding:8px 0;"><div class="camera-icon">\ud83d\udcf7</div><div class="camera-text">' + t('cont.addPhoto') + '</div></div>' +
        '<div style="display:flex;gap:12px;justify-content:center;margin:12px 0;">' +
        '<button type="button" class="btn btn-primary" id="cont-photo-input-cam-btn" style="flex:1;max-width:180px;padding:14px 8px;font-size:1rem;">📷 ' + t('new.camera') + '</button>' +
        '<button type="button" class="btn btn-secondary" id="cont-photo-input-file-btn" style="flex:1;max-width:180px;padding:14px 8px;font-size:1rem;">📁 ' + t('new.files') + '</button>' +
      '</div>' +
      '<input type="file" accept="image/*" capture="environment" class="camera-input" id="cont-photo-input">' +
      '<input type="file" accept="image/*" multiple class="camera-input" id="cont-photo-input-files">' +
        photosHtml +
      '</div>' +
      '<div class="card" style="margin-bottom:16px;">' +
        '<div style="display:flex;gap:12px;margin-bottom:12px;">' +
          '<div style="flex:1;">' +
            '<label class="form-label" style="margin-bottom:4px;">\ud83d\udce6 ' + t('cont.turNr') + '</label>' +
            '<input type="text" class="form-input" id="cont-tur-nr" value="' + (s._tur_nr || '') + '" placeholder="123...">' +
          '</div>' +
          '<div style="flex:1;">' +
            '<label class="form-label" style="margin-bottom:4px;">\ud83d\udee5 ' + t('cont.containerNr') + '</label>' +
            '<input type="text" class="form-input" id="cont-container-nr" value="' + (s._container_nr || '') + '" placeholder="ABCU1234567...">' +
          '</div>' +
        '</div>' +
        '<label class="form-label">' + t('cont.itemTypeLabel') + '</label>' +
        (function() {
          var _itOpts2 = (_dropdownCache.item_type && _dropdownCache.item_type.length) ? _dropdownCache.item_type : [{label_da:'Højskabe',label_en:'Tall cabinets'},{label_da:'Vægskabe',label_en:'Wall cabinets'},{label_da:'Underskabe',label_en:'Base cabinets'},{label_da:'Hjørneskabe',label_en:'Corner cabinets'},{label_da:'Løsdele & Sokler',label_en:'Loose parts & Plinths'},{label_da:'Småpakker',label_en:'Small packages'},{label_da:'Korte bordplader',label_en:'Short countertops'},{label_da:'Lange bordplader',label_en:'Long countertops'},{label_da:'Hvidevarer',label_en:'Appliances'},{label_da:'Blandet',label_en:'Mixed'}];
          var _contLang2 = (window._lang || 'da');
          var _itSel = Array.isArray(s._item_type) ? s._item_type : (s._item_type ? [s._item_type] : []);
          return '<div id="cont-item-type-list" style="margin-bottom:12px;">' +
            _itOpts2.map(function(o) {
              var val = _contLang2 === 'en' ? o.label_en : o.label_da;
              var chk = _itSel.indexOf(val) !== -1;
              return '<label style="display:flex;align-items:center;padding:8px 12px;margin:2px 0;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:' + (chk ? '#e8f0fe' : 'var(--surface)') + '"><input type="checkbox" class="cont-item-cb" value="' + escHtml(val) + '"' + (chk ? ' checked' : '') + ' style="margin-right:10px;width:18px;height:18px;accent-color:var(--primary)"> <span>' + escHtml(val) + '</span></label>';
            }).join('') + '</div>';
        })() +
        '<label class="form-label">\ud83d\udcac ' + t('cont.comment') + '</label>' +
        '<textarea class="form-textarea" id="cont-comment" rows="3" placeholder="' + t('cont.commentPlaceholder') + '"></textarea>' +
      '</div>' +
      '<div class="card" style="margin-bottom:16px;">' +
        '<label class="form-label">\u2b50 ' + t('cont.rating') + '</label>' +
        ratingHtml +
      '</div>' +
      '<button class="btn btn-primary btn-block" id="cont-submit-btn"' + (s.submitting ? ' disabled' : '') + '>' +
        (s.submitting ? t('cont.submitting') : t('cont.submit')) +
      '</button>' +
      '<button class="btn btn-secondary btn-block" style="margin-top:8px;" onclick="navigate(\'#/dashboard\')">\u2190 ' + t('new.back') + '</button>';

    render(html, true);

    document.getElementById('cont-photo-input-cam-btn').addEventListener('click', function() {
      haptic();
      document.getElementById('cont-photo-input').click();
    });
    document.getElementById('cont-photo-input-file-btn').addEventListener('click', function() {
      haptic();
      document.getElementById('cont-photo-input-files').click();
    });
    document.getElementById('cont-photo-input-files').addEventListener('change', function(e) {
      var files = Array.from(e.target.files);
      files.forEach(function(file) {
        var reader = new FileReader();
        reader.onload = function(ev) {
          contPhotos.push({ file: file, preview: ev.target.result, rotation: 0 });
          renderContainerForm();
        };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    });

    document.getElementById('cont-photo-input').addEventListener('change', function(e) {
      var files = Array.from(e.target.files);
      _saveContFields();
      files.forEach(function(file) {
        var reader = new FileReader();
        reader.onload = function(ev) {
          _contState.photos.push({ file: file, preview: ev.target.result, rotation: 0 });
          _drawContainerReport();
          _restoreContFields();
        };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    });

    document.querySelectorAll('.cont-photo-del').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _saveContFields();
        var idx = parseInt(this.dataset.idx);
        _contState.photos.splice(idx, 1);
        _drawContainerReport();
        _restoreContFields();
      });
    });

    document.querySelectorAll('.cont-photo-rot').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation(); haptic();
        _saveContFields();
        var idx = parseInt(this.dataset.idx);
        _contState.photos[idx].rotation = ((_contState.photos[idx].rotation || 0) + 90) % 360;
        _drawContainerReport();
        _restoreContFields();
      });
    });

    document.querySelectorAll('.cont-rating-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _saveContFields();
        var val = parseInt(this.dataset.val);
        _contState._rating = (_contState._rating === val) ? 0 : val;
        _drawContainerReport();
        _restoreContFields();
      });
    });

    var commentEl = document.getElementById('cont-comment');
    if (commentEl) {
      commentEl.value = _contState._comment || '';
      commentEl.addEventListener('input', function() { _contState._comment = this.value; });
    }

    var submitBtn = document.getElementById('cont-submit-btn');
    if (submitBtn && !s.submitting) {
      submitBtn.addEventListener('click', async function() {
        if (_contState.photos.length === 0) {
          alert(t('cont.noPhotos'));
          return;
        }
        _saveContFields();
        _contState.submitting = true;
        _drawContainerReport();
        try {
          var formData = new FormData();
          var driverData = JSON.parse(localStorage.getItem('teslak_driver') || '{}');
          formData.append('driver_id', driverData.id || '');
          formData.append('comment', _contState._comment || '');
          formData.append('tur_nr', _contState._tur_nr || '');
          formData.append('container_nr', _contState._container_nr || '');
          var itemTypeVal = Array.isArray(_contState._item_type) ? _contState._item_type.join(', ') : (_contState._item_type || '');
          formData.append('item_type', itemTypeVal);
          formData.append('rating', _contState._rating || '');
          var bakedPhotos = await Promise.all(_contState.photos.map(function(p) {
            return new Promise(function(resolve) {
              if (!p.rotation) { resolve(p.file); return; }
              var img = new Image();
              img.onload = function() {
                var canvas = document.createElement('canvas');
                var rot = ((p.rotation % 360) + 360) % 360;
                var sw = (rot === 90 || rot === 270) ? img.height : img.width;
                var sh = (rot === 90 || rot === 270) ? img.width : img.height;
                canvas.width = sw; canvas.height = sh;
                var ctx = canvas.getContext('2d');
                ctx.translate(sw/2, sh/2);
                ctx.rotate(rot * Math.PI / 180);
                ctx.drawImage(img, -img.width/2, -img.height/2);
                canvas.toBlob(function(blob) { resolve(new File([blob], p.file.name, {type:'image/jpeg'})); }, 'image/jpeg', 0.92);
              };
              img.src = p.preview;
            });
          }));
          bakedPhotos.forEach(function(f) { formData.append('photos', f); });
          var resp = await fetch('/api/container', { method: 'POST', body: formData });
          var data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Failed');
          alert(t('cont.success') + ' \u2705 ' + t('cont.emailSent'));
          navigate('#/dashboard');
        } catch (err) {
          _contState.submitting = false;
          _drawContainerReport();
          _restoreContFields();
          alert(t('common.error') + ': ' + err.message);
        }
      });
    }
  }

  function _saveContFields() {
    var t1 = document.getElementById('cont-tur-nr');
    var c1 = document.getElementById('cont-container-nr');
    var cm = document.getElementById('cont-comment');
    if (t1) _contState._tur_nr = t1.value;
    if (c1) _contState._container_nr = c1.value;
    var itCbs = document.querySelectorAll('.cont-item-cb:checked');
    _contState._item_type = Array.from(itCbs).map(function(cb) { return cb.value; });
    if (cm) _contState._comment = cm.value;
  }

  function _restoreContFields() {
    var t1 = document.getElementById('cont-tur-nr');
    var c1 = document.getElementById('cont-container-nr');
    var cm = document.getElementById('cont-comment');
    if (t1) t1.value = _contState._tur_nr || '';
    if (c1) c1.value = _contState._container_nr || '';
    // Item type checkboxes rendered from state
    if (cm) cm.value = _contState._comment || '';
  }



    // ===== DAMAGE REPORT VIEW =====
  let dmgState = { step: 1, stickerPhotos: [], damagePhotos: [], jobId: null, stickerData: {}, description: '', severity: '', _analyzing: false };

  function renderDamageReport() {
    dmgState = { step: 1, stickerPhotos: [], damagePhotos: [], jobId: null, stickerData: {}, description: '', severity: '', _analyzing: false };
    _drawDmg();
  }

  function _drawDmg() {
    if (dmgState.step === 1) _drawDmgStep1();
    else if (dmgState.step === 2) _drawDmgStep2();
    else if (dmgState.step === 3) _drawDmgStep3();
  }

  // --- STEP 1: Sticker Photos ---
  function _drawDmgStep1() {
    var s = dmgState;
    var photosHtml = '';
    if (s.stickerPhotos.length > 0) {
      photosHtml = '<div class="photo-grid" style="margin-bottom:12px;">' +
        s.stickerPhotos.map(function(p, i) {
          return '<div class="photo-thumb"><img src="' + p.preview + '" alt="" style="transform:rotate(' + (p.rotation||0) + 'deg)"><button class="photo-rotate dmg-st-rot" data-idx="' + i + '">\u21BB</button><button class="photo-delete dmg-st-del" data-idx="' + i + '">\u2715</button></div>';
        }).join('') +
        '</div>';
    }

    var html = renderHeader(t('dmg.title'), true) +
      '<div class="step-indicator"><span class="step-dot active"></span><span class="step-dot"></span><span class="step-dot"></span></div>' +
      '<h2 class="text-center mb-16" style="font-size:1.1rem;">' + t('dmg.step1') + '</h2>' +
      '<div class="card">' +
        '<label class="form-label" style="margin-bottom:8px;">\uD83D\uDCCB ' + t('dmg.stickerPhotos') + ' (' + s.stickerPhotos.length + ')</label>' +
        photosHtml +
        '<div class="text-center" style="padding:8px 0;"><div class="camera-icon" style="font-size:1.5rem;">\uD83D\uDCF7</div><div class="camera-text text-sm">' + t('dmg.takeStickerPhoto') + '</div></div>' +
        '<div style="display:flex;gap:12px;justify-content:center;margin:12px 0;">' +
        '<button type="button" class="btn btn-primary" id="dmg-sticker-input-cam-btn" style="flex:1;max-width:180px;padding:14px 8px;font-size:1rem;">📷 ' + t('new.camera') + '</button>' +
        '<button type="button" class="btn btn-secondary" id="dmg-sticker-input-file-btn" style="flex:1;max-width:180px;padding:14px 8px;font-size:1rem;">📁 ' + t('new.files') + '</button>' +
      '</div>' +
      '<input type="file" accept="image/*" capture="environment" class="camera-input" id="dmg-sticker-input">' +
      '<input type="file" accept="image/*" multiple class="camera-input" id="dmg-sticker-input-files">' +
      '</div>' +
      '<button class="btn btn-primary mt-16" id="dmg-analyze-btn" style="width:100%;"' + (s.stickerPhotos.length === 0 ? ' disabled' : '') + '>' + t('dmg.analyzeSticker') + '</button>';

    document.getElementById('app').innerHTML = html;

    document.getElementById('dmg-sticker-input-cam-btn').addEventListener('click', function() {
      haptic();
      document.getElementById('dmg-sticker-input').click();
    });
    document.getElementById('dmg-sticker-input-file-btn').addEventListener('click', function() {
      haptic();
      document.getElementById('dmg-sticker-input-files').click();
    });
    document.getElementById('dmg-sticker-input-files').addEventListener('change', function(e) {
      var files = Array.from(e.target.files);
      files.forEach(function(file) {
        var reader = new FileReader();
        reader.onload = function(ev) {
          dmgState.stickerPhotos.push({ file: file, preview: ev.target.result, rotation: 0 });
          renderDmgStep1();
        };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    });

    document.getElementById('dmg-sticker-input').addEventListener('change', function(e) {
      Array.from(e.target.files).forEach(function(file) {
        var reader = new FileReader();
        reader.onload = function(ev) {
          s.stickerPhotos.push({ file: file, preview: ev.target.result, rotation: 0 });
          _drawDmgStep1();
        };
        reader.readAsDataURL(file);
      });
      this.value = '';
    });

    document.querySelectorAll('.dmg-st-del').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation(); haptic(20);
        s.stickerPhotos.splice(parseInt(this.getAttribute('data-idx')), 1);
        _drawDmgStep1();
      });
    });
    document.querySelectorAll('.dmg-st-rot').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation(); haptic();
        var idx = parseInt(this.getAttribute('data-idx'));
        s.stickerPhotos[idx].rotation = ((s.stickerPhotos[idx].rotation || 0) + 90) % 360;
        _drawDmgStep1();
      });
    });

    document.getElementById('dmg-analyze-btn').addEventListener('click', _doDmgAnalyze);
  }

  // --- Sticker AI Analysis ---
  async function _doDmgAnalyze() {
    var s = dmgState;
    if (s._analyzing || s.stickerPhotos.length === 0) return;
    s._analyzing = true;

    document.getElementById('app').innerHTML = renderHeader(t('dmg.title'), true) +
      '<div class="loading-overlay"><div class="spinner"></div><div class="loading-text">' +
      t('dmg.analyzingSticker') + '</div><div class="text-sm text-muted">' +
      (t('dmg.analyzingStickerDesc') || 'AI reading all information...') + '</div></div>';

    try {
      if (!s.jobId) {
        var driver = state.driver;
        var jobResult = await api.createJob(driver ? driver.id : undefined);
        var job = jobResult.job || jobResult;
        s.jobId = job.id;
      }

      // Bake rotation into sticker photos before upload
      var files = [];
      for (var i = 0; i < s.stickerPhotos.length; i++) {
        var p = s.stickerPhotos[i];
        if (p.rotation) {
          files.push(await _dmgRotateFile(p.file, p.rotation));
        } else {
          files.push(p.file);
        }
      }
      await api.uploadPhotos(s.jobId, files, 'sticker');

      // Analyze with FULL sticker mode (extracts ALL info)
      var analysis = await api.analyzeJobFull(s.jobId);
      var data = analysis.job || analysis.data || analysis;

      s.stickerData = {
        order_nr: data.order_nr || '',
        tur_nr: data.tur_nr || data.tour_nr || '',
        customer_name: data.customer_name || data.customer || '',
        address: data.address || '',
        delivery_date: data.delivery_date || new Date().toISOString().slice(0,10),
        product: data.product || '',
        antal: data.antal || '',
        pos_nr: data.pos_nr || '',
        production: data.production || '',
        barcode: data.barcode || '',
        weight: data.weight || '',
        dimensions: data.dimensions || '',
        sender: data.sender || '',
        phone: data.phone || '',
        reference: data.reference || '',
        notes: data.notes || '',
        additional_info: data.additional_info || ''
      };

      s._analyzing = false;
      s.step = 2;
      _drawDmg();
    } catch (e) {
      s._analyzing = false;
      toast(e.message, 'error');
      _drawDmgStep1();
    }
  }

  // --- STEP 2: Review All Extracted Fields ---
  function _drawDmgStep2() {
    var s = dmgState;
    var d = s.stickerData;

    var mainFields = [
      { key: 'order_nr', label: t('new.orderNr') },
      { key: 'tur_nr', label: t('new.tourNr') },
      { key: 'customer_name', label: t('new.customer') },
      { key: 'address', label: t('new.address') },
      { key: 'delivery_date', label: t('new.deliveryDate'), type: 'date' }
    ];

    var extraFields = [
      { key: 'product', label: t('dmg.product') },
      { key: 'antal', label: t('dmg.quantity') },
      { key: 'pos_nr', label: t('dmg.posNr') },
      { key: 'production', label: t('dmg.production') },
      { key: 'barcode', label: t('dmg.barcode') },
      { key: 'weight', label: t('dmg.weight') },
      { key: 'dimensions', label: t('dmg.dimensions') },
      { key: 'sender', label: t('dmg.sender') },
      { key: 'phone', label: t('dmg.phone') },
      { key: 'reference', label: t('dmg.reference') },
      { key: 'notes', label: t('dmg.notes') },
      { key: 'additional_info', label: t('dmg.additionalInfo') }
    ];

    function mkField(f) {
      var val = d[f.key] || '';
      if (f.key === 'additional_info' || f.key === 'notes') {
        return '<div class="form-group"><label class="form-label">' + f.label + '</label>' +
          '<textarea class="form-textarea dmg-field" data-field="' + f.key + '" rows="3">' + escHtml(val) + '</textarea></div>';
      }
      return '<div class="form-group"><label class="form-label">' + f.label + '</label>' +
        '<input type="' + (f.type || 'text') + '" class="form-input dmg-field" data-field="' + f.key + '" value="' + escHtml(val) + '"></div>';
    }

    // Show extra fields that have values
    var visibleExtra = extraFields.filter(function(f) { return d[f.key]; });

    var html = renderHeader(t('dmg.title'), true) +
      '<div class="step-indicator"><span class="step-dot done"></span><span class="step-dot active"></span><span class="step-dot"></span></div>' +
      '<h2 class="text-center mb-16" style="font-size:1.1rem;">' + t('dmg.step2') + '</h2>' +
      '<div class="card">' + mainFields.map(mkField).join('') + '</div>';

    if (visibleExtra.length > 0) {
      html += '<div class="card mt-16" style="background:var(--surface);">' +
        '<div class="section-title" style="margin-bottom:8px;">\uD83D\uDCE6 ' + t('dmg.extraInfo') + '</div>' +
        visibleExtra.map(mkField).join('') +
        '</div>';
    }

    html += '<div class="flex-row mt-16" style="gap:10px;">' +
      '<button class="btn btn-secondary" id="dmg-step2-back" style="flex:1;">' + t('dmg.back') + '</button>' +
      '<button class="btn btn-primary" id="dmg-step2-next" style="flex:2;">' + t('dmg.next') + '</button>' +
    '</div>';

    document.getElementById('app').innerHTML = html;

    document.querySelectorAll('.dmg-field').forEach(function(el) {
      el.addEventListener('input', function() {
        s.stickerData[this.getAttribute('data-field')] = this.value;
      });
    });

    document.getElementById('dmg-step2-back').addEventListener('click', function() { haptic(); s.step = 1; _drawDmg(); });
    document.getElementById('dmg-step2-next').addEventListener('click', function() { haptic(); s.step = 3; _drawDmg(); });
  }

  // --- STEP 3: Damage Photos + Description + Severity ---
  function _drawDmgStep3() {
    var s = dmgState;
    var photosHtml = '';
    if (s.damagePhotos.length > 0) {
      photosHtml = '<div class="photo-grid" style="margin-bottom:12px;">' +
        s.damagePhotos.map(function(p, i) {
          return '<div class="photo-thumb"><img src="' + p.preview + '" alt="" style="transform:rotate(' + (p.rotation||0) + 'deg)"><button class="photo-rotate dmg-dp-rot" data-idx="' + i + '">\u21BB</button><button class="photo-delete dmg-dp-del" data-idx="' + i + '">\u2715</button></div>';
        }).join('') +
        '</div>';
    }

    var sevBtns = ['low','medium','high'].map(function(sev) {
      return '<div class="severity-btn sev-' + sev + (s.severity === sev ? ' selected' : '') + '" data-sev="' + sev + '">' + t('dmg.' + sev) + '</div>';
    }).join('');

    var html = renderHeader(t('dmg.title'), true) +
      '<div class="step-indicator"><span class="step-dot done"></span><span class="step-dot done"></span><span class="step-dot active"></span></div>' +
      '<h2 class="text-center mb-16" style="font-size:1.1rem;">' + t('dmg.step3') + '</h2>' +
      '<div class="card">' +
        '<label class="form-label" style="margin-bottom:8px;">\uD83D\uDCF7 ' + t('dmg.damagePhotos') + ' (' + s.damagePhotos.length + ')</label>' +
        photosHtml +
        '<div class="text-center" style="padding:8px 0;"><div class="camera-icon" style="font-size:1.5rem;">\uD83D\uDCF7</div><div class="camera-text text-sm">' + t('dmg.takeDamagePhoto') + '</div></div>' +
        '<div style="display:flex;gap:12px;justify-content:center;margin:12px 0;">' +
        '<button type="button" class="btn btn-primary" id="dmg-damage-input-cam-btn" style="flex:1;max-width:180px;padding:14px 8px;font-size:1rem;">📷 ' + t('new.camera') + '</button>' +
        '<button type="button" class="btn btn-secondary" id="dmg-damage-input-file-btn" style="flex:1;max-width:180px;padding:14px 8px;font-size:1rem;">📁 ' + t('new.files') + '</button>' +
      '</div>' +
      '<input type="file" accept="image/*" capture="environment" class="camera-input" id="dmg-damage-input">' +
      '<input type="file" accept="image/*" multiple class="camera-input" id="dmg-damage-input-files">' +
      '</div>' +
      '<div class="card mt-16">' +
        '<label class="form-label">' + t('dmg.description') + '</label>' +
        '<textarea class="form-textarea" id="dmg-desc" placeholder="' + t('dmg.descPlaceholder') + '">' + escHtml(s.description) + '</textarea>' +
      '</div>' +
      '<div class="card mt-16">' +
        '<label class="form-label">' + t('dmg.severity') + '</label>' +
        '<div class="severity-grid">' + sevBtns + '</div>' +
      '</div>' +
      '<div class="flex-row mt-16" style="gap:10px;">' +
        '<button class="btn btn-secondary" id="dmg-step3-back" style="flex:1;">' + t('dmg.back') + '</button>' +
        '<button class="btn btn-danger" id="dmg-submit" style="flex:2;">' + t('dmg.submit') + '</button>' +
      '</div>';

    document.getElementById('app').innerHTML = html;

    document.getElementById('dmg-damage-input-cam-btn').addEventListener('click', function() {
      haptic();
      document.getElementById('dmg-damage-input').click();
    });
    document.getElementById('dmg-damage-input-file-btn').addEventListener('click', function() {
      haptic();
      document.getElementById('dmg-damage-input-files').click();
    });
    document.getElementById('dmg-damage-input-files').addEventListener('change', function(e) {
      var files = Array.from(e.target.files);
      files.forEach(function(file) {
        var reader = new FileReader();
        reader.onload = function(ev) {
          dmgState.damagePhotos.push({ file: file, preview: ev.target.result, rotation: 0 });
          renderDmgStep3();
        };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    });
    document.getElementById('dmg-damage-input').addEventListener('change', function(e) {
      Array.from(e.target.files).forEach(function(file) {
        var reader = new FileReader();
        reader.onload = function(ev) {
          s.damagePhotos.push({ file: file, preview: ev.target.result, rotation: 0 });
          _drawDmgStep3();
        };
        reader.readAsDataURL(file);
      });
      this.value = '';
    });

    document.querySelectorAll('.dmg-dp-del').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation(); haptic(20);
        s.damagePhotos.splice(parseInt(this.getAttribute('data-idx')), 1);
        _drawDmgStep3();
      });
    });
    document.querySelectorAll('.dmg-dp-rot').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation(); haptic();
        var idx = parseInt(this.getAttribute('data-idx'));
        s.damagePhotos[idx].rotation = ((s.damagePhotos[idx].rotation || 0) + 90) % 360;
        _drawDmgStep3();
      });
    });

    document.getElementById('dmg-desc').addEventListener('input', function() { s.description = this.value; });

    document.querySelectorAll('.severity-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        haptic();
        s.severity = this.getAttribute('data-sev');
        _drawDmgStep3();
      });
    });

    document.getElementById('dmg-step3-back').addEventListener('click', function() { haptic(); s.step = 2; _drawDmg(); });
    document.getElementById('dmg-submit').addEventListener('click', _submitDmgReport);
  }

  // --- Submit Damage Report ---
  async function _submitDmgReport() {
    var s = dmgState;
    haptic();
    var btn = document.getElementById('dmg-submit');
    if (!btn) return;

    if (!s.description) {
      toast(t('common.error'), 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = t('dmg.submitting');

    try {
      // Update job with all edited sticker fields
      var d = s.stickerData;
      await api.updateJob(s.jobId, {
        tur_nr: d.tur_nr || null,
        order_nr: d.order_nr || null,
        customer_name: d.customer_name || null,
        address: d.address || null,
        delivery_date: d.delivery_date || null,
        product: d.product || null,
        antal: d.antal || null,
        pos_nr: d.pos_nr || null,
        production: d.production || null,
        barcode: d.barcode || null
      });

      // Upload damage photos with rotation baked in
      if (s.damagePhotos.length > 0) {
        var files = [];
        for (var i = 0; i < s.damagePhotos.length; i++) {
          var p = s.damagePhotos[i];
          if (p.rotation) {
            files.push(await _dmgRotateFile(p.file, p.rotation));
          } else {
            files.push(p.file);
          }
        }
        await api.uploadPhotos(s.jobId, files, 'damage');
      }

      // Set status to damaged with driver description + severity
      var report = s.description + (s.severity ? ' [' + s.severity.toUpperCase() + ']' : '');
      await api.updateJobStatus(s.jobId, 'damaged', report);

      // Run AI damage analysis on the damage photos
      if (s.damagePhotos.length > 0) {
        try {
          btn.textContent = t('dmg.analyzing') || 'Analyzing damage...';
          await api.analyzeDamage(s.jobId);
        } catch (e) { console.error('AI damage analysis failed:', e); }
      }

      toast(t('dmg.success'), 'success');
      navigate('#/dashboard');
    } catch (e) {
      toast(e.message, 'error');
      btn.disabled = false;
      btn.textContent = t('dmg.submit');
    }
  }

  // --- Helper: Rotate image file via Canvas ---
  function _dmgRotateFile(file, degrees) {
    return new Promise(function(resolve) {
      if (!degrees) { resolve(file); return; }
      var img = new Image();
      img.onload = function() {
        var canvas = document.createElement('canvas');
        var swap = (degrees === 90 || degrees === 270);
        canvas.width = swap ? img.height : img.width;
        canvas.height = swap ? img.width : img.height;
        var ctx = canvas.getContext('2d');
        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate(degrees * Math.PI / 180);
        ctx.drawImage(img, -img.width / 2, -img.height / 2);
        canvas.toBlob(function(blob) {
          resolve(new File([blob], file.name, { type: 'image/jpeg' }));
        }, 'image/jpeg', 0.9);
      };
      img.src = URL.createObjectURL(file);
    });
  }

  // ===== INIT =====
  router();

  // =================== DELIVERY CONDITIONS ===================
  var _dcState = { photos: [], _reason: '', _comment: '', submitting: false };

  function renderDeliveryConditions() {
    _dcState = { photos: [], _reason: '', _comment: '', submitting: false };
    _drawDC();
  }

  function _drawDC() {
    var s = _dcState;
    var photosHtml = '';
    if (s.photos.length > 0) {
      photosHtml = '<div class="photo-grid" style="margin-bottom:12px;">' +
        s.photos.map(function(p, i) {
          return '<div class="photo-thumb"><img src="' + p.preview + '" alt="" style="transform:rotate(' + (p.rotation||0) + 'deg)"><button class="photo-rotate dc-photo-rot" data-idx="' + i + '">↻</button><button class="photo-delete dc-photo-del" data-idx="' + i + '">&times;</button></div>';
        }).join('') +
        '</div>';
    }

    var _dcOpts = (_dropdownCache.dc_reason && _dropdownCache.dc_reason.length) ? _dropdownCache.dc_reason : [{label_da:'Ikke hjemme',label_en:'Not home'},{label_da:'Adresse ikke fundet',label_en:'Address not found'},{label_da:'Kunde afviste leveringen',label_en:'Customer refused delivery'},{label_da:'Beskadiget vare - returneret',label_en:'Damaged goods - returned'},{label_da:'Forkert adresse',label_en:'Wrong address'},{label_da:'Adgangsproblemer',label_en:'Access problems'},{label_da:'Kræver underskrift - ingen hjemme',label_en:'Signature required - no one home'},{label_da:'Depot lukket / ikke tilgængeligt',label_en:'Depot closed / not accessible'},{label_da:'Andet',label_en:'Other'}];
    var _dcLang = (window._lang || 'da');
    var _dcSelected = Array.isArray(s._reason) ? s._reason : (s._reason ? [s._reason] : []);
    var reasonCheckboxes = _dcOpts.map(function(o) {
      var val = _dcLang === 'en' ? o.label_en : o.label_da;
      var chk = _dcSelected.indexOf(val) !== -1;
      return '<label style="display:flex;align-items:center;padding:8px 12px;margin:2px 0;border:1px solid var(--border);border-radius:8px;cursor:pointer;background:' + (chk ? '#e8f0fe' : 'var(--surface)') + '"><input type="checkbox" class="dc-reason-cb" value="' + escHtml(val) + '"' + (chk ? ' checked' : '') + ' style="margin-right:10px;width:18px;height:18px;accent-color:var(--primary)"> <span>' + escHtml(val) + '</span></label>';
    }).join('');

    var html = renderHeader(t('dc.title'), true) +
      '<div class="card" style="margin-bottom:16px;">' +
        '<label class="form-label" style="margin-bottom:8px;">📷 ' + t('dc.addPhoto') + ' (' + s.photos.length + ')</label>' +
        '<div class="text-center" style="padding:8px 0;"><div class="camera-icon">📷</div><div class="camera-text">' + t('dc.addPhoto') + '</div></div>' +
        '<div style="display:flex;gap:12px;justify-content:center;margin:12px 0;">' +
        '<button type="button" class="btn btn-primary" id="dc-photo-input-cam-btn" style="flex:1;max-width:180px;padding:14px 8px;font-size:1rem;">📷 ' + t('new.camera') + '</button>' +
        '<button type="button" class="btn btn-secondary" id="dc-photo-input-file-btn" style="flex:1;max-width:180px;padding:14px 8px;font-size:1rem;">📁 ' + t('new.files') + '</button>' +
      '</div>' +
      '<input type="file" accept="image/*" capture="environment" class="camera-input" id="dc-photo-input">' +
      '<input type="file" accept="image/*" multiple class="camera-input" id="dc-photo-input-files">' +
        photosHtml +
      '</div>' +
      '<div class="card" style="margin-bottom:16px;">' +
        '<label class="form-label">' + t('dc.reasonLabel') + '</label>' +
        '<div id="dc-reason-list" style="margin-bottom:12px;">' + reasonCheckboxes + '</div>' +
        '<label class="form-label">' + t('dc.comment') + '</label>' +
        '<textarea class="form-textarea" id="dc-comment" rows="3" placeholder="' + t('dc.commentPlaceholder') + '">' + escHtml(s._comment) + '</textarea>' +
      '</div>' +
      '<button class="btn btn-primary btn-block" id="dc-submit-btn"' + (s.submitting ? ' disabled' : '') + '>' +
        (s.submitting ? t('dc.submitting') : t('dc.submit')) +
      '</button>' +
      '<button class="btn btn-secondary btn-block" style="margin-top:8px;" onclick="navigate(\'#/dashboard\')">\u2190 ' + t('new.back') + '</button>';

    render(html, true);

    document.getElementById('dc-photo-input-cam-btn').addEventListener('click', function() {
      haptic();
      document.getElementById('dc-photo-input').click();
    });
    document.getElementById('dc-photo-input-file-btn').addEventListener('click', function() {
      haptic();
      document.getElementById('dc-photo-input-files').click();
    });
    document.getElementById('dc-photo-input-files').addEventListener('change', function(e) {
      var files = Array.from(e.target.files);
      files.forEach(function(file) {
        var reader = new FileReader();
        reader.onload = function(ev) {
          dcPhotos.push({ file: file, preview: ev.target.result, rotation: 0 });
          renderDCForm();
        };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    });

    document.getElementById('dc-photo-input').addEventListener('change', function(e) {
      var files = Array.from(e.target.files);
      _saveDCFields();
      files.forEach(function(file) {
        var reader = new FileReader();
        reader.onload = function(ev) {
          _dcState.photos.push({ file: file, preview: ev.target.result, rotation: 0 });
          _drawDC();
          _restoreDCFields();
        };
        reader.readAsDataURL(file);
      });
      e.target.value = '';
    });

    document.querySelectorAll('.dc-photo-del').forEach(function(btn) {
      btn.addEventListener('click', function() {
        _saveDCFields();
        _dcState.photos.splice(parseInt(this.dataset.idx), 1);
        _drawDC();
        _restoreDCFields();
      });
    });

    document.querySelectorAll('.dc-photo-rot').forEach(function(btn) {
      btn.addEventListener('click', function(e) {
        e.stopPropagation(); haptic();
        _saveDCFields();
        var idx = parseInt(this.dataset.idx);
        _dcState.photos[idx].rotation = ((_dcState.photos[idx].rotation || 0) + 90) % 360;
        _drawDC();
        _restoreDCFields();
      });
    });

    var commentEl = document.getElementById('dc-comment');
    if (commentEl) {
      commentEl.value = _dcState._comment || '';
      commentEl.addEventListener('input', function() { _dcState._comment = this.value; });
    }

    var submitBtn = document.getElementById('dc-submit-btn');
    if (submitBtn && !s.submitting) {
      submitBtn.addEventListener('click', async function() {
        _saveDCFields();
        if (!_dcState._reason || (Array.isArray(_dcState._reason) && _dcState._reason.length === 0)) { alert(t('dc.noReason')); return; }
        _dcState.submitting = true;
        _drawDC();
        try {
          var formData = new FormData();
          var driverData = JSON.parse(localStorage.getItem('teslak_driver') || '{}');
          formData.append('driver_id', driverData.id || '');
          var reasonVal = Array.isArray(_dcState._reason) ? _dcState._reason.join(', ') : (_dcState._reason || '');
          formData.append('reason', reasonVal);
          formData.append('comment', _dcState._comment || '');
          var bakedPhotos = await Promise.all(_dcState.photos.map(function(p) {
            return new Promise(function(resolve) {
              if (!p.rotation) { resolve(p.file); return; }
              var img = new Image();
              img.onload = function() {
                var canvas = document.createElement('canvas');
                var rot = ((p.rotation % 360) + 360) % 360;
                var sw = (rot === 90 || rot === 270) ? img.height : img.width;
                var sh = (rot === 90 || rot === 270) ? img.width : img.height;
                canvas.width = sw; canvas.height = sh;
                var ctx = canvas.getContext('2d');
                ctx.translate(sw/2, sh/2);
                ctx.rotate(rot * Math.PI / 180);
                ctx.drawImage(img, -img.width/2, -img.height/2);
                canvas.toBlob(function(blob) { resolve(new File([blob], p.file.name, {type:'image/jpeg'})); }, 'image/jpeg', 0.92);
              };
              img.src = p.preview;
            });
          }));
          bakedPhotos.forEach(function(f) { formData.append('photos', f); });
          var resp = await fetch('/api/delivery-conditions', { method: 'POST', body: formData });
          var data = await resp.json();
          if (!resp.ok) throw new Error(data.error || 'Failed');
          alert(t('dc.success') + '  \u2705');
          navigate('#/dashboard');
        } catch (err) {
          _dcState.submitting = false;
          _drawDC();
          alert('Error: ' + err.message);
        }
      });
    }
  }

  function _saveDCFields() {
    var cbs = document.querySelectorAll('.dc-reason-cb:checked');
    _dcState._reason = Array.from(cbs).map(function(cb) { return cb.value; });
    var c = document.getElementById('dc-comment');
    if (c) _dcState._comment = c.value;
  }

  function _restoreDCFields() {
    // DC reason checkboxes rendered from state
    var c = document.getElementById('dc-comment');
    if (c) c.value = _dcState._comment || '';
  }

})();
