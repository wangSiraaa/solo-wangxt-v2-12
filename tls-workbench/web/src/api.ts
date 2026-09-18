import axios from 'axios';

export const api = axios.create({ baseURL: '/api' });

api.interceptors.response.use(
  (r) => r,
  (err) => {
    const data = err.response?.data;
    const msg =
      (Array.isArray(data?.message) ? data.message.join('; ') : data?.message) ||
      err.message;
    const details = data?.errors?.length ? `\n${data.errors.join('\n')}` : '';
    return Promise.reject(new Error(`${msg}${details}`));
  },
);

export const shortFp = (fp?: string | null) =>
  fp ? fp.replace(/:/g, '').slice(0, 12) : '—';

export const fmtDate = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleString() : '—';
