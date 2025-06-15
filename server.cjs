const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const puppeteer = require('puppeteer');
const { mergePDFs } = require('./utils/mergePDFs.cjs');

const app = express();
const PORT = process.env.PORT || 5002;

const downloadsDir = path.join(__dirname, 'downloads');
const mergedDir = path.join(__dirname, 'merged');
const publicDir = path.join(__dirname, 'public');

app.use(cors());
app.use(express.json());
app.use('/merged', express.static(mergedDir));
app.use(express.static(publicDir));

[downloadsDir, mergedDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir);
});

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const cleanFolder = async folder => {
  const files = await fs.promises.readdir(folder);
  await Promise.all(files.map(file => fs.promises.unlink(path.join(folder, file))));
};

const toRomanNumeral = (num) => {
  const romanNumerals = {
    1: 'Ist', 2: 'IInd', 3: 'IIIrd', 4: 'IVth',
    5: 'Vth', 6: 'VIth', 7: 'VIIth', 8: 'VIIIth'
  };
  return romanNumerals[num] || num.toString();
};

app.get('/', (req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.post('/result', async (req, res) => {
  const { startRoll, endRoll, academicYear, examType, semester, semesterType, branch } = req.body;

  if (!startRoll || !endRoll) {
    return res.status(400).json({ error: 'Missing input fields' });
  }

  const romanSemester = toRomanNumeral(parseInt(semester) || semester);
  const notFound = [];

  const prefix = startRoll.slice(0, -4);
  const startNum = parseInt(startRoll.slice(-4));
  const endNum = parseInt(endRoll.slice(-4));

  const websiteURL = 'https://mbmiums.in/(S(zkvqtk0qyp2cyqpl4smvkq45))/Results/ExamResult.aspx';

  await cleanFolder(downloadsDir);
  await cleanFolder(mergedDir);

  const browser = await puppeteer.launch({
    headless: false,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    timeout: 0
  });

  const page = await browser.newPage();

  page.setDefaultTimeout(20000); // 20 seconds for every page operation
  page.setDefaultNavigationTimeout(30000); // 30 seconds for page navigation

  page.on('console', msg => {
    const text = msg.text();
    if (!text.includes('unsafe header') && !text.includes('Failed to load resource')) {
      console.log('BROWSER LOG:', text);
    }
  });

  const client = await page.target().createCDPSession();
  await client.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: downloadsDir
  });

  try {
    await page.goto(websiteURL, { waitUntil: 'domcontentloaded' });

    const semesterLinkSelector = `#link${semesterType}Sem${academicYear}`;
    console.log(`Checking for selector: ${semesterLinkSelector}`);

    const linkExists = await page.$(semesterLinkSelector);

    if (!linkExists) {
      await browser.close();
      return res.status(404).json({
        error: `No result link found for semester type and year: "${semesterLinkSelector}"`
      });
    }

    await page.click(semesterLinkSelector);
    await delay(3000);

    await page.waitForSelector('a', { timeout: 10000 });

    await fs.promises.writeFile('debug-page.html', await page.content());

    const clicked = await page.evaluate((romanSem, branchName) => {
      console.log("Evaluating links for match...");
      const links = Array.from(document.querySelectorAll('a'));
      console.log(`Found ${links.length} links`);

      for (const link of links) {
        const text = link.textContent.toLowerCase();
        if (text.includes(romanSem.toLowerCase()) && text.includes(branchName.toLowerCase())) {
          console.log(`Match found: ${link.textContent}`);
          link.click();
          return true;
        }
      }

      console.log("No matching link found.");
      return res.status(404).json({
        error: `No result declared for ${romanSemester} semester of ${branch} in ${academicYear}`
      });
    }, romanSemester, branch);

    if (!clicked) {
      await browser.close();
      return res.status(404).json({
        error: `No result declared for ${romanSemester} semester of ${branch} in ${academicYear}`
      });
    }

    await delay(3000); 
    for (let i = startNum; i <= endNum; i++) {
      const roll = `${prefix}${i.toString().padStart(4, '0')}`;
      if (roll.length !== 10) {
        console.log(`Skipping invalid roll: ${roll}`);
        notFound.push(roll);
        continue;
      }

      try {
        await page.waitForSelector('#txtRollNo', { timeout: 5000 });
        await page.evaluate(() => document.querySelector('#txtRollNo').value = '');
        await page.type('#txtRollNo', roll);

        let alertTriggered = false;
        page.once('dialog', async (dialog) => {
          console.log(`Alert for ${roll}: ${dialog.message()}`);
          alertTriggered = true;
          await dialog.accept();
        });

        await page.click('#btnGetResult');
        await delay(2500);

        if (alertTriggered) {
          notFound.push(roll);
          continue;
        }

        console.log(`Download initiated for ${roll}`);
      } catch (err) {
        console.log(`Error for roll ${roll}: ${err.message}`);
        notFound.push(roll);
      }
    }

    await browser.close();

    const mergedFileName = `Merged_result.pdf`;
    const mergedPath = path.join(mergedDir, mergedFileName);

    try {
      await mergePDFs(downloadsDir, mergedPath);
      await cleanFolder(downloadsDir);

      return res.json({
        downloadURL: `/merged/${mergedFileName}`,
        notFound
      });
    } catch (mergeErr) {
      return res.status(500).json({
        error: 'Failed to merge PDFs',
        notFound
      });
    }

  } catch (err) {
    await browser.close();
    return res.status(500).json({ error: `General error: ${err.message}` });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
