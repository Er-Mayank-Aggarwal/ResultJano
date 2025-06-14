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

const cleanFolder = async (folder) => {
  const files = await fs.promises.readdir(folder);
  await Promise.all(files.map(file => fs.promises.unlink(path.join(folder, file))));
};

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

app.get('/', (req, res) => {
  res.send('🚀 PDF backend server is running!');
});

app.post('/', async (req, res) => {
  const { startRoll, endRoll, resultName } = req.body;

  if (!startRoll || !endRoll || !resultName) {
    return res.status(400).json({ error: 'Missing input fields' });
  }

  const notFound = [];
  const prefix = startRoll.slice(0, startRoll.length - 4);
  const startNum = parseInt(startRoll.slice(-4));
  const endNum = parseInt(endRoll.slice(-4));
  const websiteURL = 'https://mbmiums.in/(S(zkvqtk0qyp2cyqpl4smvkq45))/Results/ExamResultDeclare.aspx';

  await cleanFolder(downloadsDir);
  await cleanFolder(mergedDir);

  const browser = await puppeteer.launch({
    headless: 'new', // use false if you want to see browser
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();

  const client = await page.createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadsDir
  });

  for (let i = startNum; i <= endNum; i++) {
    const roll = `${prefix}${i.toString().padStart(4, '0')}`;
    if (roll.length !== 10) {
      console.log(`⚠️ Skipping invalid roll number (length ≠ 10): ${roll}`);
      notFound.push(roll);
      continue;
    }

    console.log(`🎯 Processing ${roll}`);

    try {
      await page.goto(websiteURL, { waitUntil: 'domcontentloaded' });

      // Click on the desired result link
      const clicked = await page.evaluate((resultName) => {
        const links = Array.from(document.querySelectorAll('a'));
        for (const link of links) {
          if (link.textContent.toLowerCase().includes(resultName.toLowerCase())) {
            link.click();
            return true;
          }
        }
        return false;
      }, resultName);

      if (!clicked) {
        console.log(`❌ Result link "${resultName}" not found for ${roll}`);
        notFound.push(roll);
        continue;
      }

      await page.waitForNavigation({ waitUntil: 'networkidle2' });
      await page.waitForSelector('#txtRollNo');

      await page.evaluate(() => {
        document.querySelector('#txtRollNo').value = '';
      });

      await page.type('#txtRollNo', roll);

      let alertTriggered = false;

      // Handle alert only once
      page.once('dialog', async (dialog) => {
        console.log(`⚠️ Alert for ${roll}: ${dialog.message()}`);
        alertTriggered = true;
        await dialog.accept();
      });

      await page.click('#btnGetResult');
      await delay(1500); // Give time for alert or download

      if (alertTriggered) {
        console.log(`❌ Alert triggered for ${roll}, skipping.`);
        notFound.push(roll);
        continue;
      }

      console.log(`✅ Successfully downloaded for ${roll}`);
    } catch (err) {
      console.log(`❌ Error for ${roll}: ${err.message}`);
      notFound.push(roll);
    }
  }

  await browser.close();

  // Merge PDFs
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const mergedFileName = `Merged_result.pdf`;
  const mergedPath = path.join(mergedDir, mergedFileName);

  try {
    await mergePDFs(downloadsDir, mergedPath);
  } catch (err) {
    console.error('❌ Failed to merge PDFs:', err.message);
    return res.status(500).json({ error: 'PDF merging failed', notFound });
  }

  await cleanFolder(downloadsDir);

  res.json({
    downloadURL: `pdf-backend-master/merged/merged_result.pdf`,
    notFound
  });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
