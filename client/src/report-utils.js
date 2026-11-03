export const duration = (ms) => {
  const sec = Math.floor(Math.max(0, ms || 0) / 1000);
  return (
    String(Math.floor(sec / 3600)).padStart(2, '0') +
    ':' +
    String(Math.floor(sec / 60) % 60).padStart(2, '0') +
    ':' +
    String(sec % 60).padStart(2, '0')
  );
};
export const clock = (iso) =>
  iso
    ? new Date(iso).toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      })
    : '—';
export const stamp = (iso) => (iso ? new Date(iso).toLocaleString('en-IN') : '');
