/**
 * Copy trial-balance PDF fixes from WINDAL → GFASORCL (dal-demo / mobile tunnel host).
 * Run after editing buildTrialBalanceJsPdfBlob in SRC/utils/pdfgenerator.js
 *
 *   node scripts/sync-trial-pdf-fix-to-gfasorcl.cjs
 */
const fs = require('fs');
const path = require('path');

const windal = path.join(__dirname, '..', 'SRC', 'utils', 'pdfgenerator.js');
const gfas = 'E:/GFASORCL/APPTEST/SRC/utils/pdfgenerator.js';

if (!fs.existsSync(windal)) {
  console.error('Source not found:', windal);
  process.exit(1);
}
if (!fs.existsSync(path.dirname(gfas))) {
  console.error('GFASORCL target missing:', gfas);
  console.error('Deploy WINDAL dist manually or set correct target path.');
  process.exit(1);
}

fs.copyFileSync(windal, gfas);
console.log('Copied pdfgenerator.js →', gfas);
console.log('Next: cd E:/GFASORCL/APPTEST && npm run build, then restart server / refresh tunnel.');
