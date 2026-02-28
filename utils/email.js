const nodemailer = require('nodemailer');

async function getSmtpConfig(pool) {
  try {
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
  const smtpConfig = pool ? await getSmtpConfig(pool) : {
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
          <td style="padding:10px 8px;color:#6b7280;">Driver</td>
          <td style="padding:10px 8px;">${job.driver_name || 'N/A'}</td>
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

module.exports = { sendJobEmail, getSmtpConfig };
