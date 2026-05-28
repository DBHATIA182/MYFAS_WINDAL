/** Sale/purchase bill print — scoped @media print rules in App.css */
export function runWindalSaleBillPrint() {
  document.body.classList.add('windal-sale-bill-printing');
  const cleanup = () => document.body.classList.remove('windal-sale-bill-printing');
  window.addEventListener('afterprint', cleanup, { once: true });
  window.print();
}
