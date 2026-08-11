const path = require('path');
const fs = require('fs');
const { Client, LocalAuth } = require('whatsapp-web.js');
const { env } = require('../src/config/env');

const dataPath = path.join(env.dataDir, '6a76c7a6f2b6b102e33d8d4b');

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  ];
  for (const c of candidates) if (c && fs.existsSync(c)) return c;
  return undefined;
}

async function main() {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath }),
    puppeteer: {
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-extensions'],
      ...(findChrome() ? { executablePath: findChrome() } : {}),
    },
  });

  let done = false;
  const finish = (obj) => {
    if (done) return;
    done = true;
    console.log('PROBE_RESULT_START');
    console.log(JSON.stringify(obj, null, 2));
    console.log('PROBE_RESULT_END');
    setTimeout(() => process.exit(0), 1000);
  };
  const fail = (e) => finish({ fatal: String((e && e.message) || e) });
  setTimeout(() => fail('GLOBAL TIMEOUT after 240s'), 240000);

  client.on('qr', () => console.log('EVENT qr'));
  client.on('ready', async () => {
    console.log('EVENT ready');
    try {
      const out = await client.pupPage.evaluate(async () => {
        const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
        const scan = {};
        const scanMod = (name) => {
          try {
            const mod = window.require(name);
            scan[name] = {
              ownKeys: Object.keys(mod),
              proto: mod.__proto__ ? Object.getOwnPropertyNames(mod.__proto__) : [],
            };
            // try to read state-like getters
            for (const g of ['getState', 'getCatalog', 'catalog', 'catalogId', 'getProducts', 'products', 'get', 'state']) {
              try {
                if (typeof mod[g] === 'function') {
                  const v = mod[g]();
                  let s;
                  try { s = JSON.stringify(v); } catch { s = String(v); }
                  if (s && s.length < 600) scan[name + '::' + g] = s;
                }
              } catch {}
            }
          } catch (e) {
            scan[name + '_err'] = String((e && e.message) || e).slice(0, 150);
          }
        };
        for (const m of ['WAWebBizCatalogStore', 'WAWebBizCreateProductCatalogJob', 'WAWebProductCatalogStore', 'WAWebCatalogStore']) scanMod(m);

        // try createProductCatalog job internals
        try {
          const job = window.require('WAWebBizCreateProductCatalogJob');
          scan.createProductCatalog_src = job.createProductCatalog ? job.createProductCatalog.toString().slice(0, 1500) : null;
        } catch (e) { scan.createProductCatalog_err = String((e && e.message) || e); }

        return scan;
      });
      finish(out);
    } catch (e) {
      fail(e);
    }
  });
  client.on('auth_failure', (m) => console.log('EVENT auth_failure', String(m)));
  client.on('disconnected', (r) => console.log('EVENT disconnected', String(r)));

  console.log('Initializing client');
  try {
    await client.initialize();
  } catch (e) {
    fail(e);
  }
}

main().catch((e) => console.error('MAIN ERR', String((e && e.message) || e)));
