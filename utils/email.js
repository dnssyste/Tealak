const path = require('path');
const nodemailer = require('nodemailer');

async function getSmtpConfig(pool, type) {
  // type: 'delivery' | 'container' | 'damage' | undefined (default)
  try {
    if (pool && type) {
      // Check if a specific profile is assigned for this type
      const settingKey = `smtp_profile_${type}`;
      const assignResult = await pool.query('SELECT value FROM settings WHERE key=$1', [settingKey]);
      const profileId = assignResult.rows[0] && assignResult.rows[0].value;
      if (profileId && profileId !== '') {
        const profResult = await pool.query('SELECT * FROM smtp_profiles WHERE id=$1', [parseInt(profileId)]);
        if (profResult.rows.length) {
          const p = profResult.rows[0];
          return {
            host: p.host,
            port: p.port,
            secure: p.secure,
            auth: { user: p.username, pass: p.password },
            from: p.from_address || p.username
          };
        }
      }
    }
    if (pool) {
      // Try default smtp_profile
      const defResult = await pool.query('SELECT * FROM smtp_profiles WHERE is_default = true LIMIT 1');
      if (defResult.rows.length) {
        const p = defResult.rows[0];
        return {
          host: p.host,
          port: p.port,
          secure: p.secure,
          auth: { user: p.username, pass: p.password },
          from: p.from_address || p.username
        };
      }
      // Legacy: smtp_config table
      const result = await pool.query('SELECT key, value FROM smtp_config');
      const config = {};
      result.rows.forEach(r => { config[r.key] = r.value; });
      if (config.smtp_host) {
        return {
          host: config.smtp_host,
          port: parseInt(config.smtp_port || '587'),
          secure: config.smtp_port === '465',
          auth: { user: config.smtp_user, pass: config.smtp_pass },
          from: config.smtp_from || process.env.SMTP_FROM
        };
      }
    }
  } catch (e) {
    console.error('Failed to load SMTP from DB:', e.message);
  }
  // Fallback to env vars
  return {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    from: process.env.SMTP_FROM
  };
}

function createTransporter(smtpConfig) {
  return nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: smtpConfig.auth,
  });
}

function getStatusBadge(status) {
  const colors = {
    completed: { bg: '#22c55e', text: '#fff', label: 'Completed ✓' },
    damaged: { bg: '#f97316', text: '#fff', label: 'Damaged ⚠' },
    missing: { bg: '#ef4444', text: '#fff', label: 'Missing Items ✗' },
    pending: { bg: '#6b7280', text: '#fff', label: 'Pending' },
  };
  const s = colors[status] || colors.pending;
  return `<span style="display:inline-block;padding:6px 16px;border-radius:20px;background:${s.bg};color:${s.text};font-weight:bold;font-size:14px;">${s.label}</span>`;
}

