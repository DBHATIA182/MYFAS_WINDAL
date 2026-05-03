const BELOW_20 = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigits(n) {
  if (n < 20) return BELOW_20[n];
  const t = Math.floor(n / 10);
  const u = n % 10;
  return TENS[t] + (u ? ' ' + BELOW_20[u] : '');
}

function threeDigits(n) {
  const h = Math.floor(n / 100);
  const rest = n % 100;
  if (h === 0) return twoDigits(rest);
  return BELOW_20[h] + ' Hundred' + (rest ? ' ' + twoDigits(rest) : '');
}

/** Integer 0 .. 99999999 → words (Indian grouping) */
function intToWords(num) {
  if (num === 0) return 'Zero';
  let n = Math.floor(Math.abs(num));
  const parts = [];

  const crore = Math.floor(n / 10000000);
  n %= 10000000;
  const lakh = Math.floor(n / 100000);
  n %= 100000;
  const thousand = Math.floor(n / 1000);
  n %= 1000;

  if (crore) parts.push(threeDigits(crore) + ' Crore');
  if (lakh) parts.push(threeDigits(lakh) + ' Lakh');
  if (thousand) parts.push(threeDigits(thousand) + ' Thousand');
  if (n) parts.push(threeDigits(n));

  return parts.join(' ').trim();
}

/** Amount in INR → "Rupees … Only" */
export function rupeesToWords(amount) {
  const x = Number(amount);
  if (Number.isNaN(x)) return '';
  const rupees = Math.floor(x);
  const paise = Math.round((x - rupees) * 100);
  let s = 'Rupees ' + intToWords(rupees);
  if (paise > 0) s += ' and ' + intToWords(paise) + ' Paise';
  s += ' Only';
  return s;
}
