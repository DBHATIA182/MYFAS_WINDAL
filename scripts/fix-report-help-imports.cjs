const fs = require('fs');
const path = require('path');

const roots = [
  path.join(__dirname, '..', 'SRC', 'slides'),
  'E:/GFASORCL/APPTEST/SRC/slides',
];

const IMPORT_LINE = "import ReportHelpButton from '../components/ReportHelpButton';\n";

for (const dir of roots) {
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith('.jsx')) continue;
    const fp = path.join(dir, name);
    let s = fs.readFileSync(fp, 'utf8');
    if (!s.includes('ReportHelpButton') || s.includes('import ReportHelpButton')) continue;
    let last = 0;
    let pos = 0;
    while ((pos = s.indexOf('import ', pos)) >= 0) {
      last = s.indexOf('\n', pos) + 1;
      pos = last;
    }
    s = s.slice(0, last) + IMPORT_LINE + s.slice(last);
    fs.writeFileSync(fp, s);
    console.log('fixed import:', fp);
  }
}
