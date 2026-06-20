const fs = require('fs');
const path = require('path');

const srcPath = path.join(__dirname, '../packages/shared-types/src/index.ts');
const destinations = [
  'functions/signal-intake/src/shared-types.ts',
  'functions/risk-agents/src/shared-types.ts',
  'functions/decision-engine/src/shared-types.ts',
  'functions/compliance-logger/src/shared-types.ts',
  'apps/dashboard/src/shared-types.ts'
];

destinations.forEach(dest => {
  const absoluteDest = path.join(__dirname, '..', dest);
  const destDir = path.dirname(absoluteDest);
  
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  
  fs.copyFileSync(srcPath, absoluteDest);
  console.log(`Synced types to ${dest}`);
});