async function sendJobEmail(job, photos, recipientEmail, replyTo, pool) {
  const smtpConfig = pool ? await getSmtpConfig(pool, 'delivery') : {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: process.env.SMTP_PORT === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    from: process.env.SMTP_FROM
  };

  const baseUrl = process.env.BASE_URL || 'http://localhost:3000';

  const galleryUrl = `${baseUrl}/gallery/${job.id}`;

  const photoLinks = photos.map(p =>
    `<a href="${baseUrl}/api/photos/file/${p.filename}" style="display:inline-block;margin:4px;">
      <img src="${baseUrl}/api/photos/file/${p.filename}" alt="${p.original_name || p.filename}" style="width:120px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #ddd;" />
    </a>`
  ).join('');

  const damageSection = job.status === 'damaged' && job.damage_report ? `
    <tr>
      <td colspan="2" style="padding:12px;background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;">
        <strong style="color:#c2410c;">⚠ Damage Report:</strong><br/>
        <p style="margin:8px 0 0;color:#9a3412;">${job.damage_report}</p>
      </td>
    </tr>` : '';

  const missingSection = job.status === 'missing' && job.missing_items ? `
    <tr>
      <td colspan="2" style="padding:12px;background:#fef2f2;border:1px solid #fecaca;border-radius:8px;">
        <strong style="color:#dc2626;">✗ Missing Items:</strong><br/>
        <p style="margin:8px 0 0;color:#991b1b;">${job.missing_items}</p>
      </td>
    </tr>` : '';

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="max-width:640px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;margin-top:20px;margin-bottom:20px;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
    
    <!-- Header -->
    <div style="background:#1a1a2e;padding:24px 32px;text-align:center;">
      <h1 style="margin:0;color:#fff;font-size:24px;letter-spacing:1px;">🚛 TESLAK</h1>
      <p style="margin:4px 0 0;color:#94a3b8;font-size:13px;">Delivery Report</p>
    </div>

    <!-- Status -->
    <div style="text-align:center;padding:20px;">
      ${getStatusBadge(job.status)}
    </div>

    <!-- Job Details -->
    <div style="padding:0 32px 24px;">
      <table style="width:100%;border-collapse:collapse;font-size:14px;">
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;color:#6b7280;width:140px;">Job ID</td>
          <td style="padding:10px 8px;font-weight:500;">${job.id}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;color:#6b7280;">Truck</td>
          <td style="padding:10px 8px;">${truckName}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;color:#6b7280;">Tur Nr</td>
          <td style="padding:10px 8px;">${job.tur_nr || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;color:#6b7280;">Order Nr</td>
          <td style="padding:10px 8px;">${job.order_nr || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;color:#6b7280;">Customer</td>
          <td style="padding:10px 8px;">${job.customer_name || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;color:#6b7280;">Address</td>
          <td style="padding:10px 8px;">${job.address || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;color:#6b7280;">Product</td>
          <td style="padding:10px 8px;">${job.product || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;color:#6b7280;">Delivery Date</td>
          <td style="padding:10px 8px;">${job.delivery_date || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;color:#6b7280;">Antal</td>
          <td style="padding:10px 8px;">${job.antal || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;color:#6b7280;">Pos Nr</td>
          <td style="padding:10px 8px;">${job.pos_nr || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;color:#6b7280;">Production</td>
          <td style="padding:10px 8px;">${job.production || 'N/A'}</td>
        </tr>
        <tr style="border-bottom:1px solid #e5e7eb;">
          <td style="padding:10px 8px;color:#6b7280;">Barcode</td>
          <td style="padding:10px 8px;">${job.barcode || 'N/A'}</td>
        </tr>
        ${damageSection}
        ${missingSection}
      </table>
    </div>

    <!-- Gallery Link -->
    <div style="text-align:center;padding:16px 32px;">
      <a href="${galleryUrl}" style="display:inline-block;background:#c0392b;color:#fff;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;text-decoration:none;letter-spacing:0.5px;">📸 View Photo Gallery &amp; Download</a>
    </div>

    <!-- Photos -->
    ${photos.length > 0 ? `
    <div style="padding:0 32px 24px;">
      <h3 style="margin:0 0 12px;color:#374151;font-size:16px;">📷 Delivery Photos (${photos.length})</h3>
      <div>${photoLinks}</div>
    </div>` : ''}

    <!-- Footer -->
    <div style="background:#f9fafb;padding:16px 32px;text-align:center;border-top:1px solid #e5e7eb;">
      <p style="margin:0;color:#9ca3af;font-size:12px;">
        Teslak Delivery System &bull; ${new Date().toLocaleDateString('da-DK')}
      </p>
    </div>
  </div>
</body>
</html>`;

  const transporter = createTransporter(smtpConfig);
  await transporter.sendMail({
    from: smtpConfig.from || '"Teslak Delivery" <noreply@teslak.dk>',
    to: recipientEmail,
    replyTo: replyTo || undefined,
    subject: `Delivery Report: ${job.customer_name || job.order_nr || job.id} - ${(job.status || 'pending').toUpperCase()}`,
    html,
  });

  console.log(`Email sent to ${recipientEmail} for job ${job.id}`);
}

async function sendContainerReportEmail(db, report, photoFilenames) {
  const smtpConfig = await getSmtpConfig(db, 'container');
  const transporter = nodemailer.createTransport({
    host: smtpConfig.host,
    port: smtpConfig.port,
    secure: smtpConfig.secure,
    auth: { user: smtpConfig.auth.user, pass: smtpConfig.auth.pass },
    tls: { rejectUnauthorized: false }
  });

  // Get recipients
  const recipientsRes = await db.query("SELECT email, reply_to FROM email_recipients WHERE active = TRUE AND notify_container = TRUE");
  if (!recipientsRes.rows.length) return;

  const baseUrl = process.env.BASE_URL || 'https://teslak.brbeck.net';
  const now = new Date(report.created_at);
  const dateStr = now.toLocaleString('da-DK', { dateStyle: 'short', timeStyle: 'short' });

  // Build photo thumbnails
  let photoHtml = '';
  if (photoFilenames.length > 0) {
    photoHtml = `
      <div style="margin-top:16px;">
        <strong style="color:#333;">Billeder (${photoFilenames.length}):</strong>
        <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;">
          ${photoFilenames.map(fn => `
            <a href="${baseUrl}/api/photos/file/${fn}" target="_blank" style="display:inline-block;">
              <img src="${baseUrl}/api/photos/file/${fn}" style="width:120px;height:90px;object-fit:cover;border-radius:6px;border:1px solid #ddd;" />
            </a>
          `).join('')}
        </div>
      </div>`;
  }

  const html = `
    <!DOCTYPE html><html><body style="font-family:sans-serif;background:#f5f5f5;margin:0;padding:20px;">
    <div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.1);">
      <div style="background:#c0392b;padding:24px 32px;">
        <h1 style="color:#fff;margin:0;font-size:1.4rem;">🚛 Containerinspektion</h1>
        <p style="color:#ffcccc;margin:4px 0 0;">Teslak Transport</p>
      </div>
      <div style="padding:24px 32px;">
        <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
          <tr><td style="padding:8px 0;color:#666;width:140px;">Lastbil:</td><td style="padding:8px 0;font-weight:600;">${report.truck_name || '—'}</td></tr>
          ${report.tur_nr ? `<tr><td style="padding:8px 0;color:#666;">Tur nr.:</td><td style="padding:8px 0;font-weight:600;">${report.tur_nr}</td></tr>` : ''}
          ${report.container_nr ? `<tr><td style="padding:8px 0;color:#666;">Container:</td><td style="padding:8px 0;font-weight:600;">${report.container_nr}</td></tr>` : ''}
          ${report.item_type ? `<tr><td style="padding:8px 0;color:#666;">Varetype:</td><td style="padding:8px 0;font-weight:600;">${report.item_type}</td></tr>` : ''}
          <tr><td style="padding:8px 0;color:#666;">Tidspunkt:</td><td style="padding:8px 0;">${dateStr}</td></tr>
          <tr><td style="padding:8px 0;color:#666;">Antal billeder:</td><td style="padding:8px 0;">${photoFilenames.length}</td></tr>
          ${report.rating ? `<tr><td style="padding:8px 0;color:#666;">Bed&oslash;mmelse:</td><td style="padding:8px 0;">${['',' (1) D&aring;rlig',' (2) Under middel',' (3) OK',' (4) God',' (5) Fremragende'][report.rating] || report.rating + '/5'}</td></tr>` : ''}
          ${report.comment ? `<tr><td style="padding:8px 0;color:#666;vertical-align:top;">Kommentar:</td><td style="padding:8px 0;">${report.comment.split('\n').join('<br>')}</td></tr>` : ''}
        </table>
        ${photoHtml}
      </div>
      <div style="background:#f9f9f9;padding:16px 32px;border-top:1px solid #eee;text-align:center;">
        <p style="color:#999;font-size:0.8rem;margin:0;">Teslak Transport Leveringssystem</p>
      </div>
    </div>
    </body></html>`;

  for (const rec of recipientsRes.rows) {
    await transporter.sendMail({
      from: smtpConfig.from,
      to: rec.email,
      replyTo: rec.reply_to || undefined,
      subject: `Containerinspektion - ${report.truck_name || 'Lastbil'} - ${dateStr}`,
      html,
      attachments: [{
        filename: 'Nobia-Retningslinjer.pdf',
        path: path.join(__dirname, '..', 'assets', 'nobia-retningslinjer.pdf'),
        contentType: 'application/pdf'
      }]
    });
    console.log(`Container report email sent to ${rec.email}`);
  }
}

module.exports = { sendJobEmail, sendContainerReportEmail, getSmtpConfig };
