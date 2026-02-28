(function() {
  const BASE_URL = window.location.origin;

  function getToken() {
    return localStorage.getItem('teslak_token');
  }

  function setToken(token) {
    localStorage.setItem('teslak_token', token);
  }

  function clearToken() {
    localStorage.removeItem('teslak_token');
  }

  function getDriverInfo() {
    const raw = localStorage.getItem('teslak_driver');
    return raw ? JSON.parse(raw) : null;
  }

  function setDriverInfo(driver) {
    localStorage.setItem('teslak_driver', JSON.stringify(driver));
  }

  function clearDriverInfo() {
    localStorage.removeItem('teslak_driver');
  }

  async function request(method, path, body, isFormData) {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (!isFormData) headers['Content-Type'] = 'application/json';

    const opts = { method, headers };
    if (body) {
      opts.body = isFormData ? body : JSON.stringify(body);
    }

    let res;
    try {
      res = await fetch(BASE_URL + path, opts);
    } catch (err) {
      throw new Error('Network error: ' + err.message);
    }

    if (res.status === 401) {
      clearToken();
      clearDriverInfo();
      window.location.hash = '#/login';
      throw new Error('Unauthorized');
    }

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(data.error || data.message || 'Request failed (' + res.status + ')');
    }

    return data;
  }

  // Auth
  async function login(name, pin) {
    const data = await request('POST', '/api/auth/login', { name, pin });
    if (data.token) setToken(data.token);
    if (data.driver) setDriverInfo(data.driver);
    return data;
  }

  async function getDrivers() {
    const data = await request('GET', '/api/auth/drivers');
    return data.drivers || data;
  }

  function logout() {
    clearToken();
    clearDriverInfo();
    window.location.hash = '#/login';
  }

  function isLoggedIn() {
    return !!getToken();
  }

  // Jobs
  async function createJob(driverId) {
    return request('POST', '/api/jobs', { driver_id: driverId });
  }

  async function getJobs(filters) {
    const params = new URLSearchParams();
    if (filters) {
      if (filters.status) params.set('status', filters.status);
      if (filters.date) params.set('date', filters.date);
      if (filters.driver_id) params.set('driver_id', filters.driver_id);
    }
    const qs = params.toString();
    return request('GET', '/api/jobs' + (qs ? '?' + qs : ''));
  }

  async function getJob(id) {
    return request('GET', '/api/jobs/' + id);
  }

  async function updateJob(id, data) {
    return request('PATCH', '/api/jobs/' + id, data);
  }

  async function updateJobStatus(id, status, report) {
    const body = { status };
    if (report) body.damage_report = report;
    return request('PATCH', '/api/jobs/' + id + '/status', body);
  }

  async function analyzeJob(id) {
    return request('POST', '/api/jobs/' + id + '/analyze');
  }

  // Photos
  async function uploadPhotos(jobId, files, type) {
    const formData = new FormData();
    for (let i = 0; i < files.length; i++) {
      formData.append('photos', files[i]);
    }
    if (type) formData.append('type', type);
    return request('POST', '/api/photos/' + jobId, formData, true);
  }

  async function getPhotos(jobId) {
    return request('GET', '/api/photos/' + jobId);
  }

  async function deletePhoto(id) {
    return request('DELETE', '/api/photos/' + id);
  }

  // Email
  async function sendEmail(jobId) {
    return request('POST', '/api/jobs/' + jobId + '/email');
  }

  window.api = {
    login,
    getDrivers,
    logout,
    isLoggedIn,
    getDriverInfo,
    createJob,
    getJobs,
    getJob,
    updateJob,
    updateJobStatus,
    analyzeJob,
    uploadPhotos,
    getPhotos,
    deletePhoto,
    sendEmail
  };
})();
