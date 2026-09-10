export function resolveApiOrigin(value = '', development = false) {
  const origin = value.trim();
  if (!origin) return '';
  const url = new URL(origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('VITE_API_BASE_URL must be an HTTP(S) origin without path or credentials');
  }
  if (development && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) {
    throw new Error('Development API must use a loopback host');
  }
  return url.origin;
}
