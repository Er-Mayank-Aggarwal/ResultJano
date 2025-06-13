const express = require('express');
const fs = require('fs');
const path = require('path');
const puppeteer = require('puppeteer');
const cors = require('cors');
const axios = require('axios');
const { mergePDFs } = require('./utils/mergePDFs.cjs');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const downloadsDir = path.join(__dirname, 'downloads');
const mergedDir = path.join(__dirname, 'merged');

app.use('/merged', express.static(mergedDir));

if (!fs.existsSync(downloadsDir)) fs.mkdirSync(downloadsDir);
if (!fs.existsSync(mergedDir)) fs.mkdirSync(mergedDir);

const cleanFolder = (folder) => {
  if (fs.existsSync(folder)) {
    fs.readdirSync(folder).forEach(file => {
      fs.unlinkSync(path.join(folder, file));
    });
  }
};

const downloadPDF = async (pdfUrl, filePath) => {
  const response = await axios.get(pdfUrl, { responseType: 'arraybuffer' });
  fs.writeFileSync(filePath, response.data);
};

app.get('/', (req, res) => {
  res.send('🚀 PDF backend server is running!');
});

app.post('/', async (req, res) => {
  const { startRoll, endRoll, websiteURL } = req.body;
  if (!startRoll || !endRoll || !websiteURL)
    return res.status(400).json({ error: 'Missing input fields' });

  const notFound = [];
  const prefix = startRoll.slice(0, startRoll.length - 4);
  const startNum = parseInt(startRoll.slice(-4));
  const endNum = parseInt(endRoll.slice(-4));

  cleanFolder(downloadsDir);
  cleanFolder(mergedDir);

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  // Handle prompts (e.g. "Result not found" alerts)
  page.on('dialog', async dialog => {
    console.log(`⚠️ Alert: ${dialog.message()}`);
    await dialog.accept();
  });

  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadsDir,
  });

  for (let i = startNum; i <= endNum; i++) {
    const roll = `${prefix}${i.toString().padStart(4, '0')}`;
    console.log(`🎯 Processing ${roll}`);

    try {
      await page.goto(websiteURL, { waitUntil: 'networkidle2' });

      // Click on the result link - change if needed
      await Promise.all([
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
        page.evaluate(() => {
          __doPostBack('dgResultUG$ctl07$lnkResultUG', '');
        }),
      ]);

      await page.waitForSelector('#txtRollNo');
      await page.evaluate(() => (document.querySelector('#txtRollNo').value = ''));
      await page.type('#txtRollNo', roll);
      await page.click('#btnGetResult');

      // Wait for result or alert to appear
      try {
        await page.waitForSelector('#lblName', { timeout: 3000 });
      } catch {
        console.log(`❌ Result not found for ${roll}`);
        notFound.push(roll);
        continue;
      }

      // Get PDF URL
      const pdfUrl = await page.evaluate(() => {
        const link = document.querySelector('a[href$=".pdf"]');
        return link ? link.href : null;
      });

      if (!pdfUrl) {
        console.log(`❌ PDF link missing for ${roll}`);
        notFound.push(roll);
        continue;
      }

      const pdfPath = path.join(downloadsDir, `${roll}.pdf`);
      await downloadPDF(pdfUrl, pdfPath);
      console.log(`✅ Downloaded ${roll}.pdf`);

    } catch (err) {
      console.error(`❌ Failed for ${roll}: ${err.message}`);
      notFound.push(roll);
    }
  }

  // ✅ Ensure all downloads finish before closing browser
  console.log('⏳ Waiting for pending downloads...');
  await new Promise(resolve => setTimeout(resolve, 3000));

  await browser.close();

  // Merge PDFs
  const mergedPath = path.join(mergedDir, 'Final_Merged.pdf');
  await mergePDFs(downloadsDir, mergedPath);
  cleanFolder(downloadsDir);

  res.json({
    downloadURL: 'pdf-backend-master/merged/Final_Merged.pdf',
    notFound,
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
